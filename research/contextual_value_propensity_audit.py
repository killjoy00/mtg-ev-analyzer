#!/usr/bin/env python3
"""Validation-only propensity convergence audit for contextual-value-v1.

Reuses the sealed development cohort and fold -1 feature checkpoints from the
first successful core-pool run. It does not read assessment outcomes, alter Q or
value models, or select a production configuration.
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


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cohort-dir", type=Path, required=True)
    parser.add_argument("--feature-shard", action="append", type=Path, required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--epochs", default="250,500,1000")
    parser.add_argument("--out", type=Path, required=True)
    return parser.parse_args()


def _meta_path(path: Path) -> Path:
    return path.with_name(path.name.replace(".jsonl.gz", ".meta.json"))


def _load_source_cohort(root: Path, source_sha: str):
    manifest_path = root / "cohort-manifest.json"
    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
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
        count_before = len(rows)
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    rows.append(NuisanceTrainingRow(**json.loads(line)))
        if len(rows) - count_before != int(meta.get("row_count", -1)):
            raise SystemExit(f"{path}: row-count mismatch")
        seen.add(expansion)
    if seen != set(CORE):
        raise SystemExit(f"incomplete core feature shards: {sorted(set(CORE) - seen)}")
    if {row.draft_id for row in rows} != set(training_ids):
        raise SystemExit("feature rows do not cover the full training draft complement")
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


def _objective_gradient(model, examples):
    names = model.feature_names
    at = {name: i for i, name in enumerate(names)}
    beta = list(model.coefficients)
    total_weight = sum(ex.sample_weight for ex in examples)
    nll = 0.0
    score_gradient = [0.0] * len(beta)
    for ex in examples:
        actions = tuple(ex.features)
        scores = []
        sparse = []
        for action in actions:
            row = [(at[name], float(value)) for name, value in ex.features[action].items() if name in at]
            sparse.append(row)
            score = float(ex.offsets[action]) if ex.offsets is not None else 0.0
            score += sum(beta[index] * value for index, value in row)
            scores.append(score)
        peak = max(scores)
        weights = [math.exp(score - peak) for score in scores]
        denom = sum(weights)
        selected_index = actions.index(ex.selected_action)
        selected_probability = max(1e-300, weights[selected_index] / denom)
        nll -= ex.sample_weight * math.log(selected_probability)
        for action_index, row in enumerate(sparse):
            probability = weights[action_index] / denom
            residual = (1.0 if action_index == selected_index else 0.0) - probability
            for index, value in row:
                score_gradient[index] += ex.sample_weight * residual * value
    for index, coefficient in enumerate(beta):
        score_gradient[index] -= model.l2 * coefficient
    normalized = [value / total_weight for value in score_gradient]
    objective = (
        nll + 0.5 * model.l2 * sum(value * value for value in beta)
    ) / total_weight
    return {
        "penalized_nll_per_weight": objective,
        "score_gradient_l2": math.sqrt(sum(value * value for value in normalized)),
        "score_gradient_max_abs": max((abs(value) for value in normalized), default=0.0),
    }


def _validation_metrics(model, decisions, games, training_ids):
    provider = ArchiveSignalProvider(decisions, games)
    validation = [row for row in decisions if draft_split(row.draft_id) == "validation"]
    draft_weights = normalized_draft_weights(validation)
    losses = []
    weighted_loss = 0.0
    top1 = []
    selected_probabilities = []
    by_skill = defaultdict(list)
    for decision in validation:
        signals = provider(decision, training_ids)
        features = model_feature_map(decision, signals)
        offsets = strong_choice_offsets(signals, decision.candidates)
        probabilities = model.probabilities(features, offsets)
        selected = max(1e-300, probabilities[decision.selected_card])
        loss = -math.log(selected)
        losses.append(loss)
        weighted_loss += draft_weights[decision.decision_id] * loss
        selected_probabilities.append(selected)
        leader = max(probabilities, key=probabilities.get)
        top1.append(float(leader == decision.selected_card))
        rate = decision.user_game_win_rate
        skill = "<0.50" if rate < 0.50 else ("0.50-<0.60" if rate < 0.60 else ">=0.60")
        by_skill[skill].append(loss)
    ordered = sorted(selected_probabilities)
    def quantile(q):
        if not ordered:
            return None
        return ordered[min(len(ordered)-1, int(q * (len(ordered)-1)))]
    return {
        "decisions": len(validation),
        "drafts": len({row.draft_id for row in validation}),
        "log_loss_per_decision": statistics.fmean(losses),
        "log_loss_draft_normalized": weighted_loss,
        "top1_accuracy": statistics.fmean(top1),
        "selected_probability_quantiles": {
            "p01": quantile(0.01), "p05": quantile(0.05), "p50": quantile(0.50),
            "p95": quantile(0.95), "p99": quantile(0.99),
        },
        "log_loss_by_recorded_skill": {
            key: statistics.fmean(values) for key, values in sorted(by_skill.items())
        },
    }


def main():
    args = parse_args()
    epoch_grid = sorted({int(value) for value in args.epochs.split(",") if value.strip()})
    if any(value <= 0 for value in epoch_grid):
        raise SystemExit("epochs must be positive")

    decisions, games, manifest = _load_source_cohort(args.cohort_dir, args.source_sha)
    training_ids = frozenset(row.draft_id for row in decisions if draft_split(row.draft_id) == "train")
    validation_ids = frozenset(row.draft_id for row in decisions if draft_split(row.draft_id) == "validation")
    rows = _read_feature_rows(
        args.feature_shard, manifest, args.source_sha, training_ids, validation_ids
    )
    examples = _examples(rows)

    fits = {}
    report = {
        "scope": "development_only",
        "source_run": 36256947308,
        "source_sha": args.source_sha,
        "cohort_id": manifest["cohort_id"],
        "assessment_opened": False,
        "assessment_outcomes_used": False,
        "training_drafts": len(training_ids),
        "validation_drafts": len(validation_ids),
        "training_rows": len(rows),
        "epoch_grid": epoch_grid,
        "fits": {},
    }
    for epochs in epoch_grid:
        model = LinearSoftmaxPropensityModel.fit(examples, l2=1.0, epochs=epochs)
        fits[epochs] = model
        report["fits"][str(epochs)] = {
            "optimizer": _objective_gradient(model, examples),
            "validation": _validation_metrics(model, decisions, games, training_ids),
            "coefficient_l2": math.sqrt(sum(value * value for value in model.coefficients)),
        }

    baseline = fits[epoch_grid[0]]
    for epochs in epoch_grid[1:]:
        challenger = fits[epochs]
        names = sorted(set(baseline.feature_names) | set(challenger.feature_names))
        b = dict(zip(baseline.feature_names, baseline.coefficients))
        c = dict(zip(challenger.feature_names, challenger.coefficients))
        deltas = [c.get(name, 0.0) - b.get(name, 0.0) for name in names]
        report["fits"][str(epochs)]["vs_first_epoch_fit"] = {
            "coefficient_delta_l2": math.sqrt(sum(value * value for value in deltas)),
            "coefficient_delta_max_abs": max(abs(value) for value in deltas),
        }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
