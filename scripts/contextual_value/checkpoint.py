"""Immutable cohort and checkpoint provenance for contextual-value-v1."""

from __future__ import annotations

import gzip
import hashlib
import io
import json
import os
from collections import Counter
from dataclasses import asdict
from pathlib import Path
from typing import Iterable, Mapping, Sequence

from .archive import GameDraftSummary, GameStore
from .dataset import Decision, draft_split
from .nuisance import FEATURE_SPLIT_SALT, feature_fold, nuisance_fold
from .schema import ArchiveManifest, file_sha256

COHORT_SCHEMA_VERSION = 1
CHECKPOINT_SCHEMA_VERSION = 1
CORE_DEVELOPMENT_ENVIRONMENTS = ("MSH", "SOS", "ECL", "TLA")


def _canonical_json(value: object) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def canonical_sha256(value: object) -> str:
    return hashlib.sha256(_canonical_json(value)).hexdigest()


def draft_id_sha256(draft_ids: Iterable[str]) -> str:
    return canonical_sha256(sorted(set(draft_ids)))


def _decision_dict(decision: Decision) -> dict:
    return asdict(decision)


def _decision_from_dict(payload: Mapping[str, object]) -> Decision:
    row = dict(payload)
    row["candidates"] = tuple(row["candidates"])
    row["pool"] = tuple((str(card), int(count)) for card, count in row["pool"])
    return Decision(**row)


def _summary_dict(summary: GameDraftSummary) -> dict:
    return {
        "rows": summary.rows,
        "wins": summary.wins,
        "cards": summary.cards,
        "played": sorted(summary.played),
        "main_colours": dict(summary.main_colours),
    }


def _summary_from_dict(payload: Mapping[str, object]) -> GameDraftSummary:
    return GameDraftSummary(
        rows=int(payload["rows"]),
        wins=int(payload["wins"]),
        cards={
            str(card): {str(key): int(value) for key, value in dict(counts).items()}
            for card, counts in dict(payload["cards"]).items()
        },
        played=set(str(card) for card in payload["played"]),
        main_colours=Counter({
            str(key): int(value)
            for key, value in dict(payload["main_colours"]).items()
        }),
    )


