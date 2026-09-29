#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy.stats import norm

ENVIRONMENTS=("FIN","TDM","DFT","MSH","SOS")
SCENARIOS=(
    "null",
    "a_opt_tau_0_10",
    "a_opt_tau_0_20",
    "a_opt_tau_0_10_card_noise_0_05",
    "a_opt_tau_0_10_card_noise_0_10",
    "a_opt_tau_0_10_card_noise_0_20",
)
REPLICATES=20
OBSERVED=0.1552391
BOOT_DRAWS=1000
BOOT_SEED=7562026092901


def parse_args():
    p=argparse.ArgumentParser()
    p.add_argument("--input-root",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    return p.parse_args()


def pooled_replicates(data):
    by={(s,r):{
        "sum_regret":0.0,"sum_true_regret":0.0,"eligible_n":0,"disagree_n":0,
        "slice_sum":defaultdict(float),"slice_n":defaultdict(int)
    } for s in SCENARIOS for r in range(REPLICATES)}
    power={(s,r):{"estimate_sum":0.0,"true_gain_sum":0.0,"eligible_n":0}
           for s in SCENARIOS for r in range(REPLICATES)}
    take={"n":0,"sum_iv_best_take_rate":0.0,"sum_a_take_rate":0.0,
          "sum_paired_difference":0.0,"iv_best_lower_n":0,"missing":0}

    for exp,d in data.items():
        for row in d["replicates"]:
            k=(row["scenario"],int(row["replicate"]))
            x=by[k]
            for f in ("sum_regret","sum_true_regret"):
                x[f]+=float(row[f])
            for f in ("eligible_n","disagree_n"):
                x[f]+=int(row[f])
            for sk,v in row["slice_sum"].items():
                x["slice_sum"][sk]+=float(v)
            for sk,v in row["slice_n"].items():
                x["slice_n"][sk]+=int(v)
        for row in d["power_replicates"]:
            k=(row["scenario"],int(row["replicate"]))
            x=power[k]
            x["estimate_sum"]+=float(row["estimate_sum"])
            x["true_gain_sum"]+=float(row["true_gain_sum"])
            x["eligible_n"]+=int(row["eligible_n"])
        td=d["take_rate_diagnostic"]
        for f in ("n","iv_best_lower_n","missing"):
            take[f]+=int(td[f])
        for f in ("sum_iv_best_take_rate","sum_a_take_rate","sum_paired_difference"):
            take[f]+=float(td[f])
    return by,power,take


def bootstrap_halfwidth(arrays_by_env, scenario):
    rng=np.random.default_rng(BOOT_SEED + SCENARIOS.index(scenario))
    ns={e:len(arrays_by_env[e]) for e in ENVIRONMENTS}
    total_n=sum(ns.values())
    means=np.empty(BOOT_DRAWS,dtype=np.float64)
    batch=10
    for start in range(0,BOOT_DRAWS,batch):
        b=min(batch,BOOT_DRAWS-start)
        sums=np.zeros(b,dtype=np.float64)
        for e in ENVIRONMENTS:
            a=arrays_by_env[e]
            n=len(a)
            idx=rng.integers(0,n,size=(b,n),dtype=np.int32)
            sums+=a[idx].sum(axis=1,dtype=np.float64)
        means[start:start+b]=sums/total_n
    lo,hi=np.quantile(means,[0.025,0.975])
    return {
        "draws":BOOT_DRAWS,
        "ci95":[float(lo),float(hi)],
        "half_width":float((hi-lo)/2.0),
        "center":float(np.mean(means)),
    }


def main():
    args=parse_args()
    data={}
    arrays={s:{} for s in SCENARIOS}
    for exp in ENVIRONMENTS:
        candidates=list(args.input_root.rglob(f"{exp}/p1-null-set.json"))
        if not candidates:
            # actions/download-artifact may add artifact name directory
            candidates=[p for p in args.input_root.rglob("p1-null-set.json")
                        if json.loads(p.read_text()).get("expansion")==exp]
        if len(candidates)!=1:
            raise SystemExit(f"{exp}: expected one result file, got {candidates}")
        d=json.loads(candidates[0].read_text())
        if not d.get("synthetic_only") or d.get("real_outcome_reader_called"):
            raise SystemExit(f"{exp}: synthetic boundary violated")
        data[exp]=d
        npz_path=candidates[0].with_name("replicate0-regrets.npz")
        z=np.load(npz_path)
        for s in SCENARIOS:
            arrays[s][exp]=np.asarray(z[s],dtype=np.float64)

    pooled,power,take=pooled_replicates(data)
    scenario_out={}
    for s in SCENARIOS:
        est=[]
        true=[]
        disagree=[]
        slice_vals=defaultdict(list)
        for r in range(REPLICATES):
            x=pooled[(s,r)]
            n=x["eligible_n"]
            est.append(x["sum_regret"]/n)
            true.append(x["sum_true_regret"]/n)
            disagree.append(x["disagree_n"]/n)
            for sk in ("le_0_02","0_02_0_05","0_05_0_10","gt_0_10"):
                if x["slice_n"][sk]:
                    slice_vals[sk].append(x["slice_sum"][sk]/x["slice_n"][sk])
        est=np.asarray(est)
        true=np.asarray(true)
        q=np.quantile(est,[0.025,0.975])
        scenario_out[s]={
            "replicates":REPLICATES,
            "true_regret_mean":float(np.mean(true)),
            "true_regret_range_2_5_97_5":[float(x) for x in np.quantile(true,[0.025,0.975])],
            "estimated_regret_mean":float(np.mean(est)),
            "estimated_regret_sd":float(np.std(est,ddof=1)),
            "estimated_regret_range_2_5_97_5":[float(q[0]),float(q[1])],
            "observed_0_1552391_inside_range":bool(q[0] <= OBSERVED <= q[1]),
            "a_iv_best_disagreement_rate_mean":float(np.mean(disagree)),
            "a_margin_slice_mean_regret":{
                sk:float(np.mean(v)) for sk,v in slice_vals.items()
            },
            "replicate0_row_bootstrap":bootstrap_halfwidth(arrays[s],s),
        }

    power_out={}
    any_power=False
    for s in SCENARIOS:
        estimates=[]
        truths=[]
        errors=[]
        ns=[]
        for r in range(REPLICATES):
            x=power[(s,r)]
            n=x["eligible_n"]
            est=x["estimate_sum"]/n
            tru=x["true_gain_sum"]/n
            estimates.append(est); truths.append(tru); errors.append(est-tru); ns.append(n)
        estimates=np.asarray(estimates); truths=np.asarray(truths); errors=np.asarray(errors)
        sd_error=float(np.std(errors,ddof=1))
        bias=float(np.mean(errors))
        if sd_error>0:
            zcrit=float(norm.ppf(0.975))
            delta=0.02/sd_error
            pwr=float(norm.cdf(-zcrit-delta) + 1.0 - norm.cdf(zcrit-delta))
        else:
            pwr=1.0
        any_power=any_power or pwr>=0.80
        power_out[s]={
            "replicates":REPLICATES,
            "mean_exact_true_B_minus_A_gain":float(np.mean(truths)),
            "mean_estimated_B_minus_A_gain":float(np.mean(estimates)),
            "bias":bias,
            "estimator_sd":float(np.std(estimates,ddof=1)),
            "centered_error_sd":sd_error,
            "eligible_n_mean":float(np.mean(ns)),
            "normal_approx_two_sided_power_for_true_gain_0_02":pwr,
            "reaches_80pct_power":bool(pwr>=0.80),
        }

    p1_rule=(
        scenario_out["null"]["observed_0_1552391_inside_range"] or
        scenario_out["a_opt_tau_0_10"]["observed_0_1552391_inside_range"] or
        scenario_out["a_opt_tau_0_20"]["observed_0_1552391_inside_range"]
    )
    take_out={
        "n_disagreement_rows":take["n"],
        "mean_iv_best_take_rate_when_offered":take["sum_iv_best_take_rate"]/take["n"],
        "mean_a_take_rate_when_offered":take["sum_a_take_rate"]/take["n"],
        "paired_mean_iv_best_minus_a":take["sum_paired_difference"]/take["n"],
        "share_iv_best_lower_take_rate":take["iv_best_lower_n"]/take["n"],
        "missing":take["missing"],
    }

    out={
        "phase":"a_regret_p1p1_null_calibration_aggregate",
        "issue":756,
        "synthetic_only":True,
        "observed_original_statistic":OBSERVED,
        "scenarios":scenario_out,
        "decision_rule":{
            "triggered_uninformative":bool(p1_rule),
            "rule":"observed 0.1552391 inside 2.5-97.5% range of null or either A-optimal scenario",
        },
        "take_rate_comparison":take_out,
        "split_selection_power":power_out,
        "any_scenario_reaches_80pct_power_for_0_02":bool(any_power),
    }
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(out,indent=2,sort_keys=True)+"\n")
    print(json.dumps(out,indent=2,sort_keys=True))


if __name__=="__main__":
    main()
