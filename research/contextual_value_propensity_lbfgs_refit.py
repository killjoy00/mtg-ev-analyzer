#!/usr/bin/env python3
"""Controlled pooled refit using converged propensity and retained Q values."""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from dataclasses import asdict
from pathlib import Path

import numpy as np
import scipy
from scipy.optimize import minimize

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from contextual_value.archive import ArchiveSignalProvider
from contextual_value.checkpoint import draft_id_sha256
from contextual_value.dataset import draft_split
from contextual_value.features import model_feature_map, strong_choice_offsets
from contextual_value.nuisance import NuisancePrediction, NuisanceTrainingRow, nuisance_fold
from contextual_value.pipeline import run_development
from contextual_value.propensity import LinearSoftmaxPropensityModel
from contextual_value.schema import file_sha256

from contextual_value_propensity_lbfgs import (
    FTOL, GTOL, L2, MAXITER, MAXLS, SCIPY_VERSION,
    _compile, _examples, _gradient_self_check, _load_source_cohort,
    _meta_path, _objective_gradient,
)


def parse_args():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="mode", required=True)
    fold = sub.add_parser("fold")
    fold.add_argument("--fold", type=int, required=True)
    fold.add_argument("--cohort-dir", type=Path, required=True)
    fold.add_argument("--feature-shard", action="append", type=Path, required=True)
    fold.add_argument("--retained-nuisance", type=Path, required=True)
    fold.add_argument("--source-sha", required=True)
    fold.add_argument("--out", type=Path, required=True)
    pooled = sub.add_parser("pooled")
    pooled.add_argument("--cohort-dir", type=Path, required=True)
    pooled.add_argument("--train-prediction", action="append", type=Path, required=True)
    pooled.add_argument("--validation-prediction", type=Path, required=True)
    pooled.add_argument("--fold-report", action="append", type=Path, required=True)
    pooled.add_argument("--source-sha", required=True)
    pooled.add_argument("--original-report", type=Path, required=True)
    pooled.add_argument("--out", type=Path, required=True)
    return parser.parse_args()


def _parts(train, validation, fold):
    all_ids = frozenset(row.draft_id for row in train)
    if fold == -1:
        held = list(validation)
        return all_ids, frozenset(row.draft_id for row in held), held
    if fold < 0 or fold >= 5:
        raise SystemExit("fold must be -1 or 0..4")
    held_ids = frozenset(
        draft_id for draft_id in all_ids
        if nuisance_fold(draft_id, 5) == fold
    )
    training_ids = frozenset(all_ids - held_ids)
    held = [row for row in train if row.draft_id in held_ids]
    if not training_ids or not held_ids or not held:
        raise SystemExit("empty nuisance fold partition")
    return training_ids, held_ids, held


CORE = ("MSH", "SOS", "ECL", "TLA")


def _read_feature_rows_for_fold(
    paths,
    manifest,
    source_sha,
    fold,
    training_ids,
    held_ids,
):
    rows = []
    seen = set()
    expected_training_hash = draft_id_sha256(training_ids)
    expected_held_hash = draft_id_sha256(held_ids)
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
            "fold": fold,
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
        raise SystemExit("feature rows do not cover the full training draft complement")
    return rows


def _read_retained(path, manifest, source_sha, fold, training_ids, held_ids):
    meta = json.loads(_meta_path(path).read_text(encoding="utf-8"))
    expected = {
        "kind": "nuisance_predictions",
        "cohort_id": manifest["cohort_id"],
        "selected_drafts_sha256": manifest["selected_drafts_sha256"],
        "code_revision": source_sha,
        "fold": fold,
        "training_drafts_sha256": draft_id_sha256(training_ids),
        "held_drafts_sha256": draft_id_sha256(held_ids),
        "payload_sha256": file_sha256(path),
    }
    for key, value in expected.items():
        if meta.get(key) != value:
            raise SystemExit(f"{path}: incompatible retained nuisance {key}")
    required_config = {
        "max_drafts": 8000,
        "nuisance_folds": 5,
        "inner_feature_folds": 5,
        "propensity_l2": 1.0,
        "outcome_l2": 10.0,
        "value_l2": 10.0,
    }
    configuration = meta.get("configuration") or {}
    for key, value in required_config.items():
        if configuration.get(key) != value:
            raise SystemExit(f"{path}: incompatible configuration {key}")
    rows = {}
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            item = json.loads(line)
            if item["decision_id"] in rows:
                raise SystemExit("duplicate retained nuisance decision")
            rows[item["decision_id"]] = item
    if len(rows) != int(meta.get("row_count", -1)):
        raise SystemExit("retained nuisance row-count mismatch")
    return rows


