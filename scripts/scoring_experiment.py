#!/usr/bin/env python3
"""Automated grading development: disjoint calibration, selection, assessment.

No human labels, production writes, or final-test selection. The eight-pick
cohort simulation shares product policy helpers, but is not observed gameplay.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import random
import statistics
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

from build_replays import normalize_probabilities
from eval_model import (ROOT, VARIANTS, Cache, Calibration, Accumulator,
                        build_backbone, cache_identity, cap_prefix, file_sha256,
                        fit_temperature, guard_test_split, load_training_fit,
                        paired_bootstrap, pick_metrics, rarity_index, validation_role)
from grading_curve import auc, curve_score, interval, js_round

SCHEMA = 1
MODELS = ['v2', 'v3-colour-and-pair']
EXPONENTS = [0.5, 0.75, 1.0, 1.25, 1.5]
TEMPERATURES = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 3.0]
BASELINE = 'v2|1'
TAIL_LIMIT = 0.01  # at most +1 percentage point under 25, on each measured set
SEED = 20260916


def config_key(model, exponent):
    return f'{model}|{exponent:g}'


def configurations():
    return [(m, e) for m in MODELS for e in EXPONENTS]


def model_signature():
    return {name: file_sha256(ROOT/'scripts'/name) for name in
            ['build_replays.py', 'eval_model.py', 'deck_fit.py']}


def band(probabilities):
    values = sorted(probabilities, reverse=True)
    ratio = js_round(100*values[1]/values[0])
    return 'easy' if ratio < 50 else 'medium' if ratio < 80 else 'hard'


def measure(args):
    guard_test_split(args.split, args.final_test)
    elite = Cache.load(args.elite)
    control = Cache.load(args.control)
    if elite.set_id != control.set_id or set(elite.meta['drafts']) & set(control.meta['drafts']):
        raise ValueError('Elite and control must be disjoint cohorts of the same set')
    if elite.meta.get('cohort') != 'elite' or control.meta.get('cohort') != 'control':
        raise ValueError('Wrong cache cohort labels')
    train_ids = cap_prefix(elite.split_drafts('train'), args.cap)
    # Retain training examples once: both fitting and pair expectations need them.
    from eval_model import train_counts
    counts, training_picks = train_counts(elite, train_ids)
    fit = load_training_fit(args.fit, elite)
    models = {m: build_backbone(elite, train_ids, counts, m, fit) for m in MODELS}
    rarities = rarity_index()
    outcomes = {}
    if args.archive:
        from pick_value import draft_results
        outcomes = draft_results(args.archive)
    records = []
    for cohort, cache in [('elite', elite), ('control', control)]:
        wanted = set(cache.split_drafts(args.split))
        for did, p in cache.examples():
            pack = p.raw_pack_number + cache.meta['pack_offset']
            pick = p.raw_pick_number + cache.meta['pick_offset']
            if did not in wanted or pack != 1 or not 1 <= pick <= (11 if cache.set_id == 'powered-cube' else 10):
                continue
            if len(p.candidates) < 2:
                continue
            # Canonical ties, independent of archive column/card display order.
            cards = sorted(p.candidates)
            probabilities = {}
            for m, model in models.items():
                raw = {c: model.card_tendency(c, p.raw_pack_number, p.raw_pick_number, p.pool) for c in cards}
                norm = normalize_probabilities(raw)
                probabilities[m] = [norm[c] for c in cards]
            records.append(dict(set_id=cache.set_id, cohort=cohort, draft_id=did,
                                role=validation_role(did) if args.split == 'validation' else 'assessment',
                                pick=pick, chosen=cards.index(p.historical_pick),
                                rarity=rarities.get(p.historical_pick, 'unknown'),
                                pool_size=sum(p.pool.values()), probabilities=probabilities,
                                band=band(probabilities['v2']), outcome=outcomes.get(did)))
    payload = dict(schema=SCHEMA, split=args.split, set_id=elite.set_id,
                   training_cap=args.cap, training_drafts=len(train_ids), training_picks=training_picks,
                   models={m: VARIANTS[m].describe() for m in MODELS}, model_signature=model_signature(),
                   elite_cache=cache_identity(elite), control_cache=cache_identity(control),
                   fit_sha256=file_sha256(args.fit),
                   archive_sha256=file_sha256(args.archive) if args.archive else None,
                   counts=dict(Counter(f"{r['cohort']}:{r['role']}" for r in records)), records=records)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    # Atomic, deterministic artifact: interrupted writes must not look like a
    # completed measurement to the resume path.
    temporary = args.out.with_suffix('.tmp')
    temporary.write_bytes(gzip.compress(json.dumps(payload, separators=(',', ':')).encode(), mtime=0))
    with gzip.open(temporary, 'rt') as handle:
        if len(json.load(handle)['records']) != len(records):
            raise ValueError('Measurement failed read-back verification')
    temporary.replace(args.out)
    print(json.dumps({k:v for k,v in payload.items() if k != 'records'}, indent=2))


def calibrated(values, temperature):
    weights = [p**temperature for p in values]
    total = sum(weights)
    return [p/total for p in weights]


def probability_report(rows, model, temperature):
    acc, calibration = Accumulator(), Calibration()
    by_pick, by_rarity = defaultdict(Accumulator), defaultdict(Accumulator)
    for r in rows:
        ps = calibrated(r['probabilities'][model], temperature)
        metrics = pick_metrics(ps, r['chosen'])
        args = (*metrics, len(ps))
        acc.add(*args); calibration.add(ps, r['chosen'])
        by_pick[str(r['pick'])].add(*args); by_rarity[r['rarity']].add(*args)
    return dict(metrics=acc.summary(), calibration=calibration.summary(),
                by_pick={k:v.summary() for k,v in by_pick.items()},
                by_chosen_rarity={k:v.summary() for k,v in by_rarity.items()})


def prepare_scores(rows):
    for r in rows:
        r['scores'] = {}
        for model, exponent in configurations():
            ps = r['probabilities'][model]
            r['scores'][config_key(model, exponent)] = curve_score(ps[r['chosen']]/max(ps), exponent)


def prediction_comparisons(rows, temperatures, draws):
    groups = defaultdict(list)
    for r in rows:
        groups[r['set_id']].append(r)
        groups['pooled'].append(r)
    result = {}
    for sid, group in groups.items():
        result[sid] = {}
        for label, ts in [('raw', {m:1 for m in MODELS}),
                          ('current_display', {m:2 for m in MODELS}),
                          ('fitted_display', temperatures)]:
            vectors = {m: [] for m in MODELS}
            for r in group:
                for m in MODELS:
                    loss, brier, hit, _ = pick_metrics(calibrated(r['probabilities'][m], ts[m]), r['chosen'])
                    vectors[m].append(((r['set_id'], r['draft_id']), loss, brier, int(hit)))
            result[sid][label] = paired_bootstrap(vectors[MODELS[0]], vectors[MODELS[1]], draws, SEED)
    return result


def source_banks(rows):
    banks = defaultdict(list)
    for r in rows:
        # The actual game requires at least four candidates; prediction reports
        # retain the other observed states and do not silently discard them.
        if len(r['probabilities']['v2']) >= 4:
            banks[(r['cohort'], r['set_id'], r['pick'], r['band'])].append(r)
    return banks


def profiles_for(rows, environment, runs, daily, day):
    banks = source_banks(rows)
    groups = []
    for cohort, sid, pick, b in sorted(banks):
        if cohort != 'elite':
            continue
        n = min(len(banks[('elite', sid, pick, b)]), len(banks.get(('control', sid, pick, b), [])))
        if n >= 5:
            groups.append(dict(set_id=sid, pick_number=pick, band=b, n=n))
    request = dict(groups=groups, environment=environment, runs=runs,
                   daily=daily and environment != 'powered-cube', day=day, seed=SEED)
    result = subprocess.run(['node', str(ROOT/'scripts/scoring_run_profiles.mjs')],
                            input=json.dumps(request), text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


def simulate(rows, profiles, seed=SEED):
    """Paired comparisons: every configuration scores exactly the same choices."""
    banks = source_banks(rows)
    slots = {tuple(slot) for profile in profiles for slot in profile}
    available = {}
    for cohort in ['elite', 'control']:
        for sid, lo, hi, b in slots:
            available[(cohort, sid, lo, hi, b)] = [r for p in range(lo, hi+1)
                                                   for r in banks.get((cohort, sid, p, b), [])]
    rng = random.Random(seed)
    values = {c: {config_key(m,e): [] for m,e in configurations()} for c in ['elite','control']}
    complete = 0
    for profile in profiles:
        picked = {}
        for cohort in values:
            picks, seen = [], set()
            for slot in profile:
                options = available[(cohort, *slot)]
                if not options:
                    break
                for _ in range(100):
                    r = rng.choice(options)
                    identity = (r['set_id'], r['draft_id'])
                    if identity not in seen:
                        picks.append(r); seen.add(identity); break
                else:
                    break
            if len(picks) == 8:
                picked[cohort] = picks
        if len(picked) != 2:
            continue
        complete += 1
        for cohort, picks in picked.items():
            for key in values[cohort]:
                values[cohort][key].append(js_round(sum(r['scores'][key] for r in picks)/8))
    return values, complete


def resample_sources(rows, rng):
    """Stratified draft bootstrap; never resample simulated runs as independent."""
    strata = defaultdict(lambda: defaultdict(list))
    for r in rows:
        strata[(r['set_id'], r['cohort'])][r['draft_id']].append(r)
    out = []
    for drafts in strata.values():
        ids = sorted(drafts)
        for _ in ids:
            out.extend(drafts[rng.choice(ids)])
    return out


def simulated_report(rows, profiles, draws, runs_per_draw):
    values, complete = simulate(rows, profiles)
    if complete < 0.9*len(profiles):
        raise ValueError('Insufficient distinct-draft coverage for paired eight-pick runs')
    observed = {k: auc(values['elite'][k], values['control'][k]) for k in values['elite']}
    samples = defaultdict(list)
    rng = random.Random(SEED+1)
    for i in range(draws):
        boot, n = simulate(resample_sources(rows, rng), profiles[:runs_per_draw], SEED+i)
        if n < 0.9*min(runs_per_draw, len(profiles)):
            continue
        base = auc(boot['elite'][BASELINE], boot['control'][BASELINE])
        for k in observed:
            samples[k].append(auc(boot['elite'][k], boot['control'][k])-base)
    if draws and len(samples[BASELINE]) < 0.9*draws:
        raise ValueError('Too many bootstrap replicates lacked coverage')
    return dict(runs=complete, requested_runs=len(profiles), valid_bootstrap_draws=len(samples[BASELINE]),
                configurations={k: dict(auc=observed[k], delta_vs_baseline=observed[k]-observed[BASELINE],
                                       delta_ci95=interval(samples[k],5) if samples[k] else None,
                                       elite_mean=statistics.fmean(values['elite'][k]),
                                       control_mean=statistics.fmean(values['control'][k])) for k in observed})


def grading_report(rows):
    groups = defaultdict(list)
    for r in rows:
        if r['cohort'] == 'elite':
            groups[f"set:{r['set_id']}"].append(r)
            groups[f"rarity:{r['rarity']}"].append(r)
            groups[f"pick:{r['pick']}"].append(r)
            groups[f"pool:{'0' if r['pool_size']==0 else '1-2' if r['pool_size']<=2 else '3-5' if r['pool_size']<=5 else '6+'}"].append(r)
    result = {}
    for key in [config_key(m,e) for m,e in configurations()]:
        result[key] = {g: dict(n=len(rs), mean=statistics.fmean(r['scores'][key] for r in rs),
                               **{f'below_{cut}':sum(r['scores'][key]<cut for r in rs)/len(rs)
                                  for cut in [20,25,40]}) for g,rs in groups.items()}
    return result


def award_movement(rows, keys):
    """Underlying candidate credit, separate from the fixed trophy override."""
    result = {}
    for key in sorted(set(keys)):
        model, exponent = key.split('|')
        changes, scores, observed = [], [], []
        leader_changes = 0
        for r in rows:
            if r['cohort'] != 'elite':
                continue
            base_model,base_exponent=BASELINE.split('|')
            base, cand = r['probabilities'][base_model], r['probabilities'][model]
            bm, cm = max(base), max(cand)
            leader_changes += base.index(bm) != cand.index(cm)
            for i, p in enumerate(cand):
                score = curve_score(p/cm, float(exponent))
                change = score-curve_score(base[i]/bm, float(base_exponent))
                scores.append(score); changes.append(change)
                if i == r['chosen']:
                    observed.append(change)
        n = len(scores)
        result[key] = dict(candidates=n, decisions=len(observed),
            leader_changed_share=leader_changes/len(observed),
            mean_candidate_change=statistics.fmean(changes),
            mean_observed_pick_change=statistics.fmean(observed),
            candidate_below_25_share=sum(s<25 for s in scores)/n,
            harsher_share=sum(c<0 for c in changes)/n,
            gentler_share=sum(c>0 for c in changes)/n,
            moved_20_or_more_share=sum(abs(c)>=20 for c in changes)/n)
    return result


def outcome_report(rows):
    from pick_value import stratum_correlations, pool_fisher
    by_draft = defaultdict(list)
    for r in rows:
        if r.get('outcome'):
            by_draft[(r['set_id'],r['draft_id'])].append(r)
    result = {}
    for key in [config_key(m,e) for m,e in configurations()]:
        observations = [((sid, rs[0]['outcome']['skill']),
                         95-statistics.fmean(r['scores'][key] for r in rs),
                         float(rs[0]['outcome']['wins'])) for (sid,_),rs in by_draft.items() if len(rs)>=4]
        result[key] = dict(drafts=len(observations), pooled=pool_fisher(stratum_correlations(observations)))
    return result


def tail_safe(key, grading, environment):
    groups = [(name, g) for name, g in grading[key].items()
              if name.startswith('set:') and
              ((name == 'set:powered-cube') == (environment == 'powered-cube'))]
    return bool(groups) and all(g['n'] >= 50 and
        g['below_25'] <= grading[BASELINE][name]['below_25']+TAIL_LIMIT for name, g in groups)


def choose_curve(simulation, grading, environment, frozen_model=None):
    """Fixed selection rule: no substantial severe-tail regression on any set.

    Require a positive paired bootstrap lower bound versus incumbent. A noisy
    point-estimate win cannot replace it. Among survivors maximize simulated
    eight-pick AUC, breaking ties toward the current raw exponent 1.
    """
    eligible = []
    for key, metrics in simulation['configurations'].items():
        if frozen_model and key.split('|')[0] != frozen_model:
            continue
        if key == BASELINE:
            continue
        ci = metrics['delta_ci95']
        safe = tail_safe(key, grading, environment)
        if safe and ci and ci[0] > 0:
            eligible.append(key)
    if not eligible:
        return BASELINE
    return max(eligible, key=lambda k:(simulation['configurations'][k]['auc'], -abs(float(k.split('|')[1])-1), k))


def report(args):
    global BASELINE
    frozen_model=getattr(args,'frozen_model',None)
    BASELINE=f'{frozen_model}|1' if frozen_model else 'v2|1'
    inputs, rows, identities = [], [], set()
    for path in args.measurements:
        with gzip.open(path, 'rt') as f:
            data = json.load(f)
        if data['split'] != 'validation':
            raise ValueError('This development report accepts validation only; it never selects on final test')
        if data.get('schema') != SCHEMA or data.get('model_signature') != model_signature():
            raise ValueError('Stale measurements: rerun measure with the current model implementation')
        if data['set_id'] in identities:
            raise ValueError('Duplicate set measurements')
        identities.add(data['set_id'])
        inputs.append({k:v for k,v in data.items() if k != 'records'} | {'file_sha256':file_sha256(path)})
        for r in data['records']:
            if r['role'] != validation_role(r['draft_id']):
                raise ValueError('Incorrect validation partition')
        rows.extend(data['records'])
    if frozen_model:
        rows=[r for r in rows if (2<=r['pick']<=9 if r['set_id']=='powered-cube' else 1<=r['pick']<=8)]
        for r in rows:r['band']=band(r['probabilities'][frozen_model])
    prepare_scores(rows)
    temps = {}
    calibration = [r for r in rows if r['role']=='calibration' and r['cohort']=='elite']
    for m in MODELS:
        temps[m] = fit_temperature([(r['probabilities'][m],r['chosen']) for r in calibration], TEMPERATURES)[0]
    result = dict(schema=SCHEMA, scope='validation development; assessment is not a fresh final test',
                  analysis_code={name:file_sha256(ROOT/name) for name in
                    ['scripts/scoring_experiment.py', 'scripts/scoring_run_profiles.mjs',
                     'scripts/grading_curve.py', 'scripts/pick_value.py', 'draft-run.mjs',
                     'draft-run-policy.mjs', 'draft-run-difficulty.mjs', 'data/selection-policy.json']},
                  runtime=dict(python=sys.version, node=subprocess.check_output(['node','--version'],text=True).strip()),
                  inputs=inputs, protocol=dict(seed=SEED, exponents=EXPONENTS, temperatures=TEMPERATURES,frozen_model=frozen_model,baseline=BASELINE,
                    severe_tail_excess_limit=TAIL_LIMIT, runs=args.runs, bootstrap_draws=args.bootstrap_draws,
                    bootstrap_runs=args.bootstrap_runs, daily=args.daily, day=args.day,
                    point_units='raw support exponent; calibrated exponent = raw exponent / fitted temperature',
                    trophy_override='excluded from underlying-quality benchmark; production trophy choice remains 100'),
                  fitted_temperatures=temps, calibration_decisions=len(calibration), partitions={})
    for role in ['selection','assessment']:
        subset = [r for r in rows if r['role']==role]
        elite = [r for r in subset if r['cohort']=='elite']
        entry = dict(counts=dict(Counter(r['cohort'] for r in subset)), grading=grading_report(subset),
                     prediction_comparisons=prediction_comparisons(elite, temps, args.bootstrap_draws),
                     outcomes=outcome_report(subset), probability={m:{
                         'raw':probability_report(elite,m,1),
                         'current_display_exponent_2':probability_report(elite,m,2),
                         'fitted_on_calibration_partition':probability_report(elite,m,temps[m])} for m in MODELS},
                     simulations={})
        for environment in ['mixed','powered-cube']:
            available = [r for r in subset if (r['set_id']=='powered-cube') == (environment=='powered-cube')]
            if not available:
                continue
            profiles = profiles_for(available,environment,args.runs,args.daily,args.day)
            entry['simulations'][environment] = simulated_report(available,profiles,args.bootstrap_draws,args.bootstrap_runs)
        result['partitions'][role] = entry
        if role == 'selection':
            # Freeze the choice before calculating any assessment result.
            result['selected'] = {env:choose_curve(sim, entry['grading'], env,frozen_model)
                                  for env,sim in entry['simulations'].items()}
        entry['award_movement'] = award_movement(subset, [BASELINE, 'v3-colour-and-pair|1',
                                                         *result['selected'].values()])
    result['assessment_verdict'] = {}
    for env, key in result['selected'].items():
        metrics = result['partitions']['assessment']['simulations'][env]['configurations'][key]
        groups = result['partitions']['assessment']['grading']
        safe = tail_safe(key, groups, env)
        result['assessment_verdict'][env] = ('retain incumbent' if key==BASELINE else
            'development gate passed' if safe and metrics['delta_ci95'][0]>0 else 'not confirmed; retain incumbent')
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    print(json.dumps({k:result[k] for k in ['fitted_temperatures','selected','assessment_verdict']},indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command',required=True)
    m = sub.add_parser('measure')
    for name in ['elite','control','fit','out']:
        m.add_argument('--'+name,type=Path,required=True)
    m.add_argument('--archive',type=Path)
    m.add_argument('--cap',type=int,default=5000)
    m.add_argument('--split',choices=['validation','test'],default='validation')
    m.add_argument('--final-test',action='store_true')
    r = sub.add_parser('report')
    r.add_argument('measurements',nargs='+',type=Path)
    r.add_argument('--out',type=Path,required=True)
    r.add_argument('--runs',type=int,default=2000)
    r.add_argument('--bootstrap-draws',type=int,default=200)
    r.add_argument('--bootstrap-runs',type=int,default=500)
    r.add_argument('--daily',action='store_true')
    r.add_argument('--day',default='2026-09-16')
    r.add_argument('--frozen-model',choices=['v3-colour-and-pair'],help='Only calibrate partial-credit curves for the frozen context model; cannot select a different predictor')
    args = parser.parse_args()
    if args.command == 'measure':
        measure(args)
    else:
        if min(args.runs,args.bootstrap_draws,args.bootstrap_runs)<1:
            parser.error('run and bootstrap counts must be positive')
        report(args)


if __name__ == '__main__':
    main()
