"""Skill-aware conditional-choice contrast, development-only #1863.

Two regularized choice models fit strong and ordinary public draft choices
on the SAME residual time window and v6 offset. The candidate anchors on v6,
adds half their relative preference contrast, and caps the log multiplier.
No observed validation labels, future picks, player IDs or outcomes in fit.
"""
import argparse
from collections import Counter, defaultdict
import gzip
import json
import math
from pathlib import Path

import numpy as np
from scipy.optimize import minimize
from scipy.special import logsumexp

import pool_aware_statistical_validation as stat
from pool_aware_archive import (
    MIN_GAMES, BaselineView, choice, load_manifest, read_json, read_picks,
    rows, scan_baseline_games, scan_drafts, select_sources, sha256,
)
from pool_aware_refit import Choice, FEATURES, evaluate, weights
from pool_aware_diagnostics import diagnostics
from build_replays import (
    candidate_columns, pool_columns, parse_example, parse_rate_bucket,
    parse_games_lower_bound, quantile_cutoff, normalize_probabilities,
)
from assess_v6_colour_model import build_models
from model_training import V6_MODEL

NAME='skill-aware'
KEY=NAME+'|1'
PROTOCOL='skill-contrast-v1'
LAMBDA=.5
MAX_LOG_ADJUST=math.log(1.25)
CONTEXT_PENALTY=.02
CARD_PRIOR=30.
MIN_OFFERED=100
ZERO=stat.ZERO
APPLY=(0.,)*6+(1.,0.)
SOURCE=Path(__file__).resolve()


def read_served(path, eligible, model, metadata, pack_offset, pick_offset, max_pick):
    """Stream only the required slice, not millions of ordinary P2/P3 rows."""
    groups=defaultdict(list)
    coverage=defaultdict(Counter)
    seen=set()
    for header,idx,reader in rows(path):
        pack,pool=candidate_columns(header),pool_columns(header)
        if not pack or not pool:
            raise ValueError('missing pack/pool columns')
        for values in reader:
            d=values[idx['draft_id']].strip()
            if d not in eligible:
                continue
            label,info=eligible[d]
            try:
                pk=int(float(values[idx['pack_number']]))+pack_offset
                pi=int(float(values[idx['pick_number']]))+pick_offset
            except (ValueError,TypeError,OverflowError):
                coverage[label]['invalid_numbering']+=1
                continue
            if pk!=1 or not 1<=pi<=max_pick:
                continue
            ex=parse_example(dict(zip(header,values)),pack,pool)
            if ex is None or len(ex.candidates)<2:
                coverage[label]['unusable_pack']+=1
                continue
            k=(d,pk,pi)
            if k in seen:
                raise ValueError('duplicate served draft/pick')
            seen.add(k)
            if sum(ex.pool.values())!=pi-1:
                coverage[label]['invalid_prior_length']+=1
                continue
            row,prior,counts=choice(ex,info[1],model,metadata,(),normalize_probabilities)
            coverage[label].update(counts)
            # The feature extractor has already used the real prior pool.
            # No need to keep the card-name pool tuples in the training rows.
            groups[label].append((row,(),pi))
    return groups,coverage


