#!/usr/bin/env python3
"""Aggregate the authorized spent-20k single-vs-all variance diagnostic."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def parse_args():
    p=argparse.ArgumentParser()
    p.add_argument("--report",action="append",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    return p.parse_args()


def pooled(rows,mode):
    n=sum(int(r[mode]["n_drafts"]) for r in rows)
    mean=sum(int(r[mode]["n_drafts"])*float(r[mode]["dr_delta"]) for r in rows)/n
    ss=sum(
        (int(r[mode]["n_drafts"])-1)*float(r[mode]["per_draft_delta_variance"])
        + int(r[mode]["n_drafts"])*(float(r[mode]["dr_delta"])-mean)**2
        for r in rows
    )
    return {
        "n_drafts":n,
        "dr_delta":mean,
        "per_draft_delta_variance":ss/(n-1),
    }


def main():
    args=parse_args()
    reports=[json.loads(p.read_text()) for p in args.report]
    expected={"EOE","FIN","TDM","DFT"}
    if {r["expansion"] for r in reports}!=expected:
        raise SystemExit("expected EOE/FIN/TDM/DFT variance reports")
    for r in reports:
        if r.get("registered_result_unchanged") is not True:
            raise SystemExit("registered-result boundary failure")
    out={}
    for label in ("Q","guard_010"):
        rows=[r["comparisons"][label] for r in reports]
        single=pooled(rows,"single_hashed")
        allpos=pooled(rows,"all_eligible")
        out[label]={
            "single_hashed":single,
            "all_eligible":allpos,
            "variance_ratio_single_over_all":single["per_draft_delta_variance"]/allpos["per_draft_delta_variance"],
            "point_shift_all_minus_single":allpos["dr_delta"]-single["dr_delta"],
        }
    result={
        "phase":"r_prerun_spent20k_variance_aggregate",
        "scope":"spent_20k_diagnostic_only",
        "registered_result_unchanged":True,
        "comparisons":out,
        "environments":sorted(expected),
    }
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,indent=2,sort_keys=True)+"\n")
    print(json.dumps(result,indent=2,sort_keys=True))


if __name__=="__main__":
    main()
