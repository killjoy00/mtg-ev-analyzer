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
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Dict, Iterable, Optional, Sequence

USER_AGENT = "DraftStudy/1.0 (https://github.com/killjoy00/mtg-ev-analyzer)"
BAD_FRAME_EFFECTS = {"showcase", "extendedart", "inverted"}
BAD_SET_TYPES = {"art_series", "memorabilia", "minigame", "token"}


def face_for_alias(card: dict, alias: str) -> Optional[dict]:
    for face in card.get("card_faces") or []:
        if face.get("name") == alias or face.get("flavor_name") == alias or face.get("printed_name") == alias:
            return face
    return None


def image_url(card: dict, alias: Optional[str] = None) -> Optional[str]:
    if alias:
        face = face_for_alias(card, alias)
        if face:
            url = (face.get("image_uris") or {}).get("normal")
            if url:
                return url
    direct = card.get("image_uris") or {}
    if direct.get("normal"):
        return direct["normal"]
    for face in card.get("card_faces") or []:
        uris = face.get("image_uris") or {}
        if uris.get("normal"):
            return uris["normal"]
    return None


def metadata_for_alias(card: dict, alias: Optional[str] = None) -> dict:
    source = face_for_alias(card, alias) if alias else None
    source = source or card
    result = {
        "name": alias or card.get("name"),
        "mana_cost": source.get("mana_cost") or card.get("mana_cost") or "",
        "rarity": card.get("rarity") or "",
        "type_line": source.get("type_line") or card.get("type_line") or "",
    }
    url = image_url(card, alias)
    if url:
        result["image_url"] = url
    return result


def compact_card(card: dict) -> dict:
    return metadata_for_alias(card)


def special_flags(card: dict) -> list[str]:
    flags: list[str] = []
    if card.get("variation"):
        flags.append("variation")
    if card.get("textless"):
        flags.append("textless")
    if card.get("full_art"):
        flags.append("full_art")
    if card.get("promo"):
        flags.append("promo")
    if card.get("oversized"):
        flags.append("oversized")
    if card.get("border_color") == "borderless":
        flags.append("borderless")
    effects = set(card.get("frame_effects") or [])
    for effect in sorted(effects & BAD_FRAME_EFFECTS):
        flags.append(effect)
    if card.get("set_type") in BAD_SET_TYPES:
        flags.append(str(card.get("set_type")))
    return flags


def collector_number_rank(value: object) -> tuple[int, int, str]:
    text = str(value or "")
    match = re.fullmatch(r"(\d+)(.*)", text)
    if match:
        return (0, int(match.group(1)), match.group(2).lower())
    return (1, 1_000_000_000, text.lower())


def printing_rank(card: dict, alias: Optional[str] = None, preferred_set: Optional[str] = None) -> tuple:
    """Lower is better: base readable art, then the intended set, then earliest printing."""
    if not image_url(card, alias):
        return (1_000_000, 1_000_000, 1, 1, 99_999_999, (9, 1_000_000_000, ""), "")
    language_penalty = 0 if card.get("lang") in (None, "en") else 1_000_000
    penalty = 0
    if card.get("variation"):
        penalty += 250_000
    if card.get("textless"):
        penalty += 200_000
    if card.get("full_art"):
        penalty += 100_000
    if card.get("set_type") in BAD_SET_TYPES:
        penalty += 80_000
    if card.get("oversized"):
        penalty += 60_000
    if card.get("promo"):
        penalty += 40_000
    if card.get("border_color") == "borderless":
        penalty += 20_000
    if set(card.get("frame_effects") or []) & BAD_FRAME_EFFECTS:
        penalty += 10_000
    set_rank = 0 if not preferred_set or str(card.get("set") or "").lower() == preferred_set.lower() else 1
    digital_rank = 1 if card.get("digital") else 0
    released = str(card.get("released_at") or "9999-99-99").replace("-", "")
    try:
        release_rank = int(released)
    except ValueError:
        release_rank = 99_999_999
    return (
        language_penalty,
        penalty,
        set_rank,
        digital_rank,
        release_rank,
        collector_number_rank(card.get("collector_number")),
        str(card.get("id") or ""),
    )


def choose_main_printing(cards: Iterable[dict], alias: str, preferred_set: Optional[str] = None) -> Optional[dict]:
    options = [card for card in cards if alias in set(aliases(card)) and image_url(card, alias)]
    if not options:
        return None
    return min(options, key=lambda card: printing_rank(card, alias, preferred_set))


def is_preparation_card(card: dict) -> bool:
    keywords = {str(value).lower() for value in card.get("keywords") or []}
    if "prepared" in keywords or "prepare" in keywords:
        return True
    return any("prepared" in str(face.get("oracle_text") or "").lower() for face in card.get("card_faces") or [])


