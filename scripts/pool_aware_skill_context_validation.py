#!/usr/bin/env python3
"""Validate one fixed context-corrected skill contrast on remaining formats.

Five diagnostic formats chose the arm; the other 26 check generalization of
that design on historical development evidence, not untouched final data.
Never refit or alter the existing coefficients or production score formula.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
import random
import statistics
import subprocess

import numpy as np

import pool_aware_skill_expansion as exp
import pool_aware_skill_recovery as rec
import pool_aware_skill_contrast as skill
import pool_aware_statistical_validation as stat
import scoring_experiment as scoring
from pool_aware_archive import read_json, sha256
from pool_aware_restore import prepare as restore_manifest
from pool_aware_diagnostics import diagnostics

PROTOCOL='skill-contrast-elite-context-validation-v1'
SOURCE=Path(__file__).resolve()
DIAGNOSTIC=set(rec.ABLATION)
EXPECTED=set(exp.SETS)-DIAGNOSTIC
ARM='card-plus-elite-context'
FULL='full'
V6='v6|1'
FULL_KEY=FULL+'|1'
ARM_KEY=ARM+'|1'
MODELS=['v6',FULL,ARM]
DRAWS=stat.BOOTSTRAP_DRAWS


def load_frozen(folder,sid):
    path=folder/'result/report.json'
    r=read_json(path)
    p=r['provenance']; f=r['fit']
    recovered=sid in rec.RECOVER
    protocol=rec.PROTOCOL if recovered else exp.PROTOCOL
    source=Path(rec.__file__) if recovered else Path(exp.__file__)
    if (sid not in EXPECTED or r['set']!=sid or r['protocol']!=protocol or r['status']!='measured'
        or r['release_allowed'] or p['model_recipe_sha256']!=sha256(Path(skill.__file__))
        or p['audit_code_sha256']!=sha256(source) or p['lock_sha256']!=sha256(stat.LOCK)
        or f['features']!=list(skill.FEATURES[:6])
        or f['context_penalty']!=skill.CONTEXT_PENALTY or f['card_prior']!=skill.CARD_PRIOR
        or f['minimum_offered_in_each_fit_cohort']!=skill.MIN_OFFERED
        or f['lambda']!=skill.LAMBDA or f['max_log_adjustment']!=skill.MAX_LOG_ADJUST
        or set(f['elite_card_effects'])!=set(f['control_card_effects'])):
        raise ValueError('frozen prior report identity mismatch')
    if recovered and p['recovery']['chronology']['classification'] not in ('strict_game_time','source_draft_disjoint_only'):
        raise ValueError('unknown prior evidence class')
    return r


def inputs(sid,folder,work):
    prior=load_frozen(folder,sid); p=prior['provenance']
    stat.verify_source_lock()
    files=exp.source_paths(sid)
    for k,name in [('draft','source_archive'),('games','skill_source')]:
        if sha256(files[k])!=p['sources'][k] or p['sources'][k]!=exp.SETS[sid][name]['sha256']:
            raise ValueError('frozen archive source mismatch')
    work.mkdir(parents=True,exist_ok=True)
    dest=work/'rules.json.gz'
    dest.write_bytes((folder/'input/rules.json.gz').read_bytes())
    if sha256(dest)!=p['sources']['metadata']:
        raise ValueError('exact original rule snapshot required')
    exp.write(work/'windows.json',p['windows'])
    m=restore_manifest(sid,exp.directory(sid),dest,work/'windows.json',purge_days=p['purge_days'])
    actual=read_json(m['manifest'])
    if actual['windows']!=p['windows'] or actual['purge_days']!=p['purge_days'] or {k:v['sha256'] for k,v in actual['sources'].items()}!=p['sources']:
        raise ValueError('frozen manifest mismatch')


def configure():
    scoring.MODELS=MODELS
    scoring.EXPONENTS=[1.]
    scoring.BASELINE=V6
    scoring.SEED=stat.SEED


def combined_bank(sid,base,challenger):
    if len(base)!=len(challenger):
        raise ValueError('unequal score-bank length')
    for b,h in zip(base,challenger):
        if b[:5]!=h[:5]:
            raise ValueError('unpaired source, pick, difficulty or baseline grade')
        yield b+[h[5]]


def simulation_rows(sid,bank):
    for b in bank:
        if len(b)!=7 or type(b[6])!=int or not 0<=b[6]<=95:
            raise ValueError('invalid paired bank row')
        r=next(stat.simulation_rows(sid,[b[:6]],FULL))
        r['scores'][ARM_KEY]=b[6]
        yield r


def profile_request(rows,env,runs,single=None):
    opening=2 if env=='mixed' and rows and min(r['pick'] for r in rows)==2 else 1
    if single not in exp.SELECTABLE:
        return scoring.profiles_for(rows,env,runs,False,stat.DAY,opening_pick=opening)
    banks=scoring.source_banks(rows);groups=[]
    for cohort,s,p,b in sorted(banks):
        if cohort=='elite':
            n=min(len(banks[cohort,s,p,b]),len(banks.get(('control',s,p,b),[])))
            if n>=5:
                groups.append({'set_id':s,'pick_number':p,'band':b,'n':n})
    request={'groups':groups,'environment':env,'runs':runs,'daily':False,'day':stat.DAY,
             'seed':stat.SEED,'opening_pick':opening,'single_set':single}
    result=subprocess.run(['node',str(exp.ROOT/'scripts/scoring_run_profiles.mjs')],
        input=json.dumps(request),text=True,capture_output=True,check=True)
    return json.loads(result.stdout)


def paired_simulation(rows,env,runs=stat.RUNS,draws=DRAWS,per_draw=stat.BOOTSTRAP_RUNS,single=None):
    """Existing matched eight-pick profiles, source resampling and AUC;
    additionally retain the direct challenger-minus-full paired interval."""
    configure()
    try:
        profiles=profile_request(rows,env,runs,single)
    except subprocess.CalledProcessError as exc:
        if 'Insufficient held-out coverage for this run profile' not in (exc.stderr or ''):
            raise
        return {'status':'unavailable','reason':'insufficient matched profile coverage','configurations':{}}
    values,complete=scoring.simulate(rows,profiles)
    if complete<.9*len(profiles):
        return {'status':'unavailable','reason':'insufficient distinct-draft coverage','configurations':{}}
    observed={k:scoring.auc(values['elite'][k],values['control'][k]) for k in values['elite']}
    samples={k:[] for k in observed}; direct=[]
    rng=random.Random(stat.SEED+1)
    for i in range(draws):
        boot,n=scoring.simulate(scoring.resample_sources(rows,rng),profiles[:per_draw],stat.SEED+i)
        if n<.9*min(per_draw,len(profiles)):
            continue
        auc={k:scoring.auc(boot['elite'][k],boot['control'][k]) for k in observed}
        for k in observed:
            samples[k].append(auc[k]-auc[V6])
        direct.append(auc[ARM_KEY]-auc[FULL_KEY])
    if len(direct)<.9*draws:
        return {'status':'unavailable','reason':'insufficient valid source-bootstrap draws','configurations':{}}
    return {'status':'complete','runs':complete,'requested_runs':len(profiles),'valid_bootstrap_draws':len(direct),
        'configurations':{k:{'auc':observed[k],'delta_vs_v6':observed[k]-observed[V6],
            'delta_ci95':scoring.interval(samples[k],5) if samples[k] else None,
            'elite_mean':statistics.fmean(values['elite'][k]),'control_mean':statistics.fmean(values['control'][k])} for k in observed},
        'challenger_vs_full':{'delta':observed[ARM_KEY]-observed[FULL_KEY],
                              'ci95':scoring.interval(direct,5) if direct else None}}


def point_guardrails(cohorts,records):
    a=cohorts['elite']['scores']['all']; pred=diagnostics(records,skill.APPLY)['paired']['all']
    tail=a[skill.NAME]['below_25']-a['v6']['below_25']
    return {'severe_tail_delta':tail,'severe_tail_safe':tail<=stat.TAIL_LIMIT,
        'raw_log_loss_delta':pred['raw_log_loss'],
        'raw_log_loss_safe':pred['raw_log_loss']['ci95'] is not None and pred['raw_log_loss']['ci95'][1]<=.005,
        'top1_delta':pred['top1'],'top1_safe':pred['top1']['ci95'] is not None and pred['top1']['ci95'][0]>=-.01}


def context_comparison(old,new):
    out={}
    for k in sorted(set(old)&set(new)):
        a,b=old[k],new[k]
        if a['offers']!=b['offers'] or a['v6_90_95']!=b['v6_90_95'] or a['mean_v6']!=b['mean_v6']:
            raise ValueError('context group membership or baseline changed: '+k)
        out[k]={'offers':a['offers'],'v6_high_credit':a['v6_90_95'],
            'full_mean_change':a['mean_change'],'revised_mean_change':b['mean_change'],
            'full_high_credit':a['skill_aware_90_95'],'revised_high_credit':b['skill_aware_90_95'],
            'full_close_drops':a['90_plus_to_below_75'],'revised_close_drops':b['90_plus_to_below_75'],
            'full_75_to_below_50':a['75_plus_to_below_50'],'revised_75_to_below_50':b['75_plus_to_below_50'],
            'full_decreased_20_plus':a['decreased_20_plus'],'revised_decreased_20_plus':b['decreased_20_plus']}
    return out


def outcome_comparison(pairs):
    """Matched Fisher-z contribution pairs. Same draft sample and same
    deterministic stratum bootstrap per format in exp.outcome_study."""
    valid=[]
    for a,b in pairs:
        if a['status']!='complete' or b['status']!='complete':
            continue
        if (a['weight']!=b['weight'] or a['eligible_drafts']!=b['eligible_drafts']
            or a['strata']!=b['strata'] or a['pick_slice']!=b['pick_slice']
            or not math.isclose(a['fisher_sums'][0],b['fisher_sums'][0],rel_tol=1e-10,abs_tol=1e-10)):
            raise ValueError('unpaired outcome samples')
        valid.append((a,b))
    if not valid:
        return {'status':'unavailable','formats':0}
    w=sum(a['weight'] for a,b in valid)
    def corr(values):
        return np.tanh(np.sum(values,axis=0)/w)
    point=corr([[a['fisher_sums'][0],a['fisher_sums'][1],b['fisher_sums'][1]] for a,b in valid])
    reps=[]
    for i in range(exp.OUTCOME_DRAWS):
        sums=[]
        for a,b in valid:
            x,y=a['bootstrap_fisher_sums'][i],b['bootstrap_fisher_sums'][i]
            if x is None or y is None:
                break
            if not math.isclose(x[0],y[0],rel_tol=1e-10,abs_tol=1e-10):
                raise ValueError('unpaired outcome bootstrap draw')
            sums.append([x[0],x[1],y[1]])
        else:
            r=corr(sums)
            reps.append([float(r[2]-r[0]),float(r[2]-r[1])])
    enough=len(reps)>=.9*exp.OUTCOME_DRAWS
    ci=np.quantile(np.asarray(reps),[.025,.975],axis=0).T.tolist() if enough else [None,None]
    return {'status':'complete' if enough else 'insufficient_bootstrap',
        'formats':len(valid),'formats_without_matched_outcomes':len(pairs)-len(valid),
        'drafts':sum(a['eligible_drafts'] for a,b in valid),'strata':sum(a['strata'] for a,b in valid),
        'v6_r':float(point[0]),'full_r':float(point[1]),'revised_r':float(point[2]),
        'revised_vs_v6':float(point[2]-point[0]),'revised_vs_full':float(point[2]-point[1]),
        'revised_vs_v6_ci95':ci[0],'revised_vs_full_ci95':ci[1],
        'valid_bootstrap_draws':len(reps),'interpretation':'within exact skill bucket and pick count; descriptive, not causal'}


def measure(sid,folder,output):
    prior=load_frozen(folder,sid); p=prior['provenance']
    prepare=rec.prepare_recovered if sid in rec.RECOVER else exp.prepare_fit
    full_e,full_o,fit,metadata,draft_path,provenance=prepare(sid,exp.directory(sid)/'manifest.json',prior)
    if provenance['sources']!=p['sources'] or provenance['windows']!=p['windows']:
        raise ValueError('regenerated validation provenance mismatch')
    if sid in rec.RECOVER and provenance['recovery']!=p['recovery']:
        raise ValueError('legacy/duplicate classification changed')
    outcomes=stat.selected_outcomes(draft_path,{r.source for r,_,_ in full_e+full_o})
    full_cohorts,full_bank=stat.summarize(sid,skill.APPLY,full_e,full_o,outcomes,candidate_name=skill.NAME)
    digest=hashlib.sha256(gzip.compress(json.dumps({'set':sid,'rows':full_bank},separators=(',',':')).encode(),mtime=0)).hexdigest()
    if digest!=prior['bank_sha256']:
        raise ValueError('original full candidate score-bank digest mismatch')
    for cohort in ('elite','control'):
        for model in ('v6',skill.NAME):
            for key in ('decisions','top1','raw_log_loss','display_log_loss','display_brier'):
                a=full_cohorts[cohort]['prediction'][model][key]
                b=prior['cohorts'][cohort]['prediction'][model][key]
                if not math.isclose(a,b,rel_tol=1e-9,abs_tol=1e-10):
                    raise ValueError('original score metrics changed')
    del full_cohorts
    cards={c:fit['elite_card_effects'][c]-fit['control_card_effects'][c] for c in fit['elite_card_effects']}
    context=tuple(fit['elite_context'])
    # This is precisely the fourth diagnostic arm, not a new fit or blend.
    # skill.apply overwrites only the reserved correction slot; the six
    # contextual input features and incumbent supports are unchanged.
    e=skill.predict_pairs(full_e,context,cards)
    o=skill.predict_pairs(full_o,context,cards)
    del full_e,full_o
    cohorts,bank=stat.summarize(sid,skill.APPLY,e,o,outcomes,candidate_name=skill.NAME)
    guards=point_guardrails(cohorts,e)
    audit=exp.card_audit(e,metadata)
    groups=context_comparison(prior['card_audit']['groups'],audit['groups'])
    actual=exp.outcome_study(sid,e+o,outcomes)
    outcome=outcome_comparison([(prior['outcomes'],actual)])
    del e,o,outcomes
    paired=list(combined_bank(sid,full_bank,bank))
    del full_bank,bank
    output.mkdir(parents=True,exist_ok=True)
    bf=output/'paired-bank.json.gz'
    bf.write_bytes(gzip.compress(json.dumps({'set':sid,'rows':paired},separators=(',',':')).encode(),mtime=0))
    simulation=paired_simulation(list(simulation_rows(sid,paired)),'powered-cube' if sid=='powered-cube' else 'mixed',single=sid)
    if simulation['status']=='complete' and prior['simulation']['status']=='complete':
        for old,new in [('v6|1',V6),('skill-aware|1',FULL_KEY)]:
            if not math.isclose(prior['simulation']['configurations'][old]['auc'],simulation['configurations'][new]['auc'],rel_tol=1e-12,abs_tol=1e-12):
                raise ValueError('prior simulated AUC parity failure')
    report={'protocol':PROTOCOL,'set':sid,'status':'measured','release_allowed':False,
        'scope':'historical out-of-diagnostic-format design validation; no fresh untouched final data',
        'evidence_class':p.get('recovery',{}).get('chronology',{}).get('classification','strict_game_time'),
        'prior_protocol':prior['protocol'],'prior_report_sha256':sha256(folder/'result/report.json'),
        'prior_bank_sha256':prior['bank_sha256'],'model_recipe_sha256':sha256(Path(skill.__file__)),
        'audit_code_sha256':sha256(SOURCE),'lock_sha256':sha256(stat.LOCK),
        'paired_bank_sha256':sha256(bf),'cohorts':cohorts,'guardrails':guards,
        'prior_guardrails':prior['guardrails'],'simulation':simulation,'context_comparison':groups,
        'card_audit':audit,'outcome_comparison':outcome,'outcome_pair':[prior['outcomes'],actual]}
    exp.write(output/'report.json',report)
    print(json.dumps({'set':sid,'evidence_class':report['evidence_class'],'simulation':simulation,'guardrails':guards,
        'context_comparison':{k:v for k,v in groups.items() if k in ('late_supported_proxy','late_missing_access_proxy','early_speculation_proxy','fixing_utility_proxy','v6_close_alternative')},
        'outcomes':outcome},indent=2),flush=True)


def pool_groups(reports):
    accum={}
    for r in reports:
        for k,g in r['context_comparison'].items():
            a=accum.setdefault(k,{'offers':0,'v6_high_credit':0,'full_mean_change':0.,'revised_mean_change':0.,
                'full_high_credit':0,'revised_high_credit':0,'full_close_drops':0,'revised_close_drops':0,
                'full_75_to_below_50':0,'revised_75_to_below_50':0,
                'full_decreased_20_plus':0,'revised_decreased_20_plus':0})
            for key in a:
                a[key]+=g[key]*g['offers'] if key.endswith('mean_change') else g[key]
    for a in accum.values():
        for k in ('full_mean_change','revised_mean_change'):
            a[k]/=a['offers']
    return accum


def aggregate(folder,pilot_dir,output):
    reports={}; bank_paths={}; pilots={}
    for path in sorted(folder.glob('pool-aware-context-transfer-*/report.json')):
        r=read_json(path);s=r['set']
        if s not in EXPECTED or s in reports or r['protocol']!=PROTOCOL or r['release_allowed'] or r['status']!='measured':
            raise ValueError('unexpected validation report')
        if (r['model_recipe_sha256']!=sha256(Path(skill.__file__)) or r['audit_code_sha256']!=sha256(SOURCE)
            or r['lock_sha256']!=sha256(stat.LOCK)):
            raise ValueError('validation code or recipe mismatch')
        bf=path.parent/'paired-bank.json.gz'
        if sha256(bf)!=r['paired_bank_sha256']:
            raise ValueError('paired bank checksum mismatch')
        reports[s]=r;bank_paths[s]=bf
    for path in sorted(pilot_dir.glob('pool-aware-ablation-*/ablation.json')):
        r=read_json(path);s=r['set']
        if s not in DIAGNOSTIC or s in pilots or r['protocol']!='skill-contrast-component-ablation-v1' or r['release_allowed']:
            raise ValueError('unexpected diagnostic report')
        pilots[s]=r
    if not reports:
        raise ValueError('no additional-format reports')
    reg=set(exp.SETS)-exp.SELECTABLE-{'powered-cube'}
    strict={s for s,r in reports.items() if r['evidence_class']=='strict_game_time'}
    legacy=set(reports)-strict
    missing=sorted(EXPECTED-set(reports))
    result={'protocol':PROTOCOL,'release_allowed':False,'expected_additional_formats':sorted(EXPECTED),
        'measured_additional_formats':sorted(reports),'missing_additional_formats':missing,
        'diagnostic_formats':sorted(pilots),'missing_diagnostic_formats':sorted(DIAGNOSTIC-set(pilots)),
        'strict_additional_formats':sorted(strict),'legacy_additional_formats':sorted(legacy),
        'runs':{},'groups':{},'outcomes':{},'sets':{},'diagnostics':{}}
    scopes={'strict_mixed':strict&reg,'legacy_mixed':legacy&reg}
    scopes.update({'standalone:'+s:{s} for s in sorted(exp.SELECTABLE&set(reports))})
    for label,sids in scopes.items():
        ids=sorted(sids)
        if not ids:
            continue
        if label.startswith('standalone:'):
            sim=reports[ids[0]]['simulation']
        else:
            rr=[]
            for s in ids:
                d=read_json(bank_paths[s])
                if d['set']!=s:
                    raise ValueError('paired bank set mismatch')
                rr.extend(simulation_rows(s,d['rows']))
                del d
            sim=paired_simulation(rr,'mixed',runs=10000,per_draw=2000)
            del rr
        g=pool_groups([reports[s] for s in ids])
        result['runs'][label]={'formats':ids,'simulation':sim,
            'all_guardrails_safe':all(all(reports[s]['guardrails'][k] for k in ('severe_tail_safe','raw_log_loss_safe','top1_safe')) for s in ids)}
        result['groups'][label]=g
        result['outcomes'][label]=outcome_comparison([reports[s]['outcome_pair'] for s in ids])
    result['groups']['all_additional_formats']=pool_groups(list(reports.values()))
    result['outcomes']['all_additional_formats']=outcome_comparison([r['outcome_pair'] for r in reports.values()])
    for s,r in reports.items():
        result['sets'][s]={'evidence_class':r['evidence_class'],'simulation':r['simulation'],'guardrails':r['guardrails'],
            'groups':r['context_comparison'],'outcomes':r['outcome_comparison'],'examples':r['card_audit']['examples']}
    for s,r in pilots.items():
        a=r['arms'][FULL];b=r['arms'][ARM]
        result['diagnostics'][s]={'simulation':r['simulation'],'groups':context_comparison(a['card_groups'],b['card_groups']),
            'full_outcomes':a['outcomes'],'revised_outcomes':b['outcomes'],'revised_severe_tail_delta':b['severe_tail_delta'],
            'revised_prediction':b['paired_prediction']}
    exp.write(output,result)
    print(json.dumps({'measured_additional_formats':result['measured_additional_formats'],'missing_additional_formats':missing,
        'diagnostic_formats':result['diagnostic_formats'],'runs':result['runs'],'groups':result['groups'],
        'outcomes':result['outcomes'],'sets':{s:{'simulation':r['simulation'],'guardrails':r['guardrails']} for s,r in result['sets'].items()}},indent=2),flush=True)


def self_test():
    rec.self_test()
    bank=[[c,d,p,b,70 if c=='elite' else 45,75 if c=='elite' else 42]
        for c in ('elite','control') for d in range(12) for p in range(1,9) for b in ('easy','medium','hard')]
    candidate=[r[:5]+[78 if r[0]=='elite' else 40] for r in bank]
    rows=list(simulation_rows('dft',list(combined_bank('dft',bank,candidate))))
    s=paired_simulation(rows,'mixed',runs=20,draws=2,per_draw=10)
    assert s['status']=='complete' and s['configurations'][ARM_KEY]['auc']==1 and s['challenger_vs_full']['delta']==0
    rows=list(simulation_rows('hbg',list(combined_bank('hbg',bank,candidate))))
    assert paired_simulation(rows,'mixed',runs=20,draws=2,per_draw=10,single='hbg')['status']=='complete'
    a={'status':'complete','weight':297,'eligible_drafts':300,'strata':1,'pick_slice':[1,8],
        'fisher_sums':[20.,30.],'bootstrap_fisher_sums':[[20.,30.]]*exp.OUTCOME_DRAWS}
    b=dict(a,fisher_sums=[20.,35.],bootstrap_fisher_sums=[[20.,35.]]*exp.OUTCOME_DRAWS)
    assert outcome_comparison([(a,b)])['revised_vs_full']>0
    assert outcome_comparison([(a,b)])['status']=='complete'
    print('Context validation contracts passed: paired three-arm AUC, candidate-only profiles, matched outcome intervals.',flush=True)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--stage',choices=('restore','inputs','measure','aggregate'))
    p.add_argument('--set',choices=sorted(EXPECTED))
    p.add_argument('--prior',type=Path)
    p.add_argument('--work',type=Path)
    p.add_argument('--output',type=Path)
    p.add_argument('--banks',type=Path)
    p.add_argument('--pilots',type=Path)
    a=p.parse_args()
    if a.self_test:
        self_test();return
    if a.stage=='aggregate':
        aggregate(a.banks,a.pilots,a.output);return
    if not a.set or not a.work or not a.output:
        p.error('set, work and output required')
    if a.stage=='restore':
        exp.recover(a.set)
    elif a.stage=='inputs':
        inputs(a.set,a.prior,a.work)
    elif a.stage=='measure':
        measure(a.set,a.prior,a.output)
    else:
        p.error('stage required')


if __name__=='__main__':
    main()