def _write_gzip_jsonl(path: Path, rows: Sequence[Mapping[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as raw:
        with gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) as zipped:
            with io.TextIOWrapper(zipped, encoding="utf-8") as handle:
                for row in rows:
                    handle.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")


def _read_gzip_jsonl(path: Path) -> list[dict]:
    rows = []
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def build_cohort_manifest(
    manifests: Sequence[ArchiveManifest],
    selected_decisions: Sequence[Decision],
    *,
    max_drafts: int | None,
    nuisance_folds: int,
    inner_feature_folds: int,
) -> dict:
    by_draft: dict[str, Decision] = {}
    for decision in selected_decisions:
        prior = by_draft.setdefault(decision.draft_id, decision)
        if prior.expansion != decision.expansion:
            raise ValueError(f"{decision.draft_id}: cohort draft spans environments")

    selected = []
    for draft_id in sorted(by_draft):
        decision = by_draft[draft_id]
        split = draft_split(draft_id)
        selected.append({
            "draft_id": draft_id,
            "expansion": decision.expansion,
            "split": split,
            "nuisance_fold": nuisance_fold(draft_id, nuisance_folds) if split == "train" else None,
        })

    archive_rows = [
        {
            "path": manifest.path,
            "kind": manifest.kind,
            "sha256": manifest.sha256,
            "size_bytes": manifest.size_bytes,
        }
        for manifest in manifests
    ]
    payload = {
        "schema_version": COHORT_SCHEMA_VERSION,
        "scope": "development_only",
        "assessment_outcomes_serialized": False,
        "code_revision": os.environ.get("GITHUB_SHA", "local"),
        "configuration": {
            "max_drafts": max_drafts,
            "nuisance_folds": nuisance_folds,
            "inner_feature_folds": inner_feature_folds,
            "sample_salt": "contextual-value-v1-sample",
            "split_salt": "contextual-value-v1-outer",
            "core_environments": list(CORE_DEVELOPMENT_ENVIRONMENTS),
        },
        "archives": archive_rows,
        "selected_drafts": selected,
        "selected_drafts_sha256": canonical_sha256(selected),
        "split_counts": {
            split: sum(row["split"] == split for row in selected)
            for split in ("train", "validation", "assessment")
        },
    }
    payload["cohort_id"] = canonical_sha256(payload)
    return payload


def verify_cohort_manifest(manifest: Mapping[str, object]) -> None:
    payload = dict(manifest)
    cohort_id = payload.pop("cohort_id", None)
    if not isinstance(cohort_id, str) or canonical_sha256(payload) != cohort_id:
        raise ValueError("cohort manifest hash mismatch")
    if payload.get("schema_version") != COHORT_SCHEMA_VERSION:
        raise ValueError("unsupported cohort manifest schema")
    if payload.get("scope") != "development_only":
        raise ValueError("cohort manifest is not development-only")
    if payload.get("assessment_outcomes_serialized") is not False:
        raise ValueError("cohort manifest does not seal assessment outcomes")
    expected_revision = os.environ.get("GITHUB_SHA")
    if expected_revision is not None and payload.get("code_revision") != expected_revision:
        raise ValueError("cohort manifest code revision mismatch")
    selected = payload.get("selected_drafts")
    if not isinstance(selected, list) or not selected:
        raise ValueError("cohort manifest has no selected drafts")
    ids = [row.get("draft_id") for row in selected if isinstance(row, Mapping)]
    if len(ids) != len(selected) or len(ids) != len(set(ids)):
        raise ValueError("cohort manifest contains missing or duplicate draft IDs")
    if canonical_sha256(selected) != payload.get("selected_drafts_sha256"):
        raise ValueError("cohort selected-draft hash mismatch")


def write_preprocessed_cohort(
    root: Path,
    selected_decisions: Sequence[Decision],
    games: GameStore,
    manifest: Mapping[str, object],
) -> None:
    verify_cohort_manifest(manifest)
    selected = {
        str(row["draft_id"]): str(row["split"])
        for row in manifest["selected_drafts"]
    }
    development_ids = {
        draft_id for draft_id, split in selected.items()
        if split in {"train", "validation"}
    }
    assessment_ids = {
        draft_id for draft_id, split in selected.items()
        if split == "assessment"
    }
    development = [
        decision for decision in selected_decisions
        if decision.draft_id in development_ids
    ]
    if any(decision.draft_id in assessment_ids for decision in development):
        raise AssertionError("assessment decision entered development serialization")
    if set(games.drafts) - development_ids:
        raise ValueError("game preprocessing includes non-development draft IDs")

    root.mkdir(parents=True, exist_ok=True)
    _write_gzip_jsonl(
        root / "development-decisions.jsonl.gz",
        [_decision_dict(decision) for decision in development],
    )
    game_rows = [
        {"draft_id": draft_id, "summary": _summary_dict(games.drafts[draft_id])}
        for draft_id in sorted(games.drafts)
    ]
    _write_gzip_jsonl(root / "development-games.jsonl.gz", game_rows)
    (root / "cohort-manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def load_preprocessed_cohort(root: Path) -> tuple[list[Decision], GameStore, dict]:
    manifest = json.loads((root / "cohort-manifest.json").read_text(encoding="utf-8"))
    verify_cohort_manifest(manifest)
    decisions = [
        _decision_from_dict(row)
        for row in _read_gzip_jsonl(root / "development-decisions.jsonl.gz")
    ]
    if any(draft_split(row.draft_id) == "assessment" for row in decisions):
        raise ValueError("preprocessed cohort contains assessment decisions")

    game_rows = _read_gzip_jsonl(root / "development-games.jsonl.gz")
    game_map: dict[str, GameDraftSummary] = {}
    for row in game_rows:
        draft_id = str(row["draft_id"])
        if draft_id in game_map:
            raise ValueError("preprocessed games contain duplicate draft IDs")
        game_map[draft_id] = _summary_from_dict(row["summary"])

    development_ids = {
        str(row["draft_id"])
        for row in manifest["selected_drafts"]
        if row["split"] in {"train", "validation"}
    }
    decision_ids = {decision.draft_id for decision in decisions}
    if not decision_ids <= development_ids or not set(game_map) <= development_ids:
        raise ValueError("preprocessed payload falls outside development cohort")
    return decisions, GameStore(game_map), manifest



def feature_complements_sha256(
    training_ids: Iterable[str],
    inner_feature_folds: int,
) -> str:
    ids = frozenset(training_ids)
    if len(ids) < 2:
        raise ValueError("feature complements require at least two training drafts")
    folds = max(2, min(int(inner_feature_folds), len(ids)))
    groups = []
    for fold in range(folds):
        held = frozenset(draft_id for draft_id in ids if feature_fold(draft_id, folds) == fold)
        if not held:
            continue
        complement = frozenset(ids - held)
        groups.append({
            "fold": fold,
            "held_drafts_sha256": draft_id_sha256(held),
            "complement_drafts_sha256": draft_id_sha256(complement),
        })
    return canonical_sha256({
        "salt": FEATURE_SPLIT_SALT,
        "inner_feature_folds": folds,
        "groups": groups,
    })

def checkpoint_meta_path(payload_path: Path) -> Path:
    name = payload_path.name
    for suffix in (".jsonl.gz", ".json.gz", ".gz"):
        if name.endswith(suffix):
            return payload_path.with_name(name[: -len(suffix)] + ".meta.json")
    return payload_path.with_name(name + ".meta.json")


def write_checkpoint_metadata(
    payload_path: Path,
    *,
    kind: str,
    cohort_manifest: Mapping[str, object],
    fold: int,
    expansion: str | None,
    training_ids: Iterable[str],
    held_ids: Iterable[str],
    configuration: Mapping[str, object],
    row_count: int,
) -> dict:
    verify_cohort_manifest(cohort_manifest)
    metadata = {
        "schema_version": CHECKPOINT_SCHEMA_VERSION,
        "kind": kind,
        "cohort_id": cohort_manifest["cohort_id"],
        "selected_drafts_sha256": cohort_manifest["selected_drafts_sha256"],
        "archive_sha256": [
            {
                "kind": row["kind"],
                "sha256": row["sha256"],
            }
            for row in cohort_manifest["archives"]
        ],
        "code_revision": os.environ.get("GITHUB_SHA", "local"),
        "fold": int(fold),
        "expansion": expansion,
        "training_drafts_sha256": draft_id_sha256(training_ids),
        "held_drafts_sha256": draft_id_sha256(held_ids),
        "feature_complements_sha256": feature_complements_sha256(
            training_ids,
            int(configuration["inner_feature_folds"]),
        ),
        "configuration": dict(configuration),
        "row_count": int(row_count),
        "payload_sha256": file_sha256(payload_path),
        "payload_size_bytes": payload_path.stat().st_size,
    }
    path = checkpoint_meta_path(payload_path)
    path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return metadata


def verify_checkpoint_metadata(
    payload_path: Path,
    *,
    cohort_manifest: Mapping[str, object],
    kind: str,
    fold: int,
    expansion: str | None,
    training_ids: Iterable[str],
    held_ids: Iterable[str],
    configuration: Mapping[str, object],
    require_code_revision: str | None = None,
) -> dict:
    verify_cohort_manifest(cohort_manifest)
    meta_path = checkpoint_meta_path(payload_path)
    try:
        metadata = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"{payload_path}: missing or corrupt checkpoint metadata") from exc
    if metadata.get("schema_version") != CHECKPOINT_SCHEMA_VERSION:
        raise ValueError(f"{payload_path}: unsupported checkpoint schema")
    expected = {
        "kind": kind,
        "cohort_id": cohort_manifest["cohort_id"],
        "selected_drafts_sha256": cohort_manifest["selected_drafts_sha256"],
        "archive_sha256": [
            {
                "kind": row["kind"],
                "sha256": row["sha256"],
            }
            for row in cohort_manifest["archives"]
        ],
        "fold": int(fold),
        "expansion": expansion,
        "training_drafts_sha256": draft_id_sha256(training_ids),
        "held_drafts_sha256": draft_id_sha256(held_ids),
        "feature_complements_sha256": feature_complements_sha256(
            training_ids,
            int(configuration["inner_feature_folds"]),
        ),
        "configuration": dict(configuration),
    }
    for key, value in expected.items():
        if metadata.get(key) != value:
            raise ValueError(f"{payload_path}: incompatible checkpoint {key}")
    expected_revision = require_code_revision or os.environ.get("GITHUB_SHA")
    if expected_revision is not None and metadata.get("code_revision") != expected_revision:
        raise ValueError(f"{payload_path}: incompatible checkpoint code revision")
    if metadata.get("payload_sha256") != file_sha256(payload_path):
        raise ValueError(f"{payload_path}: checkpoint payload hash mismatch")
    if metadata.get("payload_size_bytes") != payload_path.stat().st_size:
        raise ValueError(f"{payload_path}: checkpoint payload size mismatch")
    return metadata
