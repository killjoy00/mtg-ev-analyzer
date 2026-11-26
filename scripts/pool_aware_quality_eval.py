"""Offline evaluator for independently rated focal-card quality.

Do not generate score keys or expose model output to reviewers before their
ratings and adjudication are locked. This module never generates ratings.
"""
import argparse
from collections import Counter
import csv
import hashlib
import json
import math
from pathlib import Path

import numpy as np

BANDS=('poor','questionable','defensible','good','excellent')
STRATA=('synergy_screen','splash_fixing','established_lane','early_speculation','close_alternative')
TARGETS={'questionable_high':.25,'excellent_low':.20}
NONINFERIORITY_MARGIN=.05
MIN_ERROR_EVENTS=20


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def key_for_frozen_candidate(set_id,partitions,metadata,frozen,expected_sample_sha256):
    """Called only after external review lock; do not publish source IDs.
    Caller must separately verify exact archive hashes, windows, code and
    frozen candidate identity before invoking this routine.
    """
    from pool_aware_quality_sample import select
    from pool_aware_fixing import Context
    from pool_aware_refit import Choice, weights
    from pool_aware_diagnostics import grade
    cases,internal,counts=select(set_id,partitions,metadata)
    sample=(json.dumps(cases,indent=2,ensure_ascii=False)+'\n').encode('utf8')
    if hashlib.sha256(sample).hexdigest()!=expected_sample_sha256:
        raise ValueError('recreated sample differs from review packet')
    variant=frozen['variant']
    beta=tuple(frozen['beta'])
    if variant not in ('opportunity','additive_routes','graded_access') or len(beta)!=8:
        raise ValueError('unrecognized frozen candidate')
    if variant=='opportunity' and any(beta[6:]):
        raise ValueError('opportunity candidate must not contain synergy')
    ctx=Context(metadata)
    result=[]
    for cid,stratum,cohort,row,pick,i in internal:
        v=row
        if variant!='opportunity':
            a,b,_=ctx.describe(row,cases[int(cid.rsplit('-',1)[1])-1]['prior_pool'])
            v=Choice(row.source,row.event_time,row.candidates,row.support,a if variant=='additive_routes' else b,row.chosen)
        result.append({'case_id':cid,'set':set_id,'stratum':stratum,
            'v6_score':grade(weights(row,(0.,)*8))[i],
            'candidate_score':grade(weights(v,beta))[i]})
    return {'candidate_id':frozen['candidate_id'],'set':set_id,
            'sample_sha256':expected_sample_sha256,'source_distinct_within_set':len(internal)==len({x[3].source for x in internal}),
            'cases':result,'note':'model-only ratio scores, not historical trophy awards'}


def csv_rows(path):
    rows={}
    with Path(path).open(encoding='utf-8-sig',newline='') as f:
        reader=csv.DictReader(f)
        if not reader.fieldnames or 'case_id' not in reader.fieldnames or len(set(reader.fieldnames))!=len(reader.fieldnames):
            raise ValueError('invalid review CSV header')
        for row in reader:
            cid=row['case_id']
            if not cid or cid in rows or None in row:
                raise ValueError('invalid or duplicate review case ID')
            rows[cid]=row
    return rows


def rating(row):
    if not str(row.get('reason','')).strip():
        raise ValueError('review reason required')
    if str(row.get('abstain','')).strip().lower() in ('yes','true','1'):
        return None
    value=str(row.get('quality_band','')).strip().lower()
    if value not in BANDS or not str(row.get('confidence','')).strip():
        raise ValueError('require a quality band and confidence, or explicit abstention')
    return BANDS.index(value)


def agreement(pairs):
    n=len(pairs)
    if not n:
        return {'n':0,'weighted_kappa':None}
    observed=sum((a-b)**2 for a,b in pairs)/n
    a,b=Counter(x for x,y in pairs),Counter(y for x,y in pairs)
    expected=sum(a[i]*b[j]*(i-j)**2 for i in range(5) for j in range(5))/n**2
    return {'n':n,'exact':sum(x==y for x,y in pairs)/n,
            'within_one':sum(abs(x-y)<=1 for x,y in pairs)/n,
            'weighted_kappa':1-observed/expected if expected else None}


