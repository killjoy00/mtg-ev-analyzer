#!/usr/bin/env python3
"""One-shot outcome scorer for separately authorized frozen R-LCB confirmation."""
from __future__ import annotations

import argparse,csv,hashlib,json,sys
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
sys.path.insert(0,str(ROOT/"research"))
from contextual_value.schema import open_text
from contextual_value_draft_weighted_ope import evaluate_draft_weighted,paired_delta
from contextual_value_multiaction_sensitivity import paired_policy_bounds

CAPS=(10.0,20.0,50.0)
BOOT=10000
SEED=529
GAMMA=(1.0,1.1,1.22352,1.25,1.5,2.0,3.0,5.0)
EXPECTED_DRAFT={
 "FIN":"9d5b2a3e908bb8daf0ea6e951097714b651546370a5c852893dc90a1f2f6ab8b",
 "TDM":"831ba8bc4be5eabe140fac00a8e6eaded3f3f931685be8f91403ad9cfde5cbf5",
 "DFT":"7812d16e0de78ff7a69faf9981f7ff03be4dfc618a86f14369424ec2204580cd",
}

def sha256(path):
 h=hashlib.sha256()
 with path.open("rb") as f:
  for b in iter(lambda:f.read(1024*1024),b""):h.update(b)
 return h.hexdigest()

def parse_pair(raw):
 a,b=raw.split("=",1);return a,Path(b)

def load_outcomes(path,ids):
 out={}
 with open_text(path) as f:
  reader=csv.reader(f);header=tuple(next(reader));pos={n:i for i,n in enumerate(header)}
  for v in reader:
   if len(v)!=len(header):continue
   did=v[pos["draft_id"]].strip()
   if did not in ids:continue
   raw=v[pos["event_match_wins"]].strip()
   if raw=="":continue
   y=float(raw)
   if did in out and out[did]!=y:raise SystemExit(f"{did}: outcome changed across rows")
   out[did]=y
 if set(out)!=set(ids):raise SystemExit(f"outcome join incomplete missing={len(set(ids)-set(out))}")
 return out

def estimate(data,behavior,target,A,outcome):
 idx=np.arange(len(data["draft_ids"]),dtype=np.int64)
 rows={};terms={}
 for cap in CAPS:
  e,t=evaluate_draft_weighted(offsets=data["offsets"],selected_ord=data["selected_ord"],target_ord=target,outcome=outcome,behavior=behavior,q_values=data["q_values"],draft_ids=data["draft_ids"],decision_indices=idx,cap=cap)
  ae,at=evaluate_draft_weighted(offsets=data["offsets"],selected_ord=data["selected_ord"],target_ord=A,outcome=outcome,behavior=behavior,q_values=data["q_values"],draft_ids=data["draft_ids"],decision_indices=idx,cap=cap)
  d=paired_delta(t,at)
  rows[str(int(cap))]={
   "R":e.__dict__,"A":ae.__dict__,
   "minus_A":{"dr":float(e.dr-ae.dr),"direct":float(e.direct-ae.direct),"residual_correction":float((e.dr-ae.dr)-(e.direct-ae.direct)),"snips":float(e.snips-ae.snips),"ipw":float(e.ipw-ae.ipw)},
  }
  terms[str(int(cap))]=(t,at,d)
 return rows,terms

def target_calibration(data,behavior,target):
 idx=np.arange(len(data["draft_ids"]),dtype=int);offs=data["offsets"];sel=data["selected_ord"];drafts=data["draft_ids"]
 ids=drafts[idx];u,inv,c=np.unique(ids,return_inverse=True,return_counts=True);w=1/c[inv];nd=len(u)
 p=behavior[offs[idx]+target[idx]];y=(sel[idx]==target[idx]).astype(float)
 def wm(x):return float(np.sum(w*np.asarray(x,float))/nd)
 bins=[]
 for lo,hi in zip((0,.05,.1,.2,.3,.5,.7),(.05,.1,.2,.3,.5,.7,1.000001)):
  m=(p>=lo)&(p<hi)
  if np.any(m):
   ww=w[m];den=float(np.sum(ww));pred=float(np.sum(ww*p[m])/den);obs=float(np.sum(ww*y[m])/den)
   bins.append({"lo":lo,"hi":hi,"n":int(np.sum(m)),"predicted":pred,"observed":obs,"observed_minus_predicted":obs-pred})
 raw=np.where(y>0,1/np.clip(p,1e-15,None),0)
 return {"mean_predicted":wm(p),"observed_match_rate":wm(y),"observed_minus_predicted":wm(y-p),"brier":wm((y-p)**2),"cap20_weight_normalization":wm(np.minimum(20,raw)),"uncapped_weight_normalization":wm(raw),"below_0_05_fraction":wm(p<.05),"bins":bins}

