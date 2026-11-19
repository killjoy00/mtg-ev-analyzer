#!/usr/bin/env python3
"""Cheap raw-data preflight for Powered Cube before expensive model training."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import tempfile
from pathlib import Path

try:
    import import_powered_cube as cube
    import powered_cube_shape as shape
except ModuleNotFoundError:
    from scripts import import_powered_cube as cube
    from scripts import powered_cube_shape as shape

DEFAULT_REPORT = Path("generated/powered-cube-preflight.json")


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--minimum-replays", type=int, default=100)
    parser.add_argument("--minimum-first-visible-candidates", type=int, default=14)
    parser.add_argument("--report", default=str(DEFAULT_REPORT))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    destination = Path(args.report)
    report = {
        "schema_version": 2,
        "mode": cube.CUBE_ID,
        "source_url": cube.CUBE_ARCHIVE_URL,
        "started_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    try:
        with tempfile.TemporaryDirectory(prefix="pack1-cube-preflight-") as tmp:
            archive = Path(tmp) / "powered-cube.csv.gz"
            source_date = cube.download_archive(archive)
            raw_shape, inherited = shape.analyze_raw_archive(
                archive,
                minimum_first_visible_candidates=args.minimum_first_visible_candidates,
            )
            visible = raw_shape["first_visible_summary"]
            missing_p1p1 = bool(raw_shape["missing_p1p1"])
            required_candidates = args.minimum_first_visible_candidates if missing_p1p1 else 15
            checks = {
                "first_visible_pick_present": visible is not None,
                "first_visible_pick_has_enough_rows": int(visible["rows"]) >= args.minimum_replays,
                "first_visible_pack_is_complete": int(visible["dominant_candidate_count"]) >= required_candidates,
                "first_visible_pool_context_present": (
                    not missing_p1p1 or float(visible["pool_nonempty_share"]) >= 0.99
                ),
                "recovered_inherited_p1p1_picks": (
                    not missing_p1p1 or len(inherited) >= args.minimum_replays
                ),
            }
            report.update({
                "status": "pass" if all(checks.values()) else "fail",
                "source_date": source_date,
                "raw_shape": raw_shape,
                "first_visible_summary": visible,
                "checks": checks,
            })
            code = 0 if all(checks.values()) else 1
    except Exception as exc:
        report.update({"status": "error", "error": {"type": type(exc).__name__, "message": str(exc)}})
        code = 1
    report["finished_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
