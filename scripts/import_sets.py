#!/usr/bin/env python3
"""Safely import the known 17Lands Premier Draft backlog.

The normal-set backlog is declared explicitly in data/import-queue.json. This
orchestration layer:

* consumes that human-readable newest-first queue instead of rediscovering history;
* skips sets already present in data/catalog.json;
* probes the official 17Lands public S3 Draft Data archive before each build;
* keeps scanning past unavailable or failed entries until the requested number
  of successful imports is reached;
* derives the source date from the archive's Last-Modified header;
* builds each set in an isolated staging tree;
* validates replay shards and the counterfactual path model before publishing;
* preserves successful sets when another set in the same batch fails.

Raw 17Lands archives remain temporary and are never written under data/.
Powered Cube is deliberately excluded from this queue and has its own builder.
"""

from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Iterable, Optional, Sequence

REPO_ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = REPO_ROOT / "data" / "catalog.json"
QUEUE_PATH = REPO_ROOT / "data" / "import-queue.json"
GENERATED_DIR = REPO_ROOT / "generated"
SCRYFALL_SETS_URL = "https://api.scryfall.com/sets"
PUBLIC_DRAFT_URL = (
    "https://17lands-public.s3.amazonaws.com/analysis_data/draft_data/"
    "draft_data_public.{code}.{format}.csv.gz"
)
USER_AGENT = "Pack1-MTG-EV-Importer/1.0 (+https://github.com/killjoy00/mtg-ev-analyzer)"
SCRYFALL_ACCEPT = "application/json;q=0.9,*/*;q=0.8"
CODE_RE = re.compile(r"^[A-Z0-9]{2,8}$")
PATH_MODEL_VERSION = "strong-player-counterfactual-path-v3"


@dataclass(frozen=True)
class RemoteDataset:
    code: str
    format: str
    released_at: str
    source_date: str
    url: str


@dataclass(frozen=True)
class ImportResult:
    code: str
    source_date: str
    replay_count: int
    training_drafts: int
    path_cards: int
    path_pairs: int


def normalize_code(value: str) -> str:
    code = value.strip().upper()
    if not CODE_RE.fullmatch(code):
        raise ValueError(f"Invalid expansion code: {value!r}")
    return code


def parse_codes(value: str) -> list[str]:
    if not value.strip():
        return []
    seen: set[str] = set()
    result: list[str] = []
    for token in re.split(r"[\s,]+", value.strip()):
        if not token:
            continue
        code = normalize_code(token)
        if code not in seen:
            seen.add(code)
            result.append(code)
    return result


def load_catalog(path: Path = CATALOG_PATH) -> dict:
    if not path.exists():
        return {"schema_version": 2, "sets": []}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("sets", []), list):
        raise ValueError(f"Invalid catalog: {path}")
    return payload


def catalog_codes(catalog: dict) -> set[str]:
    return {
        str(item.get("id", "")).upper()
        for item in catalog.get("sets", [])
        if isinstance(item, dict) and item.get("id") and not item.get("is_fixture")
    }


def load_import_queue(path: Path = QUEUE_PATH) -> tuple[str, list[str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Invalid import queue: {path}")
    format_name = str(payload.get("format") or "").strip()
    raw_sets = payload.get("sets")
    if not format_name or not isinstance(raw_sets, list):
        raise ValueError(f"Import queue must define format and sets: {path}")
    codes: list[str] = []
    seen: set[str] = set()
    for raw in raw_sets:
        code = normalize_code(str(raw))
        if code in seen:
            raise ValueError(f"Duplicate set in import queue: {code}")
        seen.add(code)
        codes.append(code)
    if not codes:
        raise ValueError(f"Import queue is empty: {path}")
    return format_name, codes


def request(url: str, *, method: str = "GET", accept: str = "*/*", timeout: int = 30):
    headers = {"User-Agent": USER_AGENT, "Accept": accept}
    req = urllib.request.Request(url, method=method, headers=headers)
    return urllib.request.urlopen(req, timeout=timeout)


def http_date_to_iso(value: Optional[str], fallback: str) -> str:
    if not value:
        return fallback
    try:
        parsed = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError, OverflowError):
        return fallback
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc).date().isoformat()


