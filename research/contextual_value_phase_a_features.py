#!/usr/bin/env python3
"""Materialize reusable rich pre-pick feature artifacts for #529 Phase A."""

from __future__ import annotations

import argparse
import gzip
import io
import json
import math
import os
import time
import urllib.parse
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path
from typing import Iterable, Mapping, Sequence

import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from scripts.fetch_card_metadata import (
    aliases,
    choose_main_printing,
    face_for_alias,
    fetch_named,
    request_json,
)

from contextual_value.checkpoint import (
    draft_id_sha256,
    load_preprocessed_cohort,
)
from contextual_value.dataset import Decision, draft_split
from contextual_value.nuisance import NuisanceTrainingRow, nuisance_fold
from contextual_value.rich_features import rich_feature_bundle
from contextual_value.schema import file_sha256

SOURCE_RUN = 36256947308
SOURCE_SHA = "aa5b17d96b43f3ce08f52fad55ba17f327472c1b"
ABLATION_RUN = 36280148906
CORE = ("MSH", "SOS", "ECL", "TLA")
MIN_OVERALL_METADATA_COVERAGE = 0.99
MIN_SET_METADATA_COVERAGE = 0.98


def parse_args():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="mode", required=True)

    metadata = sub.add_parser("metadata")
    metadata.add_argument("--cohort-dir", type=Path, required=True)
    metadata.add_argument("--source-sha", required=True)
    metadata.add_argument("--out", type=Path, required=True)

    fold = sub.add_parser("materialize-fold")
    fold.add_argument("--fold", type=int, required=True)
    fold.add_argument("--cohort-dir", type=Path, required=True)
    fold.add_argument("--metadata", type=Path, required=True)
    fold.add_argument("--metadata-report", type=Path, required=True)
    fold.add_argument("--feature-shard", action="append", type=Path, required=True)
    fold.add_argument("--held-features", type=Path, required=True)
    fold.add_argument("--held-report", type=Path, required=True)
    fold.add_argument("--source-sha", required=True)
    fold.add_argument("--out", type=Path, required=True)

    validate = sub.add_parser("validate")
    validate.add_argument("--metadata-report", type=Path, required=True)
    validate.add_argument("--fold-report", action="append", type=Path, required=True)
    validate.add_argument("--out", type=Path, required=True)
    return parser.parse_args()


def _load_cohort(root: Path, source_sha: str):
    if source_sha != SOURCE_SHA:
        raise SystemExit("unexpected frozen source SHA")
    prior = os.environ.pop("GITHUB_SHA", None)
    try:
        decisions, games, manifest = load_preprocessed_cohort(root)
    finally:
        if prior is not None:
            os.environ["GITHUB_SHA"] = prior
    if manifest.get("code_revision") != source_sha:
        raise SystemExit("cohort source revision mismatch")
    if manifest.get("assessment_outcomes_serialized") is not False:
        raise SystemExit("assessment outcomes were serialized")
    if any(draft_split(row.draft_id) == "assessment" for row in decisions):
        raise SystemExit("assessment decision entered development cohort")
    return decisions, games, manifest


def _write_json_gz(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as raw:
        with gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) as zipped:
            with io.TextIOWrapper(zipped, encoding="utf-8") as handle:
                json.dump(payload, handle, sort_keys=True, separators=(",", ":"))
                handle.write("\n")


def _read_json_gz(path: Path):
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def _iter_jsonl_gz(path: Path):
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


