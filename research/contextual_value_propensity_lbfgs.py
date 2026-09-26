#!/usr/bin/env python3
"""Training-only L-BFGS convergence audit for contextual-value-v1 propensity.

Uses the exact retained fold -1 training feature rows and validation cohort from
the first successful core-pool run. Optimizer stopping is based only on the
penalized training objective/gradient. Validation is diagnostic after fitting.
Assessment outcomes are never serialized or read.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import statistics
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import scipy
from scipy.optimize import minimize

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from contextual_value.archive import ArchiveSignalProvider
from contextual_value.checkpoint import draft_id_sha256, load_preprocessed_cohort
from contextual_value.dataset import draft_split, normalized_draft_weights
from contextual_value.features import model_feature_map, strong_choice_offsets
from contextual_value.nuisance import NuisanceTrainingRow
from contextual_value.propensity import LinearSoftmaxPropensityModel, PropensityExample
from contextual_value.schema import file_sha256

CORE = ("MSH", "SOS", "ECL", "TLA")
SCIPY_VERSION = "1.18.1"
L2 = 1.0
GTOL = 1e-6
FTOL = 1e-12
MAXITER = 500
MAXLS = 50


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cohort-dir", type=Path, required=True)
    parser.add_argument("--feature-shard", action="append", type=Path, required=True)
    parser.add_argument("--validation-nuisance", type=Path, required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--out", type=Path, required=True)
    return parser.parse_args()


def _meta_path(path: Path) -> Path:
    return path.with_name(path.name.replace(".jsonl.gz", ".meta.json"))


def _load_source_cohort(root: Path, source_sha: str):
    raw = json.loads((root / "cohort-manifest.json").read_text(encoding="utf-8"))
    if raw.get("code_revision") != source_sha:
        raise SystemExit("cohort source revision does not match requested source SHA")
    if raw.get("assessment_outcomes_serialized") is not False:
        raise SystemExit("assessment outcomes were serialized in source cohort")

    prior = os.environ.pop("GITHUB_SHA", None)
    try:
        decisions, games, manifest = load_preprocessed_cohort(root)
    finally:
        if prior is not None:
            os.environ["GITHUB_SHA"] = prior

    if any(draft_split(row.draft_id) == "assessment" for row in decisions):
        raise SystemExit("assessment decision entered development cohort")
    return decisions, games, manifest


def _read_feature_rows(paths, manifest, source_sha, training_ids, validation_ids):
    rows = []
    seen = set()
    expected_training_hash = draft_id_sha256(training_ids)
    expected_held_hash = draft_id_sha256(validation_ids)
    for path in paths:
        meta = json.loads(_meta_path(path).read_text(encoding="utf-8"))
        expansion = meta.get("expansion")
        if expansion not in CORE or expansion in seen:
            raise SystemExit(f"invalid or duplicate feature shard expansion: {expansion!r}")
        checks = {
            "kind": "nuisance_training_features",
            "cohort_id": manifest["cohort_id"],
            "selected_drafts_sha256": manifest["selected_drafts_sha256"],
            "code_revision": source_sha,
            "fold": -1,
            "training_drafts_sha256": expected_training_hash,
            "held_drafts_sha256": expected_held_hash,
            "payload_sha256": file_sha256(path),
        }
        for key, value in checks.items():
            if meta.get(key) != value:
                raise SystemExit(f"{path}: incompatible {key}")
        before = len(rows)
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    rows.append(NuisanceTrainingRow(**json.loads(line)))
        if len(rows) - before != int(meta.get("row_count", -1)):
            raise SystemExit(f"{path}: row-count mismatch")
        seen.add(expansion)

    if seen != set(CORE):
        raise SystemExit(f"incomplete core feature shards: {sorted(set(CORE) - seen)}")
    if {row.draft_id for row in rows} != set(training_ids):
        raise SystemExit("feature rows do not cover full training draft complement")
    return rows


def _read_retained_validation(path, manifest, source_sha, training_ids, validation_ids):
    meta = json.loads(_meta_path(path).read_text(encoding="utf-8"))
    checks = {
        "kind": "nuisance_predictions",
        "cohort_id": manifest["cohort_id"],
        "selected_drafts_sha256": manifest["selected_drafts_sha256"],
        "code_revision": source_sha,
        "fold": -1,
        "training_drafts_sha256": draft_id_sha256(training_ids),
        "held_drafts_sha256": draft_id_sha256(validation_ids),
        "payload_sha256": file_sha256(path),
    }
    for key, value in checks.items():
        if meta.get(key) != value:
            raise SystemExit(f"{path}: incompatible retained nuisance {key}")

    rows = {}
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            item = json.loads(line)
            if item["decision_id"] in rows:
                raise SystemExit("duplicate retained validation decision")
            rows[item["decision_id"]] = item
    if len(rows) != int(meta.get("row_count", -1)):
        raise SystemExit("retained validation row-count mismatch")
    return rows


def _examples(rows):
    return [
        PropensityExample(
            features=row.features,
            selected_action=row.selected_action,
            sample_weight=row.sample_weight,
            offsets=row.offsets,
        )
        for row in rows
    ]


def _compile(examples):
    for example in examples:
        example.validate()
    names = tuple(sorted({
        name
        for example in examples
        for action in example.features.values()
        for name in action
    }))
    name_at = {name: index for index, name in enumerate(names)}
    total_weight = sum(example.sample_weight for example in examples)
    if total_weight <= 0:
        raise ValueError("positive total sample weight is required")

    compiled = []
    for example in examples:
        actions = tuple(example.features)
        selected_index = actions.index(example.selected_action)
        sparse_rows = tuple(
            tuple(
                (name_at[name], float(value))
                for name, value in example.features[action].items()
                if float(value) != 0.0
            )
            for action in actions
        )
        offsets = tuple(
            float(example.offsets[action]) if example.offsets is not None else 0.0
            for action in actions
        )
        compiled.append((
            float(example.sample_weight),
            selected_index,
            sparse_rows,
            offsets,
        ))
    return names, compiled, float(total_weight)


def _objective_gradient(beta, compiled, total_weight, l2):
    beta = np.asarray(beta, dtype=np.float64)
    nll = 0.0
    gradient = np.zeros(beta.shape[0], dtype=np.float64)

    for sample_weight, selected_index, sparse_rows, offsets in compiled:
        scores = []
        for offset, row in zip(offsets, sparse_rows):
            score = offset
            for index, value in row:
                score += beta[index] * value
            scores.append(score)
        peak = max(scores)
        action_weights = [math.exp(score - peak) for score in scores]
        denominator = sum(action_weights)
        log_denominator = peak + math.log(denominator)
        nll += sample_weight * (log_denominator - scores[selected_index])

        for action_index, row in enumerate(sparse_rows):
            probability = action_weights[action_index] / denominator
            residual = probability - (1.0 if action_index == selected_index else 0.0)
            scale = sample_weight * residual
            for index, value in row:
                gradient[index] += scale * value

    nll += 0.5 * l2 * float(np.dot(beta, beta))
    gradient += l2 * beta
    return nll / total_weight, gradient / total_weight


def _gradient_self_check(examples):
    sample = examples[: min(20, len(examples))]
    names, compiled, total_weight = _compile(sample)
    beta = np.asarray([
        (index + 1) * 0.001
        for index in range(len(names))
    ], dtype=np.float64)
    objective, analytic = _objective_gradient(beta, compiled, total_weight, L2)
    epsilon = 1e-6
    checked = min(8, len(beta))
    worst = 0.0
    for index in range(checked):
        plus = beta.copy()
        minus = beta.copy()
        plus[index] += epsilon
        minus[index] -= epsilon
        f_plus, _ = _objective_gradient(plus, compiled, total_weight, L2)
        f_minus, _ = _objective_gradient(minus, compiled, total_weight, L2)
        numeric = (f_plus - f_minus) / (2.0 * epsilon)
        worst = max(worst, abs(float(analytic[index]) - numeric))
    if worst > 2e-6:
        raise AssertionError(f"analytic gradient self-check failed: {worst}")
    return {"objective": objective, "checked_coordinates": checked, "max_abs_error": worst}


def _prepare_validation(decisions, games, training_ids):
    provider = ArchiveSignalProvider(decisions, games)
    validation = [
        row for row in decisions
        if draft_split(row.draft_id) == "validation"
    ]
    draft_weights = normalized_draft_weights(validation)
    prepared = []
    total = len(validation)
    for index, decision in enumerate(validation, start=1):
        signals = provider(decision, training_ids)
        prepared.append({
            "decision_id": decision.decision_id,
            "draft_id": decision.draft_id,
            "skill": (
                "<0.50"
                if decision.user_game_win_rate < 0.50
                else (
                    "0.50-<0.60"
                    if decision.user_game_win_rate < 0.60
                    else ">=0.60"
                )
            ),
            "features": model_feature_map(decision, signals),
            "offsets": strong_choice_offsets(signals, decision.candidates),
            "selected_action": decision.selected_card,
            "sample_weight": float(draft_weights[decision.decision_id]),
        })
        if index % 5000 == 0 or index == total:
            print(json.dumps({
                "event": "validation_feature_progress",
                "completed_decisions": index,
                "total_decisions": total,
            }), flush=True)
    return prepared


def _validation_metrics(model, prepared, retained=None):
    losses = []
    weighted_loss = 0.0
    top1 = []
    selected_probabilities = []
    by_skill = defaultdict(list)
    for row in prepared:
        if retained is None:
            probabilities = model.probabilities(row["features"], row["offsets"])
        else:
            item = retained[row["decision_id"]]
            probabilities = item["behavior"]
        selected = max(1e-300, float(probabilities[row["selected_action"]]))
        loss = -math.log(selected)
        losses.append(loss)
        weighted_loss += row["sample_weight"] * loss
        selected_probabilities.append(selected)
        leader = max(probabilities, key=probabilities.get)
        top1.append(float(leader == row["selected_action"]))
        by_skill[row["skill"]].append(loss)

    draft_count = len({row["draft_id"] for row in prepared})
    ordered = sorted(selected_probabilities)

    def quantile(q):
        if not ordered:
            return None
        return ordered[min(len(ordered) - 1, int(q * (len(ordered) - 1)))]

    return {
        "decisions": len(prepared),
        "drafts": draft_count,
        "log_loss_per_decision": statistics.fmean(losses),
        "log_loss_draft_normalized": weighted_loss / draft_count,
        "top1_accuracy": statistics.fmean(top1),
        "selected_probability_quantiles": {
            "p01": quantile(0.01),
            "p05": quantile(0.05),
            "p50": quantile(0.50),
            "p95": quantile(0.95),
            "p99": quantile(0.99),
        },
        "log_loss_by_recorded_skill": {
            key: statistics.fmean(values)
            for key, values in sorted(by_skill.items())
        },
    }


def main():
    args = parse_args()
    if scipy.__version__ != SCIPY_VERSION:
        raise SystemExit(
            f"expected scipy {SCIPY_VERSION}, found {scipy.__version__}"
        )

    decisions, games, manifest = _load_source_cohort(args.cohort_dir, args.source_sha)
    training_ids = frozenset(
        row.draft_id for row in decisions
        if draft_split(row.draft_id) == "train"
    )
    validation_ids = frozenset(
        row.draft_id for row in decisions
        if draft_split(row.draft_id) == "validation"
    )
    rows = _read_feature_rows(
        args.feature_shard,
        manifest,
        args.source_sha,
        training_ids,
        validation_ids,
    )
    retained = _read_retained_validation(
        args.validation_nuisance,
        manifest,
        args.source_sha,
        training_ids,
        validation_ids,
    )
    examples = _examples(rows)
    gradient_check = _gradient_self_check(examples)
    names, compiled, total_weight = _compile(examples)

    iteration_log = []
    def objective(beta):
        return _objective_gradient(beta, compiled, total_weight, L2)

    def callback(intermediate_result):
        value, gradient = objective(intermediate_result.x)
        entry = {
            "iteration": len(iteration_log) + 1,
            "objective": float(value),
            "gradient_l2": float(np.linalg.norm(gradient)),
            "gradient_max_abs": float(np.max(np.abs(gradient))) if len(gradient) else 0.0,
        }
        iteration_log.append(entry)
        if len(iteration_log) % 5 == 0:
            print(json.dumps({"event": "lbfgs_progress", **entry}), flush=True)

    result = minimize(
        objective,
        x0=np.zeros(len(names), dtype=np.float64),
        method="L-BFGS-B",
        jac=True,
        callback=callback,
        options={
            "gtol": GTOL,
            "ftol": FTOL,
            "maxiter": MAXITER,
            "maxls": MAXLS,
            "maxcor": 20,
        },
    )
    final_objective, final_gradient = objective(result.x)
    final_gradient_l2 = float(np.linalg.norm(final_gradient))
    final_gradient_max_abs = (
        float(np.max(np.abs(final_gradient))) if len(final_gradient) else 0.0
    )
    if not result.success:
        raise SystemExit(
            f"L-BFGS did not converge: status={result.status} message={result.message}"
        )
    if final_gradient_max_abs > GTOL:
        raise SystemExit(
            "L-BFGS terminated without satisfying explicit gradient criterion: "
            f"{final_gradient_max_abs} > {GTOL}"
        )

    model = LinearSoftmaxPropensityModel(
        feature_names=names,
        coefficients=tuple(float(value) for value in result.x),
        l2=L2,
    )
    prepared = _prepare_validation(decisions, games, training_ids)
    expected_ids = {row["decision_id"] for row in prepared}
    if set(retained) != expected_ids:
        raise SystemExit("retained validation predictions do not match validation cohort")

    baseline = _validation_metrics(model, prepared, retained=retained)
    converged = _validation_metrics(model, prepared)

    report = {
        "scope": "development_only",
        "source_run": 36256947308,
        "source_sha": args.source_sha,
        "cohort_id": manifest["cohort_id"],
        "assessment_opened": False,
        "assessment_outcomes_used": False,
        "solver": {
            "family": "scipy.optimize.minimize/L-BFGS-B",
            "scipy_version": scipy.__version__,
            "l2": L2,
            "gtol": GTOL,
            "ftol": FTOL,
            "maxiter": MAXITER,
            "maxls": MAXLS,
            "success": bool(result.success),
            "status": int(result.status),
            "message": str(result.message),
            "iterations": int(result.nit),
            "function_evaluations": int(result.nfev),
            "final_objective": float(final_objective),
            "final_gradient_l2": final_gradient_l2,
            "final_gradient_max_abs": final_gradient_max_abs,
            "gradient_self_check": gradient_check,
            "iteration_tail": iteration_log[-10:],
        },
        "training_drafts": len(training_ids),
        "training_rows": len(rows),
        "validation_drafts": len(validation_ids),
        "retained_250_epoch_validation": baseline,
        "converged_validation": converged,
        "converged_minus_retained": {
            "log_loss_per_decision": (
                converged["log_loss_per_decision"]
                - baseline["log_loss_per_decision"]
            ),
            "log_loss_draft_normalized": (
                converged["log_loss_draft_normalized"]
                - baseline["log_loss_draft_normalized"]
            ),
            "top1_accuracy": (
                converged["top1_accuracy"]
                - baseline["top1_accuracy"]
            ),
        },
        "interpretation_boundary": (
            "Solver stopping uses training objective/gradient only. Validation is "
            "post-fit diagnostic evidence. This audit does not change model "
            "features, regularization, target policy, Q/value models, HOB/TMT "
            "use, production state, or the locked assessment."
        ),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
