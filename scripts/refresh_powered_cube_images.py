#!/usr/bin/env python3
"""Replace Powered Cube showcase/promo art with readable standard printings.

This is display-only. It updates the static replay shards hydrated from R2, the
checked-in verified Cube baseline corpus, and the supplemental card-image map.
Puzzle identity, source evidence, scoring, candidate identity, probabilities,
and pick trajectories are asserted unchanged.
"""
from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path
import time
from typing import Iterable, Optional

try:
    from import_powered_cube import _bulk_cards, _named_card, request, JSON_ACCEPT
    from fetch_card_metadata import aliases
except ModuleNotFoundError:
    from scripts.import_powered_cube import _bulk_cards, _named_card, request, JSON_ACCEPT
    from scripts.fetch_card_metadata import aliases

ROOT = Path(__file__).resolve().parents[1]
CUBE_DIR = ROOT / "data" / "powered-cube"
CORPUS_PATH = ROOT / "corpus" / "draft-run" / "powered-cube.json.gz"
CATALOG_PATH = ROOT / "corpus" / "draft-run" / "catalog.json"
CARD_IMAGES_PATH = ROOT / "corpus" / "draft-run" / "card-images.json"
MAP_PATH = ROOT / "generated" / "powered-cube-standard-images.json"
REPORT_PATH = ROOT / "generated" / "powered-cube-image-refresh-report.json"
DISPLAY_FIELDS = ("image_url", "mana_cost", "rarity", "type_line")
BAD_FRAME_EFFECTS = {"showcase", "extendedart", "inverted"}
BAD_SET_TYPES = {"art_series", "memorabilia", "minigame", "token"}


def face_for_alias(card: dict, alias: str) -> Optional[dict]:
    for face in card.get("card_faces") or []:
        if face.get("name") == alias:
            return face
    return None


def image_url(card: dict, alias: str) -> Optional[str]:
    face = face_for_alias(card, alias)
    if face:
        url = (face.get("image_uris") or {}).get("normal")
        if url:
            return url
    url = (card.get("image_uris") or {}).get("normal")
    if url:
        return url
    for item in card.get("card_faces") or []:
        url = (item.get("image_uris") or {}).get("normal")
        if url:
            return url
    return None


def metadata_for_alias(card: dict, alias: str) -> Optional[dict]:
    url = image_url(card, alias)
    if not url:
        return None
    face = face_for_alias(card, alias)
    source = face or card
    return {
        "image_url": url,
        "mana_cost": source.get("mana_cost") or card.get("mana_cost") or "",
        "rarity": card.get("rarity") or "",
        "type_line": source.get("type_line") or card.get("type_line") or "",
    }


def special_flags(card: dict) -> list[str]:
    flags: list[str] = []
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


def printing_rank(card: dict, alias: str) -> tuple[int, int, int]:
    """Lower is better; ordinary English text printings dominate cosmetics."""
    if not image_url(card, alias):
        return (1_000_000, 99, 0)
    penalty = 0
    if card.get("lang") not in (None, "en"):
        penalty += 100_000
    if card.get("textless"):
        penalty += 50_000
    if card.get("full_art"):
        penalty += 25_000
    if card.get("set_type") in BAD_SET_TYPES:
        penalty += 20_000
    if card.get("oversized"):
        penalty += 15_000
    if card.get("promo"):
        penalty += 8_000
    if card.get("border_color") == "borderless":
        penalty += 4_000
    effects = set(card.get("frame_effects") or [])
    if effects & BAD_FRAME_EFFECTS:
        penalty += 2_000
    # Prefer a paper printing when the exact card exists in both paper and Arena.
    if card.get("digital"):
        penalty += 250
    frame = str(card.get("frame") or "")
    frame_rank = {"2015": 0, "2003": 1, "1997": 2, "1993": 3, "future": 4}.get(frame, 5)
    released = str(card.get("released_at") or "0000-00-00").replace("-", "")
    try:
        release_rank = -int(released)
    except ValueError:
        release_rank = 0
    return (penalty, frame_rank, release_rank)


