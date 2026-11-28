#!/usr/bin/env python3
"""Offline, fixed two-arm ALSA audit for the reviewed v7 contrast refit.

ALSA = last observed one-based pick per physical pack/card copy; a wheel
replaces the first observation. All-population baseline window supplies ALSA.
Only two residual strong-cohort coefficients are learned; existing v7
coefficients, source partitions, lambda, clip, grading and profile policy fixed.
No production access; public archive aggregates and anonymized score banks only.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from dataclasses import replace
import hashlib
from itertools import groupby
import json
import math
from pathlib import Path
import numpy as np
from scipy.optimize import minimize
from scipy.special import logsumexp

import pool_aware_v7_refit as refit
import pool_aware_skill_reviewed_validation as rv
import pool_aware_skill_final_correction as final
import pool_aware_mana_final as parser
import pool_aware_skill_expansion as exp
import pool_aware_skill_contrast as skill
import pool_aware_skill_recovery as rec
import pool_aware_statistical_validation as stat
import pool_aware_v7_strong_only_comparison as comparison
from pool_aware_refit import weights
from pool_aware_diagnostics import grade, leader
from pool_aware_archive import rows, scan_drafts, read_json, sha256, MIN_GAMES
from build_replays import candidate_columns, column_card_name, CARD_PREFIX, truthy_count, parse_rate_bucket, parse_games_lower_bound

PROTOCOL = 'v7-alsa-two-arm-20261128-v1'
REGISTRY = 'ba978db88bb5b569a100cfbc53103a697e2ee0a496b1ec9a9c2fcba1f90a6bdc'
PRIOR_COUNT = 100
SCALE = 4.
PENALTY = skill.CONTEXT_PENALTY
NAMES = ('v6', 'contrast', 'alsa')

def last_seen(picks):
    """picks: {(raw pack index, raw pick index): Counter(card copies)}.
    Arena Premier/Traditional have eight seats. The two visits to a physical
    pack have pick numbers differing by eight. Retain multiplicity."""
    groups = defaultdict(list)
    for (pk, pi), cards in picks.items():
        groups[pk, pi % 8].append((pi, cards))
    counts, sums = Counter(), Counter()
    for visits in groups.values():
        visits.sort()
        if len(visits) > 2 or (len(visits) == 2 and visits[1][0] - visits[0][0] != 8):
            raise ValueError('invalid physical pack numbering')
        if len(visits) == 2:
            first, second = visits
            observations = [(first[0], first[1] - second[1]), second]
        else:
            observations = visits
        for pick, cards in observations:
            counts.update(cards)
            for card, copies in cards.items():
                sums[card] += pick * copies
    return counts, sums

def alsa_table(path, windows, exclude=()):
    # The full baseline population, regardless of rank, experience or outcome.
    sources, inconsistent = scan_drafts(path, windows, parse_rate_bucket, parse_games_lower_bound)
    selected = {d for d, v in sources.items() if v[0] == 'baseline'} - set(exclude)
    original_selected = len(selected)
    duplicate, invalid_coords = rec.invalid_pick_sources(path, {d:sources[d] for d in selected})
    selected -= duplicate | invalid_coords
    if not selected:
        raise ValueError('empty all-population ALSA window')
    counts, sums, qc = Counter(), Counter(), Counter()
    visited = set()
    low = 999
    high = -1
    for names, idx, reader in rows(path):
        columns = [(idx[c], column_card_name(c, CARD_PREFIX)) for c in candidate_columns(names)]
        if not columns:
            raise ValueError('missing pack contents')
        # Input archives are grouped by source. Fail closed if not; never
        # count an incomplete fragment as a second distinct draft.
        for draft, batch in groupby(reader, lambda v: v[idx['draft_id']].strip()):
            if draft not in selected:
                continue
            if draft in visited:
                raise ValueError('ALSA archive not source-contiguous')
            visited.add(draft)
            picks = {}
            invalid = False
            picked_only = 0
            for v in batch:
                try:
                    pk, pi = (int(float(v[idx[k]])) for k in ('pack_number', 'pick_number'))
                except (ValueError, OverflowError, TypeError):
                    invalid = True
                    continue
                if not 0 <= pk <= 3 or not 0 <= pi <= 16 or (pk, pi) in picks:
                    invalid = True
                    continue
                cards = Counter({n: c for j, n in columns if (c := truthy_count(v[j])) > 0})
                chosen = v[idx['pick']].strip()
                if chosen and chosen not in cards:
                    cards[chosen] = 1
                    picked_only += 1
                if not cards:
                    qc['missing_pick_contents'] += 1
                picks[pk, pi] = cards
            if invalid or not picks:
                qc['invalid_sources_excluded'] += 1
                continue
            if max(p for _, p in picks) - min(p for _, p in picks) > 15:
                qc['invalid_sources_excluded'] += 1
                continue
            c, s = last_seen(picks)
            counts.update(c)
            sums.update(s)
            low = min(low, min(p for _, p in picks))
            high = max(high, max(p for _, p in picks))
            qc['drafts_used'] += 1
            qc['pick_rows'] += len(picks)
            qc['picked_card_missing_from_offer'] += picked_only
    if visited != selected or low not in (0, 1) or high - low > 15 or not counts:
        raise ValueError('ALSA source or pick-offset coverage failure')
    offset = 1 - low
    mean = sum(sums.values()) / sum(counts.values()) + offset
    table = {}
    for card, n in counts.items():
        raw = sums[card] / n + offset
        shrunk = (n * raw + PRIOR_COUNT * mean) / (n + PRIOR_COUNT)
        table[card] = {'n': n, 'alsa': raw, 'shrunk': shrunk, 'z': (mean - shrunk) / SCALE}
    return table, {'eligible_all_population_drafts': original_selected, 'inconsistent_sources_excluded': inconsistent,
                   'duplicate_sources_excluded': len(duplicate), 'invalid_coordinate_sources_excluded': len(invalid_coords),
                   'last_seen_instances': sum(counts.values()), 'cards_seen': len(counts),
                   'cards_with_100_observations': sum(n >= PRIOR_COUNT for n in counts.values()),
                   'mean_alsa': mean, 'raw_pick_min': low, 'raw_pick_max': high,
                   'shrinkage_pseudocount': PRIOR_COUNT, **qc}

def feature(card, k, table):
    z = table.get(card, {}).get('z', 0.)
    return (z, z * (k - 4.5) / 4.5)

def unbounded(row, pool, rules, context, cards):
    f = final.fit_features(row, pool, rules).features
    return np.array([sum(a*b for a, b in zip(v[:6], context)) + cards.get(n, 0.)
                     for n, v in zip(row.candidates, f)])

def design(records, rules, context, cards, table):
    width = max(len(r.candidates) for r, _, _ in records)
    N = len(records)
    support = np.full((N, width), -np.inf)
    raw = np.zeros((N, width))
    x = np.zeros((N, width, 2))
    chosen = np.zeros(N, dtype=int)
    mask = np.zeros((N, width), dtype=bool)
    for i, (r, p, k) in enumerate(records):
        n = len(r.candidates)
        support[i, :n] = np.log(r.support)
        raw[i, :n] = unbounded(r, p, rules, context, cards)
        x[i, :n] = [feature(c, k, table) for c in r.candidates]
        chosen[i] = r.chosen
        mask[i, :n] = True
    return support, raw, x, chosen, mask

def objective(beta, design_data):
    support, raw, x, chosen, mask = design_data
    N = len(chosen)
    denom = mask.sum(axis=1)
    z = skill.LAMBDA * (raw + x @ beta)
    z = z - (np.sum(z * mask, axis=1) / denom)[:, None]
    clipped = np.clip(z, -parser.HALF_SPAN, parser.HALF_SPAN)
    logits = support + clipped
    lse = logsumexp(logits, axis=1)
    i = np.arange(N)
    loss = np.mean(lse - logits[i, chosen]) + PENALTY * np.dot(beta, beta) / 2
    err = np.exp(logits - lse[:, None])
    err[i, chosen] -= 1.
    jac = skill.LAMBDA * (x - (np.sum(x * mask[:, :, None], axis=1) / denom[:, None])[:, None, :])
    active = (np.abs(z) < parser.HALF_SPAN) & mask
    gradient = (err[:, :, None] * active[:, :, None] * jac).sum(axis=(0, 1)) / N + PENALTY * beta
    return float(loss), gradient

def learn(records, rules, context, cards, table):
    if len(records) < 50 or len({r.source for r, _, _ in records}) < 2:
        raise ValueError('insufficient residual strong-cohort training')
    data = design(records, rules, context, cards, table)
    initial, _ = objective(np.zeros(2), data)
    result = minimize(objective, np.zeros(2), args=(data,), jac=True, method='L-BFGS-B',
                      options={'maxiter': 200, 'ftol': 1e-12, 'gtol': 1e-7})
    if not result.success or not np.isfinite(result.x).all() or result.fun > initial + 1e-10:
        raise ValueError('fixed ALSA optimizer failed: ' + str(result.message))
    return result.x, {'coefficients': result.x.tolist(), 'fit_decisions': len(records),
                     'fit_drafts': len({r.source for r, _, _ in records}),
                     'penalty': PENALTY, 'initial_objective': initial,
                     'final_objective': float(result.fun), 'converged': bool(result.success)}

def predict(records, rules, context, cards, table, beta):
    base, alt = [], []
    for r, pool, k in records:
        a = final.apply(r, pool, rules, context, cards)
        raw = unbounded(r, pool, rules, context, cards)
        x = np.array([feature(n, k, table) for n in r.candidates])
        # Use exactly the production candidate's centering and clip.
        delta = parser.bounded([skill.LAMBDA * float(u) for u in raw + x @ beta])
        b = replace(a, features=tuple(f[:6] + (d, 0.) for f, d in zip(a.features, delta)))
        if max(abs(f[6]) for f in b.features) > parser.HALF_SPAN + 1e-12:
            raise ValueError('clip violation')
        base.append((a, pool, k))
        alt.append((b, pool, k))
    return base, alt

def sufficient(clusters):
    # Whole-source clustered, decision/offer-weighted normal interval.
    v = np.array(list(clusters.values()), dtype=float)
    if not len(v):
        return None
    n = v[:, 0]
    d = v[:, -1]
    return {'totals': v.sum(axis=0).tolist(), 'drafts': len(v),
            'sum_n2': float(n @ n), 'sum_nd': float(n @ d), 'sum_d2': float(d @ d)}

def combine(stats):
    stats = [s for s in stats if s is not None]
    if not stats:
        return None
    t = np.sum([s['totals'] for s in stats], axis=0)
    n, d = t[0], t[-1]
    G = sum(s['drafts'] for s in stats)
    delta = d/n
    variance = sum(s['sum_d2'] - 2*delta*s['sum_nd'] + delta**2*s['sum_n2'] for s in stats)
    se = math.sqrt(max(0., variance)*G/(G-1))/n if G > 1 else None
    return {'totals': t.tolist(), 'drafts': G, 'delta': float(delta),
            'ci95': [float(delta-1.96*se), float(delta+1.96*se)] if se is not None else None}

def describe_pair(s):
    if not s:
        return None
    n, wins, p0, p1, l0, l1, _ = s['totals']
    obs, p0, p1 = wins/n, p0/n, p1/n
    def odds(p):
        return p/(1-p) if p < 1 else None
    return {'pair_decisions': int(n), 'alternative_picked': int(wins),
            'observed_alternative_share': obs, 'v7_predicted_share': p0,
            'alsa_predicted_share': p1, 'observed_odds_alt_to_favorite': odds(obs),
            'v7_implied_odds': odds(p0), 'alsa_implied_odds': odds(p1),
            'v7_absolute_calibration_gap': abs(obs-p0), 'alsa_absolute_calibration_gap': abs(obs-p1),
            'v7_brier': l0/n, 'alsa_brier': l1/n, 'paired_brier_delta': s['delta'],
            'paired_brier_delta_ci95': s['ci95'], 'drafts': s['drafts']}

def pair_metrics(base, alt, table, examples=False):
    groups = defaultdict(lambda: defaultdict(lambda: np.zeros(7)))
    prediction = defaultdict(lambda: np.zeros(7))
    moves = defaultdict(Counter)
    evidence = {}
    for (a, pool, k), (b, pool_b, k_b) in zip(base, alt, strict=True):
        if (a.source, a.candidates, a.chosen, a.support, pool, k) != (b.source, b.candidates, b.chosen, b.support, pool_b, k_b):
            raise ValueError('pack pairing failure')
        p, q = weights(a, skill.APPLY), weights(b, skill.APPLY)
        g, h = grade(p), grade(q)
        f, new_f = leader(a, p), leader(b, q)
        ll0, ll1 = -math.log(p[a.chosen]), -math.log(q[a.chosen])
        prediction[a.source] += (1, ll0, ll1, int(f==a.chosen), int(new_f==a.chosen),
                                int(g[a.chosen]<25), ll1-ll0)
        stages = ['all', 'pick:'+str(k)]
        if k <= 8:
            stages.append('p1p1-8')
        changes = [abs(h[i]-g[i]) for i in range(len(g)) if i != f]
        for stage in stages:
            c = moves[stage]
            c['packs'] += 1
            c['packs5'] += max(changes, default=0)>=5
            c['packs10'] += max(changes, default=0)>=10
            c['leader_changed'] += f!=new_f
        for i, card in enumerate(a.candidates):
            if i == f:
                continue
            delta = h[i]-g[i]
            for stage in stages:
                c = moves[stage]
                c['alternative_offers'] += 1
                c['moved5'] += abs(delta)>=5
                c['moved10'] += abs(delta)>=10
                c['alt_with_alsa'] += card in table
                c['alt_with_100_alsa'] += table.get(card, {}).get('n',0)>=100
                c['both_with_alsa'] += card in table and a.candidates[f] in table
            if a.chosen not in (i, f):
                continue
            y = int(a.chosen==i)
            # Fixed original favorite across arms. Grades represent odds,
            # not probabilities; account for challenger leader changes.
            p0 = g[i]/(g[i]+g[f])
            p1 = h[i]/(h[i]+h[f])
            l0, l1 = (p0-y)**2, (p1-y)**2
            v = np.array((1, y, p0, p1, l0, l1, l1-l0))
            labels = stages[:]
            if abs(delta)>=5:
                labels += ['moved5', 'moved5:pick:'+str(k), 'up5' if delta>0 else 'down5']
            if abs(delta)>=10:
                labels += ['moved10', 'moved10:pick:'+str(k)]
            for label in labels:
                groups[label][a.source] += v
            if examples and abs(delta)>=5:
                # Comparable historical pair/stage with same baseline grade
                # decile and movement direction. Context is not identical.
                key = (a.candidates[f], card, k, g[i]//10, 1 if delta>0 else -1)
                item = evidence.setdefault(key, [np.zeros(7), None])
                item[0] += v
                if item[1] is None or abs(delta)>abs(item[1]['alternative_grade_change']):
                    item[1] = {'pick': k, 'prior_pool_unordered': list(pool),
                               'favorite': a.candidates[f], 'alternative': card,
                               'historical_pick': a.candidates[a.chosen],
                               'favorite_alsa': table.get(a.candidates[f]), 'alternative_alsa': table.get(card),
                               'favorite_grades': [g[f], h[f]], 'alternative_grades': [g[i], h[i]],
                               'alternative_grade_change': delta}
    cases = []
    for vals, item in evidence.values():
        n = vals[0]
        if n:
            pair = describe_pair({'totals': vals.tolist(), 'delta': float(vals[-1]/n), 'ci95': None, 'drafts': None})
            cases.append({**item, 'comparable_evidence': pair})
    # Prefer well-supported cases; reserve one adverse case when present.
    cases.sort(key=lambda c: (c['comparable_evidence']['pair_decisions']>=20,
                              c['comparable_evidence']['pair_decisions'],
                              abs(c['alternative_grade_change'])), reverse=True)
    favorable = [c for c in cases if c['comparable_evidence']['paired_brier_delta']<0]
    adverse = [c for c in cases if c['comparable_evidence']['paired_brier_delta']>0]
    selected = favorable[:2] + adverse[:1]
    selected += [c for c in cases if c not in selected][:max(0,3-len(selected))]
    return {'pair_sufficient': {k:sufficient(c) for k,c in groups.items()},
            'pair_results': {k:describe_pair(combine([sufficient(c)])) for k,c in groups.items()},
            'prediction_sufficient': sufficient(prediction),
            'movements': {k:dict(c) for k,c in moves.items()}, 'examples': selected}

def prediction_summary(s):
    if not s:
        return None
    n, ll0, ll1, t0, t1, tail0, _ = s['totals']
    return {'decisions': int(n), 'drafts': s['drafts'], 'v7_raw_log_loss':ll0/n, 'alsa_raw_log_loss':ll1/n,
            'paired_log_loss_delta':s['delta'], 'paired_log_loss_delta_ci95':s['ci95'],
            'v7_top1':t0/n, 'alsa_top1':t1/n, 'v7_below25':tail0/n}

def simulation(sid_bank, env, runs=stat.RUNS, per_draw=stat.BOOTSTRAP_RUNS, single=None):
    comparison.NAMES = NAMES
    comparison.KEYS = [x+'|1' for x in NAMES]
    rs = []
    for sid, bank in sid_bank:
        for b in bank:
            r = next(stat.simulation_rows(sid,[b[:6]],'contrast'))
            r['scores']['alsa|1'] = b[6]
            rs.append(r)
    return comparison.simulation(rs, env, runs, per_draw, single)

def traditional_train(sid, model, metadata, cutoff, windows, premier_ids):
    if sid not in refit.TRAD:
        return None
    pin = refit.TRAD[sid]['source_archive']
    path = exp.directory(sid)/(pin['sha256']+'.csv.gz')
    if not path.is_file() or not {'user_game_win_rate_bucket','user_n_games_bucket','draft_time'} <= set(exp.header(path)):
        return None
    if sha256(path)!=pin['sha256']:
        raise ValueError('Traditional pin mismatch')
    src,_ = scan_drafts(path, windows, parse_rate_bucket, parse_games_lower_bound)
    src = {d:v for d,v in src.items() if v[0]=='residual' and d not in premier_ids}
    dup,bad = rec.invalid_pick_sources(path,src)
    eligible = {d:('elite',v) for d,v in src.items() if d not in dup|bad and v[2] is not None and v[2]>=cutoff
                and v[3] is not None and v[3]>=MIN_GAMES}
    if not eligible:
        return None
    pmin=kmin=999
    for names,idx,reader in rows(path):
        for v in reader:
            if v[idx['draft_id']].strip() in eligible:
                pmin=min(pmin,int(float(v[idx['pack_number']])))
                kmin=min(kmin,int(float(v[idx['pick_number']])))
    if pmin not in (0,1) or kmin not in (0,1):
        raise ValueError('invalid Traditional training numbering')
    first,last=(2,7) if sid=='powered-cube' else (1,6) if sid=='fra' else (1,8)
    g,_=refit.read_records(path,eligible,model,metadata,1-pmin,1-kmin,last,first)
    if len(g['elite'])<50 or len({r.source for r,_,_ in g['elite']})<2:
        return None
    table,coverage=alsa_table(path,windows,premier_ids)
    return g['elite'],table,coverage

def measure(sid, prior_dir, fits_path, old, output):
    prior = rv.frozen_prior(prior_dir,sid)
    fits = refit.load_fits(fits_path)
    if rv.registry_digest(fits)!=REGISTRY:
        raise ValueError('wrong completed registry')
    frozen=refit.check_fit(fits[sid],sid,prior)
    fit=frozen['fit']; fp=frozen['provenance']
    context,cards=final.parameters(fit)
    old_report=read_json(old/'report.json'); old_bank=old/'bank.json.gz'
    if (old_report['protocol']!=rv.PROTOCOL or old_report['set']!=sid or old_report['fit_registry_sha256']!=REGISTRY
        or old_report['audit_code_sha256']!=sha256(rv.SOURCE) or old_report['bank_sha256']!=sha256(old_bank)
        or old_report['fit_report_sha256']!=hashlib.sha256(json.dumps(frozen,sort_keys=True).encode()).hexdigest()):
        raise ValueError('reviewed validation provenance mismatch')
    manifest=exp.directory(sid)/'manifest.json'
    e,o,metadata,draft,prov,model,ids,windows=refit.prepare(sid,manifest,prior,'residual')
    comparison.assert_numeric_parity(prov, fp, 'residual fit provenance')
    table,coverage=alsa_table(draft,windows)
    rules=parser.index(metadata)
    beta,learned=learn(e,rules,context,cards,table)
    train_ids={r.source for r,_,_ in e+o}
    trad=traditional_train(sid,model,metadata,fp['baseline_cutoff'],windows,ids)
    if trad:
        tr,tt,tc=trad
        tb,tl=learn(tr,rules,context,cards,tt)
        del tr,trad
    else:
        tt=tc=tb=tl=None
    del e,o,model,ids
    e,o,metadata,draft,prov,model,ids,windows=refit.prepare(sid,manifest,prior,'validation')
    for k in ('sources','windows','purge_days','baseline_cutoff','baseline_picks','baseline_drafts','baseline_colour_coverage','recovery'):
        if prov[k]!=fp[k]:
            raise ValueError('fit/validation mismatch '+k)
    if train_ids & {r.source for r,_,_ in e+o}:
        raise ValueError('training/validation overlap')
    rules=parser.index(metadata)
    a,x=predict(e,rules,context,cards,table,beta)
    b,y=predict(o,rules,context,cards,table,beta)
    outcomes=stat.selected_outcomes(draft,{r.source for r,_,_ in e+o})
    del e,o
    pc,bc=stat.summarize(sid,skill.APPLY,a,b,outcomes,candidate_name=skill.NAME)
    _,ba=stat.summarize(sid,skill.APPLY,x,y,outcomes,candidate_name=skill.NAME)
    rv.check_prediction(pc,old_report['arms']['refit']['cohorts'])
    reference=read_json(old_bank)['rows']
    if not len(reference)==len(bc)==len(ba):
        raise ValueError('bank length parity')
    bank=[]
    for orig,c,d in zip(reference,bc,ba):
        if orig[:5]+[orig[7]]!=c or c[:5]!=d[:5]:
            raise ValueError('reviewed v7 bank parity')
        bank.append(c+[d[5]])
    sim=simulation([(sid,bank)],'powered-cube' if sid=='powered-cube' else 'mixed',single=sid)
    comparison.compare_sim(sim,old_report['simulation'])
    elite=pair_metrics(a,x,table,True)
    ordinary=pair_metrics(b,y,table)
    del a,b,x,y,reference,bc,ba
    trcov,te,to=refit.traditional(sid,model,metadata,fp['baseline_cutoff'],windows,ids)
    if trcov!=old_report['traditional_archive']:
        raise ValueError('Traditional validation coverage parity')
    t={'status':'unavailable','validation_coverage':trcov,'reason':'no same-mode residual training or held-out coverage',
       'separation':'unavailable under existing Traditional simulation protocol'}
    if tt is not None and trcov['status']=='measured':
        ta,tx=predict(te,rules,context,cards,tt,tb)
        t0,t1=predict(to,rules,context,cards,tt,tb)
        t.update(status='measured',alsa_coverage=tc,fit=tl,elite=pair_metrics(ta,tx,tt,True),
                 ordinary=pair_metrics(t0,t1,tt))
    output.mkdir(parents=True,exist_ok=True)
    bf=output/'bank.json.gz'; bf.write_bytes(rv.bank_bytes(sid,bank))
    report={'protocol':PROTOCOL,'set':sid,'source_run':46107297635,'registry':REGISTRY,'code_sha256':sha256(Path(__file__)),
            'bank_sha256':sha256(bf),'evidence_class':old_report['evidence_class'],'alsa_coverage':coverage,'fit':learned,
            'elite':elite,'ordinary':ordinary,'simulation':sim,'traditional':t}
    exp.write(output/'report.json',report)
    print(json.dumps({'set':sid,'fit':learned,'coverage':coverage,'primary':elite['pair_results'].get('moved5'),
                      'movement':elite['movements'].get('all'),'prediction':prediction_summary(combine([elite['prediction_sufficient']])),
                      'simulation':sim,'traditional':t['status']},indent=2),flush=True)

def pool_mode(entries):
    entries=[e for e in entries if e]
    labels=sorted({k for e in entries for k in e['pair_sufficient']})
    mlabels=sorted({k for e in entries for k in e['movements']})
    movement={}
    for k in mlabels:
        c=Counter()
        for e in entries:
            c.update(e['movements'].get(k,{}))
        movement[k]=dict(c)
    return {'formats_measured':len(entries),
            'pair_results':{k:describe_pair(combine([e['pair_sufficient'].get(k) for e in entries])) for k in labels},
            'movements':movement,
            'prediction':prediction_summary(combine([e['prediction_sufficient'] for e in entries]))}

def aggregate(folder,reference,output):
    previous=read_json(reference);reports={};banks={}
    if previous['fit_registry_sha256']!=REGISTRY:
        raise ValueError('wrong reference')
    for p in sorted(folder.glob('pool-aware-v7-alsa-transfer-*/report.json')):
        r=read_json(p);s=r['set'];bf=p.parent/'bank.json.gz'
        if (r['protocol']!=PROTOCOL or r['registry']!=REGISTRY or r['code_sha256']!=sha256(Path(__file__))
            or r['bank_sha256']!=sha256(bf) or s in reports or s not in rv.EXPECTED):
            raise ValueError('invalid audit artifact')
        reports[s]=r;banks[s]=bf
    if set(reports)!=rv.EXPECTED:
        raise ValueError('missing measured formats')
    scopes={}
    for name,old in previous['runs'].items():
        ids=old['sets']
        if name.startswith('standalone:'):
            sim=reports[ids[0]]['simulation']
        else:
            sim=simulation([(s,read_json(banks[s])['rows']) for s in ids],
                           'powered-cube' if name=='powered-cube' else 'mixed',runs=10000,per_draw=2000)
        comparison.compare_sim(sim,old['simulation'])
        scopes[name]={'sets':ids,'elite':pool_mode([reports[s]['elite'] for s in ids]),
                      'ordinary':pool_mode([reports[s]['ordinary'] for s in ids]),'simulation':sim}
    overall=pool_mode([r['elite'] for r in reports.values()])
    traditional=[r['traditional'] for r in reports.values() if r['traditional']['status']=='measured']
    examples=[dict(set=s,**e) for s,r in reports.items() for e in r['elite']['examples']]
    examples.sort(key=lambda e:(e['comparable_evidence']['pair_decisions']>=20,e['comparable_evidence']['pair_decisions'],
                               abs(e['alternative_grade_change'])),reverse=True)
    good=[e for e in examples if e['comparable_evidence']['paired_brier_delta']<0]
    bad=[e for e in examples if e['comparable_evidence']['paired_brier_delta']>0]
    chosen=good[:2]+bad[:1]
    chosen += [e for e in examples if e not in chosen][:max(0,3-len(chosen))]
    result={'protocol':PROTOCOL,'registry':REGISTRY,'sets':sorted(reports),'release_allowed':False,
            'overall_premier_elite':overall,'scopes':scopes,'examples':chosen,
            'traditional':{'elite':pool_mode([r['elite'] for r in traditional]),
                           'ordinary':pool_mode([r['ordinary'] for r in traditional]),'separation':'unavailable'},
            'per_format':{s:{k:v for k,v in r.items() if k not in ('bank_sha256',)} for s,r in reports.items()},
            'interpretation':'Historical validation reused from v7 development; pairwise grades measure observed strong-player preference, not causal card quality. Examples use comparable contexts, not identical repeated packs. No trophy override.'}
    exp.write(output,result)
    print(json.dumps({'primary':overall['pair_results'].get('moved5'),'movement':overall['movements'].get('all'),
                      'prediction':overall['prediction'],'examples':chosen},indent=2),flush=True)

def self_test():
    c,s=last_seen({(0,0):Counter(a=2,b=1),(0,8):Counter(a=1,c=1),(0,1):Counter(d=1),(1,0):Counter(a=1)})
    assert c==Counter(a=3,b=1,c=1,d=1) and s==Counter(a=8,b=0,c=8,d=1)
    # The second observation replaces the first for a single wheeled card.
    c,s=last_seen({(0,1):Counter(x=1),(0,9):Counter(x=1)})
    assert c['x']==1 and s['x']==9
    assert feature('missing',1,{})==(0.,0.)
    data=(np.log([[.6,.4],[.5,.5]]),np.array([[.1,-.1],[.05,-.05]]),
          np.array([[[.4,.1],[-.4,-.1]],[[.2,.1],[-.2,-.1]]]),np.array([0,1]),np.ones((2,2),dtype=bool))
    x=np.array([.03,-.02]); val,g=objective(x,data)
    for i in range(2):
        d=np.zeros(2);d[i]=1e-6
        assert abs((objective(x+d,data)[0]-objective(x-d,data)[0])/2e-6-g[i])<1e-6
    a=sufficient({'a':np.array([2.,1.,.8,.9,.5,.4,-.1]),'b':np.array([1.,0.,.3,.2,.09,.04,-.05])})
    assert math.isclose(describe_pair(combine([a]))['paired_brier_delta'],-.05)
    from pool_aware_refit import Choice
    meta={'x':dict(id='x',layout='normal',mana_cost='{U}',type_line='Creature',oracle_text=''),
          'y':dict(id='y',layout='normal',mana_cost='{R}',type_line='Creature',oracle_text='')}
    row=Choice('synthetic','2026-01-01T00:00:00Z',('x','y'),(.6,.4),((0.,)*8,)*2,1)
    a,b=predict([(row,('x',)*3,4)],parser.index(meta),(.6,-.2,-.1,-.1,.2,-.3),{'x':.1}, {},np.zeros(2))
    assert a==b and grade(weights(a[0][0],skill.APPLY))==grade(weights(b[0][0],skill.APPLY))
    audit=pair_metrics(a,b,{})
    assert audit['pair_results']['all']['pair_decisions']==1
    assert audit['pair_results']['all']['alternative_picked']==1
    assert audit['movements']['all']['moved5']==0
    print('ALSA wheel, duplicate-copy, missing-card, objective-gradient, zero-arm parity and pairwise aggregation contracts passed.')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--stage',choices=('measure','aggregate'))
    p.add_argument('--set',choices=sorted(rv.EXPECTED))
    for k in ('prior','fits','old','banks','reference','output'):
        p.add_argument('--'+k,type=Path)
    a=p.parse_args()
    if a.self_test:self_test()
    elif a.stage=='measure':measure(a.set,a.prior,a.fits,a.old,a.output)
    elif a.stage=='aggregate':aggregate(a.banks,a.reference,a.output)
    else:p.error('stage required')

if __name__=='__main__':main()
