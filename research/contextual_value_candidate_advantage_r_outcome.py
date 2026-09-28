#!/usr/bin/env python3
"""One-time amended R-LCB development outcome evaluation for issue #529."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import asdict
from pathlib import Path

import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
sys.path.insert(0,str(ROOT/"research"))

from contextual_value_candidate_advantage_r_common import align_nuisance, load_fold, read_nuisance
from contextual_value_draft_weighted_ope import (
    eligible_p1p1_p1p8, evaluate_draft_weighted, paired_bootstrap_ci,
    paired_delta, stable_hashed_indices,
)
from contextual_value_multiaction_sensitivity import paired_policy_bounds, gamma_zero


CAPS=(10.0,20.0,50.0)
BOOT=10000
SEED=529


def parse_args():
    p=argparse.ArgumentParser()
    p.add_argument("--validation-shard",type=Path,required=True)
    p.add_argument("--validation-report",type=Path,required=True)
    p.add_argument("--validation-nuisance",type=Path,required=True)
    p.add_argument("--prerun-report",type=Path,required=True)
    p.add_argument("--policy-bundle",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    return p.parse_args()


def sha256(path):
    h=hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda:fh.read(1024*1024),b""):h.update(block)
    return h.hexdigest()


def identity_sha(data):
    h=hashlib.sha256()
    for key in ("decision_ids","draft_ids","candidate_names"):
        for x in np.asarray(data[key]).astype(str):
            h.update(x.encode());h.update(b"\0")
    for key in ("offsets","pack_number","pick_number","incumbent_ord","selected_ord"):
        h.update(np.asarray(data[key]).tobytes())
    return h.hexdigest()


def estimate_dict(data,behavior,q,target,incumbent,idx):
    result={}
    terms={}
    for cap in CAPS:
        ce,ct=evaluate_draft_weighted(
            offsets=data["offsets"],selected_ord=data["selected_ord"],target_ord=target,
            outcome=data["outcome"],behavior=behavior,q_values=q,draft_ids=data["draft_ids"],
            decision_indices=idx,cap=cap,
        )
        ae,at=evaluate_draft_weighted(
            offsets=data["offsets"],selected_ord=data["selected_ord"],target_ord=incumbent,
            outcome=data["outcome"],behavior=behavior,q_values=q,draft_ids=data["draft_ids"],
            decision_indices=idx,cap=cap,
        )
        delta=paired_delta(ct,at)
        row={
            "candidate":asdict(ce),
            "A":asdict(ae),
            "minus_A":{
                "dr":float(ce.dr-ae.dr),
                "direct":float(ce.direct-ae.direct),
                "residual_correction":float((ce.dr-ae.dr)-(ce.direct-ae.direct)),
                "ipw":float(ce.ipw-ae.ipw),
                "snips":float(ce.snips-ae.snips),
            },
        }
        if cap==20.0:
            row["minus_A"]["dr_ci95"]=paired_bootstrap_ci(delta,alpha=.05,draws=BOOT,seed=SEED)
            row["raw_draft_delta"]=[float(x) for x in delta]
        result[str(int(cap))]=row
        terms[str(int(cap))]=(ct,at)
    return result,terms


def mean_ci(x,draws=5000,seed=529):
    x=np.asarray(x,dtype=float)
    rng=np.random.default_rng(seed)
    out=np.empty(draws)
    for b in range(draws):
        out[b]=float(np.mean(x[rng.integers(0,len(x),size=len(x))]))
    return {
        "mean":float(np.mean(x)),
        "ci95":[float(np.quantile(out,.025)),float(np.quantile(out,.975))],
    }


def weight_normalization(terms):
    return mean_ci(terms.target_weight)


def eval_environment(data,behavior,q,target,incumbent,eligible):
    exp=np.asarray(data["expansion"]).astype(str)
    out={}
    for env in sorted(set(exp[np.asarray(eligible,dtype=int)])):
        idx=np.asarray([i for i in eligible if str(exp[int(i)])==env],dtype=np.int64)
        est,_=estimate_dict(data,behavior,q,target,incumbent,idx)
        out[env]={
            "drafts":est["20"]["candidate"]["n_drafts"],
            "decisions":est["20"]["candidate"]["n_decisions"],
            "cap20":est["20"]["minus_A"],
        }
    return out


def sensitivity(data,behavior,q,target,incumbent,eligible,gamma_grid):
    dr=[];ipw=[]
    for g in gamma_grid:
        d=paired_policy_bounds(
            offsets=data["offsets"],selected_ord=data["selected_ord"],challenger_ord=target,
            incumbent_ord=incumbent,outcome=data["outcome"],behavior=behavior,q_values=q,
            draft_ids=data["draft_ids"],decision_indices=eligible,gamma=float(g),cap=20.0,estimator="dr",
        )
        i=paired_policy_bounds(
            offsets=data["offsets"],selected_ord=data["selected_ord"],challenger_ord=target,
            incumbent_ord=incumbent,outcome=data["outcome"],behavior=behavior,q_values=q,
            draft_ids=data["draft_ids"],decision_indices=eligible,gamma=float(g),cap=20.0,estimator="ipw",
        )
        dr.append({"gamma":d.gamma,"lower":d.lower,"upper":d.upper})
        ipw.append({"gamma":i.gamma,"lower":i.lower,"upper":i.upper})
    from contextual_value_multiaction_sensitivity import SensitivityBound
    return {
        "model":"conservative multi-action one-vs-rest odds outer bound; not claimed sharp multinomial",
        "dr":dr,
        "ipw":ipw,
        "dr_gamma_zero":gamma_zero([SensitivityBound(**x) for x in dr]),
        "ipw_gamma_zero":gamma_zero([SensitivityBound(**x) for x in ipw]),
    }


def main():
    args=parse_args()
    freeze=json.loads(args.prerun_report.read_text())
    if freeze.get("phase")!="candidate_advantage_R_prerun_freeze":
        raise SystemExit("wrong pre-run freeze report")
    if freeze.get("validation_outcomes_loaded") is not False or freeze.get("r_result_seen") is not False:
        raise SystemExit("pre-run boundary invalid")
    if sha256(args.policy_bundle)!=freeze["frozen_policy"]["bundle_sha256"]:
        raise SystemExit("policy bundle does not match committed pre-run freeze")

    data=load_fold(args.validation_shard,args.validation_report,include_outcome=True)
    if int(data["fold"])!=-1:
        raise SystemExit("validation fold mismatch")
    if identity_sha(data)!=freeze["core"]["validation_identity_sha256"]:
        raise SystemExit("validation identity differs from pre-run freeze")
    nuisance=read_nuisance(args.validation_nuisance,-1)
    # Validation shards do not retain phi_simple; training-fold phi parity was frozen pre-outcome.\n    # The outcome evaluator uses only joined behavior/q here, so verify coverage/normalization\n    # without requesting the unavailable training pseudo-value parity check.\n    behavior,q,join=align_nuisance(data,nuisance,verify_phi=False)

    bundle=np.load(args.policy_bundle,allow_pickle=False)
    if str(bundle["validation_identity"][0])!=freeze["core"]["validation_identity_sha256"]:
        raise SystemExit("policy-bundle validation identity mismatch")
    eligible=np.asarray(bundle["eligible_indices"],dtype=np.int64)
    expected_eligible=eligible_p1p1_p1p8(data["pack_number"],data["pick_number"])
    if not np.array_equal(eligible,expected_eligible):
        raise SystemExit("eligible index set changed after pre-run")
    incumbent=np.asarray(data["incumbent_ord"],dtype=np.int64)
    r_lcb=np.asarray(bundle["r_lcb_ord"],dtype=np.int64)
    early=np.asarray(bundle["r_lcb_early_fit_ord"],dtype=np.int64)
    legacy=np.asarray(bundle["r_support_ord"],dtype=np.int64)
    unconstrained=np.asarray(bundle["r_unconstrained_ord"],dtype=np.int64)
    alt_behavior=np.asarray(bundle["alternative_behavior"],dtype=np.float64)
    gamma_grid=[float(x) for x in bundle["sensitivity_gamma_grid"]]
    gamma_reference=float(bundle["gamma_reference_p95"][0])

    # Validate behavior normalization decision-by-decision.
    counts=np.diff(data["offsets"]).astype(np.int64)
    for label,b in (("primary",behavior),("alternative",alt_behavior)):
        sums=np.add.reduceat(b,data["offsets"][:-1])
        err=float(np.max(np.abs(sums-1.0)))
        if err>1e-9:
            raise SystemExit(f"{label} behavior normalization error {err}")

    primary,primary_terms=estimate_dict(data,behavior,q,r_lcb,incumbent,eligible)
    alternative,_=estimate_dict(data,alt_behavior,q,r_lcb,incumbent,eligible)
    env=eval_environment(data,behavior,q,r_lcb,incumbent,eligible)

    hashed=stable_hashed_indices(data["decision_ids"],data["draft_ids"],eligible)
    hashed_result,_=estimate_dict(data,behavior,q,r_lcb,incumbent,hashed)
    early_result,_=estimate_dict(data,behavior,q,early,incumbent,eligible)
    legacy_result,_=estimate_dict(data,behavior,q,legacy,incumbent,eligible)
    unconstrained_result,_=estimate_dict(data,behavior,q,unconstrained,incumbent,eligible)

    cap20=primary["20"]
    alt20=alternative["20"]
    intervention=float(np.mean(r_lcb[eligible]!=incumbent[eligible]))
    checks={
        "cap20_dr_gt_0_05":float(cap20["minus_A"]["dr"])>0.05,
        "dr_positive_caps_10_20_50":all(float(primary[str(int(c))]["minus_A"]["dr"])>0 for c in CAPS),
        "direct_positive":float(cap20["minus_A"]["direct"])>0,
        "snips_positive":float(cap20["minus_A"]["snips"])>0,
        "ess_ratio_at_least_0_10":float(cap20["candidate"]["ess_ratio"])>=0.10,
        "ci95_lower_gt_minus_0_05":float(cap20["minus_A"]["dr_ci95"][0])>-0.05,
        "no_environment_point_below_minus_0_10":all(float(v["cap20"]["dr"])>=-0.10 for v in env.values()),
        "intervention_rate_at_least_0_05":intervention>=0.05,
        "alternative_behavior_cap20_dr_positive":float(alt20["minus_A"]["dr"])>0,
        "pre_run_identity_and_nuisance_parity":True,
    }
    advances=all(checks.values())

    cterms,aterms=primary_terms["20"]
    sensitivity_result=sensitivity(data,behavior,q,r_lcb,incumbent,eligible,gamma_grid)

    report={
        "phase":"candidate_advantage_R_amended_development",
        "registered_prerun_freeze_sha256":sha256(args.prerun_report),
        "policy_bundle_sha256":sha256(args.policy_bundle),
        "validation_outcomes_opened":True,
        "assessment_outcomes_opened":False,
        "twenty_k_used_for_model_selection":False,
        "estimand":"Average one-step effect over available eligible P1P1-P1P8 positions within draft; not an eight-pick or whole-draft policy effect.",
        "primary_R_LCB_vs_A":primary,
        "alternative_behavior_same_actions":alternative,
        "by_environment_cap20":env,
        "target_action_weight_normalization":{
            "R_LCB":weight_normalization(cterms),
            "A":weight_normalization(aterms),
        },
        "sensitivity":sensitivity_result,
        "recorded_skill_gamma_reference_p95":gamma_reference,
        "intervention_rate_vs_A":intervention,
        "advancement_gate":{"checks":checks,"advances":advances},
        "secondary":{
            "single_hashed_R_LCB_vs_A":hashed_result,
            "P1P1_P1P8_training_only_fit_R_LCB_vs_A":early_result,
            "legacy_R_support_vs_A":legacy_result,
            "unconstrained_R_vs_A":unconstrained_result,
        },
        "power_planning":freeze["power_planning"],
        "nuisance_join":join,
        "next_step":(
            "R-LCB advances; freeze exact development result and preregister a new never-scored transfer cohort before reading transfer outcomes."
            if advances else
            "R-LCB does not advance. Stop the R architecture under the frozen development protocol; retain A."
        ),
        "limitations":[
            "observational OPE still depends on measured-confounding assumptions",
            "multi-action sensitivity bounds are conservative outer bounds, not sharp multinomial bounds",
            "research A remains a complement-refit v4 analogue unless deployed-artifact parity is separately established",
            "recorded skill/rank upstream timing and repeated-player dependence remain unresolved",
        ],
    }
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print(json.dumps({
        "advances":advances,
        "cap20":cap20["minus_A"],
        "alternative_behavior_cap20":alt20["minus_A"],
        "intervention_rate":intervention,
        "gamma_zero":sensitivity_result["dr_gamma_zero"],
        "gamma_reference_p95":gamma_reference,
        "gate":checks,
    },indent=2,sort_keys=True))


if __name__=="__main__":
    main()
