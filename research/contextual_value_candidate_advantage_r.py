#!/usr/bin/env python3
"""Frozen orthogonal candidate-advantage model R for issue #529.

Development-only. Uses retained cross-fitted Phase A2 nuisances/features.
No locked assessment or 20k confirmation outcome is loaded.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "research"))

from contextual_value.diagnostics import paired_dr_delta_ci
from contextual_value.dr import evaluate_policy
from contextual_value.propensity import support_threshold
from contextual_value_phase_a_bakeoff import _argmax_local, _policy_observations, _primary_indices

CORE = ("MSH", "SOS", "ECL", "TLA")
CAPS = (10.0, 20.0, 50.0)
GLOBAL_L2 = 100.0
SET_L2 = 1000.0
SCALE_FLOOR = 1e-8


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--train-shard", action="append", type=Path, required=True)
    p.add_argument("--train-report", action="append", type=Path, required=True)
    p.add_argument("--validation-shard", type=Path, required=True)
    p.add_argument("--validation-report", type=Path, required=True)
    p.add_argument("--feature-report", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--model-output", type=Path, required=True)
    return p.parse_args()


def _sha256(path: Path):
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def _load_train(paths, reports):
    by_fold = {}
    for p in reports:
        r = json.loads(p.read_text())
        f = int(r["fold"])
        if r.get("assessment_opened") is not False or r.get("assessment_outcomes_used") is not False:
            raise SystemExit("training report assessment boundary violation")
        by_fold[f] = r
    if set(by_fold) != {0,1,2,3,4}:
        raise SystemExit("training reports must be folds 0..4")

    loaded = []
    for p in paths:
        d = np.load(p, allow_pickle=False)
        f = int(d["fold"][0])
        if f not in by_fold:
            raise SystemExit(f"unexpected training shard fold {f}")
        needed = {"state_rich","cand_rich","candidate_names","decision_weight","outcome","behavior","q_simple","selected_ord","offsets","expansion","draft_ids"}
        if not needed.issubset(d.files):
            raise SystemExit(f"fold {f} missing fields: {sorted(needed-set(d.files))}")
        loaded.append((f,d))
    if {f for f,_ in loaded} != {0,1,2,3,4}:
        raise SystemExit("training shards must be folds 0..4")
    loaded.sort()

    counts_parts = [np.diff(d["offsets"]).astype(np.int64) for _,d in loaded]
    counts = np.concatenate(counts_parts)
    offsets = np.zeros(len(counts)+1,dtype=np.int64)
    offsets[1:] = np.cumsum(counts)

    result = {
        "state_rich": np.concatenate([d["state_rich"] for _,d in loaded], axis=0),
        "cand_rich": np.concatenate([d["cand_rich"] for _,d in loaded], axis=0).astype(np.float64),
        "candidate_names": np.concatenate([d["candidate_names"] for _,d in loaded]),
        "decision_weight": np.concatenate([d["decision_weight"] for _,d in loaded]).astype(np.float64),
        "outcome": np.concatenate([d["outcome"] for _,d in loaded]).astype(np.float64),
        "behavior": np.concatenate([d["behavior"] for _,d in loaded]).astype(np.float64),
        "q_simple": np.concatenate([d["q_simple"] for _,d in loaded]).astype(np.float64),
        "selected_ord": np.concatenate([d["selected_ord"] for _,d in loaded]).astype(np.int64),
        "expansion": np.concatenate([d["expansion"] for _,d in loaded]),
        "draft_ids": np.concatenate([d["draft_ids"] for _,d in loaded]),
        "offsets": offsets,
        "reports": by_fold,
    }
    if int(offsets[-1]) != len(result["candidate_names"]):
        raise SystemExit("training offsets/candidates mismatch")
    return result


def _orthogonal_rows(data):
    n = len(data["outcome"])
    p = data["cand_rich"].shape[1]
    z = np.empty((n,p),dtype=np.float64)
    residual = np.empty(n,dtype=np.float64)
    max_prop_sum_error = 0.0
    for i in range(n):
        start,stop = int(data["offsets"][i]),int(data["offsets"][i+1])
        probs = data["behavior"][start:stop]
        total = float(probs.sum())
        max_prop_sum_error = max(max_prop_sum_error, abs(total-1.0))
        if not math.isfinite(total) or abs(total-1.0)>1e-6:
            raise SystemExit(f"behavior probabilities do not sum to one at decision {i}: {total}")
        x = data["cand_rich"][start:stop]
        q = data["q_simple"][start:stop]
        selected = int(data["selected_ord"][i])
        if selected < 0 or selected >= stop-start:
            raise SystemExit("selected ordinal outside candidate set")
        mu = float(np.dot(probs,q))
        residual[i] = float(data["outcome"][i]) - mu
        z[i] = x[selected] - np.dot(probs,x)
    return z,residual,max_prop_sum_error


def _weighted_scale(z,w):
    total=float(w.sum())
    mean=np.sum(z*w[:,None],axis=0)/total
    centered=z-mean
    var=np.sum(centered*centered*w[:,None],axis=0)/total
    sd=np.sqrt(np.maximum(var,0.0))
    near=sd<SCALE_FLOOR
    sd[near]=1.0
    return mean,sd,near


def _fit_partial_pool(z,residual,w,expansion):
    mean,scale,near=_weighted_scale(z,w)
    zs=(z-mean)/scale
    p=zs.shape[1]
    width=1+p+len(CORE)*p
    design=np.zeros((len(zs),width),dtype=np.float64)
    design[:,0]=1.0
    design[:,1:1+p]=zs
    expansion=[str(x) for x in expansion]
    for j,env in enumerate(CORE):
        mask=np.asarray([x==env for x in expansion])
        design[mask,1+p+j*p:1+p+(j+1)*p]=zs[mask]

    xtw=design.T*w
    gram=xtw@design
    rhs=xtw@residual
    penalty=np.zeros(width,dtype=np.float64)
    penalty[1:1+p]=GLOBAL_L2
    penalty[1+p:]=SET_L2
    gram[np.diag_indices_from(gram)] += penalty
    coef=np.linalg.solve(gram,rhs)
    intercept=float(coef[0])
    beta=coef[1:1+p]
    deviations={
        env:coef[1+p+j*p:1+p+(j+1)*p].copy()
        for j,env in enumerate(CORE)
    }
    pred=design@coef
    weighted_rmse=math.sqrt(float(np.sum(w*(residual-pred)**2)/np.sum(w)))
    return {
        "intercept":intercept,
        "beta":beta,
        "deviations":deviations,
        "mean":mean,
        "scale":scale,
        "near_constant":near,
        "weighted_residual_rmse":weighted_rmse,
    }


def _estimates(candidate,incumbent):
    out={}
    for cap in CAPS:
        c=evaluate_policy(candidate,cap)
        a=evaluate_policy(incumbent,cap)
        out[str(int(cap))]={
            "candidate":asdict(c),
            "incumbent":asdict(a),
            "minus_A":{
                "dr":float(c.dr-a.dr),
                "direct":float(c.direct-a.direct),
                "snips":float(c.snips-a.snips),
                "ipw":float(c.ipw-a.ipw),
            },
        }
    out["20"]["minus_A"]["dr_ci95"]=[float(x) for x in paired_dr_delta_ci(candidate,incumbent,weight_cap=20.0)]
    return out


def main():
    args=parse_args()
    feature_report=json.loads(args.feature_report.read_text())
    feature_names=list(feature_report["candidate_feature_names"])
    if len(feature_names)!=103 or any("strong_choice_probability" in n for n in feature_names):
        raise SystemExit("unexpected candidate feature schema")

    train=_load_train(args.train_shard,args.train_report)
    if train["cand_rich"].shape[1]!=len(feature_names):
        raise SystemExit("training candidate feature width mismatch")
    z,residual,prop_err=_orthogonal_rows(train)
    fit=_fit_partial_pool(z,residual,train["decision_weight"],train["expansion"])

    vdata=np.load(args.validation_shard,allow_pickle=False)
    validation={k:vdata[k] for k in vdata.files}
    vreport=json.loads(args.validation_report.read_text())
    if int(vreport["fold"])!=-1 or vreport.get("assessment_opened") is not False or vreport.get("assessment_outcomes_used") is not False:
        raise SystemExit("validation assessment boundary violation")
    if validation["cand_rich"].shape[1]!=len(feature_names):
        raise SystemExit("validation feature width mismatch")

    primary=_primary_indices(validation)
    chosen=np.empty(len(primary),dtype=np.int16)
    unconstrained=np.empty(len(primary),dtype=np.int16)
    incumbent=np.empty(len(primary),dtype=np.int16)
    fallback=0
    intervention=0
    unconstrained_intervention=0
    primary_expansions=[]
    leader_props=[]
    for pos,index in enumerate(primary):
        start,stop=int(validation["offsets"][index]),int(validation["offsets"][index+1])
        names=validation["candidate_names"][start:stop]
        x=(validation["cand_rich"][start:stop].astype(np.float64)-fit["mean"])/fit["scale"]
        scores=x@fit["beta"]
        leader=_argmax_local(scores,names)
        a=int(validation["incumbent_ord"][index])
        unconstrained[pos]=leader
        incumbent[pos]=a
        unconstrained_intervention += int(leader!=a)
        threshold=support_threshold(stop-start)
        p=float(validation["behavior"][start+leader])
        leader_props.append(p)
        if p < threshold:
            chosen[pos]=a
            fallback+=1
        else:
            chosen[pos]=leader
        intervention += int(chosen[pos]!=a)
        primary_expansions.append(str(validation["expansion"][index]))

    r_obs=_policy_observations(validation,primary,chosen,validation["candidate_names"],validation["offsets"],q_key="q_simple")
    ru_obs=_policy_observations(validation,primary,unconstrained,validation["candidate_names"],validation["offsets"],q_key="q_simple")
    a_obs=_policy_observations(validation,primary,incumbent,validation["candidate_names"],validation["offsets"],q_key="q_simple")
    primary_est=_estimates(r_obs,a_obs)
    unconstrained_est=_estimates(ru_obs,a_obs)

    set_results={}
    for env in CORE:
        idx=[i for i,x in enumerate(primary_expansions) if x==env]
        if not idx:
            continue
        rc=[r_obs[i] for i in idx]
        aa=[a_obs[i] for i in idx]
        c=evaluate_policy(rc,20.0); a=evaluate_policy(aa,20.0)
        set_results[env]={
            "n":len(idx),
            "dr":float(c.dr-a.dr),
            "direct":float(c.direct-a.direct),
            "snips":float(c.snips-a.snips),
            "dr_ci95":[float(x) for x in paired_dr_delta_ci(rc,aa,weight_cap=20.0)],
        }

    cap20=primary_est["20"]
    checks={
        "cap20_dr_gt_0_05":float(cap20["minus_A"]["dr"])>0.05,
        "dr_positive_caps_10_20_50":all(float(primary_est[str(int(c))]["minus_A"]["dr"])>0 for c in CAPS),
        "direct_positive":float(cap20["minus_A"]["direct"])>0,
        "snips_positive":float(cap20["minus_A"]["snips"])>0,
        "ess_ratio_at_least_0_10":float(cap20["candidate"]["ess_ratio"])>=0.10,
        "ci95_lower_gt_minus_0_05":float(cap20["minus_A"]["dr_ci95"][0])>-0.05,
        "no_environment_point_below_minus_0_10":all(float(v["dr"])>=-0.10 for v in set_results.values()),
        "intervention_rate_at_least_0_05":intervention/max(1,len(primary))>=0.05,
        "assessment_boundary":True,
        "behavior_probability_invariant":prop_err<=1e-6,
    }
    advances=all(checks.values())

    order=np.argsort(-np.abs(fit["beta"]),kind="mergesort")[:20]
    top_global=[
        {"feature":feature_names[int(i)],"coefficient":float(fit["beta"][i]),"abs_coefficient":float(abs(fit["beta"][i]))}
        for i in order
    ]
    dev_norm={env:float(np.linalg.norm(v)) for env,v in fit["deviations"].items()}

    model={
        "model":"R_orthogonal_candidate_advantage",
        "global_l2":GLOBAL_L2,
        "set_deviation_l2":SET_L2,
        "feature_names":feature_names,
        "feature_mean":[float(x) for x in fit["mean"]],
        "feature_scale":[float(x) for x in fit["scale"]],
        "near_constant_features":[feature_names[i] for i,v in enumerate(fit["near_constant"]) if v],
        "intercept":fit["intercept"],
        "global_coefficients":[float(x) for x in fit["beta"]],
        "set_deviation_coefficients":{env:[float(x) for x in v] for env,v in fit["deviations"].items()},
        "policy_uses_set_deviations":False,
        "support_rule":"fallback to A if R leader propensity < max(0.01,0.10/candidate_count)",
        "feature_report_sha256":_sha256(args.feature_report),
        "assessment_opened":False,
        "assessment_outcomes_used":False,
    }
    args.model_output.parent.mkdir(parents=True,exist_ok=True)
    args.model_output.write_text(json.dumps(model,indent=2,sort_keys=True)+"\n")

    report={
        "phase":"candidate_advantage_R_development",
        "scope":"core_development_validation_only",
        "assessment_opened":False,
        "assessment_outcomes_used":False,
        "twenty_k_confirmation_used":False,
        "training":{
            "decisions":len(train["outcome"]),
            "candidate_rows":len(train["candidate_names"]),
            "drafts":len(set(str(x) for x in train["draft_ids"])),
            "behavior_probability_max_sum_error":prop_err,
            "weighted_residual_rmse":fit["weighted_residual_rmse"],
            "global_l2":GLOBAL_L2,
            "set_deviation_l2":SET_L2,
            "feature_count":len(feature_names),
            "near_constant_feature_count":int(np.sum(fit["near_constant"])),
        },
        "policy":{
            "name":"R-support",
            "primary_drafts":len(primary),
            "intervention_rate_vs_A":intervention/max(1,len(primary)),
            "unconstrained_intervention_rate_vs_A":unconstrained_intervention/max(1,len(primary)),
            "support_fallback_rate":fallback/max(1,len(primary)),
            "leader_propensity_mean":float(np.mean(leader_props)),
            "leader_propensity_p05":float(np.quantile(leader_props,.05)),
        },
        "primary_R_support_vs_A":primary_est,
        "secondary_unconstrained_R_vs_A":unconstrained_est,
        "by_environment_cap20":set_results,
        "advancement_gate":{"checks":checks,"advances":advances},
        "coefficients":{
            "global_l2_norm":float(np.linalg.norm(fit["beta"])),
            "set_deviation_l2_norm":dev_norm,
            "top_global_standardized":top_global,
        },
        "model_artifact_sha256":_sha256(args.model_output),
        "next_step":(
            "Freeze this exact R artifact/policy and run the untouched EOE/FIN/TDM/DFT fresh-assessment transfer test."
            if advances else
            "Stop candidate-advantage model R; do not create post-hoc R variants from this validation result."
        ),
    }
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print(json.dumps({
        "advances":advances,
        "cap20":primary_est["20"]["minus_A"],
        "intervention_rate":report["policy"]["intervention_rate_vs_A"],
        "fallback_rate":report["policy"]["support_fallback_rate"],
        "set_dr":{k:v["dr"] for k,v in set_results.items()},
        "top_coefficients":top_global[:8],
    },indent=2,sort_keys=True))


if __name__=="__main__":
    main()