class _JsonlGzWriter:
    def __init__(self, path: Path):
        self.path = path
        self.raw = None
        self.zipped = None
        self.handle = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.raw = self.path.open("wb")
        self.zipped = gzip.GzipFile(filename="", fileobj=self.raw, mode="wb", mtime=0)
        self.handle = io.TextIOWrapper(self.zipped, encoding="utf-8")
        return self

    def write(self, payload: Mapping[str, object]):
        assert self.handle is not None
        self.handle.write(json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n")

    def __exit__(self, exc_type, exc, tb):
        assert self.handle is not None
        assert self.raw is not None
        self.handle.close()
        if not self.raw.closed:
            self.raw.flush()
            self.raw.close()
        return False


def _parts(train: Sequence[Decision], validation: Sequence[Decision], fold: int):
    all_ids = frozenset(row.draft_id for row in train)
    if fold == -1:
        held = list(validation)
        return all_ids, frozenset(row.draft_id for row in held), held
    if fold < 0 or fold >= 5:
        raise SystemExit("fold must be -1 or 0..4")
    held_ids = frozenset(
        draft_id
        for draft_id in all_ids
        if nuisance_fold(draft_id, 5) == fold
    )
    training_ids = frozenset(all_ids - held_ids)
    held = [row for row in train if row.draft_id in held_ids]
    if not training_ids or not held_ids or not held:
        raise SystemExit("empty nuisance fold partition")
    return training_ids, held_ids, held


def _rich_metadata_for_alias(card: Mapping[str, object], alias: str, expansion: str) -> dict:
    source = face_for_alias(dict(card), alias) or card
    raw_colors = source.get("colors")
    if raw_colors is None:
        raw_colors = card.get("colors") or []
    identity = card.get("color_identity") or []
    try:
        cmc = float(card.get("cmc") or 0.0)
    except (TypeError, ValueError):
        cmc = 0.0
    if not math.isfinite(cmc):
        cmc = 0.0
    card_set = str(card.get("set") or "").upper()
    return {
        "name": alias,
        "cmc": max(0.0, cmc),
        "mana_cost": str(source.get("mana_cost") or card.get("mana_cost") or ""),
        "colors": [str(value).upper() for value in raw_colors or []],
        "color_identity": [str(value).upper() for value in identity or []],
        "rarity": str(card.get("rarity") or "") if card_set == expansion.upper() else "",
        "type_line": str(source.get("type_line") or card.get("type_line") or ""),
        "oracle_text": str(source.get("oracle_text") or card.get("oracle_text") or ""),
        "keywords": [str(value) for value in card.get("keywords") or []],
        "scryfall_id": str(card.get("id") or ""),
        "printing_set": card_set,
        "printing_matches_expansion": card_set == expansion.upper(),
    }


def _fetch_rich_set(expansion: str, wanted: set[str]) -> tuple[dict[str, dict], list[str]]:
    query = urllib.parse.quote(f"e:{expansion.lower()}")
    url = f"https://api.scryfall.com/cards/search?q={query}&unique=prints&order=set"
    candidates: dict[str, list[dict]] = defaultdict(list)
    while url:
        page = request_json(url)
        for card in page.get("data", []):
            for name in aliases(card):
                if name in wanted:
                    candidates[name].append(card)
        url = page.get("next_page") if page.get("has_more") else None
        if url:
            time.sleep(0.15)

    records: dict[str, dict] = {}
    for name, options in candidates.items():
        chosen = choose_main_printing(options, name, expansion)
        if chosen is not None:
            records[name] = _rich_metadata_for_alias(chosen, name, expansion)

    missing = sorted(wanted - records.keys())
    for index, name in enumerate(missing, start=1):
        card = fetch_named(name, expansion)
        if card is not None:
            records[name] = _rich_metadata_for_alias(card, name, expansion)
        if index < len(missing):
            time.sleep(0.12)
    return records, sorted(wanted - records.keys())


def run_metadata(args):
    decisions, _games, manifest = _load_cohort(args.cohort_dir, args.source_sha)
    names_by_set: dict[str, set[str]] = {expansion: set() for expansion in CORE}
    for decision in decisions:
        if decision.expansion not in names_by_set:
            raise SystemExit(f"unexpected development environment {decision.expansion}")
        names_by_set[decision.expansion].update(decision.candidates)
        names_by_set[decision.expansion].update(name for name, _count in decision.pool)

    records: dict[str, dict[str, dict]] = {}
    coverage: dict[str, dict[str, object]] = {}
    total_wanted = 0
    total_resolved = 0
    all_unresolved: dict[str, list[str]] = {}
    for expansion in CORE:
        wanted = names_by_set[expansion]
        resolved, unresolved = _fetch_rich_set(expansion, wanted)
        records[expansion] = resolved
        total_wanted += len(wanted)
        total_resolved += len(resolved)
        set_coverage = len(resolved) / max(1, len(wanted))
        set_match = sum(
            bool(row.get("printing_matches_expansion"))
            for row in resolved.values()
        )
        coverage[expansion] = {
            "wanted_names": len(wanted),
            "resolved_names": len(resolved),
            "coverage": set_coverage,
            "matching_printing_rarity_names": set_match,
            "matching_printing_rarity_fraction": set_match / max(1, len(wanted)),
            "unresolved": unresolved,
        }
        if set_coverage < MIN_SET_METADATA_COVERAGE:
            raise SystemExit(
                f"{expansion}: metadata coverage {set_coverage:.2%} below "
                f"{MIN_SET_METADATA_COVERAGE:.2%}"
            )
        if unresolved:
            all_unresolved[expansion] = unresolved

    overall = total_resolved / max(1, total_wanted)
    if overall < MIN_OVERALL_METADATA_COVERAGE:
        raise SystemExit(
            f"overall metadata coverage {overall:.2%} below "
            f"{MIN_OVERALL_METADATA_COVERAGE:.2%}"
        )

    args.out.mkdir(parents=True, exist_ok=True)
    payload_path = args.out / "phase-a-card-metadata.json.gz"
    _write_json_gz(payload_path, records)
    report = {
        "scope": "development_only",
        "source_run": SOURCE_RUN,
        "source_sha": SOURCE_SHA,
        "cohort_id": manifest["cohort_id"],
        "metadata_source": "Scryfall set search with named-card fallback",
        "metadata_payload_sha256": file_sha256(payload_path),
        "overall": {
            "wanted_names_by_environment_sum": total_wanted,
            "resolved_names_by_environment_sum": total_resolved,
            "coverage": overall,
        },
        "by_environment": coverage,
        "unresolved": all_unresolved,
        "assessment_opened": False,
        "assessment_outcomes_used": False,
    }
    (args.out / "phase-a-card-metadata-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report["overall"], sort_keys=True))


def _verify_source_shard(
    path: Path,
    *,
    expansion: str,
    fold: int,
    manifest: Mapping[str, object],
    training_ids: frozenset[str],
    held_ids: frozenset[str],
):
    meta_path = path.with_name(path.name.replace(".jsonl.gz", ".meta.json"))
    metadata = json.loads(meta_path.read_text(encoding="utf-8"))
    expected = {
        "kind": "nuisance_training_features",
        "cohort_id": manifest["cohort_id"],
        "selected_drafts_sha256": manifest["selected_drafts_sha256"],
        "code_revision": SOURCE_SHA,
        "fold": fold,
        "expansion": expansion,
        "training_drafts_sha256": draft_id_sha256(training_ids),
        "held_drafts_sha256": draft_id_sha256(held_ids),
        "payload_sha256": file_sha256(path),
    }
    for key, value in expected.items():
        if metadata.get(key) != value:
            raise SystemExit(f"{path}: incompatible source checkpoint {key}")
    return metadata


def _verify_held(
    report_path: Path,
    *,
    fold: int,
    manifest: Mapping[str, object],
):
    report = json.loads(report_path.read_text(encoding="utf-8"))
    expected = {
        "scope": "development_only",
        "source_run": SOURCE_RUN,
        "source_sha": SOURCE_SHA,
        "cohort_id": manifest["cohort_id"],
        "fold": fold,
        "assessment_opened": False,
        "assessment_outcomes_used": False,
    }
    for key, value in expected.items():
        if report.get(key) != value:
            raise SystemExit(f"{report_path}: incompatible held checkpoint {key}")
    return report


def _metadata_counts(
    decision: Decision,
    candidates: Mapping[str, Mapping[str, float]],
    state: Mapping[str, float],
):
    candidate_total = len(decision.candidates)
    candidate_missing = sum(
        int(row.get("card:metadata_missing", 0.0) > 0.5)
        for row in candidates.values()
    )
    pool_total = sum(count for _name, count in decision.pool)
    pool_missing = float(state.get("state:pool_metadata_missing_share", 0.0)) * max(1, pool_total)
    return candidate_total, candidate_missing, pool_total, pool_missing


def _materialized_row(
    decision: Decision,
    *,
    role: str,
    fold: int,
    training_draft_count: int,
    base_features: Mapping[str, Mapping[str, float]],
    metadata_by_name: Mapping[str, Mapping[str, object]],
    sample_weight: float | None,
    outcome: float,
):
    state, candidates = rich_feature_bundle(
        decision,
        base_features,
        metadata_by_name,
    )
    payload = {
        "decision_id": decision.decision_id,
        "draft_id": decision.draft_id,
        "fold": fold,
        "role": role,
        "training_draft_count": training_draft_count,
        "expansion": decision.expansion,
        "selected_action": decision.selected_card,
        "outcome": float(outcome),
        "state_features": state,
        "candidate_features": candidates,
    }
    if sample_weight is not None:
        payload["sample_weight"] = float(sample_weight)
    return payload, state, candidates


def run_materialize_fold(args):
    decisions, _games, manifest = _load_cohort(args.cohort_dir, args.source_sha)
    train = [row for row in decisions if draft_split(row.draft_id) == "train"]
    validation = [row for row in decisions if draft_split(row.draft_id) == "validation"]
    training_ids, held_ids, held = _parts(train, validation, args.fold)
    by_id = {row.decision_id: row for row in decisions}

    metadata_report = json.loads(args.metadata_report.read_text(encoding="utf-8"))
    if metadata_report.get("source_sha") != SOURCE_SHA:
        raise SystemExit("metadata source SHA mismatch")
    if metadata_report.get("cohort_id") != manifest["cohort_id"]:
        raise SystemExit("metadata cohort mismatch")
    if metadata_report.get("assessment_opened") is not False:
        raise SystemExit("metadata artifact violated assessment boundary")
    metadata = _read_json_gz(args.metadata)
    if file_sha256(args.metadata) != metadata_report.get("metadata_payload_sha256"):
        raise SystemExit("metadata payload hash mismatch")
    if set(metadata) != set(CORE):
        raise SystemExit("metadata artifact does not contain exact core environments")

    _verify_held(
        args.held_report,
        fold=args.fold,
        manifest=manifest,
    )

    args.out.mkdir(parents=True, exist_ok=True)
    output = args.out / f"phase-a-rich-fold-{args.fold}.jsonl.gz"

    seen: set[str] = set()
    counts = {
        "train_decisions": 0,
        "held_decisions": 0,
        "candidate_opportunities": 0,
        "candidate_metadata_missing": 0,
        "pool_card_copies": 0,
        "pool_metadata_missing_copies": 0.0,
    }
    state_names: set[str] = set()
    candidate_names: set[str] = set()
    expansion_rows = defaultdict(int)

    source_by_expansion = {}
    for path in args.feature_shard:
        name = path.name
        expansion = next(
            (candidate for candidate in CORE if f"-{candidate}.jsonl.gz" in name),
            None,
        )
        if expansion is None or expansion in source_by_expansion:
            raise SystemExit(f"cannot identify unique expansion for {path}")
        _verify_source_shard(
            path,
            expansion=expansion,
            fold=args.fold,
            manifest=manifest,
            training_ids=training_ids,
            held_ids=held_ids,
        )
        source_by_expansion[expansion] = path
    if set(source_by_expansion) != set(CORE):
        raise SystemExit("source feature shards do not cover all four core environments")

    with _JsonlGzWriter(output) as writer:
        for expansion in CORE:
            path = source_by_expansion[expansion]
            for raw in _iter_jsonl_gz(path):
                row = NuisanceTrainingRow(**raw)
                decision = by_id.get(row.decision_id)
                if decision is None:
                    raise SystemExit("source training row missing from frozen cohort")
                if decision.draft_id not in training_ids or decision.expansion != expansion:
                    raise SystemExit("source training row outside expected outer complement")
                if row.decision_id in seen:
                    raise SystemExit("duplicate materialized decision")
                payload, state, candidates = _materialized_row(
                    decision,
                    role="train",
                    fold=args.fold,
                    training_draft_count=len(training_ids),
                    base_features=row.features,
                    metadata_by_name=metadata[expansion],
                    sample_weight=row.sample_weight,
                    outcome=row.outcome,
                )
                writer.write(payload)
                seen.add(row.decision_id)
                counts["train_decisions"] += 1
                expansion_rows[expansion] += 1
                ctotal, cmissing, ptotal, pmissing = _metadata_counts(
                    decision, candidates, state
                )
                counts["candidate_opportunities"] += ctotal
                counts["candidate_metadata_missing"] += cmissing
                counts["pool_card_copies"] += ptotal
                counts["pool_metadata_missing_copies"] += pmissing
                state_names.update(state)
                for candidate_row in candidates.values():
                    candidate_names.update(candidate_row)

        held_source = {
            row["decision_id"]: row
            for row in _iter_jsonl_gz(args.held_features)
        }
        expected_held = {row.decision_id for row in held}
        if set(held_source) != expected_held:
            raise SystemExit("held feature checkpoint does not exactly cover held decisions")

        for decision in held:
            raw = held_source[decision.decision_id]
            if int(raw.get("fold")) != args.fold:
                raise SystemExit("held feature fold mismatch")
            if int(raw.get("training_draft_count")) != len(training_ids):
                raise SystemExit("held feature training-draft provenance mismatch")
            if decision.decision_id in seen:
                raise SystemExit("train/held decision overlap")
            payload, state, candidates = _materialized_row(
                decision,
                role="held",
                fold=args.fold,
                training_draft_count=len(training_ids),
                base_features=raw["features"],
                metadata_by_name=metadata[decision.expansion],
                sample_weight=None,
                outcome=float(raw["outcome"]),
            )
            writer.write(payload)
            seen.add(decision.decision_id)
            counts["held_decisions"] += 1
            expansion_rows[decision.expansion] += 1
            ctotal, cmissing, ptotal, pmissing = _metadata_counts(
                decision, candidates, state
            )
            counts["candidate_opportunities"] += ctotal
            counts["candidate_metadata_missing"] += cmissing
            counts["pool_card_copies"] += ptotal
            counts["pool_metadata_missing_copies"] += pmissing
            state_names.update(state)
            for candidate_row in candidates.values():
                candidate_names.update(candidate_row)

    expected_train = {
        row.decision_id
        for row in train
        if row.draft_id in training_ids
    }
    if counts["train_decisions"] != len(expected_train):
        raise SystemExit("rich training rows do not exactly cover training complement")
    if counts["held_decisions"] != len(held):
        raise SystemExit("rich held rows do not exactly cover held partition")

    all_names = state_names | candidate_names
    if any("strong_choice_probability" in name for name in all_names):
        raise SystemExit("strong-player choice leaked into rich ranking features")

    candidate_coverage = 1.0 - (
        counts["candidate_metadata_missing"] / max(1, counts["candidate_opportunities"])
    )
    pool_coverage = 1.0 - (
        counts["pool_metadata_missing_copies"] / max(1, counts["pool_card_copies"])
    )
    if candidate_coverage < MIN_OVERALL_METADATA_COVERAGE:
        raise SystemExit(f"candidate metadata coverage too low: {candidate_coverage:.2%}")
    if pool_coverage < MIN_OVERALL_METADATA_COVERAGE:
        raise SystemExit(f"pool metadata coverage too low: {pool_coverage:.2%}")

    report = {
        "scope": "development_only",
        "source_run": SOURCE_RUN,
        "source_sha": SOURCE_SHA,
        "ablation_run": ABLATION_RUN,
        "cohort_id": manifest["cohort_id"],
        "fold": args.fold,
        "training_drafts": len(training_ids),
        "held_drafts": len(held_ids),
        "rows": counts,
        "expansion_rows": dict(sorted(expansion_rows.items())),
        "candidate_metadata_coverage": candidate_coverage,
        "pool_metadata_coverage": pool_coverage,
        "state_feature_count": len(state_names),
        "candidate_feature_count": len(candidate_names),
        "state_feature_names": sorted(state_names),
        "candidate_feature_names": sorted(candidate_names),
        "ranking_strong_player_features_removed": True,
        "factorized_state_features": True,
        "payload_sha256": file_sha256(output),
        "payload_size_bytes": output.stat().st_size,
        "assessment_opened": False,
        "assessment_outcomes_used": False,
    }
    (args.out / f"phase-a-rich-fold-{args.fold}-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "fold": args.fold,
        "candidate_metadata_coverage": candidate_coverage,
        "pool_metadata_coverage": pool_coverage,
        "payload_size_bytes": output.stat().st_size,
        "state_feature_count": len(state_names),
        "candidate_feature_count": len(candidate_names),
    }, sort_keys=True))