def compare_rates(rows,predicate,seed=1863):
    """Paired bootstrap over distinct draft cases, no model tuning here."""
    if not rows:
        return {'n':0,'baseline_errors':0,'candidate_errors':0,'relative_reduction':None,'delta_ci95':None}
    pairs=[(bool(predicate(r['v6_score'])),bool(predicate(r['candidate_score']))) for r in rows]
    c=Counter(pairs)
    n=len(pairs)
    old=sum(x for x,y in pairs); new=sum(y for x,y in pairs)
    p=np.asarray([c[False,False],c[False,True],c[True,False],c[True,True]],dtype=float)/n
    draws=np.random.default_rng(seed).multinomial(n,p,size=10000)
    deltas=(draws[:,1]-draws[:,2])/n
    return {'n':n,'baseline_errors':old,'candidate_errors':new,
        'baseline_rate':old/n,'candidate_rate':new/n,
        'relative_reduction':(old-new)/old if old else None,
        'delta':(new-old)/n,'delta_ci95':[float(x) for x in np.quantile(deltas,[.025,.975])],
        'improved_cases':c[True,False],'worsened_cases':c[False,True]}


def planned_power():
    # Normal approximation for 80% power, two-sided 5% level. Conditional
    # group sizes, not total review packet sizes. Assumed not observed rates.
    out=[]
    for name,target in TARGETS.items():
        for rate in (.10,.20,.30):
            delta=rate*target
            for discordance in (.10,.20,.30):
                if delta>discordance or discordance>2*rate-delta:
                    continue
                n=math.ceil((1.959964+.841621)**2*(discordance-delta**2)/delta**2)
                out.append({'endpoint':name,'assumed_v6_error_rate':rate,'assumed_discordance':discordance,'paired_group_n_approx':n})
    return out


def evaluate(keys,review1,review2,adjudication):
    cases={}
    candidate_ids={key['candidate_id'] for key in keys}
    if len(candidate_ids)!=1 or len({key['set'] for key in keys})!=len(keys):
        raise ValueError('require one frozen candidate and unique environments')
    for key in keys:
        if not key.get('source_distinct_within_set') or not key.get('sample_sha256'):
            raise ValueError('require source-distinct pinned sample')
        for row in key['cases']:
            cid=row['case_id']
            if cid in cases or row['stratum'] not in STRATA or row['set']!=key['set']:
                raise ValueError('duplicate or invalid score-key case')
            if any(type(row[k]) is not int or not 0<=row[k]<=95 for k in ('v6_score','candidate_score')):
                raise ValueError('invalid model-only grade')
            cases[cid]=row
    if not (set(cases)==set(review1)==set(review2)==set(adjudication)):
        raise ValueError('reviews and adjudication must match all locked case IDs; mark abstentions explicitly')
    pairs=[]; qualified=[]; exclusions=Counter()
    for cid,key in cases.items():
        a,b=rating(review1[cid]),rating(review2[cid])
        adj=adjudication[cid]
        if not str(adj.get('reason','')).strip():
            raise ValueError('adjudication reason required')
        if a is None or b is None:
            exclusions['reviewer_abstention']+=1
            continue
        pairs.append((a,b))
        band=str(adj.get('quality_band','')).strip().lower()
        if band=='abstain':
            exclusions['adjudicator_abstention']+=1
            continue
        if band not in BANDS:
            raise ValueError('require adjudicated quality band')
        q=BANDS.index(band)
        if a==b and q!=a:
            raise ValueError('adjudication cannot silently override reviewer agreement')
        if str(adj.get('confirmed_stratum','')).strip()!=key['stratum']:
            exclusions['screen_not_confirmed']+=1
            continue
        qualified.append(dict(key,quality=q))
    counts=Counter(r['stratum'] for r in qualified)
    coverage=all(counts[s]>=100 for s in STRATA) and len(qualified)>=500
    primary={
        'questionable_high':compare_rates([r for r in qualified if r['quality']<=1],lambda s:s>=90),
        'excellent_low':compare_rates([r for r in qualified if r['quality']==4],lambda s:s<75),
    }
    gates={}
    for name,metric in primary.items():
        rel=metric['relative_reduction']; ci=metric['delta_ci95']
        gates[name]=bool(rel is not None and rel>=TARGETS[name] and metric['baseline_errors']>=MIN_ERROR_EVENTS and ci is not None and ci[1]<0)
    guard={}
    for stratum in ('splash_fixing','early_speculation','close_alternative'):
        metric=compare_rates([r for r in qualified if r['stratum']==stratum and r['quality']>=3],lambda s:s<75)
        guard[stratum]={'metric':metric,'noninferiority_pass':bool(metric['n']>=50 and metric['delta_ci95'] and metric['delta_ci95'][1]<=NONINFERIORITY_MARGIN)}
    all_gates=coverage and all(gates.values()) and all(x['noninferiority_pass'] for x in guard.values())
    return {'candidate_id':next(iter(candidate_ids)),'cases':len(cases),'qualified':len(qualified),
        'qualified_by_stratum':dict(counts),'excluded':dict(exclusions),
        'reviewer_agreement':agreement(pairs),'coverage_pass':coverage,
        'primary':primary,'primary_gate':gates,'safety_guard':guard,
        'quality_gate_pass':all_gates,'final_assessment':'still_required',
        'scope':'targeted blinded human review, if attestations valid; not population rate or rollout approval',
        'power_plan_assumptions':planned_power(),
        'note':'A small or inconclusive sample cannot promote a candidate. Report absolute rates and relative reductions.'}


