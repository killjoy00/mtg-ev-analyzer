#!/usr/bin/env python3
"""Focused freeze audit for the frozen H challenger in #529.

No model search occurs here. The script:
1. exactly reconstructs H from retained Phase A2 cross-fitted simple pseudo-values;
2. evaluates H/A under the frozen strong-offset-only nuisance;
3. swaps ONLY the behavior nuisance to the pre-existing no-strong-entirely fit;
4. adds draft-cluster bootstrap CIs to predeclared set/pick/skill/experience slices.

Assessment data is neither loaded nor scored.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path
from typing import Mapping, Sequence

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "research"))

from contextual_value.diagnostics import (
    describe,
    paired_dr_delta_ci,
    policy_overlap_diagnostics,
)
from contextual_value.dr import PolicyObservation, evaluate_policy
from contextual_value.propensity import support_threshold
from contextual_value_phase_a_bakeoff import (
    RIDGE_L2,
    WEIGHT_CAPS,
    _argmax_local,
    _experience_group,
    _fit_weighted_ridge,
    _load_train_shards,
    _minimal_decisions,
    _predict_ridge,
    _primary_indices,
    _skill_group,
)

BOOTSTRAP_REPLICATES = 1000
HARM_MARGIN = -0.05
EXPECTED_PRIMARY = 1218
EXPECTED_H_DELTA = {
    "dr": 0.31316527207364153,
    "direct": 0.020655834806143858,
    "snips": 0.31724896487612386,
    "ipw": 0.5333850129547921,
}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train-shard", action="append", type=Path, required=True)
    parser.add_argument("--train-report", action="append", type=Path, required=True)
    parser.add_argument("--validation-shard", type=Path, required=True)
    parser.add_argument("--validation-report", type=Path, required=True)
    parser.add_argument("--no-strong-predictions", type=Path, required=True)
    parser.add_argument("--no-strong-report", type=Path, required=True)
    parser.add_argument("--ablation-report", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    return parser.parse_args()


def _read_jsonl_gz(path: Path):
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def _estimate_by_cap(observations: Sequence[PolicyObservation]) -> dict:
    return {
        str(int(cap)): asdict(evaluate_policy(observations, cap))
        for cap in WEIGHT_CAPS
    }


def _delta(candidate, incumbent, cap: float = 20.0) -> dict:
    left = evaluate_policy(candidate, cap)
    right = evaluate_policy(incumbent, cap)
    return {
        "dr": left.dr - right.dr,
        "direct": left.direct - right.direct,
        "snips": left.snips - right.snips,
        "ipw": left.ipw - right.ipw,
    }


def _target_action(observation: PolicyObservation) -> str:
    return min(
        observation.target,
        key=lambda action: (-float(observation.target[action]), action),
    )


def _raw_policy_weight(observation: PolicyObservation) -> float:
    return (
        float(observation.target[observation.action])
        / float(observation.behavior[observation.action])
    )


def _bootstrap_mean_ci(
    values: Sequence[float],
    *,
    seed: int,
    replicates: int = BOOTSTRAP_REPLICATES,
) -> list[float]:
    array = np.asarray(values, dtype=np.float64)
    if array.size == 0:
        raise ValueError("bootstrap mean requires observations")
    if array.size == 1:
        return [float(array[0]), float(array[0])]
    rng = np.random.default_rng(seed)
    sampled = rng.integers(0, array.size, size=(replicates, array.size))
    means = np.mean(array[sampled], axis=1)
    return [
        float(np.quantile(means, 0.025)),
        float(np.quantile(means, 0.975)),
    ]


def _weight_normalization(
    observations: Sequence[PolicyObservation],
    *,
    seed: int,
) -> dict:
    weights = [_raw_policy_weight(row) for row in observations]
    ci = _bootstrap_mean_ci(weights, seed=seed)
    mean = float(np.mean(weights))
    return {
        "n": len(weights),
        "sum": float(np.sum(weights)),
        "mean": mean,
        "mean_minus_theoretical_one": mean - 1.0,
        "mean_ci95": ci,
        "ci95_contains_one": bool(ci[0] <= 1.0 <= ci[1]),
        "distribution": describe(weights),
    }


def _policy_action_calibration(
    observations: Sequence[PolicyObservation],
    *,
    seed: int,
) -> dict:
    predicted = np.asarray(
        [float(row.behavior[_target_action(row)]) for row in observations],
        dtype=np.float64,
    )
    observed = np.asarray(
        [1.0 if row.action == _target_action(row) else 0.0 for row in observations],
        dtype=np.float64,
    )
    gap = observed - predicted
    order = np.argsort(predicted, kind="stable")
    bins = []
    for bin_index, positions in enumerate(
        np.array_split(order, min(5, len(order))),
        start=1,
    ):
        if len(positions) == 0:
            continue
        bins.append({
            "bin": bin_index,
            "n": int(len(positions)),
            "predicted_mean": float(np.mean(predicted[positions])),
            "observed_frequency": float(np.mean(observed[positions])),
            "observed_minus_predicted": float(np.mean(gap[positions])),
            "predicted_min": float(np.min(predicted[positions])),
            "predicted_max": float(np.max(predicted[positions])),
        })
    return {
        "n": len(observations),
        "mean_predicted_probability": float(np.mean(predicted)),
        "observed_choice_frequency": float(np.mean(observed)),
        "observed_minus_predicted": float(np.mean(gap)),
        "gap_ci95": _bootstrap_mean_ci(gap, seed=seed),
        "brier": float(np.mean(np.square(gap))),
        "equal_count_bins": bins,
    }


def _stratified_propensity_diagnostics(
    decisions,
    observations: Sequence[PolicyObservation],
    *,
    seed: int,
) -> dict:
    if len(decisions) != len(observations):
        raise ValueError("stratified propensity inputs do not align")
    result = {}
    next_seed = seed
    for axis in ("set", "pick", "skill", "experience"):
        groups = defaultdict(list)
        for decision, observation in zip(decisions, observations):
            groups[_slice_label(decision, axis)].append(observation)
        result[axis] = {}
        for label, rows in sorted(groups.items()):
            next_seed += 2
            result[axis][label] = {
                "n": len(rows),
                "weight_normalization": _weight_normalization(
                    rows,
                    seed=next_seed,
                ),
                "policy_action_calibration": _policy_action_calibration(
                    rows,
                    seed=next_seed + 1,
                ),
            }
    return result


def _covariate_balance(
    decisions,
    observations: Sequence[PolicyObservation],
) -> dict:
    if len(decisions) != len(observations):
        raise ValueError("covariate balance inputs do not align")
    weights = np.asarray(
        [_raw_policy_weight(row) for row in observations],
        dtype=np.float64,
    )
    total_weight = float(np.sum(weights))
    if total_weight <= 0:
        raise ValueError("covariate balance requires positive total policy weight")
    result = {}
    for axis in ("set", "pick", "skill", "experience"):
        labels = [_slice_label(decision, axis) for decision in decisions]
        rows = {}
        absolute_gaps = []
        for label in sorted(set(labels)):
            mask = np.asarray([value == label for value in labels], dtype=bool)
            target_share = float(np.mean(mask))
            weighted_share = float(np.sum(weights[mask]) / total_weight)
            gap = weighted_share - target_share
            absolute_gaps.append(abs(gap))
            rows[label] = {
                "target_share": target_share,
                "ipw_weighted_share": weighted_share,
                "gap": gap,
            }
        result[axis] = {
            "categories": rows,
            "max_abs_gap": float(max(absolute_gaps) if absolute_gaps else 0.0),
            "total_variation": float(sum(absolute_gaps) / 2.0),
        }
    return result


def _dr_decomposition(
    candidate: Sequence[PolicyObservation],
    incumbent: Sequence[PolicyObservation],
    *,
    cap: float = 20.0,
) -> dict:
    left = evaluate_policy(candidate, cap)
    right = evaluate_policy(incumbent, cap)
    left_residual = left.dr - left.direct
    right_residual = right.dr - right.direct
    return {
        "cap": cap,
        "H": {
            "direct": left.direct,
            "residual_correction": left_residual,
            "dr": left.dr,
        },
        "A": {
            "direct": right.direct,
            "residual_correction": right_residual,
            "dr": right.dr,
        },
        "H_minus_A": {
            "direct": left.direct - right.direct,
            "residual_correction": left_residual - right_residual,
            "dr": left.dr - right.dr,
        },
    }


def _disagreement_support(
    candidate: Sequence[PolicyObservation],
    incumbent: Sequence[PolicyObservation],
    *,
    seed: int,
) -> dict:
    if len(candidate) != len(incumbent) or not candidate:
        raise ValueError("disagreement inputs must align and be non-empty")
    h_rows = []
    a_rows = []
    for left, right in zip(candidate, incumbent):
        if left.cluster != right.cluster:
            raise ValueError("disagreement observations do not share clusters")
        if _target_action(left) != _target_action(right):
            h_rows.append(left)
            a_rows.append(right)
    if not h_rows:
        return {
            "n": 0,
            "coverage": 0.0,
        }

    def support(rows, row_seed):
        probabilities = [
            float(row.behavior[_target_action(row)])
            for row in rows
        ]
        supported = [
            probability >= support_threshold(len(row.behavior))
            for row, probability in zip(rows, probabilities)
        ]
        estimate = evaluate_policy(rows, 20.0)
        return {
            "target_action_behavior_probability": describe(probabilities),
            "supported_fraction": float(np.mean(supported)),
            "weight_normalization": _weight_normalization(rows, seed=row_seed),
            "policy_action_calibration": _policy_action_calibration(
                rows,
                seed=row_seed + 1,
            ),
            "cap20_ess": estimate.ess,
            "cap20_ess_ratio": estimate.ess_ratio,
            "cap20_max_unclipped_weight": estimate.max_unclipped_weight,
        }

    coverage = len(h_rows) / len(candidate)
    conditional_delta = _delta(h_rows, a_rows)
    overall_delta = _delta(candidate, incumbent)
    weighted_back = {
        key: coverage * conditional_delta[key]
        for key in ("dr", "direct", "ipw")
    }
    crosscheck = max(
        abs(weighted_back[key] - overall_delta[key])
        for key in weighted_back
    )
    return {
        "n": len(h_rows),
        "coverage": coverage,
        "H": support(h_rows, seed),
        "A": support(a_rows, seed + 10),
        "conditional_H_minus_A_cap20": conditional_delta,
        "coverage_weighted_back_to_overall": weighted_back,
        "overall_H_minus_A_cap20": {
            key: overall_delta[key]
            for key in ("dr", "direct", "ipw")
        },
        "linear_metric_reweight_crosscheck_max_abs_error": crosscheck,
        "note": (
            "SNIPS is intentionally not coverage-weighted because its "
            "self-normalization is nonlinear."
        ),
    }


def _leave_one_draft_out_influence(
    candidate: Sequence[PolicyObservation],
    incumbent: Sequence[PolicyObservation],
    *,
    cap: float = 20.0,
) -> dict:
    if len(candidate) != len(incumbent) or len(candidate) < 2:
        raise ValueError("leave-one-out inputs must align with at least two rows")

    def contribution(row: PolicyObservation) -> float:
        direct = sum(
            float(row.target[action]) * float(row.q_values[action])
            for action in row.target
        )
        weight = min(_raw_policy_weight(row), cap)
        residual = float(row.outcome) - float(row.q_values[row.action])
        return direct + weight * residual

    contributions = np.asarray(
        [
            contribution(left) - contribution(right)
            for left, right in zip(candidate, incumbent)
        ],
        dtype=np.float64,
    )
    total = float(np.sum(contributions))
    n = len(contributions)
    overall = total / n
    expected = _delta(candidate, incumbent, cap)["dr"]
    if abs(overall - expected) > 1e-12:
        raise ValueError("leave-one-out DR contribution reconstruction failed")
    loo = (total - contributions) / (n - 1)
    changes = loo - overall
    absolute = np.abs(changes)
    top = np.argsort(-absolute)[:10]
    return {
        "n": n,
        "cap": cap,
        "overall_dr_delta": overall,
        "max_abs_change": float(np.max(absolute)),
        "abs_change_quantiles": {
            "p50": float(np.quantile(absolute, 0.50)),
            "p90": float(np.quantile(absolute, 0.90)),
            "p95": float(np.quantile(absolute, 0.95)),
            "p99": float(np.quantile(absolute, 0.99)),
        },
        "top_influence": [
            {
                "draft_cluster": str(candidate[int(index)].cluster),
                "paired_dr_contribution": float(contributions[index]),
                "leave_one_out_dr_delta": float(loo[index]),
                "change_from_overall": float(changes[index]),
            }
            for index in top
        ],
    }


def _evaluator_diagnostics(
    decisions,
    candidate: Sequence[PolicyObservation],
    incumbent: Sequence[PolicyObservation],
    *,
    seed: int,
) -> dict:
    return {
        "raw_importance_weight_normalization_target": 1.0,
        "normalization_interpretation": (
            "Under a correctly specified behavior propensity, the raw "
            "importance weight for any fixed target policy has expectation one."
        ),
        "H": {
            "weight_normalization": _weight_normalization(
                candidate,
                seed=seed,
            ),
            "policy_action_calibration": _policy_action_calibration(
                candidate,
                seed=seed + 1,
            ),
            "stratified": _stratified_propensity_diagnostics(
                decisions,
                candidate,
                seed=seed + 100,
            ),
            "covariate_balance": _covariate_balance(decisions, candidate),
        },
        "A": {
            "weight_normalization": _weight_normalization(
                incumbent,
                seed=seed + 2,
            ),
            "policy_action_calibration": _policy_action_calibration(
                incumbent,
                seed=seed + 3,
            ),
            "stratified": _stratified_propensity_diagnostics(
                decisions,
                incumbent,
                seed=seed + 200,
            ),
            "covariate_balance": _covariate_balance(decisions, incumbent),
        },
        "H_vs_A": {
            "dr_decomposition": _dr_decomposition(candidate, incumbent),
            "disagreement_support": _disagreement_support(
                candidate,
                incumbent,
                seed=seed + 300,
            ),
            "leave_one_draft_out_influence": _leave_one_draft_out_influence(
                candidate,
                incumbent,
            ),
        },
    }


def _behavior_predictions(path: Path) -> dict[str, dict]:
    result = {}
    for raw in _read_jsonl_gz(path):
        key = str(raw["decision_id"])
        if key in result:
            raise SystemExit("duplicate no-strong behavior prediction")
        result[key] = {
            "fold": int(raw["fold"]),
            "training_draft_count": int(raw["training_draft_count"]),
            "behavior": {str(k): float(v) for k, v in raw["behavior"].items()},
        }
    return result


def _observations(
    validation: Mapping[str, np.ndarray],
    primary: Sequence[int],
    chosen_ord: np.ndarray,
    behavior_by_decision: Mapping[str, Mapping[str, float]] | None = None,
):
    result = []
    offsets = validation["offsets"]
    candidate_names = validation["candidate_names"]
    for pos, decision_index in enumerate(primary):
        start, stop = int(offsets[decision_index]), int(offsets[decision_index + 1])
        names = [str(x) for x in candidate_names[start:stop]]
        decision_id = str(validation["decision_ids"][decision_index])
        if behavior_by_decision is None:
            behavior = {
                name: float(validation["behavior"][start + local])
                for local, name in enumerate(names)
            }
        else:
            source = behavior_by_decision.get(decision_id)
            if source is None:
                raise SystemExit(f"alternate behavior missing {decision_id}")
            if set(source) != set(names):
                raise SystemExit(f"alternate behavior candidate mismatch for {decision_id}")
            behavior = {name: float(source[name]) for name in names}

        total = sum(behavior.values())
        if abs(total - 1.0) > 1e-9 or any(value <= 0 for value in behavior.values()):
            raise SystemExit(f"invalid behavior distribution for {decision_id}")

        q_values = {
            name: float(validation["q_simple"][start + local])
            for local, name in enumerate(names)
        }
        selected = names[int(validation["selected_ord"][decision_index])]
        chosen = names[int(chosen_ord[pos])]
        target = {name: 1.0 if name == chosen else 0.0 for name in names}
        result.append(PolicyObservation(
            action=selected,
            outcome=float(validation["outcome"][decision_index]),
            behavior=behavior,
            target=target,
            q_values=q_values,
            cluster=str(validation["draft_ids"][decision_index]),
        ))
    return result


def _slice_label(decision, axis: str) -> str:
    if axis == "set":
        return decision.expansion or "unknown"
    if axis == "pick":
        return f"P{decision.pack_number + 1}P{decision.pick_number + 1}"
    if axis == "skill":
        return _skill_group(float(decision.user_game_win_rate))
    if axis == "experience":
        return _experience_group(int(decision.user_games_lower_bound))
    raise ValueError(axis)


def _slice_intervals(
    decisions,
    candidate: Sequence[PolicyObservation],
    incumbent: Sequence[PolicyObservation],
):
    if len(decisions) != len(candidate) or len(candidate) != len(incumbent):
        raise SystemExit("slice inputs do not align")
    by_draft = {row.draft_id: row for row in decisions}
    result = {}
    for axis in ("set", "pick", "skill", "experience"):
        groups = defaultdict(list)
        for left, right in zip(candidate, incumbent):
            if left.cluster is None or left.cluster != right.cluster:
                raise SystemExit("paired observations do not share draft cluster")
            decision = by_draft.get(str(left.cluster))
            if decision is None:
                raise SystemExit("slice observation missing primary decision")
            groups[_slice_label(decision, axis)].append((left, right))

        result[axis] = {}
        for label, pairs in sorted(groups.items()):
            left = [pair[0] for pair in pairs]
            right = [pair[1] for pair in pairs]
            delta = _delta(left, right)
            ci = paired_dr_delta_ci(
                left,
                right,
                weight_cap=20.0,
                replicates=BOOTSTRAP_REPLICATES,
                seed=20260925,
            )
            result[axis][label] = {
                "n": len(pairs),
                **delta,
                "dr_ci95": list(ci),
                "complete_ci_below_harm_margin": bool(ci[1] < HARM_MARGIN),
                "adequately_powered": None,
                "power_classification_reason": (
                    "the frozen protocol does not define a numeric adequate-power rule"
                ),
            }
    return result


def _ablation_reuse(ablation: Mapping[str, object]) -> dict:
    profiles = dict(ablation.get("ablations") or {})
    wanted = (
        "strong_offset_only",
        "no_strong_entirely",
        "no_deck_fit",
        "no_gih",
        "no_gnd",
        "no_iwd",
        "no_pool_context",
        "no_skill_controls",
    )
    reused = {}
    for name in wanted:
        row = profiles.get(name)
        if not isinstance(row, Mapping):
            continue
        reused[name] = {
            key: row[key]
            for key in (
                "G_argmax_minus_A_cap20",
                "G_argmax_ci95",
                "G_minus_A_cap20",
                "G_ci95",
                "q_validation",
                "propensity_validation",
            )
            if key in row
        }
    return reused


def main():
    args = parse_args()

    train = _load_train_shards(args.train_shard, args.train_report)
    data = np.load(args.validation_shard, allow_pickle=False)
    validation = {key: data[key] for key in data.files}
    validation_report = json.loads(args.validation_report.read_text(encoding="utf-8"))
    if int(validation_report.get("fold", 999)) != -1:
        raise SystemExit("validation shard/report is not fold -1")
    if validation_report.get("assessment_opened") is not False:
        raise SystemExit("validation report assessment boundary violation")
    if validation_report.get("assessment_outcomes_used") is not False:
        raise SystemExit("validation report assessment outcome violation")

    no_strong_report = json.loads(args.no_strong_report.read_text(encoding="utf-8"))
    if no_strong_report.get("scope") != "development_only":
        raise SystemExit("no-strong checkpoint is not development-only")
    if no_strong_report.get("profile") != "no_strong_entirely":
        raise SystemExit("wrong nuisance sensitivity checkpoint")
    if int(no_strong_report.get("fold", 999)) != -1:
        raise SystemExit("no-strong checkpoint is not validation fold")
    if no_strong_report.get("assessment_opened") is not False:
        raise SystemExit("no-strong checkpoint assessment violation")
    if no_strong_report.get("assessment_outcomes_used") is not False:
        raise SystemExit("no-strong checkpoint assessment outcome violation")

    # Refit the already-frozen H value layer exactly from retained OOF simple
    # pseudo-values. No hyperparameter or feature choice occurs here.
    counts = np.diff(train["offsets"]).astype(np.int64)
    row_weight = np.repeat(train["decision_weight"] / counts, counts)
    x_h = np.concatenate(
        [
            np.repeat(train["state_simple"], counts, axis=0),
            train["cand_simple"],
        ],
        axis=1,
    )
    h_intercept, h_coef = _fit_weighted_ridge(
        x_h,
        train["phi_simple"],
        row_weight,
        l2=RIDGE_L2,
    )

    primary = _primary_indices(validation)
    if len(primary) != EXPECTED_PRIMARY:
        raise SystemExit(
            f"expected {EXPECTED_PRIMARY} primary validation drafts, found {len(primary)}"
        )

    h_chosen = np.empty(len(primary), dtype=np.int16)
    incumbent_chosen = np.empty(len(primary), dtype=np.int16)
    h_action_order_by_draft: dict[str, tuple[str, ...]] = {}
    for pos, index in enumerate(primary):
        start, stop = int(validation["offsets"][index]), int(validation["offsets"][index + 1])
        names = validation["candidate_names"][start:stop]
        x = np.concatenate(
            [
                np.repeat(validation["state_simple"][index:index + 1], stop - start, axis=0),
                validation["cand_simple"][start:stop],
            ],
            axis=1,
        )
        scores = _predict_ridge(h_intercept, h_coef, x)
        h_chosen[pos] = _argmax_local(scores, names)
        cluster = str(validation["draft_ids"][index])
        order = sorted(
            range(len(scores)),
            key=lambda local: (-float(scores[local]), str(names[local])),
        )
        h_action_order_by_draft[cluster] = tuple(str(names[local]) for local in order)
        incumbent_chosen[pos] = int(validation["incumbent_ord"][index])

    baseline_h = _observations(validation, primary, h_chosen)
    baseline_a = _observations(validation, primary, incumbent_chosen)
    baseline_delta = _delta(baseline_h, baseline_a)
    reproduction_error = max(
        abs(float(baseline_delta[key]) - value)
        for key, value in EXPECTED_H_DELTA.items()
    )
    if reproduction_error > 1e-9:
        raise SystemExit(
            f"frozen H reproduction failed; max_abs_error={reproduction_error}"
        )

    alt_raw = _behavior_predictions(args.no_strong_predictions)
    validation_ids = {str(x) for x in validation["decision_ids"]}
    if set(alt_raw) != validation_ids:
        raise SystemExit("no-strong predictions do not exactly cover validation decisions")
    alt_behavior = {}
    expected_training_drafts = int(no_strong_report["training_drafts"])
    for decision_id, row in alt_raw.items():
        if int(row["fold"]) != -1:
            raise SystemExit("no-strong prediction fold mismatch")
        if int(row["training_draft_count"]) != expected_training_drafts:
            raise SystemExit(
                "no-strong training provenance mismatch: "
                f"prediction={row['training_draft_count']} "
                f"report={expected_training_drafts}"
            )
        alt_behavior[decision_id] = row["behavior"]

    sensitivity_h = _observations(
        validation, primary, h_chosen, behavior_by_decision=alt_behavior
    )
    sensitivity_a = _observations(
        validation, primary, incumbent_chosen, behavior_by_decision=alt_behavior
    )

    primary_decisions = _minimal_decisions(
        validation,
        primary,
        validation["candidate_names"],
        validation["offsets"],
    )
    baseline_slices = _slice_intervals(
        primary_decisions, baseline_h, baseline_a
    )
    baseline_evaluator = _evaluator_diagnostics(
        primary_decisions,
        baseline_h,
        baseline_a,
        seed=2026092600,
    )
    sensitivity_evaluator = _evaluator_diagnostics(
        primary_decisions,
        sensitivity_h,
        sensitivity_a,
        seed=2026092700,
    )

    baseline_ci = paired_dr_delta_ci(
        baseline_h,
        baseline_a,
        weight_cap=20.0,
        replicates=BOOTSTRAP_REPLICATES,
        seed=20260925,
    )
    sensitivity_ci = paired_dr_delta_ci(
        sensitivity_h,
        sensitivity_a,
        weight_cap=20.0,
        replicates=BOOTSTRAP_REPLICATES,
        seed=20260925,
    )

    ablation = json.loads(args.ablation_report.read_text(encoding="utf-8"))
    report = {
        "scope": "development_only",
        "phase": "H_freeze_core_audit",
        "frozen_H": {
            "behavior": "converged_strong_offset_only",
            "ranking_strong_player_features": False,
            "value_family": "ridge",
            "value_l2": RIDGE_L2,
            "target_policy": "deterministic_argmax",
            "added_context_interactions": False,
        },
        "assessment_opened": False,
        "assessment_boundary": {
            "outcomes_loaded_into_pipeline": False,
            "outcomes_used_for_fit": False,
            "outcomes_scored": False,
        },
        "benchmark_reproduction": {
            "expected_cap20_delta": EXPECTED_H_DELTA,
            "actual_cap20_delta": baseline_delta,
            "max_abs_error": reproduction_error,
            "passed": True,
        },
        "frozen_behavior": {
            "H": _estimate_by_cap(baseline_h),
            "A": _estimate_by_cap(baseline_a),
            "H_minus_A_cap20": {
                **baseline_delta,
                "dr_ci95": list(baseline_ci),
            },
            "H_overlap": policy_overlap_diagnostics(
                baseline_h,
                action_order_by_cluster=h_action_order_by_draft,
            ),
            "evaluator_diagnostics": baseline_evaluator,
        },
        "behavior_nuisance_sensitivity": {
            "alternate_nuisance": "no_strong_entirely",
            "selection_policy_changed": False,
            "q_values_changed": False,
            "only_behavior_propensity_changed": True,
            "H": _estimate_by_cap(sensitivity_h),
            "A": _estimate_by_cap(sensitivity_a),
            "H_minus_A_cap20": {
                **_delta(sensitivity_h, sensitivity_a),
                "dr_ci95": list(sensitivity_ci),
            },
            "H_overlap": policy_overlap_diagnostics(
                sensitivity_h,
                action_order_by_cluster=h_action_order_by_draft,
            ),
            "evaluator_diagnostics": sensitivity_evaluator,
        },
        "slice_uncertainty_frozen_behavior": baseline_slices,
        "environment_power": {
            "rule_defined_in_frozen_protocol": False,
            "classification": "unresolved",
            "harm_margin": HARM_MARGIN,
            "note": (
                "CIs are reported, but no set is labeled adequately powered because "
                "the frozen protocol provides no numeric power criterion."
            ),
        },
        "reused_prior_ablation_evidence": _ablation_reuse(ablation),
        "next_gate": {
            "core_freeze_audit_complete": True,
            "cached_evaluator_diagnostics_complete": True,
            "historical_ood_stress_required_eventually": True,
            "historical_ood_stress_next": False,
            "next_required": (
                "interpret propensity diagnostics and, if warranted, predeclare "
                "one bounded richer behavior-model comparison before OOD"
            ),
            "assessment_authorized": False,
        },
    }

    args.out.mkdir(parents=True, exist_ok=True)
    out = args.out / "h-freeze-core-audit.json"
    out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "benchmark": report["benchmark_reproduction"],
        "frozen_H": report["frozen_behavior"]["H_minus_A_cap20"],
        "no_strong_sensitivity": report["behavior_nuisance_sensitivity"]["H_minus_A_cap20"],
        "environment_power": report["environment_power"],
        "assessment_opened": report["assessment_opened"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
