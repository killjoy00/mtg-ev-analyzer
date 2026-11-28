#!/usr/bin/env python3
"""One frozen strong-only comparison using the completed reviewed-final fit registry.
No fitting, production access, tuning, or new validation windows.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import random
import statistics
import numpy as np

import pool_aware_skill_reviewed_validation as rv
import pool_aware_v7_refit as refit
import pool_aware_skill_final_correction as final
import pool_aware_skill_expansion as exp
import pool_aware_skill_contrast as skill
import pool_aware_statistical_validation as stat
import pool_aware_skill_context_validation as ctx
import scoring_experiment as scoring
from pool_aware_archive import read_json, sha256
from pool_aware_refit import weights
from pool_aware_diagnostics import grade, leader

PROTOCOL = 'v7-strong-only-frozen-comparison-v1'
RUN = 46107297635
REGISTRY = 'ba978db88bb5b569a100cfbc53103a697e2ee0a496b1ec9a9c2fcba1f90a6bdc'
NAMES = ('v6', 'contrast', 'strong-only')
KEYS = [x+'|1' for x in NAMES]
METRICS = ('log_loss','top1','below_25')
DRAW = stat.BOOTSTRAP_DRAWS

def parameters(fit):
    context, contrast = final.parameters(fit)
    strong = dict(fit['elite_card_effects'])
    if set(strong) != set(contrast) or len(strong) != fit['eligible_card_count']:
        raise ValueError('eligible mask mismatch')
    return context, contrast, strong

def same(a,b):
    return math.isclose(a,b,rel_tol=1e-10,abs_tol=1e-12)

def quantile(v):
    return [float(x) for x in np.quantile(v,[.025,.975],axis=0)]

def compare_records(base, alternative, cohort, sid, mode, cards=None):
    if len(base)!=len(alternative):
        raise ValueError('unpaired choices')
    clusters=defaultdict(lambda:np.zeros(10))
    movement={m:Counter() for m in NAMES}
    disagreement=Counter()
    examples={}
    for (a,pool,k),(b,pool_b,k_b) in zip(base,alternative):
        if (a.source,a.event_time,a.candidates,a.support,a.chosen,pool,k)!=(b.source,b.event_time,b.candidates,b.support,b.chosen,pool_b,k_b):
            raise ValueError('choice parity mismatch')
        ps=[weights(a,skill.ZERO),weights(a,skill.APPLY),weights(b,skill.APPLY)]
        gs=[grade(p) for p in ps]
        ls=[leader(a,p) for p in ps]
        row=clusters[a.source];row[0]+=1
        for j,(m,p,g,l) in enumerate(zip(NAMES,ps,gs,ls)):
            row[1+3*j:4+3*j]+=(-math.log(max(p[a.chosen],1e-300)),int(l==a.chosen),int(g[a.chosen]<25))
            v=movement[m];v['decisions']+=1;v['leader_changes']+=int(l!=ls[0])
            for i,(x,y) in enumerate(zip(gs[0],g)):
                delta=y-x;v['max_movement']=max(v['max_movement'],abs(delta))
                if i!=a.chosen:
                    v['alternative_offers']+=1;v['90_to_below_75']+=int(x>=90 and y<75)
                    v['drop_20_plus']+=int(delta<=-20)
        if ls[1]!=ls[2]:
            disagreement['packs']+=1
            disagreement['contrast_pick']+=int(a.chosen==ls[1])
            disagreement['strong_only_pick']+=int(a.chosen==ls[2])
            disagreement['neither']+=int(a.chosen not in ls[1:])
        if cards is not None:
            for i,n in enumerate(a.candidates):
                if n not in cards:continue
                change=gs[2][i]-gs[1][i]
                if n not in examples or abs(change)>abs(examples[n]['strong_only_minus_contrast']):
                    examples[n]={'card':n,'pick':k,'pool':sorted(pool),'pack':sorted(a.candidates),
                        'v6':gs[0][i],'contrast':gs[1][i],'strong_only':gs[2][i],
                        'strong_only_minus_contrast':change}
    if not clusters:
        return {'status':'unavailable'}
    # Bootstrap the whole source drafts, keeping all three arms on exactly
    # the same resample. Only aggregate draw totals leave the runner.
    a=np.asarray([clusters[k] for k in sorted(clusters)])
    seed=int.from_bytes(hashlib.sha256((exp.PROTOCOL+'|'+sid+'|'+mode+'|'+cohort).encode()).digest()[:8],'big')
    rng=np.random.default_rng(seed)
    draws=[a[rng.integers(0,len(a),size=len(a))].sum(axis=0).tolist() for _ in range(DRAW)]
    return {'status':'measured','drafts':len(a),'totals':a.sum(axis=0).tolist(),'bootstrap_totals':draws,
        'movement':{m:dict(v) for m,v in movement.items()},'disagreement':dict(disagreement),'examples':examples}

def pool_records(entries):
    valid=[v for v in entries if v.get('status')=='measured']
    if not valid:return {'status':'unavailable'}
    total=np.sum([v['totals'] for v in valid],axis=0)
    draws=np.sum([v['bootstrap_totals'] for v in valid],axis=0)
    means=total[1:]/total[0];boot=draws[:,1:]/draws[:,0,None]
    metrics={}
    for j,m in enumerate(NAMES):
        metrics[m]={k:{'value':float(means[3*j+i]),'ci95':quantile(boot[:,3*j+i])} for i,k in enumerate(METRICS)}
    for j,label in [(0,'strong_only_minus_v6'),(1,'strong_only_minus_contrast')]:
        metrics[label]={k:{'value':float(means[6+i]-means[3*j+i]),'ci95':quantile(boot[:,6+i]-boot[:,3*j+i])} for i,k in enumerate(METRICS)}
    movement={m:Counter() for m in NAMES};disagreement=Counter()
    for v in valid:
        disagreement.update(v['disagreement'])
        for m,items in v['movement'].items():
            for k,x in items.items():
                if k=='max_movement':movement[m][k]=max(movement[m][k],x)
                else:movement[m][k]+=x
    dis=dict(disagreement);n=dis.get('packs',0)
    if n:
        for k in ('contrast_pick','strong_only_pick','neither'):dis[k+'_rate']=dis.get(k,0)/n
    return {'status':'measured','decisions':int(total[0]),'drafts':sum(v['drafts'] for v in valid),
        'formats_measured':len(valid),'formats_unavailable':len(entries)-len(valid),
        'metrics':metrics,'movement':{m:dict(v) for m,v in movement.items()},'disagreement':dis}

def sim_rows(sid,bank):
    for b in bank:
        if len(b)!=7 or any(type(x)!=int or not 0<=x<=95 for x in b[4:]):
            raise ValueError('invalid paired bank')
        r=next(stat.simulation_rows(sid,[b[:6]],'contrast'))
        r['scores']['strong-only|1']=b[6]
        yield r

def simulation(rows,env,runs=stat.RUNS,per_draw=stat.BOOTSTRAP_RUNS,single=None):
    scoring.MODELS=list(NAMES);scoring.EXPONENTS=[1.];scoring.BASELINE=stat.BASE;scoring.SEED=stat.SEED
    try:
        profiles=ctx.profile_request(rows,env,runs,single)
    except rv.subprocess.CalledProcessError as exc:
        if 'Insufficient held-out coverage for this run profile' not in (exc.stderr or ''):raise
        return {'status':'unavailable','reason':'insufficient profile coverage'}
    values,n=scoring.simulate(rows,profiles)
    if n<.9*len(profiles):return {'status':'unavailable','reason':'insufficient distinct-source profiles'}
    observed={k:scoring.auc(values['elite'][k],values['control'][k]) for k in KEYS}
    samples={k:[] for k in KEYS};delta={m:[] for m in KEYS[:2]}
    rng=random.Random(stat.SEED+1)
    for i in range(DRAW):
        boot,complete=scoring.simulate(scoring.resample_sources(rows,rng),profiles[:per_draw],stat.SEED+i)
        if complete<.9*min(per_draw,len(profiles)):continue
        auc={k:scoring.auc(boot['elite'][k],boot['control'][k]) for k in KEYS}
        for k in KEYS:samples[k].append(auc[k])
        for k in KEYS[:2]:delta[k].append(auc[KEYS[2]]-auc[k])
    if len(samples[KEYS[0]])<.9*DRAW:return {'status':'unavailable','reason':'insufficient bootstrap draws'}
    return {'status':'complete','runs':n,'valid_bootstrap_draws':len(samples[KEYS[0]]),
        'auc':{k:{'value':observed[k],'ci95':scoring.interval(samples[k],5)} for k in KEYS},
        'paired':{k:{'value':observed[KEYS[2]]-observed[k],'ci95':scoring.interval(delta[k],5)} for k in KEYS[:2]}}

def compare_sim(a,b):
    if a['status']!=b['status']:raise ValueError('simulation status parity')
    if a['status']=='complete':
        for x,y in [('v6|1','v6|1'),('contrast|1','refit|1')]:
            if not same(a['auc'][x]['value'],b['configurations'][y]['auc']):
                raise ValueError('frozen AUC parity failure '+x)

def measure(sid,prior_path,fits_path,old,output):
    prior=rv.frozen_prior(prior_path,sid)
    fits=refit.load_fits(fits_path)
    if rv.registry_digest(fits)!=REGISTRY:raise ValueError('wrong completed registry')
    frozen=refit.check_fit(fits[sid],sid,prior);fit=frozen['fit'];fp=frozen['provenance']
    old_report=read_json(old/'report.json');old_bank=old/'bank.json.gz'
    if (old_report['protocol']!=rv.PROTOCOL or old_report['set']!=sid or old_report['fit_registry_sha256']!=REGISTRY
        or old_report['audit_code_sha256']!=sha256(rv.SOURCE) or old_report['bank_sha256']!=sha256(old_bank)
        or old_report['fit_report_sha256']!=hashlib.sha256(json.dumps(frozen,sort_keys=True).encode()).hexdigest()):
        raise ValueError('reviewed validation provenance mismatch')
    e,o,metadata,draft_path,prov,model,ids,windows=refit.prepare(sid,exp.directory(sid)/'manifest.json',prior,'validation')
    for k in ('sources','windows','purge_days','baseline_cutoff','baseline_picks','baseline_drafts','baseline_colour_coverage','recovery'):
        if prov[k]!=fp[k]:raise ValueError('fit/validation mismatch '+k)
    outcomes=stat.selected_outcomes(draft_path,{r.source for r,_,_ in e+o})
    trad,te,to=refit.traditional(sid,model,metadata,fp['baseline_cutoff'],windows,ids)
    if trad!=old_report['traditional_archive']:raise ValueError('Traditional coverage parity')
    del model,ids
    context,contrast,strong=parameters(fit)
    a,b=final.predict_pairs(e,metadata,context,contrast),final.predict_pairs(o,metadata,context,contrast)
    x,y=final.predict_pairs(e,metadata,context,strong),final.predict_pairs(o,metadata,context,strong)
    del e,o
    previous=old_report['arms']['refit']
    pc,bank_c=stat.summarize(sid,skill.APPLY,a,b,outcomes,candidate_name=skill.NAME)
    ps,bank_s=stat.summarize(sid,skill.APPLY,x,y,outcomes,candidate_name=skill.NAME)
    rv.check_prediction(pc,previous['cohorts'])
    prior_bank=read_json(old_bank)['rows']
    if not(len(prior_bank)==len(bank_c)==len(bank_s)):raise ValueError('bank size parity')
    bank=[]
    for q,c,s in zip(prior_bank,bank_c,bank_s):
        if q[:5]+[q[7]]!=c or c[:5]!=s[:5]:raise ValueError('reviewed bank parity failure')
        bank.append(c+[s[5]])
    del prior_bank,bank_c,bank_s
    sim=simulation(list(sim_rows(sid,bank)),'powered-cube' if sid=='powered-cube' else 'mixed',single=sid)
    compare_sim(sim,old_report['simulation'])
    outcome_c=exp.outcome_study(sid,a+b,outcomes)
    outcome_s=exp.outcome_study(sid,x+y,outcomes)
    if outcome_c!=previous['outcome_pair'][1]:raise ValueError('contrast outcome parity')
    top=sorted(strong,key=lambda n:(-abs(strong[n]-contrast[n]),n))[:20]
    elite=compare_records(a,x,'elite',sid,'premier',set(top))
    control=compare_records(b,y,'control',sid,'premier')
    audit=rv.audit_cost(x,metadata)
    guard=rv.guard_only(x)
    if rv.guard_only(a)!=previous['guardrails']:raise ValueError('contrast guardrail parity')
    card_audit=[{'card':n,'contrast_term':contrast[n],'strong_only_term':strong[n],
        'signed_difference':strong[n]-contrast[n],'example':elite['examples'].get(n)} for n in top]
    del a,b,x,y
    traditional={'status':'unavailable','reason':trad.get('reason',trad['status']),
        'outcome_correlation':'unavailable: no pinned Traditional game archives',
        'simulation':'unavailable: final Traditional protocol has no simulated profile AUC'}
    if trad['status']=='measured':
        ta,tb=final.predict_pairs(te,metadata,context,contrast),final.predict_pairs(to,metadata,context,contrast)
        tx,ty=final.predict_pairs(te,metadata,context,strong),final.predict_pairs(to,metadata,context,strong)
        traditional.update(status='measured',elite=compare_records(ta,tx,'elite',sid,'traditional'),
            control=compare_records(tb,ty,'control',sid,'traditional'),contrast_guardrails=rv.guard_only(ta),
            strong_only_guardrails=rv.guard_only(tx),strong_only_cost_audit=rv.audit_cost(tx,metadata))
    output.mkdir(parents=True,exist_ok=True)
    bf=output/'bank.json.gz';bf.write_bytes(rv.bank_bytes(sid,bank))
    report={'protocol':PROTOCOL,'set':sid,'source_run':RUN,'registry':REGISTRY,
        'bank_sha256':sha256(bf),'code_sha256':sha256(Path(__file__)),
        'evidence_class':old_report['evidence_class'],'simulation':sim,
        'outcome_pair':[outcome_c,outcome_s],'outcomes':rv.compare_outcomes([[outcome_c,outcome_s]]),
        'elite':elite,'control':control,'guardrails':guard,'contrast_guardrails':previous['guardrails'],
        'strong_only_cost_audit':audit,'contrast_cost_audit':previous['cost_audit'],
        'card_audit':card_audit,'traditional':traditional}
    exp.write(output/'report.json',report)
    print(json.dumps({'set':sid,'simulation':sim,'prediction':pool_records([elite]),'guardrails':guard,
        'outcomes':report['outcomes'],'traditional':traditional['status']},indent=2),flush=True)

def aggregate(folder,reference,output):
    old=read_json(reference);reports={};paths={}
    for p in sorted(folder.glob('pool-aware-v7-strong-only-transfer-*/report.json')):
        r=read_json(p);s=r['set'];bf=p.parent/'bank.json.gz'
        if (r['protocol']!=PROTOCOL or r['registry']!=REGISTRY or r['code_sha256']!=sha256(Path(__file__))
            or r['bank_sha256']!=sha256(bf) or s in reports or s not in rv.EXPECTED):
            raise ValueError('paired artifact mismatch')
        reports[s]=r;paths[s]=bf
    if set(reports)!=rv.EXPECTED:raise ValueError('not all 31 formats measured')
    if old['fit_registry_sha256']!=REGISTRY:raise ValueError('wrong reviewed reference')
    def scope(ids,sim):
        return {'sets':ids,'simulation':sim,'prediction':pool_records([reports[s]['elite'] for s in ids]),
            'ordinary':pool_records([reports[s]['control'] for s in ids]),
            'outcomes':rv.compare_outcomes([reports[s]['outcome_pair'] for s in ids])}
    scopes={}
    for name,previous in old['runs'].items():
        ids=previous['sets']
        if name.startswith('standalone:'):sim=reports[ids[0]]['simulation']
        else:
            rows=[]
            for s in ids:
                data=read_json(paths[s])
                if data['set']!=s:raise ValueError('bank identity mismatch')
                rows.extend(sim_rows(s,data['rows']))
            sim=simulation(rows,'powered-cube' if name=='powered-cube' else 'mixed',runs=10000,per_draw=2000)
        compare_sim(sim,previous['simulation'])
        scopes[name]=scope(ids,sim)
    failures=[s for s,r in reports.items() if not rv.safe(r['guardrails'])]
    tf=[s for s,r in reports.items() if r['traditional']['status']=='measured' and not rv.safe(r['traditional']['strong_only_guardrails'])]
    max_move=max(r['elite']['movement']['strong-only']['max_movement'] for r in reports.values())
    max_move=max(max_move,max(r['control']['movement']['strong-only']['max_movement'] for r in reports.values()))
    decision={}
    for name in ('strict_mixed','legacy_mixed'):
        d=scopes[name];pairs=d['simulation'].get('paired',{});pred=d['prediction'].get('metrics',{}).get('strong_only_minus_contrast',{}).get('log_loss',{}).get('ci95')
        win=d['outcomes'].get('revised_vs_full_ci95')
        ac=pairs.get('contrast|1',{}).get('ci95');av=pairs.get('v6|1',{}).get('ci95')
        decision[name]={'guardrails':{'value':failures,'pass':not failures},
            'auc_vs_contrast':{'ci95':ac,'pass':bool(ac and ac[0]>=-.002)},
            'auc_vs_v6':{'ci95':av,'pass':bool(av and av[0]>0)},
            'log_loss_vs_contrast':{'ci95':pred,'pass':bool(pred and pred[1]<0)},
            'win_correlation_vs_contrast':{'ci95':win,'pass':bool(win and win[0]>=-.001)}}
    passed=all(v['pass'] for d in decision.values() for v in d.values())
    tids=sorted(set(refit.TRAD)&set(reports));t=[reports[s]['traditional'] for s in tids]
    result={'protocol':PROTOCOL,'source_run':RUN,'registry':REGISTRY,'sets':sorted(reports),'release_allowed':False,
        'decision':decision,'comparison_choice':'strong-only' if passed else 'contrast',
        'release_review_pending_if_strong_only_selected':passed,
        'additional_existing_release_checks':{'traditional_guardrail_failures':tf,'premier_max_movement':max_move,
            'note':'If strong-only passes selection, complete its stored-production shadow and existing reviewed release checks before any approval; the unchanged context-only starting model retains the verified LOO evidence.'},
        'scopes':scopes,'traditional':{'sets':tids,
            'elite':pool_records([x.get('elite',{}) for x in t]),'control':pool_records([x.get('control',{}) for x in t]),
            'outcomes':'unavailable: no pinned Traditional game archives',
            'simulation':'unavailable under existing Traditional validation protocol'},
        'per_format':{s:{'simulation':r['simulation'],'outcomes':r['outcomes'],
            'elite':pool_records([r['elite']]),'control':pool_records([r['control']]),'guardrails':r['guardrails'],
            'contrast_guardrails':r['contrast_guardrails'],'card_audit':r['card_audit'],
            'traditional':{k:v for k,v in r['traditional'].items() if k not in ('elite','control')}|
            {'elite':pool_records([r['traditional'].get('elite',{})]),'control':pool_records([r['traditional'].get('control',{})])}}
            for s,r in sorted(reports.items())},
        'interpretation':'Historical development validation; paired choice evidence, not a causal decision-quality claim.'}
    exp.write(output,result)
    print(json.dumps({'decision':decision,'comparison_choice':result['comparison_choice'],
        'additional_existing_release_checks':result['additional_existing_release_checks']},indent=2),flush=True)

def self_test():
    context,contrast,strong=parameters({'elite_context':[0.]*6,'elite_card_effects':{'a':.3},'control_card_effects':{'a':.1},
        'eligible_card_count':1,'lambda':skill.LAMBDA,'max_log_adjustment':skill.MAX_LOG_ADJUST,'features':list(skill.FEATURES[:6])})
    assert same(contrast['a'],.2) and same(strong['a'],.3) and strong.get('missing',0.)==0.
    v={'status':'measured','drafts':2,'totals':[2,2,1,0,2,1,0,1,2,0],
       'bootstrap_totals':[[2,2,1,0,2,1,0,1,2,0]]*DRAW,'movement':{m:{} for m in NAMES},'disagreement':{}}
    assert pool_records([v])['metrics']['strong_only_minus_contrast']['log_loss']['ci95']==[-.5,-.5]
    assert pool_records([v,v])['decisions']==4
    print('Strong-only contracts passed: identical eligibility, paired aggregation and fixed thresholds.')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--stage',choices=('measure','aggregate'))
    p.add_argument('--set',choices=sorted(rv.EXPECTED))
    for k in ('prior','fits','old','banks','reference','output'):p.add_argument('--'+k,type=Path)
    a=p.parse_args()
    if a.self_test:self_test()
    elif a.stage=='measure':measure(a.set,a.prior,a.fits,a.old,a.output)
    elif a.stage=='aggregate':aggregate(a.banks,a.reference,a.output)
    else:p.error('stage required')

if __name__=='__main__':main()