def fetch_scryfall_sets(earliest: str) -> list[tuple[str, str]]:
    """Return released Scryfall set codes newest-first using one API request.

    This remains available for explicit/manual imports and as a legacy discovery
    fallback. Normal backlog processing uses data/import-queue.json instead.
    """
    earliest_date = dt.date.fromisoformat(earliest)
    today = dt.datetime.now(dt.timezone.utc).date()
    with request(SCRYFALL_SETS_URL, accept=SCRYFALL_ACCEPT) as response:
        payload = json.load(response)

    rows: list[tuple[str, str]] = []
    seen: set[str] = set()
    for item in payload.get("data", []):
        if not isinstance(item, dict):
            continue
        raw_code = str(item.get("code") or "").upper()
        released = str(item.get("released_at") or "")
        if not CODE_RE.fullmatch(raw_code):
            continue
        try:
            released_date = dt.date.fromisoformat(released)
        except ValueError:
            continue
        if released_date < earliest_date or released_date > today or raw_code in seen:
            continue
        seen.add(raw_code)
        rows.append((raw_code, released))

    rows.sort(key=lambda item: (item[1], item[0]), reverse=True)
    if not rows:
        raise RuntimeError("Scryfall returned no eligible released sets.")
    return rows


def public_draft_url(code: str, format_name: str) -> str:
    return PUBLIC_DRAFT_URL.format(code=normalize_code(code), format=format_name)


def probe_public_dataset(code: str, format_name: str, released_at: str) -> Optional[RemoteDataset]:
    """Return archive metadata when the official 17Lands public dump exists."""
    url = public_draft_url(code, format_name)
    fallback = released_at or dt.datetime.now(dt.timezone.utc).date().isoformat()
    try:
        with request(url, method="HEAD", accept="application/gzip,*/*;q=0.8", timeout=20) as response:
            source_date = http_date_to_iso(response.headers.get("Last-Modified"), fallback)
    except urllib.error.HTTPError as exc:
        # S3 commonly returns either 403 or 404 for an object that is not public/present.
        if exc.code in {403, 404}:
            return None
        raise
    return RemoteDataset(
        code=normalize_code(code),
        format=format_name,
        released_at=released_at,
        source_date=source_date,
        url=url,
    )


def discover_missing_sets(
    catalog: dict,
    *,
    format_name: str,
    earliest: str,
    limit: int,
    fetch_sets: Callable[[str], list[tuple[str, str]]] = fetch_scryfall_sets,
    probe: Callable[[str, str, str], Optional[RemoteDataset]] = probe_public_dataset,
) -> list[RemoteDataset]:
    """Legacy dynamic discovery fallback used only when no queue file exists."""
    if limit < 1:
        raise ValueError("limit must be at least 1")
    existing = catalog_codes(catalog)
    scryfall_sets = fetch_sets(earliest)

    # Confirm that archive probing works before interpreting 403 as "missing".
    for known_code, known_release in scryfall_sets:
        if known_code not in existing:
            continue
        if probe(known_code, format_name, known_release) is None:
            raise RuntimeError(
                f"Could not probe the known 17Lands archive for {known_code}; "
                "refusing to treat archive errors as missing datasets."
            )
        break

    selected: list[RemoteDataset] = []
    for code, released_at in scryfall_sets:
        if code in existing:
            continue
        remote = probe(code, format_name, released_at)
        if remote is None:
            continue
        selected.append(remote)
        if len(selected) >= limit:
            break
    return selected


def resolve_queue_sets(
    catalog: dict,
    *,
    format_name: str,
    queue_path: Path = QUEUE_PATH,
    probe: Callable[[str, str, str], Optional[RemoteDataset]] = probe_public_dataset,
) -> tuple[list[RemoteDataset], list[str]]:
    """Return all missing queued archives in queue order plus unavailable codes.

    We intentionally do not stop at the per-run success limit here. main() keeps
    scanning these candidates until it reaches that many *successful* imports,
    so one broken historical set cannot permanently pin older backlog entries.
    """
    queue_format, queue_codes = load_import_queue(queue_path)
    if queue_format != format_name:
        raise ValueError(
            f"Import queue format is {queue_format}, but importer requested {format_name}."
        )
    existing = catalog_codes(catalog)
    selected: list[RemoteDataset] = []
    unavailable: list[str] = []
    for code in queue_codes:
        if code in existing:
            continue
        remote = probe(code, format_name, "")
        if remote is None:
            unavailable.append(code)
            continue
        selected.append(remote)
    return selected, unavailable


def resolve_explicit_sets(codes: Iterable[str], format_name: str) -> list[RemoteDataset]:
    released_by_code = dict(fetch_scryfall_sets("1993-01-01"))
    selected: list[RemoteDataset] = []
    for raw_code in codes:
        code = normalize_code(raw_code)
        released_at = released_by_code.get(code, dt.datetime.now(dt.timezone.utc).date().isoformat())
        remote = probe_public_dataset(code, format_name, released_at)
        if remote is None:
            raise FileNotFoundError(
                f"17Lands has no public {format_name} draft_data archive for {code}."
            )
        selected.append(remote)
    return selected


