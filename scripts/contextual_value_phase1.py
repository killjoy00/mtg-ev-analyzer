#!/usr/bin/env python3
"""Run the development-only contextual-value-v1 archive experiment.

This command reads local 17Lands Draft + Game archives, fits only on the frozen
train partition, tunes only on validation, and writes research artifacts. The
locked assessment partition is counted but never scored.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from contextual_value.archive import (
    ArchiveSignalProvider,
    GameStore,
    limit_decisions,
    load_decisions,
)
from contextual_value.dataset import draft_split
from contextual_value.nuisance import (
    NuisancePrediction,
    NuisanceTrainingRow,
    build_fold_training_rows,
    crossfit_nuisance_fold,
    fit_fold_from_training_rows,
    nuisance_fold,
    predict_fold,
)
from contextual_value.pipeline import run_development
from contextual_value.schema import inspect_archive, write_manifest


def _write_predictions(path: Path, predictions) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        for prediction in predictions:
            handle.write(json.dumps(asdict(prediction), sort_keys=True) + "\n")


def _read_predictions(paths: list[Path]) -> list[NuisancePrediction]:
    predictions: list[NuisancePrediction] = []
    for path in paths:
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    predictions.append(NuisancePrediction(**json.loads(line)))
    return predictions


def _write_training_rows(path: Path, rows: list[NuisanceTrainingRow]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(asdict(row), sort_keys=True) + "\n")


def _read_training_rows(paths: list[Path]) -> list[NuisanceTrainingRow]:
    rows: list[NuisanceTrainingRow] = []
    for path in paths:
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    rows.append(NuisanceTrainingRow(**json.loads(line)))
    return rows


def _outer_fold_parts(train, fold: int, folds: int):
    if fold < 0 or fold >= folds:
        raise SystemExit(f"fold must be in [0, {folds})")
    all_ids = frozenset(row.draft_id for row in train)
    held_ids = frozenset(
        draft_id for draft_id in all_ids
        if nuisance_fold(draft_id, folds) == fold
    )
    training_ids = frozenset(all_ids - held_ids)
    if not held_ids or not training_ids:
        raise SystemExit("outer nuisance fold requires non-empty train and held partitions")
    return training_ids, held_ids


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--draft-archive",
        required=True,
        action="append",
        type=Path,
        help="repeat once per Premier environment",
    )
    parser.add_argument(
        "--game-archive",
        required=True,
        action="append",
        type=Path,
        help="repeat in the same environment order as --draft-archive",
    )
    parser.add_argument("--out", type=Path, default=Path("results/contextual-value-v1"))
    parser.add_argument("--max-drafts", type=int,
                        help="deterministic development cap for smoke runs; omit for full archive")
    parser.add_argument("--nuisance-folds", type=int, default=5)
    parser.add_argument("--inner-feature-folds", type=int, default=5)
    parser.add_argument("--propensity-l2", type=float, default=1.0)
    parser.add_argument("--outcome-l2", type=float, default=10.0)
    parser.add_argument("--value-l2", type=float, default=10.0)
    parser.add_argument(
        "--train-nuisance-fold",
        type=int,
        help="compute only this deterministic outer train nuisance fold and exit",
    )
    parser.add_argument(
        "--train-nuisance-feature-shard",
        type=int,
        help="materialize one outer-fold nuisance training feature shard and exit",
    )
    parser.add_argument(
        "--train-nuisance-expansion",
        help="environment to materialize with --train-nuisance-feature-shard",
    )
    parser.add_argument(
        "--assemble-train-nuisance-fold",
        type=int,
        help="fit/predict one outer nuisance fold from precomputed feature shards",
    )
    parser.add_argument(
        "--precomputed-train-feature-shard",
        action="append",
        type=Path,
        default=[],
        help="repeat for precomputed environment feature shards",
    )
    parser.add_argument(
        "--precomputed-train-nuisance",
        action="append",
        type=Path,
        default=[],
        help="repeat for precomputed outer-fold train nuisance prediction files",
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    if len(args.draft_archive) != len(args.game_archive):
        raise SystemExit("--draft-archive and --game-archive counts must match")
    manifests = []
    decisions = []
    draft_source = {}
    for draft_archive, game_archive in zip(args.draft_archive, args.game_archive):
        manifests.append(inspect_archive(draft_archive, "draft"))
        manifests.append(inspect_archive(game_archive, "game"))
        current = load_decisions(draft_archive)
        current_ids = {row.draft_id for row in current}
        overlap = current_ids & set(draft_source)
        if overlap:
            raise SystemExit(
                f"draft archives contain duplicate draft IDs: {sorted(overlap)[:3]}"
            )
        for draft_id in current_ids:
            draft_source[draft_id] = str(draft_archive)
        decisions.extend(current)
    decisions = limit_decisions(decisions, args.max_drafts)
    if not decisions:
        raise SystemExit("draft archives produced no eligible broad-population decisions")
    draft_ids = frozenset(row.draft_id for row in decisions)
    games = GameStore.from_archives(args.game_archive, draft_ids)
    if not games.drafts:
        raise SystemExit("no eligible draft IDs matched the game archive")

    provider = ArchiveSignalProvider(decisions, games)
    args.out.mkdir(parents=True, exist_ok=True)
    write_manifest(manifests, args.out / "archive-manifest.json")

    train = [row for row in decisions if draft_split(row.draft_id) == "train"]
    selected_modes = sum(
        value is not None
        for value in (
            args.train_nuisance_fold,
            args.train_nuisance_feature_shard,
            args.assemble_train_nuisance_fold,
        )
    )
    if selected_modes > 1:
        raise SystemExit("choose only one nuisance checkpoint mode")

    if args.train_nuisance_feature_shard is not None:
        if not args.train_nuisance_expansion:
            raise SystemExit(
                "--train-nuisance-expansion is required with --train-nuisance-feature-shard"
            )
        if args.precomputed_train_feature_shard or args.precomputed_train_nuisance:
            raise SystemExit("feature-shard mode cannot consume precomputed nuisance artifacts")
        fold = args.train_nuisance_feature_shard
        training_ids, held_ids = _outer_fold_parts(train, fold, args.nuisance_folds)
        rows = build_fold_training_rows(
            train,
            training_ids,
            signal_provider=provider,
            inner_feature_folds=args.inner_feature_folds,
            expansion=args.train_nuisance_expansion,
        )
        output = args.out / (
            f"train-feature-fold-{fold}-{args.train_nuisance_expansion}.jsonl.gz"
        )
        _write_training_rows(output, rows)
        (args.out / "feature-shard-report.json").write_text(
            json.dumps({
                "scope": "development_only",
                "assessment_opened": False,
                "fold": fold,
                "nuisance_folds": args.nuisance_folds,
                "expansion": args.train_nuisance_expansion,
                "row_count": len(rows),
                "training_drafts": len(training_ids),
                "held_drafts": len(held_ids),
            }, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(json.dumps({
            "mode": "train_nuisance_feature_shard",
            "fold": fold,
            "expansion": args.train_nuisance_expansion,
            "rows": len(rows),
            "assessment_opened": False,
            "out": str(output),
        }, indent=2))
        return

    if args.assemble_train_nuisance_fold is not None:
        if args.train_nuisance_expansion:
            raise SystemExit(
                "--train-nuisance-expansion is only valid with --train-nuisance-feature-shard"
            )
        if not args.precomputed_train_feature_shard:
            raise SystemExit(
                "--assemble-train-nuisance-fold requires precomputed feature shards"
            )
        if args.precomputed_train_nuisance:
            raise SystemExit("fold assembly cannot consume completed nuisance predictions")
        fold = args.assemble_train_nuisance_fold
        training_ids, held_ids = _outer_fold_parts(train, fold, args.nuisance_folds)
        rows = _read_training_rows(args.precomputed_train_feature_shard)
        expected = {
            row.decision_id for row in train if row.draft_id in training_ids
        }
        observed = {row.decision_id for row in rows}
        if len(observed) != len(rows) or observed != expected:
            missing = sorted(expected - observed)[:3]
            extra = sorted(observed - expected)[:3]
            raise SystemExit(
                "precomputed feature shards do not exactly cover outer-fold training rows; "
                f"missing={missing} extra={extra}"
            )
        print(json.dumps({
            "mode": "assemble_train_nuisance_fold",
            "fold": fold,
            "feature_rows": len(rows),
            "stage": "fit",
            "assessment_opened": False,
        }, sort_keys=True), flush=True)
        fit = fit_fold_from_training_rows(
            rows,
            training_ids,
            propensity_l2=args.propensity_l2,
            outcome_l2=args.outcome_l2,
            fold=fold,
        )
        held = [row for row in train if row.draft_id in held_ids]
        print(json.dumps({
            "mode": "assemble_train_nuisance_fold",
            "fold": fold,
            "stage": "predict",
            "held_decisions": len(held),
            "assessment_opened": False,
        }, sort_keys=True), flush=True)
        predictions = sorted(
            predict_fold(fit, held, signal_provider=provider),
            key=lambda item: item.decision_id,
        )
        output = args.out / f"train-nuisance-fold-{fold}.jsonl.gz"
        _write_predictions(output, predictions)
        (args.out / "fold-report.json").write_text(
            json.dumps({
                "scope": "development_only",
                "assessment_opened": False,
                "fold": fold,
                "nuisance_folds": args.nuisance_folds,
                "prediction_count": len(predictions),
                "held_drafts": len(held_ids),
                "feature_rows": len(rows),
            }, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(json.dumps({
            "mode": "assemble_train_nuisance_fold",
            "fold": fold,
            "predictions": len(predictions),
            "assessment_opened": False,
            "out": str(output),
        }, indent=2), flush=True)
        return

    if args.train_nuisance_fold is not None:
        if args.precomputed_train_feature_shard or args.precomputed_train_nuisance:
            raise SystemExit(
                "--train-nuisance-fold cannot be combined with precomputed nuisance files"
            )
        predictions = crossfit_nuisance_fold(
            train,
            args.train_nuisance_fold,
            folds=args.nuisance_folds,
            signal_provider=provider,
            propensity_l2=args.propensity_l2,
            outcome_l2=args.outcome_l2,
            inner_feature_folds=args.inner_feature_folds,
        )
        output = args.out / f"train-nuisance-fold-{args.train_nuisance_fold}.jsonl.gz"
        _write_predictions(output, predictions)
        (args.out / "fold-report.json").write_text(
            json.dumps({
                "scope": "development_only",
                "assessment_opened": False,
                "fold": args.train_nuisance_fold,
                "nuisance_folds": args.nuisance_folds,
                "prediction_count": len(predictions),
                "held_drafts": len({row.draft_id for row in predictions}),
            }, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(json.dumps({
            "mode": "train_nuisance_fold",
            "fold": args.train_nuisance_fold,
            "predictions": len(predictions),
            "assessment_opened": False,
            "out": str(output),
        }, indent=2))
        return

    precomputed = (
        _read_predictions(args.precomputed_train_nuisance)
        if args.precomputed_train_nuisance
        else None
    )
    report, train_predictions, validation_predictions, value_model = run_development(
        decisions,
        signal_provider=provider,
        nuisance_folds=args.nuisance_folds,
        inner_feature_folds=args.inner_feature_folds,
        propensity_l2=args.propensity_l2,
        outcome_l2=args.outcome_l2,
        value_l2=args.value_l2,
        train_predictions=precomputed,
    )
    (args.out / "development-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    _write_predictions(args.out / "train-nuisance.jsonl.gz", train_predictions)
    _write_predictions(args.out / "validation-nuisance.jsonl.gz", validation_predictions)
    (args.out / "value-model.json").write_text(
        json.dumps({
            "feature_names": list(value_model.regression.feature_names),
            "coefficients": list(value_model.regression.coefficients),
            "training_draft_count": value_model.training_draft_count,
            "training_weight_cap": value_model.training_weight_cap,
            "l2": value_model.l2,
            "assessment_opened": False,
        }, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "decisions": len(decisions),
        "drafts": len(draft_ids),
        "game_drafts_matched": len(games.drafts),
        "assessment_opened": False,
        "selected_temperature": report["models"]["G_contextual_value"][
            "selected_validation_temperature"
        ],
        "selected_simple_blend": report["models"]["E_simple_behavior_outcome_blend"][
            "selected_validation_config"
        ],
        "out": str(args.out),
    }, indent=2))


if __name__ == "__main__":
    main()
