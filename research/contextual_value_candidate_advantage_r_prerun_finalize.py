#!/usr/bin/env python3
"""Finalize the outcome-free R pre-run freeze with spent-20k variance planning."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

Z_975=1.959963984540054
Z_80=0.8416212335729143


def parse_args():
    p=argparse.ArgumentParser()
    p.add_argument("--core-report",type=Path,required=True)
    p.add_argument("--policy-bundle",type=Path,required=True)
    p.add_argument("--variance-report",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    return p.parse_args()


def sha256(path):
    h=hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda:fh.read(1024*1024),b""): h.update(block)
    return h.hexdigest()


def main():
    args=parse_args()
    core=json.loads(args.core_report.read_text())
    variance=json.loads(args.variance_report.read_text())
    if core.get("validation_outcomes_loaded") is not False:
        raise SystemExit("core pre-run loaded validation outcomes")
    if core.get("assessment_outcomes_loaded") is not False:
        raise SystemExit("core pre-run loaded assessment outcomes")
    if variance.get("registered_result_unchanged") is not True:
        raise SystemExit("spent-20k boundary failure")
    if sha256(args.policy_bundle)!=core["policy_bundle"]["sha256"]:
        raise SystemExit("policy bundle digest mismatch")

    n_dev=int(core["validation"]["drafts"])
    all_variances={
        label:float(variance["comparisons"][label]["all_eligible"]["per_draft_delta_variance"])
        for label in ("Q","guard_010")
    }
    planning_variance=max(all_variances.values())
    se=math.sqrt(planning_variance/n_dev)
    mde=(Z_975+Z_80)*se
    planning_source=max(all_variances,key=all_variances.get)

    final={
        "phase":"candidate_advantage_R_prerun_freeze",
        "date_utc":"2026-09-28",
        "validation_outcomes_loaded":False,
        "assessment_outcomes_loaded":False,
        "r_result_seen":False,
        "core":core,
        "spent20k_variance":variance,
        "power_planning":{
            "alpha_two_sided":0.05,
            "power":0.80,
            "development_drafts":n_dev,
            "variance_rule":"max of authorized spent-20k all-eligible cap20 per-draft Q-A and Guard-10-A variances",
            "source_comparison":planning_source,
            "planning_variance":planning_variance,
            "standard_error_at_development_n":se,
            "minimum_detectable_effect_wins":mde,
            "existing_R_gate_point_threshold":0.05,
            "interpretation":"If R fails, report that no effect at least as large as this pre-run MDE was demonstrated under the amended development design; do not call failure proof of zero effect.",
        },
        "frozen_policy":{
            "bundle_sha256":core["policy_bundle"]["sha256"],
            "r_lcb_c":core["r_lcb"]["c"],
            "r_lcb_null_deviation_rate":core["r_lcb"]["null_calibration"]["chosen_null_deviation_rate"],
            "gamma_reference_p95":core["hidden_confounding_benchmark"]["gamma_reference_p95"],
            "sensitivity_gamma_grid":core["hidden_confounding_benchmark"]["fixed_gamma_grid"],
        },
        "boundary":"Commit this report and its producing run/artifact identity before any R validation outcome is evaluated.",
    }
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(final,indent=2,sort_keys=True)+"\n")
    print(json.dumps({
        "c":final["frozen_policy"]["r_lcb_c"],
        "null_rate":final["frozen_policy"]["r_lcb_null_deviation_rate"],
        "gamma_reference_p95":final["frozen_policy"]["gamma_reference_p95"],
        "variance_ratio_Q":variance["comparisons"]["Q"]["variance_ratio_single_over_all"],
        "variance_ratio_guard":variance["comparisons"]["guard_010"]["variance_ratio_single_over_all"],
        "MDE":mde,
        "development_drafts":n_dev,
    },indent=2,sort_keys=True))


if __name__=="__main__":
    main()
