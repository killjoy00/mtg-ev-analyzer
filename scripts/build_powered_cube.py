#!/usr/bin/env python3
"""Evidence-first Powered Cube builder.

The public Arena/17Lands Cube dump exposes the historical P1P1 choice but not the
complete opening pack. We therefore remove that incomplete row from consensus
training while preserving the known P1P1 card as pool context for every later
row in that draft. The playable run begins at the first fully observed decision.

Unlike the first Cube adapter, this builder measures the rendered pick-number
origin before applying an offset. Normal replay building can already turn raw
P1P2 into stored pick 2 because later packs still contain raw pick 0; in that
case no additional shift is applied.

Every failure writes a structured diagnostic report before raising so CI always
leaves evidence about raw shape, rendered replay shape, and rejection reasons.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import gzip
import json
import math
import shutil
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Mapping, Optional, Sequence

try:
    import import_powered_cube as cube
    from build_replays import truthy_count, write_sharded_dataset
except ModuleNotFoundError:  # unit-test import
    from scripts import import_powered_cube as cube
    from scripts.build_replays import truthy_count, write_sharded_dataset

REPORT_PATH = cube.REPORT_PATH


def open_csv(path: Path):
    return gzip.open(path, "rt", encoding="utf-8", newline="") if str(path).endswith(".gz") else path.open("r", encoding="utf-8", newline="")


def _coords(row: Mapping[str, str]) -> Optional[tuple[int, int]]:
    try:
        return int(float(row.get("pack_number", 0))), int(float(row.get("pick_number", 0)))
    except (TypeError, ValueError):
        return None


def analyze_raw_archive(path: Path, *, complete_p1p1_candidates: int = 15) -> tuple[dict, dict[str, str]]:
    """Measure raw first-pack shape and recover each draft's known P1P1 card."""
    with open_csv(path) as handle:
        reader = csv.DictReader(handle)
        fieldnames = reader.fieldnames or []
        pack_columns = [name for name in fieldnames if name.startswith("pack_card_")]
        pool_columns = [name for name in fieldnames if name.startswith("pool_")]
        if not pack_columns:
            raise ValueError("Powered Cube draft data has no pack_card_ columns.")

        p1p1_coords: Optional[tuple[int, int]] = None
        first_pack_rows = Counter()
        first_pack_candidate_counts: dict[int, Counter] = {}
        first_pack_pool_nonempty = Counter()
        inherited: dict[str, str] = {}
        total_rows = 0

        for row in reader:
            coords = _coords(row)
            if coords is None:
                continue
            total_rows += 1
            if p1p1_coords is None:
                p1p1_coords = coords
            if coords[0] != p1p1_coords[0]:
                continue

            raw_pick = coords[1]
            candidates = sum(1 for column in pack_columns if truthy_count(row.get(column)) > 0)
            first_pack_rows[raw_pick] += 1
            first_pack_candidate_counts.setdefault(raw_pick, Counter())[candidates] += 1
            if any(truthy_count(row.get(column)) > 0 for column in pool_columns):
                first_pack_pool_nonempty[raw_pick] += 1

            if coords == p1p1_coords and candidates < complete_p1p1_candidates:
                draft_id = str(row.get("draft_id") or "").strip()
                picked = str(row.get("pick") or "").strip()
                if draft_id and picked:
                    inherited[draft_id] = picked

    if p1p1_coords is None:
        raise ValueError("Powered Cube draft archive contained no usable rows.")

    picks = []
    for raw_pick in sorted(first_pack_rows):
        rows = first_pack_rows[raw_pick]
        distribution = first_pack_candidate_counts.get(raw_pick, Counter())
        dominant_count, dominant_rows = distribution.most_common(1)[0] if distribution else (0, 0)
        picks.append({
            "raw_pick_number": raw_pick,
            "rows": rows,
            "dominant_candidate_count": dominant_count,
            "dominant_candidate_share": round(dominant_rows / rows, 4) if rows else 0,
            "candidate_count_distribution": {str(k): v for k, v in sorted(distribution.items())},
            "pool_nonempty_share": round(first_pack_pool_nonempty[raw_pick] / rows, 4) if rows else 0,
        })

    return ({
        "raw_p1p1_coordinates": list(p1p1_coords),
        "total_rows": total_rows,
        "recovered_inherited_p1p1_picks": len(inherited),
        "first_pack_picks": picks,
    }, inherited)


