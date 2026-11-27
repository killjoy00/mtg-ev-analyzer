"""Compare the frozen opportunity challenger with v6 using observed choices.

Reuse the established eight-pick profile generator, paired simulation and
source-draft bootstrap from scoring_experiment.py. No trophy override or
AI/human labels in this statistical evaluation. Historical development data
are not a newly untouched assessment. Never read final-assessment labels.
"""
import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path
import statistics

import scoring_experiment as scoring
from grading_curve import curve_score
from pool_aware_archive import (
    BaselineView, load_manifest, read_json, read_picks, scan_drafts,
    scan_baseline_games, select_sources, served, sha256, rows,
)
from pool_aware_refit import FEATURES, weights, evaluate
from pool_aware_fast_fit import fit
from pool_aware_diagnostics import interval, grade
from pick_value import stratum_correlations, pool_fisher

ROOT=Path(__file__).resolve().parents[1]
LOCK=ROOT/'research/pool-aware-candidate-lock-v1.json'
ORIGINAL=('dft','tdm','ktk','hob','powered-cube')
EXTENSION=('eoe','fin','ecl','tmt','sos')
SETS=ORIGINAL+EXTENSION
BASE='v6|1'
CAND='opportunity|1'
ZERO=(0.,)*len(FEATURES)
PENALTY=.02
SEED=20260916
DAY='2026-11-26'
RUNS=5000
BOOTSTRAP_DRAWS=200
BOOTSTRAP_RUNS=1000
TAIL_LIMIT=.01

# The legacy helper's source_banks requires a "v2" probability vector only to
# count the offered cards. For our anonymized simulation rows this contains
# four dummy entries, never a v2 prediction. All actual grades are v6/challenger.
def configure():
    scoring.MODELS=['v6','opportunity']
    scoring.EXPONENTS=[1.]
    scoring.BASELINE=BASE
    scoring.SEED=SEED


