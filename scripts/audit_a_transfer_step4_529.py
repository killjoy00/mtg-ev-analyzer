#!/usr/bin/env python3
"""#529 A-transfer Step 4: the single authorized outcome diagnostic on spent 45k."""
from __future__ import annotations
import argparse,csv,gzip,hashlib,json,sys
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import audit_a_transfer_529 as audit

ENVS=('FIN','TDM','DFT'); CAPS=(10.,20.,50.); BOOT=10000; SEED=529
GAMMA=(1.,1.1,1.22352,1.25,1.5,2.,3.,5.)
STEP0='84d08a6364015fc7624c5ddbc49934b6918e9b8f'; STEP3_RUN=36603461542
FREEZE_RUN=36475098718; OUTCOME_RUN=36475283530
HIST_COMMIT='a7c0afd3cd5f2f872d312fe26f510894c305ef3b'
DRAFT_SHA={'FIN':'9d5b2a3e908bb8daf0ea6e951097714b651546370a5c852893dc90a1f2f6ab8b','TDM':'831ba8bc4be5eabe140fac00a8e6eaded3f3f931685be8f91403ad9cfde5cbf5','DFT':'7812d16e0de78ff7a69faf9981f7ff03be4dfc618a86f14369424ec2204580cd'}
GAME_SHA={'FIN':'f6452e622976f66dd5420c55741da5b246c7e8d25d63c080e728635e1741a6a6','TDM':'e2e679168818d67d812972343ba541d626d0f57140bc22955e09dd07bc2086e4','DFT':'734325afbe5c023245e7769fab66c88dcf241407666becb06b956d7fee13a28b'}

def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''): h.update(b)
 return h.hexdigest()
def pair(s):
 k,v=s.split('=',1); return k.upper(),Path(v)
def outcomes(path,ids):
 out={}
 with gzip.open(path,'rt',encoding='utf-8-sig',newline='') as f:
  r=csv.reader(f); head=tuple(next(r)); pos={x:i for i,x in enumerate(head)}
  for need in ('draft_id','event_match_wins'):
   if need not in pos: raise SystemExit(f'{path}: missing {need}')
  for row in r:
   if len(row)!=len(head): continue
   did=row[pos['draft_id']].strip()
   if did not in ids: continue
   raw=row[pos['event_match_wins']].strip()
   if not raw: continue
   y=float(raw)
   if did in out and out[did]!=y: raise SystemExit(f'{did}: inconsistent outcome')
   out[did]=y
 if set(out)!=ids: raise SystemExit(f'{path}: missing outcomes={len(ids-set(out))}')
 return out

def hist_modules(root):
 sys.path.insert(0,str(root/'research'))
 from contextual_value_draft_weighted_ope import evaluate_draft_weighted,paired_delta
 from contextual_value_multiaction_sensitivity import paired_policy_bounds
 return evaluate_draft_weighted,paired_delta,paired_policy_bounds

def deployed_ord(env,draft,game,z):
 sid=env.lower(); skills,_,header=audit.scan_skills(draft)
 training,cutoff,experienced=audit.select_strong_drafts(skills,100,.15,5000); training=set(training)
 eval_ids=set(map(str,z['draft_ids'])); wanted=training|eval_ids
 examples=audit.load_examples(draft,wanted,header,training); lookup=audit.example_lookup(examples)
 pairs=[(d,e) for d in training for e in examples.get(d,())]
 folds=audit.build_fold_training(pairs,training,5); fits=audit.build_colour_tables_by_fold(game,pairs,folds,sid)
 models={f.fold:audit.OutOfFoldModel(f.counts,audit.CountStore.empty(),fits[f.fold]) for f in folds}
 offs=np.asarray(z['offsets'],np.int64); names=np.asarray(z['candidate_names']); dids=np.asarray(z['draft_ids']).astype(str)
 packs=np.asarray(z['pack_number'],np.int64); picks=np.asarray(z['pick_number'],np.int64); selected=np.asarray(z['selected_ord'],np.int64)
 out=np.empty(len(dids),np.int16); digest=hashlib.sha256()
 for i,did in enumerate(dids):
  key=(did,int(packs[i])+1,int(picks[i])+1); ex=lookup.get(key)
  if ex is None: raise SystemExit(f'{env}: missing {key}')
  lo,hi=int(offs[i]),int(offs[i+1]); local=[str(x) for x in names[lo:hi]]
  if set(local)!=set(ex.candidates): raise SystemExit(f'{env}: candidates differ {key}')
  if not 0<=int(selected[i])<len(local) or local[int(selected[i])]!=ex.historical_pick: raise SystemExit(f'{env}: selected differs {key}')
  p=audit.probs(models[audit.stable_fold(did,5)],ex); top=audit.ranking(p)[0]; out[i]=local.index(top)
  digest.update(f'{did}\0{packs[i]}\0{picks[i]}\0{top}\n'.encode())
 return out,{'training_drafts':len(training),'experienced_drafts':int(experienced),'win_rate_cutoff':float(cutoff),'decisions':len(out),'action_digest_sha256':digest.hexdigest()}

