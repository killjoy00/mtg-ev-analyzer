#!/usr/bin/env python3
"""Aggregate public PremierDraft game outcomes by maindeck copy count.

All game outcomes, not only trophy drafts. Two local passes over an already
downloaded, SHA-pinned archive. No network, account data, raw output rows or
persistent game/draft identifiers. Results describe associations, not effects.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import re

VERSION = 'copy-outcomes-v1'
MIN_GAMES, MIN_DRAFTS = 150, 30
MAX_ROWS = 2_000_000
MAX_CARDS = 1000
MAX_BYTES = 16 * 1024 * 1024
BASIC = frozenset({'Plains','Island','Swamp','Mountain','Forest','Wastes',
                   'Snow-Covered Plains','Snow-Covered Island','Snow-Covered Swamp',
                   'Snow-Covered Mountain','Snow-Covered Forest'})
KEY_FIELDS = ('draft_id','game_time','build_index','match_number','game_number')
BUCKETS = ('1','2','3','4+','2+')
HEX = re.compile(r'^[a-f0-9]{64}$')


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as source:
        for chunk in iter(lambda: source.read(1024*1024), b''):
            h.update(chunk)
    return h.hexdigest()


def rows(path):
    return gzip.open(path, 'rt', encoding='utf-8-sig', newline='')


def parse_int(value):
    # 17Lands CSV counts may be rendered as integer-valued decimal strings.
    if value == '':
        return 0
    if value.isascii() and value.isdigit() and len(value) <= 3:
        return int(value)
    try:
        n = float(value)
        return int(n) if math.isfinite(n) and n == int(n) and 0 <= n <= 255 else None
    except (TypeError, ValueError, OverflowError):
        return None


def game_key(row, ix):
    fields = [row[ix[k]].strip() for k in KEY_FIELDS]
    # Reject missing identity/time/sequence, instead of merging unknown games.
    if not all(fields) or any(len(v) > 200 for v in fields):
        return None
    return hashlib.sha256(json.dumps(fields, separators=(',',':')).encode()).digest()


def group_for(row, ix):
    # Only exact two-color main decks with known experienced-player skill.
    colors = row[ix['main_colors']].strip().upper()
    if len(colors) != 2 or len(set(colors)) != 2 or any(c not in 'WUBRG' for c in colors):
        return None
    try:
        rate = float(row[ix['user_game_win_rate_bucket']])
        experience = float(row[ix['user_n_games_bucket']])
    except (ValueError, TypeError):
        return None
    if not math.isfinite(rate) or not 0 <= rate <= 1 or not math.isfinite(experience) or experience < 100:
        return None
    color = ''.join(c for c in 'WUBRG' if c in colors)
    skill = 'lt50' if rate < .5 else '50to59' if rate < .6 else '60plus'
    return color + '|' + skill


def add(cells, key, won, draft):
    # Draft ordinals are in-memory only, never exported. Distinct source
    # counts are calculated separately for each exact and pooled bucket.
    cell = cells.get(key)
    if cell is None:
        cell = [0, 0, set()]
        cells[key] = cell
    cell[0] += won
    cell[1] += 1
    cell[2].add(draft)


def packed(cell):
    return [cell[0], cell[1], len(cell[2])]


def enough(cell):
    return cell is not None and cell[1] >= MIN_GAMES and len(cell[2]) >= MIN_DRAFTS


def build_report(path, set_id, source_sha256):
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', set_id) or not HEX.fullmatch(source_sha256):
        raise ValueError('lab-outcomes-identity')
    if digest(path) != source_sha256:
        raise ValueError('lab-outcomes-source-hash')
    seen, duplicate = set(), set()
    raw = 0
    with rows(path) as handle:
        reader = csv.reader(handle)
        header = next(reader)
        if len(set(header)) != len(header):
            raise ValueError('lab-outcomes-duplicate-column')
        ix = {n:i for i,n in enumerate(header)}
        required = set(KEY_FIELDS) | {'won','main_colors','user_game_win_rate_bucket','user_n_games_bucket'}
        if not required.issubset(ix):
            raise ValueError('lab-outcomes-schema')
        deck = [(i,n[5:]) for i,n in enumerate(header) if n.startswith('deck_')]
        if not deck or len(deck) > MAX_CARDS or any(not n or len(n)>160 or any(ord(c)<32 or c in '<>' for c in n) for _,n in deck):
            raise ValueError('lab-outcomes-deck-schema')
        for row in reader:
            raw += 1
            if raw > MAX_ROWS:
                raise ValueError('lab-outcomes-row-limit')
            if len(row) != len(header):
                continue
            key = game_key(row, ix)
            if key is None:
                continue
            if key in seen:
                duplicate.add(key)
            else:
                seen.add(key)
    del seen
    cells, stratified, drafts = {}, {}, {}
    accepted = wins = duplicate_rows = invalid = known_stratum = 0
    with rows(path) as handle:
        reader = csv.reader(handle)
        if next(reader) != header:
            raise ValueError('lab-outcomes-source-changed')
        for row in reader:
            if len(row) != len(header):
                invalid += 1
                continue
            key = game_key(row, ix)
            if key in duplicate:
                duplicate_rows += 1
                continue
            result = row[ix['won']].strip().lower()
            if key is None or result not in ('true','false','1','0'):
                invalid += 1
                continue
            played, size, good = [], 0, True
            for i, name in deck:
                count = parse_int(row[i])
                if count is None or count > 100:
                    good = False
                    break
                size += count
                if count and name not in BASIC:
                    played.append((name,count))
            if not good or not 40 <= size <= 100:
                invalid += 1
                continue
            won = int(result in ('true','1'))
            identity = row[ix['draft_id']].strip()
            draft = drafts.setdefault(identity, len(drafts))
            accepted += 1
            wins += won
            group = group_for(row, ix)
            if group:
                known_stratum += 1
            for name, count in played:
                bucket = str(count) if count <= 3 else '4+'
                add(cells, (name,bucket), won, draft)
                pooled = '1' if count == 1 else '2+'
                if count >= 2:
                    add(cells, (name,pooled), won, draft)
                if group:
                    add(stratified, (name,group,pooled), won, draft)
    if raw != accepted + duplicate_rows + invalid or not accepted or digest(path) != source_sha256:
        raise ValueError('lab-outcomes-accounting')
    result = {}
    groups_by_name = {}
    for name, group, _ in stratified:
        groups_by_name.setdefault(name, set()).add(group)
    for _, name in sorted(deck,key=lambda c:c[1]):
        if name in BASIC or not enough(cells.get((name,'1'))) or not enough(cells.get((name,'2+'))):
            continue
        groups = {}
        for group in sorted(groups_by_name.get(name, ())):
            if all(enough(stratified.get((name,group,b))) for b in ('1','2+')):
                groups[group] = {b:packed(stratified[name,group,b]) for b in ('1','2+')}
        result[name] = {'all': {b:packed(cells[name,b]) for b in BUCKETS if enough(cells.get((name,b)))},
                        'strata': groups}
    return {'schema_version':1,'definition':VERSION,'set_id':set_id,'event_type':'PremierDraft',
            'source_sha256':source_sha256,'source':'17Lands public game data (CC BY 4.0)',
            'raw_games':raw,'games':accepted,'wins':wins,'drafts':len(drafts),
            'invalid_games':invalid,'duplicate_games':duplicate_rows,'known_stratum_games':known_stratum,
            'minimum_games':MIN_GAMES,'minimum_drafts':MIN_DRAFTS,'cards':result}


def write_report(path, report):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(',',':'))+'\n').encode()
    if len(data) > MAX_BYTES:
        raise ValueError('lab-outcomes-report-size')
    temp = path.with_suffix(path.suffix+'.tmp')
    temp.write_bytes(data)
    os.replace(temp,path)
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive',type=Path,required=True)
    parser.add_argument('--set-id',required=True)
    parser.add_argument('--sha256',required=True)
    parser.add_argument('--out',type=Path,required=True)
    args = parser.parse_args()
    report = build_report(args.archive,args.set_id,args.sha256)
    file_hash = write_report(args.out,report)
    # Aggregate diagnostics only. Never print raw rows or identifiers.
    print(json.dumps({'set_id':report['set_id'],'games':report['games'],'drafts':report['drafts'],
                      'cards':len(report['cards']),'sha256':file_hash}))


if __name__ == '__main__':
    main()
