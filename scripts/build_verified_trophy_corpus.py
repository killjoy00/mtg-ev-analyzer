#!/usr/bin/env python3
"""Build every catalog environment from official trophy trajectory evidence."""
import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
VERSION = 'elite-trophy-verified-v6'


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-') or 'card'


def read_gzip(path):
    return json.loads(gzip.decompress(path.read_bytes()))


def build(root=ROOT, selected=None):
    registry = json.loads((root / 'data/catalog.json').read_text())['sets']
    images = json.loads((root / 'corpus/draft-run/card-images.json').read_text())
    metadata = {}
    replays = {}
    for entry in registry:
        sid = entry['id']
        replays[sid] = [r for f in sorted((root / 'data' / sid / 'shards').glob('*.json'))
                        for r in json.loads(f.read_text())['replays']]
        for replay in replays[sid]:
            for pick in replay['picks']:
                for card in pick['candidates']:
                    resolved = {**images.get(card['id'], {}), **card}
                    if resolved.get('image_url'):
                        metadata[card['name']] = {k: v for k, v in resolved.items() if k != 'model_probability'}
    catalog = {'corpus_version': VERSION, 'model_version': 'strong-player-pool-context-v2',
               'holdout': '5-fold by draft_id', 'verification': 'official_archive_trajectory', 'sets': []}
    missing_images = {}
    for entry in registry:
        sid = entry['id']
        if selected and sid not in selected:
            continue
        manifest = json.loads((root / 'data' / sid / 'manifest.json').read_text())
        assert manifest['model']['holdout'] == catalog['holdout']
        assert manifest['cohort']['minimum_games_bucket_lower_bound'] >= 100
        evidence_path = root / 'corpus/draft-run/evidence' / f'{sid}.json.gz'
        evidence = read_gzip(evidence_path)
        trophies = {d['draft_id']: d for d in evidence['drafts']}
        rows, used, exclusions = [], set(), Counter()
        unresolved_names = set()
        last = 12 if sid == 'powered-cube' else 11
        for replay in replays[sid]:
            draft = trophies.get(replay['draft_id'])
            if not draft:
                continue
            rank = next((r for r in ['mythic', 'diamond', 'platinum', 'gold', 'silver', 'bronze']
                         if r in str(draft.get('rank', '')).lower()), None)
            legacy = manifest['cohort'].get('selection_metric') == 'earliest_game_arena_rank'
            qualified = (rank in ['diamond', 'mythic'] if legacy else
                         (draft.get('player_win_rate_bucket') or 0) >= max(.6, manifest['cohort']['win_rate_cutoff']))
            if draft['event_match_wins'] != 7 or (draft.get('player_games_lower_bound') or 0) < 100 or not qualified:
                exclusions['skill_evidence'] += 1
                continue
            raw = {p['raw_pick_number'] + 1: p for p in draft['picks']}
            rendered = {p['pick_number']: p for p in replay['picks'] if p['pack_number'] == 1}
            first = 2 if sid == 'powered-cube' or 1 not in raw or 1 not in rendered else 1
            if any(n not in raw or n not in rendered for n in range(first, last + 1)):
                exclusions['incomplete_trajectory'] += 1
                continue
            prior = []
            if first == 2:
                initial = raw[2]['pool']
                if sum(initial.values()) != 1:
                    exclusions['incomplete_initial_pool'] += 1
                    continue
                name = next(iter(initial))
                prior = [metadata.get(name, {'id': slug(name), 'name': name})]
            staged = []
            for n in range(first, last + 1):
                p, source = rendered[n], raw[n]
                cards = [{**metadata.get(c['name'], {}), **c} for c in p['candidates']]
                historical = next((c for c in cards if c['id'] == p['historical_pick_id']), None)
                expected_pool = dict(Counter(c['name'] for c in prior))
                if (not historical or historical['name'] != source['historical_pick'] or
                    set(c['name'] for c in cards) != set(source['candidates']) or
                    p['pool'] != expected_pool or source['pool'] != expected_pool):
                    exclusions['trajectory_or_pool_mismatch'] += 1
                    staged = []
                    break
                fingerprint = hashlib.sha256(json.dumps(draft['picks'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
                if len(cards) >= 4:
                    staged.append({
                        'puzzle_id': hashlib.sha256(f"{VERSION}|{sid}|{replay['draft_id']}|{n}".encode()).hexdigest()[:32],
                        'set_id': sid, 'source_draft_hash': hashlib.sha256(f"{sid}|{replay['draft_id']}".encode()).hexdigest()[:32],
                        'source_fingerprint': fingerprint, 'corpus_version': VERSION,
                        'source_evidence': 'official_archive_trajectory',
                        'skill_evidence': 'earliest_game_arena_rank' if legacy else 'win_rate_bucket',
                        'player_rank_tier': rank if legacy else None,
                        'pick_number': n, 'historical_pick_id': p['historical_pick_id'],
                        'prior_picks': list(prior), 'candidates': cards,
                        'event_match_wins': 7, 'player_games_lower_bound': draft['player_games_lower_bound'],
                        'player_win_rate_bucket': None if legacy else draft['player_win_rate_bucket'],
                    })
                prior.append({k: v for k, v in historical.items() if k != 'model_probability'})
            visible = []
            for puzzle in staged:
                absent = [c for c in puzzle['candidates'] + puzzle['prior_picks'] if not c.get('image_url', '').startswith('https://')]
                if absent:
                    exclusions['image_metadata_incomplete'] += 1
                    for card in absent:
                        missing_images[card['id']] = card['name']
                        unresolved_names.add(card['name'])
                else:
                    visible.append(puzzle)
            staged = visible
            if staged:
                used.add(replay['draft_id'])
                rows.extend(staged)
        for p in rows:
            for c in p['candidates'] + p['prior_picks']:
                if not c.get('image_url', '').startswith('https://'):
                    missing_images[c['id']] = c['name']
        if len(used) < 12:
            raise ValueError(f'{sid}: only {len(used)} eligible trophy drafts; exclusions={dict(exclusions)}')
        output = root / 'corpus/draft-run' / f'{sid}.json.gz'
        output.write_bytes(gzip.compress(json.dumps(rows, separators=(',', ':')).encode(), mtime=0))
        info = {'id': sid, 'name': entry['name'], 'puzzles': len(rows), 'trophy_drafts': len(used),
                'first_pick': min(p['pick_number'] for p in rows), 'last_pick': max(p['pick_number'] for p in rows), 'category': 'special_mode' if sid == 'powered-cube' else 'expansion',
                'source_date': manifest['source']['data_date'], 'source_archive': evidence['source'],
                'evidence_sha256': hashlib.sha256(evidence_path.read_bytes()).hexdigest(),
                'exclusions': dict(exclusions), 'unresolved_image_names': sorted(unresolved_names), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}
        catalog['sets'].append(info)
        print(f'{sid}: {len(used)} trophy drafts, {len(rows)} decisions, excluded {dict(exclusions)}', flush=True)
    if missing_images:
        target = root / 'generated/review/all-set-missing-images.json'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(missing_images, indent=2))
        print(f'Excluded decisions with {len(missing_images)} unresolved card names; see {target}', flush=True)
    if not selected:
        assert {s['id'] for s in catalog['sets']} == {s['id'] for s in registry}
        (root / 'corpus/draft-run/catalog.json').write_text(json.dumps(catalog, indent=2) + '\n')
    return catalog


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--sets')
    args = parser.parse_args()
    build(selected=set(args.sets.split(',')) if args.sets else None)
