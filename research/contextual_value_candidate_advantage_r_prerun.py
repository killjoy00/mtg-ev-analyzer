#!/usr/bin/env python3
"""Validation-outcome-free pre-run freeze for amended R-prime / R-LCB."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from pathlib import Path

import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
sys.path.insert(0,str(ROOT/"research"))

from contextual_value_draft_weighted_ope import eligible_p1p1_p1p8
from contextual_value_candidate_advantage_r_common import (
    CORE, GLOBAL_L2, SET_L2, NULL_DRAWS, NULL_SEED,
    align_nuisance, build_control_schema, calibrate_lcb_c, choose_r_lcb,
    compute_residual, compute_z, feature_cleanup, fit_r_prime,
    legacy_r_support_actions, load_fold, noise_legacy_support_rate,
    read_nuisance, weighted_mean_scale,
    fit_skill_interaction_behavior, predict_skill_interaction_behavior,
)
from contextual_value_multiaction_sensitivity import skill_odds_shift_summary
from contextual_value_behavior_rich_correction import (
    _combine as behavior_combine,
    _fit_correction as fit_behavior_correction,
    _predict_correction as predict_behavior_correction,
    _choice_metrics as behavior_choice_metrics,
)


def parse_args():
    p=argparse.ArgumentParser()
    p.add_argument("--train-shard",action="append",type=Path,required=True)
    p.add_argument("--train-report",action="append",type=Path,required=True)
    p.add_argument("--train-nuisance",action="append",type=Path,required=True)
    p.add_argument("--validation-shard",type=Path,required=True)
    p.add_argument("--validation-report",type=Path,required=True)
    p.add_argument("--validation-nuisance",type=Path,required=True)
    p.add_argument("--feature-report",type=Path,required=True)
    p.add_argument("--rich-behavior-report",type=Path,required=True)
    p.add_argument("--out-dir",type=Path,required=True)
    return p.parse_args()


def fold_from_path(path:Path)->int:
    m=re.search(r"fold-(-?\d+)",path.name)
    if not m: raise SystemExit(f"cannot infer fold from {path}")
    return int(m.group(1))


def map_by_fold(paths):
    out={}
    for p in paths:
        f=fold_from_path(p)
        if f in out: raise SystemExit(f"duplicate fold {f}: {p}")
        out[f]=p
    return out


def sha256(path:Path)->str:
    h=hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda:fh.read(1024*1024),b""): h.update(block)
    return h.hexdigest()


def identity_sha(data)->str:
    h=hashlib.sha256()
    for key in ("decision_ids","draft_ids","candidate_names"):
        arr=np.asarray(data[key]).astype(str)
        for x in arr:
            h.update(x.encode()); h.update(b"\0")
    for key in ("offsets","pack_number","pick_number","incumbent_ord","selected_ord"):
        h.update(np.asarray(data[key]).tobytes())
    return h.hexdigest()


def concat_decision_data(parts):
    keys=("state_rich","decision_weight","expansion","pack_number","pick_number",
          "skill_rate","user_games_lower_bound","draft_ids")
    return {key:np.concatenate([p[key] for p in parts],axis=0) for key in keys}


def subset_decision_data(data,mask):
    mask=np.asarray(mask,dtype=bool)
    return {key:np.asarray(value)[mask] for key,value in data.items()}


def skill_group(x):
    if x<.50:return "<0.50"
    if x<.55:return "0.50-0.55"
    if x<.60:return "0.55-0.60"
    return ">=0.60"


def experience_group(x):
    if x<100:return "<100"
    if x<500:return "100-499"
    return ">=500"


def weighted_group_balance(zstd,data,axis):
    if axis=="skill":
        groups=np.asarray([skill_group(float(x)) for x in data["skill_rate"]])
    elif axis=="experience":
        groups=np.asarray([experience_group(int(x)) for x in data["user_games_lower_bound"]])
    elif axis=="pick":
        groups=np.asarray([f"P{int(p)+1}P{int(k)+1}" for p,k in zip(data["pack_number"],data["pick_number"])])
    else:
        raise ValueError(axis)
    w=np.asarray(data["decision_weight"],float)
    out={}
    for g in sorted(set(groups)):
        m=groups==g
        mean=np.sum(zstd[m]*w[m,None],axis=0)/np.sum(w[m])
        out[g]={
            "decisions":int(np.sum(m)),
            "weight":float(np.sum(w[m])),
            "mean_z_l2":float(np.linalg.norm(mean)),
            "mean_z_max_abs":float(np.max(np.abs(mean))),
        }
    return out


def draft_level_r2(zstd,data,state_names,response_name,*,permutations=200,seed=529):
    names=list(state_names)
    idx=names.index(response_name)
    state=np.asarray(data["state_rich"],float)
    draft=np.asarray(data["draft_ids"]).astype(str)
    expansion=np.asarray(data["expansion"]).astype(str)
    w=np.asarray(data["decision_weight"],float)
    unique,inverse=np.unique(draft,return_inverse=True)
    x=np.zeros((len(unique),zstd.shape[1]),float)
    ws=np.zeros(len(unique),float)
    ysum=np.zeros(len(unique),float)
    set_label=np.empty(len(unique),dtype=object)
    for i in range(len(draft)):
        g=inverse[i]
        x[g]+=w[i]*zstd[i]
        ws[g]+=w[i]
        ysum[g]+=w[i]*state[i,idx]
        set_label[g]=expansion[i]
    x=x/ws[:,None]; y=ysum/ws
    # within-set residualization of both predictors and response.
    xc=x.copy(); yc=y.copy()
    for env in sorted(set(set_label)):
        m=set_label==env
        xc[m]-=np.mean(xc[m],axis=0)
        yc[m]-=np.mean(yc[m])
    def r2(yv):
        coef=np.linalg.lstsq(xc,yv,rcond=None)[0]
        pred=xc@coef
        denom=float(np.sum(np.square(yv)))
        return float(1.0-np.sum(np.square(yv-pred))/denom) if denom>0 else 0.0
    observed=r2(yc)
    rng=np.random.default_rng(seed)
    null=[]
    env_indices={env:np.flatnonzero(set_label==env) for env in sorted(set(set_label))}
    for _ in range(permutations):
        yp=yc.copy()
        for ids in env_indices.values():
            yp[ids]=yp[rng.permutation(ids)]
        null.append(r2(yp))
    return {
        "drafts":len(unique),
        "observed_r2":observed,
        "permutations":permutations,
        "seed":seed,
        "null_mean":float(np.mean(null)),
        "null_max":float(np.max(null)),
        "null_p95":float(np.quantile(null,.95)),
    }


def actions_unconstrained(data,fit,decision_indices):
    offsets=np.asarray(data["offsets"],dtype=np.int64)
    cand=np.asarray(data["cand_rich"],float)
    names=data["candidate_names"].astype(str)
    chosen=np.asarray(data["incumbent_ord"],dtype=np.int64).copy()
    for raw_i in np.asarray(decision_indices,dtype=np.int64):
        i=int(raw_i); s,t=int(offsets[i]),int(offsets[i+1])
        score=(cand[s:t,fit.keep_indices]/fit.z_scale)@fit.global_beta
        chosen[i]=min(range(t-s),key=lambda j:(-float(score[j]),str(names[s+j])))
    return chosen


def main():
    args=parse_args()
    args.out_dir.mkdir(parents=True,exist_ok=True)
    shard=map_by_fold(args.train_shard)
    report=map_by_fold(args.train_report)
    nuisance=map_by_fold(args.train_nuisance)
    if set(shard)!=set(range(5)) or set(report)!=set(range(5)) or set(nuisance)!=set(range(5)):
        raise SystemExit("training inputs must be exactly folds 0..4")

    feature_report=json.loads(args.feature_report.read_text())
    feature_names=list(feature_report["candidate_feature_names"])
    state_names=list(feature_report["state_feature_names"])
    if len(feature_names)!=103:
        raise SystemExit("unexpected candidate feature count")

    fold_payloads=[]; zparts=[]; rparts=[]; join_stats={}
    for fold in range(5):
        d=load_fold(shard[fold],report[fold],include_outcome=True)
        rows=read_nuisance(nuisance[fold],fold)
        behavior,q,stats=align_nuisance(d,rows,verify_phi=True)
        d["behavior_joined"]=behavior; d["q_joined"]=q
        zparts.append(compute_z(d,behavior))
        rparts.append(compute_residual(d,behavior,q))
        fold_payloads.append(d)
        join_stats[str(fold)]=stats

    train=concat_decision_data(fold_payloads)
    ztrain=np.concatenate(zparts,axis=0)
    residual=np.concatenate(rparts)
    if len(ztrain)!=len(residual):
        raise SystemExit("training residual/z mismatch")

    # Validation is deliberately loaded without its outcome array.
    val=load_fold(args.validation_shard,args.validation_report,include_outcome=False)
    if "outcome" in val:
        raise SystemExit("validation outcome unexpectedly loaded during pre-run")
    vrows=read_nuisance(args.validation_nuisance,-1)
    vbehavior,vq,vstats=align_nuisance(val,vrows,verify_phi=False)
    zval=compute_z(val,vbehavior)

    keep,kept_names,cleanup=feature_cleanup(feature_names,ztrain,zval)
    control_schema=build_control_schema(train,state_names)
    fit=fit_r_prime(
        z=ztrain,residual=residual,weight=train["decision_weight"],data=train,
        feature_names=feature_names,keep_indices=keep,control_schema=control_schema,
    )

    early_mask=(np.asarray(train["pack_number"],int)==0)&(np.asarray(train["pick_number"],int)>=0)&(np.asarray(train["pick_number"],int)<8)
    early=subset_decision_data(train,early_mask)
    early_control=build_control_schema(early,state_names)
    early_fit=fit_r_prime(
        z=ztrain[early_mask],residual=residual[early_mask],
        weight=np.asarray(train["decision_weight"])[early_mask],data=early,
        feature_names=feature_names,keep_indices=keep,control_schema=early_control,
    )

    eligible=eligible_p1p1_p1p8(val["pack_number"],val["pick_number"])
    c,cdiag=calibrate_lcb_c(data=val,fit=fit,decision_indices=eligible,behavior=vbehavior)
    lcb_actions,lcbdiag=choose_r_lcb(data=val,fit=fit,decision_indices=eligible,behavior=vbehavior,c=c)
    early_actions,early_lcbdiag=choose_r_lcb(data=val,fit=early_fit,decision_indices=eligible,behavior=vbehavior,c=c)
    legacy_actions=legacy_r_support_actions(
        data=val,beta=fit.global_beta,keep_indices=fit.keep_indices,scale=fit.z_scale,
        decision_indices=eligible,behavior=vbehavior,
    )
    unconstrained_actions=actions_unconstrained(val,fit,eligible)
    legacy_noise=noise_legacy_support_rate(
        data=val,fit=fit,decision_indices=eligible,behavior=vbehavior,
        draws=NULL_DRAWS,seed=NULL_SEED,
    )

    # Outcome-free z-balance diagnostics.
    full_mean,full_scale,_=weighted_mean_scale(ztrain,np.asarray(train["decision_weight"],float))
    zstd=(ztrain[:,keep]-fit.z_mean)/fit.z_scale
    balance={
        "skill_groups":weighted_group_balance(zstd,train,"skill"),
        "experience_groups":weighted_group_balance(zstd,train,"experience"),
        "pick_stage":weighted_group_balance(zstd[early_mask],subset_decision_data(train,early_mask),"pick"),
        "draft_level_skill_r2":draft_level_r2(zstd,train,state_names,"base:user_game_win_rate"),
        "draft_level_experience_r2":draft_level_r2(zstd,train,state_names,"base:log1p_user_games"),
    }
    gih_idx=feature_names.index("base:gih_wr")
    gih_std=float(full_scale[gih_idx])
    skill=np.asarray(train["skill_rate"],float)
    early_gih=ztrain[early_mask,gih_idx]/gih_std
    early_skill=skill[early_mask]
    early_w=np.asarray(train["decision_weight"],float)[early_mask]
    gih_by_skill={}
    for g in ("<0.50","0.50-0.55","0.55-0.60",">=0.60"):
        labels=np.asarray([skill_group(float(x)) for x in early_skill])
        m=labels==g
        gih_by_skill[g]={
            "decisions":int(np.sum(m)),
            "mean_gih_z_sd":float(np.sum(early_w[m]*early_gih[m])/np.sum(early_w[m])) if np.any(m) else None,
        }
    balance["early_gih_residual_by_skill"]=gih_by_skill

    # Reconstruct the already-developed training-only rich behavior correction.
    behavior_rows=[]
    for d in fold_payloads:
        behavior_rows.append({
            "fold":int(d["fold"]),
            "data":{
                "cand_rich":d["cand_rich"],
                "candidate_names":d["candidate_names"],
                "decision_weight":d["decision_weight"],
                "selected_ord":d["selected_ord"],
                "offsets":d["offsets"],
            },
            "baseline_behavior":d["behavior_joined"],
        })
    combined=behavior_combine(behavior_rows)
    alt_model=fit_behavior_correction(combined)
    prior_behavior=json.loads(args.rich_behavior_report.read_text())
    expected=prior_behavior["final_correction_fit"]
    objective_error=abs(float(alt_model["objective"])-float(expected["objective"]))
    if objective_error>1e-5:
        raise SystemExit(f"rich behavior final-fit objective parity error {objective_error}")
    lambdas=prior_behavior["pick_shrinkage_training_only"]["by_pick"]
    if any(abs(float(row["lambda"])-1.0)>1e-12 for row in lambdas.values()):
        raise SystemExit("prior pick-shrinkage lambdas are not all 1")
    vdata_for_behavior={
        "cand_rich":val["cand_rich"],
        "candidate_names":val["candidate_names"],
        "decision_weight":val["decision_weight"],
        "selected_ord":val["selected_ord"],
        "offsets":val["offsets"],
    }
    alt_behavior=predict_behavior_correction(alt_model,vdata_for_behavior,vbehavior)
    # Outcome-free recorded-skill confounding benchmark.
    skill_train=behavior_combine(behavior_rows)
    skill_train["skill_rate"]=np.concatenate([np.asarray(d["skill_rate"],dtype=np.float64) for d in fold_payloads])
    skill_model=fit_skill_interaction_behavior(
        data=skill_train,
        baseline_behavior=np.asarray(skill_train["behavior"],dtype=np.float64),
        l2=1000.0,
    )
    skill_val_data={
        "cand_rich":val["cand_rich"],
        "candidate_names":val["candidate_names"],
        "decision_weight":val["decision_weight"],
        "selected_ord":val["selected_ord"],
        "offsets":val["offsets"],
        "skill_rate":val["skill_rate"],
    }
    skill_behavior=predict_skill_interaction_behavior(
        skill_model,data=skill_val_data,baseline_behavior=vbehavior,
    )
    skill_benchmark={
        "A":skill_odds_shift_summary(
            reference_behavior=vbehavior,skill_behavior=skill_behavior,
            offsets=val["offsets"],target_ord=val["incumbent_ord"],decision_indices=eligible,
        ),
        "R_LCB":skill_odds_shift_summary(
            reference_behavior=vbehavior,skill_behavior=skill_behavior,
            offsets=val["offsets"],target_ord=lcb_actions,decision_indices=eligible,
        ),
    }
    gamma_reference=max(
        float(skill_benchmark["A"]["gamma_reference_p95"]),
        float(skill_benchmark["R_LCB"]["gamma_reference_p95"]),
    )
    fixed_gamma_grid=sorted(set([1.0,1.10,1.25,1.50,2.0,3.0,5.0,round(gamma_reference,6)]))

    metrics=behavior_choice_metrics(vdata_for_behavior,alt_behavior)
    expected_nll=float(prior_behavior["validation_behavior_prediction"]["pick_shrunk"]["selected_action_nll"])
    nll_error=abs(float(metrics["selected_action_nll"])-expected_nll)
    if nll_error>1e-5:
        raise SystemExit(f"rich behavior validation NLL parity error {nll_error}")

    # Freeze every policy action before validation outcomes are available.
    policy_path=args.out_dir/"r-policy-bundle.npz"
    np.savez_compressed(
        policy_path,
        validation_identity=np.asarray([identity_sha(val)]),
        c=np.asarray([c],dtype=np.float64),
        eligible_indices=np.asarray(eligible,dtype=np.int64),
        r_lcb_ord=np.asarray(lcb_actions,dtype=np.int16),
        r_lcb_early_fit_ord=np.asarray(early_actions,dtype=np.int16),
        r_support_ord=np.asarray(legacy_actions,dtype=np.int16),
        r_unconstrained_ord=np.asarray(unconstrained_actions,dtype=np.int16),
        alternative_behavior=np.asarray(alt_behavior,dtype=np.float64),
        skill_aware_behavior=np.asarray(skill_behavior,dtype=np.float64),
        gamma_reference_p95=np.asarray([gamma_reference],dtype=np.float64),
        sensitivity_gamma_grid=np.asarray(fixed_gamma_grid,dtype=np.float64),
        global_beta=np.asarray(fit.global_beta,dtype=np.float64),
        global_covariance=np.asarray(fit.global_covariance,dtype=np.float64),
        z_scale=np.asarray(fit.z_scale,dtype=np.float64),
        keep_indices=np.asarray(fit.keep_indices,dtype=np.int64),
        early_global_beta=np.asarray(early_fit.global_beta,dtype=np.float64),
        early_global_covariance=np.asarray(early_fit.global_covariance,dtype=np.float64),
        early_z_scale=np.asarray(early_fit.z_scale,dtype=np.float64),
    )

    training_weight=float(np.sum(train["decision_weight"]))
    early_weight=float(np.sum(np.asarray(train["decision_weight"])[early_mask]))
    report_out={
        "phase":"candidate_advantage_R_prerun_outcome_free",
        "validation_outcomes_loaded":False,
        "assessment_outcomes_loaded":False,
        "twenty_k_outcomes_loaded":False,
        "feature_report_sha256":sha256(args.feature_report),
        "validation_identity_sha256":identity_sha(val),
        "nuisance_join":{"training":join_stats,"validation":vstats},
        "training":{
            "drafts":len(set(np.asarray(train["draft_ids"]).astype(str))),
            "decisions":len(ztrain),
            "total_decision_weight":training_weight,
            "early_p1p1_p1p8_decisions":int(np.sum(early_mask)),
            "early_p1p1_p1p8_weight":early_weight,
            "early_weight_fraction":early_weight/training_weight,
        },
        "validation":{
            "drafts":len(set(np.asarray(val["draft_ids"]).astype(str))),
            "decisions":len(val["decision_ids"]),
            "eligible_p1p1_p1p8_decisions":len(eligible),
        },
        "feature_cleanup":cleanup,
        "fit":fit.diagnostics,
        "early_fit":early_fit.diagnostics,
        "z_balance":balance,
        "r_lcb":{
            "c":c,
            "null_calibration":cdiag,
            "policy":lcbdiag,
            "early_fit_policy":early_lcbdiag,
        },
        "legacy_r_support_noise":legacy_noise,
        "hidden_confounding_benchmark":{
            "model":"skill x rich-candidate conditional-logit correction over frozen strong-offset behavior",
            "l2":1000.0,
            "training_objective":float(skill_model["objective"]),
            "iterations":int(skill_model["iterations"]),
            "gradient_max_abs":float(skill_model["gradient_max_abs"]),
            "target_action_odds_shift":skill_benchmark,
            "gamma_reference_p95":gamma_reference,
            "fixed_gamma_grid":fixed_gamma_grid,
            "note":"Outcome-free scale benchmark only; it does not identify unmeasured confounding strength.",
        },
        "behavior_sensitivity_freeze":{
            "prior_run":36323128790,
            "all_training_pick_lambdas_are_one":True,
            "final_fit_objective":float(alt_model["objective"]),
            "prior_final_fit_objective":float(expected["objective"]),
            "objective_parity_error":objective_error,
            "validation_selected_action_nll":float(metrics["selected_action_nll"]),
            "prior_validation_pick_shrunk_nll":expected_nll,
            "nll_parity_error":nll_error,
            "note":"Validation selected actions are used only for parity diagnostics; no validation outcome is loaded. Frozen R-LCB actions use strong-offset behavior only and are not recomputed under this alternative evaluator.",
        },
        "policy_bundle":{
            "path":policy_path.name,
            "sha256":None,
        },
    }
    report_out["policy_bundle"]["sha256"]=sha256(policy_path)
    out=args.out_dir/"core-prerun-report.json"
    out.write_text(json.dumps(report_out,indent=2,sort_keys=True)+"\n")
    print(json.dumps({
        "validation_outcomes_loaded":False,
        "training":report_out["training"],
        "feature_cleanup":{"kept":cleanup["kept_count"],"dropped":cleanup["dropped_count"]},
        "skill_r2":balance["draft_level_skill_r2"],
        "experience_r2":balance["draft_level_experience_r2"],
        "gih_by_skill":gih_by_skill,
        "c":c,
        "null_rate":cdiag["chosen_null_deviation_rate"],
        "r_lcb_policy":lcbdiag,
        "legacy_noise":legacy_noise,
        "bundle_sha256":report_out["policy_bundle"]["sha256"],
    },indent=2,sort_keys=True))


if __name__=="__main__":
    main()
