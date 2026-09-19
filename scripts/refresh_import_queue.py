#!/usr/bin/env python3
"""Append newly released 17Lands environments to data/import-queue.json.

The backlog importer consumes that queue and skips anything already in
data/catalog.json, so a set that is never queued is never imported. The queue
was maintained by hand, which meant a new release entered Pack One only when
someone remembered to edit this file. This script closes that gap: it asks
Scryfall what has been released, keeps what 17Lands actually publishes a
Premier Draft archive for, and writes those codes into the queue newest-first.

It only ever adds codes. Removing one is a retirement decision, which belongs
in data/selection-policy.json and is applied here through supported_set().
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
from typing import Callable, Optional, Sequence

try:  # pragma: no cover - exercised by both import styles in tests
    from . import import_sets
    from .set_policy import supported_set
except ImportError:  # pragma: no cover
    import import_sets
    from set_policy import supported_set

REPO_ROOT = Path(__file__).resolve().parents[1]
QUEUE_PATH = REPO_ROOT / "data" / "import-queue.json"

# An archive published the week a set releases holds a few hundred drafts. The
# importer would accept it - its floor is 100 replays - and then never look at
# that archive again, because import_sets skips anything already catalogued.
# The set would be pinned at launch-week depth for good, which is how the
# thinnest environments in the corpus got that way. Waiting lets the archive
# accumulate before it is frozen. This is a policy number, not a fact about
# the data: raise it for a deeper sample, lower it to publish sooner.
DEFAULT_MINIMUM_AGE_DAYS = 21


def load_queue(path: Path = QUEUE_PATH) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("sets"), list):
        raise ValueError(f"Import queue must define a sets list: {path}")
    if not str(payload.get("format") or "").strip():
        raise ValueError(f"Import queue must define a format: {path}")
    return payload


def discover_new_codes(
    queued: Sequence[str],
    *,
    format_name: str,
    minimum_age_days: int,
    today: Optional[dt.date] = None,
    fetch_sets: Callable[[str], list[tuple[str, str]]] = None,
    probe: Callable[[str, str, str], object] = None,
) -> list[str]:
    """Return released, supported, archive-backed codes newer than the queue.

    Discovery looks forward only. Scryfall lists every product since 2021 -
    tokens, promos, Alchemy rebalances, masters reprints - and the ones older
    than the queue were already decided: imported, or left out on purpose.
    Re-proposing those daily would mean two hundred archive probes to rediscover
    the same answer and would relitigate curation the queue already settled.
    A set released after everything queued is the only genuinely new thing.
    """
    fetch_sets = fetch_sets or import_sets.fetch_scryfall_sets
    probe = probe or import_sets.probe_public_dataset
    today = today or dt.datetime.now(dt.timezone.utc).date()
    known = {str(code).strip().upper() for code in queued}

    released_by_code = dict(fetch_sets("2021-01-01"))
    queued_releases = [
        released_by_code[code] for code in known if code in released_by_code
    ]
    if not queued_releases:
        raise RuntimeError(
            "No queued set matched a Scryfall release date; refusing to treat "
            "every released set as new."
        )
    newest_queued = max(queued_releases)

    found: list[str] = []
    for code, released in released_by_code.items():
        if code in known or released <= newest_queued or not supported_set(code):
            continue
        try:
            released_date = dt.date.fromisoformat(released)
        except ValueError:
            continue
        age = (today - released_date).days
        if age < minimum_age_days:
            print(f"{code}: released {released} ({age}d), waiting for a deeper archive")
            continue
        if probe(code, format_name, released) is None:
            print(f"{code}: no public {format_name} archive yet")
            continue
        print(f"{code}: released {released} ({age}d), archive available")
        found.append(code)

    # Newest-first, matching the order the queue file documents.
    found.sort(key=lambda code: (released_by_code[code], code), reverse=True)
    return found


def insert_newest_first(queue: dict, new_codes: Sequence[str]) -> dict:
    """Put discovered codes at the front, preserving the file's newest-first order."""
    updated = dict(queue)
    updated["sets"] = [*new_codes, *queue["sets"]]
    return updated


def write_queue(queue: dict, path: Path = QUEUE_PATH) -> None:
    path.write_text(json.dumps(queue, indent=2) + "\n", encoding="utf-8")


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--minimum-age-days",
        type=int,
        default=DEFAULT_MINIMUM_AGE_DAYS,
        help="Days a set must be released before its archive is queued.",
    )
    parser.add_argument(
        "--queue", default=str(QUEUE_PATH.relative_to(REPO_ROOT)),
        help="Queue file to update.",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Report what would be queued without writing the file.",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    path = REPO_ROOT / args.queue
    queue = load_queue(path)
    new_codes = discover_new_codes(
        queue["sets"],
        format_name=str(queue["format"]).strip(),
        minimum_age_days=args.minimum_age_days,
    )
    if not new_codes:
        print("No new environments to queue.")
        return 0
    print(f"Queueing {len(new_codes)} new environment(s): {' '.join(new_codes)}")
    if args.dry_run:
        return 0
    write_queue(insert_newest_first(queue, new_codes), path)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
