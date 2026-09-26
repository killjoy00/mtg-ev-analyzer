"""Frozen policy-comparison gates for contextual-value-v1."""

from __future__ import annotations

import math
from dataclasses import asdict
from typing import Mapping, Sequence

from . import HARM_MARGIN, MIN_ESS_RATIO, WEIGHT_CAPS
from .dr import PolicyObservation, evaluate_policy

REQUIRED_DEVELOPMENT_ENVIRONMENTS = ("MSH", "SOS", "ECL", "TLA")
REQUIRED_ABLATIONS = (
    "remove_strong_player_choice_probability",
    "remove_gih",
    "remove_iwd_iih",
    "remove_gnd",
    "remove_deck_fit_probability",
    "remove_pool_context",
    "remove_skill_controls",
    "remove_card_metadata",
    "remove_relative_to_pack_features",
    "remove_propensity_correction",
    "strong_player_as_propensity_initializer_offset",
    "strong_player_as_q_feature",
    "strong_player_as_prior",
    "strong_player_as_fallback",
    "strong_player_omitted_entirely",
)


def _valid_interval(value: object) -> tuple[float, float] | None:
    if not isinstance(value, (tuple, list)) or len(value) != 2:
        return None
    try:
        low = float(value[0])
        high = float(value[1])
    except (TypeError, ValueError):
        return None
    if not math.isfinite(low) or not math.isfinite(high) or low > high:
        return None
    return low, high


def _development_environment_evidence(
    environment_deltas: Mapping[str, tuple[float, float]] | None,
    environment_powered: Mapping[str, bool] | None,
    required_environments: Sequence[str],
) -> tuple[bool | None, bool | None, dict]:
    required = tuple(required_environments)
    if not required or len(required) != len(set(required)):
        raise ValueError("required_environments must be a non-empty unique sequence")
    if environment_deltas is None or environment_powered is None:
        return None, None, {
            "required": list(required),
            "missing_intervals": list(required) if environment_deltas is None else [],
            "missing_power_status": list(required) if environment_powered is None else [],
            "malformed": [],
            "adequately_powered": [],
        }

    missing_intervals = [name for name in required if name not in environment_deltas]
    missing_power = [name for name in required if name not in environment_powered]
    malformed = []
    intervals: dict[str, tuple[float, float]] = {}
    for name in required:
        if name not in environment_deltas:
            continue
        interval = _valid_interval(environment_deltas[name])
        if interval is None:
            malformed.append(name)
        else:
            intervals[name] = interval

    bad_power = [
        name for name in required
        if name in environment_powered and type(environment_powered[name]) is not bool
    ]
    malformed.extend(f"power:{name}" for name in bad_power)
    powered = [
        name for name in required
        if environment_powered.get(name) is True
    ]

    structurally_complete = (
        not missing_intervals
        and not missing_power
        and not malformed
    )
    # Item 5 cannot be treated as satisfied by all([]). If development has no
    # environment classified as adequately powered, the harm check is incomplete.
    evidence_complete = structurally_complete and bool(powered)
    no_harm = (
        all(intervals[name][1] >= HARM_MARGIN for name in powered)
        if evidence_complete
        else None
    )
    return evidence_complete, no_harm, {
        "required": list(required),
        "missing_intervals": missing_intervals,
        "missing_power_status": missing_power,
        "malformed": malformed,
        "adequately_powered": powered,
    }


def _ablation_evidence(
    ablations: Mapping[str, bool] | None,
) -> tuple[bool | None, bool | None, dict]:
    if ablations is None:
        return None, None, {
            "required": list(REQUIRED_ABLATIONS),
            "missing": list(REQUIRED_ABLATIONS),
            "malformed": [],
        }
    missing = [name for name in REQUIRED_ABLATIONS if name not in ablations]
    malformed = [
        name for name in REQUIRED_ABLATIONS
        if name in ablations and type(ablations[name]) is not bool
    ]
    complete = not missing and not malformed
    coherent = (
        all(ablations[name] for name in REQUIRED_ABLATIONS)
        if complete
        else None
    )
    return complete, coherent, {
        "required": list(REQUIRED_ABLATIONS),
        "missing": missing,
        "malformed": malformed,
    }