def download_dataset(remote: RemoteDataset, destination: Path) -> str:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with request(remote.url, accept="application/gzip,*/*;q=0.8", timeout=90) as response:
        source_date = http_date_to_iso(response.headers.get("Last-Modified"), remote.source_date)
        with destination.open("wb") as handle:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)

    if destination.stat().st_size < 1024:
        raise ValueError(f"Downloaded archive for {remote.code} is unexpectedly small.")
    with destination.open("rb") as handle:
        if handle.read(2) != b"\x1f\x8b":
            raise ValueError(f"Downloaded archive for {remote.code} is not gzip data.")
    return source_date


def run_command(args: Sequence[str]) -> None:
    print("+", shlex.join(str(item) for item in args), flush=True)
    subprocess.run([str(item) for item in args], cwd=REPO_ROOT, check=True)


def validate_path_model(path: Path, max_bytes: int = 4_000_000) -> tuple[int, int]:
    model = json.loads(path.read_text(encoding="utf-8"))
    if model.get("model_version") != PATH_MODEL_VERSION:
        raise ValueError(f"Unexpected path model version in {path}")
    excluded = int(model.get("training", {}).get("excluded_replay_drafts") or 0)
    cards = len(model.get("cards") or {})
    pairs = len(model.get("pairs") or {})
    if excluded < 250:
        raise ValueError(f"Path model excluded only {excluded} replay drafts; expected at least 250.")
    if cards <= 100:
        raise ValueError(f"Path model has only {cards} cards; expected more than 100.")
    if pairs <= 100:
        raise ValueError(f"Path model has only {pairs} card pairs; expected more than 100.")
    if path.stat().st_size >= max_bytes:
        raise ValueError(f"Path model is {path.stat().st_size} bytes; limit is {max_bytes}.")
    return cards, pairs


def publish_staged_set(stage_root: Path, code: str) -> None:
    lower = code.lower()
    staged_set = stage_root / "data" / lower
    staged_catalog = stage_root / "data" / "catalog.json"
    target_set = REPO_ROOT / "data" / lower
    target_catalog = CATALOG_PATH
    replacement = REPO_ROOT / "data" / f".{lower}.importing"
    backup = REPO_ROOT / "data" / f".{lower}.backup"

    if replacement.exists():
        shutil.rmtree(replacement)
    if backup.exists():
        shutil.rmtree(backup)
    shutil.copytree(staged_set, replacement)

    moved_existing = False
    try:
        if target_set.exists():
            target_set.rename(backup)
            moved_existing = True
        replacement.rename(target_set)
        catalog_tmp = REPO_ROOT / "data" / ".catalog.importing.json"
        shutil.copy2(staged_catalog, catalog_tmp)
        os.replace(catalog_tmp, target_catalog)
    except Exception:
        # If this was a brand-new set and the directory swap succeeded before a
        # later catalog failure, remove the orphan as part of the rollback too.
        if target_set.exists():
            shutil.rmtree(target_set)
        if moved_existing and backup.exists():
            backup.rename(target_set)
        raise
    finally:
        if replacement.exists():
            shutil.rmtree(replacement)
        if backup.exists():
            shutil.rmtree(backup)


def build_one(remote: RemoteDataset, args: argparse.Namespace) -> ImportResult:
    code = remote.code
    lower = code.lower()
    print(f"\n=== Importing {code} {remote.format} ({remote.source_date}) ===", flush=True)

    with tempfile.TemporaryDirectory(prefix=f"pack1-{lower}-") as tmp:
        stage_root = Path(tmp)
        stage_data = stage_root / "data"
        stage_data.mkdir(parents=True, exist_ok=True)
        stage_catalog = stage_data / "catalog.json"
        if CATALOG_PATH.exists():
            shutil.copy2(CATALOG_PATH, stage_catalog)
        else:
            stage_catalog.write_text('{"schema_version":2,"sets":[]}\n', encoding="utf-8")

        raw_path = stage_root / f"draft_data_public.{code}.{remote.format}.csv.gz"
        card_metadata = stage_root / f"{lower}-cards.json"
        output_dir = stage_data / lower
        source_date = download_dataset(remote, raw_path)

        # Missing card metadata should fail the set instead of publishing a degraded game.
        run_command([
            sys.executable,
            "scripts/fetch_card_metadata.py",
            "--set",
            code,
            "--output",
            str(card_metadata),
        ])

        run_command([
            sys.executable,
            "scripts/build_replays.py",
            "--input",
            str(raw_path),
            "--output-dir",
            str(output_dir),
            "--catalog",
            str(stage_catalog),
            "--expansion",
            code,
            "--format",
            remote.format,
            "--source-date",
            source_date,
            "--minimum-games",
            str(args.minimum_games),
            "--top-fraction",
            str(args.top_fraction),
            "--max-training-drafts",
            str(args.max_training_drafts),
            "--max-output-drafts",
            str(args.max_output_drafts),
            "--minimum-picks",
            str(args.minimum_picks),
            "--folds",
            str(args.folds),
            "--shard-size",
            str(args.shard_size),
            "--card-metadata",
            str(card_metadata),
        ])

        run_command([
            sys.executable,
            "scripts/build_path_model.py",
            "--input",
            str(raw_path),
            "--output-dir",
            str(output_dir),
            "--expansion",
            code,
            "--source-date",
            source_date,
            "--minimum-games",
            str(args.minimum_games),
            "--top-fraction",
            str(args.top_fraction),
            "--max-training-drafts",
            str(args.max_training_drafts),
            "--max-bytes",
            str(args.max_path_bytes),
        ])

        run_command([
            sys.executable,
            "scripts/validate_dataset.py",
            str(output_dir / "manifest.json"),
            "--minimum-replays",
            str(args.minimum_replays),
        ])
        path_cards, path_pairs = validate_path_model(output_dir / "path-model.json", args.max_path_bytes)

        manifest = json.loads((output_dir / "manifest.json").read_text(encoding="utf-8"))
        result = ImportResult(
            code=code,
            source_date=source_date,
            replay_count=int(manifest["replay_count"]),
            training_drafts=int(manifest["cohort"]["training_drafts"]),
            path_cards=path_cards,
            path_pairs=path_pairs,
        )
        publish_staged_set(stage_root, code)
        print(f"Published {code}: {result.replay_count} replays", flush=True)
        return result