def self_test():
    assert agreement([(0,0),(4,4)])['weighted_kappa']==1
    assert compare_rates([],lambda x:x>=90)['relative_reduction'] is None
    rows=[{'v6_score':95,'candidate_score':60}]*60+[{'v6_score':20,'candidate_score':90}]*10
    r=compare_rates(rows,lambda x:x>=90)
    assert r['baseline_errors']==60 and r['candidate_errors']==10 and r['delta_ci95'][1]<0
    keys=[{'candidate_id':'synthetic','set':'TEST','sample_sha256':'fixture','source_distinct_within_set':True,
           'cases':[{'case_id':'TEST-001','set':'TEST','stratum':'splash_fixing','v6_score':40,'candidate_score':85}]}]
    review={'TEST-001':{'quality_band':'excellent','reason':'fixture only','confidence':'high','abstain':'no'}}
    adj={'TEST-001':{'quality_band':'excellent','reason':'fixture only','confirmed_stratum':'splash_fixing'}}
    result=evaluate(keys,review,review,adj)
    assert result['qualified']==1 and not result['coverage_pass'] and not result['quality_gate_pass']
    assert result['final_assessment']=='still_required'
    print('Synthetic review-evaluation contracts passed; no human reviews or actual model-quality gate completed.')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--power-plan',action='store_true')
    p.add_argument('--scores',type=Path,nargs='+')
    p.add_argument('--reviews',type=Path,nargs=2)
    p.add_argument('--adjudication',type=Path)
    p.add_argument('--lock',type=Path)
    p.add_argument('--output',type=Path)
    a=p.parse_args()
    if a.self_test:
        self_test()
        return
    if a.power_plan:
        print(json.dumps(planned_power(),indent=2))
        return
    if not all((a.scores,a.reviews,a.adjudication,a.lock,a.output)):
        p.error('provide score keys, two reviews, adjudication, a frozen review lock and output')
    lock=json.loads(a.lock.read_text())
    if not lock.get('reviewers_independent_attested') or not lock.get('model_blind_attested') or not lock.get('adjudication_blind_attested'):
        raise ValueError('explicit independent/blind reviewer attestations required; software cannot authenticate expertise')
    if [sha(x) for x in a.reviews]!=lock.get('review_sha256') or sha(a.adjudication)!=lock.get('adjudication_sha256'):
        raise ValueError('review files differ from frozen lock')
    keys=[json.loads(x.read_text()) for x in a.scores]
    if {x['set']:x['sample_sha256'] for x in keys}!=lock.get('sample_sha256_by_set'):
        raise ValueError('score keys do not match locked review packets')
    result=evaluate(keys,*[csv_rows(x) for x in a.reviews],csv_rows(a.adjudication))
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n',encoding='utf8')


if __name__=='__main__':
    main()
