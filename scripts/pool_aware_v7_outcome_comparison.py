#!/usr/bin/env python3
"""One locked outcome-card-term comparison using the completed reviewed-final reference.
Training-only Model C and one joint strong-choice fit; no production access or tuning.
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
import pool_aware_v7_outcome_strength as strength
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

PROTOCOL = 'v7-outcome-card-term-frozen-comparison-v1'
RUN = 46107297635
REGISTRY = 'ba978db88bb5b569a100cfbc53103a697e2ee0a496b1ec9a9c2fcba1f90a6bdc'
NAMES = ('v6', 'contrast', 'outcome')
KEYS = [x+'|1' for x in NAMES]
METRICS = ('log_loss','top1','below_25')
DRAW = stat.BOOTSTRAP_DRAWS
def same(a,b):
    return math.isclose(a,b,rel_tol=1e-10,abs_tol=1e-12)

def assert_numeric_parity(actual, expected, label, abs_tol=1e-12):
    """Strict structural parity and numerical roundoff only.

    Keep exact sample counts, draw indices/missingness, booleans, keys and
    statuses. Every scalar in every bootstrap draw must independently match.
    This is a computational equality tolerance, not a selection margin.
    """
    summary={'float_values':0,'nonidentical_float_values':0,'max_absolute_error':0.,'max_relative_error':0.}
    def fail(path,message):
        raise ValueError(f'{label} parity failure at {path}: {message}')
    def walk(a,b,path):
        if type(a) is not type(b):
            fail(path, f'types {type(a).__name__} != {type(b).__name__}')
        if isinstance(a,dict):
            if a.keys()!=b.keys():fail(path,'different dictionary keys')
            for k in sorted(a):walk(a[k],b[k],f'{path}.{k}')
        elif isinstance(a,list):
            if len(a)!=len(b):fail(path,'different list length')
            for i,(x,y) in enumerate(zip(a,b)):walk(x,y,f'{path}[{i}]')
        elif isinstance(a,float):
            summary['float_values']+=1
            if not (math.isfinite(a) and math.isfinite(b) and math.isclose(a,b,rel_tol=1e-10,abs_tol=abs_tol)):
                fail(path,f'actual={a:.17g}, expected={b:.17g}, absolute error={abs(a-b):.17g}')
            if a!=b:
                d=abs(a-b);summary['nonidentical_float_values']+=1
                summary['max_absolute_error']=max(summary['max_absolute_error'],d)
                summary['max_relative_error']=max(summary['max_relative_error'],d/max(abs(a),abs(b),1e-300))
        elif a!=b:
            fail(path,f'actual={a!r}, expected={b!r}')
    walk(actual,expected,label)
    print(json.dumps({'parity':label,**summary}),flush=True)
    return summary

def quantile(v):
    return [float(x) for x in np.quantile(v,[.025,.975],axis=0)]

def compare_records(base, alternative, cohort, sid, mode, cards=None):
    if len(base)!=len(alternative):
        raise ValueError('unpaired choices')
    clusters=defaultdict(lambda:np.zeros(10))
    movement={m:Counter() for m in NAMES}
    disagreement=Counter()
    examples={}; card_stats=defaultdict(lambda:[0,0])
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
            disagreement['outcome_pick']+=int(a.chosen==ls[2])
            disagreement['neither']+=int(a.chosen not in ls[1:])
        if cards is not None:
            for i,n in enumerate(a.candidates):
                change=gs[2][i]-gs[1][i]
                card_stats[n][0]+=1;card_stats[n][1]+=change
                if n not in examples or abs(change)>abs(examples[n]['outcome_minus_contrast']):
                    examples[n]={'card':n,'pick':k,'pool':sorted(pool),'pack':sorted(a.candidates),
                        'v6':gs[0][i],'contrast':gs[1][i],'outcome':gs[2][i],
                        'outcome_minus_contrast':change}
    if not clusters:
        return {'status':'unavailable'}
    # Bootstrap the whole source drafts, keeping all three arms on exactly
    # the same resample. Only aggregate draw totals leave the runner.
    a=np.asarray([clusters[k] for k in sorted(clusters)])
    seed=int.from_bytes(hashlib.sha256((exp.PROTOCOL+'|'+sid+'|'+mode+'|'+cohort).encode()).digest()[:8],'big')
    rng=np.random.default_rng(seed)
    draws=[a[rng.integers(0,len(a),size=len(a))].sum(axis=0).tolist() for _ in range(DRAW)]
    largest=sorted(card_stats,key=lambda n:(-abs(card_stats[n][1]/card_stats[n][0]),n))[:20]
    means=[{'card':n,'offers':card_stats[n][0],'mean_outcome_minus_contrast':card_stats[n][1]/card_stats[n][0],
            'example':examples.get(n)} for n in largest]
    return {'status':'measured','drafts':len(a),'totals':a.sum(axis=0).tolist(),'bootstrap_totals':draws,
        'movement':{m:dict(v) for m,v in movement.items()},'disagreement':dict(disagreement),
        'examples':{n:examples[n] for n in sorted(cards or ()) if n in examples},'largest_mean_grade_differences':means}

def pool_records(entries):
    valid=[v for v in entries if v.get('status')=='measured']
    if not valid:return {'status':'unavailable'}
    total=np.sum([v['totals'] for v in valid],axis=0)
    draws=np.sum([v['bootstrap_totals'] for v in valid],axis=0)
    means=total[1:]/total[0];boot=draws[:,1:]/draws[:,0,None]
    metrics={}
    for j,m in enumerate(NAMES):
        metrics[m]={k:{'value':float(means[3*j+i]),'ci95':quantile(boot[:,3*j+i])} for i,k in enumerate(METRICS)}
    for j,label in [(0,'outcome_minus_v6'),(1,'outcome_minus_contrast')]:
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
        for k in ('contrast_pick','outcome_pick','neither'):dis[k+'_rate']=dis.get(k,0)/n
    return {'status':'measured','decisions':int(total[0]),'drafts':sum(v['drafts'] for v in valid),
        'formats_measured':len(valid),'formats_unavailable':len(entries)-len(valid),
        'metrics':metrics,'movement':{m:dict(v) for m,v in movement.items()},'disagreement':dis}

def sim_rows(sid,bank):
    for b in bank:
        if len(b)!=7 or any(type(x)!=int or not 0<=x<=95 for x in b[4:]):
            raise ValueError('invalid paired bank')
        r=next(stat.simulation_rows(sid,[b[:6]],'contrast'))
        r['scores']['outcome|1']=b[6]
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
    manifest=exp.directory(sid)/'manifest.json'
    base_context,contrast=final.parameters(fit)
    try:
        strengths,table,strength_evidence=strength.strength_table(sid,manifest)
        if strength_evidence['source_sha256']!=fp['sources']['games'] or strength_evidence['draft_sha256']!=fp['sources']['draft'] or strength_evidence['windows']!=fp['windows']:
            raise ValueError('Model C training input parity failure')
        re,ro,rm,_,rp,_,_,_=refit.prepare(sid,manifest,prior,'residual')
        if rp!=fp or len(re)!=fit['elite']['decisions'] or len(ro)!=fit['control']['decisions']:
            raise ValueError('joint choice residual cohort/provenance mismatch')
        context,beta,choice_fit=strength.fit_choice(re,rm,strengths)
        del re,ro,rm
        outcome_cards={n:beta*v for n,v in strengths.items()}
        available=True
    except strength.Unavailable as exc:
        # Keep the incumbent in an explicitly unavailable arm slot solely
        # for baseline bank parity; never count it as outcome-arm evidence.
        available=False
        strengths,table={},{}
        strength_evidence={'status':'unavailable','reason':str(exc),
                           'archive_pin':exp.SETS[sid]['skill_source']}
        context,beta,choice_fit=base_context,None,None
        outcome_cards=contrast
    e,o,metadata,draft_path,prov,model,ids,windows=refit.prepare(sid,manifest,prior,'validation')
    for k in ('sources','windows','purge_days','baseline_cutoff','baseline_picks','baseline_drafts','baseline_colour_coverage','recovery'):
        if prov[k]!=fp[k]:raise ValueError('fit/validation mismatch '+k)
    outcomes=stat.selected_outcomes(draft_path,{r.source for r,_,_ in e+o})
    trad,te,to=refit.traditional(sid,model,metadata,fp['baseline_cutoff'],windows,ids)
    if trad!=old_report['traditional_archive']:raise ValueError('Traditional coverage parity')
    del model,ids
    a,b=final.predict_pairs(e,metadata,base_context,contrast),final.predict_pairs(o,metadata,base_context,contrast)
    x,y=final.predict_pairs(e,metadata,context,outcome_cards),final.predict_pairs(o,metadata,context,outcome_cards)
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
    outcome_parity=assert_numeric_parity(outcome_c,previous['outcome_pair'][1],'contrast outcome',abs_tol=1e-10)
    top=sorted(set(outcome_cards)|set(contrast),key=lambda n:(-abs(outcome_cards.get(n,0.)-contrast.get(n,0.)),n))[:20] if available else []
    elite=compare_records(a,x,'elite',sid,'premier',set(top) if available else None)
    control=compare_records(b,y,'control',sid,'premier')
    audit=rv.audit_cost(x,metadata)
    guard=rv.guard_only(x)
    guard_parity=assert_numeric_parity(rv.guard_only(a),previous['guardrails'],'contrast guardrail')
    card_audit=[{'card':n,'contrast_term':contrast.get(n,0.),'outcome_term':outcome_cards.get(n,0.),
        'strength':strengths.get(n,0.),'covered':n in strengths,
        'signed_difference':outcome_cards.get(n,0.)-contrast.get(n,0.),'example':elite['examples'].get(n)} for n in top]
    premier_coverage=strength.coverage(a+b,metadata,strengths,table) if available else {'status':'unavailable'}
    for n in {n for r,_,_ in a+b+te+to for n in r.candidates}:
        if n not in table:
            table[n]={'strength':0.,'raw_coefficient':None,'deck_games':0,'covered':False,
                      'excluded_basic':n in strength.BASICS}
    del a,b,x,y
    traditional={'status':'unavailable','reason':trad.get('reason',trad['status']),
        'outcome_correlation':'unavailable: no pinned Traditional game archives',
        'simulation':'unavailable: final Traditional protocol has no simulated profile AUC'}
    if trad['status']=='measured':
        ta,tb=final.predict_pairs(te,metadata,base_context,contrast),final.predict_pairs(to,metadata,base_context,contrast)
        tx,ty=final.predict_pairs(te,metadata,context,outcome_cards),final.predict_pairs(to,metadata,context,outcome_cards)
        traditional.update(status='measured',elite=compare_records(ta,tx,'elite',sid,'traditional'),
            control=compare_records(tb,ty,'control',sid,'traditional'),contrast_guardrails=rv.guard_only(ta),
            outcome_guardrails=rv.guard_only(tx),outcome_cost_audit=rv.audit_cost(tx,metadata),
            outcome_arm_available=available,
            strength_coverage=strength.coverage(ta+tb,metadata,strengths,table) if available else {'status':'unavailable'})
    output.mkdir(parents=True,exist_ok=True)
    bf=output/'bank.json.gz';bf.write_bytes(rv.bank_bytes(sid,bank))
    report={'protocol':PROTOCOL,'set':sid,'source_run':RUN,'registry':REGISTRY,
        'bank_sha256':sha256(bf),'code_sha256':sha256(Path(__file__)),
        'evidence_class':old_report['evidence_class'],'simulation':sim,
        'outcome_pair':[outcome_c,outcome_s],'outcomes':rv.compare_outcomes([[outcome_c,outcome_s]]),
        'reproduction_parity':{'outcomes':outcome_parity,'guardrails':guard_parity},
        'elite':elite,'control':control,'guardrails':guard,'contrast_guardrails':previous['guardrails'],
        'outcome_cost_audit':audit,'contrast_cost_audit':previous['cost_audit'],
        'card_audit':card_audit,'traditional':traditional,
        'outcome_arm_available':available,'strength_evidence':strength_evidence,'strength_table':table,
        'strength_coverage':premier_coverage,'choice_fit':choice_fit,'strength_coefficient':beta,
        'outcome_context':context if available else None,
        'largest_mean_grade_differences':elite['largest_mean_grade_differences']}
    exp.write(output/'report.json',report)
    print(json.dumps({'set':sid,'outcome_arm_available':available,'strength_evidence':strength_evidence,
        'strength_coefficient':beta,'traditional':traditional['status']},indent=2),flush=True)

def strip_unavailable(scope):
    # Only the incumbent metrics are real when an archive is unavailable.
    # The identical third score in the transfer bank was used for parity only.
    sim=scope.get('simulation',{})
    if sim.get('status')=='complete':
        sim['auc'].pop('outcome|1',None)
        sim.pop('paired',None)
    for name in ('prediction','ordinary','elite','control'):
        pred=scope.get(name,{})
        if pred.get('status')=='measured':
            for key in ('outcome','outcome_minus_v6','outcome_minus_contrast'):
                pred['metrics'].pop(key,None)
            pred.get('movement',{}).pop('outcome',None)
            pred.pop('disagreement',None)
    out=scope.get('outcomes',{})
    for key in list(out):
        if key.startswith('revised_'):
            out.pop(key)
    scope['outcome_arm_status']='unavailable'
    return scope


def decision_rule(scopes,failures,missing):
    decision={}
    for name in ('strict_mixed','legacy_mixed'):
        d=scopes[name];pairs=d['simulation'].get('paired',{})
        pred=d['prediction'].get('metrics',{}).get('outcome_minus_contrast',{}).get('log_loss',{}).get('ci95')
        win=d['outcomes'].get('revised_vs_full_ci95')
        ac=pairs.get('contrast|1',{}).get('ci95');av=pairs.get('v6|1',{}).get('ci95')
        decision[name]={
            'guardrails':{'failed_formats':failures,'unavailable_required_formats':missing,'pass':not failures and not missing},
            'auc_vs_contrast':{'ci95':ac,'pass':bool(ac and ac[0]>=-.002)},
            'auc_vs_v6':{'ci95':av,'pass':bool(av and av[0]>0)},
            'log_loss_vs_contrast':{'ci95':pred,'pass':bool(pred and pred[1]<=.005)},
            'win_correlation_vs_contrast':{'ci95':win,'pass':bool(win and win[0]>=0)}}
    return decision


def aggregate(folder,reference,output,strong_reference=None):
    old=read_json(reference);reports={};paths={}
    for p in sorted(folder.glob('pool-aware-v7-outcome-transfer-*/report.json')):
        r=read_json(p);sid=r['set'];bf=p.parent/'bank.json.gz'
        if (r['protocol']!=PROTOCOL or r['registry']!=REGISTRY or r['source_run']!=RUN
            or r['code_sha256']!=sha256(Path(__file__)) or r['bank_sha256']!=sha256(bf)
            or sid in reports or sid not in rv.EXPECTED or 'reproduction_parity' not in r):
            raise ValueError('paired artifact mismatch')
        reports[sid]=r;paths[sid]=bf
    if set(reports)!=rv.EXPECTED:raise ValueError('not all 31 formats reported')
    if old['fit_registry_sha256']!=REGISTRY:raise ValueError('wrong reviewed reference')
    def scope(ids,sim):
        result={'sets':ids,'simulation':sim,'prediction':pool_records([reports[s]['elite'] for s in ids]),
            'ordinary':pool_records([reports[s]['control'] for s in ids]),
            'outcomes':rv.compare_outcomes([reports[s]['outcome_pair'] for s in ids]),
            'unavailable_outcome_formats':[s for s in ids if not reports[s]['outcome_arm_available']]}
        if result['unavailable_outcome_formats']:
            strip_unavailable(result)
        else:
            result['outcome_arm_status']='measured'
        return result
    scopes={}
    for name,previous in old['runs'].items():
        ids=previous['sets']
        if name.startswith('standalone:'):sim=reports[ids[0]]['simulation']
        else:
            rows=[]
            for sid in ids:
                data=read_json(paths[sid])
                if data['set']!=sid:raise ValueError('bank identity mismatch')
                rows.extend(sim_rows(sid,data['rows']))
            sim=simulation(rows,'powered-cube' if name=='powered-cube' else 'mixed',runs=10000,per_draw=2000)
        compare_sim(sim,previous['simulation'])
        scopes[name]=scope(ids,sim)
    unavailable=[s for s,r in reports.items() if not r['outcome_arm_available']]
    missing=[s for s in unavailable if s!='powered-cube']
    failures=[s for s,r in reports.items() if r['outcome_arm_available'] and not rv.safe(r['guardrails'])]
    tf=[s for s,r in reports.items() if r['outcome_arm_available'] and r['traditional']['status']=='measured'
        and not rv.safe(r['traditional']['outcome_guardrails'])]
    max_move=max((r[c]['movement']['outcome']['max_movement'] for r in reports.values()
                  if r['outcome_arm_available'] for c in ('elite','control')),default=None)
    if max_move is not None and max_move>20:
        failures.append('movement_limit')
    decision=decision_rule(scopes,failures+[s+':Traditional' for s in tf],missing)
    passed=all(v['pass'] for d in decision.values() for v in d.values())
    choice='outcome' if passed else 'contrast'
    joint={'status':'pending_strong_only_reference','outcome_passed':passed,
           'note':'Do not finalize combined selection before the separate strong-only comparison is available.'}
    if strong_reference and strong_reference.is_file():
        strong=read_json(strong_reference)
        if (strong.get('protocol')!='v7-strong-only-frozen-comparison-v1' or strong.get('registry')!=REGISTRY
            or strong.get('source_run')!=RUN or set(strong.get('sets',[]))!=rv.EXPECTED):
            raise ValueError('strong-only comparison reference mismatch')
        strong_passed=all(v['pass'] for d in strong['decision'].values() for v in d.values())
        if strong_passed!=(strong['comparison_choice']=='strong-only'):
            raise ValueError('strong-only selection mismatch')
        a=scopes['strict_mixed']['simulation'].get('auc',{}).get('outcome|1',{}).get('value')
        b=strong['scopes']['strict_mixed']['simulation'].get('auc',{}).get('strong-only|1',{}).get('value')
        if strong_passed and (not passed or b>a):
            choice='strong-only'
        elif strong_passed and passed and a==b:
            choice='tie_owner_review'
        joint={'status':'complete','outcome_passed':passed,'strong_only_passed':strong_passed,
               'strict_auc_outcome':a,'strict_auc_strong_only':b,'choice':choice}
    tids=sorted(set(refit.TRAD)&set(reports));t=[reports[s]['traditional'] for s in tids]
    traditional={'sets':tids,'elite':pool_records([x.get('elite',{}) for x in t]),
        'control':pool_records([x.get('control',{}) for x in t]),
        'outcomes':{'status':'unavailable','reason':'no pinned Traditional game archives'},
        'simulation':{'status':'unavailable','reason':'existing Traditional protocol has no simulated AUC'},
        'unavailable_outcome_formats':[s for s in tids if not reports[s]['outcome_arm_available']]}
    if traditional['unavailable_outcome_formats']:strip_unavailable(traditional)
    per_format={}
    for sid,r in sorted(reports.items()):
        tr={k:v for k,v in r['traditional'].items() if k not in ('elite','control')}|{
            'elite':pool_records([r['traditional'].get('elite',{})]),'control':pool_records([r['traditional'].get('control',{})])}
        item={'simulation':r['simulation'],'outcomes':r['outcomes'],'elite':pool_records([r['elite']]),
            'control':pool_records([r['control']]),'guardrails':r['guardrails'] if r['outcome_arm_available'] else {'status':'unavailable'},
            'contrast_guardrails':r['contrast_guardrails'],'card_audit':r['card_audit'],'traditional':tr,
            'largest_mean_grade_differences':r['largest_mean_grade_differences'],
            'strength_evidence':r['strength_evidence'],'strength_coverage':r['strength_coverage'],
            'strength_coefficient':r['strength_coefficient'],'choice_fit':r['choice_fit'],'outcome_context':r['outcome_context'],
            'outcome_arm_status':'measured' if r['outcome_arm_available'] else 'unavailable'}
        if not r['outcome_arm_available']:
            strip_unavailable(item);strip_unavailable(tr)
            tr['outcome_guardrails']={'status':'unavailable'}
        per_format[sid]=item
    result={'protocol':PROTOCOL,'source_run':RUN,'registry':REGISTRY,'sets':sorted(reports),'release_allowed':False,
        'decision':decision,'outcome_comparison_choice':'outcome' if passed else 'contrast',
        'comparison_choice':choice if joint['status']=='complete' else 'pending_joint_selection',
        'joint_selection':joint,
        'reproduction_parity':{s:r['reproduction_parity'] for s,r in sorted(reports.items())},
        'additional_existing_release_checks':{'traditional_guardrail_failures':tf,'premier_max_movement':max_move,
            'unavailable_outcome_formats':unavailable,'cube_fallback':'If unavailable, inherit final selected non-outcome card term (contrast or strong-only); no Cube outcome evidence.',
            'note':'Existing separate stored-production shadow and release review remain required before any production changes.'},
        'scopes':scopes,'traditional':traditional,'per_format':per_format,
        'interpretation':'Historical paired development validation, not causal. Within-skill win correlation is less independent because Model C is trained on game outcomes; training and validation source drafts remain disjoint, with strict chronology except in eight legacy formats.'}
    exp.write(output,result)
    print(json.dumps({'decision':decision,'outcome_comparison_choice':result['outcome_comparison_choice'],
        'joint_selection':joint,'additional_existing_release_checks':result['additional_existing_release_checks']},indent=2),flush=True)


def self_test():
    strength.self_test()
    v={'status':'measured','drafts':2,'totals':[2,2,1,0,2,1,0,1,2,0],
       'bootstrap_totals':[[2,2,1,0,2,1,0,1,2,0]]*DRAW,'movement':{m:{} for m in NAMES},'disagreement':{}}
    assert pool_records([v])['metrics']['outcome_minus_contrast']['log_loss']['ci95']==[-.5,-.5]
    assert pool_records([v,v])['decisions']==4
    d={'simulation':{'paired':{'contrast|1':{'ci95':[-.002,.1]},'v6|1':{'ci95':[.0001,.1]}}},
       'prediction':{'metrics':{'outcome_minus_contrast':{'log_loss':{'ci95':[-.01,.005]}}}},
       'outcomes':{'revised_vs_full_ci95':[0,.01]}}
    scopes={'strict_mixed':d,'legacy_mixed':d}
    assert all(v['pass'] for x in decision_rule(scopes,[],[]).values() for v in x.values())
    assert not decision_rule(scopes,[],['missing'])['strict_mixed']['guardrails']['pass']
    d['outcomes']['revised_vs_full_ci95']=[-.00001,.01]
    assert not decision_rule(scopes,[],[])['legacy_mixed']['win_correlation_vs_contrast']['pass']
    sample={'n':3,'pass':True,'draws':[[123.4,3.2],None],'r':.041}
    rounded={'n':3,'pass':True,'draws':[[123.4+1e-12,3.2],None],'r':.041+1e-14}
    assert assert_numeric_parity(rounded,sample,'roundoff self-test',abs_tol=1e-10)['nonidentical_float_values']==2
    print('Outcome contracts passed: Model C parity, paired aggregation and locked decision boundaries.')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--stage',choices=('measure','aggregate'))
    p.add_argument('--set',choices=sorted(rv.EXPECTED))
    for k in ('prior','fits','old','banks','reference','output','strong-reference'):p.add_argument('--'+k,type=Path)
    a=p.parse_args()
    if a.self_test:self_test()
    elif a.stage=='measure':measure(a.set,a.prior,a.fits,a.old,a.output)
    elif a.stage=='aggregate':aggregate(a.banks,a.reference,a.output,a.strong_reference)
    else:p.error('stage required')

if __name__=='__main__':main()
