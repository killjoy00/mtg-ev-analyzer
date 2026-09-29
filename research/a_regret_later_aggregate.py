#!/usr/bin/env python3
"""Aggregate the frozen #756 P1P2-P1P8 recentered-regret results.

This implements the already-frozen protocol section 10:
- average eligible regret within source draft through draft totals/counts;
- 10,000 environment-stratified draft bootstraps;
- resample drafts with replacement within environment;
- pooled statistic is the decision-weighted mean of resampled totals/counts.

No model fitting or outcome-value estimation occurs here.
"""
from __future__ import annotations

import argparse
import gzip
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

ENVIRONMENTS = ("FIN", "TDM", "DFT", "MSH", "SOS")
PICKS = tuple(range(1, 8))
PRACTICAL = 0.02
BOOTSTRAPS = 10_000
SEED = 756_20260929


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--input-root", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    return p.parse_args()


def slice_name(margin: float) -> str:
    if margin <= 0.02:
        return "<=0.02"
    if margin <= 0.05:
        return "(0.02,0.05]"
    if margin <= 0.10:
        return "(0.05,0.10]"
    return ">0.10"


def summarize(values):
    a = np.asarray(values, dtype=np.float64)
    if not len(a):
        return {"n": 0, "mean_regret": None, "median_regret": None, "p90_regret": None, "share_regret_gt_0_02": None}
    return {
        "n": int(len(a)),
        "mean_regret": float(np.mean(a)),
        "median_regret": float(np.median(a)),
        "p90_regret": float(np.quantile(a, 0.90)),
        "share_regret_gt_0_02": float(np.mean(a > PRACTICAL)),
    }