def prepare(manifest,prior_report):
    lock=stat.verify_source_lock()
    previous=read_json(prior_report)
    p=previous['provenance']
    m,windows,files=load_manifest(manifest)
    sid=m['set']
    if (sid not in stat.SETS or p['set']!=sid or p['mode']!=m['mode']
        or m['mode']!='PremierDraft' or p['lock_sha256']!=sha256(stat.LOCK)
        or previous['release_allowed'] or previous['quality_labels_used']
        or p['windows']!=m['windows'] or p['purge_days']!=m['purge_days']
        or p['sources']!={k:v['sha256'] for k,v in m['sources'].items()}
        or read_json(files['interactions'])!={'schema':1,'edges':[]}):
        raise ValueError('prior statistical report and restored inputs disagree')
    sources,inconsistent=scan_drafts(files['draft'],windows,parse_rate_bucket,parse_games_lower_bound)
    linked,crossed=scan_baseline_games(files['games'],sources,windows['baseline'][1])
    strong,control,cutoff=select_sources(sources,crossed,quantile_cutoff)
    baseline={d:v for d,v in strong.items() if v[0]=='baseline'}
    base,skips=read_picks(files['draft'],baseline,parse_example,candidate_columns,pool_columns)
    if set(base)!=set(baseline) or not set(base)&set(linked):
        raise ValueError('missing baseline drafts or linked games')
    if len(base)!=p['baseline_drafts'] or cutoff!=p['baseline_cutoff']:
        raise ValueError('previous v6 baseline cohort mismatch')
    models,colour_coverage,baseline_picks=build_models(BaselineView(sid,base),files['games'],sorted(base))
    if baseline_picks!=p['baseline_picks'] or colour_coverage[V6_MODEL]!=p['baseline_colour_coverage']:
        raise ValueError('previous v6 baseline fit parity failure')
    pack_min=min(x.raw_pack_number for xs in base.values() for x in xs)
    pick_min=min(x.raw_pick_number for xs in base.values() for x in xs)
    if pack_min not in (0,1) or pick_min not in (0,1):
        raise ValueError('invalid archive numbering')
    model=models[V6_MODEL]
    del base,models
    eligible={}
    for d,v in sources.items():
        phase,t,rate,games=v
        if phase not in ('residual','validation') or d in crossed or rate is None or games is None or games<MIN_GAMES:
            continue
        cohort='elite' if rate>=cutoff else 'control'
        eligible[d]=(phase+'_'+cohort,v)
    if set(baseline)&set(eligible):
        raise ValueError('baseline leakage')
    max_pick=11 if sid=='powered-cube' else 10
    groups,coverage=read_served(files['draft'],eligible,model,read_json(files['metadata']),1-pack_min,1-pick_min,max_pick)
    labels=('residual_elite','residual_control','validation_elite','validation_control')
    ids=set()
    for label in labels:
        records=groups[label]
        current={r.source for r,_,_ in records}
        if not current or ids&current:
            raise ValueError('empty or overlapping residual/validation cohort')
        ids.update(current)
    # Compare every observed validation choice with the prior run's exact
    # v6 metrics before fitting the new contrast. Do not select parameters.
    for c in ('elite','control'):
        rr=[r for r,_,_ in groups['validation_'+c]]
        actual=evaluate(rr,ZERO)
        expected=previous['cohorts'][c]['prediction']['v6']
        for metric in ('decisions','top1','raw_log_loss','display_log_loss','display_brier'):
            if not math.isclose(actual[metric],expected[metric],rel_tol=1e-9,abs_tol=1e-10):
                raise ValueError('previous validation parity mismatch '+c+'/'+metric)
    provenance={'set':sid,'mode':m['mode'],'sources':p['sources'],'windows':p['windows'],
        'purge_days':p['purge_days'],'baseline_model':V6_MODEL,'baseline_cutoff':cutoff,
        'baseline_drafts':len(baseline),'baseline_picks':baseline_picks,
        'previous_report_sha256':sha256(prior_report),'lock_sha256':sha256(stat.LOCK),
        'research_code_sha256':sha256(SOURCE),'stat_helper_sha256':sha256(Path(stat.__file__)),
        'partitions':{label:{'decisions':len(groups[label]),'drafts':len({r.source for r,_,_ in groups[label]}),
                            'coverage':dict(coverage[label])} for label in labels}}
    return sid,groups,files['draft'],provenance


def eligible_cards(elite,control):
    counts=[Counter(n for r in rs for n in r.candidates) for rs in (elite,control)]
    return tuple(sorted(n for n,v in counts[0].items() if v>=MIN_OFFERED and counts[1][n]>=MIN_OFFERED))


