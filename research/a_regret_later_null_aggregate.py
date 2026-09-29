#!/usr/bin/env python3
"""Aggregate the five-set P1P2-P1P8 pure-noise null calibration."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import numpy as np

ENVIRONMENTS=("FIN","TDM","DFT","MSH","SOS")
SLICES=("<=0.02","(0.02,0.05]","(0.05,0.10]",">0.10")
OBSERVED=0.2290850


def args():
    p=argparse.ArgumentParser()
    p.add_argument("--input-root",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    return p.parse_args()


def main():
    a=args(); env={}
    for p in a.input_root.rglob("later-null-environment.json"):
        d=json.loads(p.read_text()); exp=d["expansion"]
        if exp in env: raise SystemExit(f"duplicate {exp}")
        if d.get("outcome_columns_read")!=[] or d["a_reconstruction"].get("outcome_columns_read")!=[]:
            raise SystemExit(f"{exp}: outcome access recorded")
        env[exp]=d
    if set(env)!=set(ENVIRONMENTS):
        raise SystemExit(f"missing {set(ENVIRONMENTS)-set(env)}")
    reps=min(d["replicates"] for d in env.values())
    pooled=[]
    for rep in range(reps):
        n=sum(env[e]["replicate_results"][rep]["n"] for e in ENVIRONMENTS)
        est=sum(env[e]["replicate_results"][rep]["sum_est"] for e in ENVIRONMENTS)/n
        dis=sum(env[e]["replicate_results"][rep]["disagree"] for e in ENVIRONMENTS)/n
        slices={}
        for sl in SLICES:
            sn=sum(env[e]["replicate_results"][rep]["slices"][sl]["n"] for e in ENVIRONMENTS)
            ss=sum(env[e]["replicate_results"][rep]["slices"][sl]["sum_est"] for e in ENVIRONMENTS)
            slices[sl]=ss/sn
        picks={}
        for pick in range(1,8):
            pn=sum(env[e]["replicate_results"][rep]["by_pick"][str(pick)]["n"] for e in ENVIRONMENTS)
            ps=sum(env[e]["replicate_results"][rep]["by_pick"][str(pick)]["sum_est"] for e in ENVIRONMENTS)
            picks[str(pick)]=ps/pn
        pooled.append({"n":n,"est":est,"disagree":dis,"slices":slices,"picks":picks})
    x=np.asarray([r["est"] for r in pooled],dtype=float)
    lo=float(np.quantile(x,0.025)); hi=float(np.quantile(x,0.975))
    inside=bool(lo<=OBSERVED<=hi)
    out={
        "issue":756,
        "phase":"later_pick_null_calibration_aggregate",
        "observed_756_statistic":OBSERVED,
        "outcome_columns_read":[],
        "replicates":reps,
        "true_regret":0.0,
        "eligible_decisions_per_replicate":int(pooled[0]["n"]),
        "estimated_regret_mean":float(np.mean(x)),
        "estimated_regret_sd":float(np.std(x,ddof=1)),
        "estimated_regret_p2_5":lo,
        "estimated_regret_p97_5":hi,
        "a_iv_best_disagreement_mean":float(np.mean([r["disagree"] for r in pooled])),
        "a_margin_slice_means":{
            sl:float(np.mean([r["slices"][sl] for r in pooled])) for sl in SLICES
        },
        "by_pick_mean_null_statistic":{
            str(p):float(np.mean([r["picks"][str(p)] for r in pooled])) for p in range(1,8)
        },
        "decision_rule":{
            "observed_inside_null_range":inside,
            "result":"original_later_pick_statistic_uninformative_about_A_regret" if inside else "later_null_calibration_did_not_trigger_uninformative_rule",
        },
        "a_validation":{
            e:env[e]["a_validation"] for e in ENVIRONMENTS
        },
    }
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(out,indent=2,sort_keys=True)+"\n")
    print(json.dumps(out,indent=2,sort_keys=True))


if __name__=="__main__":
    main()
