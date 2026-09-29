#!/usr/bin/env python3
"""Aggregate #756 synthetic null calibration across the five frozen sets."""
from __future__ import annotations
import argparse, gzip, json, math
from pathlib import Path
from collections import defaultdict
import numpy as np
from scipy.stats import norm

ENVS=("FIN","TDM","DFT","MSH","SOS")
OBS_P1=0.1552391
OBS_LATER=0.2290850
SCENARIOS=("a_zero","b_tau_010","b_tau_020","c_tau_010_s005","c_tau_010_s010","c_tau_010_s020")
SLICES=("<=0.02","(0.02,0.05]","(0.05,0.10]",">0.10")
ROW_BOOT_DRAWS=1000
ROW_BOOT_SEED=75620260930


def parse_args():
    p=argparse.ArgumentParser()
    p.add_argument("--p1-root",type=Path,required=True)
    p.add_argument("--later-root",type=Path,required=True)
    p.add_argument("--original-p1-root",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    return p.parse_args()


def load_unique(root,name):
    xs=list(root.rglob(name))
    if len(xs)!=1: raise SystemExit(f"expected exactly one {name} below {root}, got {len(xs)}")
    return xs[0]


def quantile_range(x):
    a=np.asarray(x,float)
    return [float(np.quantile(a,.025)),float(np.quantile(a,.975))]


def pooled_original_margin_counts(original_root):
    counts={e:{s:0 for s in SLICES} for e in ENVS}
    for e in ENVS:
        candidates=list((original_root/e).rglob("regret-rows.jsonl.gz"))
        if len(candidates)!=1:
            # artifact layout may include one extra directory level
            candidates=[p for p in original_root.rglob("regret-rows.jsonl.gz") if e in str(p)]
        if len(candidates)!=1: raise SystemExit(f"{e}: original regret rows not unique: {candidates}")
        with gzip.open(candidates[0],"rt",encoding="utf-8") as f:
            for line in f:
                if not line.strip(): continue
                r=json.loads(line); m=float(r["a_margin"])
                if m<=.02:s="<=0.02"
                elif m<=.05:s="(0.02,0.05]"
                elif m<=.10:s="(0.05,0.10]"
                else:s=">0.10"
                counts[e][s]+=1
    return counts


def row_boot_halfwidth(arrays_by_env,draws=ROW_BOOT_DRAWS):
    """Environment-stratified row bootstrap, fixed original environment sizes."""
    rng=np.random.default_rng(ROW_BOOT_SEED)
    envs=list(arrays_by_env)
    total_n=sum(len(arrays_by_env[e]) for e in envs)
    vals=np.zeros(draws,float)
    batch=10
    for start in range(0,draws,batch):
        b=min(batch,draws-start)
        num=np.zeros(b,float)
        for e in envs:
            a=np.asarray(arrays_by_env[e],float); n=len(a)
            idx=rng.integers(0,n,size=(b,n),dtype=np.int32)
            num+=a[idx].sum(axis=1)
        vals[start:start+b]=num/total_n
    lo,hi=np.quantile(vals,[.025,.975])
    return {
        "draws":draws,"ci95":[float(lo),float(hi)],
        "half_width":float((hi-lo)/2),
        "mean":float(np.mean(vals)),
    }


def approx_power(sd,delta=.02,alpha=.05):
    if sd<=0:return 1.0
    z=norm.ppf(1-alpha/2)
    mu=delta/sd
    return float(norm.sf(z-mu)+norm.cdf(-z-mu))


def main():
    args=parse_args()
    p1={}; later={}
    for e in ENVS:
        p1files=[p for p in args.p1_root.rglob("p1-null-set.json") if e in str(p)]
        laterfiles=[p for p in args.later_root.rglob("later-null-set.json") if e in str(p)]
        if len(p1files)!=1: raise SystemExit(f"{e}: p1 result count {len(p1files)}")
        if len(laterfiles)!=1: raise SystemExit(f"{e}: later result count {len(laterfiles)}")
        p1[e]=json.loads(p1files[0].read_text())
        later[e]=json.loads(laterfiles[0].read_text())
        if not p1[e].get("synthetic_outcomes_only") or not later[e].get("synthetic_outcomes_only"):
            raise SystemExit(f"{e}: synthetic boundary missing")
        v=p1[e]["safe_a_reproduction"]
        if v["a_card_mismatches"] or v["a_margin_mismatches"]:
            raise SystemExit(f"{e}: A reproduction mismatch")

    margin_counts=pooled_original_margin_counts(args.original_p1_root)

    p1_table={}
    p1_rep_pooled={s:[] for s in SCENARIOS}
    power_table={}
    bootstrap={}
    for scen in SCENARIOS:
        reps=[]
        for ri in range(20):
            n=sum(int(p1[e]["scenarios"][scen]["reps"][ri]["n"]) for e in ENVS)
            est=sum(float(p1[e]["scenarios"][scen]["reps"][ri]["est_mean"])*int(p1[e]["scenarios"][scen]["reps"][ri]["n"]) for e in ENVS)/n
            true=sum(float(p1[e]["scenarios"][scen]["reps"][ri]["true_mean"])*int(p1[e]["scenarios"][scen]["reps"][ri]["n"]) for e in ENVS)/n
            dis=sum(float(p1[e]["scenarios"][scen]["reps"][ri]["disagreement_rate"])*int(p1[e]["scenarios"][scen]["reps"][ri]["n"]) for e in ENVS)/n
            sm={}
            for sl in SLICES:
                den=sum(margin_counts[e][sl] for e in ENVS)
                sm[sl]=sum(float(p1[e]["scenarios"][scen]["reps"][ri]["margin_means"][sl])*margin_counts[e][sl] for e in ENVS)/den
            # Independent-half policy selection/evaluation pool.
            pn=sum(int(p1[e]["scenarios"][scen]["reps"][ri]["power_crossfit"]["n"]) for e in ENVS)
            pest=sum(float(p1[e]["scenarios"][scen]["reps"][ri]["power_crossfit"]["estimate"])*int(p1[e]["scenarios"][scen]["reps"][ri]["power_crossfit"]["n"]) for e in ENVS)/pn
            ptrue=sum(float(p1[e]["scenarios"][scen]["reps"][ri]["power_crossfit"]["true_gain"])*int(p1[e]["scenarios"][scen]["reps"][ri]["power_crossfit"]["n"]) for e in ENVS)/pn
            reps.append({"rep":ri,"n":n,"estimate":est,"true_regret":true,"disagreement_rate":dis,"margin_means":sm,
                         "power_n":pn,"power_estimate":pest,"power_true_gain":ptrue,"power_bias":pest-ptrue})
        p1_rep_pooled[scen]=reps
        ests=[x["estimate"] for x in reps]; trues=[x["true_regret"] for x in reps]
        p1_table[scen]={
            "true_regret_mean":float(np.mean(trues)),
            "true_regret_sd":float(np.std(trues,ddof=1)),
            "statistic_mean":float(np.mean(ests)),
            "statistic_sd":float(np.std(ests,ddof=1)),
            "statistic_range_2_5_97_5":quantile_range(ests),
            "a_iv_best_disagreement_rate_mean":float(np.mean([x["disagreement_rate"] for x in reps])),
            "a_margin_slice_mean_regret":{sl:float(np.mean([x["margin_means"][sl] for x in reps])) for sl in SLICES},
        }
        p_est=np.asarray([x["power_estimate"] for x in reps],float)
        p_true=np.asarray([x["power_true_gain"] for x in reps],float)
        bias=p_est-p_true
        sd=float(np.std(p_est,ddof=1))
        power_table[scen]={
            "mean_true_B_minus_A":float(np.mean(p_true)),
            "mean_estimated_B_minus_A":float(np.mean(p_est)),
            "mean_bias":float(np.mean(bias)),
            "estimator_sd":sd,
            "normal_approx_two_sided_power_for_true_gain_0_02":approx_power(sd,.02,.05),
            "reaches_80pct_power":bool(approx_power(sd,.02,.05)>=.80),
            "mean_evaluation_n":float(np.mean([x["power_n"] for x in reps])),
        }

        arrays={}
        for e in ENVS:
            npzs=[p for p in args.p1_root.rglob("rep0-regrets.npz") if e in str(p)]
            if len(npzs)!=1:raise SystemExit(f"{e}: rep0 npz count {len(npzs)}")
            z=np.load(npzs[0],allow_pickle=False); arrays[e]=np.asarray(z[scen],float)
        bootstrap[scen]=row_boot_halfwidth(arrays)
        p1_table[scen]["rep0_row_bootstrap"]=bootstrap[scen]

    # Fixed P1 decision rule.
    null_hit={}
    for scen in ("a_zero","b_tau_010","b_tau_020"):
        lo,hi=p1_table[scen]["statistic_range_2_5_97_5"]
        null_hit[scen]=bool(lo<=OBS_P1<=hi)
    p1_uninformative=any(null_hit.values())

    # Take-rate comparison pooled over all existing original disagreement rows.
    tr_n=sum(p1[e]["take_rate_comparison_existing_artifact"]["n"] for e in ENVS)
    take={
        "n":tr_n,
        "mean_take_rate_iv_best":sum(p1[e]["take_rate_comparison_existing_artifact"]["mean_take_rate_iv_best"]*p1[e]["take_rate_comparison_existing_artifact"]["n"] for e in ENVS)/tr_n,
        "mean_take_rate_a":sum(p1[e]["take_rate_comparison_existing_artifact"]["mean_take_rate_a"]*p1[e]["take_rate_comparison_existing_artifact"]["n"] for e in ENVS)/tr_n,
        "mean_pair_difference":sum(p1[e]["take_rate_comparison_existing_artifact"]["mean_pair_difference"]*p1[e]["take_rate_comparison_existing_artifact"]["n"] for e in ENVS)/tr_n,
        "iv_best_lower_take_rate_fraction":sum(p1[e]["take_rate_comparison_existing_artifact"]["iv_best_lower_take_rate_fraction"]*p1[e]["take_rate_comparison_existing_artifact"]["n"] for e in ENVS)/tr_n,
    }

    # Later pure-noise pooled replicates.
    later_reps=[]
    for ri in range(10):
        n=sum(int(later[e]["reps"][ri]["n"]) for e in ENVS)
        est=sum(float(later[e]["reps"][ri]["est_mean"])*int(later[e]["reps"][ri]["n"]) for e in ENVS)/n
        dis=sum(float(later[e]["reps"][ri]["disagreement_rate"])*int(later[e]["reps"][ri]["n"]) for e in ENVS)/n
        later_reps.append({"rep":ri,"n":n,"estimate":est,"disagreement_rate":dis})
    later_est=[x["estimate"] for x in later_reps]
    later_range=quantile_range(later_est)
    later_hit=bool(later_range[0]<=OBS_LATER<=later_range[1])

    report={
        "phase":"a_regret_null_calibration_aggregate","issue":756,
        "synthetic_outcomes_only":True,"forbidden_target_field_accessed":False,
        "observed_reference":{"p1":OBS_P1,"later":OBS_LATER},
        "p1":{"replicates_per_scenario":20,"scenario_table":p1_table,
              "decision_rule":{"observed_inside_null_ranges":null_hit,"uninformative_about_A_regret":p1_uninformative}},
        "later":{"replicates":10,"true_regret":0.0,
                 "statistic_mean":float(np.mean(later_est)),"statistic_sd":float(np.std(later_est,ddof=1)),
                 "statistic_range_2_5_97_5":later_range,
                 "a_iv_best_disagreement_rate_mean":float(np.mean([x["disagreement_rate"] for x in later_reps])),
                 "decision_rule":{"observed_inside_pure_noise_range":later_hit,"uninformative_about_A_regret":later_hit}},
        "take_rate_comparison_existing_artifacts":take,
        "valid_independent_half_design":power_table,
        "power_any_scenario_reaches_80pct":any(v["reaches_80pct_power"] for v in power_table.values()),
        "ci_boundary":"The original #756 held-row bootstrap CIs condition on fitted IV coefficients and exclude coefficient/model-selection uncertainty.",
    }
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print(json.dumps({
        "p1_decision":report["p1"]["decision_rule"],
        "later_decision":report["later"]["decision_rule"],
        "take_rate":take,
        "power_any_80":report["power_any_scenario_reaches_80pct"],
        "p1_summary":{s:{k:v for k,v in p1_table[s].items() if k in ("true_regret_mean","statistic_mean","statistic_sd","statistic_range_2_5_97_5")} for s in SCENARIOS},
        "later_summary":{k:report["later"][k] for k in ("statistic_mean","statistic_sd","statistic_range_2_5_97_5")},
    },indent=2,sort_keys=True))


if __name__=="__main__":main()