def restore_partitions(manifest, prior_report=None):
    from assess_v6_colour_model import build_models
    from model_training import V6_MODEL
    from build_replays import (candidate_columns, pool_columns, parse_example,
        parse_rate_bucket, parse_games_lower_bound, quantile_cutoff, normalize_probabilities)
    m, windows, files=load_manifest(manifest)
    lock=read_json(LOCK)
    sid=m['set']
    if sid not in SETS or m['mode']!='PremierDraft' or V6_MODEL!=lock['baseline_model']:
        raise ValueError('unexpected set, mode or baseline')
    if lock['variant']!='opportunity' or lock['release_allowed'] or tuple(lock['feature_names'])!=FEATURES:
        raise ValueError('invalid frozen candidate identity')
    for name, digest in lock['code_sha256'].items():
        if sha256(ROOT/'scripts'/name)!=digest:
            raise ValueError('frozen model source code mismatch: '+name)
    if read_json(files['interactions'])!={'schema':1,'edges':[]}:
        raise ValueError('synergy is excluded')
    pinned=lock['environments'].get(sid)
    if pinned:
        if prior_report is None:
            raise ValueError('original development report is required')
        previous=read_json(prior_report)
        if (previous['set']!=sid or previous['status']!='development_only'
            or previous['final_assessment']!='locked'
            or {k:v['sha256'] for k,v in previous['sources'].items()}!=pinned['sources']
            or previous['windows']!=pinned['windows']
            or previous['purge_days']!=pinned['purge_days']
            or list(previous['arms']['opportunity']['beta'])!=pinned['beta']
            or previous['arms']['opportunity']['penalty']!=pinned['penalty']):
            raise ValueError('original report and lock disagree')
        if (m['windows']!=pinned['windows'] or m.get('purge_days',7)!=pinned['purge_days']
            or {k:v['sha256'] for k,v in m['sources'].items()}!=pinned['sources']):
            raise ValueError('source hashes or chronological windows changed')
    elif m.get('purge_days',7)!=0:
        raise ValueError('extensions use the predeclared contiguous split')
    sources,invalid=scan_drafts(files['draft'],windows,parse_rate_bucket,parse_games_lower_bound)
    linked,crossed=scan_baseline_games(files['games'],sources,windows['baseline'][1])
    strong,control,cutoff=select_sources(sources,crossed,quantile_cutoff)
    eligible=strong|control
    # Frozen original fits need no residual-training labels on this run.
    if pinned:
        eligible={d:v for d,v in eligible.items() if v[0]!='residual'}
    grouped,skipped=read_picks(files['draft'],eligible,parse_example,candidate_columns,pool_columns)
    base={d:xs for d,xs in grouped.items() if d in strong and strong[d][0]=='baseline'}
    expected={d for d,v in strong.items() if v[0]=='baseline'}
    if not base or expected!=set(base) or not set(base)&set(linked):
        raise ValueError('missing qualifying baseline draft or linked games')
    if pinned and (len(base)!=pinned['baseline_drafts'] or cutoff!=pinned['baseline_cutoff']):
        raise ValueError('frozen baseline cohort mismatch')
    models,coverage,baseline_picks=build_models(BaselineView(sid,base),files['games'],sorted(base))
    model=models[V6_MODEL]
    pack_min=min(x.raw_pack_number for xs in base.values() for x in xs)
    pick_min=min(x.raw_pick_number for xs in base.values() for x in xs)
    if pack_min not in (0,1) or pick_min not in (0,1):
        raise ValueError('invalid archive numbering')
    metadata=read_json(files['metadata'])
    records={}
    for phase,cohort in [('residual',strong),('validation',strong),('ordinary_validation',control)]:
        if phase=='residual' and pinned:
            continue
        which='validation' if phase=='ordinary_validation' else phase
        subset={d:xs for d,xs in grouped.items() if d in cohort and cohort[d][0]==which}
        records[phase]=served(subset,cohort,model,metadata,(),normalize_probabilities,1-pack_min,1-pick_min)
    del grouped
    validation,ordinary=(records[k][0] for k in ('validation','ordinary_validation'))
    if not validation or not ordinary:
        raise ValueError('empty validation cohort')
    validation_ids={r.source for r,_,_ in validation}
    ordinary_ids={r.source for r,_,_ in ordinary}
    fit_ids=set(base)|{r.source for r,_,_ in records.get('residual',([],{}))[0]}
    if validation_ids&ordinary_ids or fit_ids&(validation_ids|ordinary_ids):
        raise ValueError('source leakage')
    if pinned:
        beta=tuple(pinned['beta'])
        penalty=pinned['penalty']
        fit_status='exact_locked_original_coefficients'
        for phase,rr in [('validation',validation),('ordinary_validation',ordinary)]:
            key=phase
            choices=[r for r,_,_ in rr]
            for arm,b in [('baseline',ZERO),('opportunity',beta)]:
                actual=evaluate(choices,b)
                expected_metric=previous['arms'][arm][key]
                for metric in ('decisions','top1','raw_log_loss','display_log_loss','display_brier'):
                    if not math.isclose(actual[metric],expected_metric[metric],rel_tol=1e-9,abs_tol=1e-10):
                        raise ValueError('locked report parity failed: '+phase+'/'+arm+'/'+metric)
    else:
        train=[r for r,_,_ in records['residual'][0]]
        beta,info=fit(train,'opportunity',PENALTY,max_iter=1000,tol=1e-6)
        if not info['converged']:
            raise ValueError('fixed-penalty extension fit did not converge')
        penalty=PENALTY
        fit_status='frozen_recipe_fit_on_residual_only'
    if any(beta[6:]):
        raise ValueError('unexpected synergy coefficients')
    provenance={'set':sid,'mode':m['mode'],'candidate_id':lock['candidate_id'],
        'lock_sha256':sha256(LOCK),'coefficient_status':fit_status,'beta':list(beta),'penalty':penalty,
        'sources':{k:v['sha256'] for k,v in m['sources'].items()},'windows':m['windows'],
        'purge_days':m.get('purge_days',7),'baseline_drafts':len(base),'baseline_picks':baseline_picks,
        'baseline_cutoff':cutoff,'baseline_colour_coverage':coverage[V6_MODEL],
        'purged_game_crossings':len(crossed),'inconsistent_drafts':invalid,
        'partitions':{k:{'decisions':len(v[0]),'drafts':len({r.source for r,_,_ in v[0]}),'coverage':v[1]} for k,v in records.items()}}
    return sid,beta,validation,ordinary,files['draft'],provenance


