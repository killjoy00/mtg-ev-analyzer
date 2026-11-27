#!/usr/bin/env python3
"""One fixed no-refit validation of the replacement mana parser #1863."""
import argparse
from collections import defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path

import pool_aware_skill_context_validation as ctx
import pool_aware_skill_expansion as exp
import pool_aware_skill_recovery as rec
import pool_aware_skill_contrast as skill
import pool_aware_statistical_validation as stat
import pool_aware_skill_parser_correction as corrected
import pool_aware_mana_parser_v2 as parser
from pool_aware_archive import read_json,sha256
from pool_aware_refit import weights
from pool_aware_diagnostics import grade

SOURCE=Path(__file__).resolve()
EXPECTED=set(exp.SETS)
# Reuse the tested comparison engine, with an explicit new pair of arm names.
ctx.EXPECTED=EXPECTED
ctx.FULL='revised-unfixed'
ctx.ARM='revised-parser-v2'
ctx.FULL_KEY=ctx.FULL+'|1'
ctx.ARM_KEY=ctx.ARM+'|1'
ctx.MODELS=['v6',ctx.FULL,ctx.ARM]

def digest_bank(sid,bank):
    return hashlib.sha256(gzip.compress(json.dumps({'set':sid,'rows':bank},separators=(',',':')).encode(),mtime=0)).hexdigest()

def prior_revised(folder,sid,prior_path):
    pilot=sid in rec.ABLATION
    r=read_json(folder/('ablation.json' if pilot else 'report.json'))
    if r['set']!=sid or r['release_allowed']:
        raise ValueError('prior revised report identity mismatch')
    if pilot:
        if r['protocol']!='skill-contrast-component-ablation-v1' or r['original_report_sha256']!=sha256(prior_path):
            raise ValueError('prior pilot identity mismatch')
        return r['arms']['card-plus-elite-context']['prediction'],r['simulation']['configurations']['card-plus-elite-context|1']['auc']
    if r['protocol']!='skill-contrast-elite-context-validation-v1' or r['prior_report_sha256']!=sha256(prior_path) or r['audit_code_sha256']!=sha256(Path(ctx.__file__)):
        raise ValueError('prior revised validation identity mismatch')
    return r['cohorts']['elite']['prediction'],r['simulation']['configurations']['card-plus-elite-context|1']['auc']

def unreadable_audit(old,new,metadata):
    groups=defaultdict(lambda:[0,0,0,0,0,0,0,0,0])
    examples={}; review_examples={}
    rules=parser.index(metadata)
    review_names={'Eldrazi Ravager','Dig Through Time','Concealing Curtains','Junkblade Bruiser'}
    for (a,p,k),(b,_,_) in zip(old,new):
        x=grade(weights(a,skill.ZERO)); y=grade(weights(a,skill.APPLY)); z=grade(weights(b,skill.APPLY))
        for i,name in enumerate(a.candidates):
            if i==a.chosen:
                continue
            profile=rules.get(name)
            label=('recovered_cost' if profile.previous_status=='unreadable' and profile.status=='readable' else
                   'still_unreadable' if profile.status=='unreadable' else profile.status)
            c=groups[label]
            c[0]+=1;c[1]+=y[i]-x[i];c[2]+=z[i]-x[i];c[3]+=z[i]-y[i]
            c[4]+=x[i]>=90 and y[i]<75;c[5]+=x[i]>=90 and z[i]<75
            c[6]+=x[i]-y[i]>=20;c[7]+=x[i]-z[i]>=20;c[8]+=abs(z[i]-y[i])
            if (label in ('recovered_cost','still_unreadable') and y[i]!=z[i]) or name in review_names:
                ex={'card':name,'pick':k,'prior_pool':sorted(p),'pack':sorted(a.candidates),
                    'v6':x[i],'unfixed':y[i],'parser':z[i],'change':z[i]-y[i]}
                ex['previous_cost_status']=profile.previous_status;ex['parsed_costs']=list(profile.costs);ex['parser_status']=profile.status
                if name in review_names:
                    prior=review_examples.get(name)
                    if prior is None or (x[i]-y[i],z[i]-y[i])>(prior['v6']-prior['unfixed'],prior['change']):
                        review_examples[name]=ex
                key=(name,z[i]>y[i]); prev=examples.get(key)
                if prev is None or abs(ex['change'])>abs(prev['change']):
                    examples[key]=ex
    return {'groups':{k:{'offers':v[0],'unfixed_sum_delta':v[1],'parser_sum_delta':v[2],
        'parser_vs_unfixed_sum':v[3],'unfixed_close_drops':v[4],'parser_close_drops':v[5],
        'unfixed_decreased_20_plus':v[6],'parser_decreased_20_plus':v[7],'absolute_change_sum':v[8]}
        for k,v in groups.items()},
        'examples':sorted(examples.values(),key=lambda e:(-abs(e['change']),e['card']))[:30],
        'review_examples':review_examples,
        'metadata_counts':dict(__import__('collections').Counter((c.previous_status+'->'+c.status) for c in rules.cards.values()))}

