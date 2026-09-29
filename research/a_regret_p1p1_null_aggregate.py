#!/usr/bin/env python3
"""Aggregate five-set P1P1 null calibration for #756."""
from __future__ import annotations

import argparse
import gzip
import json
import math
from pathlib import Path
from statistics import NormalDist

import numpy as np

ENVIRONMENTS=("FIN","TDM","DFT","MSH","SOS")
SCENARIOS=(
    "null","a_opt_tau_0.10","a_opt_tau_0.20",
    "perturbed_s_0.05","perturbed_s_0.10","perturbed_s_0.20",
)
SLICES=("<=0.02","(0.02,0.05]","(0.05,0.10]",">0.10")
OBSERVED=0.1552391
BOOTSTRAPS=10_000
BOOT_SEED=7562026092902


def args():
    p=argparse.ArgumentParser()
    p.add_argument("--input-root",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    return p.parse_args()


def main():
    a=args()
    env={}
    for p in a.input_root.rglob("p1-null-environment.json"):
        d=json.loads(p.read_text())
        exp=d["expansion"]
        if exp in env:
            raise SystemExit(f"duplicate {exp}")
        if d.get("outcome_columns_read")!=[]:
            raise SystemExit(f"{exp}: outcome access recorded")
        if d["a_validation"]["checked_rows"] != d["retained_scored_rows"]:
            raise SystemExit(f"{exp}: incomplete A validation")
        env[exp]=d
    if set(env)!=set(ENVIRONMENTS):
        raise SystemExit(f"missing environments {set(ENVIRONMENTS)-set(env)}")
    reps=min(d["replicates"] for d in env.values())

    scenario_out={}
    power_out={}
    pooled_reps={}
    for sc in SCENARIOS:
        stats=[]
        power=[]
        for rep in range(reps):
            n=sum(env[e]["scenarios"][sc][rep]["n"] for e in ENVIRONMENTS)
            est=sum(env[e]["scenarios"][sc][rep]["sum_est"] for e in ENVIRONMENTS)/n
            true=sum(env[e]["scenarios"][sc][rep]["sum_true"] for e in ENVIRONMENTS)/n
            disagree=sum(env[e]["scenarios"][sc][rep]["disagree"] for e in ENVIRONMENTS)/n
            slices={}
            for sl in SLICES:
                sn=sum(env[e]["scenarios"][sc][rep]["slices"][sl]["n"] for e in ENVIRONMENTS)
                ss=sum(env[e]["scenarios"][sc][rep]["slices"][sl]["sum_est"] for e in ENVIRONMENTS)
                slices[sl]=None if not sn else ss/sn
            stats.append({"n":n,"est":est,"true":true,"disagree":disagree,"slices":slices})

            pn=sum(env[e]["scenarios"][sc][rep]["power_design"]["n"] for e in ENVIRONMENTS)
            pest=sum(env[e]["scenarios"][sc][rep]["power_design"]["sum_est_gain"] for e in ENVIRONMENTS)/pn
            ptrue=sum(env[e]["scenarios"][sc][rep]["power_design"]["sum_true_gain"] for e in ENVIRONMENTS)/pn
            power.append({"n":pn,"est":pest,"true":ptrue,"error":pest-ptrue})

        x=np.asarray([r["est"] for r in stats],dtype=float)
        t=np.asarray([r["true"] for r in stats],dtype=float)
        dis=np.asarray([r["disagree"] for r in stats],dtype=float)
        scenario_out[sc]={
            "replicates":reps,
            "eligible_decisions_per_replicate":int(stats[0]["n"]),
            "true_regret_mean":float(np.mean(t)),
            "true_regret_sd":float(np.std(t,ddof=1)),
            "estimated_regret_mean":float(np.mean(x)),
            "estimated_regret_sd":float(np.std(x,ddof=1)),
            "estimated_regret_p2_5":float(np.quantile(x,0.025)),
            "estimated_regret_p97_5":float(np.quantile(x,0.975)),
            "a_iv_best_disagreement_mean":float(np.mean(dis)),
            "a_margin_slice_means":{
                sl:float(np.mean([r["slices"][sl] for r in stats if r["slices"][sl] is not None]))
                for sl in SLICES
            },
            "observed_0_1552391_inside_range":bool(np.quantile(x,0.025)<=OBSERVED<=np.quantile(x,0.975)),
        }
        pooled_reps[sc]=stats

        pe=np.asarray([r["est"] for r in power],dtype=float)
        pt=np.asarray([r["true"] for r in power],dtype=float)
        errors=pe-pt
        sd=float(np.std(pe,ddof=1))
        delta=0.02
        if sd>0:
            nd=NormalDist(mu=delta,sigma=sd)
            crit=1.96*sd
            powv=nd.cdf(-crit)+(1.0-nd.cdf(crit))
        else:
            powv=1.0
        power_out[sc]={
            "replicates":reps,
            "eligible_decisions_per_replicate":int(power[0]["n"]),
            "true_gain_mean":float(np.mean(pt)),
            "estimated_gain_mean":float(np.mean(pe)),
            "bias_mean":float(np.mean(errors)),
            "estimated_gain_sd":sd,
            "power_for_true_gain_0_02_two_sided_alpha_0_05":float(powv),
            "reaches_80_percent_power":bool(powv>=0.80),
        }

    # Null replicate 0 row bootstrap, stratified by environment.
    rows={}
    for e in ENVIRONMENTS:
        candidates=list(a.input_root.rglob("null-rep0-rows.jsonl.gz"))
        # Select by sibling environment JSON rather than path naming assumptions.
        chosen=None
        for rp in candidates:
            jp=rp.parent/"p1-null-environment.json"
            if jp.exists() and json.loads(jp.read_text())["expansion"]==e:
                chosen=rp; break
        if chosen is None:
            raise SystemExit(f"{e}: null rep0 rows missing")
        vals=[]
        with gzip.open(chosen,"rt",encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    vals.append(float(json.loads(line)["regret"]))
        rows[e]=np.asarray(vals,dtype=float)
    point=float(sum(v.sum() for v in rows.values())/sum(len(v) for v in rows.values()))
    rng=np.random.default_rng(BOOT_SEED)
    boots=np.zeros(BOOTSTRAPS,dtype=float)
    denom=sum(len(v) for v in rows.values())
    for start in range(0,BOOTSTRAPS,100):
        b=min(100,BOOTSTRAPS-start)
        total=np.zeros(b,dtype=float)
        for e in ENVIRONMENTS:
            v=rows[e]; n=len(v)
            idx=rng.integers(0,n,size=(b,n),dtype=np.int32)
            total+=v[idx].sum(axis=1)
        boots[start:start+b]=total/denom
    lo=float(np.quantile(boots,0.025)); hi=float(np.quantile(boots,0.975))

    # Existing-artifact take-rate audit.
    ar=[]; br=[]; dif=[]
    for p in a.input_root.rglob("take-rate-pairs.jsonl.gz"):
        with gzip.open(p,"rt",encoding="utf-8") as f:
            for line in f:
                if not line.strip(): continue
                r=json.loads(line); ar.append(float(r["a_rate"])); br.append(float(r["iv_rate"])); dif.append(float(r["diff"]))
    aa=np.asarray(ar); bb=np.asarray(br); dd=np.asarray(dif)
    take={
        "n_disagreement_rows":int(len(dd)),
        "a_take_rate_mean":float(np.mean(aa)),
        "a_take_rate_median":float(np.median(aa)),
        "iv_best_take_rate_mean":float(np.mean(bb)),
        "iv_best_take_rate_median":float(np.median(bb)),
        "paired_diff_mean_iv_minus_a":float(np.mean(dd)),
        "paired_diff_median_iv_minus_a":float(np.median(dd)),
        "iv_best_lower_fraction":float(np.mean(dd<0)),
        "equal_fraction":float(np.mean(np.isclose(dd,0,atol=1e-15,rtol=0))),
        "iv_best_higher_fraction":float(np.mean(dd>0)),
    }

    decision_p1=any(scenario_out[s]["observed_0_1552391_inside_range"] for s in ("null","a_opt_tau_0.10","a_opt_tau_0.20"))
    out={
        "issue":756,
        "phase":"p1p1_null_calibration_aggregate",
        "observed_756_statistic":OBSERVED,
        "outcome_columns_read":[],
        "all_a_validations_exact":True,
        "scenarios":scenario_out,
        "decision_rule":{
            "observed_inside_null_or_a_opt_range":bool(decision_p1),
            "result":"original_p1p1_statistic_uninformative_about_A_regret" if decision_p1 else "null_calibration_did_not_trigger_uninformative_rule",
        },
        "null_rep0_row_bootstrap":{
            "point":point,
            "draws":BOOTSTRAPS,
            "ci95":[lo,hi],
            "half_width":(hi-lo)/2.0,
            "note":"Conditions on the fitted coefficients; does not include coefficient estimation/selection uncertainty.",
        },
        "take_rate_audit":take,
        "independent_selection_power":power_out,
        "any_scenario_80_percent_power_for_0_02":bool(any(x["reaches_80_percent_power"] for x in power_out.values())),
    }
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(out,indent=2,sort_keys=True)+"\n")
    print(json.dumps(out,indent=2,sort_keys=True))


if __name__=="__main__":
    main()
