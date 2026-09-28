#!/usr/bin/env python3
"""Aggregate the frozen Q+A fresh-environment policy study."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from statistics import NormalDist

ENVS = ("EOE", "FIN", "TDM", "DFT")
HYBRIDS = ("guard_005", "guard_010", "guard_020", "blend_025", "blend_050", "blend_075")
CAPS = ("10", "20", "50")
ALPHA = 0.05
POWER = 0.80


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--report", action="append", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    return p.parse_args()


def _pooled_metric(rows, label, cap, metric):
    n = sum(int(r["policies"][label]["n"]) for r in rows)
    return sum(
        int(r["policies"][label]["n"]) * float(r["policies"][label]["caps"][cap]["estimate"][metric])
        for r in rows
    ) / n


def _pooled_snips(rows, label, cap):
    num = sum(float(r["policies"][label]["caps"][cap]["sufficient"]["policy"]["weighted_outcome_sum"]) for r in rows)
    den = sum(float(r["policies"][label]["caps"][cap]["sufficient"]["policy"]["weight_sum"]) for r in rows)
    return num / den if den > 0 else math.nan


def _pooled_delta(rows, label, cap, metric):
    if metric == "snips":
        return _pooled_snips(rows, label, cap) - _pooled_snips(rows, "A", cap)
    return _pooled_metric(rows, label, cap, metric) - _pooled_metric(rows, "A", cap, metric)


def _pooled_intervention(rows, label):
    n = sum(int(r["policies"][label]["n"]) for r in rows)
    return sum(
        int(r["policies"][label]["n"]) * float(r["policies"][label]["intervention_rate_vs_A"])
        for r in rows
    ) / n


def _delta_variance(rows, label, cap="20"):
    n = sum(int(r["policies"][label]["n"]) for r in rows)
    s = sum(float(r["policies"][label]["caps"][cap]["sufficient"]["dr_delta_sum"]) for r in rows)
    ss = sum(float(r["policies"][label]["caps"][cap]["sufficient"]["dr_delta_sq_sum"]) for r in rows)
    if n <= 1:
        return math.nan
    return max(0.0, (ss - s * s / n) / (n - 1))


def _sample_size(var, effect, alpha=ALPHA, power=POWER):
    if not math.isfinite(var) or var <= 0 or effect <= 0:
        return None
    z_alpha = NormalDist().inv_cdf(1.0 - alpha / 2.0)
    z_power = NormalDist().inv_cdf(power)
    return int(math.ceil(((z_alpha + z_power) ** 2) * var / (effect ** 2)))


def _conservative_key(label):
    if label.startswith("guard_"):
        threshold = int(label.split("_")[1])
        return (0, -threshold)
    lam = int(label.split("_")[1])
    return (1, lam)


def main():
    args = parse_args()
    reports = [json.loads(p.read_text(encoding="utf-8")) for p in args.report]
    if len(reports) != 4 or {r["expansion"] for r in reports} != set(ENVS):
        raise SystemExit("expected exactly EOE/FIN/TDM/DFT reports")
    if any(r.get("assessment_opened") is not False or r.get("assessment_outcomes_loaded") is not False for r in reports):
        raise SystemExit("assessment boundary violation")
    reports.sort(key=lambda r: ENVS.index(r["expansion"]))

    labels = tuple(reports[0]["policies"])
    if any(tuple(r["policies"]) != labels for r in reports):
        raise SystemExit("policy family mismatch across environments")

    raw_q_intervention = _pooled_intervention(reports, "Q")
    summary = {}
    for label in labels:
        envs = {}
        for r in reports:
            p = r["policies"][label]
            envs[r["expansion"]] = {
                "n": p["n"],
                "dr_cap20": p["caps"]["20"]["minus_A"]["dr"],
                "dr_ci95_cap20": p["caps"]["20"]["minus_A"]["dr_ci95"],
                "ess_ratio_cap20": p["caps"]["20"]["estimate"]["ess_ratio"],
                "clipped_fraction_cap20": p["caps"]["20"]["estimate"]["clipped_fraction"],
                "max_unclipped_weight_cap20": p["caps"]["20"]["estimate"]["max_unclipped_weight"],
                "intervention_rate_vs_A": p["intervention_rate_vs_A"],
            }
        pooled = {
            "dr_by_cap": {c: _pooled_delta(reports, label, c, "dr") for c in CAPS},
            "direct_cap20": _pooled_delta(reports, label, "20", "direct"),
            "snips_cap20": _pooled_delta(reports, label, "20", "snips"),
            "ipw_cap20": _pooled_delta(reports, label, "20", "ipw"),
            "intervention_rate_vs_A": _pooled_intervention(reports, label),
            "delta_variance_cap20": _delta_variance(reports, label, "20"),
        }
        summary[label] = {"environments": envs, "pooled": pooled}

    eligibility = {}
    for label in HYBRIDS:
        s = summary[label]
        env_vals = [float(s["environments"][e]["dr_cap20"]) for e in ENVS]
        env_cis = [s["environments"][e]["dr_ci95_cap20"] for e in ENVS]
        checks = {
            "pooled_dr_positive_caps_10_20_50": all(float(s["pooled"]["dr_by_cap"][c]) > 0.0 for c in CAPS),
            "positive_cap20_in_at_least_3_of_4": sum(v > 0.0 for v in env_vals) >= 3,
            "no_environment_point_below_minus_0_05": min(env_vals) >= -0.05,
            "no_environment_ci_entirely_below_minus_0_05": all(float(ci[1]) >= -0.05 for ci in env_cis),
            "ess_ratio_at_least_0_10_everywhere": all(float(s["environments"][e]["ess_ratio_cap20"]) >= 0.10 for e in ENVS),
            "pooled_direct_positive": float(s["pooled"]["direct_cap20"]) > 0.0,
            "pooled_snips_positive": float(s["pooled"]["snips_cap20"]) > 0.0,
            "intervention_below_raw_Q": float(s["pooled"]["intervention_rate_vs_A"]) < raw_q_intervention,
        }
        eligibility[label] = {
            "checks": checks,
            "eligible": all(checks.values()),
            "min_environment_dr_cap20": min(env_vals),
        }

    eligible = [h for h in HYBRIDS if eligibility[h]["eligible"]]
    selected = None
    if eligible:
        best_min = max(float(eligibility[h]["min_environment_dr_cap20"]) for h in eligible)
        shortlist = [h for h in eligible if float(eligibility[h]["min_environment_dr_cap20"]) >= best_min - 0.01]
        best_intervention = min(float(summary[h]["pooled"]["intervention_rate_vs_A"]) for h in shortlist)
        shortlist = [h for h in shortlist if abs(float(summary[h]["pooled"]["intervention_rate_vs_A"]) - best_intervention) <= 1e-12]
        shortlist.sort(key=_conservative_key)
        selected = shortlist[0]

    planning = {}
    for label in ("Q", selected) if selected else ("Q",):
        var = float(summary[label]["pooled"]["delta_variance_cap20"])
        planning[label] = {
            "variance_cap20": var,
            "n_for_effect_0_18": _sample_size(var, 0.18),
            "n_for_effect_0_15": _sample_size(var, 0.15),
            "n_for_effect_0_10": _sample_size(var, 0.10),
        }

    out = {
        "phase": "qa_bounded_policy_study_aggregate",
        "scope": "fresh_validation_only",
        "assessment_opened": False,
        "assessment_outcomes_loaded": False,
        "environments": list(ENVS),
        "hybrids": list(HYBRIDS),
        "raw_Q_intervention_rate": raw_q_intervention,
        "summary": summary,
        "eligibility": eligibility,
        "eligible_hybrids": eligible,
        "selected_hybrid": selected,
        "selection_rule": "eligible hybrids only; maximize minimum environment cap20 DR, within 0.01 prefer lower intervention, then QA-Guard, then more conservative setting",
        "large_confirmation_planning": planning,
        "next_step": (
            "Freeze Q plus the selected hybrid and preregister a genuinely unused large confirmation with two-comparison multiplicity."
            if selected else
            "Freeze Q alone and preregister a genuinely unused large Q-vs-A confirmation; no hybrid advances."
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(out, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "selected_hybrid": selected,
        "eligible_hybrids": eligible,
        "planning": planning,
        "assessment_opened": False,
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