def printings(card: dict, alias: str) -> Iterable[dict]:
    url = str(card.get("prints_search_uri") or "")
    if not url.startswith("https://api.scryfall.com/"):
        return []
    result: list[dict] = []
    while url:
        with request(url, accept=JSON_ACCEPT, timeout=60) as response:
            payload = json.load(response)
        for candidate in payload.get("data") or []:
            if alias in set(aliases(candidate)) and image_url(candidate, alias):
                result.append(candidate)
        url = str(payload.get("next_page") or "") if payload.get("has_more") else ""
        if url:
            time.sleep(0.12)
    return result


def preferred_print(card: dict, alias: str) -> dict:
    if not special_flags(card) and image_url(card, alias):
        return card
    candidates = [card, *printings(card, alias)]
    return min(candidates, key=lambda candidate: printing_rank(candidate, alias))


def resolve_standard_metadata(names: set[str]) -> tuple[dict[str, dict], list[str], dict[str, list[str]]]:
    source_cards: dict[str, dict] = {}
    for card in _bulk_cards():
        for alias in aliases(card):
            if alias in names and alias not in source_cards:
                source_cards[alias] = card

    records: dict[str, dict] = {}
    remaining_flags: dict[str, list[str]] = {}
    for name in sorted(names):
        card = source_cards.get(name)
        if card is None:
            card = _named_card(name)
            time.sleep(0.12)
        if card is None:
            continue
        chosen = preferred_print(card, name)
        metadata = metadata_for_alias(chosen, name)
        if metadata:
            records[name] = metadata
            flags = special_flags(chosen)
            if flags:
                remaining_flags[name] = flags
    unresolved = sorted(names - records.keys())
    return records, unresolved, remaining_flags


def patch_card(card: dict, records: dict[str, dict]) -> tuple[dict, bool]:
    metadata = records.get(str(card.get("name") or ""))
    if not metadata:
        return card, False
    before_non_display = {k: v for k, v in card.items() if k not in DISPLAY_FIELDS}
    updated = dict(card)
    for key in DISPLAY_FIELDS:
        if key in metadata:
            updated[key] = metadata[key]
    after_non_display = {k: v for k, v in updated.items() if k not in DISPLAY_FIELDS}
    if before_non_display != after_non_display:
        raise ValueError("Display refresh changed card identity or scoring metadata.")
    return updated, updated != card


def patch_card_list(cards: list[dict], records: dict[str, dict], ids_by_name: dict[str, set[str]]) -> tuple[list[dict], int]:
    output: list[dict] = []
    changed = 0
    for card in cards:
        name = str(card.get("name") or "")
        card_id = str(card.get("id") or "")
        if name and card_id:
            ids_by_name.setdefault(name, set()).add(card_id)
        updated, did_change = patch_card(card, records)
        output.append(updated)
        changed += int(did_change)
    return output, changed


def read_corpus() -> list[dict]:
    return json.loads(gzip.decompress(CORPUS_PATH.read_bytes()))


def write_corpus(rows: list[dict]) -> str:
    payload = json.dumps(rows, separators=(",", ":"), ensure_ascii=False).encode()
    CORPUS_PATH.write_bytes(gzip.compress(payload, mtime=0))
    return hashlib.sha256(CORPUS_PATH.read_bytes()).hexdigest()


def collect_names(shards: list[Path], corpus: list[dict]) -> set[str]:
    names: set[str] = set()
    for path in shards:
        payload = json.loads(path.read_text(encoding="utf-8"))
        for replay in payload.get("replays") or []:
            for pick in replay.get("picks") or []:
                names.update(str(card.get("name")) for card in pick.get("candidates") or [] if card.get("name"))
    for puzzle in corpus:
        names.update(str(card.get("name")) for card in (puzzle.get("candidates") or []) + (puzzle.get("prior_picks") or []) if card.get("name"))
    return names


