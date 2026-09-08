#!/usr/bin/env python3
"""Build Pack One's Powered Cube mode from the public 17Lands data dump.

Powered Cube is deliberately not part of normal set discovery. 17Lands publishes
it under the filename expansion ``Cube_-_Powered`` even though the public catalog
labels it "Powered Cube". This builder uses that canonical public archive,
resolves card display metadata across *all* Scryfall sets, keeps only replay
seats with a complete Pack 1 Pick 1, builds the existing leakage-safe consensus
and counterfactual path models, validates the result, and finally registers the
dataset as a special product mode in ``data/catalog.json``.

The catalog still uses its existing ``sets`` array as a generic playable-data
registry for backwards compatibility with the score worker. The Cube entry is
marked ``category=special_mode`` and ``hide_from_set_picker=true``; the product
layer presents it separately from expansion sets.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import email.utils
import gzip
import json
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Iterable, Optional, Sequence

try:  # Script execution (python scripts/import_powered_cube.py)
    from build_replays import write_sharded_dataset
    from fetch_card_metadata import aliases, compact_card
except ModuleNotFoundError:  # Unit-test import (from scripts import import_powered_cube)
    from scripts.build_replays import write_sharded_dataset
    from scripts.fetch_card_metadata import aliases, compact_card

REPO_ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = REPO_ROOT / "data" / "catalog.json"
OUTPUT_DIR = REPO_ROOT / "data" / "powered-cube"
REPORT_PATH = REPO_ROOT / "generated" / "powered-cube-report.json"

CUBE_ID = "powered-cube"
CUBE_NAME = "Powered Cube"
CUBE_FORMAT = "PremierDraft"
CUBE_SOURCE_DATE = "2025-11-23"
CUBE_ARCHIVE_URL = (
    "https://17lands-public.s3.amazonaws.com/analysis_data/draft_data/"
    "draft_data_public.Cube_-_Powered.PremierDraft.csv.gz"
)
SCRYFALL_BULK_URL = "https://api.scryfall.com/bulk-data/oracle-cards"
USER_AGENT = "Pack1-Powered-Cube-Builder/1.0 (+https://github.com/killjoy00/mtg-ev-analyzer)"
JSON_ACCEPT = "application/json;q=0.9,*/*;q=0.8"
PATH_MODEL_VERSION = "strong-player-counterfactual-path-v3"


def request(url: str, *, method: str = "GET", accept: str = "*/*", timeout: int = 60):
    req = urllib.request.Request(
        url,
        method=method,
        headers={"User-Agent": USER_AGENT, "Accept": accept},
    )
    return urllib.request.urlopen(req, timeout=timeout)


def http_date_to_iso(value: Optional[str], fallback: str = CUBE_SOURCE_DATE) -> str:
    if not value:
        return fallback
    try:
        parsed = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError, OverflowError):
        return fallback
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc).date().isoformat()


def download_archive(destination: Path) -> str:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with request(CUBE_ARCHIVE_URL, accept="application/gzip,*/*;q=0.8", timeout=120) as response:
        source_date = http_date_to_iso(response.headers.get("Last-Modified"))
        with destination.open("wb") as handle:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
    if destination.stat().st_size < 1024:
        raise ValueError("Powered Cube archive is unexpectedly small.")
    with destination.open("rb") as handle:
        if handle.read(2) != b"\x1f\x8b":
            raise ValueError("Powered Cube archive is not gzip data.")
    return source_date


def draft_candidate_names(path: Path) -> list[str]:
    opener = gzip.open if str(path).endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        header = next(reader, [])
    names = sorted({column[len("pack_card_"):] for column in header if column.startswith("pack_card_")})
    if not names:
        raise ValueError("Powered Cube draft data has no pack_card_ columns.")
    return names


def _bulk_cards() -> list[dict]:
    with request(SCRYFALL_BULK_URL, accept=JSON_ACCEPT, timeout=60) as response:
        metadata = json.load(response)
    download_uri = str(metadata.get("download_uri") or "")
    if not download_uri.startswith("https://"):
        raise ValueError("Scryfall oracle-card bulk metadata had no HTTPS download_uri.")
    with request(download_uri, accept=JSON_ACCEPT, timeout=180) as response:
        cards = json.load(response)
    if not isinstance(cards, list) or not cards:
        raise ValueError("Scryfall oracle-card bulk download was empty.")
    return cards


def _named_card(name: str) -> Optional[dict]:
    url = "https://api.scryfall.com/cards/named?exact=" + urllib.parse.quote(name)
    try:
        with request(url, accept=JSON_ACCEPT, timeout=45) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def fetch_cross_set_metadata(names: Iterable[str]) -> tuple[dict[str, dict], list[str]]:
    """Resolve Cube card metadata primarily from Scryfall's recommended bulk data.

    Scryfall explicitly recommends bulk data for large name-lookup jobs. We only
    fall back to the named-card API for aliases not represented directly in the
    oracle-card bulk file, and keep that fallback below the normal API rate cap.
    """
    wanted = {str(name) for name in names if str(name).strip()}
    records: dict[str, dict] = {}
    for card in _bulk_cards():
        metadata = compact_card(card)
        for alias in aliases(card):
            if alias in wanted and alias not in records:
                records[alias] = metadata

    missing = sorted(wanted - records.keys())
    for name in list(missing):
        card = _named_card(name)
        if card:
            records[name] = compact_card(card)
        time.sleep(0.12)

    unresolved = sorted(wanted - records.keys())
    coverage = len(records) / max(1, len(wanted))
    if coverage < 0.95:
        raise ValueError(
            f"Scryfall metadata coverage is only {coverage:.1%} "
            f"({len(records)}/{len(wanted)} cards; {len(unresolved)} unresolved)."
        )
    return records, unresolved


def write_metadata(path: Path, records: dict[str, dict]) -> None:
    path.write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")


def run_command(args: Sequence[str]) -> None:
    print("+", shlex.join(str(item) for item in args), flush=True)
    subprocess.run([str(item) for item in args], cwd=REPO_ROOT, check=True)


def _read_replays(output_dir: Path, manifest: dict) -> list[dict]:
    replays: list[dict] = []
    for shard in manifest.get("shards", []):
        filename = Path(str(shard.get("path") or "")).name
        payload = json.loads((output_dir / "shards" / filename).read_text(encoding="utf-8"))
        replays.extend(payload.get("replays") or [])
    return replays


def complete_cube_opening(replay: dict, minimum_candidates: int = 15) -> bool:
    picks = replay.get("picks") or []
    if not picks:
        return False
    pack_numbers = [int(p.get("pack_number") or 0) for p in picks]
    first_pack = min(pack_numbers)
    pack = [p for p in picks if int(p.get("pack_number") or 0) == first_pack]
    by_pick = {int(p.get("pick_number") or 0): p for p in pack}
    opening = by_pick.get(1)
    if opening is None or len(opening.get("candidates") or []) < minimum_candidates:
        return False
    # A Pack One game should be a complete first pass/wheel, not a partial log.
    return all(number in by_pick for number in range(1, 16))


def filter_complete_openings(
    output_dir: Path,
    *,
    target_replays: int,
    minimum_replays: int,
    minimum_candidates: int,
    shard_size: int,
) -> tuple[dict, int, int]:
    manifest_path = output_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    source_replays = _read_replays(output_dir, manifest)
    usable = [replay for replay in source_replays if complete_cube_opening(replay, minimum_candidates)]
    selected = usable[:target_replays]
    if len(selected) < minimum_replays:
        raise ValueError(
            f"Only {len(selected)} Powered Cube replay seats have a complete P1P1; "
            f"need at least {minimum_replays}."
        )

    dataset = {
        key: value
        for key, value in manifest.items()
        if key not in {"replay_count", "shard_size", "shards"}
    }
    dataset["replays"] = selected
    filtered = write_sharded_dataset(dataset, output_dir, shard_size)
    return filtered, len(source_replays), len(usable)


def validate_path_model(path: Path, *, minimum_replays: int, max_bytes: int) -> tuple[int, int, int]:
    model = json.loads(path.read_text(encoding="utf-8"))
    if model.get("model_version") != PATH_MODEL_VERSION:
        raise ValueError("Powered Cube path model has an unexpected version.")
    excluded = int(model.get("training", {}).get("excluded_replay_drafts") or 0)
    cards = len(model.get("cards") or [])
    pairs = len(model.get("pairs") or [])
    if excluded < minimum_replays:
        raise ValueError(f"Powered Cube path model held out only {excluded} replay drafts.")
    if cards < 250:
        raise ValueError(f"Powered Cube path model contains only {cards} cards.")
    if pairs < 500:
        raise ValueError(f"Powered Cube path model contains only {pairs} card pairs.")
    if path.stat().st_size > max_bytes:
        raise ValueError(f"Powered Cube path model exceeds {max_bytes:,} bytes.")
    return excluded, cards, pairs


def register_cube(catalog_path: Path, output_dir: Path) -> dict:
    manifest_path = output_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["name"] = CUBE_NAME
    manifest["category"] = "special_mode"
    manifest["product_mode"] = CUBE_ID
    manifest["source"]["expansion_label"] = CUBE_NAME
    manifest["source"]["archive_expansion"] = "Cube_-_Powered"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    entry = {
        "id": CUBE_ID,
        "name": CUBE_NAME,
        "format": CUBE_FORMAT,
        "category": "special_mode",
        "product_mode": CUBE_ID,
        "hide_from_set_picker": True,
        "manifest_path": f"./data/{output_dir.name}/manifest.json",
        "replay_count": int(manifest["replay_count"]),
        "model_version": str(manifest["model"]["model_version"]),
        "data_date": str(manifest["source"]["data_date"]),
        "is_fixture": False,
        "win_rate_cutoff": float(manifest["cohort"]["win_rate_cutoff"]),
        "training_drafts": int(manifest["cohort"]["training_drafts"]),
    }
    # Append special modes so featuredSetId() continues to select a real expansion.
    standard = [item for item in catalog.get("sets", []) if item.get("id") != CUBE_ID]
    catalog["schema_version"] = max(2, int(catalog.get("schema_version") or 2))
    catalog["sets"] = [*standard, entry]
    catalog_path.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    return entry


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--minimum-games", type=int, default=100)
    parser.add_argument("--top-fraction", type=float, default=0.15)
    parser.add_argument("--max-training-drafts", type=int, default=5000)
    parser.add_argument("--max-output-candidates", type=int, default=1200)
    parser.add_argument("--target-replays", type=int, default=300)
    parser.add_argument("--minimum-replays", type=int, default=100)
    parser.add_argument("--minimum-opening-candidates", type=int, default=15)
    parser.add_argument("--shard-size", type=int, default=2)
    parser.add_argument("--max-path-bytes", type=int, default=8_000_000)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    report: dict = {"started_at": started, "mode": CUBE_ID, "source_url": CUBE_ARCHIVE_URL}

    with tempfile.TemporaryDirectory(prefix="pack1-powered-cube-") as tmp:
        temp = Path(tmp)
        archive = temp / "powered-cube.csv.gz"
        metadata_path = temp / "powered-cube-cards.json"
        source_date = download_archive(archive)
        names = draft_candidate_names(archive)
        metadata, unresolved = fetch_cross_set_metadata(names)
        write_metadata(metadata_path, metadata)

        if OUTPUT_DIR.exists():
            shutil.rmtree(OUTPUT_DIR)
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        run_command([
            sys.executable,
            "scripts/build_replays.py",
            "--input", str(archive),
            "--output-dir", str(OUTPUT_DIR),
            "--expansion", CUBE_ID,
            "--format", CUBE_FORMAT,
            "--source-date", source_date,
            "--minimum-games", str(args.minimum_games),
            "--top-fraction", str(args.top_fraction),
            "--max-training-drafts", str(args.max_training_drafts),
            "--max-output-drafts", str(args.max_output_candidates),
            "--minimum-picks", "30",
            "--folds", "5",
            "--shard-size", "20",
            "--card-metadata", str(metadata_path),
        ])

        manifest, candidate_replays, usable_replays = filter_complete_openings(
            OUTPUT_DIR,
            target_replays=args.target_replays,
            minimum_replays=args.minimum_replays,
            minimum_candidates=args.minimum_opening_candidates,
            shard_size=args.shard_size,
        )

        run_command([
            sys.executable,
            "scripts/build_path_model.py",
            "--input", str(archive),
            "--output-dir", str(OUTPUT_DIR),
            "--expansion", CUBE_ID,
            "--source-date", source_date,
            "--minimum-games", str(args.minimum_games),
            "--top-fraction", str(args.top_fraction),
            "--max-training-drafts", str(args.max_training_drafts),
            "--max-bytes", str(args.max_path_bytes),
        ])
        run_command([
            sys.executable,
            "scripts/validate_dataset.py",
            str(OUTPUT_DIR / "manifest.json"),
            "--minimum-replays", str(args.minimum_replays),
        ])
        excluded, path_cards, path_pairs = validate_path_model(
            OUTPUT_DIR / "path-model.json",
            minimum_replays=args.minimum_replays,
            max_bytes=args.max_path_bytes,
        )
        entry = register_cube(CATALOG_PATH, OUTPUT_DIR)

        report.update({
            "finished_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "source_date": source_date,
            "candidate_card_names": len(names),
            "metadata_resolved": len(metadata),
            "metadata_unresolved": unresolved,
            "candidate_replays": candidate_replays,
            "complete_opening_replays": usable_replays,
            "published_replays": int(manifest["replay_count"]),
            "path_model_excluded_replays": excluded,
            "path_cards": path_cards,
            "path_pairs": path_pairs,
            "catalog_entry": entry,
        })

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
