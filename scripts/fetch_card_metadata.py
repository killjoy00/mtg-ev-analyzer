#!/usr/bin/env python3
"""Fetch a set's card display metadata for offline replay generation.

This runs only during dataset builds. The browser never calls the Scryfall API;
it receives precomputed image URLs and card metadata in replay JSON.
"""

from __future__ import annotations

import argparse
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
    name = card.get("name")
    if name:
        yield name
    for face in card.get("card_faces") or []:
        face_name = face.get("name")
        if face_name:
            yield face_name


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


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--set", required=True, dest="set_code")
    parser.add_argument("--output", required=True)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    records = fetch_set(args.set_code)
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(records)} card aliases to {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