def write_report(path: Path, report: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)


def pending_queue_codes(path: Path = QUEUE_PATH) -> list[str]:
    if not path.exists():
        return []
    _format, codes = load_import_queue(path)
    existing = catalog_codes(load_catalog())
    return [code for code in codes if code not in existing]


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--sets",
        default="",
        help="Comma/space-separated explicit set codes. Omit to consume the import queue.",
    )
    parser.add_argument("--format", default="PremierDraft")
    parser.add_argument("--limit", type=int, default=3, help="Maximum successful queued imports this run.")
    parser.add_argument("--earliest", default="2021-01-01", help="Legacy discovery fallback cutoff.")
    parser.add_argument("--queue", default=str(QUEUE_PATH.relative_to(REPO_ROOT)))
    parser.add_argument("--minimum-games", type=int, default=100)
    parser.add_argument("--top-fraction", type=float, default=0.15)
    parser.add_argument("--max-training-drafts", type=int, default=5000)
    parser.add_argument("--max-output-drafts", type=int, default=300)
    parser.add_argument("--minimum-replays", type=int, default=100)
    parser.add_argument("--minimum-picks", type=int, default=30)
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--shard-size", type=int, default=2)
    parser.add_argument("--max-path-bytes", type=int, default=4_000_000)
    parser.add_argument("--report", default="generated/import-report.json")
    parser.add_argument("--dry-run", action="store_true", help="Probe the queue but do not download or build sets.")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    if args.limit < 1:
        raise ValueError("limit must be at least 1")

    started = dt.datetime.now(dt.timezone.utc).isoformat()
    catalog = load_catalog()
    explicit = parse_codes(args.sets)
    queue_path = REPO_ROOT / args.queue
    unavailable: list[str] = []

    if explicit:
        selected = resolve_explicit_sets(explicit, args.format)
        mode = "explicit"
    elif queue_path.exists():
        selected, unavailable = resolve_queue_sets(
            catalog,
            format_name=args.format,
            queue_path=queue_path,
        )
        mode = "explicit-queue"
    else:
        selected = discover_missing_sets(
            catalog,
            format_name=args.format,
            earliest=args.earliest,
            # Ask legacy discovery for a wider scan so one build failure does
            # not necessarily block all useful work in a manual fallback run.
            limit=max(args.limit * 4, args.limit),
        )
        mode = "missing-backlog"

    report: dict = {
        "started_at": started,
        "mode": mode,
        "format": args.format,
        "success_target": None if explicit else args.limit,
        "selected": [asdict(item) for item in selected],
        "unavailable": unavailable,
        "successes": [],
        "failures": [],
    }

    if args.dry_run:
        report["finished_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
        report["dry_run"] = True
        report["pending_queue"] = pending_queue_codes(queue_path)
        write_report(REPO_ROOT / args.report, report)
        return 0

    for remote in selected:
        if not explicit and len(report["successes"]) >= args.limit:
            break
        try:
            result = build_one(remote, args)
            report["successes"].append(asdict(result))
        except Exception as exc:  # Continue so one unsupported set does not block the backlog.
            print(f"ERROR importing {remote.code}: {exc}", file=sys.stderr, flush=True)
            report["failures"].append({"code": remote.code, "error": f"{type(exc).__name__}: {exc}"})

    report["finished_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    report["pending_queue"] = pending_queue_codes(queue_path)
    write_report(REPO_ROOT / args.report, report)

    if report["failures"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