def write_repaired_model_archive(
    source: Path,
    destination: Path,
    inherited_p1p1: Mapping[str, str],
    *,
    complete_p1p1_candidates: int = 15,
) -> dict:
    """Remove incomplete P1P1 rows while retaining their known card in pool context."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    with open_csv(source) as src:
        reader = csv.DictReader(src)
        fieldnames = reader.fieldnames or []
        pack_columns = [name for name in fieldnames if name.startswith("pack_card_")]
        if not pack_columns:
            raise ValueError("Powered Cube draft data has no pack_card_ columns.")

        p1p1_coords: Optional[tuple[int, int]] = None
        removed = 0
        pool_rows_repaired = 0
        missing_pool_column_rows = 0
        with gzip.open(destination, "wt", encoding="utf-8", newline="") as dst:
            writer = csv.DictWriter(dst, fieldnames=fieldnames)
            writer.writeheader()
            for row in reader:
                coords = _coords(row)
                if coords is None:
                    writer.writerow(row)
                    continue
                if p1p1_coords is None:
                    p1p1_coords = coords
                candidates = sum(1 for column in pack_columns if truthy_count(row.get(column)) > 0)
                if coords == p1p1_coords and candidates < complete_p1p1_candidates:
                    removed += 1
                    continue

                draft_id = str(row.get("draft_id") or "").strip()
                inherited = inherited_p1p1.get(draft_id)
                if inherited:
                    pool_column = f"pool_{inherited}"
                    if pool_column not in row:
                        missing_pool_column_rows += 1
                    elif truthy_count(row.get(pool_column)) == 0:
                        row[pool_column] = "1"
                        pool_rows_repaired += 1
                writer.writerow(row)

    if p1p1_coords is None:
        raise ValueError("Powered Cube draft archive contained no draft rows.")
    if destination.stat().st_size < 1024:
        raise ValueError("Filtered Powered Cube model archive is unexpectedly small.")
    return {
        "incomplete_p1p1_rows_removed": removed,
        "inherited_p1p1_drafts": len(inherited_p1p1),
        "pool_rows_repaired": pool_rows_repaired,
        "missing_pool_column_rows": missing_pool_column_rows,
    }


def inspect_rendered_replay(replay: dict, minimum_candidates: int = 14) -> dict:
    picks = replay.get("picks") or []
    base = {"draft_id": str(replay.get("draft_id") or ""), "accepted": False}
    if not picks:
        return {**base, "reason": "no_picks"}

    pack_numbers = [int(p.get("pack_number") or 0) for p in picks]
    first_pack = min(pack_numbers)
    pack = sorted(
        (p for p in picks if int(p.get("pack_number") or 0) == first_pack),
        key=lambda p: int(p.get("pick_number") or 0),
    )
    if not pack:
        return {**base, "reason": "no_first_pack"}

    numbers = [int(p.get("pick_number") or 0) for p in pack]
    candidate_counts = [len(p.get("candidates") or []) for p in pack]
    first_number = numbers[0]
    first_candidates = candidate_counts[0]
    inherited_pool = pack[0].get("pool") or {}
    pool_cards = sum(1 for value in inherited_pool.values() if int(value or 0) > 0)
    common = {
        **base,
        "first_pack_number": first_pack,
        "first_rendered_pick_number": first_number,
        "first_pack_decisions": len(pack),
        "pick_numbers": numbers[:16],
        "candidate_counts": candidate_counts[:16],
        "inherited_pool_cards": pool_cards,
    }

    complete_sequence = list(range(first_number, first_number + 15))
    if first_candidates >= 15 and numbers[:15] == complete_sequence:
        return {**common, "accepted": True, "reason": "complete_p1p1", "missing_p1p1": False, "pick_number_offset": 0}

    if first_candidates < minimum_candidates:
        return {**common, "reason": "first_visible_pack_too_small"}
    if len(pack) < 14:
        return {**common, "reason": "too_few_first_pack_decisions"}
    if numbers[:14] != list(range(first_number, first_number + 14)):
        return {**common, "reason": "non_contiguous_first_pack_picks"}
    if first_number not in {1, 2}:
        return {**common, "reason": "unexpected_first_rendered_pick_number"}
    if pool_cards == 0:
        return {**common, "reason": "empty_inherited_p1p1_pool"}

    # P1P2 must be stored as true pick 2. If the shared builder already did so,
    # offset is zero. Only a rendered pick 1 needs the legacy +1 correction.
    offset = 2 - first_number
    return {**common, "accepted": True, "reason": "first_visible_p1p2", "missing_p1p1": True, "pick_number_offset": offset}


def prepare_rendered_replay(replay: dict, minimum_candidates: int = 14) -> Optional[dict]:
    diagnostic = inspect_rendered_replay(replay, minimum_candidates)
    if not diagnostic.get("accepted"):
        return None
    if not diagnostic.get("missing_p1p1"):
        prepared = dict(replay)
        prepared["cube_start_pick"] = 1
        prepared["cube_missing_p1p1"] = False
        prepared["cube_pick_number_offset"] = 0
        return prepared

    offset = int(diagnostic.get("pick_number_offset") or 0)
    first_pack = int(diagnostic["first_pack_number"])
    shifted = []
    for pick in replay.get("picks") or []:
        rendered = dict(pick)
        if int(pick.get("pack_number") or 0) == first_pack and offset:
            rendered["pick_number"] = int(pick.get("pick_number") or 0) + offset
        shifted.append(rendered)
    prepared = dict(replay)
    prepared["picks"] = shifted
    prepared["cube_start_pick"] = 2
    prepared["cube_missing_p1p1"] = True
    prepared["cube_pick_number_offset"] = offset
    return prepared


def summarize_rendered_replays(replays: Sequence[dict], minimum_candidates: int = 14) -> dict:
    reasons = Counter()
    first_numbers = Counter()
    decision_counts = Counter()
    candidate_counts = Counter()
    pool_sizes = Counter()
    examples: dict[str, dict] = {}
    accepted = 0
    offsets = Counter()

    for replay in replays:
        item = inspect_rendered_replay(replay, minimum_candidates)
        reason = str(item.get("reason") or "unknown")
        reasons[reason] += 1
        if item.get("accepted"):
            accepted += 1
            offsets[int(item.get("pick_number_offset") or 0)] += 1
        if "first_rendered_pick_number" in item:
            first_numbers[int(item["first_rendered_pick_number"])] += 1
            decision_counts[int(item.get("first_pack_decisions") or 0)] += 1
            counts = item.get("candidate_counts") or []
            if counts:
                candidate_counts[int(counts[0])] += 1
            pool_sizes[int(item.get("inherited_pool_cards") or 0)] += 1
        if reason not in examples and len(examples) < 8:
            examples[reason] = item

    return {
        "source_replays": len(replays),
        "accepted_replays": accepted,
        "rejection_reasons": dict(sorted(reasons.items())),
        "first_rendered_pick_numbers": {str(k): v for k, v in sorted(first_numbers.items())},
        "first_pack_decision_counts": {str(k): v for k, v in sorted(decision_counts.items())},
        "first_visible_candidate_counts": {str(k): v for k, v in sorted(candidate_counts.items())},
        "inherited_pool_card_counts": {str(k): v for k, v in sorted(pool_sizes.items())},
        "accepted_pick_number_offsets": {str(k): v for k, v in sorted(offsets.items())},
        "examples": examples,
    }


def filter_playable_runs(
    output_dir: Path,
    *,
    target_replays: int,
    minimum_replays: int,
    minimum_candidates: int,
    shard_size: int,
) -> tuple[dict, dict, int]:
    manifest_path = output_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    source_replays = cube._read_replays(output_dir, manifest)
    diagnostics = summarize_rendered_replays(source_replays, minimum_candidates)
    prepared = [item for replay in source_replays if (item := prepare_rendered_replay(replay, minimum_candidates))]
    selected = prepared[:target_replays]

    if len(selected) < minimum_replays:
        raise ValueError(
            f"Only {len(selected)} Powered Cube replay seats have a complete first visible pack run; "
            f"need at least {minimum_replays}. Rejections: {diagnostics['rejection_reasons']}"
        )

    missing = sum(1 for replay in selected if replay.get("cube_missing_p1p1"))
    if missing not in {0, len(selected)}:
        raise ValueError("Powered Cube replay sample mixes complete and incomplete P1P1 logging.")
    offsets = {int(replay.get("cube_pick_number_offset") or 0) for replay in selected}
    if len(offsets) != 1:
        raise ValueError(f"Powered Cube replay sample has mixed pick-number offsets: {sorted(offsets)}")
    offset = next(iter(offsets))

    dataset = {key: value for key, value in manifest.items() if key not in {"replay_count", "shard_size", "shards"}}
    dataset["replays"] = selected
    filtered = write_sharded_dataset(dataset, output_dir, shard_size)
    return filtered, diagnostics, offset


def write_report(report: dict) -> None:
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--minimum-games", type=int, default=100)
    parser.add_argument("--top-fraction", type=float, default=0.15)
    parser.add_argument("--max-training-drafts", type=int, default=5000)
    parser.add_argument("--max-output-candidates", type=int, default=1200)
    parser.add_argument("--target-replays", type=int, default=300)
    parser.add_argument("--minimum-replays", type=int, default=100)
    parser.add_argument("--minimum-first-visible-candidates", type=int, default=14)
    parser.add_argument("--shard-size", type=int, default=2)
    parser.add_argument("--max-path-bytes", type=int, default=8_000_000)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    report: dict = {
        "schema_version": 2,
        "started_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "mode": cube.CUBE_ID,
        "source_url": cube.CUBE_ARCHIVE_URL,
        "status": "running",
    }
    write_report(report)

    try:
        with tempfile.TemporaryDirectory(prefix="pack1-powered-cube-v2-") as tmp:
            temp = Path(tmp)
            archive = temp / "powered-cube.csv.gz"
            model_archive = temp / "powered-cube-model.csv.gz"
            metadata_path = temp / "powered-cube-cards.json"

            source_date = cube.download_archive(archive)
            raw_shape, inherited = analyze_raw_archive(archive)
            report.update({"source_date": source_date, "raw_shape": raw_shape})
            write_report(report)  # cheap evidence checkpoint before model work

            names = cube.draft_candidate_names(archive)
            repair = write_repaired_model_archive(archive, model_archive, inherited)
            report["training_archive_repair"] = repair
            metadata, unresolved = cube.fetch_cross_set_metadata(names)
            cube.write_metadata(metadata_path, metadata)

            if cube.OUTPUT_DIR.exists():
                shutil.rmtree(cube.OUTPUT_DIR)
            cube.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

            cube.run_command([
                sys.executable, "scripts/build_replays.py",
                "--input", str(model_archive),
                "--output-dir", str(cube.OUTPUT_DIR),
                "--expansion", cube.CUBE_ID,
                "--format", cube.CUBE_FORMAT,
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

            prefilter_manifest = json.loads((cube.OUTPUT_DIR / "manifest.json").read_text(encoding="utf-8"))
            prefilter_replays = cube._read_replays(cube.OUTPUT_DIR, prefilter_manifest)
            report["rendered_replay_diagnostics"] = summarize_rendered_replays(
                prefilter_replays, args.minimum_first_visible_candidates
            )
            write_report(report)  # always preserve the shape that the validator sees

            manifest, diagnostics, pick_number_offset = filter_playable_runs(
                cube.OUTPUT_DIR,
                target_replays=args.target_replays,
                minimum_replays=args.minimum_replays,
                minimum_candidates=args.minimum_first_visible_candidates,
                shard_size=args.shard_size,
            )

            cube.run_command([
                sys.executable, "scripts/build_path_model.py",
                "--input", str(model_archive),
                "--output-dir", str(cube.OUTPUT_DIR),
                "--expansion", cube.CUBE_ID,
                "--source-date", source_date,
                "--minimum-games", str(args.minimum_games),
                "--top-fraction", str(args.top_fraction),
                "--max-training-drafts", str(args.max_training_drafts),
                "--max-bytes", str(args.max_path_bytes),
            ])
            shifted = cube.shift_path_model_pick_numbers(
                cube.OUTPUT_DIR / "path-model.json", pick_number_offset, args.max_path_bytes
            )
            cube.run_command([
                sys.executable, "scripts/validate_dataset.py",
                str(cube.OUTPUT_DIR / "manifest.json"),
                "--minimum-replays", str(args.minimum_replays),
            ])
            excluded, path_cards, path_pairs = cube.validate_path_model(
                cube.OUTPUT_DIR / "path-model.json",
                minimum_replays=args.minimum_replays,
                max_bytes=args.max_path_bytes,
            )
            entry = cube.register_cube(cube.CATALOG_PATH, cube.OUTPUT_DIR)

            missing = sum(1 for replay in cube._read_replays(cube.OUTPUT_DIR, manifest) if replay.get("cube_missing_p1p1"))
            report.update({
                "status": "success",
                "finished_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                "candidate_card_names": len(names),
                "metadata_resolved": len(metadata),
                "metadata_unresolved": unresolved,
                "candidate_replays": diagnostics["source_replays"],
                "playable_cube_replays": diagnostics["accepted_replays"],
                "published_replays": int(manifest["replay_count"]),
                "published_runs_starting_at_p1p2": missing,
                "pick_number_offset": pick_number_offset,
                "shifted_path_exact_rows": shifted,
                "path_model_excluded_replays": excluded,
                "path_cards": path_cards,
                "path_pairs": path_pairs,
                "catalog_entry": entry,
            })
            write_report(report)
            print(json.dumps(report, indent=2), flush=True)
            return 0
    except Exception as exc:
        report.update({
            "status": "failed",
            "finished_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "error": {"type": type(exc).__name__, "message": str(exc)},
        })
        write_report(report)
        print(json.dumps(report, indent=2), flush=True)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