def main():
    args = parse_args()
    row_files = sorted(args.input_root.rglob("later-regret-rows.jsonl.gz"))
    report_files = sorted(args.input_root.rglob("later-report.json"))
    if not row_files:
        raise SystemExit("no later-regret row files found")

    reports = {}
    for path in report_files:
        r = json.loads(path.read_text())
        exp = str(r.get("expansion"))
        if exp in reports:
            raise SystemExit(f"duplicate report for {exp}")
        reports[exp] = r
    if set(reports) != set(ENVIRONMENTS):
        raise SystemExit(f"expected reports for {ENVIRONMENTS}, got {sorted(reports)}")

    for exp, r in reports.items():
        if r.get("issue") != 756:
            raise SystemExit(f"{exp}: wrong issue")
        if r.get("secondary_after_p1p1_outcome_open") is not True:
            raise SystemExit(f"{exp}: secondary boundary missing")
        if r.get("status") not in {"analyzed_secondary_recentered", "insufficient_recentered_identification"}:
            raise SystemExit(f"{exp}: unexpected status {r.get('status')}")

    # Per-environment draft totals/counts are the cluster units for the frozen bootstrap.
    draft_stats = {e: defaultdict(lambda: [0.0, 0]) for e in ENVIRONMENTS}
    env_pick = {(e, p): [0.0, 0, 0] for e in ENVIRONMENTS for p in PICKS}
    pick_stats = {p: [0.0, 0, 0] for p in PICKS}
    margin_values = {k: [] for k in ("<=0.02", "(0.02,0.05]", "(0.05,0.10]", ">0.10")}
    disagreement_values = {
        "A_vs_IV_best": [],
        "A_vs_historical": [],
        "A_vs_both": [],
    }
    all_values = []
    rows_by_env = defaultdict(int)

    seen_row_sources = set()
    for path in row_files:
        # Read expansion from first row rather than artifact directory naming.
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            first = True
            for line in fh:
                if not line.strip():
                    continue
                row = json.loads(line)
                exp = str(row["expansion"])
                if exp not in ENVIRONMENTS:
                    raise SystemExit(f"unexpected environment {exp}")
                if first:
                    key = (exp, str(path))
                    if key in seen_row_sources:
                        raise SystemExit(f"duplicate row source {path}")
                    seen_row_sources.add(key)
                    first = False
                did = str(row["draft_id"])
                pick = int(row["pick_number"])
                if pick not in PICKS:
                    raise SystemExit(f"{exp}: out-of-window pick {pick}")
                regret = float(row["regret"])
                if regret < -1e-12:
                    raise SystemExit(f"{exp}: negative regret")
                if regret < 0:
                    regret = 0.0

                ds = draft_stats[exp][did]
                ds[0] += regret
                ds[1] += 1
                rows_by_env[exp] += 1

                ep = env_pick[(exp, pick)]
                ep[0] += regret
                ep[1] += 1
                ep[2] += int(regret > PRACTICAL)
                pp = pick_stats[pick]
                pp[0] += regret
                pp[1] += 1
                pp[2] += int(regret > PRACTICAL)

                all_values.append(regret)
                margin_values[slice_name(float(row["a_margin"]))].append(regret)
                if bool(row["a_iv_disagree"]):
                    disagreement_values["A_vs_IV_best"].append(regret)
                if bool(row["a_historical_disagree"]):
                    disagreement_values["A_vs_historical"].append(regret)
                if bool(row["a_iv_disagree"]) and bool(row["a_historical_disagree"]):
                    disagreement_values["A_vs_both"].append(regret)

    # Exactly one row artifact per environment.
    envs_with_rows = {e for e in ENVIRONMENTS if rows_by_env[e] > 0}
    if envs_with_rows != set(ENVIRONMENTS):
        raise SystemExit(f"missing row data for {sorted(set(ENVIRONMENTS)-envs_with_rows)}")

    point = float(np.mean(np.asarray(all_values, dtype=np.float64)))

    # Exact environment-stratified source-draft bootstrap. Generate in bounded
    # batches so the frozen 10k resamples do not require a giant index matrix.
    rng = np.random.default_rng(SEED)
    boot_num = np.zeros(BOOTSTRAPS, dtype=np.float64)
    boot_den = np.zeros(BOOTSTRAPS, dtype=np.float64)
    batch = 10
    bootstrap_env = {}
    for exp in ENVIRONMENTS:
        pairs = list(draft_stats[exp].values())
        sums = np.asarray([x[0] for x in pairs], dtype=np.float64)
        counts = np.asarray([x[1] for x in pairs], dtype=np.int16)
        n = len(sums)
        if n == 0:
            raise SystemExit(f"{exp}: no draft clusters")
        bootstrap_env[exp] = {
            "draft_clusters": n,
            "eligible_decisions": int(np.sum(counts)),
            "mean_regret": float(np.sum(sums) / np.sum(counts)),
        }
        for start in range(0, BOOTSTRAPS, batch):
            b = min(batch, BOOTSTRAPS - start)
            idx = rng.integers(0, n, size=(b, n), dtype=np.int32)
            boot_num[start:start+b] += sums[idx].sum(axis=1)
            boot_den[start:start+b] += counts[idx].sum(axis=1)

    if np.any(boot_den <= 0):
        raise SystemExit("bootstrap produced empty resample")
    boot = boot_num / boot_den
    ci = [float(np.quantile(boot, 0.025)), float(np.quantile(boot, 0.975))]

    env_pick_out = {}
    for exp in ENVIRONMENTS:
        env_pick_out[exp] = {}
        for pick in PICKS:
            total, n, gt = env_pick[(exp, pick)]
            env_pick_out[exp][str(pick)] = {
                "display_pick": pick + 1,
                "n": int(n),
                "mean_regret": None if not n else float(total / n),
                "share_regret_gt_0_02": None if not n else float(gt / n),
            }

    pick_out = {}
    for pick in PICKS:
        total, n, gt = pick_stats[pick]
        pick_out[str(pick)] = {
            "display_pick": pick + 1,
            "n": int(n),
            "mean_regret": None if not n else float(total / n),
            "share_regret_gt_0_02": None if not n else float(gt / n),
        }

    report = {
        "phase": "a_regret_p1p2_p1p8_recentered_aggregate",
        "issue": 756,
        "protocol": "research/A-REGRET-RECENTERED-P1P2-P1P8-PROTOCOL-2026-09-29.md",
        "secondary_after_p1p1_outcome_open": True,
        "environments": list(ENVIRONMENTS),
        "all_environment_reports_status": {e: reports[e]["status"] for e in ENVIRONMENTS},
        "all_environment_failed_pick_numbers": {e: reports[e].get("failed_pick_numbers", []) for e in ENVIRONMENTS},
        "eligible_decisions": int(len(all_values)),
        "overall_mean_regret": point,
        "overall_median_regret": float(np.median(np.asarray(all_values, dtype=np.float64))),
        "overall_p90_regret": float(np.quantile(np.asarray(all_values, dtype=np.float64), 0.90)),
        "overall_share_regret_gt_0_02": float(np.mean(np.asarray(all_values, dtype=np.float64) > PRACTICAL)),
        "bootstrap": {
            "method": "10000 environment-stratified source-draft resamples; decision-weighted draft totals/counts",
            "draws": BOOTSTRAPS,
            "seed": SEED,
            "ci95": ci,
            "environments": bootstrap_env,
        },
        "by_environment_pick": env_pick_out,
        "by_pick_pooled": pick_out,
        "close_call_a_margin": {k: summarize(v) for k, v in margin_values.items()},
        "disagreements": {k: summarize(v) for k, v in disagreement_values.items()},
        "interpretation_boundary": [
            "Secondary analysis: the same draft-level outcomes were already opened by the completed P1P1 stage.",
            "Passed-pack instruments are recentered on the focal player's pre-pick pool using the frozen cross-fitted ridge design.",
            "No later-pick result can reverse the failed primary P1P1 optimal-enough gate.",
            "The 0.02 threshold is retained as a materiality reference, not a new primary pass gate.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "eligible_decisions": report["eligible_decisions"],
        "overall_mean_regret": report["overall_mean_regret"],
        "ci95": ci,
        "share_regret_gt_0_02": report["overall_share_regret_gt_0_02"],
        "by_environment": bootstrap_env,
        "by_pick": pick_out,
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