def selected_outcomes(path, wanted):
    # Outcome is used only for reporting observed validation draft correlations.
    # No outcome is passed to model fitting, prediction, or synthetic runs.
    result={}; invalid=set()
    for header,idx,reader in rows(path):
        needed=('draft_id','event_match_wins','user_game_win_rate_bucket')
        if not all(k in idx for k in needed):
            return {}
        for v in reader:
            d=v[idx['draft_id']].strip()
            if d not in wanted:
                continue
            try:
                wins=int(float(v[idx['event_match_wins']]))
            except (ValueError,TypeError,OverflowError):
                continue
            if not 0<=wins<=7:
                continue
            item=(v[idx['user_game_win_rate_bucket']].strip(),wins)
            if d in result and result[d]!=item:
                invalid.add(d)
            result[d]=item
    for d in invalid:
        result.pop(d,None)
    return result


def award_summary(values):
    if not values:
        return None
    return {'n':len(values),'mean':statistics.fmean(values),
            'below_25':sum(v<25 for v in values)/len(values),
            'below_40':sum(v<40 for v in values)/len(values),
            'at_least_75':sum(v>=75 for v in values)/len(values),
            'at_least_90':sum(v>=90 for v in values)/len(values),
            'bands':dict(Counter('0-24' if v<25 else '25-49' if v<50 else '50-74' if v<75 else '75-89' if v<90 else '90-95' for v in values))}


def summarize(sid, beta, validation, ordinary, outcome):
    # Report the existing 10/11-pick served slice. Profile windows apply
    # additional exact product-policy restrictions during simulation.
    max_pick=11 if sid=='powered-cube' else 10
    result={}; bank=[]
    for cohort,records in [('elite',validation),('control',ordinary)]:
        records=[(r,pick) for r,_,pick in records if pick<=max_pick]
        if not records:
            raise ValueError('empty served-slice cohort')
        selected=defaultdict(lambda:[[],[]])
        clusters=defaultdict(lambda:[0,0.])
        tail=defaultdict(lambda:[0,0.])
        outcomes_by_draft=defaultdict(lambda:[[],[]])
        candidate_counts=Counter()
        # Stable local ordinals, unrelated to original IDs or timestamps.
        ids=sorted({r.source for r,_ in records},key=lambda s:hashlib.sha256(('score-bank-v1|'+sid+'|'+s).encode()).digest())
        local={s:i for i,s in enumerate(ids)}
        for row,pick in records:
            p,q=weights(row,ZERO),weights(row,beta)
            a,b=grade(p),grade(q)
            x,y=a[row.chosen],b[row.chosen]
            if x!=curve_score(p[row.chosen]/max(p),1.) or y!=curve_score(q[row.chosen]/max(q),1.):
                raise ValueError('linear award parity failed')
            band=scoring.band(p)
            for g in ('all','pick:'+str(pick),'difficulty:'+band):
                selected[g][0].append(x); selected[g][1].append(y)
            clusters[row.source][0]+=1;clusters[row.source][1]+=y-x
            tail[row.source][0]+=1;tail[row.source][1]+=int(y<25)-int(x<25)
            outcomes_by_draft[row.source][0].append(x);outcomes_by_draft[row.source][1].append(y)
            if len(row.candidates)>=4:
                # No original IDs, choices, card names, probabilities, times,
                # skill values or game outcomes leave the runner. Only scores
                # and profile-cell coordinates grouped by local draft index.
                bank.append([cohort,local[row.source],pick,band,x,y])
            for i,(u,v) in enumerate(zip(a,b)):
                if i==row.chosen:
                    continue
                candidate_counts['alternatives']+=1
                candidate_counts['absolute_point_change']+=abs(v-u)
                candidate_counts['changed_20_or_more']+=abs(v-u)>=20
                candidate_counts['v6_90_95']+=u>=90
                candidate_counts['opportunity_90_95']+=v>=90
                candidate_counts['crossed_below_40']+=u>=40 and v<40
                candidate_counts['crossed_up_to_75']+=u<75 and v>=75
        out={}
        for model,index in [('v6',0),('opportunity',1)]:
            observations=[((sid,outcome[d][0]),95-statistics.fmean(xs[index]),outcome[d][1])
                for d,xs in outcomes_by_draft.items() if d in outcome and len(xs[index])>=4]
            out[model]={'linked_drafts':len(observations),'within_skill_regret_vs_wins':pool_fisher(stratum_correlations(observations))}
        result[cohort]={'decisions':len(records),'drafts':len(ids),'scores':{g:{'v6':award_summary(xs[0]),'opportunity':award_summary(xs[1])} for g,xs in selected.items()},
            'paired_observed_score_change':interval(clusters),'paired_below_25_change':interval(tail),
            'prediction':{'v6':evaluate([r for r,_ in records],ZERO),'opportunity':evaluate([r for r,_ in records],beta)},
            'alternative_movement':dict(candidate_counts),
            'outcome_association':out}
    return result,bank