def compare_policies(
    candidate: Sequence[PolicyObservation],
    incumbent: Sequence[PolicyObservation],
    ci95: tuple[float, float] | None = None,
    environment_deltas: Mapping[str, tuple[float, float]] | None = None,
    *,
    environment_powered: Mapping[str, bool] | None = None,
    ablation_evidence: Mapping[str, bool] | None = None,
    out_of_environment_name: str | None = None,
    out_of_environment_ci95: tuple[float, float] | None = None,
    out_of_environment_excluded_from_development: bool | None = None,
    required_environments: Sequence[str] = REQUIRED_DEVELOPMENT_ENVIRONMENTS,
    prospective_environment_delta: float | None = None,
    prospective_environment_ci95: tuple[float, float] | None = None,
) -> dict:
    """Evaluate protocol section 15 without silently filling missing evidence.

    Items 1-7 form the research gate. Item 8 is deliberately reported as a
    separate production-promotion gate and cannot convert incomplete research
    evidence into a pass.
    """
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

    primary_ci = _valid_interval(ci95)
    environment_complete, no_environment_harm, environment_evidence = (
        _development_environment_evidence(
            environment_deltas,
            environment_powered,
            required_environments,
        )
    )
    ablations_complete, ablations_coherent, ablation_details = _ablation_evidence(
        ablation_evidence
    )

    out_of_environment_ci = _valid_interval(out_of_environment_ci95)
    ood_name_valid = isinstance(out_of_environment_name, str) and bool(
        out_of_environment_name.strip()
    )
    ood_exclusion_known = type(out_of_environment_excluded_from_development) is bool
    ood_complete = (
        ood_name_valid
        and out_of_environment_ci is not None
        and ood_exclusion_known
    )
    ood_excluded = (
        out_of_environment_excluded_from_development
        if ood_exclusion_known
        else None
    )
    ood_no_harm = (
        out_of_environment_ci[1] >= HARM_MARGIN
        if ood_complete
        else None
    )

    checks: dict[str, bool | None] = {
        "primary_dr_ci_above_zero": None if primary_ci is None else primary_ci[0] > 0,
        "direct_same_direction": direct_delta > 0,
        "snips_same_direction": snips_delta > 0,
        "clipping_robust": all(delta > 0 for delta in deltas.values()),
        "usable_overlap": primary_candidate["ess_ratio"] >= MIN_ESS_RATIO,
        "development_environment_evidence_complete": environment_complete,
        "no_concentrated_harm": no_environment_harm,
        "required_ablation_evidence_complete": ablations_complete,
        "ablations_coherent_no_leakage_proxy": ablations_coherent,
        "out_of_environment_evidence_complete": ood_complete,
        "out_of_environment_excluded_from_development": ood_excluded,
        "out_of_environment_no_separated_material_harm": ood_no_harm,
    }

    decisive = all(value is not None for value in checks.values())
    passed = decisive and all(bool(value) for value in checks.values())
    research_status = "pass" if passed else ("fail" if decisive else "incomplete")

    prospective_ci = _valid_interval(prospective_environment_ci95)
    prospective_delta = None
    if prospective_environment_delta is not None:
        try:
            prospective_delta = float(prospective_environment_delta)
        except (TypeError, ValueError):
            prospective_delta = None
        if prospective_delta is not None and not math.isfinite(prospective_delta):
            prospective_delta = None

    promotion_checks: dict[str, bool | None] = {
        "research_gate_passed": passed if decisive else None,
        "prospective_environment_positive_direction": (
            None if prospective_delta is None else prospective_delta > 0
        ),
        "prospective_environment_above_harm_margin": (
            None if prospective_ci is None else prospective_ci[0] >= HARM_MARGIN
        ),
    }
    promotion_decisive = all(value is not None for value in promotion_checks.values())
    promotion_passed = promotion_decisive and all(bool(value) for value in promotion_checks.values())

    return {
        "primary_weight_cap": float(primary_cap),
        "candidate": candidate_by_cap,
        "incumbent": incumbent_by_cap,
        "dr_delta_by_cap": deltas,
        "primary_ci95": primary_ci,
        "direct_delta": direct_delta,
        "snips_delta": snips_delta,
        "checks": checks,
        "evidence": {
            "development_environments": environment_evidence,
            "ablations": ablation_details,
            "out_of_environment": {
                "name": out_of_environment_name,
                "ci95": out_of_environment_ci,
                "excluded_from_development": out_of_environment_excluded_from_development,
            },
        },
        "decisive": decisive,
        "passed": passed,
        "status": research_status,
        "production_promotion": {
            "checks": promotion_checks,
            "decisive": promotion_decisive,
            "passed": promotion_passed,
            "status": (
                "pass"
                if promotion_passed
                else ("fail" if promotion_decisive else "incomplete")
            ),
            "prospective_environment_delta": prospective_delta,
            "prospective_environment_ci95": prospective_ci,
        },
    }
