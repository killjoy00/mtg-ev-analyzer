"""Development-only orchestration for contextual-value-v1.

This module may inspect train and validation partitions. It never fits on or
scores the locked assessment partition.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import asdict
from typing import Mapping, Sequence

from . import MIN_ESS_RATIO, WEIGHT_CAPS
from .dataset import Decision, choose_primary_decision, draft_split
from .diagnostics import (
    outcome_diagnostics,
    paired_dr_delta_ci,
    paired_policy_delta_slices,
    policy_overlap_diagnostics,
    policy_overlap_slices,
    propensity_diagnostics,
)
from .dr import PolicyObservation, evaluate_policy
from .features import CardSignals, model_feature_map
from .nuisance import (
    NuisancePrediction,
    SignalProvider,
    crossfit_nuisance,
    fit_fold,
    predict_fold,
)
from .value import (
    ContextualValueModel,
    argmax_policy,
    fit_contextual_value_model,
)


def _group_primary(decisions: Sequence[Decision]) -> list[Decision]:
    grouped: dict[str, list[Decision]] = {}
    for decision in decisions:
        grouped.setdefault(decision.draft_id, []).append(decision)
    chosen = []
    for draft_id in sorted(grouped):
        row = choose_primary_decision(grouped[draft_id])
        if row is not None:
            chosen.append(row)
    return chosen


def _standardise(values: Mapping[str, float]) -> dict[str, float]:
    if not values:
        return {}
    numbers = list(values.values())
    if len(numbers) < 2:
        return {name: 0.0 for name in values}
    mean = statistics.fmean(numbers)
    spread = statistics.pstdev(numbers)
    if spread <= 1e-12:
        return {name: 0.0 for name in values}
    return {name: (value - mean) / spread for name, value in values.items()}


def _signal_axis(
    signals: Mapping[str, CardSignals],
    candidates: Sequence[str],
    field: str,
    *,
    play_weighted: bool = False,
) -> dict[str, float]:
    known = []
    for candidate in candidates:
        row = signals.get(candidate)
        value = getattr(row, field) if row is not None else None
        if value is not None and math.isfinite(float(value)):
            known.append(float(value))
    fallback = statistics.fmean(known) if known else 0.0
    values = {}
    for candidate in candidates:
        row = signals.get(candidate)
        raw = getattr(row, field) if row is not None else None
        value = float(raw) if raw is not None and math.isfinite(float(raw)) else fallback
        if play_weighted:
            deck = (
                row.deck_inclusion_probability
                if row is not None
                else None
            )
            value *= float(deck) if deck is not None and math.isfinite(float(deck)) else 1.0
        values[candidate] = value
    return values


def _strong_axis(
    signals: Mapping[str, CardSignals],
    candidates: Sequence[str],
) -> dict[str, float]:
    values = {}
    for candidate in candidates:
        row = signals.get(candidate)
        probability = row.strong_choice_probability if row is not None else None
        values[candidate] = math.log(max(1e-9, float(probability or 1e-9)))
    return values


def _simple_blend_values(
    signals: Mapping[str, CardSignals],
    candidates: Sequence[str],
    *,
    lam: float,
    weight: float,
) -> dict[str, float]:
    behavior = _standardise(_strong_axis(signals, candidates))
    gih = _standardise(_signal_axis(signals, candidates, "gih_wr", play_weighted=True))
    iwd = _standardise(_signal_axis(signals, candidates, "iwd", play_weighted=True))
    return {
        candidate: (
            (1.0 - weight) * behavior[candidate]
            + weight * (
                lam * gih[candidate]
                + (1.0 - lam) * iwd[candidate]
            )
        )
        for candidate in candidates
    }


def _observation(
    decision: Decision,
    prediction: NuisancePrediction,
    target: Mapping[str, float],
) -> PolicyObservation:
    return PolicyObservation(
        action=decision.selected_card,
        outcome=float(decision.event_match_wins),
        behavior=prediction.behavior,
        target=target,
        q_values=prediction.q_values,
        cluster=decision.draft_id,
    )


def _estimate_by_cap(observations: Sequence[PolicyObservation]) -> dict[str, dict]:
    return {
        str(int(cap)): asdict(evaluate_policy(observations, cap))
        for cap in WEIGHT_CAPS
    }


def _best_validation_policy(
    rows: Sequence[tuple[str, Sequence[PolicyObservation]]],
) -> tuple[str, dict]:
    """Choose on validation only, preferring candidates with usable overlap."""
    primary_cap = str(int(WEIGHT_CAPS[1]))
    scored = []
    for label, observations in rows:
        estimates = _estimate_by_cap(observations)
        primary = estimates[primary_cap]
        scored.append((label, estimates, primary["ess_ratio"] >= MIN_ESS_RATIO, primary["dr"]))
    eligible = [row for row in scored if row[2]]
    chosen = max(eligible or scored, key=lambda row: row[3])
    return chosen[0], {
        "selected": chosen[0],
        "selection_rule": (
            f"maximum validation DR at cap {primary_cap} among ESS/N >= {MIN_ESS_RATIO:.2f}; "
            "if none meet overlap, maximum DR is reported but overlap remains failed"
        ),
        "candidates": {
            label: {
                "estimates": estimates,
                "usable_overlap": usable,
            }
            for label, estimates, usable, _ in scored
        },
    }


def run_development(
    decisions: Sequence[Decision],
    *,
    signal_provider: SignalProvider,
    nuisance_folds: int = 5,
    inner_feature_folds: int = 5,
    value_l2: float = 10.0,
    propensity_l2: float = 1.0,
    outcome_l2: float = 10.0,
    temperature_grid: Sequence[float] = (0.25, 0.5, 1.0, 2.0, 4.0),
    blend_lambdas: Sequence[float] = (0.0, 0.25, 0.5, 0.75, 1.0),
    blend_weights: Sequence[float] = (0.0, 0.25, 0.5, 0.75, 1.0),
    train_predictions: Sequence[NuisancePrediction] | None = None,
    validation_predictions: Sequence[NuisancePrediction] | None = None,
    assessment_draft_count: int | None = None,
) -> tuple[dict, list[NuisancePrediction], list[NuisancePrediction], ContextualValueModel]:
    """Fit on train and tune only on validation; assessment remains unopened."""
    train = [row for row in decisions if draft_split(row.draft_id) == "train"]
    validation = [row for row in decisions if draft_split(row.draft_id) == "validation"]
    assessment = [row for row in decisions if draft_split(row.draft_id) == "assessment"]
    if not train or not validation:
        raise ValueError("development run requires non-empty train and validation partitions")

    if train_predictions is None:
        train_predictions = crossfit_nuisance(
            train,
            folds=nuisance_folds,
            signal_provider=signal_provider,
            propensity_l2=propensity_l2,
            outcome_l2=outcome_l2,
            inner_feature_folds=inner_feature_folds,
        )
    else:
        train_predictions = list(train_predictions)
        expected = {row.decision_id for row in train}
        observed = {row.decision_id for row in train_predictions}
        if len(observed) != len(train_predictions):
            raise ValueError("precomputed train nuisance predictions contain duplicate decisions")
        if observed != expected:
            missing = sorted(expected - observed)[:3]
            extra = sorted(observed - expected)[:3]
            raise ValueError(
                "precomputed train nuisance predictions do not match training decisions; "
                f"missing={missing} extra={extra}"
            )
    value_model = fit_contextual_value_model(
        train,
        train_predictions,
        signal_provider=signal_provider,
        nuisance_folds=nuisance_folds,
        weight_cap=WEIGHT_CAPS[1],
        l2=value_l2,
    )

    train_ids = frozenset(row.draft_id for row in train)
    if validation_predictions is None:
        validation_fit = fit_fold(
            train,
            train_ids,
            signal_provider=signal_provider,
            propensity_l2=propensity_l2,
            outcome_l2=outcome_l2,
            inner_feature_folds=inner_feature_folds,
            fold=-1,
        )
        validation_predictions = predict_fold(
            validation_fit,
            validation,
            signal_provider=signal_provider,
        )
    else:
        validation_predictions = list(validation_predictions)
        expected_validation = {row.decision_id for row in validation}
        observed_validation = {row.decision_id for row in validation_predictions}
        if len(observed_validation) != len(validation_predictions):
            raise ValueError("precomputed validation nuisance predictions contain duplicate decisions")
        if observed_validation != expected_validation:
            missing = sorted(expected_validation - observed_validation)[:3]
            extra = sorted(observed_validation - expected_validation)[:3]
            raise ValueError(
                "precomputed validation nuisance predictions do not match validation decisions; "
                f"missing={missing} extra={extra}"
            )
    by_prediction = {row.decision_id: row for row in validation_predictions}
    primary = _group_primary(validation)
    if not primary:
        raise ValueError("validation partition has no eligible Pack One primary decisions")

    cache: dict[str, tuple[Mapping[str, CardSignals], Mapping[str, Mapping[str, float]]]] = {}
    for decision in primary:
        signals = signal_provider(decision, train_ids)
        cache[decision.decision_id] = (
            signals,
            model_feature_map(decision, signals),
        )

    incumbent_observations = []
    gih_observations = []
    iwd_observations = []
    direct_q_observations = []
    contextual_argmax_observations = []
    contextual_by_temperature: list[tuple[str, list[PolicyObservation]]] = [
        (f"T={temperature:g}", []) for temperature in temperature_grid
    ]
    blend_grid: list[tuple[str, list[PolicyObservation]]] = []
    for lam in blend_lambdas:
        for weight in blend_weights:
            blend_grid.append((f"L={lam:g}|W={weight:g}", []))

    trophy_rows = []
    for decision in primary:
        prediction = by_prediction[decision.decision_id]
        signals, features = cache[decision.decision_id]
        incumbent_values = {
            candidate: float(
                signals.get(candidate).strong_choice_probability
                if signals.get(candidate) is not None
                and signals.get(candidate).strong_choice_probability is not None
                else 0.0
            )
            for candidate in decision.candidates
        }
        incumbent_target = argmax_policy(incumbent_values)
        gih_target = argmax_policy(_signal_axis(signals, decision.candidates, "gih_wr"))
        iwd_target = argmax_policy(_signal_axis(signals, decision.candidates, "iwd"))
        q_target = argmax_policy(prediction.q_values)
        contextual_scores = value_model.scores(features)
        contextual_argmax_target = argmax_policy(contextual_scores)

        incumbent_observations.append(_observation(decision, prediction, incumbent_target))
        gih_observations.append(_observation(decision, prediction, gih_target))
        iwd_observations.append(_observation(decision, prediction, iwd_target))
        direct_q_observations.append(_observation(decision, prediction, q_target))
        contextual_argmax_observations.append(
            _observation(decision, prediction, contextual_argmax_target)
        )

        for label, observations in contextual_by_temperature:
            temperature = float(label.split("=", 1)[1])
            target = value_model.probabilities(features, temperature=temperature)
            observations.append(_observation(decision, prediction, target))

        for label, observations in blend_grid:
            left, right = label.split("|")
            lam = float(left.split("=")[1])
            weight = float(right.split("=")[1])
            target = argmax_policy(
                _simple_blend_values(
                    signals,
                    decision.candidates,
                    lam=lam,
                    weight=weight,
                )
            )
            observations.append(_observation(decision, prediction, target))

        if decision.event_match_wins == 7:
            trophy_rows.append({
                "selected": decision.selected_card,
                "incumbent": max(incumbent_target, key=incumbent_target.get),
                "gih": max(gih_target, key=gih_target.get),
                "iwd": max(iwd_target, key=iwd_target.get),
                "direct_q": max(q_target, key=q_target.get),
                "contextual_scores": contextual_scores,
            })

    selected_temperature, temperature_search = _best_validation_policy(contextual_by_temperature)
    selected_contextual = dict(contextual_by_temperature)[selected_temperature]
    selected_blend, blend_search = _best_validation_policy(blend_grid)
    selected_blend_observations = dict(blend_grid)[selected_blend]
    validation_contextual_ci = paired_dr_delta_ci(
        selected_contextual,
        incumbent_observations,
        weight_cap=WEIGHT_CAPS[1],
    )
    validation_contextual_argmax_ci = paired_dr_delta_ci(
        contextual_argmax_observations,
        incumbent_observations,
        weight_cap=WEIGHT_CAPS[1],
    )

    contextual_top_agreement = 0
    for row in trophy_rows:
        leader = min(
            row["contextual_scores"],
            key=lambda action: (-row["contextual_scores"][action], action),
        )
        contextual_top_agreement += int(leader == row["selected"])

    def agreement(name: str) -> float | None:
        if not trophy_rows:
            return None
        return sum(int(row[name] == row["selected"]) for row in trophy_rows) / len(trophy_rows)

    observed_assessment_count = len({row.draft_id for row in assessment})
    if assessment_draft_count is not None and assessment_draft_count < 0:
        raise ValueError("assessment_draft_count must be non-negative")
    report = {
        "scope": "development_only",
        "assessment_opened": False,
        "assessment_boundary": {
            "outcomes_loaded_into_pipeline": bool(assessment),
            "outcomes_used_for_fit": False,
            "outcomes_scored": False,
        },
        "drafts": {
            "train": len({row.draft_id for row in train}),
            "validation": len({row.draft_id for row in validation}),
            "assessment_withheld": (
                int(assessment_draft_count)
                if assessment_draft_count is not None
                else observed_assessment_count
            ),
            "validation_primary_ope": len(primary),
        },
        "diagnostics": {
            "outcome_q": {
                "train_oof": outcome_diagnostics(train, train_predictions),
                "validation": outcome_diagnostics(validation, validation_predictions),
            },
            "propensity": {
                "train_oof": propensity_diagnostics(train, train_predictions),
                "validation": propensity_diagnostics(validation, validation_predictions),
            },
            "overlap": {
                "A_current_v4_strong_player": policy_overlap_diagnostics(
                    incumbent_observations
                ),
                "G_contextual_value": policy_overlap_diagnostics(
                    selected_contextual
                ),
                "G_contextual_value_top_ranked_argmax_secondary": (
                    policy_overlap_diagnostics(contextual_argmax_observations)
                ),
            },
            "local_overlap": {
                "G_contextual_value": policy_overlap_slices(primary, selected_contextual),
                "G_contextual_value_top_ranked_argmax_secondary": (
                    policy_overlap_slices(primary, contextual_argmax_observations)
                ),
            },
            "stability_slices": {
                "G_contextual_value_vs_A": paired_policy_delta_slices(
                    primary,
                    selected_contextual,
                    incumbent_observations,
                    weight_cap=WEIGHT_CAPS[1],
                ),
                "G_top_ranked_argmax_vs_A": paired_policy_delta_slices(
                    primary,
                    contextual_argmax_observations,
                    incumbent_observations,
                    weight_cap=WEIGHT_CAPS[1],
                ),
            },
            "validation_selected_contextual_vs_v4_dr_ci95": validation_contextual_ci,
            "validation_top_ranked_argmax_vs_v4_dr_ci95": validation_contextual_argmax_ci,
            "validation_ci_is_selection_biased": True,
            "validation_ci_interpretation": (
                "exploratory development uncertainty after validation-visible model/policy choices; "
                "not a locked confirmatory assessment"
            ),
        },
        "policy_estimands": {
            "A_current_v4_strong_player": {
                "target_policy": "deterministic_argmax",
                "implementation": "leakage_safe_v4_style_strong_player_refit",
                "exact_deployed_model_snapshot": False,
                "note": (
                    "This comparator rebuilds the v4-style strong-player signal from the "
                    "research training complement; it is not evidence that the exact deployed "
                    "production model snapshot was evaluated."
                ),
            },
            "G_contextual_value_primary": {
                "target_policy": "temperature_softened_stochastic_policy",
                "note": (
                    "The frozen primary OPE estimates the selected stochastic target policy; "
                    "it does not by itself establish the value of always taking G's top-ranked card."
                ),
            },
            "G_contextual_value_top_ranked_argmax_secondary": {
                "target_policy": "deterministic_argmax_of_contextual_scores",
                "role": "secondary_development_diagnostic_not_primary_endpoint",
                "fallback_rule": "not_yet_frozen",
            },
        },
        "models": {
            "A_current_v4_strong_player": _estimate_by_cap(incumbent_observations),
            "B_historical_trophy_choice": {
                "mode": "agreement_only_not_same_record_ope",
                "drafts": len(trophy_rows),
                "agreement": {
                    "A_current_v4_strong_player": agreement("incumbent"),
                    "C_gih_only": agreement("gih"),
                    "D_iwd_only": agreement("iwd"),
                    "F_direct_q": agreement("direct_q"),
                    "G_contextual_value": (
                        contextual_top_agreement / len(trophy_rows)
                        if trophy_rows
                        else None
                    ),
                },
            },
            "C_gih_only": _estimate_by_cap(gih_observations),
            "D_iwd_only": _estimate_by_cap(iwd_observations),
            "E_simple_behavior_outcome_blend": {
                "selected_validation_config": selected_blend,
                "selected_estimates": _estimate_by_cap(selected_blend_observations),
                "search": blend_search,
            },
            "F_direct_q": _estimate_by_cap(direct_q_observations),
            "G_contextual_value": {
                "selected_validation_temperature": selected_temperature,
                "selected_estimates": _estimate_by_cap(selected_contextual),
                "search": temperature_search,
                "top_ranked_argmax_secondary": {
                    "role": "secondary_development_diagnostic_not_primary_endpoint",
                    "estimates": _estimate_by_cap(contextual_argmax_observations),
                    "vs_A_dr_ci95": validation_contextual_argmax_ci,
                    "fallback_rule": "not_yet_frozen",
                },
                "value_model": {
                    "training_drafts": value_model.training_draft_count,
                    "pseudo_outcome_weight_cap": value_model.training_weight_cap,
                    "l2": value_model.l2,
                },
            },
        },
    }
    return report, train_predictions, validation_predictions, value_model
