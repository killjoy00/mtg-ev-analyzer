#!/usr/bin/env python3
"""Build every catalog environment from official trophy trajectory evidence."""
import argparse
from collections import Counter
import gzip
import hashlib
import json
import math
from pathlib import Path
from set_policy import corpus_version
import re

ROOT = Path(__file__).resolve().parents[1]
VERSION = corpus_version()


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-') or 'card'


def read_gzip(path):
    return json.loads(gzip.decompress(path.read_bytes()))


CUBE_REROLL_MAX_RATING_DELTA = 10
CUBE_REROLL_MAX_DISTANCE = 0.16
CUBE_CURRENT_FIRST_PICK = 2
CUBE_CURRENT_LAST_PICK = 9


def js_round_nonnegative(value):
    return int(math.floor(float(value) + 0.5))


def puzzle_metrics(puzzle):
    values = sorted((max(0.0, float(c.get('model_probability') or 0)) for c in puzzle['candidates']), reverse=True)
    if len(values) < 2 or not values[0] > 0:
        return None
    top, second = values[0], values[1]
    total = sum(values)
    entropy = 1.0 if total <= 1e-9 else -sum(
        (v / total) * math.log(v / total) for v in values if v > 1e-9
    ) / math.log(len(values))
    historical = next((c for c in puzzle['candidates'] if c['id'] == puzzle['historical_pick_id']), None)
    target_ratio = None if historical is None else float(historical.get('model_probability') or 0) / top
    rating = js_round_nonnegative(100 * second / top)
    band = 'easy' if rating < 50 else 'medium' if rating < 80 else 'hard'
    return {
        'rating': rating,
        'band': band,
        'candidate_count': len(values),
        'top_gap': top - second,
        'entropy': max(0.0, min(1.0, entropy)),
        'prior_pool_size': len(puzzle.get('prior_picks') or []),
        'interesting': len(values) >= 4 and top <= .75 and second / top >= .2,
        'serving': target_ratio is not None and 0 <= target_ratio <= 1 and
                   js_round_nonnegative(95 * target_ratio) >= 20,
    }


def reroll_distance(a, b):
    return (
        abs(a['pick_number'] - b['pick_number']) / 3 * .35
        + abs(a['candidate_count'] - b['candidate_count']) / max(1, a['candidate_count'], b['candidate_count']) * .15
        + abs(a['top_gap'] - b['top_gap']) * .25
        + abs(a['entropy'] - b['entropy']) * .15
        + abs(a['prior_pool_size'] - b['prior_pool_size']) / max(1, a['prior_pool_size'], b['prior_pool_size']) * .10
    )


def cube_reroll_candidates(pool, source, metrics, anchor, excluded=()):
    source_metric = metrics[source['puzzle_id']]
    excluded = set(excluded) | {source['source_draft_hash']}
    candidates = []
    for puzzle in pool:
        metric = metrics[puzzle['puzzle_id']]
        if puzzle['source_draft_hash'] in excluded or puzzle['pick_number'] != source['pick_number']:
            continue
        if metric['band'] != source_metric['band'] or metric['band'] != anchor['band']:
            continue
        if abs(metric['rating'] - source_metric['rating']) > CUBE_REROLL_MAX_RATING_DELTA:
            continue
        if abs(metric['rating'] - anchor['rating']) > CUBE_REROLL_MAX_RATING_DELTA:
            continue
        distance = reroll_distance(
            {'pick_number': source['pick_number'], **source_metric},
            {'pick_number': puzzle['pick_number'], **metric},
        )
        if math.isfinite(distance) and distance <= CUBE_REROLL_MAX_DISTANCE:
            candidates.append((distance, puzzle['puzzle_id'], puzzle))
    candidates.sort(key=lambda item: (item[0], item[1]))
    return [item[2] for item in candidates[:20]]


