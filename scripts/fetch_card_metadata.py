#!/usr/bin/env python3
"""Fetch card display metadata for offline replay generation.

The primary lookup uses the requested Scryfall set. If a sibling 17Lands draft
archive is available, its pack_card_* header is treated as authoritative and
missing names are resolved individually across Scryfall. This covers bonus
sheets and cross-set inserts without making the browser call Scryfall.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Dict, Iterable, Optional, Sequence

USER_AGENT = "DraftStudy/1.0 (https://github.com/killjoy00/mtg-ev-analyzer)"


def image_url(card: dict) -> Optional[str]:
    direct = card.get("image_uris") or {}
    if direct.get("normal"):
        return direct["normal"]
    for face in card.get("card_faces") or []:
        uris = face.get("image_uris") or {}
        if uris.get("normal"):
            return uris["normal"]
    return None


def compact_card(card: dict) -> dict:
    result = {
        "name": card.get("name"),
        "mana_cost": card.get("mana_cost") or "",
        "rarity": card.get("rarity") or "",
        "type_line": card.get("type_line") or "",
    }
    url = image_url(card)
    if url:
        result["image_url"] = url
    return result


def aliases(card: dict) -> Iterable[str]:
    """Yield Oracle, face, and alternate printed/flavor names for a card."""
    seen: set[str] = set()
    for value in (card.get("name"), card.get("flavor_name"), card.get("printed_name")):
        name = str(value or "").strip()
        if name and name not in seen:
            seen.add(name)
            yield name
    for face in card.get("card_faces") or []:
        for value in (face.get("name"), face.get("flavor_name"), face.get("printed_name")):
            name = str(value or "").strip()
            if name and name not in seen:
                seen.add(name)
                yield name


def request_json(url: str, retries: int = 4) -> dict:
    last_error = None
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urllib.request.urlopen(request, timeout=45) as response:
                return json.load(response)
        except Exception as exc:
            last_error = exc
            if attempt + 1 < retries:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Could not fetch Scryfall metadata: {last_error}")


def fetch_set(set_code: str) -> Dict[str, dict]:
    query = urllib.parse.quote(f"e:{set_code.lower()}")
    url = f"https://api.scryfall.com/cards/search?q={query}&unique=prints&order=set"
    records: Dict[str, dict] = {}
    while url:
        page = request_json(url)
        for card in page.get("data", []):
            metadata = compact_card(card)
            for name in aliases(card):
                records.setdefault(name, metadata)
        url = page.get("next_page") if page.get("has_more") else None
        if url:
            time.sleep(0.12)
    if not records:
        raise RuntimeError(f"Scryfall returned no cards for set {set_code}.")
    return records


def draft_candidate_names(path: Path) -> set[str]:
    opener = gzip.open if str(path).endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        header = next(reader, [])
    return {
        column[len("pack_card_"):]
        for column in header
        if column.startswith("pack_card_") and column[len("pack_card_"):]
    }


def discover_draft_data(output: Path, set_code: str) -> Optional[Path]:
    """Find import_sets.py's sibling raw archive without changing its CLI contract."""
    parent = output.parent
    patterns = [
        f"draft_data_public.{set_code.upper()}.*.csv.gz",
        f"draft_data_public.{set_code.lower()}.*.csv.gz",
        f"draft_data_public.{set_code.upper()}.*.csv",
        f"draft_data_public.{set_code.lower()}.*.csv",
    ]
    for pattern in patterns:
        matches = sorted(parent.glob(pattern))
        if matches:
            return matches[0]
    return None


def fetch_named(name: str) -> Optional[dict]:
    url = "https://api.scryfall.com/cards/named?exact=" + urllib.parse.quote(name)
    try:
        return request_json(url)
    except RuntimeError as exc:
        # request_json wraps HTTP 404 along with transient failures. A fuzzy
        # fallback handles display-name differences such as split/face aliases.
        fuzzy = "https://api.scryfall.com/cards/named?fuzzy=" + urllib.parse.quote(name)
        try:
            return request_json(fuzzy)
        except RuntimeError:
            print(f"warning: unresolved Scryfall card name {name!r}: {exc}")
            return None


def enrich_for_draft_names(records: Dict[str, dict], names: Iterable[str]) -> tuple[Dict[str, dict], list[str]]:
    wanted = {str(name) for name in names if str(name).strip()}
    missing = sorted(wanted - records.keys())
    for name in missing:
        card = fetch_named(name)
        if card:
            metadata = compact_card(card)
            records.setdefault(name, metadata)
            for alias in aliases(card):
                records.setdefault(alias, metadata)
        time.sleep(0.12)
    unresolved = sorted(wanted - records.keys())
    return records, unresolved


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--set", required=True, dest="set_code")
    parser.add_argument("--output", required=True)
    parser.add_argument("--draft-data", help="Optional 17Lands draft_data CSV(.gz) whose pack-card names must be covered.")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    path = Path(args.output)
    records = fetch_set(args.set_code)
    draft_data = Path(args.draft_data) if args.draft_data else discover_draft_data(path, args.set_code)
    unresolved: list[str] = []
    wanted_count = 0
    if draft_data and draft_data.exists():
        names = draft_candidate_names(draft_data)
        wanted_count = len(names)
        records, unresolved = enrich_for_draft_names(records, names)

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")
    if wanted_count:
        coverage = (wanted_count - len(unresolved)) / max(1, wanted_count)
        print(
            f"wrote {len(records)} card aliases to {path}; "
            f"draft-name coverage {coverage:.1%} ({wanted_count - len(unresolved)}/{wanted_count})"
        )
        if unresolved:
            print(f"warning: {len(unresolved)} draft card names remain unresolved: {unresolved[:12]}")
    else:
        print(f"wrote {len(records)} card aliases to {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
