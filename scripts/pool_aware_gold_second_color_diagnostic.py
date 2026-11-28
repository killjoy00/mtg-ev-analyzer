#!/usr/bin/env python3
"""Issue #1863: predeclared, residual-only second-color diagnostic.

Only aggregate sufficient statistics and bootstrap draws leave the runner.
No feature changes, no validation choice labels, no production access.
"""
from collections import Counter, defaultdict
from pathlib import Path
import argparse
import hashlib
import json
import numpy as np

import pool_aware_mana_final as mana
import pool_aware_mana_parser_v2 as v2
import pool_aware_skill_final_correction as final
import pool_aware_skill_expansion as exp
import pool_aware_skill_contrast as skill
import pool_aware_skill_reviewed_validation as reviewed
import pool_aware_v7_refit as refit
from pool_aware_archive import read_json, sha256
from pool_aware_refit import weights

PROTOCOL = 'gold-second-color-residual-v1'
DRAWS = 400
STRATA = ('k1', 'k1_gold_MX', 'k1_mono_X', 'k1_other_multicolor', 'k2', 'k3plus')
CLASSES = ('single-X', 'multi-X')
CELLS = tuple((s, c) for s in STRATA for c in CLASSES)
INDEX = {k: i for i, k in enumerate(CELLS)}
COHORTS = ('elite', 'control')
# Each vector is offers, distinct decisions, observed choices, v6 E, final E.
WIDTH = 5
COLORS = v2.COLORS


def seed(sid):
    # Exact existing outcome-study per-format seed construction.
    return int.from_bytes(hashlib.sha256((exp.PROTOCOL + '|' + sid).encode()).digest()[:8], 'big')


def strata_offers(pool, candidates, rules_v2, rules_final):
    prior = [rules_v2.get(n) for n in pool]
    mandatory = [set(v2.requirements(c.mandatory)) for c in prior]
    demand = Counter(c for req in mandatory for c in req)
    if not demand:
        return []
    ranked = demand.most_common()
    if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
        return []
    main = ranked[0][0]
    # Use existing final source recognition/prerequisites. Count positive
    # recognized sources once per drafted card and color, not weighted pips.
    fp = [rules_final.get(n) for n in pool]
    fd = Counter(c for card in fp for c in v2.requirements(card.mandatory))
    direct_rows = [mana.per_card_evidence(c, lambda c, n: 0., land_only=True) for c in fp]
    direct = Counter()
    for r in direct_rows:
        direct.update(r)
    recognized = []
    for card, own in zip(fp, direct_rows):
        req = set(v2.requirements(card.mandatory))
        def base(c, n):
            if c in COLORS and fd[c] - int(c in req) > 0:
                return 1.
            other = max(0., direct[c] - own.get(c, 0.))
            return other / (other + n) if other else 0.
        recognized.append(mana.per_card_evidence(card, base))
    counts = mana.source_counts(fp, fd)
    def access(c, n):
        if c in COLORS and fd[c]:
            return 1.
        return counts[c] / (counts[c] + n) if counts[c] else 0.
    def route_key(r):
        return (sum(n * (1 - access(c, n)) for c, n in zip(mana.SYMBOLS, r) if n),
                sum(1 - access(c, n) for c, n in zip(mana.SYMBOLS, r) if n),
                r[7], r[8], r[9], r)
    output = []
    for x in COLORS:
        if x == main or not demand[x]:
            continue
        # A card with both a mandatory X pip and a source route for X is
        # one piece of evidence, not two. Multiple drafted copies count separately.
        evidence = [i for i, (req, sources) in enumerate(zip(mandatory, recognized))
                    if x in req or sources.get(x, 0.) > 0.]
        k = len(evidence)
        if not k:
            raise AssertionError('second color missing evidence')
        keys = ['k1' if k == 1 else 'k2' if k == 2 else 'k3plus']
        if k == 1:
            req = mandatory[evidence[0]]
            spell = prior[evidence[0]]
            mono = req == {x} and all(
                not n or c == x for route in spell.routes for c, n in zip(COLORS, route))
            keys.append('k1_gold_MX' if main in req else
                        'k1_mono_X' if mono else 'k1_other_multicolor')
        allowed = {main, x}
        for i, name in enumerate(candidates):
            card = rules_v2.get(name)
            if card.status != 'readable' or not card.routes:
                continue
            # All routes must require X and use only M/X and generic, with no C/S/life
            # requirement. Variable generic mana is allowed.
            if any(not r[COLORS.index(x)] or r[7] or
                   any(n and c not in allowed for c, n in zip(mana.SYMBOLS, r))
                   for r in card.routes):
                continue
            best = min(card.routes, key=route_key)
            n = best[COLORS.index(x)]
            if n:
                cls = 'single-X' if n == 1 else 'multi-X'
                output.extend((INDEX[s, cls], i) for s in keys)
    return output


