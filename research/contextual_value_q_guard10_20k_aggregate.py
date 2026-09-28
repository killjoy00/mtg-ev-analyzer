#!/usr/bin/env python3
"""Aggregate the frozen 20k A vs Q vs Guard-10 confirmation."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

ENVS = ("EOE", "FIN", "TDM", "DFT")
CHALLENGERS = ("Q", "guard_010")
CAPS = ("10", "20", "50")
BOOT = 10000
SEED = 529
HARM_MARGIN = -0.05
MIN_ESS_RATIO = 0.10


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--report", action="append", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    return p.parse_args()


def _bootstrap(delta, alpha):
    delta = np.asarray(delta, dtype=np.float64)
    n = len(delta)
    rng = np.random.default_rng(SEED)
    vals = np.empty(BOOT, dtype=np.float64)
    for b in range(BOOT):
        idx = rng.integers(0, n, size=n)
        vals[b] = float(np.mean(delta[idx]))
    return [
        float(np.quantile(vals, alpha / 2.0)),
        float(np.quantile(vals, 1.0 - alpha / 2.0)),
    ]


def _aggregate_policy(rows, label, cap):
    suff = [r["estimates"][label][cap]["sufficient"] for r in rows]
    n = sum(int(s["n"]) for s in suff)
    direct_sum = sum(float(s["direct_sum"]) for s in suff)
    weighted_outcome_sum = sum(float(s["weighted_outcome_sum"]) for s in suff)
    dr_sum = sum(float(s["dr_sum"]) for s in suff)
    weight_sum = sum(float(s["weight_sum"]) for s in suff)
    weight_sq_sum = sum(float(s["weight_sq_sum"]) for s in suff)
    clipped = sum(int(s["clipped_count"]) for s in suff)
    max_unclipped = max(float(s["max_unclipped_weight"]) for s in suff)
    ess = (weight_sum * weight_sum / weight_sq_sum) if weight_sq_sum > 0 else 0.0
    return {
        "n": n,
        "direct": direct_sum / n,
        "ipw": weighted_outcome_sum / n,
        "snips": weighted_outcome_sum / weight_sum if weight_sum > 0 else None,
        "dr": dr_sum / n,
        "ess": ess,
        "ess_ratio": ess / n,
        "clipped_fraction": clipped / n,
        "max_unclipped_weight": max_unclipped,
        "weight_sum": weight_sum,
        "weight_sq_sum": weight_sq_sum,
    }


def main():
    args = parse_args()
    rows = [json.loads(p.read_text(encoding="utf-8")) for p in args.report]
    if len(rows) != 4 or {r.get("expansion") for r in rows} != set(ENVS):
        raise SystemExit("expected exactly EOE/FIN/TDM/DFT reports")
    rows.sort(key=lambda r: ENVS.index(r["expansion"]))

    if any(r.get("phase") != "q_guard10_20k_confirmation_environment" for r in rows):
        raise SystemExit("unexpected environment report phase")
    if any(r.get("confirmation_outcomes_used_for_fit") is not False for r in rows):
        raise SystemExit("confirmation fit boundary violation")
    if any(r.get("frozen_score_fingerprint") != rows[0].get("frozen_score_fingerprint") for r in rows):
        raise SystemExit("frozen fingerprint mismatch")
    if any(int(r["cohort"]["confirmation"]) != 5000 or int(r["cohort"]["overlap"]) != 0 for r in rows):
        raise SystemExit("confirmation cohort boundary failure")

    all_ids = []
    for r in rows:
        ids = list(r["cohort"]["confirmation_ids"])
        if len(ids) != len(set(ids)):
            raise SystemExit(f"duplicate confirmation IDs within {r['expansion']}")
        all_ids.extend(ids)
    if len(all_ids) != 20000:
        raise SystemExit(f"expected 20000 confirmation IDs, got {len(all_ids)}")
    if len(set(all_ids)) != 20000:
        raise SystemExit("confirmation draft IDs overlap across environments")

    aggregate_estimates = {}
    for label in ("A", "Q", "guard_010"):
        aggregate_estimates[label] = {
            cap: _aggregate_policy(rows, label, cap)
            for cap in CAPS
        }

    comparisons = {}
    for label in CHALLENGERS:
        terms_by_cap = {
            cap: np.concatenate([
                np.asarray(r["raw_dr_delta_terms"][label][cap], dtype=np.float64)
                for r in rows
            ])
            for cap in CAPS
        }
        if any(len(v) != 20000 for v in terms_by_cap.values()):
            raise SystemExit(f"{label}: raw paired term count mismatch")
        cap20 = terms_by_cap["20"]
        comparisons[label] = {
            "dr_by_cap": {cap: float(np.mean(terms_by_cap[cap])) for cap in CAPS},
            "cap20_dr_ci95": _bootstrap(cap20, 0.05),
            "cap20_dr_ci97_5_bonferroni": _bootstrap(cap20, 0.025),
            "cap20_direct": float(
                aggregate_estimates[label]["20"]["direct"] - aggregate_estimates["A"]["20"]["direct"]
            ),
            "cap20_snips": float(
                aggregate_estimates[label]["20"]["snips"] - aggregate_estimates["A"]["20"]["snips"]
            ),
            "cap20_ipw": float(
                aggregate_estimates[label]["20"]["ipw"] - aggregate_estimates["A"]["20"]["ipw"]
            ),
            "cap20_ess_ratio": float(aggregate_estimates[label]["20"]["ess_ratio"]),
            "environment_cap20": {
                r["expansion"]: {
                    "dr": float(r["comparisons_vs_A"][label]["20"]["dr"]),
                    "ci95": [float(x) for x in r["comparisons_vs_A"][label]["20"]["dr_ci95"]],
                    "ess_ratio": float(r["estimates"][label]["20"]["estimate"]["ess_ratio"]),
                    "clipped_fraction": float(r["estimates"][label]["20"]["estimate"]["clipped_fraction"]),
                    "max_unclipped_weight": float(r["estimates"][label]["20"]["estimate"]["max_unclipped_weight"]),
                }
                for r in rows
            },
        }

    gates = {}
    for label in CHALLENGERS:
        c = comparisons[label]
        checks = {
            "familywise_ci97_5_above_zero": float(c["cap20_dr_ci97_5_bonferroni"][0]) > 0.0,
            "direct_positive": float(c["cap20_direct"]) > 0.0,
            "snips_positive": float(c["cap20_snips"]) > 0.0,
            "dr_positive_caps_10_20_50": all(float(c["dr_by_cap"][cap]) > 0.0 for cap in CAPS),
            "pooled_ess_ratio_at_least_0_10": float(c["cap20_ess_ratio"]) >= MIN_ESS_RATIO,
            "no_environment_ci_entirely_below_minus_0_05": all(
                float(v["ci95"][1]) >= HARM_MARGIN for v in c["environment_cap20"].values()
            ),
            "cohort_and_identity_checks": True,
        }
        gates[label] = {
            "checks": checks,
            "confirmed": all(checks.values()),
        }

    pair_terms = np.concatenate([
        np.asarray(r["paired"]["guard_010_minus_Q_cap20"]["terms"], dtype=np.float64)
        for r in rows
    ])
    if len(pair_terms) != 20000:
        raise SystemExit("Guard-10 vs Q paired term count mismatch")
    pairwise = {
        "guard_010_minus_Q_cap20": {
            "dr": float(np.mean(pair_terms)),
            "ci95": _bootstrap(pair_terms, 0.05),
        }
    }

    confirmed = [label for label in CHALLENGERS if gates[label]["confirmed"]]
    pair_ci = pairwise["guard_010_minus_Q_cap20"]["ci95"]
    pairwise_leader = None
    if len(confirmed) == 2:
        if float(pair_ci[0]) > 0.0:
            pairwise_leader = "guard_010"
        elif float(pair_ci[1]) < 0.0:
            pairwise_leader = "Q"

    if not confirmed:
        decision = "no_confirmed_challenger"
        next_step = "Retain A; the 20k confirmation cohort is spent and may not be used to tune another model or threshold."
    elif len(confirmed) == 1:
        decision = "single_confirmed_challenger"
        next_step = f"{confirmed[0]} advances to the next frozen transfer/randomized gate; no production change from this offline confirmation alone."
    elif pairwise_leader:
        decision = "both_confirmed_pairwise_separated"
        next_step = f"Both beat A and {pairwise_leader} is separated in the direct paired comparison; advance under a separately frozen production/transfer gate."
    else:
        decision = "both_confirmed_pairwise_inconclusive"
        next_step = "Both beat A but are not separated from each other; carry both forward or freeze a separate production-selection criterion/randomized test."

    report = {
        "phase": "q_guard10_20k_confirmation_aggregate",
        "scope": "frozen_unused_confirmation",
        "environments": list(ENVS),
        "confirmation_drafts": 20000,
        "confirmation_outcomes_used_for_fit": False,
        "frozen_score_fingerprint": rows[0]["frozen_score_fingerprint"],
        "multiplicity": {
            "family_alpha": 0.05,
            "primary_comparisons": 2,
            "method": "Bonferroni two-sided 97.5% paired bootstrap interval per challenger",
            "bootstrap_draws": BOOT,
            "seed": SEED,
        },
        "aggregate_estimates": aggregate_estimates,
        "comparisons_vs_A": comparisons,
        "gates": gates,
        "confirmed_challengers": confirmed,
        "pairwise": pairwise,
        "pairwise_leader_if_both_confirmed": pairwise_leader,
        "decision": decision,
        "next_step": next_step,
        "environment_policy_behavior": {
            r["expansion"]: r["policy_behavior"] for r in rows
        },
        "cohorts": {
            r["expansion"]: {
                "confirmation": r["cohort"]["confirmation"],
                "overlap": r["cohort"]["overlap"],
                "archive_snapshot": r["archive_snapshot"],
            }
            for r in rows
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "confirmation_drafts": 20000,
        "Q": comparisons["Q"],
        "guard_010": comparisons["guard_010"],
        "confirmed": confirmed,
        "pairwise": pairwise,
        "decision": decision,
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
