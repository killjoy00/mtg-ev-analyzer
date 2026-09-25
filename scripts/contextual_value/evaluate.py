"""Frozen policy-comparison gate for contextual-value-v1."""

from __future__ import annotations

from dataclasses import asdict
from typing import Mapping, Sequence

from . import HARM_MARGIN, MIN_ESS_RATIO, WEIGHT_CAPS
from .dr import PolicyObservation, evaluate_policy


def compare_policies(
    candidate: Sequence[PolicyObservation],
    incumbent: Sequence[PolicyObservation],
    ci95: tuple[float, float] | None = None,
    environment_deltas: Mapping[str, tuple[float, float]] | None = None,
) -> dict:
    if len(candidate) != len(incumbent) or not candidate:
        raise ValueError("candidate and incumbent must cover the same non-empty assessment sample")

    candidate_by_cap = {str(int(cap)): asdict(evaluate_policy(candidate, cap)) for cap in WEIGHT_CAPS}
    incumbent_by_cap = {str(int(cap)): asdict(evaluate_policy(incumbent, cap)) for cap in WEIGHT_CAPS}
    deltas = {
        cap: candidate_by_cap[cap]["dr"] - incumbent_by_cap[cap]["dr"]
        for cap in candidate_by_cap
    }
    primary_cap = str(int(WEIGHT_CAPS[1]))
    primary_candidate = candidate_by_cap[primary_cap]
    primary_incumbent = incumbent_by_cap[primary_cap]
    direct_delta = primary_candidate["direct"] - primary_incumbent["direct"]
    snips_delta = primary_candidate["snips"] - primary_incumbent["snips"]

    checks: dict[str, bool | None] = {
        "primary_dr_ci_above_zero": None if ci95 is None else ci95[0] > 0,
        "direct_same_direction": direct_delta > 0,
        "snips_same_direction": snips_delta > 0,
        "clipping_robust": all(delta > 0 for delta in deltas.values()),
        "usable_overlap": primary_candidate["ess_ratio"] >= MIN_ESS_RATIO,
        "no_concentrated_harm": None,
    }
    if environment_deltas is not None:
        checks["no_concentrated_harm"] = all(
            interval[1] >= HARM_MARGIN for interval in environment_deltas.values()
        )

    decisive = all(value is not None for value in checks.values())
    passed = decisive and all(bool(value) for value in checks.values())
    return {
        "primary_weight_cap": float(primary_cap),
        "candidate": candidate_by_cap,
        "incumbent": incumbent_by_cap,
        "dr_delta_by_cap": deltas,
        "primary_ci95": ci95,
        "direct_delta": direct_delta,
        "snips_delta": snips_delta,
        "checks": checks,
        "decisive": decisive,
        "passed": passed,
        "status": "pass" if passed else ("fail" if decisive else "incomplete"),
    }