def cohort_fit(records,cards,card_penalty):
    """Conditional multinomial likelihood, not a classifier of draft identity.

    Every offered candidate enters the denominator. Shared regularization is
    identical across cohorts. The sentinel for sparse/unknown cards is fixed 0.
    """
    n=len(records)
    if not n or not math.isfinite(card_penalty) or card_penalty<=0:
        raise ValueError('invalid fit')
    width=max(len(r.candidates) for r in records)
    size=len(cards); ix=np.arange(n); ids={c:i for i,c in enumerate(cards)}
    offset=np.full((n,width),-np.inf)
    features=np.zeros((n,width,6))
    indexes=np.full((n,width),size,dtype=np.intp)
    chosen=np.empty(n,dtype=np.intp)
    for i,row in enumerate(records):
        k=len(row.candidates)
        offset[i,:k]=np.log(row.support)
        features[i,:k,:]=np.asarray(row.features)[:,:6]
        indexes[i,:k]=[ids.get(c,size) for c in row.candidates]
        chosen[i]=row.chosen
    chosen_features=features[ix,chosen].mean(axis=0)
    chosen_cards=np.bincount(indexes[ix,chosen],minlength=size+1)[:size]/n
    def objective(b):
        ctx,card=b[:6],b[6:]
        effects=np.append(card,0.)
        logits=offset+np.einsum('nkd,d->nk',features,ctx)+effects[indexes]
        norm=logsumexp(logits,axis=1)
        probs=np.exp(logits-norm[:,None])
        loss=(norm-logits[ix,chosen]).mean()+.5*(CONTEXT_PENALTY*np.dot(ctx,ctx)+card_penalty*np.dot(card,card))
        gctx=np.einsum('nk,nkd->d',probs,features)/n-chosen_features+CONTEXT_PENALTY*ctx
        gcard=np.bincount(indexes.ravel(),weights=probs.ravel(),minlength=size+1)[:size]/n-chosen_cards+card_penalty*card
        return float(loss),np.concatenate([gctx,gcard])
    result=minimize(objective,np.zeros(6+size),jac=True,method='L-BFGS-B',
        options={'maxiter':1000,'gtol':1e-6/math.sqrt(6+size),'ftol':1e-15})
    loss,grad=objective(result.x)
    gradient=float(np.linalg.norm(grad))
    if not math.isfinite(loss) or gradient>1e-6:
        raise RuntimeError('conditional fit did not converge: '+str(gradient))
    return tuple(map(float,result.x[:6])),dict(zip(cards,map(float,result.x[6:]))),{
        'decisions':n,'iterations':int(result.nit),'objective':loss,'gradient_norm':gradient,'converged':True}


def contrast(row,context,card_effects):
    raw=[sum(a*b for a,b in zip(f[:6],context))+card_effects.get(c,0.)
         for c,f in zip(row.candidates,row.features)]
    center=sum(raw)/len(raw)
    return tuple(max(-MAX_LOG_ADJUST,min(MAX_LOG_ADJUST,LAMBDA*(v-center))) for v in raw)


def apply(row,context,card_effects):
    correction=contrast(row,context,card_effects)
    features=tuple(f[:6]+(delta,0.) for f,delta in zip(row.features,correction))
    return Choice(row.source,row.event_time,row.candidates,row.support,features,row.chosen)


def predict_pairs(records,context,card_effects):
    return [(apply(r,context,card_effects),pool,pick) for r,pool,pick in records]