def cohort(sid, records, metadata, fit):
    rules_v2, rules_final = v2.index(metadata), mana.index(metadata)
    context, cards = final.parameters(fit)
    by_draft = defaultdict(lambda: np.zeros((len(CELLS), WIDTH)))
    decisions = 0
    for row, pool, pick in records:
        if not 4 <= pick <= (11 if sid == 'powered-cube' else 10):
            continue
        total = by_draft[row.source]
        decisions += 1
        offered = strata_offers(pool, row.candidates, rules_v2, rules_final)
        if not offered:
            continue
        p6 = weights(row, skill.ZERO)
        p7 = weights(final.apply(row, pool, rules_final, context, cards), skill.APPLY)
        if not np.isclose(sum(p6), 1.) or not np.isclose(sum(p7), 1.):
            raise ValueError('pack probabilities not normalized')
        seen = set()
        for cell, i in offered:
            if (cell, i) in seen:
                raise ValueError('duplicate offer in stratum')
            seen.add((cell, i))
            total[cell] += (1, 0, int(i == row.chosen), p6[i], p7[i])
        for cell in {c for c, _ in seen}:
            total[cell, 1] += 1
    if not by_draft:
        raise ValueError('empty residual diagnostic cohort')
    a = np.stack([by_draft[d] for d in sorted(by_draft)])
    n = len(a)
    # Joint draws across all cells/models preserve covariance for the gap.
    # Include zero-offer eligible drafts and retain each draft's full cluster.
    rng = np.random.default_rng(seed(sid))
    flat = a.reshape(n, -1)
    boot = np.empty((DRAWS, flat.shape[1]))
    for j in range(DRAWS):
        counts = np.bincount(rng.integers(0, n, size=n), minlength=n)
        boot[j] = counts @ flat
    return {'drafts': n, 'decisions': decisions, 'totals': a.sum(axis=0).tolist(),
            'bootstrap': boot.reshape(DRAWS, len(CELLS), WIDTH).tolist()}


def ratio(o, e):
    return float(o / e) if e > 0 else None


def ci(samples):
    valid = [x for x in samples if x is not None]
    return {'interval': np.percentile(valid, [2.5, 97.5]).tolist() if len(valid) >= 360 else None,
            'valid_draws': len(valid)}


def summarize(total, boot):
    result = {}
    for i, (stratum, cls) in enumerate(CELLS):
        t = total[i]
        cell = {'offers': int(t[0]), 'decisions': int(t[1]), 'O': int(t[2])}
        for label, j in [('v6', 3), ('final', 4)]:
            cell[label] = {'E': float(t[j]), 'O/E': ratio(t[2], t[j]),
                           **ci([ratio(b[i, 2], b[i, j]) for b in boot])}
        result[stratum + '/' + cls] = cell
    lo, hi = INDEX['k1', 'multi-X'], INDEX['k3plus', 'multi-X']
    gap = {}
    for label, j in [('v6', 3), ('final', 4)]:
        def diff(a):
            x, y = ratio(a[lo, 2], a[lo, j]), ratio(a[hi, 2], a[hi, j])
            return y - x if x is not None and y is not None else None
        gap[label] = {'difference': diff(total), **ci([diff(b) for b in boot])}
    return {'cells': result, 'multi_X_k3plus_minus_k1': gap}


