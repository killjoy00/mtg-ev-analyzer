#!/usr/bin/env python3
"""#1863 ALSA redundancy FIRST, before any challenger fit or holdout scoring.
No original validation choices, anonymous validation banks or result reports.
Current full-residual coefficients are descriptive incumbents only, not
train-only candidate features. V6 supports and ALSA are measured only on
baseline/earlier residual sources. No production access or model selection.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
from itertools import groupby
import json
import math
from pathlib import Path
import numpy as np
import pool_aware_v7_refit as refit
import pool_aware_skill_reviewed_validation as rv
import pool_aware_skill_expansion as exp
import pool_aware_skill_contrast as skill
import pool_aware_skill_recovery as rec
import pool_aware_skill_final_correction as final
from pool_aware_archive import rows, scan_drafts, read_json, sha256, MIN_GAMES
from build_replays import candidate_columns, column_card_name, CARD_PREFIX, truthy_count, parse_rate_bucket, parse_games_lower_bound

PROTOCOL='v7-alsa-redundancy-residual-only-v1'
REGISTRY='ba978db88bb5b569a100cfbc53103a697e2ee0a496b1ec9a9c2fcba1f90a6bdc'
SPLIT_SOURCE='a3500d89398b44a44bcc4a6628421dfaf71eb811'
SPLIT_BLOB='2b1867be3e3ed21ce7516611164f45c87f0de3af'
COHORTS=('elite','control')
PRIOR_COUNT=100
SCALE=4.

def split(elite, ordinary):
    # One chronological cutoff across both cohorts. Keep all tied source
    # timestamps together, choosing the closest boundary to 70% of drafts.
    time = {}
    for r, _, _ in elite + ordinary:
        if r.source in time and time[r.source] != r.event_time:
            raise ValueError('inconsistent source time')
        time[r.source] = r.event_time
    if {r.source for r,_,_ in elite} & {r.source for r,_,_ in ordinary}:
        raise ValueError('cohort overlap')
    counts = Counter(time.values())
    times = sorted(counts)
    if len(times) < 2:
        raise ValueError('insufficient time groups')
    n = len(time)
    k = 0
    choices = []
    for t in times[:-1]:
        k += counts[t]
        choices.append((abs(10*k-7*n), t, k))
    _, cutoff, ntrain = min(choices)
    fit, test = {}, {}
    for c, records in zip(COHORTS, (elite,ordinary)):
        fit[c] = [x for x in records if x[0].event_time <= cutoff]
        test[c] = [x for x in records if x[0].event_time > cutoff]
        if not fit[c] or not test[c] or len({r.source for r,_,_ in test[c]}) < 2:
            raise ValueError('empty/insufficient chronological cohort '+c)
    assert not ({r.source for rows in fit.values() for r,_,_ in rows} &
                {r.source for rows in test.values() for r,_,_ in rows})
    return fit,test,{'cutoff_inclusive':cutoff,'training_drafts':ntrain,'holdout_drafts':n-ntrain,
                     'training_fraction':ntrain/n}


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

def alsa_table(path, windows, cutoff, exclude=()):
    # Full population in baseline and the earlier residual slice only.
    windows = dict(windows)
    # Original validation timestamps do not define a usable design phase.
    windows['validation'] = (windows['validation'][0], windows['validation'][0])
    sources, inconsistent = scan_drafts(path, windows, parse_rate_bucket, parse_games_lower_bound)
    selected = {d for d, v in sources.items() if v[0] == 'baseline' or (v[0] == 'residual' and v[1].isoformat() <= cutoff)} - set(exclude)
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
    return table, {'eligible_all_population_drafts': original_selected, 'training_cutoff_inclusive': cutoff,
                   'baseline_population_drafts': sum(sources[d][0]=='baseline' for d in selected),
                   'early_residual_population_drafts': sum(sources[d][0]=='residual' for d in selected), 'inconsistent_sources_excluded': inconsistent,
                   'duplicate_sources_excluded': len(duplicate), 'invalid_coordinate_sources_excluded': len(invalid_coords),
                   'last_seen_instances': sum(counts.values()), 'cards_seen': len(counts),
                   'cards_with_100_observations': sum(n >= PRIOR_COUNT for n in counts.values()),
                   'mean_alsa': mean, 'raw_pick_min': low, 'raw_pick_max': high,
                   'shrinkage_pseudocount': PRIOR_COUNT, **qc}



def train_only_eligibility(train):
    offers={c:Counter(n for row,_,_ in train[c] for n in row.candidates) for c in COHORTS}
    return {n for n,k in offers['elite'].items() if k>=skill.MIN_OFFERED and offers['control'][n]>=skill.MIN_OFFERED}

def support_features(train):
    # Relative log v6 support: removes per-pack size/normalization effects.
    # Stage-conditioned values preserve the existing v6 availability signal.
    # This is an offer-weighted summary, not a newly fitted card preference.
    sums=defaultdict(lambda:np.zeros(12));counts=defaultdict(lambda:np.zeros(12))
    for c in COHORTS:
        for r,_,k in train[c]:
            l=np.log(r.support); l-=l.mean()
            stage=0 if k<=4 else 1
            for n,v in zip(r.candidates,l):
                for j in (stage,2):
                    sums[n][j]+=v;counts[n][j]+=1
                # Exact pick means retained for coverage/diagnostic output.
                if 1<=k<=9:
                    sums[n][k+2]+=v;counts[n][k+2]+=1
    return sums,counts

def fold(n):
    return int.from_bytes(hashlib.sha256(('alsa-redundancy-v1|'+n).encode()).digest()[:8],'big')%5

def r2(y,p,w,center=None):
    center=np.average(y,weights=w) if center is None else center
    den=np.sum(w*(y-center)**2)
    return None if den<=1e-12 else float(1-np.sum(w*(y-p)**2)/den)

def fit_predict(x,y,w,xt):
    X=np.column_stack([np.ones(len(x)),x]);T=np.column_stack([np.ones(len(xt)),xt])
    sw=np.sqrt(w)
    b=np.linalg.lstsq(X*sw[:,None],y*sw,rcond=None)[0]
    return T@b

def redundancy_fit(cards,X,y,w):
    n=len(cards)
    if n<max(15,3*(X.shape[1]+1)):
        return {'status':'unavailable','cards':n,'reason':'insufficient cards for descriptive regression'}
    if not np.all(np.isfinite(X)) or not np.all(np.isfinite(y)) or np.any(w<=0):
        raise ValueError('invalid descriptive design')
    pred=fit_predict(X,y,w,X)
    cv=np.full(n,np.nan);cent=np.full(n,np.nan)
    fs=np.asarray([fold(c) for c in cards])
    for i in range(5):
        train=fs!=i; test=~train
        if not test.any():continue
        if train.sum()<=X.shape[1]+1:
            return {'status':'unavailable','cards':n,'reason':'insufficient cross-card training'}
        cv[test]=fit_predict(X[train],y[train],w[train],X[test])
        cent[test]=np.average(y[train],weights=w[train])
    if not np.isfinite(cv).all() or not np.isfinite(cent).all():
        raise ValueError('missing cross-card prediction')
    return {'status':'measured','cards':n,'weight_sum':float(w.sum()),'r2_in_sample':r2(y,pred,w),
            'r2_card_fold_oof':r2(y,cv,w,cent),'weighted_rmse_oof':float(np.sqrt(np.average((y-cv)**2,weights=w)))}

def measure_table(train,table,fit):
    sums,counts=support_features(train)
    eligible=train_only_eligibility(train)
    elite=fit['elite_card_effects']; ordinary=fit['control_card_effects']
    if set(elite)!=set(ordinary):
        raise ValueError('incumbent card mask parity')
    observed=set(counts); covered=set(table); available=observed&covered
    both={n for n in available if counts[n][0]>0 and counts[n][1]>0}
    groups={'all':available,'training_eligible':available&eligible,
            'training_ineligible':available-eligible,'incumbent_eligible':available&set(elite),
            'incumbent_ineligible':available-set(elite),'alsa_at_least_100':{n for n in available if table[n]['n']>=100}}
    results={}
    for group,members in groups.items():
        names=sorted(members&both)
        result={'training_offered_cards':len(members),'both_stages_covered_cards':len(names),
                'alsa_instance_count':sum(table[n]['n'] for n in names)}
        if names:
            v6=np.array([[sums[n][0]/counts[n][0],sums[n][1]/counts[n][1]] for n in names])
            e=np.array([elite.get(n,0.) for n in names])[:,None]
            o=np.array([ordinary.get(n,0.) for n in names])[:,None]
            contrast=e-o
            designs={'v6_early':v6[:,:1],'v6_late':v6[:,1:],
                     'v6_by_stage':v6,'current_contrast':contrast,'current_strong':e,'current_ordinary':o,
                     'current_both_cohorts':np.hstack([e,o]),'v6_plus_contrast':np.hstack([v6,contrast]),
                     'v6_plus_both_cohorts':np.hstack([v6,e,o])}
            # Card terms are the existing full-residual incumbent, and the
            # fit here is a descriptive cross-card projection, NOT a choice
            # model, independent holdout comparison or adoption rule.
            for field in ('alsa','shrunk'):
                y=np.array([table[n][field] for n in names])
                for weighting,w in [('equal_cards',np.ones(len(names))),('last_seen_instances',np.array([table[n]['n'] for n in names],dtype=float))]:
                    result[field+'_'+weighting]={label:redundancy_fit(names,X,y,w) for label,X in designs.items()}
        results[group]=result
    offer_total=sum(counts[n][2] for n in observed)
    coverage={'distinct_offered_cards':len(observed),'cards_with_alsa':len(available),
              'cards_with_100_alsa':sum(table[n]['n']>=100 for n in available),
              'total_offers':int(offer_total),'offers_with_alsa':int(sum(counts[n][2] for n in available)),
              'offers_with_100_alsa':int(sum(counts[n][2] for n in available if table[n]['n']>=100)),
              'training_eligible_cards':len(eligible),'incumbent_eligible_cards':len(elite),
              'training_ineligible_offers':int(sum(counts[n][2] for n in observed-eligible)),
              'training_ineligible_offers_with_alsa':int(sum(counts[n][2] for n in available-eligible)),
              'training_ineligible_offers_with_100_alsa':int(sum(counts[n][2] for n in available-eligible if table[n]['n']>=100))}
    return {'coverage':coverage,'groups':results}

def traditional_records(sid,model,metadata,windows,cutoff,skill_cutoff,premier_ids):
    if sid not in refit.TRAD:
        return None,'no pinned Traditional archive'
    pin=refit.TRAD[sid]['source_archive']; path=exp.directory(sid)/(pin['sha256']+'.csv.gz')
    if not path.is_file():
        return None,'Traditional archive unavailable'
    if sha256(path)!=pin['sha256']:
        raise ValueError('Traditional archive checksum mismatch')
    if not {'user_game_win_rate_bucket','user_n_games_bucket','draft_time'}<=set(exp.header(path)):
        return None,'missing cohort/time metadata'
    w=dict(windows);w['validation']=(w['validation'][0],w['validation'][0])
    src,_=scan_drafts(path,w,parse_rate_bucket,parse_games_lower_bound)
    src={d:v for d,v in src.items() if v[0]=='residual' and v[1].isoformat()<=cutoff and d not in premier_ids}
    dup,bad=rec.invalid_pick_sources(path,src)
    eligible={d:('elite' if v[2]>=skill_cutoff else 'control',v)
              for d,v in src.items() if d not in dup|bad and v[2] is not None and v[3] is not None and v[3]>=MIN_GAMES}
    if not eligible:
        return None,'no same-mode early residual cohort'
    pmin=kmin=999
    for names,idx,reader in rows(path):
        for v in reader:
            if v[idx['draft_id']].strip() in eligible:
                pmin=min(pmin,int(float(v[idx['pack_number']])))
                kmin=min(kmin,int(float(v[idx['pick_number']])))
    if pmin not in (0,1) or kmin not in (0,1):
        return None,'unsupported numbering'
    first,last=(2,7) if sid=='powered-cube' else (1,6) if sid=='fra' else (1,8)
    train,_=refit.read_records(path,eligible,model,metadata,1-pmin,1-kmin,last,first)
    if min(len(train[c]) for c in COHORTS)<50:
        return None,'insufficient same-mode training coverage'
    return (train,path),None

def measure(sid,prior_dir,fits_path,output):
    prior=rv.frozen_prior(prior_dir,sid)
    fits=refit.load_fits(fits_path)
    if rv.registry_digest(fits)!=REGISTRY:
        raise ValueError('wrong incumbent registry')
    frozen=refit.check_fit(fits[sid],sid,prior);fit=frozen['fit'];fp=frozen['provenance']
    e,o,metadata,draft,prov,model,ids,windows=refit.prepare(sid,exp.directory(sid)/'manifest.json',prior,'residual')
    # A copy of the exact prompt-2 split helper, not a newly chosen boundary.
    train,holdout,s=split(e,o)
    # Do not score, tabulate choices or export any holdout record.
    del e,o,holdout
    for key in ('sources','windows','purge_days','baseline_drafts','baseline_picks','baseline_cutoff','recovery'):
        if prov[key]!=fp[key]:
            raise ValueError('frozen provenance mismatch '+key)
    cut=s['cutoff_inclusive']
    table,coverage=alsa_table(draft,windows,cut)
    result=measure_table(train,table,fit)
    result['alsa_training']=coverage
    result['status']='measured'
    tr,reason=traditional_records(sid,model,metadata,windows,cut,fp['baseline_cutoff'],ids)
    traditional={'status':'unavailable','reason':reason}
    if tr is not None:
        tt,path=tr
        table_t,coverage_t=alsa_table(path,windows,cut,ids)
        traditional=measure_table(tt,table_t,fit)
        traditional.update(status='measured',alsa_training=coverage_t,
                           cutoff_note='same Premier prompt-2 timestamp, same-mode ALSA and v6 offers; incumbent terms are Premier as in current Traditional policy')
    report={'protocol':PROTOCOL,'set':sid,'registry':REGISTRY,'split_source':SPLIT_SOURCE,'split_blob':SPLIT_BLOB,
            'split':s,'code_sha256':sha256(Path(__file__)),'sources':fp['sources'],'premier':result,'traditional':traditional,
            'no_challenger_fit':True,'no_final_validation_scores_read':True,
            'incumbent_terms_note':'Current full-residual fitted terms are used ONLY for descriptive redundancy, not as coefficients for a residual-holdout comparison. Any later choice-model arms must refit on first 70%.',
            'r2_note':'Per-card descriptive least squares, 5 fixed hash folds across cards. Raw/shrunk ALSA, equal-card and observation-weighted results. Joint R2 is not causal information or proof that a stage interaction is redundant.'}
    output.mkdir(parents=True,exist_ok=True)
    exp.write(output/'report.json',report)
    print(json.dumps({'set':sid,'split':s,'coverage':result['coverage'],'alsa_training':coverage,
                      'all_redundancy':result['groups']['all'].get('shrunk_equal_cards'),
                      'traditional_status':traditional['status']},indent=2),flush=True)

def aggregate(folder,output):
    reports={}
    for p in sorted(folder.glob('pool-aware-v7-alsa-redundancy-*/report.json')):
        r=read_json(p);s=r['set']
        if (s in reports or s not in rv.EXPECTED or r['protocol']!=PROTOCOL or r['registry']!=REGISTRY
            or r['split_blob']!=SPLIT_BLOB or r['code_sha256']!=sha256(Path(__file__))
            or not r['no_challenger_fit'] or not r['no_final_validation_scores_read']):
            raise ValueError('invalid redundancy artifact')
        reports[s]=r
    if set(reports)!=rv.EXPECTED:
        raise ValueError('missing format reports: '+str(sorted(rv.EXPECTED-set(reports))))
    def summary(mode):
        measured=[r[mode] for r in reports.values() if r[mode]['status']=='measured']
        cov=Counter()
        for r in measured:cov.update(r['coverage'])
        groups={}
        for group in ('all','training_eligible','training_ineligible','incumbent_eligible','incumbent_ineligible','alsa_at_least_100'):
            g={}
            for field in ('alsa_equal_cards','alsa_last_seen_instances','shrunk_equal_cards','shrunk_last_seen_instances'):
                estimates=defaultdict(list)
                for r in measured:
                    for label,x in r['groups'][group].get(field,{}).items():
                        if x.get('status')=='measured' and x['r2_card_fold_oof'] is not None:
                            estimates[label].append((x['r2_card_fold_oof'],x['r2_in_sample'],x['cards']))
                g[field]={label:{'formats':len(xs),'median_oof_r2':float(np.median([x[0] for x in xs])),
                                 'median_in_sample_r2':float(np.median([x[1] for x in xs])),
                                 'card_count_weighted_mean_oof_r2':float(np.average([x[0] for x in xs],weights=[x[2] for x in xs]))}
                          for label,xs in estimates.items()}
            groups[group]=g
        return {'formats_measured':len(measured),'coverage':dict(cov),'groups':groups,
                'aggregation_note':'Mean/median of format-specific R2, not a single pooled variance decomposition.'}
    result={'protocol':PROTOCOL,'registry':REGISTRY,'no_challenger_fit':True,'no_final_validation_scores_read':True,
            'premier':summary('premier'),'traditional':summary('traditional'),'per_format':reports}
    exp.write(output,result)
    print(json.dumps({'premier':result['premier'],'traditional':result['traditional']},indent=2),flush=True)

def self_test():
    from pool_aware_refit import Choice
    records=[]
    for j in range(10):
        r=Choice('d'+str(j),'2026-01-%02dT00:00:00+00:00'%(j+1),('a','b'),(.6,.4),((0.,)*8,)*2,0)
        records.append((r,(),1))
    tr,te,s=split(records[::2],records[1::2])
    assert s['training_drafts']==7 and s['holdout_drafts']==3
    assert all(r.event_time<=s['cutoff_inclusive'] for xs in tr.values() for r,_,_ in xs)
    c,v=last_seen({(0,0):Counter(a=2,b=1),(0,8):Counter(a=1,c=1)})
    assert c==Counter(a=2,b=1,c=1) and v['a']==8
    names=['card'+str(i) for i in range(40)]
    x=np.arange(40,dtype=float)[:,None];y=2*x[:,0]+3
    report=redundancy_fit(names,x,y,np.ones(40))
    assert report['r2_in_sample']>1-1e-12 and report['r2_card_fold_oof']>1-1e-12
    print('Redundancy contracts passed: exact common split, wheel/copy counts, descriptive cross-card R2.')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--stage',choices=('measure','aggregate'))
    p.add_argument('--set',choices=sorted(rv.EXPECTED))
    for k in ('prior','fits','reports','output'):
        p.add_argument('--'+k,type=Path)
    a=p.parse_args()
    if a.self_test:self_test()
    elif a.stage=='measure':measure(a.set,a.prior,a.fits,a.output)
    elif a.stage=='aggregate':aggregate(a.reports,a.output)
    else:p.error('stage required')
if __name__=='__main__':main()