def _solve(examples):
    if scipy.__version__ != SCIPY_VERSION:
        raise SystemExit(f"expected scipy {SCIPY_VERSION}, found {scipy.__version__}")
    gradient_check = _gradient_self_check(examples)
    names, compiled, total_weight = _compile(examples)

    def objective(beta):
        return _objective_gradient(beta, compiled, total_weight, L2)

    iterations = []
    def callback(intermediate_result):
        # Do not recompute a full gradient here: L-BFGS already evaluated the
        # objective for this accepted iterate. Final convergence is still
        # asserted from an explicit objective+gradient evaluation below.
        entry = {
            "iteration": len(iterations) + 1,
            "objective": float(intermediate_result.fun),
        }
        iterations.append(entry)
        if len(iterations) % 5 == 0:
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
    value, gradient = objective(result.x)
    gradient_l2 = float(np.linalg.norm(gradient))
    gradient_max_abs = float(np.max(np.abs(gradient))) if len(gradient) else 0.0
    if not result.success:
        raise SystemExit(f"L-BFGS did not converge: status={result.status} message={result.message}")
    if gradient_max_abs > GTOL:
        raise SystemExit(
            "L-BFGS terminated without explicit gradient convergence: "
            f"{gradient_max_abs} > {GTOL}"
        )
    model = LinearSoftmaxPropensityModel(
        feature_names=names,
        coefficients=tuple(float(value) for value in result.x),
        l2=L2,
    )
    return model, {
        "success": bool(result.success),
        "status": int(result.status),
        "message": str(result.message),
        "iterations": int(result.nit),
        "function_evaluations": int(result.nfev),
        "objective": float(value),
        "gradient_l2": gradient_l2,
        "gradient_max_abs": gradient_max_abs,
        "gradient_self_check": gradient_check,
        "iteration_tail": iterations[-10:],
    }


def _write_predictions(path, predictions):
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        for prediction in sorted(predictions, key=lambda item: item.decision_id):
            handle.write(json.dumps(asdict(prediction), sort_keys=True) + "\n")


def _read_predictions(path):
    rows = []
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(NuisancePrediction(**json.loads(line)))
    return rows