def measure(sid, folder, output):
    prior = reviewed.frozen_prior(folder, sid)
    elite, ordinary, metadata, _, prov, _, _, _ = refit.prepare(
        sid, exp.directory(sid) / 'manifest.json', prior, 'residual')
    if prov['phase'] != 'residual':
        raise ValueError('diagnostic must use residual choices only')
    for name, rows in [('elite', elite), ('control', ordinary)]:
        if len(rows) != prior['fit'][name]['decisions']:
            raise ValueError('frozen residual cohort parity failure: ' + name)
    evidence = ((prior['provenance'].get('recovery') or {}).get('chronology') or {}).get(
        'classification', 'strict_game_time')
    if evidence not in ('strict_game_time', 'source_draft_disjoint_only'):
        raise ValueError('unknown chronology classification')
    result = {'protocol': PROTOCOL, 'set': sid, 'evidence_class': evidence,
              'phase': 'residual', 'draws': DRAWS, 'seed': seed(sid),
              'parser_sha256': sha256(Path(mana.__file__)),
              'diagnostic_sha256': sha256(Path(__file__)),
              'provenance': prov, 'cohorts': {}}
    for name, records in [('elite', elite), ('control', ordinary)]:
        bank = cohort(sid, records, metadata, prior['fit'])
        bank['table'] = summarize(np.array(bank['totals']), np.array(bank['bootstrap']))
        result['cohorts'][name] = bank
    exp.write(output, result)
    print(json.dumps({'set': sid, 'phase': 'residual', 'cohorts': {
        name: {k: r[k] for k in ('drafts', 'decisions', 'table')}
        for name, r in result['cohorts'].items()}}, allow_nan=False), flush=True)


def pooled(reports):
    out = {}
    for name in COHORTS:
        banks = [r['cohorts'][name] for r in reports]
        totals = np.sum([r['totals'] for r in banks], axis=0)
        boot = np.sum([r['bootstrap'] for r in banks], axis=0)
        out[name] = {'drafts': sum(r['drafts'] for r in banks),
                     'decisions': sum(r['decisions'] for r in banks),
                     **summarize(totals, boot)}
    return out


def decide(table):
    cell = table['cells']['k1/multi-X']
    q = cell['final']
    gap = table['multi_X_k3plus_minus_k1']['final']
    c1 = cell['offers'] >= 500
    c2 = (q['O/E'] is not None and q['O/E'] < .90 and
          q['interval'] is not None and q['interval'][1] < 1.)
    c3 = (gap['difference'] is not None and gap['difference'] >= .10 and
          gap['interval'] is not None and (gap['interval'][0] > 0 or gap['interval'][1] < 0))
    return {'adopt': bool(c1 and c2 and c3), 'criteria': {
        '1_offers_at_least_500': {'value': cell['offers'], 'pass': bool(c1)},
        '2_OE_below_0.90_and_upper_below_1': {'value': q, 'pass': bool(c2)},
        '3_gap_at_least_0.10_and_interval_excludes_0': {'value': gap, 'pass': bool(c3)}}}


def markdown(result):
    def fmt(n):
        return 'NA' if n is None else f'{n:.5f}'
    def interval(c):
        return 'NA' if c['interval'] is None else '[' + ', '.join(fmt(x) for x in c['interval']) + ']'
    lines = ['# Gold-card second-color diagnostic (residual only)', '',
             'Decision: ' + ('ADOPT' if result['decision']['adopt'] else 'NO CHANGE (null finding)'),
             '', 'Predeclared criteria: ' + json.dumps(result['decision']['criteria']), '',
             'All intervals are paired whole-draft percentile bootstrap (400 draws).',
             'Pooled Strict and Legacy exclude Powered Cube, which is shown separately. Counts are offer/decision weighted.']
    for scope, cohorts in result['tables'].items():
        for name, table in cohorts.items():
            lines += ['', f'## {scope} — {name} ({table["drafts"]} drafts, {table["decisions"]} eligible decisions)', '',
                      '| Stratum/class | Offers | Decisions | O | v6 E | v6 O/E (95% CI) | Final E | Final O/E (95% CI) |',
                      '|---|---:|---:|---:|---:|---|---:|---|']
            for cell, r in table['cells'].items():
                v, f = r['v6'], r['final']
                lines.append(f'| {cell} | {r["offers"]} | {r["decisions"]} | {r["O"]} | {fmt(v["E"])} | {fmt(v["O/E"])} {interval(v)} | {fmt(f["E"])} | {fmt(f["O/E"])} {interval(f)} |')
            lines.append('Multi-X k3plus minus k1: ' + json.dumps(table['multi_X_k3plus_minus_k1']))
    return '\n'.join(lines) + '\n'


