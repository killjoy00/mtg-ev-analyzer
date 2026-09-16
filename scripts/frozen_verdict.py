#!/usr/bin/env python3
"""Validate Decision 1 and apply its original frozen pass rule.

This checks the archived specification, including its documented defects;
it is not an approval gate for a subsequently changed model.
"""
import json
import math
import sys
from pathlib import Path

RESERVE = ['ecl', 'fin', 'ktk', 'mom', 'powered-cube', 'woe']
CAND, BASE = 'v3-colour-and-pair', 'v2'


def verdict(rep):
    if rep.get('evaluated_split') != 'test' or rep.get('bootstrap_draws') != 2000:
        raise ValueError('Expected the frozen test split with 2000 bootstrap draws')
    runs = {}
    for r in rep['runs']:
        name, sid = r['variant']['name'], r['set_id']
        if sid not in RESERVE or name not in (BASE, CAND) or (sid, name) in runs:
            raise ValueError('Unexpected or duplicate model/set run')
        v = r['variant']
        if (r['cap'] != 5000 or v['temperature'] != 1 or v['pair_min_seen'] != 8 or
                v['pair_prior_strength'] != 24 or v['context_strength'] != .75 or
                v['fit_strength'] != .75):
            raise ValueError('Run does not match the frozen constants')
        if name == CAND and not (v['stage_matched'] and v['deck_fit'] and
                                v['fit_stage_matched'] and not v['card_specific_fit']):
            raise ValueError('Candidate does not match the frozen model')
        s = r['served_slice']
        if s['n'] < 1 or not math.isfinite(s['log_loss']) or not 0 <= s['top1_accuracy'] <= 1:
            raise ValueError('Invalid served metrics')
        runs[(sid, name)] = r
    if set(runs) != {(sid, name) for sid in RESERVE for name in (BASE, CAND)}:
        raise ValueError('Incomplete reserve: need both models on every declared set')
    for sid in RESERVE:
        a, b = runs[(sid, BASE)], runs[(sid, CAND)]
        if a['served_slice']['n'] != b['served_slice']['n'] or a['test_drafts'] != b['test_drafts']:
            raise ValueError('Models evaluated different decision or draft counts')
    comparisons, regressions = {}, []
    for c in rep['comparisons']:
        if not c['slice'].startswith('served'):
            continue
        sid = c['set_id']
        expected_slice = f"served (pack 1, picks 1-{'11' if sid == 'powered-cube' else '10'})"
        if (sid not in RESERVE or sid in comparisons or c['baseline'] != BASE+'@5000' or
                c['candidate'] != CAND+'@5000' or c['slice'] != expected_slice):
            raise ValueError('Unexpected, duplicate or mismatched paired comparison')
        p = c['paired']
        if p['drafts'] != runs[(sid, BASE)]['test_drafts']:
            raise ValueError('Paired comparison draft count does not match runs')
        for metric, summary in [('log_loss','log_loss'),('top1','top1_accuracy')]:
            lo, hi = p[metric+'_ci95']
            delta = p[metric+'_delta']
            observed = runs[(sid, CAND)]['served_slice'][summary]-runs[(sid, BASE)]['served_slice'][summary]
            if not all(math.isfinite(x) for x in (lo,hi,delta)) or lo > hi or abs(delta-observed) > 2e-5:
                raise ValueError('Invalid or inconsistent paired metrics')
        if p['log_loss_ci95'][0] > 0:
            regressions.append(f'{sid}: log loss worse, separated')
        if p['top1_ci95'][1] < 0:
            regressions.append(f'{sid}: top-1 worse, separated')
        comparisons[sid] = p
    if set(comparisons) != set(RESERVE):
        raise ValueError('Missing served paired comparison for a reserve set')
    pooled = {}
    for name in (BASE, CAND):
        rows = [runs[(sid,name)]['served_slice'] for sid in RESERVE]
        n = sum(r['n'] for r in rows)
        pooled[name] = dict(n=n, log_loss=sum(r['log_loss']*r['n'] for r in rows)/n,
                            top1_accuracy=sum(r['top1_accuracy']*r['n'] for r in rows)/n)
    dll = pooled[CAND]['log_loss']-pooled[BASE]['log_loss']
    dt1 = pooled[CAND]['top1_accuracy']-pooled[BASE]['top1_accuracy']
    return dict(passed=dll < 0 and dt1 > 0 and not regressions, pooled=pooled,
                log_loss_delta=dll, top1_delta=dt1, per_set=comparisons, regressions=regressions)


def main(argv=None):
    paths = sys.argv[1:] if argv is None else argv
    if len(paths) != 1:
        print('usage: frozen_verdict.py RESULT.json',file=sys.stderr)
        return 2
    try:
        result = verdict(json.loads(Path(paths[0]).read_text()))
    except (ValueError,KeyError,TypeError,OSError) as exc:
        print(f'INVALID FROZEN ARTIFACT: {exc}',file=sys.stderr)
        return 2
    print('FROZEN TEST '+('PASS' if result['passed'] else 'FAIL'))
    print('Archived Decision 1 specification; not clearance for a changed model.')
    print(json.dumps(result,indent=2))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
