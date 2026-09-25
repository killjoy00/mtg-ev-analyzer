#!/usr/bin/env python3
"""Stream official archives and retain evidence for checked-in replay drafts only.

The ordinary model is reused without retraining or changing probabilities. This
extract supplies independently read trophy/cohort evidence and actual first-pack
trajectories. Large raw archives are never checked in or sent to the browser.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'corpus' / 'draft-run' / 'evidence'
BASE = 'https://17lands-public.s3.amazonaws.com/analysis_data'


def number(value):
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def games(value):
    match = re.search(r'\d+', str(value or ''))
    return int(match.group()) if match else None


def rate(value):
    match = re.search(r'\d*\.?\d+', str(value or ''))
    return float(match.group()) if match else None


class DigestReader:
    def __init__(self, response):
        self.response, self.digest = response, hashlib.sha256()
        self.bytes = 0

    def read(self, size=-1):
        chunk = self.response.read(size)
        self.digest.update(chunk)
        self.bytes += len(chunk)
        return chunk


def stream(url, wanted, consume):
    req = urllib.request.Request(url, headers={'User-Agent': 'PackOne-Trophy-Audit/1.0'})
    with urllib.request.urlopen(req, timeout=90) as response:
        hashed = DigestReader(response)
        with gzip.GzipFile(fileobj=hashed) as gz, io.TextIOWrapper(gz, newline='') as text:
            header = next(csv.reader([text.readline()]))
            draft_col = header.index('draft_id')
            matched, count = set(), 0
            for line in text:
                count += 1
                # The fixed columns preceding draft_id contain no CSV commas.
                prefix = line.split(',', draft_col + 1)
                if len(prefix) <= draft_col or prefix[draft_col].strip('"') not in wanted:
                    continue
                row = dict(zip(header, next(csv.reader([line]))))
                if row['draft_id'] not in wanted:
                    raise ValueError('Unexpected CSV prefix layout')
                matched.add(row['draft_id'])
                consume(row)
        return {'url': url, 'etag': response.headers.get('ETag'),
                'last_modified': response.headers.get('Last-Modified'),
                'sha256': hashed.digest.hexdigest(), 'compressed_bytes': hashed.bytes,
                'rows_scanned': count, 'matched_replays': len(matched)}


def extract(set_id, refresh=False):
    output = OUT / f'{set_id}.json.gz'
    if output.exists() and not refresh:
        existing = json.loads(gzip.decompress(output.read_bytes()))
        return {'set': set_id, 'trophies': len(existing['drafts']), 'cached': True}
    started = time.monotonic()
    manifest = json.loads((ROOT / 'data' / set_id / 'manifest.json').read_text())
    wanted = {r['draft_id'] for f in (ROOT / 'data' / set_id / 'shards').glob('*.json')
              for r in json.loads(f.read_text())['replays']}
    expansion = manifest['source'].get('archive_expansion') or set_id.upper()
    url = f'{BASE}/draft_data/draft_data_public.{expansion}.PremierDraft.csv.gz'
    drafts = {}

    def consume(row):
        if number(row.get('event_match_wins')) != 7:
            return
        did = row['draft_id']
        draft = drafts.setdefault(did, {
            'draft_id': did, 'event_match_wins': 7,
            'event_match_losses': number(row.get('event_match_losses')),
            'player_games_lower_bound': games(row.get('user_n_games_bucket')),
            'player_win_rate_bucket': rate(row.get('user_game_win_rate_bucket')),
            'rank': row.get('rank'), 'picks': [],
        })
        if number(row.get('pack_number')) != 0 or number(row.get('pick_number')) > 11:
            return
        candidates, pool = [], {}
        for key, value in row.items():
            if key.startswith('pack_card_') and number(value):
                candidates.extend([key[10:]] * int(float(value)))
            elif key.startswith('pool_') and number(value):
                pool[key[5:]] = int(float(value))
        draft['picks'].append({'raw_pick_number': int(float(row['pick_number'])),
                               'historical_pick': row['pick'], 'candidates': candidates, 'pool': pool})

    source = stream(url, wanted, consume)
    skill_source = None
    if manifest['cohort'].get('selection_metric') == 'earliest_game_arena_rank':
        earliest = {}

        def consume_game(row):
            did, when = row['draft_id'], row.get('game_time') or ''
            old = earliest.get(did)
            if old is None or (when and when < old['game_time']):
                earliest[did] = {'game_time': when, 'rank': row.get('rank'),
                                 'player_games_lower_bound': games(row.get('user_n_games_bucket'))}

        skill_source = stream(f'{BASE}/game_data/game_data_public.{expansion}.PremierDraft.csv.gz', set(drafts), consume_game)
        for did, draft in drafts.items():
            draft.update(earliest.get(did, {}))
            draft['skill_evidence'] = 'earliest_game_arena_rank'
    payload = {'schema_version': 1, 'set_id': set_id, 'source': source,
               'skill_source': skill_source, 'drafts': list(drafts.values())}
    OUT.mkdir(parents=True, exist_ok=True)
    temp = output.with_suffix('.tmp')
    temp.write_bytes(gzip.compress(json.dumps(payload, separators=(',', ':')).encode(), mtime=0))
    temp.replace(output)
    return {'set': set_id, 'trophies': len(drafts), 'matched': source['matched_replays'],
            'seconds': round(time.monotonic() - started), 'bytes': source['compressed_bytes']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--sets', default='all')
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    ids = ([s['id'] for s in json.loads((ROOT / 'data/catalog.json').read_text())['sets']]
           if args.sets == 'all' else args.sets.split(','))
    errors = []
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        tasks = {executor.submit(extract, sid, args.refresh): sid for sid in ids}
        for future in as_completed(tasks):
            try:
                print(json.dumps(future.result()), flush=True)
            except Exception as exc:
                errors.append(tasks[future])
                print(json.dumps({'set': tasks[future], 'error': str(exc)}), flush=True)
    if errors:
        raise SystemExit('Failed sets: ' + ','.join(errors))