def run_fold(args):
    decisions, games, manifest = _load_source_cohort(args.cohort_dir, args.source_sha)
    train = [row for row in decisions if draft_split(row.draft_id) == "train"]
    validation = [row for row in decisions if draft_split(row.draft_id) == "validation"]
    training_ids, held_ids, held = _parts(train, validation, args.fold)
    rows = _read_feature_rows_for_fold(
        args.feature_shard,
        manifest,
        args.source_sha,
        args.fold,
        training_ids,
        held_ids,
    )
    expected_training = {
        row.decision_id for row in train if row.draft_id in training_ids
    }
    observed_training = {row.decision_id for row in rows}
    if len(observed_training) != len(rows) or observed_training != expected_training:
        raise SystemExit("feature rows do not exactly cover fold training decisions")
    retained = _read_retained(
        args.retained_nuisance, manifest, args.source_sha,
        args.fold, training_ids, held_ids
    )
    if set(retained) != {row.decision_id for row in held}:
        raise SystemExit("retained nuisance does not exactly cover held decisions")

    model, solver = _solve(_examples(rows))
    provider = ArchiveSignalProvider(decisions, games)
    predictions = []
    for index, decision in enumerate(held, start=1):
        signals = provider(decision, training_ids)
        features = model_feature_map(decision, signals)
        offsets = strong_choice_offsets(signals, decision.candidates)
        behavior = model.probabilities(features, offsets)
        old = retained[decision.decision_id]
        if (
            old["draft_id"] != decision.draft_id
            or int(old["fold"]) != args.fold
            or int(old["training_draft_count"]) != len(training_ids)
        ):
            raise SystemExit("retained nuisance identity/provenance mismatch")
        q_values = {key: float(value) for key, value in old["q_values"].items()}
        predictions.append(NuisancePrediction(
            decision_id=decision.decision_id,
            draft_id=decision.draft_id,
            fold=args.fold,
            training_draft_count=len(training_ids),
            behavior=behavior,
            q_values=q_values,
        ))
        if index % 5000 == 0 or index == len(held):
            print(json.dumps({
                "event": "held_prediction_progress",
                "fold": args.fold,
                "completed": index,
                "total": len(held),
            }), flush=True)

    output = args.out / f"lbfgs-nuisance-fold-{args.fold}.jsonl.gz"
    _write_predictions(output, predictions)
    report = {
        "scope": "development_only",
        "source_run": 36256947308,
        "source_sha": args.source_sha,
        "cohort_id": manifest["cohort_id"],
        "fold": args.fold,
        "training_drafts": len(training_ids),
        "held_drafts": len(held_ids),
        "training_rows": len(rows),
        "held_predictions": len(predictions),
        "prediction_sha256": file_sha256(output),
        "q_values_preserved": True,
        "assessment_opened": False,
        "assessment_outcomes_used": False,
        "solver": solver,
    }
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / f"lbfgs-fold-{args.fold}-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _verify_fold_reports(paths, *, manifest, prediction_digests):
    reports = {}
    for path in paths:
        report = json.loads(path.read_text(encoding="utf-8"))
        fold = int(report.get("fold"))
        if fold not in {-1, 0, 1, 2, 3, 4} or fold in reports:
            raise SystemExit(f"{path}: unexpected or duplicate fold report {fold}")
        if report.get("scope") != "development_only":
            raise SystemExit(f"{path}: unexpected fold-report scope")
        if report.get("source_run") != 36256947308:
            raise SystemExit(f"{path}: unexpected source run")
        if report.get("source_sha") != "aa5b17d96b43f3ce08f52fad55ba17f327472c1b":
            raise SystemExit(f"{path}: unexpected source SHA")
        if report.get("cohort_id") != manifest["cohort_id"]:
            raise SystemExit(f"{path}: unexpected cohort")
        if report.get("assessment_opened") is not False:
            raise SystemExit(f"{path}: assessment boundary violated")
        if report.get("assessment_outcomes_used") is not False:
            raise SystemExit(f"{path}: assessment outcomes used")
        if report.get("q_values_preserved") is not True:
            raise SystemExit(f"{path}: retained Q not preserved")
        solver = report.get("solver") or {}
        if solver.get("success") is not True:
            raise SystemExit(f"{path}: solver did not report success")
        if float(solver.get("gradient_max_abs", float("inf"))) > GTOL:
            raise SystemExit(f"{path}: solver gradient criterion failed")
        check = solver.get("gradient_self_check") or {}
        if float(check.get("max_abs_error", float("inf"))) > 2e-6:
            raise SystemExit(f"{path}: analytic gradient self-check failed")
        if report.get("prediction_sha256") != prediction_digests.get(fold):
            raise SystemExit(f"{path}: prediction payload digest mismatch")
        reports[fold] = report
    if set(reports) != {-1, 0, 1, 2, 3, 4}:
        raise SystemExit("incomplete converged-propensity fold reports")
    return reports


