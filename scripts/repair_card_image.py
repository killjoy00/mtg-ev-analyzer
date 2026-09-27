#!/usr/bin/env python3
"""Repair one exact served card's display metadata in explicitly selected environments."""
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Iterable, Optional

try:
    import refresh_card_images as refresh
except ModuleNotFoundError:
    from scripts import refresh_card_images as refresh

REPORT_PATH = refresh.ROOT / "generated" / "card-image-repair" / "report.json"
MAX_ENVIRONMENTS = 8
BACKEND_ACTIONS = {"refresh-images", "refresh-image-page", "normalize-image-markers"}
URL_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*://")
WINDOWS_PATH_RE = re.compile(r"^[A-Za-z]:[\\/]")
REF_RE = re.compile(r"^refs/(?:heads|tags|pull)/")
SQL_RE = re.compile(
    r"(?:\b(?:drop|alter|create|truncate)\s+table\b|"
    r"\bdelete\s+from\b|\binsert\s+into\b|\bupdate\s+\S+\s+set\b|\bselect\b.+\bfrom\b)",
    re.IGNORECASE,
)


def printing_details(card: Optional[dict]) -> Optional[dict]:
    if not card:
        return None
    return {
        "set": str(card.get("set") or ""),
        "collector_number": str(card.get("collector_number") or ""),
        "scryfall_id": str(card.get("id") or ""),
        "special_flags": refresh.special_flags(card),
    }


def validate_card_name(card_name: str) -> str:
    if not isinstance(card_name, str) or not (1 <= len(card_name) <= 200):
        raise ValueError("card_name must be 1-200 characters.")
    if card_name != card_name.strip():
        raise ValueError("card_name must not have leading or trailing whitespace.")
    if any(ord(char) < 32 or ord(char) == 127 for char in card_name):
        raise ValueError("card_name must not contain control characters.")
    lower = card_name.lower()
    if (
        URL_RE.search(card_name)
        or WINDOWS_PATH_RE.search(card_name)
        or card_name.startswith(("/", "./", "../", "~/"))
        or "\\" in card_name
        or REF_RE.search(card_name)
        or lower in BACKEND_ACTIONS
        or ";" in card_name
        or "/*" in card_name
        or "*/" in card_name
        or SQL_RE.search(card_name)
    ):
        raise ValueError("card_name looks like a path, URL, SQL, ref, or backend action.")
    return card_name


def parse_environments(raw: str, catalog: dict) -> list[str]:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("environments must be a non-empty comma-separated list.")
    environments = [part.strip() for part in raw.split(",")]
    if any(not sid for sid in environments):
        raise ValueError("environments contains an empty environment id.")
    if len(environments) > MAX_ENVIRONMENTS:
        raise ValueError(f"environments may contain at most {MAX_ENVIRONMENTS} ids.")
    if len(set(environments)) != len(environments):
        raise ValueError("environments must not contain duplicate ids.")
    known = {str(entry.get("id") or "") for entry in catalog.get("sets") or []}
    unknown = [sid for sid in environments if sid not in known]
    if unknown:
        raise ValueError(f"Unknown environment id(s): {', '.join(unknown)}")
    return environments


def cards_in_corpus(sid: str) -> Iterable[dict]:
    for puzzle in refresh.read_corpus(refresh.CORPUS_DIR / f"{sid}.json.gz"):
        yield from puzzle.get("candidates") or []
        yield from puzzle.get("prior_picks") or []


def cards_in_shards(sid: str) -> Iterable[dict]:
    files = sorted((refresh.DATA_DIR / sid / "shards").glob("*.json"))
    if not files:
        raise ValueError(f"Hydrated replay shards are missing for {sid}.")
    for path in files:
        payload = json.loads(path.read_text(encoding="utf-8"))
        for replay in payload.get("replays") or []:
            for pick in replay.get("picks") or []:
                yield from pick.get("candidates") or []


def collect_checked_in_inventory(catalog: dict, card_name: str) -> tuple[dict[str, set[str]], dict[str, set[str]], dict[str, list[dict]]]:
    names_by_set: dict[str, set[str]] = {}
    names_by_id: dict[str, set[str]] = {}
    target_cards_by_set: dict[str, list[dict]] = {}
    for entry in catalog.get("sets") or []:
        sid = str(entry.get("id") or "")
        if not sid:
            continue
        names = names_by_set.setdefault(sid, set())
        targets = target_cards_by_set.setdefault(sid, [])
        path = refresh.CORPUS_DIR / f"{sid}.json.gz"
        if not path.exists():
            raise ValueError(f"Verified corpus file is missing for {sid}.")
        for card in cards_in_corpus(sid):
            name = str(card.get("name") or "")
            card_id = str(card.get("id") or "")
            if name:
                names.add(name)
            if name and card_id:
                names_by_id.setdefault(card_id, set()).add(name)
            if name == card_name:
                targets.append(card)
    return names_by_set, names_by_id, target_cards_by_set


