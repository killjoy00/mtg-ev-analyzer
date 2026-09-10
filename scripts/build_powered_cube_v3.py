#!/usr/bin/env python3
"""Build Powered Cube using the measured Arena/17Lands first-pack shape.

Current public data starts with a complete 14-card P1P2 at raw pick 1. Its pool
already contains the real historical P1P1 card, so this builder preserves that
row and context exactly. No synthetic P1P1 pick or pool injection is performed.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Optional, Sequence

try:
    import build_powered_cube as rendered
    import import_powered_cube as cube
    import powered_cube_shape as shape
except ModuleNotFoundError:
    from scripts import build_powered_cube as rendered
    from scripts import import_powered_cube as cube
    from scripts import powered_cube_shape as shape


def write_report(report: dict) -> None:
    cube.REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    cube.REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


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
        "schema_version": 3,
        "started_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "mode": cube.CUBE_ID,
        "source_url": cube.CUBE_ARCHIVE_URL,
        "status": "running",
        "builder": "measured-first-visible-v3",
    }
    write_report(report)

    try:
        with tempfile.TemporaryDirectory(prefix="pack1-powered-cube-v3-") as tmp:
            temp = Path(tmp)
            archive = temp / "powered-cube.csv.gz"
            model_archive = temp / "powered-cube-model.csv.gz"
            metadata_path = temp / "powered-cube-cards.json"

            source_date = cube.download_archive(archive)
            raw_shape, inherited = shape.analyze_raw_archive(
                archive,
                minimum_first_visible_candidates=args.minimum_first_visible_candidates,
            )
            report.update({"source_date": source_date, "raw_shape": raw_shape})
            write_report(report)

            visible = raw_shape["first_visible_summary"]
            if int(visible["rows"]) < args.minimum_replays:
                raise ValueError(
                    f"Powered Cube has only {visible['rows']} first-visible rows; need {args.minimum_replays}."
                )
            if raw_shape["missing_p1p1"]:
                if int(visible["dominant_candidate_count"]) < args.minimum_first_visible_candidates:
                    raise ValueError("Powered Cube first visible pack is smaller than the 14-card P1P2 requirement.")
                if float(visible["pool_nonempty_share"]) < 0.99:
                    raise ValueError("Powered Cube P1P2 rows do not reliably contain inherited P1P1 pool context.")
                if len(inherited) < args.minimum_replays:
                    raise ValueError(
                        f"Recovered inherited P1P1 cards for only {len(inherited)} drafts; need {args.minimum_replays}."
                    )

            repair = shape.write_model_archive(
                archive,
                model_archive,
                raw_shape,
                minimum_first_visible_candidates=args.minimum_first_visible_candidates,
            )
            report["training_archive_normalization"] = repair
            write_report(report)

            names = cube.draft_candidate_names(archive)
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
            report["rendered_replay_diagnostics"] = rendered.summarize_rendered_replays(
                prefilter_replays, args.minimum_first_visible_candidates
            )
            write_report(report)

            manifest, diagnostics, pick_number_offset = rendered.filter_playable_runs(
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

            published = cube._read_replays(cube.OUTPUT_DIR, manifest)
            missing = sum(1 for replay in published if replay.get("cube_missing_p1p1"))
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