def measure(sid,folder,previous,output):
    prior=ctx.load_frozen(folder,sid); p=prior['provenance']
    prev_pred,prev_auc=prior_revised(previous,sid,folder/'result/report.json')
    prepare=rec.prepare_recovered if sid in rec.RECOVER else exp.prepare_fit
    full_e,full_o,fit,metadata,draft_path,prov=prepare(sid,exp.directory(sid)/'manifest.json',prior)
    if prov['sources']!=p['sources'] or prov['windows']!=p['windows'] or prov.get('recovery')!=p.get('recovery'):
        raise ValueError('source/window/recovery parity failure')
    outcomes=stat.selected_outcomes(draft_path,{r.source for r,_,_ in full_e+full_o})
    _,bank=stat.summarize(sid,skill.APPLY,full_e,full_o,outcomes,candidate_name=skill.NAME)
    if digest_bank(sid,bank)!=prior['bank_sha256']:
        raise ValueError('original full bank digest mismatch')
    del bank
    context,cards=corrected.parameters(fit)
    old_e=skill.predict_pairs(full_e,context,cards);old_o=skill.predict_pairs(full_o,context,cards)
    del full_e,full_o
    old_c,old_bank=stat.summarize(sid,skill.APPLY,old_e,old_o,outcomes,candidate_name=skill.NAME)
    for model in ('v6',skill.NAME):
        for k in ('decisions','top1','raw_log_loss','display_log_loss','display_brier'):
            if not math.isclose(old_c['elite']['prediction'][model][k],prev_pred[model][k],rel_tol=1e-9,abs_tol=1e-10):
                raise ValueError('unfixed revised prediction parity failure')
    new_e=corrected.predict_pairs(old_e,metadata,context,cards);new_o=corrected.predict_pairs(old_o,metadata,context,cards)
    cohorts,bank=stat.summarize(sid,skill.APPLY,new_e,new_o,outcomes,candidate_name=skill.NAME)
    paired=list(ctx.combined_bank(sid,old_bank,bank))
    del bank,old_bank
    audit=unreadable_audit(old_e,new_e,metadata)
    before=exp.card_audit(old_e,metadata);after=exp.card_audit(new_e,metadata)
    groups=ctx.context_comparison(before['groups'],after['groups'])
    old_actual=exp.outcome_study(sid,old_e+old_o,outcomes)
    new_actual=exp.outcome_study(sid,new_e+new_o,outcomes)
    guards=ctx.point_guardrails(cohorts,new_e)
    del old_e,old_o,new_e,new_o,outcomes,before
    try:
        comparison=ctx.outcome_comparison([(old_actual,new_actual)])
    except ValueError as exc:
        comparison={'status':'unavailable','reason':str(exc)}
    output.mkdir(parents=True,exist_ok=True)
    bf=output/'paired-bank.json.gz'
    bf.write_bytes(gzip.compress(json.dumps({'set':sid,'rows':paired},separators=(',',':')).encode(),mtime=0))
    sim=ctx.paired_simulation(list(ctx.simulation_rows(sid,paired)),'powered-cube' if sid=='powered-cube' else 'mixed',single=sid)
    if sim['status']=='complete' and not math.isclose(sim['configurations'][ctx.FULL_KEY]['auc'],prev_auc,rel_tol=1e-12,abs_tol=1e-12):
        raise ValueError('unfixed revised AUC parity failure')
    report={'protocol':corrected.PROTOCOL,'set':sid,'release_allowed':False,'status':'measured',
        'evidence_class':p.get('recovery',{}).get('chronology',{}).get('classification','strict_game_time'),
        'prior_report_sha256':sha256(folder/'result/report.json'),'prior_bank_sha256':prior['bank_sha256'],
        'correction_code_sha256':sha256(Path(corrected.__file__)),'parser_code_sha256':sha256(Path(parser.__file__)),'audit_code_sha256':sha256(SOURCE),
        'paired_bank_sha256':sha256(bf),'simulation':sim,'guardrails':guards,'cohorts':cohorts,
        'unfixed_prediction':old_c['elite']['prediction'],'context_comparison':groups,'cost_audit':audit,
        'card_audit':after,'outcomes':comparison,'outcome_pair':[old_actual,new_actual]}
    exp.write(output/'report.json',report)
    print(json.dumps({'set':sid,'simulation':sim,'guardrails':guards,'cost_audit':audit['groups'],'review_examples':audit['review_examples'],'metadata_counts':audit['metadata_counts'],
        'context_comparison':groups,'outcomes':comparison},indent=2),flush=True)