def override_diag(data,behavior,R,A):
 idx=np.flatnonzero(R!=A);offs=data["offsets"];sel=data["selected_ord"]
 rp=behavior[offs[idx]+R[idx]];ap=behavior[offs[idx]+A[idx]]
 rmatch=int(np.sum(sel[idx]==R[idx]));amatch=int(np.sum(sel[idx]==A[idx]))
 return {"override_decisions":len(idx),"override_fraction":float(len(idx)/len(R)),"both_ge_0_05_fraction":float(np.mean((rp>=.05)&(ap>=.05))) if len(idx) else 1.0,"R_matched_actions":rmatch,"A_matched_actions":amatch,"R_propensity_quantiles":{str(q):float(np.quantile(rp,q)) for q in (0,.01,.05,.5,.95,.99,1)} if len(idx) else {},"A_propensity_quantiles":{str(q):float(np.quantile(ap,q)) for q in (0,.01,.05,.5,.95,.99,1)} if len(idx) else {}}

def stratified_bootstrap(delta_by_env):
 rng=np.random.default_rng(SEED);vals=np.empty(BOOT)
 envs=sorted(delta_by_env)
 for b in range(BOOT):
  means=[]
  for e in envs:
   x=np.asarray(delta_by_env[e],float);means.append(float(np.mean(x[rng.integers(0,len(x),size=len(x))])))
  vals[b]=float(np.mean(means))
 return [float(np.quantile(vals,.025)),float(np.quantile(vals,.975))]

def equal_env_point(delta_by_env):
 return float(np.mean([np.mean(np.asarray(v,float)) for v in delta_by_env.values()]))

def classify(point,ci,alt_point,alt_ci):
 lo,hi=ci; alt_success=alt_ci[0]>0; primary_success=lo>0
 evaluator_sensitive=(np.sign(point)!=np.sign(alt_point)) or (primary_success!=alt_success)
 if hi<0: core="meaningful_harm"
 elif lo>0:
  if lo>.03: core="statistically_supported_positive_and_interval_above_0.03"
  elif hi<.03: core="statistically_supported_small_positive_but_interval_excludes_0.03"
  else: core="statistically_supported_positive_practical_value_uncertain"
 elif hi<.03: core="interval_excludes_+0.03_benefit"
 elif point>0: core="small_positive_effect_practical_value_uncertain_and_not_statistically_supported"
 else: core="inconclusive"
 return {"primary_classification":core,"primary_ci_above_zero":primary_success,"practical_0_03":"supports" if lo>.03 else ("excludes" if hi<.03 else "compatible"),"evaluator_sensitive":bool(evaluator_sensitive),"alternative_ci_above_zero":bool(alt_success)}

