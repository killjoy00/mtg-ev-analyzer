#!/usr/bin/env python3
"""Bounded rich-context behavior-nuisance correction for #529.

This experiment does not change H, A, Q, the cohort, or the split. It asks one
question: can already-built rich candidate-varying pre-pick context improve the
broad behavior propensity enough to make fixed-policy OPE more trustworthy?

The candidate nuisance is a proper variable-action-set multinomial correction:

    pi_rich(a|S) proportional to pi_frozen(a|S) * exp(x_rich(S,a)^T beta)

where pi_frozen is the already-frozen strong-offset-only behavior nuisance.
State-only additive terms are intentionally omitted because they cancel inside
a softmax. The 103 retained rich candidate features already include candidate-
pool fit and pack-relative context. Strong-player ranking features remain only
inside the frozen propensity offset, not in x_rich.

Model family and regularization are fixed before validation:
- weighted conditional softmax likelihood;
- candidate features standardized from the fit partition only;
- L2 = 1.0 on the standardized correction coefficients;
- L-BFGS-B, max 300 iterations and standardized-gradient tolerance 1e-4.
  This is a numerical-only correction after all five 200-iteration training
  fits reached max_iter with terminal max gradients 5.9e-5 to 1.33e-4;
  validation was still unopened. Model, regularization, features, and gate
  remain unchanged;
- no hyperparameter search.

A five-fold training-only gate is required before validation:
- aggregate held-fold selected-action NLL must improve over the frozen offset;
- at least 3/5 folds must improve;
- every fold fit must converge.

Assessment is never loaded or scored.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import sys
import time
from dataclasses import asdict
from pathlib import Path
from typing import Mapping, Sequence

import numpy as np
from scipy.optimize import minimize

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "research"))

from contextual_value.diagnostics import paired_dr_delta_ci
from contextual_value.dr import evaluate_policy
from contextual_value_phase_a_bakeoff import (
    RIDGE_L2,
    WEIGHT_CAPS,
    _argmax_local,
    _fit_weighted_ridge,
    _load_train_shards,
    _predict_ridge,
    _primary_indices,
)
from contextual_value_h_freeze_audit import (
    EXPECTED_H_DELTA,
    EXPECTED_PRIMARY,
    _delta,
    _evaluator_diagnostics,
    _observations,
)

CORRECTION_L2 = 1.0
MAX_ITER = 300
OPTIMIZER_GTOL = 1e-4
MIN_IMPROVED_FOLDS = 3
PROB_FLOOR = 1e-12


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train-shard", action="append", type=Path, required=True)
    parser.add_argument("--train-report", action="append", type=Path, required=True)
    parser.add_argument("--validation-shard", type=Path, required=True)
    parser.add_argument("--validation-report", type=Path, required=True)
    parser.add_argument("--behavior-prediction", action="append", type=Path, required=True)
    parser.add_argument("--behavior-report", action="append", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    return parser.parse_args()


def _read_jsonl_gz(path: Path):
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def _load_behavior(
    prediction_paths: Sequence[Path],
    report_paths: Sequence[Path],
) -> dict[int, dict[str, dict[str, float]]]:
    reports = {}
    for path in report_paths:
        row = json.loads(path.read_text(encoding="utf-8"))
        fold = int(row["fold"])
        if row.get("scope") != "development_only":
            raise SystemExit(f"behavior fold {fold} is not development-only")
        if row.get("profile") != "strong_offset_only":
            raise SystemExit(f"behavior fold {fold} is not strong_offset_only")
        if row.get("assessment_opened") is not False:
            raise SystemExit(f"behavior fold {fold} assessment violation")
        if row.get("assessment_outcomes_used") is not False:
            raise SystemExit(f"behavior fold {fold} assessment outcome violation")
        reports[fold] = row
    if set(reports) != {-1, 0, 1, 2, 3, 4}:
        raise SystemExit("behavior reports must be exactly folds -1,0,1,2,3,4")

    by_fold: dict[int, dict[str, dict[str, float]]] = {
        fold: {} for fold in reports
    }
    for path in prediction_paths:
        seen_folds = set()
        for raw in _read_jsonl_gz(path):
            fold = int(raw["fold"])
            if fold not in by_fold:
                raise SystemExit(f"unexpected behavior prediction fold {fold}")
            seen_folds.add(fold)
            key = str(raw["decision_id"])
            if key in by_fold[fold]:
                raise SystemExit(f"duplicate behavior prediction {key}")
            if int(raw["training_draft_count"]) != int(reports[fold]["training_drafts"]):
                raise SystemExit(f"behavior training provenance mismatch in fold {fold}")
            by_fold[fold][key] = {
                str(action): float(value)
                for action, value in raw["behavior"].items()
            }
        if len(seen_folds) != 1:
            raise SystemExit(f"behavior prediction file mixes folds: {path}")
    return by_fold


def _load_fold(path: Path, report_path: Path) -> dict:
    data = np.load(path, allow_pickle=False)
    if "fold" not in data.files or len(data["fold"]) != 1:
        raise SystemExit(f"fold shard missing scalar fold: {path}")
    fold = int(data["fold"][0])
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if int(report["fold"]) != fold:
        raise SystemExit(f"fold report mismatch for {fold}")
    if report.get("assessment_opened") is not False:
        raise SystemExit(f"fold {fold} assessment violation")
    return {
        "fold": fold,
        "data": {key: data[key] for key in data.files},
        "report": report,
    }


def _align_behavior(data: Mapping[str, np.ndarray], rows: Mapping[str, Mapping[str, float]]) -> np.ndarray:
    decision_ids = [str(x) for x in data["decision_ids"]]
    if set(decision_ids) != set(rows):
        missing = sorted(set(decision_ids) - set(rows))[:3]
        extra = sorted(set(rows) - set(decision_ids))[:3]
        raise SystemExit(f"behavior coverage mismatch missing={missing} extra={extra}")
    offsets = data["offsets"]
    names = data["candidate_names"]
    result = np.empty(len(names), dtype=np.float64)
    for index, decision_id in enumerate(decision_ids):
        start, stop = int(offsets[index]), int(offsets[index + 1])
        offered = [str(value) for value in names[start:stop]]
        source = rows[decision_id]
        if set(offered) != set(source):
            raise SystemExit(f"behavior candidate mismatch for {decision_id}")
        for local, action in enumerate(offered):
            result[start + local] = float(source[action])
        if abs(float(np.sum(result[start:stop])) - 1.0) > 1e-9:
            raise SystemExit(f"behavior probabilities do not sum to one for {decision_id}")
        if np.any(result[start:stop] <= 0):
            raise SystemExit(f"behavior probability is non-positive for {decision_id}")
    return result


def _choice_metrics(data: Mapping[str, np.ndarray], behavior: np.ndarray) -> dict:
    offsets = data["offsets"].astype(np.int64)
    selected_ord = data["selected_ord"].astype(np.int64)
    decision_weight = data["decision_weight"].astype(np.float64)
    selected = offsets[:-1] + selected_ord
    selected_probability = np.clip(behavior[selected], PROB_FLOOR, 1.0)
    weighted_nll = float(
        np.sum(decision_weight * -np.log(selected_probability))
        / np.sum(decision_weight)
    )
    weighted_selected_probability = float(
        np.sum(decision_weight * selected_probability)
        / np.sum(decision_weight)
    )
    top1 = []
    for index in range(len(selected_ord)):
        start, stop = int(offsets[index]), int(offsets[index + 1])
        local = int(np.argmax(behavior[start:stop]))
        top1.append(1.0 if local == int(selected_ord[index]) else 0.0)
    weighted_top1 = float(
        np.sum(decision_weight * np.asarray(top1, dtype=np.float64))
        / np.sum(decision_weight)
    )
    return {
        "decisions": int(len(selected_ord)),
        "total_decision_weight": float(np.sum(decision_weight)),
        "selected_action_nll": weighted_nll,
        "mean_selected_probability": weighted_selected_probability,
        "top1_accuracy": weighted_top1,
    }


def _combine(folds: Sequence[dict]) -> dict:
    folds = sorted(folds, key=lambda row: row["fold"])
    candidate_names = np.concatenate([row["data"]["candidate_names"] for row in folds])
    cand_rich = np.concatenate([row["data"]["cand_rich"] for row in folds], axis=0)
    decision_weight = np.concatenate([row["data"]["decision_weight"] for row in folds])
    selected_ord = np.concatenate([row["data"]["selected_ord"] for row in folds]).astype(np.int64)
    counts = np.concatenate([
        np.diff(row["data"]["offsets"]).astype(np.int64)
        for row in folds
    ])
    offsets = np.zeros(len(counts) + 1, dtype=np.int64)
    offsets[1:] = np.cumsum(counts)
    behavior = np.concatenate([row["baseline_behavior"] for row in folds])
    if int(offsets[-1]) != len(candidate_names):
        raise SystemExit("combined offsets do not cover candidate rows")
    return {
        "cand_rich": cand_rich,
        "candidate_names": candidate_names,
        "decision_weight": decision_weight,
        "selected_ord": selected_ord,
        "offsets": offsets,
        "behavior": behavior,
    }


def _standardizer(data: Mapping[str, np.ndarray]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    x = data["cand_rich"].astype(np.float32, copy=False)
    counts = np.diff(data["offsets"]).astype(np.int64)
    decision_weight = data["decision_weight"].astype(np.float64)
    row_weight = np.repeat(decision_weight / counts, counts)
    total = float(np.sum(row_weight))
    mean = np.asarray(x.T @ row_weight / total, dtype=np.float64)
    second = np.asarray(
        np.einsum("ij,i,ij->j", x, row_weight, x, optimize=True) / total,
        dtype=np.float64,
    )
    variance = np.maximum(0.0, second - np.square(mean))
    scale = np.sqrt(variance)
    active = scale > 1e-8
    if not np.any(active):
        raise SystemExit("rich behavior correction has no varying candidate features")
    scale = np.where(active, scale, 1.0)
    return mean, scale, active


def _standardized_matrix(
    data: Mapping[str, np.ndarray],
    mean: np.ndarray,
    scale: np.ndarray,
    active: np.ndarray,
) -> np.ndarray:
    return (
        (data["cand_rich"][:, active].astype(np.float64) - mean[active])
        / scale[active]
    ).astype(np.float32)


def _softmax_by_decision(scores: np.ndarray, offsets: np.ndarray) -> np.ndarray:
    counts = np.diff(offsets).astype(np.int64)
    peaks = np.maximum.reduceat(scores, offsets[:-1])
    shifted = scores - np.repeat(peaks, counts)
    exp_score = np.exp(shifted)
    denominator = np.add.reduceat(exp_score, offsets[:-1])
    result = exp_score / np.repeat(denominator, counts)
    if np.any(~np.isfinite(result)) or np.any(result <= 0):
        raise SystemExit("invalid corrected behavior probability")
    return result


def _fit_correction(data: Mapping[str, np.ndarray]) -> dict:
    started = time.perf_counter()
    mean, scale, active = _standardizer(data)
    x = _standardized_matrix(data, mean, scale, active)
    offsets = data["offsets"].astype(np.int64)
    counts = np.diff(offsets).astype(np.int64)
    selected_ord = data["selected_ord"].astype(np.int64)
    selected = offsets[:-1] + selected_ord
    decision_weight = data["decision_weight"].astype(np.float64)
    total_weight = float(np.sum(decision_weight))
    row_decision_weight = np.repeat(decision_weight, counts)
    base_log = np.log(np.clip(data["behavior"], PROB_FLOOR, 1.0))

    def objective(beta: np.ndarray):
        correction = x @ beta
        scores = base_log + correction
        peaks = np.maximum.reduceat(scores, offsets[:-1])
        shifted = scores - np.repeat(peaks, counts)
        exp_score = np.exp(shifted)
        denominator = np.add.reduceat(exp_score, offsets[:-1])
        log_normalizer = peaks + np.log(denominator)
        loss = float(
            np.sum(decision_weight * (log_normalizer - scores[selected]))
            / total_weight
            + 0.5 * CORRECTION_L2 * float(beta @ beta) / total_weight
        )
        probability = exp_score / np.repeat(denominator, counts)
        gradient = (
            x.T @ (row_decision_weight * probability)
            - x[selected].T @ decision_weight
        ) / total_weight
        gradient = np.asarray(
            gradient + CORRECTION_L2 * beta / total_weight,
            dtype=np.float64,
        )
        return loss, gradient

    initial = np.zeros(int(np.sum(active)), dtype=np.float64)
    result = minimize(
        objective,
        initial,
        method="L-BFGS-B",
        jac=True,
        options={
            "maxiter": MAX_ITER,
            "ftol": 1e-9,
            "gtol": OPTIMIZER_GTOL,
            "maxls": 20,
        },
    )
    return {
        "beta": np.asarray(result.x, dtype=np.float64),
        "mean": mean,
        "scale": scale,
        "active": active,
        "converged": bool(result.success),
        "status": int(result.status),
        "message": str(result.message),
        "iterations": int(result.nit),
        "objective": float(result.fun),
        "gradient_max_abs": float(np.max(np.abs(result.jac))) if len(result.jac) else 0.0,
        "elapsed_seconds": time.perf_counter() - started,
    }


def _predict_correction(
    model: Mapping[str, object],
    data: Mapping[str, np.ndarray],
    baseline_behavior: np.ndarray,
) -> np.ndarray:
    x = _standardized_matrix(
        data,
        model["mean"],
        model["scale"],
        model["active"],
    )
    scores = (
        np.log(np.clip(baseline_behavior, PROB_FLOOR, 1.0))
        + x @ model["beta"]
    )
    return _softmax_by_decision(scores, data["offsets"].astype(np.int64))


def _aggregate_cv(rows: Sequence[dict]) -> dict:
    total_weight = sum(row["baseline"]["total_decision_weight"] for row in rows)
    baseline_nll = sum(
        row["baseline"]["selected_action_nll"] * row["baseline"]["total_decision_weight"]
        for row in rows
    ) / total_weight
    corrected_nll = sum(
        row["corrected"]["selected_action_nll"] * row["corrected"]["total_decision_weight"]
        for row in rows
    ) / total_weight
    improved = sum(
        row["corrected"]["selected_action_nll"] < row["baseline"]["selected_action_nll"]
        for row in rows
    )
    converged = all(row["fit"]["converged"] for row in rows)
    return {
        "total_decision_weight": total_weight,
        "baseline_selected_action_nll": baseline_nll,
        "corrected_selected_action_nll": corrected_nll,
        "nll_improvement": baseline_nll - corrected_nll,
        "improved_folds": int(improved),
        "required_improved_folds": MIN_IMPROVED_FOLDS,
        "all_fits_converged": converged,
        "gate_passed": bool(
            converged
            and corrected_nll < baseline_nll
            and improved >= MIN_IMPROVED_FOLDS
        ),
    }


def _estimate_by_cap(observations) -> dict:
    return {
        str(int(cap)): asdict(evaluate_policy(observations, cap))
        for cap in WEIGHT_CAPS
    }


def _behavior_map(
    data: Mapping[str, np.ndarray],
    behavior: np.ndarray,
) -> dict[str, dict[str, float]]:
    result = {}
    offsets = data["offsets"]
    names = data["candidate_names"]
    for index, decision_id_raw in enumerate(data["decision_ids"]):
        start, stop = int(offsets[index]), int(offsets[index + 1])
        offered = [str(value) for value in names[start:stop]]
        result[str(decision_id_raw)] = {
            action: float(behavior[start + local])
            for local, action in enumerate(offered)
        }
    return result


def _fixed_h_actions(train, validation, primary):
    counts = np.diff(train["offsets"]).astype(np.int64)
    row_weight = np.repeat(train["decision_weight"] / counts, counts)
    x_h = np.concatenate(
        [
            np.repeat(train["state_simple"], counts, axis=0),
            train["cand_simple"],
        ],
        axis=1,
    )
    intercept, coef = _fit_weighted_ridge(
        x_h,
        train["phi_simple"],
        row_weight,
        l2=RIDGE_L2,
    )
    h_chosen = np.empty(len(primary), dtype=np.int16)
    a_chosen = np.empty(len(primary), dtype=np.int16)
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
        h_chosen[pos] = _argmax_local(_predict_ridge(intercept, coef, x), names)
        a_chosen[pos] = int(validation["incumbent_ord"][index])
    return h_chosen, a_chosen


def _policy_eval(
    primary_decisions,
    h_rows,
    a_rows,
) -> dict:
    delta = _delta(h_rows, a_rows)
    return {
        "H": _estimate_by_cap(h_rows),
        "A": _estimate_by_cap(a_rows),
        "H_minus_A_cap20": {
            **delta,
            "dr_ci95": list(paired_dr_delta_ci(
                h_rows,
                a_rows,
                weight_cap=20.0,
                replicates=1000,
                seed=20260925,
            )),
        },
        "evaluator_diagnostics": _evaluator_diagnostics(
            primary_decisions,
            h_rows,
            a_rows,
            seed=2026092800,
        ),
    }


def main():
    args = parse_args()
    started = time.perf_counter()

    report_by_fold = {}
    for path in args.train_report:
        raw = json.loads(path.read_text(encoding="utf-8"))
        report_by_fold[int(raw["fold"])] = path
    if set(report_by_fold) != {0, 1, 2, 3, 4}:
        raise SystemExit("training reports must be exactly folds 0..4")

    folds = {}
    for path in args.train_shard:
        data = np.load(path, allow_pickle=False)
        fold = int(data["fold"][0])
        folds[fold] = _load_fold(path, report_by_fold[fold])
    if set(folds) != {0, 1, 2, 3, 4}:
        raise SystemExit("training shards must be exactly folds 0..4")

    validation_loaded = _load_fold(args.validation_shard, args.validation_report)
    if validation_loaded["fold"] != -1:
        raise SystemExit("validation shard is not fold -1")
    validation = validation_loaded["data"]
    candidate_feature_count = int(
        validation_loaded["report"]["candidate_feature_count"]
    )
    candidate_feature_names = [
        f"candidate_feature_index:{index}"
        for index in range(candidate_feature_count)
    ]
    if validation["cand_rich"].shape[1] != candidate_feature_count:
        raise SystemExit("validation rich candidate feature schema mismatch")
    for fold, row in folds.items():
        if int(row["report"]["candidate_feature_count"]) != candidate_feature_count:
            raise SystemExit(f"candidate feature count differs in fold {fold}")

    behavior = _load_behavior(args.behavior_prediction, args.behavior_report)
    for fold, row in folds.items():
        row["baseline_behavior"] = _align_behavior(row["data"], behavior[fold])

    validation_artifact_behavior = _align_behavior(validation, behavior[-1])
    if np.max(np.abs(validation_artifact_behavior - validation["behavior"])) > 1e-12:
        raise SystemExit("validation frozen behavior does not reproduce Phase A2 shard")
    baseline_validation = validation["behavior"].astype(np.float64)

    cv_rows = []
    for held_fold in range(5):
        fit_data = _combine([
            row for fold, row in folds.items() if fold != held_fold
        ])
        held = folds[held_fold]
        model = _fit_correction(fit_data)
        corrected = _predict_correction(
            model,
            held["data"],
            held["baseline_behavior"],
        )
        cv_rows.append({
            "fold": held_fold,
            "baseline": _choice_metrics(held["data"], held["baseline_behavior"]),
            "corrected": _choice_metrics(held["data"], corrected),
            "fit": {
                key: value
                for key, value in model.items()
                if key not in {"beta", "mean", "scale", "active"}
            },
        })
        print(json.dumps({
            "held_fold": held_fold,
            "baseline_nll": cv_rows[-1]["baseline"]["selected_action_nll"],
            "corrected_nll": cv_rows[-1]["corrected"]["selected_action_nll"],
            "converged": model["converged"],
            "iterations": model["iterations"],
            "elapsed_seconds": model["elapsed_seconds"],
        }, sort_keys=True), flush=True)

    training_gate = _aggregate_cv(cv_rows)
    report = {
        "scope": "development_only",
        "phase": "rich_behavior_propensity_correction",
        "assessment_opened": False,
        "assessment_boundary": {
            "outcomes_loaded_into_pipeline": False,
            "outcomes_used_for_fit": False,
            "outcomes_scored": False,
        },
        "frozen_spec": {
            "base_nuisance": "strong_offset_only",
            "correction_family": "conditional_softmax_exponential_tilt",
            "correction_features": "103 retained rich candidate features",
            "state_only_features": "excluded because additive softmax terms cancel",
            "ranking_strong_player_features_in_correction": False,
            "strong_player_information_location": "frozen behavior probability offset only",
            "l2": CORRECTION_L2,
            "optimizer": "L-BFGS-B",
            "max_iter": MAX_ITER,
            "optimizer_gtol": OPTIMIZER_GTOL,
            "hyperparameter_search": False,
            "training_gate": (
                "aggregate five-fold training-only NLL improves, at least "
                "3/5 folds improve, and all fits converge"
            ),
            "H_actions_changed": False,
            "A_actions_changed": False,
            "q_values_changed": False,
        },
        "training_only_crossfit": {
            "folds": cv_rows,
            "aggregate": training_gate,
        },
    }

    if training_gate["gate_passed"]:
        all_train = _combine(list(folds.values()))
        final_model = _fit_correction(all_train)
        if not final_model["converged"]:
            report["training_only_crossfit"]["aggregate"]["gate_passed"] = False
            report["training_only_crossfit"]["aggregate"]["final_fit_converged"] = False
        else:
            corrected_validation = _predict_correction(
                final_model,
                validation,
                baseline_validation,
            )
            baseline_choice = _choice_metrics(validation, baseline_validation)
            corrected_choice = _choice_metrics(validation, corrected_validation)

            train = _load_train_shards(args.train_shard, args.train_report)
            primary = _primary_indices(validation)
            if len(primary) != EXPECTED_PRIMARY:
                raise SystemExit(
                    f"expected {EXPECTED_PRIMARY} validation primary drafts, found {len(primary)}"
                )
            h_chosen, a_chosen = _fixed_h_actions(train, validation, primary)
            baseline_h = _observations(validation, primary, h_chosen)
            baseline_a = _observations(validation, primary, a_chosen)
            reproduction = _delta(baseline_h, baseline_a)
            reproduction_error = max(
                abs(float(reproduction[key]) - EXPECTED_H_DELTA[key])
                for key in EXPECTED_H_DELTA
            )
            if reproduction_error > 1e-9:
                raise SystemExit(
                    f"frozen H reproduction failed: {reproduction_error}"
                )

            corrected_map = _behavior_map(validation, corrected_validation)
            corrected_h = _observations(
                validation,
                primary,
                h_chosen,
                behavior_by_decision=corrected_map,
            )
            corrected_a = _observations(
                validation,
                primary,
                a_chosen,
                behavior_by_decision=corrected_map,
            )
            from contextual_value_phase_a_bakeoff import _minimal_decisions
            primary_decisions = _minimal_decisions(
                validation,
                primary,
                validation["candidate_names"],
                validation["offsets"],
            )

            active_indices = np.flatnonzero(final_model["active"])
            coefficient_rows = sorted(
                [
                    {
                        "feature": candidate_feature_names[int(index)],
                        "standardized_beta": float(final_model["beta"][pos]),
                    }
                    for pos, index in enumerate(active_indices)
                ],
                key=lambda row: abs(row["standardized_beta"]),
                reverse=True,
            )[:20]

            report["validation_behavior_prediction"] = {
                "baseline": baseline_choice,
                "rich_correction": corrected_choice,
                "selected_action_nll_improvement": (
                    baseline_choice["selected_action_nll"]
                    - corrected_choice["selected_action_nll"]
                ),
            }
            report["fixed_policy_evaluation"] = {
                "frozen_behavior": _policy_eval(
                    primary_decisions,
                    baseline_h,
                    baseline_a,
                ),
                "rich_corrected_behavior": _policy_eval(
                    primary_decisions,
                    corrected_h,
                    corrected_a,
                ),
                "H_reproduction_max_abs_error": reproduction_error,
            }
            report["final_correction_fit"] = {
                "converged": final_model["converged"],
                "status": final_model["status"],
                "message": final_model["message"],
                "iterations": final_model["iterations"],
                "objective": final_model["objective"],
                "gradient_max_abs": final_model["gradient_max_abs"],
                "elapsed_seconds": final_model["elapsed_seconds"],
                "active_feature_count": int(np.sum(final_model["active"])),
                "candidate_feature_count": len(candidate_feature_names),
                "feature_name_source": (
                    "A2 shard column index; the A2 fold report retains the frozen "
                    "feature count/order but not the full 103 candidate names"
                ),
                "top_standardized_coefficients": coefficient_rows,
            }

    report["interpretation_boundary"] = (
        "This experiment evaluates behavior-nuisance representation for fixed H/A "
        "policies. A favorable H-A policy-effect CI is not a selection criterion. "
        "Behavior choice prediction, calibration, raw-weight normalization, balance, "
        "and sensitivity coherence determine whether the nuisance is more credible."
    )
    report["next_gate"] = {
        "assessment_authorized": False,
        "historical_ood_stress_next": False,
        "behavior_nuisance_question_resolved": bool(
            report.get("fixed_policy_evaluation")
        ),
    }
    report["elapsed_seconds"] = time.perf_counter() - started

    args.out.mkdir(parents=True, exist_ok=True)
    out = args.out / "rich-behavior-correction-report.json"
    out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "training_gate": report["training_only_crossfit"]["aggregate"],
        "validation_behavior_prediction": report.get("validation_behavior_prediction"),
        "fixed_policy_deltas": (
            {
                key: value["H_minus_A_cap20"]
                for key, value in report["fixed_policy_evaluation"].items()
                if isinstance(value, dict) and "H_minus_A_cap20" in value
            }
            if "fixed_policy_evaluation" in report
            else None
        ),
        "assessment_opened": report["assessment_opened"],
        "elapsed_seconds": report["elapsed_seconds"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