def validate_served_name(
    card_name: str,
    environments: list[str],
    checked_in_targets: dict[str, list[dict]],
    shard_targets: dict[str, list[dict]],
) -> None:
    missing: list[str] = []
    for sid in environments:
        if not checked_in_targets.get(sid) or not shard_targets.get(sid):
            missing.append(sid)
    if missing:
        raise ValueError(
            f"card_name is not served exactly in both checked-in corpus and hydrated shards for: {', '.join(missing)}"
        )


def card_ids(cards: Iterable[dict]) -> set[str]:
    return {str(card.get("id") or "") for card in cards if str(card.get("id") or "")}


def fail_on_card_id_collisions(card_name: str, ids: set[str], names_by_id: dict[str, set[str]], card_images: dict) -> None:
    collisions: dict[str, list[str]] = {}
    for card_id in sorted(ids):
        names = set(names_by_id.get(card_id) or set())
        existing_name = str((card_images.get(card_id) or {}).get("name") or "")
        if existing_name:
            names.add(existing_name)
        if any(name != card_name for name in names):
            collisions[card_id] = sorted(names)
    if collisions:
        raise ValueError(f"card id/name collision for targeted card: {json.dumps(collisions, sort_keys=True)}")


def resolve_target(card_name: str, environments: list[str], diagnostics: Optional[dict] = None):
    return refresh.resolve_inventory(
        {sid: {card_name} for sid in environments},
        allow_named_fallback=False,
        diagnostics=diagnostics,
    )


def before_state(cards: list[dict], printing_index: dict[str, list[dict]]) -> dict:
    urls = sorted({str(card.get("image_url") or "") for card in cards if str(card.get("image_url") or "")})
    printings: list[dict] = []
    seen = set()
    for url in urls:
        for printing in printing_index.get(url) or []:
            detail = printing_details(printing)
            key = json.dumps(detail, sort_keys=True)
            if key not in seen:
                seen.add(key)
                printings.append(detail)
    return {
        "image_url": urls[0] if len(urls) == 1 else None,
        "image_urls": urls,
        "printing": printings[0] if len(printings) == 1 else None,
        "printings": printings,
    }


def build_report(
    *,
    card_name: str,
    raw_environments: str,
    environments: list[str],
    dry_run: bool,
    checked_in_names: dict[str, set[str]],
    checked_in_targets: dict[str, list[dict]],
    shard_targets: dict[str, list[dict]],
    selected_cards: dict[str, dict[str, dict]],
    records_by_set: dict[str, dict[str, dict]],
    selection_details: dict[str, dict],
    printing_index: dict[str, list[dict]],
    target_ids: set[str],
    planned: dict[str, dict],
    card_image_changes: int,
) -> dict:
    other = sorted(
        sid for sid, names in checked_in_names.items() if sid not in environments and card_name in names
    )
    environment_results = {}
    for sid in environments:
        metadata = records_by_set[sid][card_name]
        selected = selected_cards[sid][card_name]
        detail = selection_details.get(sid, {}).get(card_name) or {}
        environment_results[sid] = {
            "before": before_state(checked_in_targets[sid] + shard_targets[sid], printing_index),
            "after": {
                "image_url": metadata.get("image_url"),
                "printing": printing_details(selected),
            },
            "mapping": refresh.mapping_entry(card_name, metadata),
            "references": {
                "checked_in_corpus": len(checked_in_targets[sid]),
                "hydrated_shards": len(shard_targets[sid]),
                "card_ids": sorted(card_ids(checked_in_targets[sid] + shard_targets[sid])),
            },
            "planned_changes": planned[sid],
            "unavoidable_special_printing": detail if detail.get("special_unavoidable") else None,
        }
    return {
        "input": {"card_name": card_name, "environments": raw_environments},
        "environments": environments,
        "dry_run": dry_run,
        "environment_results": environment_results,
        "reference_counts": {
            "checked_in_corpus": sum(len(checked_in_targets[sid]) for sid in environments),
            "hydrated_shards": sum(len(shard_targets[sid]) for sid in environments),
            "card_image_ids": len(target_ids),
            "card_image_changes": card_image_changes,
        },
        "other_environments_serving_name": other,
    }