def aggregate(folder, output, summary):
    reports = {}
    for path in sorted(folder.rglob('gold-diagnostic.json')):
        r = read_json(path)
        sid = r['set']
        if (sid in reports or sid not in exp.SETS or r['protocol'] != PROTOCOL or
            r['phase'] != 'residual' or r['draws'] != DRAWS or r['seed'] != seed(sid) or
            r['parser_sha256'] != sha256(Path(mana.__file__)) or
            r['diagnostic_sha256'] != sha256(Path(__file__))):
            raise ValueError('diagnostic artifact identity mismatch: ' + sid)
        reports[sid] = r
    if set(reports) != set(exp.SETS):
        raise ValueError('missing formats: ' + str(sorted(set(exp.SETS) - set(reports))))
    groups = {'Strict': [], 'Legacy': [], 'Powered Cube': ['powered-cube']}
    for sid, r in sorted(reports.items()):
        if sid != 'powered-cube':
            groups['Strict' if r['evidence_class'] == 'strict_game_time' else 'Legacy'].append(sid)
    tables = {k: pooled([reports[s] for s in ids]) for k, ids in groups.items()}
    tables.update({sid: pooled([r]) for sid, r in sorted(reports.items())})
    result = {'protocol': PROTOCOL, 'phase': 'residual', 'draws': DRAWS,
              'cohort': 'elite primary; control secondary', 'groups': groups,
              'tables': tables, 'decision': decide(tables['Strict']['elite'])}
    exp.write(output, result)
    summary.parent.mkdir(parents=True, exist_ok=True)
    summary.write_text(markdown(result), encoding='utf8')
    print(json.dumps({'groups': groups, 'decision': result['decision']}, indent=2), flush=True)


def self_test():
    def spell(cost):
        return {'layout': 'normal', 'type_line': 'Creature', 'mana_cost': cost, 'oracle_text': ''}
    m = {'w': spell('{W}'), 'wu': spell('{W}{U}'), 'u': spell('{3}{U}'),
         'uu': spell('{2}{U}{U}'), 'h': spell('{W/U}'), 'b': spell('{B}'),
         'tri': spell('{W}{U}{B}'), 'fetch': {'layout': 'normal', 'type_line': 'Land',
         'oracle_text': '{T}: Add {U}.'}}
    v, f = v2.index(m), mana.index(m)
    candidates = ('u', 'uu', 'h', 'b', 'tri')
    def check(pool):
        return {(CELLS[c], candidates[i]) for c, i in strata_offers(pool, candidates, v, f)}
    q = check(('w',)*5 + ('wu',))
    assert q == {(('k1', 'single-X'), 'u'), (('k1', 'multi-X'), 'uu'),
                 (('k1_gold_MX', 'single-X'), 'u'), (('k1_gold_MX', 'multi-X'), 'uu')}
    assert (('k1_mono_X', 'multi-X'), 'uu') in check(('w',)*5 + ('u',))
    assert (('k2', 'multi-X'), 'uu') in check(('w',)*5 + ('wu', 'fetch'))
    assert not check(('w',)*5 + ('h',))
    assert not check(('w', 'u'))
    assert (('k3plus', 'multi-X'), 'uu') in check(('w',)*5 + ('u',)*3)
    total = np.zeros((len(CELLS), WIDTH))
    total[INDEX['k1', 'multi-X']] = (500, 400, 70, 100, 100)
    total[INDEX['k3plus', 'multi-X']] = (500, 400, 90, 100, 100)
    boot = np.stack([total]*DRAWS)
    assert decide(summarize(total, boot))['adopt']
    total[INDEX['k1', 'multi-X'], 0] = 499
    assert not decide(summarize(total, boot))['adopt']
    total[INDEX['k1', 'multi-X']] = (500, 400, 90, 100, 100)
    assert not decide(summarize(total, boot))['adopt']
    print('Gold second-color strata, route, threshold and paired bootstrap contracts passed.')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test', action='store_true')
    p.add_argument('--set', choices=sorted(exp.SETS))
    p.add_argument('--prior', type=Path)
    p.add_argument('--output', type=Path)
    p.add_argument('--aggregate', type=Path)
    p.add_argument('--summary', type=Path)
    a = p.parse_args()
    if a.self_test:
        self_test()
    elif a.aggregate:
        aggregate(a.aggregate, a.output, a.summary)
    elif a.set:
        measure(a.set, a.prior, a.output)
    else:
        p.error('stage required')


if __name__ == '__main__':
    main()
