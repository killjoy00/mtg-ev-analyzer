"""Archive schema and immutable provenance helpers for contextual-value-v1."""

from __future__ import annotations

import csv
import gzip
import hashlib
import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable, Sequence

DRAFT_REQUIRED = (
    "expansion",
    "event_type",
    "draft_id",
    "draft_time",
    "rank",
    "event_match_wins",
    "pack_number",
    "pick_number",
    "pick",
    "user_n_games_bucket",
    "user_game_win_rate_bucket",
)
GAME_REQUIRED = (
    "draft_id",
    "won",
    "rank",
    "user_game_win_rate_bucket",
    "user_n_games_bucket",
)
DYNAMIC_DRAFT_PREFIXES = ("pack_card_", "pool_")
DYNAMIC_GAME_PREFIXES = ("deck_", "opening_hand_", "drawn_", "tutored_", "sideboard_")


@dataclass(frozen=True)
class ArchiveManifest:
    path: str
    sha256: str
    size_bytes: int
    header: tuple[str, ...]
    kind: str

    def to_dict(self) -> dict:
        return asdict(self)


def open_text(path: Path):
    if str(path).endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8-sig", newline="")
    return path.open("r", encoding="utf-8-sig", newline="")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_header(path: Path) -> tuple[str, ...]:
    with open_text(path) as handle:
        reader = csv.reader(handle)
        try:
            return tuple(next(reader))
        except StopIteration as exc:
            raise ValueError(f"{path}: empty archive") from exc


def _missing(header: Sequence[str], required: Iterable[str]) -> list[str]:
    available = set(header)
    return sorted(name for name in required if name not in available)


def validate_header(header: Sequence[str], kind: str) -> None:
    if len(set(header)) != len(header):
        raise ValueError(f"{kind}: duplicate column names are not allowed")
    if kind == "draft":
        missing = _missing(header, DRAFT_REQUIRED)
        if missing:
            raise ValueError(f"draft: missing required columns: {', '.join(missing)}")
        for prefix in DYNAMIC_DRAFT_PREFIXES:
            if not any(name.startswith(prefix) for name in header):
                raise ValueError(f"draft: no {prefix}* columns found")
        return
    if kind == "game":
        missing = _missing(header, GAME_REQUIRED)
        if missing:
            raise ValueError(f"game: missing required columns: {', '.join(missing)}")
        if not any(name.startswith("deck_") for name in header):
            raise ValueError("game: no deck_* columns found")
        if not any(
            name.startswith(prefix)
            for name in header
            for prefix in ("opening_hand_", "drawn_", "tutored_")
        ):
            raise ValueError("game: no in-hand card columns found")
        return
    raise ValueError(f"unknown archive kind: {kind}")


def inspect_archive(path: Path, kind: str) -> ArchiveManifest:
    header = read_header(path)
    validate_header(header, kind)
    stat = path.stat()
    return ArchiveManifest(
        path=str(path),
        sha256=file_sha256(path),
        size_bytes=stat.st_size,
        header=header,
        kind=kind,
    )


def write_manifest(manifests: Sequence[ArchiveManifest], destination: Path) -> None:
    payload = {
        "schema_version": 1,
        "archives": [manifest.to_dict() for manifest in manifests],
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