def write_report(report: dict) -> None:
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def run_repair(card_name: str, raw_environments: str, *, dry_run: bool = False) -> dict:
    card_name = validate_card_name(card_name)
    catalog = json.loads(refresh.CATALOG_PATH.read_text(encoding="utf-8"))
    environments = parse_environments(raw_environments, catalog)

    checked_in_names, names_by_id, checked_in_targets = collect_checked_in_inventory(catalog, card_name)
    shard_targets: dict[str, list[dict]] = {}
    for sid in environments:
        target_cards: list[dict] = []
        for card in cards_in_shards(sid):
            name = str(card.get("name") or "")
            card_id = str(card.get("id") or "")
            if name and card_id:
                names_by_id.setdefault(card_id, set()).add(name)
            if name == card_name:
                target_cards.append(card)
        shard_targets[sid] = target_cards
    validate_served_name(card_name, environments, checked_in_targets, shard_targets)

    # card-images.json is a global card-id source of truth, so patch every id
    # known to map to this exact name, not only ids observed in selected environments.
    target_ids = {card_id for card_id, names in names_by_id.items() if card_name in names}
    card_images = json.loads(refresh.CARD_IMAGES_PATH.read_text(encoding="utf-8"))
    fail_on_card_id_collisions(card_name, target_ids, names_by_id, card_images)

    diagnostics: dict = {}
    records_by_set, global_records, selection_details = resolve_target(card_name, environments, diagnostics)
    unresolved = [sid for sid in environments if card_name not in records_by_set.get(sid, {})]
    if unresolved:
        raise ValueError(
            "Targeted repair could not resolve the exact served name from Scryfall bulk data for: "
            + ", ".join(unresolved)
            + ". Use the full refresh for identities requiring named fallback."
        )
    avoidable_special = {
        sid: selection_details.get(sid, {}).get(card_name)
        for sid in environments
        if (selection_details.get(sid, {}).get(card_name) or {}).get("special_flags")
        and not (selection_details.get(sid, {}).get(card_name) or {}).get("special_unavoidable")
    }
    if avoidable_special:
        raise ValueError(
            "Targeted repair selected an avoidable special printing: "
            + json.dumps(avoidable_special, sort_keys=True)
        )
    global_metadata = global_records.get(card_name)
    if not global_metadata or not global_metadata.get("image_url"):
        raise ValueError("Targeted repair did not resolve global card-image metadata from bulk data.")

    # Simulate every display-only patch before writing any source file.
    planned: dict[str, dict] = {}
    expected_shas: dict[str, str] = {}
    for sid in environments:
        records = {card_name: records_by_set[sid][card_name]}
        shard_files, shard_changes = refresh.patch_shards(sid, records, names_by_id, dry_run=True)
        puzzles, corpus_changes, sha = refresh.patch_verified_corpus(sid, records, names_by_id, dry_run=True)
        planned[sid] = {
            "shards": shard_files,
            "shard_card_changes": shard_changes,
            "puzzles": puzzles,
            "corpus_card_changes": corpus_changes,
            "corpus_sha256": sha,
        }
        expected_shas[sid] = sha

    card_image_changes = 0
    updated_card_images = dict(card_images)
    for card_id in sorted(target_ids):
        if updated_card_images.get(card_id) != global_metadata:
            card_image_changes += 1
        updated_card_images[card_id] = global_metadata

    selected_cards = diagnostics.get("selected_by_set") or {}
    printing_index = ((diagnostics.get("printings_by_name_image") or {}).get(card_name) or {})
    report = build_report(
        card_name=card_name,
        raw_environments=raw_environments,
        environments=environments,
        dry_run=dry_run,
        checked_in_names=checked_in_names,
        checked_in_targets=checked_in_targets,
        shard_targets=shard_targets,
        selected_cards=selected_cards,
        records_by_set=records_by_set,
        selection_details=selection_details,
        printing_index=printing_index,
        target_ids=target_ids,
        planned=planned,
        card_image_changes=card_image_changes,
    )

    if not dry_run:
        for sid in environments:
            records = {card_name: records_by_set[sid][card_name]}
            refresh.patch_shards(sid, records, names_by_id)
            _, _, sha = refresh.patch_verified_corpus(sid, records, names_by_id)
            if sha != expected_shas[sid]:
                raise ValueError(f"{sid}: targeted corpus hash changed between simulation and write.")
            for entry in catalog.get("sets") or []:
                if entry.get("id") == sid:
                    entry["sha256"] = sha
                    break
        refresh.CARD_IMAGES_PATH.write_text(
            json.dumps(updated_card_images, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        refresh.CATALOG_PATH.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")

    write_report(report)
    print(json.dumps({
        "card_name": card_name,
        "environments": environments,
        "dry_run": dry_run,
        "card_image_changes": card_image_changes,
    }, sort_keys=True))
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    card_name = os.environ.get("CARD_NAME", "")
    environments = os.environ.get("REPAIR_ENVIRONMENTS", "")
    try:
        run_repair(card_name, environments, dry_run=args.dry_run)
    except Exception as exc:
        write_report({
            "input": {"card_name": card_name, "environments": environments},
            "dry_run": args.dry_run,
            "error": str(exc),
        })
        raise
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