def simulation_rows(sid,bank):
    for cohort,d,pick,band,x,y in bank:
        if cohort not in ('elite','control') or type(d)!=int or d<0 or type(pick)!=int or not 1<=pick<=11 or band not in ('easy','medium','hard') or not all(type(n)==int and 0<=n<=95 for n in (x,y)):
            raise ValueError('invalid anonymous simulation record')
        yield {'cohort':cohort,'set_id':sid,'draft_id':f'{cohort}:{d}',
               'pick':pick,'band':band,'scores':{BASE:x,CAND:y},
               'probabilities':{'v2':(0,0,0,0)}}


def simulate(rows,environment,runs=RUNS,draws=BOOTSTRAP_DRAWS,per_draw=BOOTSTRAP_RUNS):
    configure()
    profiles=scoring.profiles_for(rows,environment,runs,False,DAY)
    return scoring.simulated_report(rows,profiles,draws,per_draw)


def measure(manifest,output,prior_report):
    sid,beta,validation,ordinary,draft_path,provenance=restore_partitions(manifest,prior_report)
    outcome=selected_outcomes(draft_path,{r.source for r,_,_ in validation+ordinary})
    cohorts,bank=summarize(sid,beta,validation,ordinary,outcome)
    del validation,ordinary,outcome
    # Serialize just the minimal anonymous source-cluster score banks for the
    # one-shot combined simulation. The final retained report is aggregate.
    output.mkdir(parents=True,exist_ok=True)
    bank_file=output/'simulation-bank.json.gz'
    bank_file.write_bytes(gzip.compress(json.dumps({'set':sid,'rows':bank},separators=(',',':')).encode(),mtime=0))
    result={'scope':'historical development; no newly untouched final data',
            'provenance':provenance,'cohorts':cohorts,'bank_sha256':sha256(bank_file),
            'simulation':simulate(list(simulation_rows(sid,bank)),'powered-cube' if sid=='powered-cube' else 'mixed'),
            'score_formula':'linear ratio, cap 95, no trophy override',
            'quality_labels_used':False,'release_allowed':False}
    (output/'score-report.json').write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    print(json.dumps({'set':sid,'cohort_decisions':{k:v['decisions'] for k,v in cohorts.items()},
        'prediction':{k:v['prediction'] for k,v in cohorts.items()},
        'observed_scores':{k:v['scores']['all'] for k,v in cohorts.items()},
        'simulation':result['simulation'],'outcome_association':{k:v['outcome_association'] for k,v in cohorts.items()}},indent=2))


