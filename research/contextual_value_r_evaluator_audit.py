#!/usr/bin/env python3
"""Outcome-free spent-development behavior-evaluator credibility audit for frozen R-LCB."""
from __future__ import annotations

import argparse, json, math
from pathlib import Path
import numpy as np

CAP=20.0
SUPPORT=0.05

def parse_args():
    p=argparse.ArgumentParser()
    p.add_argument("--validation-shard",type=Path,required=True)
    p.add_argument("--policy-bundle",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    return p.parse_args()

def analysis_weights(drafts,idx):
    ids=np.asarray([str(drafts[int(i)]) for i in idx])
    unique,inv,count=np.unique(ids,return_inverse=True,return_counts=True)
    return unique,inv,1.0/count[inv].astype(float)

def quantiles(x):
    x=np.asarray(x,float)
    return {str(q):float(np.quantile(x,q)) for q in (0,.01,.05,.1,.25,.5,.75,.9,.95,.99,1)}

def target_metrics(e,target,sel,offsets,idx,drafts):
    _,inv,w=analysis_weights(drafts,idx)
    nd=int(np.max(inv)+1)
    g=offsets[idx]+target[idx]
    p=np.asarray(e[g],float)
    y=(sel[idx]==target[idx]).astype(float)
    def wm(x): return float(np.sum(w*np.asarray(x,float))/nd)
    raw=np.where(y>0,1.0/np.clip(p,1e-15,None),0.0)
    capped=np.minimum(CAP,raw)
    per=np.zeros(nd); np.add.at(per,inv,w*capped)
    per_unc=np.zeros(nd); np.add.at(per_unc,inv,w*raw)
    bins=[]
    edges=(0,.05,.1,.2,.3,.5,.7,1.0000001)
    for lo,hi in zip(edges[:-1],edges[1:]):
        m=(p>=lo)&(p<hi)
        if not np.any(m): continue
        ww=w[m]; den=float(np.sum(ww))
        pred=float(np.sum(ww*p[m])/den); obs=float(np.sum(ww*y[m])/den)
        bins.append({"lo":lo,"hi":hi,"decision_n":int(np.sum(m)),"predicted":pred,"observed":obs,"observed_minus_predicted":obs-pred})
    return {
        "drafts":nd,"decisions":len(idx),
        "weighted_mean_predicted":wm(p),
        "weighted_observed_match_rate":wm(y),
        "calibration_diff_obs_minus_pred":wm(y-p),
        "weighted_brier":wm((y-p)**2),
        "weighted_logloss":wm(-(y*np.log(np.clip(p,1e-15,1))+(1-y)*np.log(np.clip(1-p,1e-15,1)))),
        "cap20_weight_normalization_mean":float(np.mean(per)),
        "uncapped_weight_normalization_mean":float(np.mean(per_unc)),
        "propensity_quantiles":quantiles(p),
        "below_0_05_fraction":wm(p<SUPPORT),
        "below_0_10_fraction":wm(p<.10),
        "calibration_bins":bins,
    }

def override_metrics(e,R,A,offsets,idx):
    m=R[idx]!=A[idx]; io=idx[m]
    pr=np.asarray(e[offsets[io]+R[io]],float); pa=np.asarray(e[offsets[io]+A[io]],float)
    return {
        "decisions":int(len(io)),"fraction":float(np.mean(m)),
        "R_propensity_quantiles":quantiles(pr),
        "A_propensity_quantiles":quantiles(pa),
        "R_ge_0_05_fraction":float(np.mean(pr>=SUPPORT)),
        "A_ge_0_05_fraction":float(np.mean(pa>=SUPPORT)),
        "both_ge_0_05_fraction":float(np.mean((pr>=SUPPORT)&(pa>=SUPPORT))),
    }

def main():
    a=parse_args()
    v=np.load(a.validation_shard,allow_pickle=False)
    b=np.load(a.policy_bundle,allow_pickle=False)
    offsets=np.asarray(v["offsets"],int); sel=np.asarray(v["selected_ord"],int)
    A=np.asarray(v["incumbent_ord"],int); R=np.asarray(b["r_lcb_ord"],int)
    idx=np.asarray(b["eligible_indices"],int); drafts=np.asarray(v["draft_ids"]).astype(str)
    behaviors={
      "primary_strong_offset":np.asarray(v["behavior"],float),
      "rich_correction":np.asarray(b["alternative_behavior"],float),
      "skill_aware":np.asarray(b["skill_aware_behavior"],float),
    }
    result={}
    for name,e in behaviors.items():
        sums=np.add.reduceat(e,offsets[:-1])
        norm=float(np.max(np.abs(sums-1.0)))
        if norm>1e-9: raise SystemExit(f"{name} normalization error {norm}")
        result[name]={
            "max_action_probability_sum_error":norm,
            "R":target_metrics(e,R,sel,offsets,idx,drafts),
            "A":target_metrics(e,A,sel,offsets,idx,drafts),
            "overrides":override_metrics(e,R,A,offsets,idx),
        }

    rich=result["rich_correction"]; skill=result["skill_aware"]
    # Predeclared outcome-free evaluator rule: an alternative must retain
    # >=95% both-action support on the exact frozen R overrides. Among eligible
    # candidates choose the one minimizing the worse cap20 target-normalization
    # deviation from 1; NLL/Brier are reported but do not override support.
    candidates={}
    for name in ("rich_correction","skill_aware"):
        row=result[name]
        support=float(row["overrides"]["both_ge_0_05_fraction"])
        norm=max(abs(float(row["R"]["cap20_weight_normalization_mean"])-1.0),abs(float(row["A"]["cap20_weight_normalization_mean"])-1.0))
        candidates[name]={"support_pass":support>=.95,"both_action_support":support,"max_weight_norm_abs_deviation":norm}
    eligible=[(d["max_weight_norm_abs_deviation"],name) for name,d in candidates.items() if d["support_pass"]]
    if not eligible: raise SystemExit("no alternative evaluator clears frozen support credibility floor")
    chosen=min(eligible)[1]
    if chosen!="skill_aware":
        raise SystemExit(f"unexpected alternative selection {chosen}; inspect before confirmation")

    report={
      "phase":"candidate_advantage_R_evaluator_credibility_spent_development",
      "new_confirmation_outcomes_opened":False,
      "validation_population":"already-spent core R development validation only",
      "frozen_actions":True,
      "primary_evaluator":"primary_strong_offset",
      "alternative_evaluator":chosen,
      "alternative_transfer_definition":"skill x rich-candidate conditional-logit correction over primary strong-offset behavior; L2=1000; fit from each environment's previously authorized prior training IDs only; R/A actions and primary support gate remain unchanged.",
      "selection_rule":{"both_action_override_support_floor":.95,"secondary_criterion":"minimize max(|cap20 target-weight normalization - 1|) across frozen R and A","outcomes_used_for_selection":False},
      "candidate_summary":candidates,
      "evaluators":result,
      "interpretation":"Target-action calibration warnings remain: primary/skill-aware weight normalization is materially above 1. The rich correction improves selected-action prediction metrics but creates much weaker local support and worse target-weight normalization, so it is not used for transfer OPE. This audit does not establish causal identification.",
    }
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print(json.dumps({
      "primary_R_weight_norm":result["primary_strong_offset"]["R"]["cap20_weight_normalization_mean"],
      "primary_A_weight_norm":result["primary_strong_offset"]["A"]["cap20_weight_normalization_mean"],
      "rich_both_support":result["rich_correction"]["overrides"]["both_ge_0_05_fraction"],
      "rich_R_weight_norm":result["rich_correction"]["R"]["cap20_weight_normalization_mean"],
      "skill_both_support":result["skill_aware"]["overrides"]["both_ge_0_05_fraction"],
      "skill_R_weight_norm":result["skill_aware"]["R"]["cap20_weight_normalization_mean"],
      "alternative_evaluator":chosen,
    },indent=2,sort_keys=True))

if __name__=="__main__": main()
