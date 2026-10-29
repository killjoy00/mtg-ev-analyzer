#!/usr/bin/env python3
"""Pool per-set v6 assessments into the preregistered decision.

Reads every per-set report and its ignored per-draft delta file, runs one
cluster bootstrap over drafts from all sets together, and writes an
aggregate-only summary. Preregistration: research/V6-COLOUR-MODEL.md.
"""
from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path
import random

from eval_model import _interval, daily_weights
from model_training import V5_MODEL, V6_MODEL

SEED = 20260915


def pooled_bootstrap(cells, draws=2000, seed=SEED):
    """Cluster bootstrap over drafts from every set at once.

    cells: per-draft [loss delta sum, brier delta sum, hit delta sum, decisions].
    Same resampling and interval rule as the harness's paired_bootstrap,
    without its per-pick rows. Pure Python: CI has no NumPy.
    """
    columns = [list(column) for column in zip(*cells)]
    counts = columns[3]
    names = ('log_loss', 'brier', 'top1')
    rng = random.Random(seed)
    population = range(len(cells))
    samples = [[], [], []]
    for _ in range(draws):
        drawn = rng.choices(population, k=len(cells))
        total = sum(map(counts.__getitem__, drawn))
        for k in range(3):
            samples[k].append(sum(map(columns[k].__getitem__, drawn)) / total)
    decisions = sum(counts)
    return {'drafts': len(cells), 'decisions': int(decisions),
            **{f'{n}_delta': round(sum(columns[k]) / decisions, 6) for k, n in enumerate(names)},
            **{f'{n}_ci95': _interval(samples[k]) for k, n in enumerate(names)}}


def verdict(pooled):
    if pooled['log_loss_ci95'][1] < 0 and not pooled['top1_ci95'][1] < 0:
        return 'v6 passes'
    return 'v6 does not pass'


def best_temperature(reports, model):
    totals = {}
    for report in reports:
        losses = report['arms'][model]['validation_calibration']['summed_log_loss']
        for temperature, value in losses.items():
            totals[temperature] = totals.get(temperature, 0.0) + value
    decisions = sum(r['arms'][model]['validation_calibration']['decisions'] for r in reports)
    best = min(totals, key=lambda t: (totals[t], float(t)))
    return {'exponent': float(best), 'mean_log_loss': round(totals[best] / decisions, 6),
            'mean_log_loss_at_1_75': round(totals['1.75'] / decisions, 6), 'decisions': decisions}


def summarize(reports, deltas):
    if sorted(r['set'] for r in reports) != sorted(d['set'] for d in deltas):
        raise ValueError('Every per-set report needs its per-draft deltas')
    cells = [cell for d in deltas for cell in d['drafts'].values()]
    for report in reports:
        mine = next(d for d in deltas if d['set'] == report['set'])
        if sum(c[3] for c in mine['drafts'].values()) != report['arms'][V5_MODEL]['served_slice']['decisions']:
            raise ValueError(f"{report['set']}: per-draft deltas do not match the report")
    pooled = pooled_bootstrap(cells)
    weights = daily_weights()
    weighted = [(weights[r['set']], r['v6_minus_v5']['log_loss_delta']) for r in reports if r['set'] in weights]
    return {
        'model_versions': [V5_MODEL, V6_MODEL], 'split': reports[0]['split'],
        'sets': sorted(r['set'] for r in reports), 'pooled_v6_minus_v5': pooled, 'verdict': verdict(pooled),
        'daily_weighted_log_loss_delta': round(sum(w * d for w, d in weighted) / sum(w for w, _ in weighted), 6),
        'sets_with_log_loss_ci_below_zero': sum(r['v6_minus_v5']['log_loss_ci95'][1] < 0 for r in reports),
        'sets_with_log_loss_ci_above_zero': sum(r['v6_minus_v5']['log_loss_ci95'][0] > 0 for r in reports),
        'sets_with_top1_ci_below_zero': sum(r['v6_minus_v5']['top1_ci95'][1] < 0 for r in reports),
        'validation_display_exponent': {m: best_temperature(reports, m) for m in (V5_MODEL, V6_MODEL)},
        'per_set': {r['set']: r for r in sorted(reports, key=lambda r: r['set'])},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reports', type=Path, required=True, help='directory of per-set reports')
    parser.add_argument('--deltas', type=Path, required=True, help='directory of ignored per-draft delta files')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    reports = [json.loads(p.read_text()) for p in sorted(args.reports.glob('*.json'))]
    deltas = [json.load(gzip.open(p, 'rt', encoding='utf-8')) for p in sorted(args.deltas.glob('*.json.gz'))]
    result = summarize(reports, deltas)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: result[k] for k in ('verdict', 'pooled_v6_minus_v5', 'daily_weighted_log_loss_delta')}, indent=2))


if __name__ == '__main__':
    main()
