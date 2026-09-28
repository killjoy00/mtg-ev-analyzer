#!/usr/bin/env python3
"""Aggregate post-confirmation trust diagnostics across the fixed four-set design."""
from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

ENVS = ("EOE", "FIN", "TDM", "DFT")
CHALLENGERS = ("Q", "guard_010")
BINS = (0.0, 0.02, 0.05, 0.10, 0.20, 0.40, 1.0000001)
BOOT = 5000
SEED = 529


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--report", action="append", type=Path, required=True)
    p.add_argument("--registered-aggregate", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    return p.parse_args()


def _calibration(rows):
    if not rows:
        return {"n": 0, "bins": []}
    p = np.asarray([float(r["propensity"]) for r in rows], dtype=float)
    y = np.asarray([int(r["matched"]) for r in rows], dtype=float)
    bins = []
    for lo, hi in zip(BINS[:-1], BINS[1:]):
        mask = (p >= lo) & (p < hi)
        if not np.any(mask):
            continue
        bins.append({
            "lo": lo,
            "hi": 1.0 if hi > 1 else hi,
            "n": int(mask.sum()),
            "predicted_mean": float(p[mask].mean()),
            "observed_rate": float(y[mask].mean()),
            "observed_minus_predicted": float(y[mask].mean() - p[mask].mean()),
        })
    return {
        "n": len(rows),
        "predicted_mean": float(p.mean()),
        "observed_rate": float(y.mean()),
        "observed_minus_predicted": float(y.mean() - p.mean()),
        "median_propensity": float(np.median(p)),
        "p05_propensity": float(np.quantile(p, 0.05)),
        "p10_propensity": float(np.quantile(p, 0.10)),
        "below_0_01_fraction": float(np.mean(p < 0.01)),
        "below_0_02_fraction": float(np.mean(p < 0.02)),
        "below_0_05_fraction": float(np.mean(p < 0.05)),
        "below_0_10_fraction": float(np.mean(p < 0.10)),
        "bins": bins,
    }


def _weight_tail(rows):
    matched = [r for r in rows if int(r["matched"])]
    inv = np.asarray([1.0 / float(r["propensity"]) for r in matched], dtype=float) if matched else np.asarray([], dtype=float)
    return {
        "n": len(rows),
        "matched_n": len(matched),
        "matched_fraction": len(matched) / max(1, len(rows)),
        "inverse_weight": {
            "max": float(inv.max()) if len(inv) else None,
            "p50": float(np.quantile(inv, .50)) if len(inv) else None,
            "p90": float(np.quantile(inv, .90)) if len(inv) else None,
            "p95": float(np.quantile(inv, .95)) if len(inv) else None,
            "p99": float(np.quantile(inv, .99)) if len(inv) else None,
        },
        "matched_clipped_fraction": {
            str(cap): float(np.mean(inv > cap)) if len(inv) else 0.0
            for cap in (10, 20, 50)
        },
    }


def _influence(x):
    x = np.asarray(x, dtype=float)
    n = len(x)
    mean = float(x.mean())
    loo = (float(x.sum()) - x) / (n - 1)
    change = loo - mean
    a = np.abs(change)
    order = np.argsort(-a, kind="mergesort")
    total = float(a.sum())
    out = {
        "n": n,
        "mean": mean,
        "max_abs_leave_one_out_change": float(a.max()),
        "leave_one_out_min": float(loo.min()),
        "leave_one_out_max": float(loo.max()),
        "sign_flips": int(np.sum(np.sign(loo) != np.sign(mean))) if mean != 0 else None,
    }
    for frac, label in ((.01, "top_1pct"), (.05, "top_5pct")):
        k = max(1, int(math.ceil(n * frac)))
        chosen = order[:k]
        keep = np.ones(n, dtype=bool)
        keep[chosen] = False
        out[label] = {
            "n": k,
            "share_total_absolute_leave_one_out_influence": float(a[chosen].sum()/total) if total else 0.0,
            "effect_without_group": float(x[keep].mean()),
            "signed_delta_sum": float(x[chosen].sum()),
        }
    return out


def _stratified_bootstrap(arrays, alpha):
    rng = np.random.default_rng(SEED)
    vals = np.empty(BOOT, dtype=float)
    for b in range(BOOT):
        means = []
        for x in arrays:
            idx = rng.integers(0, len(x), size=len(x))
            means.append(float(x[idx].mean()))
        vals[b] = float(np.mean(means))
    return [
        float(np.quantile(vals, alpha/2)),
        float(np.quantile(vals, 1-alpha/2)),
    ]


def main():
    args = parse_args()
    rows = [json.loads(p.read_text()) for p in args.report]
    registered = json.loads(args.registered_aggregate.read_text())
    if len(rows) != 4 or {r["expansion"] for r in rows} != set(ENVS):
        raise SystemExit("expected exactly four environment trust reports")
    rows.sort(key=lambda r: ENVS.index(r["expansion"]))
    if any(r.get("parity", {}).get("passed") is not True for r in rows):
        raise SystemExit("environment parity failure")
    if any(r.get("invariants", {}).get("identical_A_vs_A_exact_zero") is not True for r in rows):
        raise SystemExit("environment identical-policy invariant failure")

    support = {}
    for subset in ("q_a_disagreements", "guard_010_overrides"):
        support[subset] = {}
        for label in ("A", "Q"):
            merged = []
            for r in rows:
                merged.extend(r["raw_support_records"][subset][label])
            support[subset][label] = {
                "overall": _calibration(merged),
                "weight_tail": _weight_tail(merged),
            }

    delta = {
        label: [
            np.asarray(r["raw_cap20_delta"][label], dtype=float)
            for r in rows
        ]
        for label in CHALLENGERS
    }
    if any(any(len(x) != 5000 for x in delta[label]) for label in CHALLENGERS):
        raise SystemExit("raw delta size mismatch")

    fixed_set = {}
    leave_one_env_out = {}
    influence = {}
    decomposition = {}
    for label in CHALLENGERS:
        pooled = np.concatenate(delta[label])
        fixed_set[label] = {
            "point": float(np.mean([x.mean() for x in delta[label]])),
            "stratified_ci95": _stratified_bootstrap(delta[label], .05),
            "stratified_ci97_5": _stratified_bootstrap(delta[label], .025),
            "registered_pooled_ci95": registered["comparisons_vs_A"][label]["cap20_dr_ci95"],
            "registered_pooled_ci97_5": registered["comparisons_vs_A"][label]["cap20_dr_ci97_5_bonferroni"],
        }
        leave_one_env_out[label] = {}
        for omit_index, omit in enumerate(ENVS):
            kept = [x.mean() for i, x in enumerate(delta[label]) if i != omit_index]
            leave_one_env_out[label][omit] = float(np.mean(kept))
        influence[label] = _influence(pooled)
        c = registered["comparisons_vs_A"][label]
        decomposition[label] = {
            "dr_cap20": float(c["dr_by_cap"]["20"]),
            "direct_cap20": float(c["cap20_direct"]),
            "residual_correction_cap20": float(c["dr_by_cap"]["20"]) - float(c["cap20_direct"]),
            "snips_cap20": float(c["cap20_snips"]),
            "ipw_cap20": float(c["cap20_ipw"]),
        }

    outcome = {
        "n": 0,
        "missing_losses": 0,
        "terminal_proxy": 0,
        "nonterminal_proxy": 0,
        "wins_distribution": Counter(),
        "losses_distribution": Counter(),
    }
    for r in rows:
        o = r["outcome_completeness"]
        outcome["n"] += int(o["n"])
        outcome["missing_losses"] += int(o["missing_losses"])
        outcome["terminal_proxy"] += int(o["terminal_proxy_wins_ge_7_or_losses_ge_3"])
        outcome["nonterminal_proxy"] += int(o["nonterminal_proxy"])
        outcome["wins_distribution"].update({k:int(v) for k,v in o["wins_distribution"].items()})
        outcome["losses_distribution"].update({k:int(v) for k,v in o["losses_distribution"].items()})
    outcome["wins_distribution"] = dict(sorted(outcome["wins_distribution"].items(), key=lambda x:int(x[0])))
    outcome["losses_distribution"] = dict(sorted(outcome["losses_distribution"].items()))

    report = {
        "phase": "q_guard10_20k_trust_audit_aggregate",
        "scope": "post_confirmation_diagnostic_only",
        "registered_decision": registered["decision"],
        "registered_result_unchanged": True,
        "hard_reconstruction_parity": {
            r["expansion"]: {
                "passed": r["parity"]["passed"],
                "max_abs_error": r["parity"]["max_abs_error"],
                "metadata_sha256": r["identity"]["metadata_canonical_sha256"],
                "rich_q_pickle_sha256": r["identity"]["rich_q_pickle_sha256"],
            }
            for r in rows
        },
        "support": support,
        "fixed_set_bootstrap_sensitivity": fixed_set,
        "leave_one_environment_out": leave_one_env_out,
        "influence_cap20": influence,
        "estimator_decomposition": decomposition,
        "outcome_completeness": outcome,
        "reconstruction_validity_defect_found": False,
        "limitations_not_resolved_by_this_audit": [
            "research A is a complement-refit v4 analogue, not proven literal deployed-artifact parity",
            "upstream timing semantics of recorded skill/rank buckets remain unverified",
            "no stable player identifier is available for repeated-player clustering",
            "observational identification still depends on measured-confounding/support assumptions",
        ],
        "decision_if_semi_synthetic_tests_pass": "Retire Q and Guard-10 from further threshold/blend tuning; retain registered no_confirmed_challenger result and move to one predeclared candidate-advantage model family on development data only.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "registered_decision": registered["decision"],
        "fixed_set": fixed_set,
        "outcome": outcome,
        "support_counts": {
            subset: {label: support[subset][label]["overall"]["n"] for label in ("A","Q")}
            for subset in support
        },
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