def _extract_primary(report):
    return {
        "A_cap20": report["models"]["A_current_v4_strong_player"]["20"],
        "G_cap20": report["models"]["G_contextual_value"]["selected_estimates"]["20"],
        "delta_ci95": report["diagnostics"]["validation_selected_contextual_vs_v4_dr_ci95"],
        "temperature": report["models"]["G_contextual_value"]["selected_validation_temperature"],
        "simple_blend": report["models"]["E_simple_behavior_outcome_blend"]["selected_validation_config"],
    }


def run_pooled(args):
    decisions, games, manifest = _load_source_cohort(args.cohort_dir, args.source_sha)
    train_predictions = []
    seen_folds = set()
    prediction_digests = {}
    for path in args.train_prediction:
        rows = _read_predictions(path)
        folds = {row.fold for row in rows}
        if len(folds) != 1:
            raise SystemExit(f"{path}: mixed folds")
        fold = next(iter(folds))
        if fold not in range(5) or fold in seen_folds:
            raise SystemExit(f"{path}: unexpected or duplicate fold {fold}")
        seen_folds.add(fold)
        prediction_digests[fold] = file_sha256(path)
        train_predictions.extend(rows)
    if seen_folds != set(range(5)):
        raise SystemExit("missing train prediction folds")

    validation_predictions = _read_predictions(args.validation_prediction)
    if {row.fold for row in validation_predictions} != {-1}:
        raise SystemExit("validation predictions must be fold -1")
    prediction_digests[-1] = file_sha256(args.validation_prediction)
    fold_reports = _verify_fold_reports(
        args.fold_report,
        manifest=manifest,
        prediction_digests=prediction_digests,
    )

    provider = ArchiveSignalProvider(decisions, games)
    report, train_out, validation_out, value_model = run_development(
        decisions,
        signal_provider=provider,
        nuisance_folds=5,
        inner_feature_folds=5,
        propensity_l2=1.0,
        outcome_l2=10.0,
        value_l2=10.0,
        train_predictions=train_predictions,
        validation_predictions=validation_predictions,
        assessment_draft_count=int(manifest["split_counts"]["assessment"]),
    )
    if report.get("assessment_opened") is not False:
        raise SystemExit("assessment partition was opened")
    boundary = report.get("assessment_boundary") or {}
    if (
        boundary.get("outcomes_loaded_into_pipeline") is not False
        or boundary.get("outcomes_used_for_fit") is not False
        or boundary.get("outcomes_scored") is not False
    ):
        raise SystemExit("assessment outcomes reached development pipeline")

    original = json.loads(args.original_report.read_text(encoding="utf-8"))
    report["cohort"] = {
        "cohort_id": manifest["cohort_id"],
        "selected_drafts_sha256": manifest["selected_drafts_sha256"],
        "assessment_outcomes_serialized": manifest["assessment_outcomes_serialized"],
    }
    report["controlled_propensity_refit"] = {
        "q_values": "retained unchanged from run 36256947308",
        "behavior_model": "same conditional-logit objective solved to gtol <= 1e-6 with L-BFGS",
        "verified_fold_reports": {
            str(fold): {
                "prediction_sha256": fold_reports[fold]["prediction_sha256"],
                "iterations": fold_reports[fold]["solver"]["iterations"],
                "gradient_max_abs": fold_reports[fold]["solver"]["gradient_max_abs"],
            }
            for fold in sorted(fold_reports)
        },
        "original": _extract_primary(original),
        "converged": _extract_primary(report),
    }

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "development-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    _write_predictions(args.out / "train-nuisance.jsonl.gz", train_out)
    _write_predictions(args.out / "validation-nuisance.jsonl.gz", validation_out)
    (args.out / "value-model.json").write_text(
        json.dumps({
            "feature_names": list(value_model.regression.feature_names),
            "coefficients": list(value_model.regression.coefficients),
            "l2": value_model.regression.l2,
            "training_draft_count": value_model.training_draft_count,
        }, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report["controlled_propensity_refit"], indent=2, sort_keys=True))


def main():
    args = parse_args()
    if args.mode == "fold":
        run_fold(args)
    else:
        run_pooled(args)


if __name__ == "__main__":
    main()