def aggregate(folder,output):
    reports={};paths={}
    for path in sorted(folder.glob('pool-aware-parser-transfer-*/report.json')):
        r=read_json(path);s=r['set']
        if (s not in EXPECTED or s in reports or r['protocol']!=corrected.PROTOCOL or r['release_allowed']
            or r['correction_code_sha256']!=sha256(Path(corrected.__file__)) or r['parser_code_sha256']!=sha256(Path(parser.__file__)) or r['audit_code_sha256']!=sha256(SOURCE)):
            raise ValueError('report identity mismatch')
        b=path.parent/'paired-bank.json.gz'
        if sha256(b)!=r['paired_bank_sha256']:
            raise ValueError('bank digest mismatch')
        reports[s]=r;paths[s]=b
    if not reports:
        raise ValueError('no measured sets')
    strict={s for s,r in reports.items() if r['evidence_class']=='strict_game_time'}
    legacy=set(reports)-strict; reg=set(exp.SETS)-exp.SELECTABLE-{'powered-cube'}
    result={'protocol':corrected.PROTOCOL,'release_allowed':False,'measured':sorted(reports),
        'missing':sorted(EXPECTED-set(reports)),'strict':sorted(strict),'legacy':sorted(legacy),
        'runs':{},'outcomes':{},'cost_audit':{},'sets':{}}
    scopes={'strict_mixed':strict&reg,'legacy_mixed':legacy&reg,'powered-cube':set(reports)&{'powered-cube'}}
    scopes.update({'standalone:'+s:{s} for s in sorted(exp.SELECTABLE&set(reports))})
    for k,ids in scopes.items():
        if not ids:continue
        ids=sorted(ids)
        if k.startswith('standalone:'):
            sim=reports[ids[0]]['simulation']
        else:
            rows=[]
            for s in ids:
                d=read_json(paths[s])
                if d['set']!=s:raise ValueError('bank set mismatch')
                rows.extend(ctx.simulation_rows(s,d['rows']))
            sim=ctx.paired_simulation(rows,'powered-cube' if k=='powered-cube' else 'mixed',runs=10000,per_draw=2000)
            del rows
        result['runs'][k]={'sets':ids,'simulation':sim,'groups':ctx.pool_groups([reports[s] for s in ids]),
            'guardrails_safe':all(all(reports[s]['guardrails'][x] for x in ('severe_tail_safe','raw_log_loss_safe','top1_safe')) for s in ids)}
        pairs=[reports[s]['outcome_pair'] for s in ids if reports[s]['outcomes']['status']=='complete']
        result['outcomes'][k]=ctx.outcome_comparison(pairs)
    counts=defaultdict(lambda:defaultdict(int))
    for s,r in reports.items():
        for k,v in r['cost_audit']['groups'].items():
            for key,n in v.items():counts[k][key]+=n
        result['sets'][s]={'simulation':r['simulation'],'guardrails':r['guardrails'],'cost_audit':r['cost_audit'],
            'context_comparison':r['context_comparison'],'outcomes':r['outcomes']}
    result['cost_audit']={k:dict(v,unfixed_mean_delta=v['unfixed_sum_delta']/v['offers'],
        parser_mean_delta=v['parser_sum_delta']/v['offers'],parser_vs_unfixed_mean=v['parser_vs_unfixed_sum']/v['offers']) for k,v in counts.items()}
    exp.write(output,result)
    print(json.dumps({'measured':result['measured'],'missing':result['missing'],'runs':result['runs'],
        'cost_audit':result['cost_audit'],'outcomes':result['outcomes'],
        'sets':{s:{'simulation':r['simulation'],'guardrails':r['guardrails']} for s,r in result['sets'].items()}},indent=2),flush=True)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--stage',choices=('restore','inputs','measure','aggregate'))
    p.add_argument('--set',choices=sorted(EXPECTED))
    p.add_argument('--prior',type=Path);p.add_argument('--previous',type=Path)
    p.add_argument('--work',type=Path);p.add_argument('--output',type=Path);p.add_argument('--banks',type=Path)
    a=p.parse_args()
    if a.self_test:
        corrected.self_test();ctx.self_test();return
    if a.stage=='aggregate':aggregate(a.banks,a.output);return
    if a.stage=='restore':exp.recover(a.set)
    elif a.stage=='inputs':ctx.inputs(a.set,a.prior,a.work)
    elif a.stage=='measure':measure(a.set,a.prior,a.previous,a.output)
    else:p.error('stage required')

if __name__=='__main__':main()
