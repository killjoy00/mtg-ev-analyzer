#!/usr/bin/env python3
"""One predeclared reviewed v7 comparison; fit, transfer, shadow, decide."""
from __future__ import annotations
import argparse
from collections import Counter,defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path
import random
import statistics
import subprocess

import pool_aware_skill_context_validation as ctx
import pool_aware_skill_expansion as exp
import pool_aware_skill_recovery as rec
import pool_aware_skill_contrast as skill
import pool_aware_statistical_validation as stat
import pool_aware_skill_final_correction as final
import pool_aware_mana_final as parser
import pool_aware_skill_parser_correction as prior_parser
import pool_aware_mana_parser_v2 as v2
import pool_aware_v7_refit as refit
import scoring_experiment as scoring
from pool_aware_archive import read_json,sha256
from pool_aware_restore import restore
from pool_aware_refit import weights
from pool_aware_diagnostics import grade,diagnostics,leader

PROTOCOL='v7-reviewed-validation-v1'
SOURCE=Path(__file__).resolve()
EXPECTED=set(exp.SETS)
ORDER=('refit','no-refit','parser-v2')
ARMS=('parser-v2','no-refit','refit')
GUARDS=('severe_tail_safe','raw_log_loss_safe','top1_safe')
V6='v6|1'

def registry_digest(fits):
    return hashlib.sha256(json.dumps(fits,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()

def bank_bytes(sid,bank):
    return gzip.compress(json.dumps({'set':sid,'rows':bank},separators=(',',':')).encode(),mtime=0)

def frozen_prior(folder,sid):
    ctx.EXPECTED=EXPECTED
    return ctx.load_frozen(folder,sid)

def parser_report(folder,sid,prior_path):
    r=read_json(folder/'report.json')
    if (r['set']!=sid or r['status']!='measured' or r['release_allowed']
        or r['protocol']!=prior_parser.PROTOCOL or r['prior_report_sha256']!=sha256(prior_path)
        or r['correction_code_sha256']!=sha256(Path(prior_parser.__file__))
        or r['parser_code_sha256']!=sha256(Path(v2.__file__))
        or r['audit_code_sha256']!=sha256(exp.ROOT/'scripts/pool_aware_skill_parser_validation.py')):
        raise ValueError('parser v2 comparator provenance mismatch')
    return r

def apply_arm(arm,records,metadata,fit,context_only=None):
    engine=prior_parser if arm=='parser-v2' else final
    context,cards=engine.parameters(fit)
    if context_only is not None:context,cards=context_only,{}
    return engine.predict_pairs(records,metadata,context,cards)

def guard_only(elite):
    if len(elite)<50 or len({r.source for r,_,_ in elite})<2:
        return {'status':'unavailable','reason':'insufficient strong-player coverage'}
    n=len(elite);base=challenger=0
    for r,_,_ in elite:
        base+=grade(weights(r,skill.ZERO))[r.chosen]<25
        challenger+=grade(weights(r,skill.APPLY))[r.chosen]<25
    pred=diagnostics(elite,skill.APPLY)['paired']['all']
    delta=(challenger-base)/n
    return {'status':'measured','decisions':n,'drafts':len({r.source for r,_,_ in elite}),
        'v6_below_25':base/n,'candidate_below_25':challenger/n,
        'severe_tail_delta':delta,'severe_tail_safe':delta<=stat.TAIL_LIMIT,
        'raw_log_loss_delta':pred['raw_log_loss'],
        'raw_log_loss_safe':pred['raw_log_loss']['ci95'] is not None and pred['raw_log_loss']['ci95'][1]<=.005,
        'top1_delta':pred['top1'],'top1_safe':pred['top1']['ci95'] is not None and pred['top1']['ci95'][0]>=-.01}

def safe(g):
    return g.get('status')=='measured' and all(g.get(k) is True for k in GUARDS)

def make_bank(sid,banks):
    base=banks[ARMS[0]]
    if any(len(banks[a])!=len(base) for a in ARMS):
        raise ValueError('unpaired score-bank size')
    for i,b in enumerate(base):
        same=[banks[a][i] for a in ARMS]
        if any(x[:5]!=b[:5] for x in same):raise ValueError('unpaired score-bank row')
        yield b[:5]+[x[5] for x in same]

def simulation_rows(sid,bank):
    for b in bank:
        if len(b)!=5+len(ARMS) or any(type(x)!=int or not 0<=x<=95 for x in b[4:]):
            raise ValueError('invalid anonymous multi-arm bank')
        r=next(stat.simulation_rows(sid,[b[:6]],ARMS[0]))
        r['scores'].update({a+'|1':x for a,x in zip(ARMS,b[5:])})
        yield r

def simulate(rows,env,runs=stat.RUNS,draws=stat.BOOTSTRAP_DRAWS,per_draw=stat.BOOTSTRAP_RUNS,single=None):
    scoring.MODELS=['v6',*ARMS];scoring.EXPONENTS=[1.];scoring.BASELINE=V6;scoring.SEED=stat.SEED
    try:
        profiles=ctx.profile_request(rows,env,runs,single)
    except subprocess.CalledProcessError as exc:
        if 'Insufficient held-out coverage for this run profile' not in (exc.stderr or ''):raise
        return {'status':'unavailable','reason':'insufficient profile coverage','configurations':{}}
    values,complete=scoring.simulate(rows,profiles)
    if complete<.9*len(profiles):
        return {'status':'unavailable','reason':'insufficient distinct-source profiles','configurations':{}}
    observed={k:scoring.auc(values['elite'][k],values['control'][k]) for k in values['elite']}
    samples={k:[] for k in observed}; paired={a:[] for a in ARMS}
    rng=random.Random(stat.SEED+1)
    for i in range(draws):
        boot,n=scoring.simulate(scoring.resample_sources(rows,rng),profiles[:per_draw],stat.SEED+i)
        if n<.9*min(per_draw,len(profiles)):continue
        auc={k:scoring.auc(boot['elite'][k],boot['control'][k]) for k in observed}
        for k in observed:samples[k].append(auc[k]-auc[V6])
        for a in ARMS:paired[a].append(auc[a+'|1']-auc['parser-v2|1'])
    if len(samples[V6])<.9*draws:
        return {'status':'unavailable','reason':'insufficient bootstrap draws','configurations':{}}
    return {'status':'complete','runs':complete,'requested_runs':len(profiles),
        'valid_bootstrap_draws':len(samples[V6]),
        'configurations':{k:{'auc':v,'delta_vs_v6':v-observed[V6],'delta_ci95':scoring.interval(samples[k],5),
            'elite_mean':statistics.fmean(values['elite'][k]),'control_mean':statistics.fmean(values['control'][k])}
            for k,v in observed.items()},
        'direct_vs_parser_v2':{a:{'delta':observed[a+'|1']-observed['parser-v2|1'],
            'ci95':scoring.interval(paired[a],5)} for a in ARMS}}

def audit_cost(records,metadata):
    old_rules=v2.index(metadata);rules=parser.index(metadata)
    counts=defaultdict(Counter);max_move=0;changes=0
    examples={};review_examples={}
    named={'Eldrazi Ravager','Dig Through Time','Concealing Curtains','Junkblade Bruiser'}
    for r,pick_pool,k in records:
        base=weights(r,skill.ZERO);cand=weights(r,skill.APPLY)
        a,b=grade(base),grade(cand)
        changes+=leader(r,base)!=leader(r,cand)
        for i,name in enumerate(r.candidates):
            d=b[i]-a[i];max_move=max(max_move,abs(d))
            if i==r.chosen:continue
            old,new=old_rules.get(name),rules.get(name)
            # MATCHED recovered-cost group from run 46058171727; do not
            # change its denominator when additional layouts become readable.
            group=('recovered_cost' if old.previous_status=='unreadable' and old.status=='readable' else
                'newly_readable' if old.status=='unreadable' and new.status=='readable' else
                'land' if new.status=='land' else 'still_unreadable' if new.status=='unreadable' else 'readable')
            groups=['overall',group]
            if new.sources:groups+=['recognized_source',*sorted({'source_'+s.kind for s in new.sources})]
            if any(t[5] for t in new.routes):groups.append('printed_colorless')
            if any(t[6] for t in new.routes):groups.append('printed_snow')
            for g in groups:
                c=counts[g];c['offers']+=1;c['sum_delta']+=d;c['absolute_change_sum']+=abs(d)
                c['90_to_below_75']+=a[i]>=90 and b[i]<75
                c['drop_20_plus']+=d<=-20;c['moved_20_plus']+=abs(d)>=20
                c['maximum_absolute_change']=max(c['maximum_absolute_change'],abs(d))
            if d<=-15 or name in named:
                ex={'card':name,'pick':k,'pool':sorted(pick_pool),'pack':sorted(r.candidates),'v6':a[i],
                    'v7':b[i],'delta':d,'cost_class':group,'printed_costs':list(new.costs)}
                if name not in examples or d<examples[name]['delta']:examples[name]=ex
                if name in named and (name not in review_examples or d<review_examples[name]['delta']):
                    review_examples[name]=ex
    return {'groups':{g:dict(c,mean_delta=c['sum_delta']/c['offers']) for g,c in counts.items()},
        'maximum_absolute_change':max_move,'leader_changes':changes,'decisions':len(records),
        'largest_reductions':sorted(examples.values(),key=lambda r:(r['delta'],r['card']))[:30],
        'review_examples':review_examples}

def max_movement(records):
    maximum=0
    for r,_,_ in records:
        a,b=grade(weights(r,skill.ZERO)),grade(weights(r,skill.APPLY))
        maximum=max(maximum,max(abs(x-y) for x,y in zip(a,b)))
    return maximum

def check_prediction(actual,expected):
    for c in ('elite','control'):
        for m in ('v6',skill.NAME):
            for k in ('decisions','top1','raw_log_loss','display_log_loss','display_brier'):
                if not math.isclose(actual[c]['prediction'][m][k],expected[c]['prediction'][m][k],rel_tol=1e-9,abs_tol=1e-10):
                    raise ValueError('parser v2 prediction parity failure '+c+'/'+m+'/'+k)

def measure(sid,folder,previous,fits_path,output):
    prior=frozen_prior(folder,sid);old_report=parser_report(previous,sid,folder/'result/report.json')
    fits=refit.load_fits(fits_path);frozen=refit.check_fit(fits[sid],sid,prior)
    e,o,metadata,draft_path,prov,model,ids,windows=refit.prepare(sid,exp.directory(sid)/'manifest.json',prior,'validation')
    fp=frozen['provenance']
    for k in ('sources','windows','purge_days','baseline_cutoff','baseline_picks','baseline_drafts','baseline_colour_coverage','recovery'):
        if prov[k]!=fp[k]:raise ValueError('fit/validation provenance mismatch '+k)
    outcomes=stat.selected_outcomes(draft_path,{r.source for r,_,_ in e+o})
    # Reconstruct the original exact skill-contrast bank before measuring any
    # challenger. Fit is already frozen in a separate completed job.
    oldfit=prior['fit']
    old_ctx=tuple(a-b for a,b in zip(oldfit['elite_context'],oldfit['control_context']))
    old_cards={c:oldfit['elite_card_effects'][c]-oldfit['control_card_effects'][c] for c in oldfit['elite_card_effects']}
    orig_e=skill.predict_pairs(e,old_ctx,old_cards);orig_o=skill.predict_pairs(o,old_ctx,old_cards)
    _,bank=stat.summarize(sid,skill.APPLY,orig_e,orig_o,outcomes,candidate_name=skill.NAME)
    if hashlib.sha256(bank_bytes(sid,bank)).hexdigest()!=prior['bank_sha256']:
        raise ValueError('original full candidate bank digest mismatch')
    del orig_e,orig_o,bank
    trad,te,to=refit.traditional(sid,model,metadata,fp['baseline_cutoff'],windows,ids)
    del model,ids
    old_index=v2.index(metadata);new_index=parser.index(metadata)
    transition=Counter(c.status+'->'+new_index.get(n).status for n,c in old_index.cards.items())
    if transition['readable->unreadable']:raise ValueError('parser regressed a readable alias')
    remaining=[{'name':n,'layout':c.layout,'reasons':list(c.notes)} for n,c in new_index.cards.items() if c.status=='unreadable']
    if any(c['layout'] in ('prepare','reversible_card') for c in remaining):
        raise ValueError('reviewed layout still unreadable')
    reports={};banks={};reference_actual=None
    for arm in ARMS:
        fit=frozen['fit'] if arm=='refit' else oldfit
        a,b=apply_arm(arm,e,metadata,fit),apply_arm(arm,o,metadata,fit)
        cohorts,bank=stat.summarize(sid,skill.APPLY,a,b,outcomes,candidate_name=skill.NAME)
        if arm=='parser-v2':check_prediction(cohorts,old_report['cohorts'])
        banks[arm]=bank
        audit=audit_cost(a,metadata)
        audit['maximum_absolute_change']=max(audit['maximum_absolute_change'],max_movement(b))
        guard=guard_only(a)
        actual=exp.outcome_study(sid,a+b,outcomes)
        if reference_actual is None:reference_actual=actual
        outcome_pair=[reference_actual,actual]
        context=exp.card_audit(a,metadata)
        del a,b
        # Same fixed cutoff and validation cohort for LOO. No card effects or
        # target-format fit coefficients. Every source format has equal weight.
        mean=refit.mean_context(fits,exclude=sid,previous=arm!='refit')
        loo=apply_arm(arm,e,metadata,fit,context_only=mean)
        new_set={'source_formats':sorted(EXPECTED-{sid}),'context':list(mean),'card_terms':0,
                 'guardrails':guard_only(loo),'maximum_absolute_change':max_movement(loo)}
        del loo
        if trad['status']=='measured':
            t=apply_arm(arm,te,metadata,fit);other=apply_arm(arm,to,metadata,fit)
            transfer={'guardrails':guard_only(t),'ordinary_decisions':len(other),
                'cost_audit':audit_cost(t,metadata),'maximum_absolute_change':max(max_movement(t),max_movement(other))}
            del t,other
        else:transfer={'status':'unavailable','reason':trad.get('reason',trad['status'])}
        reports[arm]={'cohorts':cohorts,'guardrails':guard,'cost_audit':audit,'context_groups':context['groups'],
            'outcome_pair':outcome_pair,'outcomes':ctx.outcome_comparison([outcome_pair]),
            'new_set':new_set,'traditional':transfer}
    del e,o,te,to,outcomes
    pair=list(make_bank(sid,banks));del banks
    output.mkdir(parents=True,exist_ok=True);bf=output/'bank.json.gz'
    bf.write_bytes(bank_bytes(sid,pair))
    sim=simulate(list(simulation_rows(sid,pair)),'powered-cube' if sid=='powered-cube' else 'mixed',single=sid)
    if sim['status']=='complete':
        for old,new in [('v6|1',V6),('revised-parser-v2|1','parser-v2|1')]:
            if not math.isclose(sim['configurations'][new]['auc'],old_report['simulation']['configurations'][old]['auc'],rel_tol=1e-12,abs_tol=1e-12):
                raise ValueError('prior simulated AUC parity failure')
    report={'protocol':PROTOCOL,'set':sid,'release_allowed':False,
        'evidence_class':prior['provenance'].get('recovery',{}).get('chronology',{}).get('classification','strict_game_time'),
        'fit_registry_sha256':registry_digest(fits),'fit_report_sha256':hashlib.sha256(json.dumps(frozen,sort_keys=True).encode()).hexdigest(),
        'audit_code_sha256':sha256(SOURCE),'parser_sha256':sha256(Path(parser.__file__)),
        'bank_sha256':sha256(bf),'simulation':sim,'arms':reports,'traditional_archive':trad,
        'parser_alias_transitions':dict(transition),'remaining_unreadable':remaining}
    exp.write(output/'report.json',report)
    print(json.dumps({'set':sid,'simulation':sim,'traditional_archive':trad,
        'parser_alias_transitions':dict(transition),'remaining_unreadable':remaining,
        'arms':{k:{'guardrails':r['guardrails'],'cost_audit':r['cost_audit']['groups'],
            'maximum_absolute_change':r['cost_audit']['maximum_absolute_change'],'leader_changes':r['cost_audit']['leader_changes'],
            'new_set':r['new_set'],'traditional':{x:y for x,y in r['traditional'].items() if x!='cost_audit'},
            'outcomes':r['outcomes']} for k,r in reports.items()}},indent=2),flush=True)

def pool_cost(reports,arm,traditional=False):
    counts=defaultdict(Counter);maximum=leaders=n=0
    for r in reports:
        entry=r['arms'][arm]
        if traditional:
            entry=entry['traditional']
            if 'cost_audit' not in entry:continue
        a=entry['cost_audit'];maximum=max(maximum,a['maximum_absolute_change'],entry.get('maximum_absolute_change',0))
        leaders+=a['leader_changes'];n+=a['decisions']
        for g,v in a['groups'].items():
            c=counts[g]
            for k,x in v.items():
                if k=='mean_delta':continue
                if k=='maximum_absolute_change':c[k]=max(c[k],x)
                else:c[k]+=x
    return {'groups':{g:dict(c,mean_delta=c['sum_delta']/c['offers']) for g,c in counts.items()},
        'maximum_absolute_change':maximum,'leader_changes':leaders,'decisions':n}

def aggregate(folder,fits_path,output):
    fits=refit.load_fits(fits_path);digest=registry_digest(fits)
    reports={};paths={}
    for path in sorted(folder.glob('pool-aware-v7-reviewed-transfer-*/report.json')):
        r=read_json(path);s=r['set'];bf=path.parent/'bank.json.gz'
        if (s not in EXPECTED or s in reports or r['protocol']!=PROTOCOL or r['release_allowed']
            or r['fit_registry_sha256']!=digest or r['audit_code_sha256']!=sha256(SOURCE)
            or r['parser_sha256']!=sha256(Path(parser.__file__)) or sha256(bf)!=r['bank_sha256']):
            raise ValueError('report/bank provenance mismatch')
        reports[s]=r;paths[s]=bf
    if not reports:raise ValueError('no measurements')
    strict={s for s,r in reports.items() if r['evidence_class']=='strict_game_time'}
    legacy=set(reports)-strict;reg=EXPECTED-exp.SELECTABLE-{'powered-cube'}
    result={'protocol':PROTOCOL,'release_allowed':False,'fit_registry_sha256':digest,
        'measured':sorted(reports),'missing':sorted(EXPECTED-set(reports)),
        'strict':sorted(strict),'legacy':sorted(legacy),'runs':{},'arms':{},
        'traditional_archives':{s:r['traditional_archive'] for s,r in reports.items() if s in refit.TRAD},
        'missing_traditional_archives':sorted(set(refit.TRAD)-set(reports)),
        'metadata':{s:{'transitions':r['parser_alias_transitions'],'remaining':r['remaining_unreadable']} for s,r in reports.items()}}
    scopes={'strict_mixed':strict&reg,'legacy_mixed':legacy&reg,'powered-cube':set(reports)&{'powered-cube'}}
    scopes.update({'standalone:'+s:{s} for s in sorted(exp.SELECTABLE&set(reports))})
    for name,ids in scopes.items():
        if not ids:continue
        ids=sorted(ids)
        if name.startswith('standalone:'):sim=reports[ids[0]]['simulation']
        else:
            rows=[]
            for s in ids:
                d=read_json(paths[s])
                if d['set']!=s:raise ValueError('bank set mismatch')
                rows.extend(simulation_rows(s,d['rows']))
            sim=simulate(rows,'powered-cube' if name=='powered-cube' else 'mixed',runs=10000,per_draw=2000)
            del rows
        result['runs'][name]={'sets':ids,'simulation':sim,
            'outcomes':{a:ctx.outcome_comparison([reports[s]['arms'][a]['outcome_pair'] for s in ids]) for a in ARMS}}
    for a in ARMS:
        per={s:r['arms'][a] for s,r in reports.items()}
        cost=pool_cost(reports.values(),a)
        tcost=pool_cost(reports.values(),a,traditional=True)
        loo={s:v['new_set'] for s,v in per.items()}
        trad={s:v['traditional'] for s,v in per.items() if s in refit.TRAD}
        result['arms'][a]={'cost_audit':cost,'traditional_cost_audit':tcost,
            'premier_guardrail_failures':sorted(s for s,r in per.items() if not safe(r['guardrails'])),
            'new_set_guardrail_failures':sorted(s for s,r in loo.items() if not safe(r['guardrails'])),
            'traditional_guardrail_failures':sorted(s for s,r in trad.items() if 'guardrails' in r and not safe(r['guardrails'])),
            'traditional_unavailable':sorted(s for s,r in trad.items() if 'guardrails' not in r),
            'new_set':loo,'traditional':{s:{k:v for k,v in r.items() if k!='cost_audit'} for s,r in trad.items()},
            'starting_configuration':{'context':list(refit.mean_context(fits,previous=a!='refit')),'card_effects':{},
                'source_formats':sorted(EXPECTED),'validated_leave_one_format_out':len(loo)==31 and all(safe(v['guardrails']) for v in loo.values())},
            'per_format':{s:{'guardrails':v['guardrails'],'cost_audit':v['cost_audit'],
                'context_groups':v['context_groups'],'simulation':reports[s]['simulation']} for s,v in per.items()}}
    exp.write(output,result)
    print(json.dumps({'measured':result['measured'],'missing':result['missing'],
        'runs':{k:v['simulation'] for k,v in result['runs'].items()},
        'traditional_archives':result['traditional_archives'],
        'arms':{a:{k:v for k,v in r.items() if k not in ('per_format','new_set','traditional')} for a,r in result['arms'].items()}},indent=2),flush=True)

def decision(combined,shadow_dir,output):
    report=read_json(combined)
    if report['protocol']!=PROTOCOL or report['release_allowed']:raise ValueError('invalid combined report')
    candidates={};chosen=None
    base=report['arms']['parser-v2']['cost_audit']['groups'].get('recovered_cost',{})
    for arm in ORDER:
        a=report['arms'][arm];c=a['cost_audit']['groups'].get('recovered_cost',{})
        shadow_path=shadow_dir/f'pool-aware-v7-reviewed-shadow-{arm}'/'production-shadow-report.json'
        shadow=read_json(shadow_path) if shadow_path.is_file() else None
        if shadow and (shadow.get('arm')!=arm or shadow.get('fit_registry_sha256')!=report['fit_registry_sha256']):
            raise ValueError('shadow belongs to a different candidate or fit registry')
        maximum=max((v.get('maximum_absolute_change',0) for v in shadow['totals_by_mode'].values()),default=0) if shadow else None
        pooled={}
        for scope in ('strict_mixed','legacy_mixed'):
            sim=report['runs'].get(scope,{}).get('simulation',{}).get('configurations',{}).get(arm+'|1',{})
            pooled[scope]=bool(sim.get('delta_ci95') and sim['delta_ci95'][0]>0)
        checks={'complete_premier':not report['missing'] and len(report['measured'])==31,
            'premier_guardrails':not a['premier_guardrail_failures'],
            'strict_pooled_positive':pooled['strict_mixed'],'legacy_pooled_positive':pooled['legacy_mixed'],
            'matched_recovered_cost_no_worse':bool(c.get('offers')) and c.get('offers')==base.get('offers') and c['sum_delta']>=base['sum_delta'],
            'validation_maximum_le_20':a['cost_audit']['maximum_absolute_change']<=20 and a['traditional_cost_audit']['maximum_absolute_change']<=20,
            'production_shadow_complete':bool(shadow and shadow['parity_complete']),
            'production_maximum_le_20':maximum is not None and maximum<=20,
            'available_traditional_guardrails':not a['traditional_guardrail_failures'],
            'new_set_all_guardrails':a['starting_configuration']['validated_leave_one_format_out']}
        passes=all(checks.values())
        # Parser v2 is the already validated last fallback, not a waiver of
        # the new stability constraint, missing evidence, or owner decisions.
        if arm=='parser-v2':
            status='validated_prior_fallback_requires_owner_review' if not passes else 'meets_reviewed_checks'
        else:status='meets_reviewed_checks' if passes else 'fails_or_incomplete'
        candidates[arm]={'checks':checks,'status':status,'production_maximum':maximum,
            'validation_maximum':a['cost_audit']['maximum_absolute_change'],
            'recovered_cost_mean':c.get('mean_delta'),
            'traditional_unavailable':a['traditional_unavailable'],
            'traditional_guardrail_failures':a['traditional_guardrail_failures'],
            'new_set_guardrail_failures':a['new_set_guardrail_failures']}
        if chosen is None and passes:chosen=arm
    recommended=chosen or 'parser-v2'
    selected=report['arms'][recommended]
    out={'protocol':PROTOCOL,'release_allowed':False,'fallback_order':list(ORDER),
        'recommended_candidate':recommended,'all_reviewed_checks_pass':chosen is not None,
        'production_deployment_authorized':False,'candidates':candidates,
        'traditional_missing_evidence':sorted(set(selected['traditional_unavailable'])|set(report['missing_traditional_archives'])),
        'new_set_starting_configuration':selected['starting_configuration'],
        'note':'No silent v6 fallback. Any failed starting-model guardrail, missing Traditional evidence or unmet stability bound is an explicit owner decision. No further parameter search.'}
    exp.write(output,out);print(json.dumps(out,indent=2),flush=True)

def restore_inputs(sid,include_traditional=False):
    exp.recover(sid)
    if include_traditional and sid in refit.TRAD:
        restore(refit.TRAD[sid]['source_archive'],exp.directory(sid))

def self_test():
    final.self_test()
    # Frozen coefficient averaging is equal weight; exclude target exactly.
    f={s:{'fit':{'elite_context':[x]*6},'previous_fit':{'elite_context':[x+10]*6}} for s,x in [('a',1),('b',3),('c',5)]}
    assert refit.mean_context(f,exclude='b')==(3.,)*6
    assert refit.mean_context(f,exclude='a',previous=True)==(14.,)*6
    b=[[c,d,p,k,60 if c=='elite' else 40,65 if c=='elite' else 35]
         for c in ('elite','control') for d in range(12) for p in range(1,9) for k in ('easy','medium','hard')]
    banks={a:b for a in ARMS};rows=list(simulation_rows('dft',list(make_bank('dft',banks))))
    sim=simulate(rows,'mixed',runs=20,draws=2,per_draw=10)
    assert sim['status']=='complete' and sim['configurations']['refit|1']['auc']==1
    assert simulate(list(simulation_rows('hbg',list(make_bank('hbg',banks)))),'mixed',runs=20,draws=2,per_draw=10,single='hbg')['status']=='complete'
    print('Reviewed final contracts passed: fixed recipe, LOO mean, matched multi-arm profiles and source bounds.')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--stage',choices=('restore','restore-all','inputs','fit','measure','aggregate','decision'))
    p.add_argument('--set',choices=sorted(EXPECTED))
    for k in ('prior','previous','work','output','fits','banks','combined','shadows'):
        p.add_argument('--'+k,type=Path)
    a=p.parse_args()
    if a.self_test:self_test();return
    if a.stage=='aggregate':aggregate(a.banks,a.fits,a.output);return
    if a.stage=='decision':decision(a.combined,a.shadows,a.output);return
    if a.stage in ('restore','restore-all'):restore_inputs(a.set,a.stage=='restore-all');return
    ctx.EXPECTED=EXPECTED
    if a.stage=='inputs':ctx.inputs(a.set,a.prior,a.work)
    elif a.stage=='fit':
        r=refit.fit(a.set,exp.directory(a.set)/'manifest.json',frozen_prior(a.prior,a.set))
        exp.write(a.output/'fit.json',r)
        print(json.dumps({'set':a.set,'fit':{k:v for k,v in r['fit'].items() if not k.endswith('card_effects')},'provenance':r['provenance']},indent=2),flush=True)
    elif a.stage=='measure':measure(a.set,a.prior,a.previous,a.fits,a.output)
    else:p.error('stage required')

if __name__=='__main__':main()