def run_validate(args):
    metadata = json.loads(args.metadata_report.read_text(encoding="utf-8"))
    reports = [
        json.loads(path.read_text(encoding="utf-8"))
        for path in args.fold_report
    ]
    by_fold = {int(row["fold"]): row for row in reports}
    if set(by_fold) != {-1, 0, 1, 2, 3, 4} or len(by_fold) != len(reports):
        raise SystemExit("Phase A rich-feature fold reports are incomplete or duplicated")

    for fold, row in by_fold.items():
        if row.get("assessment_opened") is not False:
            raise SystemExit(f"fold {fold}: assessment boundary violation")
        if row.get("assessment_outcomes_used") is not False:
            raise SystemExit(f"fold {fold}: assessment outcome boundary violation")
        if row.get("ranking_strong_player_features_removed") is not True:
            raise SystemExit(f"fold {fold}: strong-player ranking feature retained")
        if row.get("factorized_state_features") is not True:
            raise SystemExit(f"fold {fold}: rich feature payload was not factorized")
        if float(row["candidate_metadata_coverage"]) < MIN_OVERALL_METADATA_COVERAGE:
            raise SystemExit(f"fold {fold}: candidate metadata coverage below threshold")
        if float(row["pool_metadata_coverage"]) < MIN_OVERALL_METADATA_COVERAGE:
            raise SystemExit(f"fold {fold}: pool metadata coverage below threshold")

    summary = {
        "scope": "development_only",
        "phase": "A1_rich_pre_pick_feature_materialization",
        "source_run": SOURCE_RUN,
        "source_sha": SOURCE_SHA,
        "ablation_run": ABLATION_RUN,
        "cohort_id": metadata["cohort_id"],
        "metadata": metadata,
        "folds": {
            str(fold): {
                "training_drafts": by_fold[fold]["training_drafts"],
                "held_drafts": by_fold[fold]["held_drafts"],
                "candidate_metadata_coverage": by_fold[fold]["candidate_metadata_coverage"],
                "pool_metadata_coverage": by_fold[fold]["pool_metadata_coverage"],
                "state_feature_count": by_fold[fold]["state_feature_count"],
                "candidate_feature_count": by_fold[fold]["candidate_feature_count"],
                "payload_size_bytes": by_fold[fold]["payload_size_bytes"],
                "payload_sha256": by_fold[fold]["payload_sha256"],
            }
            for fold in sorted(by_fold)
        },
        "assessment_opened": False,
        "assessment_outcomes_used": False,
        "ready_for_phase_a2_model_bakeoff": True,
    }
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "phase-a-rich-feature-report.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "ready_for_phase_a2_model_bakeoff": True,
        "folds": sorted(by_fold),
        "metadata_coverage": metadata["overall"]["coverage"],
    }, sort_keys=True))


def main():
    args = parse_args()
    if args.mode == "metadata":
        run_metadata(args)
    elif args.mode == "materialize-fold":
        run_materialize_fold(args)
    else:
        run_validate(args)


if __name__ == "__main__":
    main()