def main() -> int:
    shards = sorted((CUBE_DIR / "shards").glob("*.json"))
    if not shards:
        raise SystemExit("Powered Cube shards are missing. Hydrate R2 before refreshing images.")
    if not CORPUS_PATH.exists():
        raise SystemExit("Verified Powered Cube corpus is missing.")

    corpus = read_corpus()
    names = collect_names(shards, corpus)
    records, unresolved, remaining_flags = resolve_standard_metadata(names)
    if not records:
        raise SystemExit("No Powered Cube card metadata could be resolved.")

    ids_by_name: dict[str, set[str]] = {}
    shard_card_changes = 0
    for path in shards:
        payload = json.loads(path.read_text(encoding="utf-8"))
        for replay in payload.get("replays") or []:
            for pick in replay.get("picks") or []:
                cards, changed = patch_card_list(pick.get("candidates") or [], records, ids_by_name)
                pick["candidates"] = cards
                shard_card_changes += changed
        path.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

    corpus_card_changes = 0
    for puzzle in corpus:
        original = {
            **puzzle,
            "candidates": [{k: v for k, v in card.items() if k not in DISPLAY_FIELDS} for card in puzzle.get("candidates") or []],
            "prior_picks": [{k: v for k, v in card.items() if k not in DISPLAY_FIELDS} for card in puzzle.get("prior_picks") or []],
        }
        candidates, changed = patch_card_list(puzzle.get("candidates") or [], records, ids_by_name)
        prior, prior_changed = patch_card_list(puzzle.get("prior_picks") or [], records, ids_by_name)
        puzzle["candidates"] = candidates
        puzzle["prior_picks"] = prior
        corpus_card_changes += changed + prior_changed
        refreshed = {
            **puzzle,
            "candidates": [{k: v for k, v in card.items() if k not in DISPLAY_FIELDS} for card in puzzle.get("candidates") or []],
            "prior_picks": [{k: v for k, v in card.items() if k not in DISPLAY_FIELDS} for card in puzzle.get("prior_picks") or []],
        }
        if original != refreshed:
            raise ValueError(f"Puzzle {puzzle.get('puzzle_id')} changed outside display metadata.")
        if any(not str(card.get("image_url") or "").startswith("https://") for card in candidates + prior):
            raise ValueError(f"Puzzle {puzzle.get('puzzle_id')} lost an image URL.")

    corpus_sha = write_corpus(corpus)
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    cube = next((item for item in catalog.get("sets") or [] if item.get("id") == "powered-cube"), None)
    if cube is None:
        raise ValueError("Powered Cube is missing from the verified corpus catalog.")
    if int(cube.get("puzzles") or 0) != len(corpus):
        raise ValueError("Powered Cube corpus puzzle count changed during image refresh.")
    cube["sha256"] = corpus_sha
    CATALOG_PATH.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")

    card_images = json.loads(CARD_IMAGES_PATH.read_text(encoding="utf-8"))
    for name, ids in ids_by_name.items():
        metadata = records.get(name)
        if not metadata:
            continue
        for card_id in ids:
            card_images[card_id] = {"name": name, **metadata}
    CARD_IMAGES_PATH.write_text(json.dumps(card_images, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    MAP_PATH.parent.mkdir(parents=True, exist_ok=True)
    mapping = [{"name": name, **records[name]} for name in sorted(records)]
    MAP_PATH.write_text(json.dumps(mapping, indent=2) + "\n", encoding="utf-8")
    report = {
        "policy": "standard-readable-v1",
        "card_names": len(names),
        "resolved_names": len(records),
        "unresolved_names": unresolved,
        "remaining_special_printings": remaining_flags,
        "shards": len(shards),
        "shard_card_changes": shard_card_changes,
        "baseline_puzzles": len(corpus),
        "corpus_card_changes": corpus_card_changes,
        "corpus_sha256": corpus_sha,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
