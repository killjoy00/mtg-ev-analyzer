#!/usr/bin/env python3
"""Backfill legacy 17Lands draft sets whose draft_data lacks player-history buckets.

Some frozen PremierDraft archives predate the draft-data schema that includes
``user_n_games_bucket`` and ``user_game_win_rate_bucket``. 17Lands game_data
for the same drafts carries those anonymized player-history fields. This helper
joins only those two fields back onto draft rows by draft_id, then runs the
normal Pack One replay and path-model builders unchanged.

No game result, deck content, or event outcome is used to choose the strong-
player cohort. The compatibility join exists solely to preserve the same cohort
definition used by newer sets.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import shutil
import sys
import tempfile
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable, Optional, Sequence

try:
    from .fetch_card_metadata import aliases, compact_card, draft_candidate_names, fetch_named
    from .import_sets import (
        CATALOG_PATH,
        PATH_MODEL_VERSION,
        RemoteDataset,
        catalog_codes,
        download_dataset,
        load_catalog,
        normalize_code,
        probe_public_dataset,
        publish_staged_set,
        run_command,
        validate_path_model,
    )
except ImportError:  # Script execution from scripts/.
    from fetch_card_metadata import aliases, compact_card, draft_candidate_names, fetch_named
    from import_sets import (
        CATALOG_PATH,
        PATH_MODEL_VERSION,
        RemoteDataset,
        catalog_codes,
        download_dataset,
        load_catalog,
        normalize_code,
        probe_public_dataset,
        publish_staged_set,
        run_command,
        validate_path_model,
    )

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SETS = ("VOW", "MID", "AFR", "STX")
PUBLIC_GAME_URL = (
    "https://17lands-public.s3.amazonaws.com/analysis_data/game_data/"
    "game_data_public.{code}.{format}.csv.gz"
)
SKILL_COLUMNS = ("user_game_win_rate_bucket", "user_n_games_bucket")


def open_text(path: Path):
    if str(path).endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8", newline="")
    return path.open("r", encoding="utf-8", newline="")


def open_write(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if str(path).endswith(".gz"):
        return gzip.open(path, "wt", encoding="utf-8", newline="")
    return path.open("w", encoding="utf-8", newline="")


def parse_codes(value: str) -> list[str]:
    tokens = [token for token in value.replace(",", " ").split() if token]
    return [normalize_code(token) for token in tokens]


def game_remote(draft_remote: RemoteDataset) -> RemoteDataset:
    return RemoteDataset(
        code=draft_remote.code,
        format=draft_remote.format,
        released_at=draft_remote.released_at,
        source_date=draft_remote.source_date,
        url=PUBLIC_GAME_URL.format(code=draft_remote.code, format=draft_remote.format),
    )


def read_skill_buckets(game_path: Path) -> dict[str, tuple[str, str]]:
    """Return the modal anonymized skill bucket pair for each draft_id."""
    observations: dict[str, Counter] = defaultdict(Counter)
    with open_text(game_path) as handle:
        reader = csv.DictReader(handle)
        fieldnames = set(reader.fieldnames or [])
        required = {"draft_id", *SKILL_COLUMNS}
        missing = required - fieldnames
        if missing:
            raise ValueError(
                "Legacy game_data cannot supply Pack One's strong-player cohort; "
                f"missing columns: {', '.join(sorted(missing))}"
            )
        for row in reader:
            draft_id = str(row.get("draft_id") or "").strip()
            rate = str(row.get(SKILL_COLUMNS[0]) or "").strip()
            games = str(row.get(SKILL_COLUMNS[1]) or "").strip()
            if draft_id and rate and games:
                observations[draft_id][(rate, games)] += 1

    skills: dict[str, tuple[str, str]] = {}
    for draft_id, counts in observations.items():
        if counts:
            skills[draft_id] = counts.most_common(1)[0][0]
    if not skills:
        raise ValueError("Legacy game_data contained no usable anonymized player-history buckets.")
    return skills


def augment_draft_with_skills(
    draft_path: Path,
    game_path: Path,
    destination: Path,
) -> dict:
    """Join game_data skill buckets onto draft_data rows without adding outcomes."""
    skills = read_skill_buckets(game_path)
    seen_drafts: set[str] = set()
    covered_drafts: set[str] = set()
    row_count = 0

    with open_text(draft_path) as source:
        reader = csv.DictReader(source)
        fieldnames = list(reader.fieldnames or [])
        structural = {"draft_id", "pick", "pack_number", "pick_number"}
        missing_structural = structural - set(fieldnames)
        if missing_structural:
            raise ValueError(
                f"Legacy draft_data is missing structural columns: {', '.join(sorted(missing_structural))}"
            )
        for column in SKILL_COLUMNS:
            if column not in fieldnames:
                fieldnames.append(column)

        with open_write(destination) as target:
            writer = csv.DictWriter(target, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            for row in reader:
                row_count += 1
                draft_id = str(row.get("draft_id") or "").strip()
                if draft_id:
                    seen_drafts.add(draft_id)
                    pair = skills.get(draft_id)
                    if pair:
                        if not str(row.get(SKILL_COLUMNS[0]) or "").strip():
                            row[SKILL_COLUMNS[0]] = pair[0]
                        if not str(row.get(SKILL_COLUMNS[1]) or "").strip():
                            row[SKILL_COLUMNS[1]] = pair[1]
                    if all(str(row.get(column) or "").strip() for column in SKILL_COLUMNS):
                        covered_drafts.add(draft_id)
                writer.writerow(row)

    if not seen_drafts:
        raise ValueError("Legacy draft_data contained no draft ids.")
    coverage = len(covered_drafts) / len(seen_drafts)
    if len(covered_drafts) < 100:
        raise ValueError(
            f"Only {len(covered_drafts)} drafts received skill buckets; refusing to train a degraded cohort."
        )
    return {
        "draft_rows": row_count,
        "drafts": len(seen_drafts),
        "skill_drafts": len(skills),
        "covered_drafts": len(covered_drafts),
        "coverage": coverage,
    }


def repair_metadata_coverage(raw_draft: Path, metadata_path: Path) -> dict:
    """Retry unresolved cross-set cards slowly after the normal Scryfall pass."""
    records = json.loads(metadata_path.read_text(encoding="utf-8"))
    wanted = draft_candidate_names(raw_draft)
    missing = sorted(wanted - set(records))
    if missing:
        print(f"Retrying {len(missing)} unresolved card names with a conservative Scryfall cadence.", flush=True)
        time.sleep(4)
    unresolved: list[str] = []
    for name in missing:
        card = fetch_named(name)
        if not card:
            unresolved.append(name)
        else:
            metadata = compact_card(card)
            records.setdefault(name, metadata)
            for alias in aliases(card):
                records.setdefault(alias, metadata)
        time.sleep(0.75)

    metadata_path.write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")
    unresolved = sorted(wanted - set(records))
    if unresolved:
        raise ValueError(
            f"Card metadata remains incomplete after retry ({len(unresolved)} names): {unresolved[:12]}"
        )
    return {"wanted": len(wanted), "covered": len(wanted), "coverage": 1.0}


def annotate_legacy_provenance(
    output_dir: Path,
    *,
    game_source_date: str,
    join_stats: dict,
) -> None:
    source = {
        "provider": "17Lands",
        "dataset_kind": "game_data",
        "data_date": game_source_date,
        "join_key": "draft_id",
        "fields": list(SKILL_COLUMNS),
        "purpose": "legacy draft_data player-history compatibility",
    }

    manifest_path = output_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.setdefault("cohort", {})["skill_source"] = source
    manifest["cohort"]["skill_join_coverage"] = round(float(join_stats["coverage"]), 6)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    path_model_path = output_dir / "path-model.json"
    model = json.loads(path_model_path.read_text(encoding="utf-8"))
    model.setdefault("training", {})["skill_source"] = source
    model["training"]["skill_join_coverage"] = round(float(join_stats["coverage"]), 6)
    path_model_path.write_text(json.dumps(model, separators=(",", ":")) + "\n", encoding="utf-8")


def build_legacy_one(remote: RemoteDataset, args: argparse.Namespace) -> dict:
    code = remote.code
    lower = code.lower()
    print(f"\n=== Legacy backfill {code} {remote.format} ===", flush=True)

    with tempfile.TemporaryDirectory(prefix=f"pack1-legacy-{lower}-") as tmp:
        stage_root = Path(tmp)
        stage_data = stage_root / "data"
        stage_data.mkdir(parents=True, exist_ok=True)
        stage_catalog = stage_data / "catalog.json"
        if CATALOG_PATH.exists():
            shutil.copy2(CATALOG_PATH, stage_catalog)
        else:
            stage_catalog.write_text('{"schema_version":2,"sets":[]}\n', encoding="utf-8")

        draft_path = stage_root / f"draft_data_public.{code}.{remote.format}.csv.gz"
        game_path = stage_root / f"game_data_public.{code}.{remote.format}.csv.gz"
        augmented_path = stage_root / f"draft_data_legacy_skill_join.{code}.{remote.format}.csv.gz"
        card_metadata = stage_root / f"{lower}-cards.json"
        output_dir = stage_data / lower

        source_date = download_dataset(remote, draft_path)
        game_source_date = download_dataset(game_remote(remote), game_path)
        join_stats = augment_draft_with_skills(draft_path, game_path, augmented_path)
        print(
            f"Legacy skill join: {join_stats['covered_drafts']}/{join_stats['drafts']} drafts "
            f"({join_stats['coverage']:.1%}) covered.",
            flush=True,
        )

        run_command([
            sys.executable,
            "scripts/fetch_card_metadata.py",
            "--set",
            code,
            "--output",
            str(card_metadata),
            "--draft-data",
            str(draft_path),
        ])
        metadata_stats = repair_metadata_coverage(draft_path, card_metadata)

        run_command([
            sys.executable,
            "scripts/build_replays.py",
            "--input", str(augmented_path),
            "--output-dir", str(output_dir),
            "--catalog", str(stage_catalog),
            "--expansion", code,
            "--format", remote.format,
            "--source-date", source_date,
            "--minimum-games", str(args.minimum_games),
            "--top-fraction", str(args.top_fraction),
            "--max-training-drafts", str(args.max_training_drafts),
            "--max-output-drafts", str(args.max_output_drafts),
            "--minimum-picks", str(args.minimum_picks),
            "--folds", str(args.folds),
            "--shard-size", str(args.shard_size),
            "--card-metadata", str(card_metadata),
        ])

        run_command([
            sys.executable,
            "scripts/build_path_model.py",
            "--input", str(augmented_path),
            "--output-dir", str(output_dir),
            "--expansion", code,
            "--source-date", source_date,
            "--minimum-games", str(args.minimum_games),
            "--top-fraction", str(args.top_fraction),
            "--max-training-drafts", str(args.max_training_drafts),
            "--max-bytes", str(args.max_path_bytes),
        ])

        annotate_legacy_provenance(
            output_dir,
            game_source_date=game_source_date,
            join_stats=join_stats,
        )
        run_command([
            sys.executable,
            "scripts/validate_dataset.py",
            str(output_dir / "manifest.json"),
            "--minimum-replays",
            str(args.minimum_replays),
        ])
        path_cards, path_pairs = validate_path_model(output_dir / "path-model.json", args.max_path_bytes)

        manifest = json.loads((output_dir / "manifest.json").read_text(encoding="utf-8"))
        if manifest.get("model", {}).get("model_version") != "strong-player-pool-context-v2":
            raise ValueError("Legacy backfill changed the replay model version unexpectedly.")
        path_model = json.loads((output_dir / "path-model.json").read_text(encoding="utf-8"))
        if path_model.get("model_version") != PATH_MODEL_VERSION:
            raise ValueError("Legacy backfill changed the path model version unexpectedly.")

        result = {
            "code": code,
            "source_date": source_date,
            "game_skill_source_date": game_source_date,
            "replay_count": int(manifest["replay_count"]),
            "training_drafts": int(manifest["cohort"]["training_drafts"]),
            "win_rate_cutoff": float(manifest["cohort"]["win_rate_cutoff"]),
            "path_cards": path_cards,
            "path_pairs": path_pairs,
            "skill_join": join_stats,
            "metadata": metadata_stats,
        }
        publish_staged_set(stage_root, code)
        print(f"Published legacy {code}: {result['replay_count']} replays", flush=True)
        return result


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sets", default=",".join(DEFAULT_SETS))
    parser.add_argument("--format", default="PremierDraft")
    parser.add_argument("--minimum-games", type=int, default=100)
    parser.add_argument("--top-fraction", type=float, default=0.15)
    parser.add_argument("--max-training-drafts", type=int, default=5000)
    parser.add_argument("--max-output-drafts", type=int, default=300)
    parser.add_argument("--minimum-replays", type=int, default=100)
    parser.add_argument("--minimum-picks", type=int, default=30)
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--shard-size", type=int, default=2)
    parser.add_argument("--max-path-bytes", type=int, default=4_000_000)
    parser.add_argument("--report", default="generated/legacy-backfill-report.json")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    codes = parse_codes(args.sets)
    existing = catalog_codes(load_catalog())
    successes: list[dict] = []
    failures: list[dict] = []
    skipped: list[str] = []

    for code in codes:
        if code in existing:
            skipped.append(code)
            continue
        remote = probe_public_dataset(code, args.format, "")
        if remote is None:
            failures.append({"code": code, "error": "17Lands draft_data archive is unavailable."})
            continue
        try:
            result = build_legacy_one(remote, args)
            successes.append(result)
            existing.add(code)
        except Exception as exc:  # Preserve successful sets and report the exact blocker.
            print(f"ERROR legacy backfill {code}: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
            failures.append({"code": code, "error": f"{type(exc).__name__}: {exc}"})

    report = {
        "mode": "legacy-player-history-join",
        "sets": codes,
        "successes": successes,
        "failures": failures,
        "skipped_already_live": skipped,
    }
    report_path = REPO_ROOT / args.report
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