def estimate(data,behavior,left,right,y,eval_dw,paired_delta):
 idx=np.arange(len(data['draft_ids']),dtype=np.int64); rows={}; terms={}
 for cap in CAPS:
  le,lt=eval_dw(offsets=data['offsets'],selected_ord=data['selected_ord'],target_ord=left,outcome=y,behavior=behavior,q_values=data['q_values'],draft_ids=data['draft_ids'],decision_indices=idx,cap=cap)
  re,rt=eval_dw(offsets=data['offsets'],selected_ord=data['selected_ord'],target_ord=right,outcome=y,behavior=behavior,q_values=data['q_values'],draft_ids=data['draft_ids'],decision_indices=idx,cap=cap)
  d=paired_delta(lt,rt)
  rows[str(int(cap))]={'left':le.__dict__,'right':re.__dict__,'minus_right':{'dr':float(le.dr-re.dr),'direct':float(le.direct-re.direct),'residual_correction':float((le.dr-re.dr)-(le.direct-re.direct)),'snips':float(le.snips-re.snips),'ipw':float(le.ipw-re.ipw)}}
  terms[str(int(cap))]=(lt,rt,d)
 return rows,terms

def support(data,b,left,right):
 idx=np.flatnonzero(left!=right); off=data['offsets']; sel=data['selected_ord']
 lp=b[off[idx]+left[idx]]; rp=b[off[idx]+right[idx]]
 q=lambda a:{str(x):float(np.quantile(a,x)) for x in (0,.01,.05,.5,.95,.99,1)} if len(a) else {}
 return {'different_actions':int(len(idx)),'different_fraction':float(len(idx)/len(left)),'both_ge_0_05_fraction':float(np.mean((lp>=.05)&(rp>=.05))) if len(idx) else 1.,'left_matched':int(np.sum(sel[idx]==left[idx])),'right_matched':int(np.sum(sel[idx]==right[idx])),'left_propensity_quantiles':q(lp),'right_propensity_quantiles':q(rp)}

def bootstrap_many(series):
 # Same seed and b->environment->draft random stream as frozen historical bootstrap.
 names=list(series); envs=sorted(ENVS); n=15000
 stacks={e:np.stack([np.asarray(series[name][e],float) for name in names]) for e in envs}
 vals=np.empty((len(names),BOOT)); rng=np.random.default_rng(SEED); chunk=20
 for start in range(0,BOOT,chunk):
  take=min(chunk,BOOT-start); inds=rng.integers(0,n,size=(take,len(envs),n)); means=np.zeros((len(names),take))
  for j,e in enumerate(envs): means+=np.mean(stacks[e][:,inds[:,j,:]],axis=2)
  vals[:,start:start+take]=means/len(envs)
 return {name:[float(np.quantile(vals[i],.025)),float(np.quantile(vals[i],.975))] for i,name in enumerate(names)}
def point(by_env): return float(np.mean([np.mean(np.asarray(v,float)) for v in by_env.values()]))
def classify(p,ci,ap,aci):
 lo,hi=ci; primary=lo>0; alt=aci[0]>0; sensitive=(np.sign(p)!=np.sign(ap)) or (primary!=alt)
 if hi<0: core='meaningful_harm'
 elif lo>0: core='statistically_supported_positive_and_interval_above_0.03' if lo>.03 else ('statistically_supported_small_positive_but_interval_excludes_0.03' if hi<.03 else 'statistically_supported_positive_practical_value_uncertain')
 elif hi<.03: core='interval_excludes_+0.03_benefit'
 elif p>0: core='small_positive_effect_practical_value_uncertain_and_not_statistically_supported'
 else: core='inconclusive'
 return {'primary_classification':core,'primary_ci_above_zero':bool(primary),'practical_0_03':'supports' if lo>.03 else ('excludes' if hi<.03 else 'compatible'),'evaluator_sensitive':bool(sensitive),'alternative_ci_above_zero':bool(alt)}

