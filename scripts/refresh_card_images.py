#!/usr/bin/env python3
"""Normalize every currently served Pack One card image to deterministic main art.

This is a display-only maintenance operation. It patches hydrated replay shards,
checked-in verified corpus payloads, and the supplemental card-image map while
asserting that puzzle identity, scoring, probabilities, provenance, and draft
trajectories remain unchanged.

Scryfall's default_cards bulk export is downloaded once. For regular draft sets,
ordinary base printings from that set are preferred. If the set has no ordinary
printing for an alias, the resolver falls back to the earliest ordinary printing
for that exact card identity. Powered Cube uses the same global earliest-base
policy directly.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import time
from pathlib import Path
from typing import Optional

try:
    from fetch_card_metadata import aliases, fetch_named, image_url, metadata_for_alias, printing_rank, special_flags
    from refresh_powered_cube_images import all_printings
except ModuleNotFoundError:
    from scripts.fetch_card_metadata import aliases, fetch_named, image_url, metadata_for_alias, printing_rank, special_flags
    from scripts.refresh_powered_cube_images import all_printings

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
CORPUS_DIR = ROOT / "corpus" / "draft-run"
CATALOG_PATH = CORPUS_DIR / "catalog.json"
CARD_IMAGES_PATH = CORPUS_DIR / "card-images.json"
MAP_DIR = ROOT / "generated" / "card-image-refresh"
REPORT_PATH = ROOT / "generated" / "card-image-refresh-report.json"
DISPLAY_FIELDS = ("image_url", "mana_cost", "rarity", "type_line")


def read_corpus(path: Path) -> list[dict]:
    return json.loads(gzip.decompress(path.read_bytes()))


def write_corpus(path: Path, rows: list[dict]) -> str:
    payload = json.dumps(rows, separators=(",", ":"), ensure_ascii=False).encode()
    path.write_bytes(gzip.compress(payload, mtime=0))
    return hashlib.sha256(path.read_bytes()).hexdigest()


def scrub_card(card: dict) -> dict:
    return {key: value for key, value in card.items() if key not in DISPLAY_FIELDS}


def patch_card(card: dict, metadata: Optional[dict]) -> tuple[dict, bool]:
    if not metadata:
        return card, False
    before = scrub_card(card)
    updated = dict(card)
    for key in DISPLAY_FIELDS:
        if key in metadata:
            updated[key] = metadata[key]
    if before != scrub_card(updated):
        raise ValueError("Card image refresh changed non-display metadata.")
    return updated, updated != card


def patch_cards(cards: list[dict], records: dict[str, dict], names_by_id: dict[str, set[str]]) -> tuple[list[dict], int]:
    output: list[dict] = []
    changed = 0
    for card in cards:
        name = str(card.get("name") or "")
        card_id = str(card.get("id") or "")
        if name and card_id:
            names_by_id.setdefault(card_id, set()).add(name)
        updated, did_change = patch_card(card, records.get(name))
        output.append(updated)
        changed += int(did_change)
    return output, changed


def collect_inventory(catalog: dict) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    names_by_set: dict[str, set[str]] = {}
    names_by_id: dict[str, set[str]] = {}
    for entry in catalog.get("sets") or []:
        sid = str(entry.get("id") or "")
        corpus_path = CORPUS_DIR / f"{sid}.json.gz"
        if not sid or not corpus_path.exists():
            raise ValueError(f"Verified corpus file is missing for {sid or '<unknown>'}.")
        names = names_by_set.setdefault(sid, set())
        for puzzle in read_corpus(corpus_path):
            for card in (puzzle.get("candidates") or []) + (puzzle.get("prior_picks") or []):
                name = str(card.get("name") or "")
                card_id = str(card.get("id") or "")
                if name:
                    names.add(name)
                if name and card_id:
                    names_by_id.setdefault(card_id, set()).add(name)
        shards = sorted((DATA_DIR / sid / "shards").glob("*.json"))
        if not shards:
            raise ValueError(f"Hydrated replay shards are missing for {sid}.")
        for shard in shards:
            payload = json.loads(shard.read_text(encoding="utf-8"))
            for replay in payload.get("replays") or []:
                for pick in replay.get("picks") or []:
                    for card in pick.get("candidates") or []:
                        name = str(card.get("name") or "")
                        card_id = str(card.get("id") or "")
                        if name:
                            names.add(name)
                        if name and card_id:
                            names_by_id.setdefault(card_id, set()).add(name)
    return names_by_set, names_by_id


def resolve_inventory(names_by_set: dict[str, set[str]]) -> tuple[dict[str, dict[str, dict]], dict[str, dict], dict[str, dict]]:
    sets_by_name: dict[str, set[str]] = {}
    for sid, names in names_by_set.items():
        for name in names:
            sets_by_name.setdefault(name, set()).add(sid)

    global_best: dict[str, dict] = {}
    global_rank: dict[str, tuple] = {}
    global_has_ordinary: set[str] = set()
    set_best: dict[tuple[str, str], dict] = {}
    set_rank: dict[tuple[str, str], tuple] = {}
    set_has_ordinary: set[tuple[str, str]] = set()

    wanted = set(sets_by_name)
    for card in all_printings():
        matched = set(aliases(card)) & wanted
        if not matched:
            continue
        for alias in matched:
            if not image_url(card, alias):
                continue
            if not special_flags(card):
                global_has_ordinary.add(alias)
            rank = printing_rank(card, alias)
            if alias not in global_rank or rank < global_rank[alias]:
                global_rank[alias] = rank
                global_best[alias] = card
            for sid in sets_by_name[alias]:
                preferred = None if sid == "powered-cube" else sid
                key = (sid, alias)
                if not special_flags(card):
                    set_has_ordinary.add(key)
                rank = printing_rank(card, alias, preferred)
                if key not in set_rank or rank < set_rank[key]:
                    set_rank[key] = rank
                    set_best[key] = card

    # Scryfall's default_cards bulk export intentionally omits a small number
    # of digital/rebalanced or otherwise non-default card identities. Resolve
    # only those bulk misses through the shared exact-name resolver, which
    # follows the card's prints_search_uri and applies the same main-art policy.
    missing_from_bulk = sorted(wanted - global_best.keys())
    for name in missing_from_bulk:
        global_card = fetch_named(name)
        if global_card and image_url(global_card, name):
            global_best[name] = global_card
            global_rank[name] = printing_rank(global_card, name)
            if not special_flags(global_card):
                global_has_ordinary.add(name)
        for sid in sorted(sets_by_name.get(name) or []):
            preferred = None if sid == "powered-cube" else sid
            chosen = global_card if preferred is None else fetch_named(name, preferred)
            if chosen and image_url(chosen, name):
                key = (sid, name)
                set_best[key] = chosen
                set_rank[key] = printing_rank(chosen, name, preferred)
                if not special_flags(chosen):
                    set_has_ordinary.add(key)
            time.sleep(0.15)

    records_by_set: dict[str, dict[str, dict]] = {}
    selection_details: dict[str, dict] = {}
    global_records: dict[str, dict] = {}
    for name, card in global_best.items():
        global_records[name] = metadata_for_alias(card, name)
    for sid, names in names_by_set.items():
        records: dict[str, dict] = {}
        details: dict[str, dict] = {}
        for name in sorted(names):
            card = set_best.get((sid, name)) or global_best.get(name)
            if not card:
                continue
            records[name] = metadata_for_alias(card, name)
            flags = special_flags(card)
            chosen_set = str(card.get("set") or "")
            if flags or (sid != "powered-cube" and chosen_set.lower() != sid.lower()):
                details[name] = {
                    "selected_set": chosen_set,
                    "released_at": card.get("released_at"),
                    "collector_number": card.get("collector_number"),
                    "special_flags": flags,
                    "special_unavoidable": bool(flags) and (sid, name) not in set_has_ordinary,
                }
        records_by_set[sid] = records
        selection_details[sid] = details
    return records_by_set, global_records, selection_details


def patch_shards(sid: str, records: dict[str, dict], names_by_id: dict[str, set[str]]) -> tuple[int, int]:
    files = sorted((DATA_DIR / sid / "shards").glob("*.json"))
    if not files:
        raise ValueError(f"Hydrated replay shards are missing for {sid}.")
    changed_cards = 0
    for path in files:
        payload = json.loads(path.read_text(encoding="utf-8"))
        for replay in payload.get("replays") or []:
            for pick in replay.get("picks") or []:
                original = [scrub_card(card) for card in pick.get("candidates") or []]
                cards, changed = patch_cards(pick.get("candidates") or [], records, names_by_id)
                if original != [scrub_card(card) for card in cards]:
                    raise ValueError(f"{sid}: shard image refresh changed gameplay metadata.")
                pick["candidates"] = cards
                changed_cards += changed
        path.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    return len(files), changed_cards


def patch_verified_corpus(sid: str, records: dict[str, dict], names_by_id: dict[str, set[str]]) -> tuple[int, int, str]:
    path = CORPUS_DIR / f"{sid}.json.gz"
    rows = read_corpus(path)
    changed_cards = 0
    for puzzle in rows:
        before = {
            **puzzle,
            "candidates": [scrub_card(card) for card in puzzle.get("candidates") or []],
            "prior_picks": [scrub_card(card) for card in puzzle.get("prior_picks") or []],
        }
        candidates, changed = patch_cards(puzzle.get("candidates") or [], records, names_by_id)
        prior, prior_changed = patch_cards(puzzle.get("prior_picks") or [], records, names_by_id)
        puzzle["candidates"] = candidates
        puzzle["prior_picks"] = prior
        changed_cards += changed + prior_changed
        after = {
            **puzzle,
            "candidates": [scrub_card(card) for card in candidates],
            "prior_picks": [scrub_card(card) for card in prior],
        }
        if before != after:
            raise ValueError(f"{sid}: corpus image refresh changed gameplay metadata.")
        if any(not str(card.get("image_url") or "").startswith("https://") for card in candidates + prior):
            raise ValueError(f"{sid}: corpus image refresh lost an HTTPS image.")
    return len(rows), changed_cards, write_corpus(path, rows)


def mapping_entry(name: str, metadata: dict) -> dict:
    return {"name": name, **{key: metadata[key] for key in DISPLAY_FIELDS if key in metadata}}


def main() -> int:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    names_by_set, names_by_id = collect_inventory(catalog)
    records_by_set, global_records, selection_details = resolve_inventory(names_by_set)
    MAP_DIR.mkdir(parents=True, exist_ok=True)

    report = {
        "policy": "main-readable-v3-bulk",
        "unique_card_names": len({name for names in names_by_set.values() for name in names}),
        "sets": {},
        "card_id_name_collisions": {},
    }

    for entry in catalog.get("sets") or []:
        sid = entry["id"]
        records = records_by_set.get(sid, {})
        unresolved = sorted(names_by_set[sid] - records.keys())
        shard_files, shard_changes = patch_shards(sid, records, names_by_id)
        puzzles, corpus_changes, sha = patch_verified_corpus(sid, records, names_by_id)
        entry["sha256"] = sha
        mapping = [mapping_entry(name, records[name]) for name in sorted(records) if records[name].get("image_url")]
        (MAP_DIR / f"{sid}.json").write_text(json.dumps(mapping, indent=2) + "\n", encoding="utf-8")
        special = {
            name: detail
            for name, detail in selection_details.get(sid, {}).items()
            if detail.get("special_flags") and not detail.get("special_unavoidable")
        }
        unavoidable_special = {
            name: detail
            for name, detail in selection_details.get(sid, {}).items()
            if detail.get("special_flags") and detail.get("special_unavoidable")
        }
        cross_set = {
            name: detail
            for name, detail in selection_details.get(sid, {}).items()
            if sid != "powered-cube" and str(detail.get("selected_set") or "").lower() != sid.lower()
        }
        if not unresolved and not special:
            entry["unresolved_image_names"] = []
        report["sets"][sid] = {
            "card_names": len(names_by_set[sid]),
            "resolved_names": len(records),
            "unresolved_names": unresolved,
            "mapping_entries": len(mapping),
            "remaining_special_printings": special,
            "unavoidable_special_printings": unavoidable_special,
            "cross_set_fallbacks": cross_set,
            "shards": shard_files,
            "shard_card_changes": shard_changes,
            "puzzles": puzzles,
            "corpus_card_changes": corpus_changes,
            "corpus_sha256": sha,
        }

    card_images = json.loads(CARD_IMAGES_PATH.read_text(encoding="utf-8"))
    for card_id, names in sorted(names_by_id.items()):
        if len(names) == 1:
            name = next(iter(names))
        else:
            existing_name = str((card_images.get(card_id) or {}).get("name") or "")
            if existing_name not in names:
                report["card_id_name_collisions"][card_id] = sorted(names)
                continue
            name = existing_name
        metadata = global_records.get(name)
        if metadata and metadata.get("image_url"):
            card_images[card_id] = metadata
    CARD_IMAGES_PATH.write_text(json.dumps(card_images, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    CATALOG_PATH.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    unresolved_total = sum(len(item["unresolved_names"]) for item in report["sets"].values())
    special_total = sum(len(item["remaining_special_printings"]) for item in report["sets"].values())
    unavoidable_special_total = sum(len(item["unavoidable_special_printings"]) for item in report["sets"].values())
    cross_set_total = sum(len(item["cross_set_fallbacks"]) for item in report["sets"].values())
    summary = {
        "sets": len(report["sets"]),
        "unique_card_names": report["unique_card_names"],
        "unresolved_names": unresolved_total,
        "remaining_special_printings": special_total,
        "unavoidable_special_printings": unavoidable_special_total,
        "cross_set_fallbacks": cross_set_total,
        "card_id_name_collisions": len(report["card_id_name_collisions"]),
    }
    print(json.dumps(summary, sort_keys=True))
    problems = {
        "unresolved_names": {
            sid: item["unresolved_names"]
            for sid, item in report["sets"].items()
            if item["unresolved_names"]
        },
        "remaining_special_printings": {
            sid: item["remaining_special_printings"]
            for sid, item in report["sets"].items()
            if item["remaining_special_printings"]
        },
        "card_id_name_collisions": report["card_id_name_collisions"],
    }
    if any(problems.values()):
        print(json.dumps({"card_image_refresh_problems": problems}, sort_keys=True))
    if unresolved_total:
        raise SystemExit("Main-art refresh left unresolved card names; refusing publication.")
    if special_total:
        raise SystemExit("Main-art refresh still selected cosmetic/special printings; refusing publication.")
    if report["card_id_name_collisions"]:
        raise SystemExit("Main-art refresh found ambiguous card-id/name mappings; refusing publication.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