def aggregate(directory,output):
    configure()
    reports={}; banks={}
    for path in sorted(directory.glob('pool-aware-statistical-*/score-report.json')):
        r=read_json(path); sid=r['provenance']['set']
        if sid not in SETS or sid in reports or r['provenance']['lock_sha256']!=sha256(LOCK) or r['release_allowed'] or r['quality_labels_used']:
            raise ValueError('invalid statistical report identity')
        bank=path.parent/'simulation-bank.json.gz'
        if sha256(bank)!=r['bank_sha256']:
            raise ValueError('anonymous bank checksum mismatch')
        d=read_json(bank)
        if d['set']!=sid:
            raise ValueError('bank set mismatch')
        banks[sid]=list(simulation_rows(sid,d['rows']))
        reports[sid]=r
    if not reports:
        raise ValueError('no successful set reports')
    result={'scope':'historical development only; no fresh final assessment',
        'expected_sets':list(SETS),'completed_sets':sorted(reports),
        'missing_sets':sorted(set(SETS)-set(reports)),
        'candidate_id':read_json(LOCK)['candidate_id'],
        'runs':{},'sets':{},'score_formula':'unchanged linear ratio, cap 95; no trophy override',
        'release_allowed':False,'quality_labels_used':False}
    for sid,r in reports.items():
        e=r['cohorts']['elite']
        scores=e['scores']['all']
        sim=r['simulation']['configurations']
        result['sets'][sid]={'provenance':r['provenance'],'cohorts':r['cohorts'],'simulation':r['simulation'],
            'severe_tail_delta':scores['opportunity']['below_25']-scores['v6']['below_25'],
            'tail_safe':scores['opportunity']['below_25']<=scores['v6']['below_25']+TAIL_LIMIT}
    for env in ('mixed','powered-cube'):
        ids=[s for s in reports if (s=='powered-cube')==(env=='powered-cube')]
        if not ids:
            continue
        rows=[r for s in ids for r in banks[s]]
        result['runs'][env]=simulate(rows,env,10000,BOOTSTRAP_DRAWS,2000)
        sim=result['runs'][env]['configurations'][CAND]
        result['runs'][env]['development_gate']={'all_set_tails_safe':all(result['sets'][s]['tail_safe'] for s in ids),
            'auc_delta_positive_interval':sim['delta_ci95'][0]>0,
            'coverage_complete':not result['missing_sets'],
            'note':'preexisting +1 pp elite below-25 guardrail; AUC gain requires lower interval >0; no deployment authorization'}
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    print(json.dumps({'completed_sets':result['completed_sets'],'missing_sets':result['missing_sets'],'runs':result['runs'],
        'per_set':{s:{'simulation':r['simulation'],'severe_tail_delta':r['severe_tail_delta'],'tail_safe':r['tail_safe']} for s,r in result['sets'].items()}},indent=2))


def self_test():
    from pool_aware_refit import Choice
    r=Choice('source-a','2025-01-01T00:00:00Z',('a','b','c','d'),(.55,.3,.1,.05),
             ((0.,)*8,(1.,)+(0.,)*7,(0.,)*8,(0.,)*8),1)
    s=Choice('source-b','2025-01-02T00:00:00Z',r.candidates,r.support,r.features,3)
    result,bank=summarize('dft',(1.,)+(0.,)*7,[(r,(),1)],[(s,(),1)],{})
    assert result['elite']['scores']['all']['opportunity']['mean']>result['elite']['scores']['all']['v6']['mean']
    assert len(bank)==2 and all(len(row)==6 for row in bank)
    assert 'source-a' not in json.dumps(bank) and 'source-b' not in json.dumps(bank)
    rr=list(simulation_rows('dft',bank))
    assert rr[0]['draft_id']!=rr[1]['draft_id']
    assert curve_score(.5,1)==48
    assert award_summary([24,25,95])['below_25']==1/3
    print('Statistical scoring synthetic contracts passed; no assessment data opened.')


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
    elif a.manifest:
        measure(a.manifest,a.output,a.prior_report)
    else:
        p.error('--manifest or --aggregate required')


if __name__=='__main__':
    main()
