#!/usr/bin/env python3
"""Final-cycle second-color diagnostic; original diagnostic functions unchanged.

Trigger sees ONLY the last 30% of residual source drafts. The unchanged
reference recipe is refitted on the first 70%; no original validation choices
are opened. No feature changes, production access, or row-level exports.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pool_aware_gold_second_color_diagnostic as gold
import pool_aware_skill_expansion as exp
import pool_aware_skill_reviewed_validation as reviewed
import pool_aware_v7_refit as refit
from pool_aware_archive import read_json, sha256
import pool_aware_v7_shared_split as shared

PROTOCOL = 'v7-final-second-color-residual-holdout-v2'
REGISTRY = 'ba978db88bb5b569a100cfbc53103a697e2ee0a496b1ec9a9c2fcba1f90a6bdc'
KEYS = ('sources', 'windows', 'purge_days', 'baseline_cutoff', 'baseline_picks',
        'baseline_drafts', 'baseline_colour_coverage', 'recovery')


def measure(sid, phase, prior_dir, registry_dir, output):
    if phase != 'residual':
        raise ValueError('original validation forbidden in design workflow')
    prior = reviewed.frozen_prior(prior_dir, sid)
    fits = refit.load_fits(registry_dir)
    if reviewed.registry_digest(fits) != REGISTRY:
        raise ValueError('not the exact reviewed contrast refit registry')
    fit = refit.check_fit(fits[sid], sid, prior)
    elite, ordinary, metadata, _, prov, _, _, _ = refit.prepare(
        sid, exp.directory(sid) / 'manifest.json', prior, phase)
    if prov['phase'] != phase or any(prov[k] != fit['provenance'][k] for k in KEYS):
        raise ValueError('window or fit provenance mismatch')
    if phase == 'residual':
        for name, rows in [('elite', elite), ('control', ordinary)]:
            if len(rows) != prior['fit'][name]['decisions'] or len(rows) != fit['fit'][name]['decisions']:
                raise ValueError('residual cohort parity failure: ' + name)
    train, holdout, split = shared.split(elite, ordinary)
    training_fit = refit.fit_rows(train['elite'], train['control'], metadata)
    for name in shared.COHORTS:
        if (not training_fit[name]['converged'] or
                training_fit[name]['decisions'] != len(train[name])):
            raise ValueError('training-only fit parity failure: ' + name)
    evidence = ((prior['provenance'].get('recovery') or {}).get('chronology') or {}).get(
        'classification', 'strict_game_time')
    if evidence not in ('strict_game_time', 'source_draft_disjoint_only'):
        raise ValueError('unknown chronology classification')
    result = {'protocol': PROTOCOL, 'set': sid, 'phase': phase, 'evaluation_partition': 'last_30_percent', 'evidence_class': evidence,
              'split_protocol': shared.SPLIT_PROTOCOL, 'split_sha256': sha256(Path(shared.__file__)),
              'split': split, 'training_decisions': {c: len(train[c]) for c in shared.COHORTS},
              'holdout_decisions': {c: len(holdout[c]) for c in shared.COHORTS},
              'draws': gold.DRAWS, 'seed': gold.seed(sid), 'registry_sha256': REGISTRY,
              'diagnostic_sha256': sha256(Path(gold.__file__)),
              'wrapper_sha256': sha256(Path(__file__)),
              'fit_sha256': hashlib.sha256(json.dumps(training_fit, sort_keys=True, separators=(',', ':'),
                                                      allow_nan=False).encode()).hexdigest(),
              'provenance': prov, 'cohorts': {}}
    for name, records in holdout.items():
        bank = gold.cohort(sid, records, metadata, training_fit)
        bank['table'] = gold.summarize(np.array(bank['totals']), np.array(bank['bootstrap']))
        result['cohorts'][name] = bank
    exp.write(output, result)
    print(json.dumps({'set': sid, 'phase': phase, 'cohorts': {
        name: {k: bank[k] for k in ('drafts', 'decisions', 'table')}
        for name, bank in result['cohorts'].items()}}, allow_nan=False), flush=True)


def trigger(cells):
    a2 = cells['k2/single-X']['final']
    a3 = cells['k3plus/single-X']['final']
    b = cells['k1_other_multicolor/single-X']['final']
    values = {'k2_single_X': a2, 'k3plus_single_X': a3, 'k1_other_multicolor_single_X': b}
    if any(x['interval'] is None for x in values.values()):
        return {'status': 'blocked_missing_interval', 'values': values}
    a2_pass, a3_pass = a2['interval'][0] > 1.10, a3['interval'][0] > 1.10
    a = bool(a2_pass and a3_pass)
    bp = bool(b['interval'][1] < .85)
    return {'status': 'decided', 'values': values,
            'A_k2_lower_gt_1_10': bool(a2_pass),
            'A_k3plus_lower_gt_1_10': bool(a3_pass),
            'trigger_A': a, 'trigger_B': bp,
            'action': 'triggered_changes_only' if a or bp else 'retain_current_refit'}


def tables_markdown(result):
    def fmt(v):
        return 'NA' if v is None else f'{v:.5f}'
    def interval(c):
        return 'NA' if c['interval'] is None else '[' + ', '.join(fmt(x) for x in c['interval']) + ']'
    lines = ['# Second-color calibration — training-only reference — ' + result['phase'], '',
             'Original strata, picks 4–10 (Cube 4–11), whole-draft bootstrap 400 draws, original seeds.',
             'Strict and Legacy exclude Powered Cube. All formats and both cohorts included.',
             'Fallback registry SHA-256: ' + REGISTRY,
             'Trigger evaluated on chronological last 30% of residual drafts only; reference fit on first 70%.',
             'Split registry digest: ' + result['split_registry_sha256']]
    if 'trigger' in result:
        lines += ['', 'Residual-only predeclared decision: ' + json.dumps(result['trigger'])]
    else:
        lines += ['', 'Descriptive validation only; no decision or fitting.']
    for scope, cohorts in result['tables'].items():
        for name, table in cohorts.items():
            lines += ['', f'## {scope} — {name} ({table["drafts"]} drafts, {table["decisions"]} decisions)', '',
                      '| Stratum/class | Offers | Decisions | O | v6 E | v6 O/E (95% CI) | Refit E | Refit O/E (95% CI) |',
                      '|---|---:|---:|---:|---:|---|---:|---|']
            for cell, row in table['cells'].items():
                v, f = row['v6'], row['final']
                lines.append(f'| {cell} | {row["offers"]} | {row["decisions"]} | {row["O"]} | {fmt(v["E"])} | {fmt(v["O/E"])} {interval(v)} | {fmt(f["E"])} | {fmt(f["O/E"])} {interval(f)} |')
            lines.append('Multi-X k3plus minus k1: ' + json.dumps(table['multi_X_k3plus_minus_k1']))
    return '\n'.join(lines) + '\n'


def aggregate(folder, phase, output, summary):
    if phase != 'residual':
        raise ValueError('original validation forbidden in design workflow')
    reports = {}
    for path in sorted(folder.rglob('second-color.json')):
        r = read_json(path)
        sid = r['set']
        if (sid in reports or sid not in exp.SETS or r['protocol'] != PROTOCOL
                or r['phase'] != phase or r['registry_sha256'] != REGISTRY
                or r['evaluation_partition'] != 'last_30_percent'
                or r['split_protocol'] != shared.SPLIT_PROTOCOL
                or r['split_sha256'] != sha256(Path(shared.__file__))
                or r['draws'] != gold.DRAWS or r['seed'] != gold.seed(sid)
                or r['diagnostic_sha256'] != sha256(Path(gold.__file__))
                or r['wrapper_sha256'] != sha256(Path(__file__))):
            raise ValueError('diagnostic identity mismatch: ' + sid)
        reports[sid] = r
    if set(reports) != set(exp.SETS):
        raise ValueError('missing formats: ' + str(sorted(set(exp.SETS) - set(reports))))
    groups = {'Strict': [], 'Legacy': [], 'Powered Cube': ['powered-cube']}
    for sid, r in sorted(reports.items()):
        if sid != 'powered-cube':
            groups['Strict' if r['evidence_class'] == 'strict_game_time' else 'Legacy'].append(sid)
    if len(groups['Strict']) != 22 or len(groups['Legacy']) != 8:
        raise ValueError('reviewed scope mismatch')
    tables = {k: gold.pooled([reports[s] for s in ids]) for k, ids in groups.items()}
    tables.update({sid: gold.pooled([r]) for sid, r in sorted(reports.items())})
    splits = {sid: r['split'] for sid, r in sorted(reports.items())}
    result = {'protocol': PROTOCOL, 'phase': phase, 'evaluation_partition': 'last_30_percent',
              'split_protocol': shared.SPLIT_PROTOCOL, 'split_sha256': sha256(Path(shared.__file__)),
              'splits': splits, 'split_registry_sha256': hashlib.sha256(json.dumps(splits, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
              'draws': gold.DRAWS, 'registry_sha256': REGISTRY,
              'groups': groups, 'tables': tables,
              'fit_sha256': {sid: r['fit_sha256'] for sid, r in sorted(reports.items())}}
    if phase == 'residual':
        result['trigger'] = trigger(tables['Strict']['elite']['cells'])
    exp.write(output, result)
    summary.parent.mkdir(parents=True, exist_ok=True)
    summary.write_text(tables_markdown(result), encoding='utf8')
    print(json.dumps({'phase': phase, 'groups': groups, 'trigger': result.get('trigger')},
                     indent=2, allow_nan=False), flush=True)


def self_test():
    gold.self_test()
    from types import SimpleNamespace
    def row(i, t):
        return (SimpleNamespace(source=str(i), event_time=t), (), 4)
    e = [row(i, t) for i, t in [(1, '01'), (3, '02'), (5, '03'), (7, '04'), (9, '05'), (11, '06')]]
    o = [row(i, t) for i, t in [(2, '01'), (4, '02'), (6, '03'), (8, '04'), (10, '05'), (12, '06')]]
    # Four timestamp groups (8/12) are the closest legal boundary to 70%.
    train, holdout, info = shared.split(e, o)
    assert info['cutoff_inclusive'] == '04' and info['training_drafts'] == 8
    assert all(len(train[c]) == 4 and len(holdout[c]) == 2 for c in shared.COHORTS)
    assert not ({r.source for rs in train.values() for r, _, _ in rs} &
                {r.source for rs in holdout.values() for r, _, _ in rs})
    def c(lo, hi):
        return {'final': {'O/E': (lo + hi) / 2, 'interval': [lo, hi]}}
    cells = {'k2/single-X': c(1.11, 1.3), 'k3plus/single-X': c(1.12, 1.4),
             'k1_other_multicolor/single-X': c(.6, .84)}
    t = trigger(cells)
    assert t['trigger_A'] and t['trigger_B']
    cells['k2/single-X'] = c(1.10, 1.3)
    cells['k1_other_multicolor/single-X'] = c(.6, .85)
    t = trigger(cells)
    assert not t['trigger_A'] and not t['trigger_B']
    cells['k2/single-X']['final']['interval'] = None
    assert trigger(cells)['status'] == 'blocked_missing_interval'
    print('Second-color trigger boundaries and original diagnostic contracts passed.')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test', action='store_true')
    p.add_argument('--phase', choices=['residual'])
    p.add_argument('--set', choices=sorted(exp.SETS))
    p.add_argument('--prior', type=Path)
    p.add_argument('--fits', type=Path)
    p.add_argument('--aggregate', type=Path)
    p.add_argument('--output', type=Path)
    p.add_argument('--summary', type=Path)
    a = p.parse_args()
    if a.self_test:
        self_test()
    elif a.aggregate and a.phase:
        aggregate(a.aggregate, a.phase, a.output, a.summary)
    elif a.set and a.phase:
        measure(a.set, a.phase, a.prior, a.fits, a.output)
    else:
        p.error('stage and phase required')


if __name__ == '__main__':
    main()