def main():
 p=argparse.ArgumentParser(); p.add_argument('--historical-root',type=Path,required=True); p.add_argument('--step3-report',type=Path,required=True); p.add_argument('--historical-r-report',type=Path,required=True); p.add_argument('--draft',action='append',required=True); p.add_argument('--game',action='append',required=True); p.add_argument('--freeze',action='append',required=True); p.add_argument('--out',type=Path,required=True); a=p.parse_args()
 drafts=dict(map(pair,a.draft)); games=dict(map(pair,a.game)); freezes=dict(map(pair,a.freeze))
 if set(drafts)!=set(ENVS) or set(games)!=set(ENVS) or set(freezes)!=set(ENVS): raise SystemExit('need exact FIN/TDM/DFT inputs')
 step3=json.loads(a.step3_report.read_text()); hist=json.loads(a.historical_r_report.read_text())
 if step3.get('decision_rule_commit')!=STEP0 or not step3.get('reproduction_all_sets') or not step3.get('research_frozen_action_identity_all_sets') or not step3.get('step4_required') or step3.get('verdict')!='does not transfer': raise SystemExit('Step 4 not authorized by completed Step 3')
 eval_dw,paired_delta,bounds=hist_modules(a.historical_root)
 per={}; primary={k:{} for k in ('deployed_minus_research','r_minus_deployed','r_minus_research')}; alt={k:{} for k in primary}; sens={k:{} for k in ('deployed_minus_research','r_minus_deployed')}
 for env in ENVS:
  if sha(drafts[env])!=DRAFT_SHA[env] or sha(games[env])!=GAME_SHA[env]: raise SystemExit(f'{env}: archive hash mismatch')
  z0=np.load(freezes[env],allow_pickle=False); data={k:z0[k] for k in z0.files}; ids=set(map(str,data['draft_ids']))
  if len(ids)!=15000: raise SystemExit(f'{env}: expected 15000 drafts')
  dep,meta=deployed_ord(env,drafts[env],games[env],data); research=np.asarray(data['incumbent_ord'],np.int64); r=np.asarray(data['r_lcb_ord'],np.int64)
  ymap=outcomes(drafts[env],ids); y=np.asarray([ymap[str(x)] for x in data['draft_ids']],float)
  pb=np.asarray(data['primary_behavior'],float); ab=np.asarray(data['alternative_behavior'],float)
  pairs={'deployed_minus_research':(dep,research),'r_minus_deployed':(r,dep),'r_minus_research':(r,research)}; er={'drafts':15000,'decisions':len(dep),'deployed_reconstruction':meta,'action_agreement':{'deployed_vs_research':float(np.mean(dep==research)),'r_vs_deployed':float(np.mean(r==dep)),'r_vs_research':float(np.mean(r==research))}}
  for name,(left,right) in pairs.items():
   prow,pt=estimate(data,pb,left,right,y,eval_dw,paired_delta); arow,at=estimate(data,ab,left,right,y,eval_dw,paired_delta)
   er[name]={'primary':prow,'alternative':arow,'primary_support':support(data,pb,left,right),'alternative_support':support(data,ab,left,right)}
   primary[name][env]=pt['20'][2]; alt[name][env]=at['20'][2]
   if name in sens:
    idx=np.arange(len(data['draft_ids']),dtype=np.int64); curve=[]
    for g in GAMMA:
     b=bounds(offsets=data['offsets'],selected_ord=data['selected_ord'],challenger_ord=left,incumbent_ord=right,outcome=y,behavior=pb,q_values=data['q_values'],draft_ids=data['draft_ids'],decision_indices=idx,gamma=g,cap=20.,estimator='dr'); curve.append({'gamma':g,'lower':b.lower,'upper':b.upper})
    sens[name][env]=curve; er[name]['sensitivity_DR_outer_bound']=curve
  lhs=er['r_minus_research']['primary']['20']['minus_right']['dr']; rhs=er['r_minus_deployed']['primary']['20']['minus_right']['dr']+er['deployed_minus_research']['primary']['20']['minus_right']['dr']
  if abs(lhs-rhs)>1e-12: raise SystemExit(f'{env}: DR additivity failed')
  per[env]=er
 series={}
 for name in primary:
  series[name+':primary']=primary[name]; series[name+':alternative']=alt[name]
 ci=bootstrap_many(series); aggregate={}
 for name in primary:
  pp,ap=point(primary[name]),point(alt[name]); pci,aci=ci[name+':primary'],ci[name+':alternative']
  caps={str(int(c)):{k:float(np.mean([per[e][name]['primary'][str(int(c))]['minus_right'][k] for e in ENVS])) for k in ('dr','direct','residual_correction','snips','ipw')} for c in CAPS}
  acaps={str(int(c)):{k:float(np.mean([per[e][name]['alternative'][str(int(c))]['minus_right'][k] for e in ENVS])) for k in ('dr','direct','residual_correction','snips','ipw')} for c in CAPS}
  aggregate[name]={'primary':{'cap20_dr':pp,'ci95':pci,'caps':caps},'alternative_same_actions':{'cap20_dr':ap,'ci95':aci,'caps':acaps},'decision':classify(pp,pci,ap,aci),'per_environment_cap20_dr':{e:per[e][name]['primary']['20']['minus_right']['dr'] for e in ENVS},'leave_one_environment_out':{omit:float(np.mean([per[e][name]['primary']['20']['minus_right']['dr'] for e in ENVS if e!=omit])) for omit in ENVS}}
  if name in sens: aggregate[name]['hidden_confounding']={'grid':list(GAMMA),'aggregate_equal_environment_DR_outer_bounds':[{'gamma':g,'lower':float(np.mean([sens[name][e][i]['lower'] for e in ENVS])),'upper':float(np.mean([sens[name][e][i]['upper'] for e in ENVS]))} for i,g in enumerate(GAMMA)]}
 # Reproduce the already-published historical R-research-A result exactly before interpreting new contrasts.
 ref=aggregate['r_minus_research']; checks={'primary_cap20_dr':abs(ref['primary']['cap20_dr']-float(hist['primary']['cap20_dr'])),'primary_ci_lo':abs(ref['primary']['ci95'][0]-float(hist['primary']['ci95'][0])),'primary_ci_hi':abs(ref['primary']['ci95'][1]-float(hist['primary']['ci95'][1])),'alternative_cap20_dr':abs(ref['alternative_same_actions']['cap20_dr']-float(hist['alternative_same_actions']['cap20_dr']))}; exact=all(x<=1e-12 for x in checks.values())
 if not exact: raise SystemExit(f'historical estimator reproduction failed: {checks}')
 old=hist['decision']; new=aggregate['r_minus_deployed']['decision']; changed=any((old.get('primary_classification')!=new.get('primary_classification'),bool(old.get('primary_ci_above_zero'))!=bool(new.get('primary_ci_above_zero')),old.get('practical_0_03')!=new.get('practical_0_03')))
 report={'schema':1,'phase':'issue_529_A_transfer_step4_single_followup','decision_rule_commit':STEP0,'step3_run':STEP3_RUN,'freeze_run':FREEZE_RUN,'historical_outcome_run':OUTCOME_RUN,'historical_research_commit':HIST_COMMIT,'step4_execution_count_for_this_audit':1,'authorized_because_step3_verdict':step3['verdict'],'outcome_fields_accessed':['event_match_wins'],'scope':'spent 45k FIN/TDM/DFT; 15k drafts each; all available P1P1-P1P8; equal draft and environment weight','primary_estimator':'paired draft-weighted cap20 DR; 10,000-draw environment-stratified paired draft bootstrap, seed 529','sensitivity_grid':list(GAMMA),'historical_r_minus_research_reproduction':{'pass':exact,'absolute_differences':checks},'per_environment':per,'aggregate':aggregate,'step4_flag':{'research_value_verdict':old,'deployed_comparator_value_verdict':new,'value_verdict_changed':bool(changed),'recommendation_identity_verdict':'does not transfer'},'production_change_authorized':False}
 a.out.mkdir(parents=True,exist_ok=True); (a.out/'report.json').write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
 da=aggregate['deployed_minus_research']; rd=aggregate['r_minus_deployed']; ra=aggregate['r_minus_research']; lines=['# Issue #529 — A-transfer Step 4 diagnostic','',f'- Step-3 recommendation identity: **does not transfer**',f'- Historical R−research-A reproduction: **PASS**',f'- Spent cohort: 45,000 drafts (15k each FIN/TDM/DFT), all available P1P1–P1P8',f'- Estimator: paired draft-weighted cap-20 DR; 10,000-draw stratified draft bootstrap; seed {SEED}','','## Primary results','','| Contrast | DR wins | 95% CI | Classification |','| --- | ---: | --- | --- |',f"| Deployed A − research A | {da['primary']['cap20_dr']:+.6f} | [{da['primary']['ci95'][0]:+.6f}, {da['primary']['ci95'][1]:+.6f}] | {da['decision']['primary_classification']} |",f"| R-LCB − deployed A | {rd['primary']['cap20_dr']:+.6f} | [{rd['primary']['ci95'][0]:+.6f}, {rd['primary']['ci95'][1]:+.6f}] | {rd['decision']['primary_classification']} |",f"| R-LCB − research A (historical reproduction) | {ra['primary']['cap20_dr']:+.6f} | [{ra['primary']['ci95'][0]:+.6f}, {ra['primary']['ci95'][1]:+.6f}] | {ra['decision']['primary_classification']} |",'',f"- Step-4 value verdict changed under literal deployed comparator: **{'YES' if changed else 'NO'}**",'- Recommendation-identity verdict remains **does not transfer** because the frozen >=95% agreement gate failed in Step 3.','- Diagnostic only; no production change is authorized.']
 (a.out/'report.md').write_text('\n'.join(lines)+'\n'); print(json.dumps({'deployed_minus_research':da['primary'],'r_minus_deployed':rd['primary'],'historical_reproduction':exact,'value_verdict_changed':changed},indent=2))
if __name__=='__main__': main()
