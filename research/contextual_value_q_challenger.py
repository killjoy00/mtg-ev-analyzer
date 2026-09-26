#!/usr/bin/env python3
"""Validation-only nonlinear Q challenger for contextual-value-v1.

This is the tree/boosted Q challenger predeclared in the frozen protocol.
It reuses the successful core development cohort and fold -1 training feature
checkpoints. It never reads assessment outcomes and does not alter propensity,
the contextual-value learner, target policies, or production state.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.feature_extraction import DictVectorizer

from contextual_value.archive import ArchiveSignalProvider
from contextual_value.checkpoint import draft_id_sha256, load_preprocessed_cohort
from contextual_value.dataset import draft_split, normalized_draft_weights
from contextual_value.features import model_feature_map
from contextual_value.nuisance import NuisanceTrainingRow
from contextual_value.outcome import RidgeOutcomeModel
from contextual_value.schema import file_sha256

CORE = ("MSH", "SOS", "ECL", "TLA")
SKLEARN_VERSION = "1.9.1"
CHALLENGER = {
    "family": "HistGradientBoostingRegressor",
    "loss": "squared_error",
    "learning_rate": 0.05,
    "max_iter": 200,
    "max_leaf_nodes": 15,
    "min_samples_leaf": 100,
    "l2_regularization": 10.0,
    "early_stopping": False,
    "random_state": 529,
}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cohort-dir", type=Path, required=True)
    parser.add_argument("--feature-shard", action="append", type=Path, required=True)
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


def _prepare_validation(decisions, games, training_ids):
    provider = ArchiveSignalProvider(decisions, games)
    validation = [
        row for row in decisions
        if draft_split(row.draft_id) == "validation"
    ]
    weights = normalized_draft_weights(validation)
    prepared = []
    total = len(validation)
    for index, decision in enumerate(validation, start=1):
        signals = provider(decision, training_ids)
        features = model_feature_map(decision, signals)[decision.selected_card]
        prepared.append({
            "decision_id": decision.decision_id,
            "draft_id": decision.draft_id,
            "expansion": decision.expansion,
            "pick_number": decision.pick_number,
            "skill": (
                "<0.50"
                if decision.user_game_win_rate < 0.50
                else (
                    "0.50-<0.60"
                    if decision.user_game_win_rate < 0.60
                    else ">=0.60"
                )
            ),
            "features": features,
            "outcome": float(decision.event_match_wins),
            "sample_weight": float(weights[decision.decision_id]),
        })
        if index % 5000 == 0 or index == total:
            print(json.dumps({
                "event": "validation_feature_progress",
                "completed_decisions": index,
                "total_decisions": total,
            }), flush=True)
    return prepared


def _weighted_metrics(rows, predictions):
    total_weight = sum(row["sample_weight"] for row in rows)
    if total_weight <= 0:
        raise ValueError("positive validation weight required")
    residuals = [
        float(prediction) - row["outcome"]
        for row, prediction in zip(rows, predictions)
    ]
    mae = sum(
        row["sample_weight"] * abs(residual)
        for row, residual in zip(rows, residuals)
    ) / total_weight
    mse = sum(
        row["sample_weight"] * residual * residual
        for row, residual in zip(rows, residuals)
    ) / total_weight
    bias = sum(
        row["sample_weight"] * residual
        for row, residual in zip(rows, residuals)
    ) / total_weight
    return {
        "mae": mae,
        "rmse": math.sqrt(mse),
        "mean_bias": bias,
        "prediction_min": min(map(float, predictions)),
        "prediction_max": max(map(float, predictions)),
    }


def _slices(rows, predictions, key):
    grouped = defaultdict(list)
    for row, prediction in zip(rows, predictions):
        grouped[str(row[key])].append((row, float(prediction)))
    return {
        name: {
            "decisions": len(items),
            **_weighted_metrics(
                [row for row, _ in items],
                [prediction for _, prediction in items],
            ),
        }
        for name, items in sorted(grouped.items())
    }


def _calibration_deciles(rows, predictions):
    ordered = sorted(
        zip(rows, map(float, predictions)),
        key=lambda item: item[1],
    )
    bins = []
    n = len(ordered)
    for bucket in range(10):
        start = bucket * n // 10
        end = (bucket + 1) * n // 10
        items = ordered[start:end]
        if not items:
            continue
        weight = sum(row["sample_weight"] for row, _ in items)
        bins.append({
            "decile": bucket + 1,
            "decisions": len(items),
            "mean_prediction": sum(
                row["sample_weight"] * prediction
                for row, prediction in items
            ) / weight,
            "mean_outcome": sum(
                row["sample_weight"] * row["outcome"]
                for row, _ in items
            ) / weight,
        })
    return bins


def _report_model(rows, predictions):
    return {
        "overall": _weighted_metrics(rows, predictions),
        "by_recorded_skill": _slices(rows, predictions, "skill"),
        "by_set": _slices(rows, predictions, "expansion"),
        "by_pick": _slices(rows, predictions, "pick_number"),
        "calibration_deciles": _calibration_deciles(rows, predictions),
    }


def main():
    args = parse_args()
    import sklearn

    if sklearn.__version__ != SKLEARN_VERSION:
        raise SystemExit(
            f"expected scikit-learn {SKLEARN_VERSION}, found {sklearn.__version__}"
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
    validation = _prepare_validation(decisions, games, training_ids)

    train_features = [row.features[row.selected_action] for row in rows]
    train_outcomes = np.asarray([row.outcome for row in rows], dtype=np.float64)
    train_weights = np.asarray([row.sample_weight for row in rows], dtype=np.float64)

    ridge = RidgeOutcomeModel.fit(
        train_features,
        train_outcomes.tolist(),
        sample_weights=train_weights.tolist(),
        l2=10.0,
    )
    ridge_predictions = np.asarray(
        [ridge.predict(row["features"]) for row in validation],
        dtype=np.float64,
    )

    vectorizer = DictVectorizer(sparse=False, dtype=np.float32)
    x_train = vectorizer.fit_transform(train_features)
    x_validation = vectorizer.transform([row["features"] for row in validation])
    model = HistGradientBoostingRegressor(**{
        key: value for key, value in CHALLENGER.items()
        if key != "family"
    })
    model.fit(x_train, train_outcomes, sample_weight=train_weights)
    boosted_predictions = model.predict(x_validation)

    ridge_report = _report_model(validation, ridge_predictions)
    boosted_report = _report_model(validation, boosted_predictions)
    report = {
        "scope": "development_only",
        "role": "predeclared_nonlinear_q_challenger_audit",
        "source_run": 36256947308,
        "source_sha": args.source_sha,
        "cohort_id": manifest["cohort_id"],
        "assessment_opened": False,
        "assessment_outcomes_used": False,
        "training_drafts": len(training_ids),
        "validation_drafts": len(validation_ids),
        "training_rows": len(rows),
        "validation_decisions": len(validation),
        "sklearn_version": sklearn.__version__,
        "baseline": {
            "family": "RidgeOutcomeModel",
            "l2": 10.0,
            "metrics": ridge_report,
        },
        "challenger": {
            "configuration": CHALLENGER,
            "feature_count": len(vectorizer.feature_names_),
            "metrics": boosted_report,
        },
        "challenger_minus_baseline": {
            "mae": (
                boosted_report["overall"]["mae"]
                - ridge_report["overall"]["mae"]
            ),
            "rmse": (
                boosted_report["overall"]["rmse"]
                - ridge_report["overall"]["rmse"]
            ),
            "absolute_mean_bias": (
                abs(boosted_report["overall"]["mean_bias"])
                - abs(ridge_report["overall"]["mean_bias"])
            ),
        },
        "interpretation_boundary": (
            "Validation-only nuisance evidence. This report cannot adopt the "
            "challenger, open assessment, or establish downstream policy value."
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