def measure(manifest,prior_report,output):
    sid,groups,draft_path,provenance=prepare(manifest,prior_report)
    e=[r for r,_,_ in groups.pop('residual_elite')]
    o=[r for r,_,_ in groups.pop('residual_control')]
    cards=eligible_cards(e,o)
    penalty=CARD_PRIOR/min(len(e),len(o))
    print(f'{sid}: residual strong={len(e)}, ordinary={len(o)}, eligible cards={len(cards)}',flush=True)
    ec,ei,ef=cohort_fit(e,cards,penalty)
    oc,oi,of=cohort_fit(o,cards,penalty)
    del e,o
    context=tuple(a-b for a,b in zip(ec,oc))
    card_effects={c:ei[c]-oi[c] for c in cards}
    # Fit is complete before any validation score is computed; the earlier
    # parity check was solely the unchanged incumbent, not model selection.
    val=predict_pairs(groups['validation_elite'],context,card_effects)
    ordinary=predict_pairs(groups['validation_control'],context,card_effects)
    del groups
    outcomes=stat.selected_outcomes(draft_path,{r.source for r,_,_ in val+ordinary})
    cohorts,bank=stat.summarize(sid,APPLY,val,ordinary,outcomes,candidate_name=NAME)
    for label,records in [('elite',val),('control',ordinary)]:
        report=diagnostics(records,APPLY)
        cohorts[label]['context_diagnostics']=report
        cohorts[label]['correction_summary']={
            'offered':sum(len(r.features) for r,_,_ in records),
            'capped':sum(abs(f[6])>=MAX_LOG_ADJUST-1e-12 for r,_,_ in records for f in r.features),
            'mean_abs_log_adjustment':sum(abs(f[6]) for r,_,_ in records for f in r.features)/sum(len(r.features) for r,_,_ in records)}
    output.mkdir(parents=True,exist_ok=True)
    bank_file=output/'simulation-bank.json.gz'
    bank_file.write_bytes(gzip.compress(json.dumps({'set':sid,'rows':bank},separators=(',',':')).encode(),mtime=0))
    result={'protocol':PROTOCOL,'scope':'historical development; no newly untouched final data',
        'provenance':provenance,'cohorts':cohorts,'bank_sha256':sha256(bank_file),
        'fit':{'features':list(FEATURES[:6]),'eligible_card_count':len(cards),'minimum_offered_in_each_fit_cohort':MIN_OFFERED,
               'context_penalty':CONTEXT_PENALTY,'card_penalty':penalty,'card_prior':CARD_PRIOR,
               'lambda':LAMBDA,'max_log_adjustment':MAX_LOG_ADJUST,'elite':ef,'control':of,
               'elite_context':ec,'control_context':oc,'elite_card_effects':ei,'control_card_effects':oi},
        'simulation':stat.simulate(list(stat.simulation_rows(sid,bank,NAME)),
            'powered-cube' if sid=='powered-cube' else 'mixed',candidate_name=NAME),
        'score_formula':'unchanged linear ratio, cap 95, no trophy override','release_allowed':False}
    (output/'score-report.json').write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    print(json.dumps({'set':sid,'fit':{'elite':ef,'control':of,'eligible_cards':len(cards)},
        'cohort_decisions':{k:v['decisions'] for k,v in cohorts.items()},
        'prediction':{k:v['prediction'] for k,v in cohorts.items()},
        'observed_scores':{k:v['scores']['all'] for k,v in cohorts.items()},
        'simulation':result['simulation'],'context_diagnostics':cohorts['elite']['context_diagnostics']},indent=2))


def aggregate(directory,output):
    reports={}; banks={}
    for path in sorted(directory.glob('pool-aware-skill-bank-*/score-report.json')):
        report=read_json(path); p=report['provenance']; sid=p['set']
        if (report['protocol']!=PROTOCOL or report['release_allowed'] or sid not in stat.SETS or sid in reports
            or p['lock_sha256']!=sha256(stat.LOCK) or p['research_code_sha256']!=sha256(SOURCE)
            or p['stat_helper_sha256']!=sha256(Path(stat.__file__))):
            raise ValueError('incompatible report')
        bank=path.parent/'simulation-bank.json.gz'
        if sha256(bank)!=report['bank_sha256']:
            raise ValueError('bank checksum mismatch')
        data=read_json(bank)
        if data['set']!=sid:
            raise ValueError('bank set mismatch')
        banks[sid]=list(stat.simulation_rows(sid,data['rows'],NAME)); reports[sid]=report
    if not reports:
        raise ValueError('no measurements')
    missing=sorted(set(stat.SETS)-set(reports))
    result={'protocol':PROTOCOL,'scope':'historical development only','expected_sets':list(stat.SETS),
            'completed_sets':sorted(reports),'missing_sets':missing,'sets':reports,'runs':{},'release_allowed':False}
    for sid,r in reports.items():
        elite=r['cohorts']['elite']; a=elite['scores']['all']
        pred=elite['context_diagnostics']['paired']['all']
        r['guardrails']={'severe_tail_delta':a[NAME]['below_25']-a['v6']['below_25'],
            'severe_tail_safe':a[NAME]['below_25']<=a['v6']['below_25']+stat.TAIL_LIMIT,
            'raw_log_loss_delta':pred['raw_log_loss'],
            'raw_log_loss_safe':pred['raw_log_loss']['ci95'] is not None and pred['raw_log_loss']['ci95'][1]<=.005,
            'top1_delta':pred['top1'],
            'top1_safe':pred['top1']['ci95'] is not None and pred['top1']['ci95'][0]>=-.01}
    for env in ('mixed','powered-cube'):
        selected=[s for s in reports if (s=='powered-cube')==(env=='powered-cube')]
        if not selected:
            continue
        sim=stat.simulate([r for sid in selected for r in banks[sid]],env,10000,stat.BOOTSTRAP_DRAWS,2000,candidate_name=NAME)
        comp=sim['configurations'].get(KEY)
        sim['development_gate']={'coverage_complete':not missing and sim.get('status')=='complete',
            'auc_delta_positive_interval':bool(comp and comp['delta_ci95'] and comp['delta_ci95'][0]>0),
            'all_set_guardrails_safe':all(all(reports[s]['guardrails'][k] for k in ('severe_tail_safe','raw_log_loss_safe','top1_safe')) for s in selected)}
        result['runs'][env]=sim
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    print(json.dumps({'completed_sets':result['completed_sets'],'missing_sets':missing,'runs':result['runs'],
        'sets':{s:{'guardrails':r['guardrails'],'simulation':r['simulation']} for s,r in reports.items()}},indent=2))