def main():
 p=argparse.ArgumentParser()
 p.add_argument("--frozen-context",action="append",required=True)
 p.add_argument("--draft-archive",action="append",required=True)
 p.add_argument("--output",type=Path,required=True)
 args=p.parse_args()
 contexts={e:path for e,path in map(parse_pair,args.frozen_context)}
 archives={e:path for e,path in map(parse_pair,args.draft_archive)}
 if set(contexts)!=set(EXPECTED_DRAFT) or set(archives)!=set(EXPECTED_DRAFT):raise SystemExit("need exact FIN/TDM/DFT")
 per={};pdelta={};adelta={};sens={};raw_out={}
 for env in sorted(contexts):
  if sha256(archives[env])!=EXPECTED_DRAFT[env]:raise SystemExit(f"{env} archive hash mismatch")
  d=np.load(contexts[env],allow_pickle=False)
  data={k:d[k] for k in d.files}
  ids=set(map(str,data["draft_ids"]))
  if len(ids)!=15000:raise SystemExit(f"{env}: expected 15000 drafts")
  ymap=load_outcomes(archives[env],ids)
  outcome=np.asarray([ymap[str(x)] for x in data["draft_ids"]],float)
  R=np.asarray(data["r_lcb_ord"],int);A=np.asarray(data["incumbent_ord"],int)
  pb=np.asarray(data["primary_behavior"],float);ab=np.asarray(data["alternative_behavior"],float)
  primary,pt=estimate(data,pb,R,A,outcome);alternative,at=estimate(data,ab,R,A,outcome)
  pdelta[env]=pt["20"][2];adelta[env]=at["20"][2]
  # influence summary on paired per-draft cap20 primary delta
  dd=np.asarray(pt["20"][2],float);draft_order=np.asarray(pt["20"][0].draft_ids).astype(str)
  top=np.argsort(np.abs(dd))[-20:][::-1]
  influence={"quantiles":{str(q):float(np.quantile(dd,q)) for q in (0,.001,.01,.05,.5,.95,.99,.999,1)},"top_abs":[{"draft_id":str(draft_order[i]),"delta":float(dd[i])} for i in top]}
  curves=[]
  idx=np.arange(len(data["draft_ids"]),dtype=int)
  for g in GAMMA:
   b=paired_policy_bounds(offsets=data["offsets"],selected_ord=data["selected_ord"],challenger_ord=R,incumbent_ord=A,outcome=outcome,behavior=pb,q_values=data["q_values"],draft_ids=data["draft_ids"],decision_indices=idx,gamma=g,cap=20.0,estimator="dr")
   curves.append({"gamma":g,"lower":b.lower,"upper":b.upper})
  sens[env]=curves
  per[env]={
   "drafts":15000,"primary":primary,"alternative":alternative,
   "primary_calibration":{"R":target_calibration(data,pb,R),"A":target_calibration(data,pb,A),"overrides":override_diag(data,pb,R,A)},
   "alternative_calibration":{"R":target_calibration(data,ab,R),"A":target_calibration(data,ab,A),"overrides":override_diag(data,ab,R,A)},
   "primary_cap20_influence":influence,
   "sensitivity_DR_outer_bound":curves,
  }
  raw_out[env]={"draft_ids":draft_order.tolist(),"primary_cap20_delta":[float(x) for x in dd],"alternative_cap20_delta":[float(x) for x in at["20"][2]]}

 pci=stratified_bootstrap(pdelta);aci=stratified_bootstrap(adelta)
 ppoint=equal_env_point(pdelta);apoint=equal_env_point(adelta)
 aggregate_caps={}
 for cap in ("10","20","50"):
  aggregate_caps[cap]={}
  for key in ("dr","direct","residual_correction","snips","ipw"):
   aggregate_caps[cap][key]=float(np.mean([per[e]["primary"][cap]["minus_A"][key] for e in per]))
 aggregate_alt_caps={}
 for cap in ("10","20","50"):
  aggregate_alt_caps[cap]={k:float(np.mean([per[e]["alternative"][cap]["minus_A"][k] for e in per])) for k in ("dr","direct","residual_correction","snips","ipw")}
 loeo={}
 for omit in sorted(per):
  keep=[e for e in sorted(per) if e!=omit]
  loeo[omit]={"primary_cap20_dr":float(np.mean([per[e]["primary"]["20"]["minus_A"]["dr"] for e in keep])),"alternative_cap20_dr":float(np.mean([per[e]["alternative"]["20"]["minus_A"]["dr"] for e in keep]))}
 aggregate_sens=[]
 for k,g in enumerate(GAMMA):
  aggregate_sens.append({"gamma":g,"lower":float(np.mean([sens[e][k]["lower"] for e in sens])),"upper":float(np.mean([sens[e][k]["upper"] for e in sens]))})

 decision=classify(ppoint,pci,apoint,aci)
 report={
  "phase":"R_independent_confirmation_frozen_policy",
  "scope":"separately authorized offline confirmation; does not reinterpret prior non-advancement",
  "environments":["FIN","TDM","DFT"],"environment_weight":"exactly one-third each","drafts_total":45000,"drafts_per_environment":15000,
  "primary_estimand":"Average one-step recommendation effect over available P1P1-P1P8 positions within each draft, natural downstream drafting/play; equal total weight per draft and one-third per environment.",
  "primary_estimator":"paired cap20 DR with two-sided 95% stratified draft bootstrap (10,000 draws, seed 529)",
  "primary":{"cap20_dr":ppoint,"ci95":pci,"caps":aggregate_caps},
  "alternative_same_actions":{"cap20_dr":apoint,"ci95":aci,"caps":aggregate_alt_caps},
  "statistical_success_rule":"primary stratified-bootstrap 95% interval strictly above zero",
  "planning_effect_wins":.03,
  "decision":decision,
  "per_environment":per,"leave_one_environment_out":loeo,
  "hidden_confounding":{"grid":list(GAMMA),"aggregate_equal_environment_DR_outer_bounds":aggregate_sens,"note":"Sensitivity bounds are not sampling confidence intervals. Gamma=1.22352 is a recorded-skill scale reference from spent development, not a measurement of actual hidden confounding."},
  "limitations":[
   "Observational OPE depends on measured-confounding, support, Q/behavior nuisance, and variance-transfer assumptions.",
   "Target-action calibration/weight normalization warnings are reported and are not cured by larger N.",
   "No stable player identifier is available, so repeated-player dependence cannot be clustered directly.",
   "This estimates average one-step recommendation effects, not eight simultaneous interventions, whole-draft policy value, or optimality of individual close card rankings.",
  ],
  "production_change_authorized":False,
  "prior_R_development_result_changed":False,
  "raw_per_draft_terms":raw_out,
 }
 args.output.parent.mkdir(parents=True,exist_ok=True)
 args.output.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
 print(json.dumps({"primary_cap20_dr":ppoint,"primary_ci95":pci,"alternative_cap20_dr":apoint,"alternative_ci95":aci,"decision":decision,"per_environment":{e:per[e]["primary"]["20"]["minus_A"]["dr"] for e in per}},indent=2,sort_keys=True))

if __name__=="__main__":main()