def cube_supports_two_pack_rerolls(pool, source, metrics):
    anchor = metrics[source['puzzle_id']]
    first = cube_reroll_candidates(pool, source, metrics, anchor)
    if not first:
        return False
    # The first reroll is seed-selected from the closest 20. Every possible
    # first replacement must leave a second valid replacement, otherwise the
    # advertised two-reroll Cube contract can fail for some session seeds.
    for replacement in first:
        if not cube_reroll_candidates(
            pool, replacement, metrics, anchor,
            excluded=(source['source_draft_hash'], replacement['source_draft_hash']),
        ):
            return False
    return True


def prune_cube_reroll_dead_ends(rows):
    metrics = {p['puzzle_id']: puzzle_metrics(p) for p in rows}
    def selectable(p):
        m = metrics[p['puzzle_id']]
        if not m or not m['interesting'] or not m['serving']:
            return False
        pick = int(p['pick_number'])
        if not CUBE_CURRENT_FIRST_PICK <= pick <= CUBE_CURRENT_LAST_PICK:
            return False
        # eight-pick-v4 places its only easy slot in rounds 1-5 (P1P2-P1P6).
        return pick <= 6 or m['band'] != 'easy'

    kept = list(rows)
    removed = set()
    while True:
        pool = [p for p in kept if selectable(p)]
        bad = {p['puzzle_id'] for p in pool if not cube_supports_two_pack_rerolls(pool, p, metrics)}
        if not bad:
            break
        removed |= bad
        kept = [p for p in kept if p['puzzle_id'] not in bad]
    return kept, len(removed)


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
    # The model version is a property of the shards this reads, not of this
    # script, so it is taken from their manifests rather than written down here.
    # Held as a literal it claimed v2 for whatever the shards actually held.
    catalog = {'corpus_version': VERSION, 'model_version': None,
               'holdout': '5-fold by draft_id', 'verification': 'official_archive_trajectory', 'sets': []}
    missing_images = {}
    for entry in registry:
        sid = entry['id']
        if selected and sid not in selected:
            continue
        manifest = json.loads((root / 'data' / sid / 'manifest.json').read_text())
        assert manifest['model']['holdout'] == catalog['holdout']
        model = manifest['model']['model_version']
        # One corpus, one model. A half-rebuilt data/ would otherwise publish a
        # corpus whose rows came from two models under a single label.
        assert catalog['model_version'] in (None, model), \
            f"{sid} is model {model}, corpus already holds {catalog['model_version']}"
        catalog['model_version'] = model
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
        if sid == 'powered-cube':
            rows, removed = prune_cube_reroll_dead_ends(rows)
            if removed:
                exclusions['reroll_dead_end_decisions'] += removed
        for p in rows:
            for c in p['candidates'] + p['prior_picks']:
                if not c.get('image_url', '').startswith('https://'):
                    missing_images[c['id']] = c['name']
        published_sources = len({p['source_draft_hash'] for p in rows})
        if published_sources < 12:
            raise ValueError(f'{sid}: only {published_sources} published trophy drafts; exclusions={dict(exclusions)}')
        output = root / 'corpus/draft-run' / f'{sid}.json.gz'
        output.write_bytes(gzip.compress(json.dumps(rows, separators=(',', ':')).encode(), mtime=0))
        info = {'id': sid, 'name': entry['name'], 'puzzles': len(rows), 'trophy_drafts': published_sources,
                'first_pick': min(p['pick_number'] for p in rows), 'last_pick': max(p['pick_number'] for p in rows), 'category': 'special_mode' if sid == 'powered-cube' else 'expansion',
                'source_date': manifest['source']['data_date'], 'source_archive': evidence['source'],
                'evidence_sha256': hashlib.sha256(evidence_path.read_bytes()).hexdigest(),
                'exclusions': dict(exclusions), 'unresolved_image_names': sorted(unresolved_names), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}
        catalog['sets'].append(info)
        print(f'{sid}: {published_sources} trophy drafts, {len(rows)} decisions, excluded {dict(exclusions)}', flush=True)
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