def self_test():
    stat.self_test()
    def record(i,c,cohort):
        return Choice(f'{cohort}-{i}','2026-01-01T00:00:00Z',('a','b'),(.5,.5),
            ((0.,)*8,(0.,)*8),c)
    e=[record(i,0 if i%5 else 1,'e') for i in range(150)]
    o=[record(i,1 if i%5 else 0,'o') for i in range(150)]
    cards=eligible_cards(e,o);assert cards==('a','b')
    p=CARD_PRIOR/min(len(e),len(o))
    ec,ei,ef=cohort_fit(e,cards,p);oc,oi,of=cohort_fit(o,cards,p)
    ctx=tuple(a-b for a,b in zip(ec,oc)); ci={c:ei[c]-oi[c] for c in cards}
    row=e[1]
    assert weights(apply(row,ctx,ci),APPLY)[0]>.5
    assert weights(apply(row,(0.,)*6,{}),APPLY)==weights(row,ZERO)
    assert max(abs(x) for x in contrast(row,(0.,)*6,{'a':100.,'b':-100.}))<=MAX_LOG_ADJUST
    r,bank=stat.summarize('dft',APPLY,[(apply(row,ctx,ci),(),1)],[(apply(o[1],ctx,ci),(),1)],{},candidate_name=NAME)
    assert NAME in r['elite']['scores']['all']
    # Real integration, including missing P1P1 formats and separate Cube.
    for sid,env,first in [('dft','mixed',1),('tmt','mixed',2),('powered-cube','powered-cube',2)]:
        synthetic=[[c,d,pick,b,60 if c=='elite' else 40,70 if c=='elite' else 38]
            for c in ('elite','control') for d in range(12) for pick in range(first,first+8)
            for b in ('easy','medium','hard')]
        sim=stat.simulate(list(stat.simulation_rows(sid,synthetic,NAME)),env,20,2,10,candidate_name=NAME)
        assert sim['status']=='complete' and sim['configurations'][KEY]['auc']==1
    print('Skill-aware conditional-fit, bounded contrast, baseline neutrality and profile integration contracts passed.')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--manifest',type=Path)
    p.add_argument('--prior-report',type=Path)
    p.add_argument('--aggregate',type=Path)
    p.add_argument('--output',type=Path)
    a=p.parse_args()
    if a.self_test:
        self_test();return
    if not a.output:
        p.error('--output required')
    if a.aggregate:
        aggregate(a.aggregate,a.output)
    elif a.manifest and a.prior_report:
        measure(a.manifest,a.prior_report,a.output)
    else:
        p.error('--manifest and --prior-report, or --aggregate required')


if __name__=='__main__':
    main()