def aliases(card: dict) -> Iterable[str]:
    """Yield Oracle, face, and alternate printed/flavor names for a card.

    Preparation cards are a special case: their embedded spell name is not the
    identity of the creature card. Treating it as a generic face alias can make
    a newer Prepare card steal display metadata from a distinct standalone card
    with the same name (for example Harmonized Trio // Brainstorm). Keep the
    creature face alias, but do not expose the prepared spell face as an alias.
    """
    seen: set[str] = set()
    for value in (card.get("name"), card.get("flavor_name"), card.get("printed_name")):
        name = str(value or "").strip()
        if name and name not in seen:
            seen.add(name)
            yield name
    faces = card.get("card_faces") or []
    if is_preparation_card(card) and faces:
        faces = faces[:1]
    for face in faces:
        for value in (face.get("name"), face.get("flavor_name"), face.get("printed_name")):
            name = str(value or "").strip()
            if name and name not in seen:
                seen.add(name)
                yield name


def request_json(url: str, retries: int = 7) -> dict:
    last_error = None
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urllib.request.urlopen(request, timeout=45) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            last_error = exc
            retryable = exc.code == 429 or 500 <= exc.code < 600
            if not retryable or attempt + 1 >= retries:
                break
            retry_after = exc.headers.get("Retry-After") if exc.headers else None
            try:
                delay = float(retry_after) if retry_after is not None else 0.0
            except ValueError:
                delay = 0.0
            time.sleep(max(delay, min(2.0 ** attempt, 30.0)))
        except (urllib.error.URLError, TimeoutError) as exc:
            last_error = exc
            if attempt + 1 >= retries:
                break
            time.sleep(min(2.0 ** attempt, 30.0))
        except Exception as exc:
            last_error = exc
            if attempt + 1 >= retries:
                break
            time.sleep(min(2.0 ** attempt, 30.0))
    raise RuntimeError(f"Could not fetch Scryfall metadata: {last_error}")


def fetch_set(set_code: str) -> Dict[str, dict]:
    query = urllib.parse.quote(f"e:{set_code.lower()}")
    url = f"https://api.scryfall.com/cards/search?q={query}&unique=prints&order=set"
    candidates: Dict[str, list[dict]] = {}
    while url:
        page = request_json(url)
        for card in page.get("data", []):
            for name in aliases(card):
                candidates.setdefault(name, []).append(card)
        url = page.get("next_page") if page.get("has_more") else None
        if url:
            time.sleep(0.2)
    records: Dict[str, dict] = {}
    for name, options in candidates.items():
        chosen = choose_main_printing(options, name, set_code)
        if chosen:
            records[name] = metadata_for_alias(chosen, name)
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


def fetch_named(name: str, preferred_set: Optional[str] = None) -> Optional[dict]:
    """Resolve a name, then choose its base readable printing rather than Scryfall's default printing."""
    resolved = None
    exact = "https://api.scryfall.com/cards/named?exact=" + urllib.parse.quote(name)
    try:
        resolved = request_json(exact)
    except RuntimeError as exc:
        fuzzy = "https://api.scryfall.com/cards/named?fuzzy=" + urllib.parse.quote(name)
        try:
            resolved = request_json(fuzzy)
        except RuntimeError:
            print(f"warning: unresolved Scryfall card name {name!r}: {exc}")
            return None
    resolved_aliases = set(aliases(resolved))
    lookup_alias = name if name in resolved_aliases else str(resolved.get("name") or "")
    prints_url = str(resolved.get("prints_search_uri") or "")
    if lookup_alias and prints_url.startswith("https://api.scryfall.com/cards/search"):
        # Use Scryfall's own printing-search URI for this card identity instead
        # of reconstructing query syntax. Throttle between API requests.
        time.sleep(0.1)
        printings: list[dict] = []
        url = prints_url
        while url:
            page = request_json(url)
            printings.extend(page.get("data", []))
            url = page.get("next_page") if page.get("has_more") else None
            if url:
                time.sleep(0.2)
        chosen = choose_main_printing(printings, lookup_alias, preferred_set)
        if chosen:
            return chosen
    return resolved if lookup_alias and image_url(resolved, lookup_alias) else None


def enrich_for_draft_names(records: Dict[str, dict], names: Iterable[str], set_code: Optional[str] = None) -> tuple[Dict[str, dict], list[str]]:
    wanted = {str(name) for name in names if str(name).strip()}
    missing = sorted(wanted - records.keys())
    for name in missing:
        card = fetch_named(name, set_code)
        if card:
            metadata = metadata_for_alias(card, name)
            records.setdefault(name, metadata)
            for alias in aliases(card):
                records.setdefault(alias, metadata_for_alias(card, alias))
        time.sleep(0.2)
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
        records, unresolved = enrich_for_draft_names(records, names, args.set_code)

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
