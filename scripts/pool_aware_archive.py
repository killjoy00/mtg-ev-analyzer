#!/usr/bin/env python3
"""Development-only archive adapter for #1863. No final-test or serving path.

Run from repository root with a checksum-pinned manifest. Only the baseline,
residual-fit and validation windows are opened for pick labels. A future final
assessment must use new evidence and a separately frozen protocol.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import json
import math
from pathlib import Path

from pool_aware_features import Interaction, extract
from pool_aware_refit import ARMS, FEATURES, Choice, evaluate, fit, weights

PHASES = ('baseline', 'residual', 'validation', 'assessment')
PENALTIES = (.02, .1, .5)
MIN_GAMES = 100
TOP_FRACTION = .15
PURGE = timedelta(days=7)


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def time_utc(value):
    # Archive timestamps are documented as UTC; naive archive values are UTC.
    d = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return (d if d.tzinfo is not None else d.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def read_json(path):
    with (gzip.open(path, 'rt', encoding='utf8') if str(path).endswith('.gz') else Path(path).open(encoding='utf8')) as f:
        return json.load(f)


def load_manifest(path):
    path = Path(path)
    m = read_json(path)
    if m.get('schema') != 1 or not m.get('set') or not m.get('mode'):
        raise ValueError('manifest schema, set and mode required')
    if set(m['windows']) != set(PHASES):
        raise ValueError('four explicit time windows required')
    windows = {}
    latest = None
    for phase in PHASES:
        start, end = map(time_utc, m['windows'][phase])
        if not start < end or (latest is not None and start < latest + PURGE):
            raise ValueError('windows must be ordered with a seven-day purge')
        windows[phase] = (start, end)
        latest = end
    sources = {}
    for kind in ('draft', 'games', 'metadata', 'interactions'):
        entry = m['sources'][kind]
        p = (path.parent / entry['path']).resolve()
        if not entry.get('origin') or sha256(p) != entry['sha256']:
            raise ValueError(f'{kind}: missing provenance or checksum mismatch')
        sources[kind] = p
    return m, windows, sources


def phase_of(t, windows):
    # Deliberately never assign assessment labels in the development driver.
    for p in PHASES[:-1]:
        start, end = windows[p]
        if start <= t < end:
            return p
    return None


def rows(path):
    with (gzip.open(path, 'rt', encoding='utf8', newline='') if str(path).endswith('.gz') else Path(path).open(encoding='utf8', newline='')) as f:
        reader = csv.reader(f)
        header = next(reader)
        if len(set(header)) != len(header):
            raise ValueError('duplicate archive header')
        index = {key: i for i, key in enumerate(header)}
        yield header, index, reader


def scan_drafts(path, windows, rate_parser, games_parser):
    sources = {}
    invalid = set()
    for header, idx, reader in rows(path):
        for key in ('draft_id', 'draft_time', 'user_game_win_rate_bucket', 'user_n_games_bucket'):
            if key not in idx:
                raise ValueError(f'draft archive missing {key}')
        for v in reader:
            if len(v) != len(header):
                raise ValueError('malformed draft archive record')
            d = v[idx['draft_id']].strip()
            if not d:
                raise ValueError('empty draft ID')
            t = time_utc(v[idx['draft_time']])
            phase = phase_of(t, windows)
            # A source appearing across a window boundary must not survive.
            if phase is None:
                if d in sources:
                    invalid.add(d)
                continue
            rate = rate_parser(v[idx['user_game_win_rate_bucket']])
            games = games_parser(v[idx['user_n_games_bucket']])
            info = (phase, t, rate, games)
            if d in sources and sources[d] != info:
                invalid.add(d)
            sources[d] = info
    # Second pass validates timestamps for all rows of selected IDs, including
    # rows preceding their first in-window occurrence. No excluded labels read.
    for header, idx, reader in rows(path):
        for v in reader:
            d = v[idx['draft_id']].strip()
            if d in sources and time_utc(v[idx['draft_time']]) != sources[d][1]:
                invalid.add(d)
    for d in invalid:
        sources.pop(d, None)
    return sources, len(invalid)


def scan_baseline_games(path, sources, end):
    """Purge whole baseline drafts whose linked game evidence crosses cutoff."""
    linked, invalid = {}, set()
    for header, idx, reader in rows(path):
        for key in ('draft_id', 'game_time', 'main_colors', 'splash_colors'):
            if key not in idx:
                raise ValueError(f'game archive missing {key}; cannot prove chronology')
        for v in reader:
            if len(v) != len(header):
                raise ValueError('malformed game archive record')
            d = v[idx['draft_id']].strip()
            if d not in sources or sources[d][0] != 'baseline':
                continue
            try:
                t = time_utc(v[idx['game_time']])
            except ValueError:
                invalid.add(d)
                continue
            if t < sources[d][1] or t >= end:
                invalid.add(d)
            linked[d] = max(t, linked.get(d, t))
    return linked, invalid


def select_sources(sources, invalid, quantile):
    qualified = {d: info for d, info in sources.items()
                 if d not in invalid and info[2] is not None and info[3] is not None and info[3] >= MIN_GAMES}
    cutoff = quantile([v[2] for v in qualified.values() if v[0] == 'baseline'], TOP_FRACTION)
    strong = {d: v for d, v in qualified.items() if v[2] >= cutoff}
    control = {d: v for d, v in qualified.items() if v[0] == 'validation' and v[2] < cutoff}
    return strong, control, cutoff


def read_picks(path, sources, parse_example, candidate_columns, pool_columns):
    seen = set()
    skipped = Counter()
    grouped = defaultdict(list)
    for header, idx, reader in rows(path):
        pack, pool = candidate_columns(header), pool_columns(header)
        if not pack or not pool:
            raise ValueError('missing pack/pool columns')
        for v in reader:
            d = v[idx['draft_id']].strip()
            if d not in sources:
                continue
            ex = parse_example(dict(zip(header, v)), pack, pool)
            if ex is None:
                skipped[sources[d][0]] += 1
                continue
            key = (d, ex.raw_pack_number, ex.raw_pick_number)
            if key in seen:
                raise ValueError('duplicate draft/pack/pick')
            seen.add(key)
            grouped[d].append(ex)
    return grouped, skipped


@dataclass
class BaselineView:
    set_id: str
    data: dict

    def examples(self):
        for d, examples in self.data.items():
            for ex in examples:
                yield d, ex


def load_interactions(path, metadata):
    raw = read_json(path)
    if raw.get('schema') != 1:
        raise ValueError('invalid interaction registry schema')
    ids = {m['id'] for m in metadata.values() if isinstance(m, dict) and m.get('id')}
    interactions = []
    for edge in raw['edges']:
        if not edge.get('rules_reference') or not edge.get('review_reference') or edge.get('status') != 'verified':
            raise ValueError('specific synergy requires a documented independent rules review')
        value = Interaction(edge['payoff'], frozenset(edge['enablers']), edge.get('minimum_distinct', 2))
        if not {value.payoff, *value.enablers} <= ids:
            raise ValueError('synergy IDs not in pinned metadata')
        interactions.append(value)
    return interactions


def choice(ex, t, model, metadata, interactions, normalize):
    names = tuple(ex.candidates)
    raw = {n: model.card_tendency(n, ex.raw_pack_number, ex.raw_pick_number, ex.pool) for n in names}
    pool = tuple(n for n, copies in ex.pool.items() for _ in range(copies))
    support = tuple(raw[n] for n in names)
    features, coverage = extract(pool, names, support, metadata, interactions)
    row = Choice(ex.draft_id, t.isoformat(), names, support, features, names.index(ex.historical_pick))
    baseline = normalize(raw)
    if any(abs(a - baseline[n]) > 1e-12 for n, a in zip(names, weights(row, (0.,)*len(FEATURES)))):
        raise AssertionError('zero-residual support parity failed')
    return row, pool, coverage


def served(grouped, sources, model, metadata, interactions, normalize, pack_offset, pick_offset):
    results = []
    coverage = Counter()
    for d, examples in grouped.items():
        for ex in examples:
            pick = ex.raw_pick_number + pick_offset
            if ex.raw_pack_number + pack_offset != 1 or not 1 <= pick <= 11 or len(ex.candidates) < 2:
                continue
            if sum(ex.pool.values()) != pick - 1:
                coverage['invalid_prior_length'] += 1
                continue
            row, pool, info = choice(ex, sources[d][1], model, metadata, interactions, normalize)
            coverage.update(info)
            results.append((row, pool, pick))
    return results, dict(coverage)


def shuffled(records, metadata, interactions):
    """Same-set/mode/pick control; baseline offset remains the actual context."""
    buckets = defaultdict(list)
    for record in records:
        buckets[record[2]].append(record)
    result = []
    for bucket in buckets.values():
        bucket.sort(key=lambda r: hashlib.sha256(('pool-control-v1:'+r[0].source).encode()).hexdigest())
        if len({r[0].source for r in bucket}) < 2:
            continue
        for i, (row, _, _) in enumerate(bucket):
            j = (i+1) % len(bucket)
            while bucket[j][0].source == row.source:
                j = (j+1) % len(bucket)
            features, _ = extract(bucket[j][1], row.candidates, row.support, metadata, interactions)
            result.append(Choice(row.source,row.event_time,row.candidates,row.support,features,row.chosen))
    return result


def fit_arms(train, validation, control, has_synergy):
    zero = (0.,)*len(FEATURES)
    report = {'baseline': {'beta': zero, 'validation': evaluate(validation, zero)}}
    if control:
        report['baseline']['ordinary_validation'] = evaluate(control, zero)
    for arm in ARMS:
        if arm == 'baseline' or (not has_synergy and arm in ('synergy', 'combined')):
            continue
        candidates = []
        for penalty in PENALTIES:
            beta, info = fit(train, arm, penalty, max_iter=1000, tol=1e-6)
            if info['converged']:
                metric = evaluate(validation, beta)
                candidates.append((metric['raw_log_loss'], -penalty, beta, info, metric))
        if not candidates:
            raise RuntimeError(f'no converged {arm} fit')
        _, negative, beta, info, metric = min(candidates, key=lambda x: x[:2])
        report[arm] = {'beta': beta, 'penalty': -negative, 'optimizer': info, 'validation': metric}
        if control:
            report[arm]['ordinary_validation'] = evaluate(control, beta)
    return report


def run(manifest):
    # Use the very same v6 model-building implementation as the frozen v6
    # evaluation, not an approximation of its card strength or pair weights.
    from assess_v6_colour_model import build_models
    from model_training import V6_MODEL
    from build_replays import (candidate_columns, pool_columns, parse_example,
        parse_rate_bucket, parse_games_lower_bound, quantile_cutoff, normalize_probabilities)
    m, windows, files = load_manifest(manifest)
    metadata = read_json(files['metadata'])
    interactions = load_interactions(files['interactions'], metadata)
    sources, invalid = scan_drafts(files['draft'], windows, parse_rate_bucket, parse_games_lower_bound)
    linked, crossed = scan_baseline_games(files['games'], sources, windows['baseline'][1])
    strong, control, cutoff = select_sources(sources, crossed, quantile_cutoff)
    grouped, skipped = read_picks(files['draft'], strong | control, parse_example, candidate_columns, pool_columns)
    base = {d: xs for d, xs in grouped.items() if d in strong and strong[d][0] == 'baseline'}
    if not base or not (set(base) & set(linked)):
        raise ValueError('no baseline picks or no linked game evidence')
    # Reject missing qualifying baseline drafts instead of silently dropping
    # them. No cap on the allowed v6 cohort.
    expected = {d for d,v in strong.items() if v[0] == 'baseline'}
    if expected != set(base):
        raise ValueError('qualified baseline draft lacks usable picks')
    models, coverage, baseline_picks = build_models(BaselineView(m['set'], base), files['games'], sorted(base))
    model = models[V6_MODEL]
    pack_min = min(x.raw_pack_number for xs in base.values() for x in xs)
    pick_min = min(x.raw_pick_number for xs in base.values() for x in xs)
    if pack_min not in (0,1) or pick_min not in (0,1):
        raise ValueError('cannot infer archive pick numbering')
    offsets = (1-pack_min, 1-pick_min)
    partitions = {}
    for phase, eligible in [('residual', strong), ('validation', strong), ('ordinary_validation', control)]:
        which = 'validation' if phase == 'ordinary_validation' else phase
        subset = {d: xs for d, xs in grouped.items() if d in eligible and eligible[d][0] == which}
        records, info = served(subset, eligible, model, metadata, interactions, normalize_probabilities, *offsets)
        partitions[phase] = (records, info)
    train, validation, ordinary = ([r[0] for r in partitions[p][0]] for p in ('residual','validation','ordinary_validation'))
    if not train or not validation:
        raise ValueError('empty residual-fit or validation cohort')
    if set(base) & {r.source for r in train+validation+ordinary} or {r.source for r in train} & {r.source for r in validation+ordinary}:
        raise AssertionError('source leakage')
    has_synergy = bool(interactions) and any(f[6] or f[7] for r in train for f in r.features)
    arms = fit_arms(train, validation, ordinary, has_synergy)
    # Matched subset control: report real and shuffled on the exact same rows,
    # in addition to the main development results. Require converged models.
    train_sh = shuffled(partitions['residual'][0], metadata, interactions)
    val_sh = shuffled(partitions['validation'][0], metadata, interactions)
    placebo = None
    if train_sh and val_sh:
        arm = 'combined' if has_synergy else 'opportunity'
        selected = arms[arm]
        beta, opt = fit(train_sh, arm, selected['penalty'], max_iter=1000, tol=1e-6)
        if not opt['converged']:
            raise RuntimeError('shuffled-pool fit failed to converge')
        ids = {(r.source,r.event_time,r.candidates,r.chosen) for r in val_sh}
        matched = [r for r in validation if (r.source,r.event_time,r.candidates,r.chosen) in ids]
        if len(matched) != len(val_sh):
            raise AssertionError('placebo alignment failure')
        placebo = {'arm':arm, 'matched_decisions':len(matched), 'baseline':evaluate(matched,(0.,)*len(FEATURES)),
                   'real':evaluate(matched,tuple(selected['beta'])), 'shuffled':evaluate(val_sh,beta)}
    return {'status':'development_only', 'set':m['set'], 'mode':m['mode'], 'manifest_sha256':sha256(manifest),
            'sources':{k:{'origin':m['sources'][k]['origin'],'sha256':m['sources'][k]['sha256']} for k in files},
            'windows':m['windows'], 'baseline_model':V6_MODEL, 'cutoff':cutoff, 'baseline_drafts':len(base),
            'baseline_picks':baseline_picks, 'baseline_linked_drafts':len(set(base)&set(linked)),
            'baseline_colour_coverage':coverage[V6_MODEL], 'purged_game_crossings':len(crossed),
            'inconsistent_drafts':invalid, 'skipped_pick_rows':dict(skipped), 'feature_names':FEATURES,
            'synergy_verified_edges':len(interactions), 'synergy_active':has_synergy,
            'partitions':{p:{'decisions':len(r),'drafts':len({x[0].source for x in r}),'coverage':c} for p,(r,c) in partitions.items()},
            'arms':arms, 'shuffled_control':placebo, 'final_assessment':'locked', 'independent_quality':'not_evaluated'}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    root = Path(__file__).resolve().parents[1]
    if not args.output.resolve().is_relative_to(root / 'artifacts'):
        p.error('write reports under ignored artifacts/ only')
    report = run(args.manifest)
    report['code_sha256'] = {n:sha256(Path(__file__).parent / n) for n in (
        'pool_aware_archive.py','pool_aware_features.py','pool_aware_refit.py','assess_v6_colour_model.py',
        'build_replays.py','deck_fit.py','eval_model.py','model_training.py')}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False)+'\n', encoding='utf8')
    print('Wrote development-only aggregate report; final assessment and quality remain locked.')


if __name__ == '__main__':
    main()
