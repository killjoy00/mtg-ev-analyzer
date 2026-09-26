#!/usr/bin/env python3
"""Run the development-only contextual-value-v1 archive experiment.

This command fits only on the frozen train partition, tunes only on validation,
and writes research artifacts. The locked assessment partition is counted by ID
but the pooled workflow preprocesses it out before development fitting/scoring.
"""

from __future__ import annotations

import argparse
import gzip
import json
import resource
import sys
import time
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from contextual_value.archive import (
    ArchiveSignalProvider,
    GameStore,
    limit_decisions,
    load_decisions,
)
from contextual_value.checkpoint import (
    CORE_DEVELOPMENT_ENVIRONMENTS,
    build_cohort_manifest,
    load_preprocessed_cohort,
    verify_checkpoint_metadata,
    write_checkpoint_metadata,
    write_preprocessed_cohort,
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


def _peak_rss_mb() -> float | None:
    try:
        value = float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    except (AttributeError, OSError, ValueError):
        return None
    # Linux reports KiB, macOS reports bytes.
    return value / (1024.0 * 1024.0) if sys.platform == "darwin" else value / 1024.0


def _emit_stage(stage: str, started: float, **counts) -> None:
    payload = {
        "event": "stage_complete",
        "stage": stage,
        "elapsed_seconds": round(time.perf_counter() - started, 3),
        "peak_rss_mb": (
            round(_peak_rss_mb(), 3) if _peak_rss_mb() is not None else None
        ),
        **counts,
    }
    print(json.dumps(payload, sort_keys=True), flush=True)


def _progress(stage: str, **context):
    def emit(done: int, total: int) -> None:
        print(json.dumps({
            "event": "progress",
            "stage": stage,
            "completed_rows": done,
            "total_rows": total,
            "peak_rss_mb": (
                round(_peak_rss_mb(), 3) if _peak_rss_mb() is not None else None
            ),
            **context,
        }, sort_keys=True), flush=True)
    return emit


def _write_predictions(path: Path, predictions) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        for prediction in predictions:
            handle.write(json.dumps(asdict(prediction), sort_keys=True) + "\n")


def _write_training_rows(path: Path, rows: list[NuisanceTrainingRow]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(asdict(row), sort_keys=True) + "\n")


def _checkpoint_configuration(args) -> dict:
    return {
        "max_drafts": args.max_drafts,
        "nuisance_folds": args.nuisance_folds,
        "inner_feature_folds": args.inner_feature_folds,
        "propensity_l2": args.propensity_l2,
        "outcome_l2": args.outcome_l2,
        "value_l2": args.value_l2,
    }


def _outer_fold_parts(train, fold: int, folds: int):
    all_ids = frozenset(row.draft_id for row in train)
    if fold == -1:
        if not all_ids:
            raise SystemExit("validation nuisance fit requires non-empty train")
        return all_ids, frozenset()
    if fold < 0 or fold >= folds:
        raise SystemExit(f"fold must be -1 or in [0, {folds})")
    held_ids = frozenset(
        draft_id for draft_id in all_ids
        if nuisance_fold(draft_id, folds) == fold
    )
    training_ids = frozenset(all_ids - held_ids)
    if not held_ids or not training_ids:
        raise SystemExit("outer nuisance fold requires non-empty train and held partitions")
    return training_ids, held_ids


def _read_training_rows(
    paths: list[Path],
    *,
    cohort_manifest: dict,
    fold: int,
    training_ids: frozenset[str],
    held_ids: frozenset[str],
    configuration: dict,
) -> list[NuisanceTrainingRow]:
    rows: list[NuisanceTrainingRow] = []
    expansions: set[str] = set()
    for path in paths:
        metadata = verify_checkpoint_metadata(
            path,
            cohort_manifest=cohort_manifest,
            kind="nuisance_training_features",
            fold=fold,
            expansion=None,  # checked explicitly below after reading metadata
            training_ids=training_ids,
            held_ids=held_ids,
            configuration=configuration,
        )
        expansion = metadata.get("recorded_expansion")
        if expansion not in CORE_DEVELOPMENT_ENVIRONMENTS:
            raise SystemExit(f"{path}: unexpected feature-shard expansion {expansion!r}")
        if expansion in expansions:
            raise SystemExit(f"duplicate feature checkpoint for expansion {expansion}")
        expansions.add(expansion)
        count_before = len(rows)
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    rows.append(NuisanceTrainingRow(**json.loads(line)))
        if len(rows) - count_before != metadata.get("row_count"):
            raise SystemExit(f"{path}: feature checkpoint row count mismatch")
    if expansions != set(CORE_DEVELOPMENT_ENVIRONMENTS):
        missing = sorted(set(CORE_DEVELOPMENT_ENVIRONMENTS) - expansions)
        raise SystemExit(f"incomplete feature checkpoint set; missing={missing}")
    return rows


def _verify_feature_checkpoint(
    path: Path,
    *,
    cohort_manifest: dict,
    fold: int,
    expansion: str,
    training_ids: frozenset[str],
    held_ids: frozenset[str],
    configuration: dict,
) -> dict:
    # Expansion is recorded separately because verify_checkpoint_metadata treats
    # None as a literal expected value. This keeps the generic verifier strict.
    meta_path = path.with_name(path.name.replace(".jsonl.gz", ".meta.json"))
    metadata = json.loads(meta_path.read_text(encoding="utf-8"))
    recorded = metadata.get("expansion")
    if recorded != expansion:
        raise ValueError(f"{path}: incompatible checkpoint expansion")
    # Verify the rest using a copy whose generic expansion field is normalized.
    normalized = dict(metadata)
    normalized["recorded_expansion"] = recorded
    normalized["expansion"] = None
    meta_path.write_text(json.dumps(normalized, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    try:
        checked = verify_checkpoint_metadata(
            path,
            cohort_manifest=cohort_manifest,
            kind="nuisance_training_features",
            fold=fold,
            expansion=None,
            training_ids=training_ids,
            held_ids=held_ids,
            configuration=configuration,
        )
    finally:
        meta_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    checked["recorded_expansion"] = recorded
    return checked


def _read_verified_training_rows(
    paths: list[Path],
    *,
    cohort_manifest: dict,
    fold: int,
    training_ids: frozenset[str],
    held_ids: frozenset[str],
    configuration: dict,
) -> list[NuisanceTrainingRow]:
    rows: list[NuisanceTrainingRow] = []
    expansions: set[str] = set()
    for path in paths:
        meta_path = path.with_name(path.name.replace(".jsonl.gz", ".meta.json"))
        try:
            metadata = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SystemExit(f"{path}: missing or corrupt checkpoint metadata") from exc
        expansion = metadata.get("expansion")
        if expansion not in CORE_DEVELOPMENT_ENVIRONMENTS:
            raise SystemExit(f"{path}: unexpected feature-shard expansion {expansion!r}")
        if expansion in expansions:
            raise SystemExit(f"duplicate feature checkpoint for expansion {expansion}")
        verify_checkpoint_metadata(
            path,
            cohort_manifest=cohort_manifest,
            kind="nuisance_training_features",
            fold=fold,
            expansion=expansion,
            training_ids=training_ids,
            held_ids=held_ids,
            configuration=configuration,
        )
        expansions.add(expansion)
        count_before = len(rows)
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    rows.append(NuisanceTrainingRow(**json.loads(line)))
        if len(rows) - count_before != metadata.get("row_count"):
            raise SystemExit(f"{path}: feature checkpoint row count mismatch")
    if expansions != set(CORE_DEVELOPMENT_ENVIRONMENTS):
        missing = sorted(set(CORE_DEVELOPMENT_ENVIRONMENTS) - expansions)
        raise SystemExit(f"incomplete feature checkpoint set; missing={missing}")
    return rows


def _read_verified_predictions(
    paths: list[Path],
    *,
    cohort_manifest: dict,
    expected_folds: set[int],
    train,
    validation,
    configuration: dict,
) -> list[NuisancePrediction]:
    predictions: list[NuisancePrediction] = []
    seen_folds: set[int] = set()
    for path in paths:
        meta_path = path.with_name(path.name.replace(".jsonl.gz", ".meta.json"))
        try:
            metadata = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SystemExit(f"{path}: missing or corrupt nuisance metadata") from exc
        fold = int(metadata.get("fold"))
        if fold not in expected_folds or fold in seen_folds:
            raise SystemExit(f"{path}: unexpected or duplicate nuisance fold {fold}")
        training_ids, outer_held = _outer_fold_parts(train, fold, configuration["nuisance_folds"])
        held_ids = (
            frozenset(row.draft_id for row in validation)
            if fold == -1
            else outer_held
        )
        verify_checkpoint_metadata(
            path,
            cohort_manifest=cohort_manifest,
            kind="nuisance_predictions",
            fold=fold,
            expansion=None,
            training_ids=training_ids,
            held_ids=held_ids,
            configuration=configuration,
        )
        count_before = len(predictions)
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    predictions.append(NuisancePrediction(**json.loads(line)))
        if len(predictions) - count_before != metadata.get("row_count"):
            raise SystemExit(f"{path}: nuisance checkpoint row count mismatch")
        seen_folds.add(fold)
    if seen_folds != expected_folds:
        raise SystemExit(f"incomplete nuisance checkpoint folds: {sorted(expected_folds - seen_folds)}")
    return predictions


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--draft-archive",
        action="append",
        type=Path,
        default=[],
        help="repeat once per Premier environment",
    )
    parser.add_argument(
        "--game-archive",
        action="append",
        type=Path,
        default=[],
        help="repeat in the same environment order as --draft-archive",
    )
    parser.add_argument(
        "--prepare-development-cohort",
        action="store_true",
        help="materialize one immutable train/validation-only cohort checkpoint and exit",
    )
    parser.add_argument(
        "--preprocessed-cohort",
        type=Path,
        help="directory containing cohort-manifest.json and compact development payloads",
    )
    parser.add_argument("--out", type=Path, default=Path("results/contextual-value-v1"))
    parser.add_argument("--max-drafts", type=int,
                        help="deterministic pooled draft cap; omit for full archive")
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
        help="materialize one outer-fold (or -1 validation) nuisance feature shard and exit",
    )
    parser.add_argument(
        "--train-nuisance-expansion",
        help="environment to materialize with --train-nuisance-feature-shard",
    )
    parser.add_argument(
        "--assemble-train-nuisance-fold",
        type=int,
        help="fit/predict one outer fold, or -1 validation, from feature shards",
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
        help="repeat for precomputed outer-fold train nuisance predictions",
    )
    parser.add_argument(
        "--precomputed-validation-nuisance",
        type=Path,
        help="precomputed validation nuisance predictions from fold -1",
    )
    return parser.parse_args(argv)


def _load_raw(args):
    if not args.draft_archive or not args.game_archive:
        raise SystemExit("raw mode requires --draft-archive and --game-archive")
    if len(args.draft_archive) != len(args.game_archive):
        raise SystemExit("--draft-archive and --game-archive counts must match")
    started = time.perf_counter()
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
    _emit_stage(
        "load_and_global_cap_draft_archives",
        started,
        decisions=len(decisions),
        drafts=len({row.draft_id for row in decisions}),
    )
    return manifests, decisions


def main(argv=None):
    args = parse_args(argv)
    if args.preprocessed_cohort and (args.draft_archive or args.game_archive):
        raise SystemExit("choose raw archives or --preprocessed-cohort, not both")
    if args.prepare_development_cohort and args.preprocessed_cohort:
        raise SystemExit("cohort preparation requires raw archives")

    configuration = _checkpoint_configuration(args)
    args.out.mkdir(parents=True, exist_ok=True)

    if args.prepare_development_cohort:
        manifests, selected = _load_raw(args)
        manifest = build_cohort_manifest(
            manifests,
            selected,
            max_drafts=args.max_drafts,
            nuisance_folds=args.nuisance_folds,
            inner_feature_folds=args.inner_feature_folds,
        )
        development_ids = frozenset(
            row["draft_id"] for row in manifest["selected_drafts"]
            if row["split"] in {"train", "validation"}
        )
        started = time.perf_counter()
        games = GameStore.from_archives(args.game_archive, development_ids)
        _emit_stage(
            "scan_game_archives_for_development_cohort",
            started,
            game_drafts=len(games.drafts),
            development_drafts=len(development_ids),
        )
        started = time.perf_counter()
        write_preprocessed_cohort(args.out, selected, games, manifest)
        write_manifest(manifests, args.out / "archive-manifest.json")
        _emit_stage(
            "write_preprocessed_development_cohort",
            started,
            selected_drafts=len(manifest["selected_drafts"]),
            development_decisions=sum(
                draft_split(row.draft_id) != "assessment" for row in selected
            ),
            assessment_drafts=manifest["split_counts"]["assessment"],
        )
        print(json.dumps({
            "mode": "prepare_development_cohort",
            "cohort_id": manifest["cohort_id"],
            "selected_drafts_sha256": manifest["selected_drafts_sha256"],
            "split_counts": manifest["split_counts"],
            "assessment_outcomes_serialized": False,
            "assessment_opened": False,
            "out": str(args.out),
        }, indent=2), flush=True)
        return

    if args.preprocessed_cohort:
        started = time.perf_counter()
        decisions, games, cohort_manifest = load_preprocessed_cohort(args.preprocessed_cohort)
        expected_cap = cohort_manifest["configuration"].get("max_drafts")
        if args.max_drafts is not None and expected_cap != args.max_drafts:
            raise SystemExit("preprocessed cohort max_drafts does not match requested cap")
        _emit_stage(
            "load_preprocessed_development_cohort",
            started,
            decisions=len(decisions),
            development_drafts=len({row.draft_id for row in decisions}),
            game_drafts=len(games.drafts),
        )
        manifests = []
        assessment_count = int(cohort_manifest["split_counts"]["assessment"])
    else:
        manifests, decisions = _load_raw(args)
        all_ids = frozenset(row.draft_id for row in decisions)
        started = time.perf_counter()
        games = GameStore.from_archives(args.game_archive, all_ids)
        _emit_stage("scan_game_archives", started, game_drafts=len(games.drafts))
        cohort_manifest = build_cohort_manifest(
            manifests,
            decisions,
            max_drafts=args.max_drafts,
            nuisance_folds=args.nuisance_folds,
            inner_feature_folds=args.inner_feature_folds,
        )
        assessment_count = int(cohort_manifest["split_counts"]["assessment"])
        write_manifest(manifests, args.out / "archive-manifest.json")

    if not games.drafts:
        raise SystemExit("no eligible development draft IDs matched the game archive")
    provider = ArchiveSignalProvider(decisions, games)
    train = [row for row in decisions if draft_split(row.draft_id) == "train"]
    validation = [row for row in decisions if draft_split(row.draft_id) == "validation"]

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
        if args.train_nuisance_expansion not in CORE_DEVELOPMENT_ENVIRONMENTS:
            raise SystemExit("feature shard expansion is outside the core development pool")
        if (
            args.precomputed_train_feature_shard
            or args.precomputed_train_nuisance
            or args.precomputed_validation_nuisance
        ):
            raise SystemExit("feature-shard mode cannot consume precomputed nuisance artifacts")
        fold = args.train_nuisance_feature_shard
        training_ids, outer_held = _outer_fold_parts(train, fold, args.nuisance_folds)
        held_ids = (
            frozenset(row.draft_id for row in validation)
            if fold == -1
            else outer_held
        )
        started = time.perf_counter()
        rows = build_fold_training_rows(
            train,
            training_ids,
            signal_provider=provider,
            inner_feature_folds=args.inner_feature_folds,
            expansion=args.train_nuisance_expansion,
            progress_callback=_progress(
                "materialize_nuisance_feature_shard",
                fold=fold,
                expansion=args.train_nuisance_expansion,
            ),
        )
        _emit_stage(
            "materialize_nuisance_feature_shard",
            started,
            fold=fold,
            expansion=args.train_nuisance_expansion,
            rows=len(rows),
            training_drafts=len(training_ids),
        )
        output = args.out / (
            f"train-feature-fold-{fold}-{args.train_nuisance_expansion}.jsonl.gz"
        )
        _write_training_rows(output, rows)
        write_checkpoint_metadata(
            output,
            kind="nuisance_training_features",
            cohort_manifest=cohort_manifest,
            fold=fold,
            expansion=args.train_nuisance_expansion,
            training_ids=training_ids,
            held_ids=held_ids,
            configuration=configuration,
            row_count=len(rows),
        )
        (args.out / "feature-shard-report.json").write_text(
            json.dumps({
                "scope": "development_only",
                "assessment_opened": False,
                "cohort_id": cohort_manifest["cohort_id"],
                "fold": fold,
                "nuisance_folds": args.nuisance_folds,
                "expansion": args.train_nuisance_expansion,
                "row_count": len(rows),
                "training_drafts": len(training_ids),
                "held_drafts": len(held_ids),
            }, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
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
        if args.precomputed_train_nuisance or args.precomputed_validation_nuisance:
            raise SystemExit("fold assembly cannot consume completed nuisance predictions")
        fold = args.assemble_train_nuisance_fold
        training_ids, outer_held = _outer_fold_parts(train, fold, args.nuisance_folds)
        held = validation if fold == -1 else [
            row for row in train if row.draft_id in outer_held
        ]
        held_ids = frozenset(row.draft_id for row in held)

        started = time.perf_counter()
        rows = _read_verified_training_rows(
            args.precomputed_train_feature_shard,
            cohort_manifest=cohort_manifest,
            fold=fold,
            training_ids=training_ids,
            held_ids=held_ids,
            configuration=configuration,
        )
        expected = {
            row.decision_id for row in train if row.draft_id in training_ids
        }
        observed = {row.decision_id for row in rows}
        if len(observed) != len(rows) or observed != expected:
            missing = sorted(expected - observed)[:3]
            extra = sorted(observed - expected)[:3]
            raise SystemExit(
                "precomputed feature shards do not exactly cover nuisance training rows; "
                f"missing={missing} extra={extra}"
            )
        _emit_stage("read_and_verify_feature_checkpoints", started, fold=fold, rows=len(rows))

        started = time.perf_counter()
        fit = fit_fold_from_training_rows(
            rows,
            training_ids,
            propensity_l2=args.propensity_l2,
            outcome_l2=args.outcome_l2,
            fold=fold,
        )
        _emit_stage("fit_nuisance_fold", started, fold=fold, feature_rows=len(rows))

        started = time.perf_counter()
        predictions = sorted(
            predict_fold(fit, held, signal_provider=provider),
            key=lambda item: item.decision_id,
        )
        _emit_stage(
            "predict_nuisance_fold",
            started,
            fold=fold,
            held_decisions=len(held),
            predictions=len(predictions),
        )
        output = (
            args.out / "validation-nuisance.jsonl.gz"
            if fold == -1
            else args.out / f"train-nuisance-fold-{fold}.jsonl.gz"
        )
        _write_predictions(output, predictions)
        write_checkpoint_metadata(
            output,
            kind="nuisance_predictions",
            cohort_manifest=cohort_manifest,
            fold=fold,
            expansion=None,
            training_ids=training_ids,
            held_ids=held_ids,
            configuration=configuration,
            row_count=len(predictions),
        )
        (args.out / "fold-report.json").write_text(
            json.dumps({
                "scope": "development_only",
                "assessment_opened": False,
                "cohort_id": cohort_manifest["cohort_id"],
                "fold": fold,
                "nuisance_folds": args.nuisance_folds,
                "prediction_count": len(predictions),
                "held_drafts": len(held_ids),
                "feature_rows": len(rows),
            }, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return

    if args.train_nuisance_fold is not None:
        if (
            args.precomputed_train_feature_shard
            or args.precomputed_train_nuisance
            or args.precomputed_validation_nuisance
        ):
            raise SystemExit(
                "--train-nuisance-fold cannot be combined with precomputed nuisance files"
            )
        started = time.perf_counter()
        predictions = crossfit_nuisance_fold(
            train,
            args.train_nuisance_fold,
            folds=args.nuisance_folds,
            signal_provider=provider,
            propensity_l2=args.propensity_l2,
            outcome_l2=args.outcome_l2,
            inner_feature_folds=args.inner_feature_folds,
        )
        _emit_stage(
            "monolithic_train_nuisance_fold",
            started,
            fold=args.train_nuisance_fold,
            predictions=len(predictions),
        )
        output = args.out / f"train-nuisance-fold-{args.train_nuisance_fold}.jsonl.gz"
        _write_predictions(output, predictions)
        return

    train_precomputed = (
        _read_verified_predictions(
            args.precomputed_train_nuisance,
            cohort_manifest=cohort_manifest,
            expected_folds=set(range(args.nuisance_folds)),
            train=train,
            validation=validation,
            configuration=configuration,
        )
        if args.precomputed_train_nuisance
        else None
    )
    validation_precomputed = (
        _read_verified_predictions(
            [args.precomputed_validation_nuisance],
            cohort_manifest=cohort_manifest,
            expected_folds={-1},
            train=train,
            validation=validation,
            configuration=configuration,
        )
        if args.precomputed_validation_nuisance
        else None
    )

    started = time.perf_counter()
    report, train_predictions, validation_predictions, value_model = run_development(
        decisions,
        signal_provider=provider,
        nuisance_folds=args.nuisance_folds,
        inner_feature_folds=args.inner_feature_folds,
        propensity_l2=args.propensity_l2,
        outcome_l2=args.outcome_l2,
        value_l2=args.value_l2,
        train_predictions=train_precomputed,
        validation_predictions=validation_precomputed,
        assessment_draft_count=assessment_count,
    )
    _emit_stage(
        "run_pooled_development",
        started,
        train_predictions=len(train_predictions),
        validation_predictions=len(validation_predictions),
    )
    report["cohort"] = {
        "cohort_id": cohort_manifest["cohort_id"],
        "selected_drafts_sha256": cohort_manifest["selected_drafts_sha256"],
        "assessment_outcomes_serialized": cohort_manifest["assessment_outcomes_serialized"],
    }
    if args.preprocessed_cohort:
        if report["assessment_boundary"]["outcomes_loaded_into_pipeline"]:
            raise SystemExit("assessment outcomes entered preprocessed development pipeline")
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
            "cohort_id": cohort_manifest["cohort_id"],
        }, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "decisions": len(decisions),
        "development_drafts": len({row.draft_id for row in decisions}),
        "assessment_drafts_withheld": assessment_count,
        "game_drafts_matched": len(games.drafts),
        "assessment_opened": False,
        "selected_temperature": report["models"]["G_contextual_value"][
            "selected_validation_temperature"
        ],
        "selected_simple_blend": report["models"]["E_simple_behavior_outcome_blend"][
            "selected_validation_config"
        ],
        "out": str(args.out),
    }, indent=2), flush=True)


if __name__ == "__main__":
    main()
