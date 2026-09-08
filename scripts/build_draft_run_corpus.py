#!/usr/bin/env python3
"""Build Draft Run puzzle rows from 17Lands Premier Draft data.

Puzzle sources are trophy drafts by the experienced high-win-rate cohort.
Consensus is trained on the broader elite cohort and each source draft is
scored out-of-fold by draft_id. Only first-pack historical states are emitted.
Raw 17Lands archives remain build inputs and are never shipped to the client.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Sequence, Set, Tuple

from scripts.build_replays import (
    CountStore,
    OutOfFoldModel,
    candidate_columns,
    load_card_metadata,
    open_text,
    parse_example,
    scan_draft_skill,
    select_strong_drafts,
    stable_fold,
    stable_score,
    pool_columns,
    render_replay,
)

SCHEMA_VERSION = 1
CORPUS_VERSION = "elite-trophy-first-pack-v1"


def parse_int(value: object) -> int | None:
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return None


def stable_hash(value: str, length: int = 24) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:length]


def first_pack_number(path: Path) -> int:
    minimum = None
    with open_text(path) as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            value = parse_int(row.get("pack_number"))
            if value is None:
                continue
            minimum = value if minimum is None else min(minimum, value)
            if minimum == 0:
                break
    if minimum is None:
        raise ValueError("No parseable pack_number values found.")
    return minimum


def scan_trophy_ids(path: Path, strong_ids: Set[str]) -> Tuple[List[str], Dict[str, dict]]:
    trophies: Dict[str, dict] = {}
    with open_text(path) as handle:
        reader = csv.DictReader(handle)
        fieldnames = set(reader.fieldnames or [])
        if "event_match_wins" not in fieldnames:
            raise ValueError("Draft Run requires event_match_wins in the 17Lands draft data.")
        for row in reader:
            draft_id = (row.get("draft_id") or "").strip()
            if not draft_id or draft_id not in strong_ids or draft_id in trophies:
                continue
            wins = parse_int(row.get("event_match_wins"))
            if wins != 7:
                continue
            trophies[draft_id] = {
                "event_match_wins": wins,
                "event_match_losses": parse_int(row.get("event_match_losses")),
                "rank": (row.get("rank") or "").strip() or None,
                "draft_time": (row.get("draft_time") or "").strip() or None,
            }
    ordered = sorted(trophies, key=lambda draft_id: stable_score(f"draft-run-trophy:{draft_id}"))
    return ordered, trophies


def train_first_pack(
    path: Path,
    strong_ids: Set[str],
    output_ids: Set[str],
    fieldnames: Sequence[str],
    folds: int,
    raw_first_pack: int,
):
    pack_cols = candidate_columns(fieldnames)
    pool_cols = pool_columns(fieldnames)
    all_counts = CountStore.empty()
    fold_counts = [CountStore.empty() for _ in range(folds)]
    outputs = defaultdict(list)
    min_pick = 10**9
    parsed = 0

    with open_text(path) as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            draft_id = (row.get("draft_id") or "").strip()
            if draft_id not in strong_ids:
                continue
            if parse_int(row.get("pack_number")) != raw_first_pack:
                continue
            example = parse_example(row, pack_cols, pool_cols)
            if not example:
                continue
            parsed += 1
            min_pick = min(min_pick, example.raw_pick_number)
            all_counts.observe(example)
            fold_counts[stable_fold(example.draft_id, folds)].observe(example)
            if draft_id in output_ids:
                outputs[draft_id].append(example)

    return all_counts, fold_counts, dict(outputs), min_pick, parsed


def support_entropy(candidates: Sequence[Mapping[str, object]]) -> float:
    values = [max(0.0, float(card.get("model_probability") or 0)) for card in candidates]
    if len(values) <= 1:
        return 0.0
    total = sum(values)
    if total <= 0:
        return 1.0
    entropy = 0.0
    for value in values:
        if value <= 0:
            continue
        p = value / total
        entropy -= p * math.log(p)
    return max(0.0, min(1.0, entropy / math.log(len(values))))


def puzzle_rows(
    expansion: str,
    draft_id: str,
    rendered: Mapping[str, object],
    skill,
    trophy_meta: Mapping[str, object],
) -> Iterable[dict]:
    picks = sorted(rendered.get("picks") or [], key=lambda pick: int(pick["pick_number"]))
    prior: List[dict] = []
    source_hash = stable_hash(f"pack-one|{expansion}|{draft_id}", 32)

    for pick in picks:
        candidates = sorted(
            pick.get("candidates") or [],
            key=lambda card: (-float(card.get("model_probability") or 0), str(card.get("name") or "")),
        )
        if not candidates:
            continue
        historical_id = pick.get("historical_pick_id")
        historical_card = next((card for card in candidates if card.get("id") == historical_id), None)
        if not historical_card:
            continue
        leader = candidates[0]
        second = candidates[1] if len(candidates) > 1 else None
        leader_support = float(leader.get("model_probability") or 0)
        second_support = float(second.get("model_probability") or 0) if second else 0.0
        pick_number = int(pick["pick_number"])
        puzzle_id = stable_hash(f"{expansion}|{draft_id}|{pick_number}", 32)

        yield {
            "schema_version": SCHEMA_VERSION,
            "corpus_version": CORPUS_VERSION,
            "puzzle_id": puzzle_id,
            "set_id": expansion.lower(),
            "source_draft_hash": source_hash,
            "pick_number": pick_number,
            "prior_picks": list(prior),
            "historical_pick_id": historical_id,
            "historical_pick_name": historical_card.get("name"),
            "candidates": candidates,
            "candidate_count": len(candidates),
            "consensus_leader_id": leader.get("id"),
            "consensus_leader_support": round(leader_support, 6),
            "consensus_second_id": second.get("id") if second else None,
            "consensus_second_support": round(second_support, 6),
            "consensus_top_gap": round(max(0.0, leader_support - second_support), 6),
            "support_entropy": round(support_entropy(candidates), 6),
            "prior_pool_size": len(prior),
            "player_win_rate_bucket": round(float(skill.rate), 4),
            "player_games_lower_bound": int(skill.games_lower_bound),
            "event_match_wins": int(trophy_meta.get("event_match_wins") or 7),
            "event_match_losses": trophy_meta.get("event_match_losses"),
            "source_rank": trophy_meta.get("rank"),
            "source_draft_time": trophy_meta.get("draft_time"),
        }

        prior_card = {key: value for key, value in historical_card.items() if key in {"id", "name", "image_url", "mana_cost", "rarity", "type_line"}}
        prior.append(prior_card)


def write_jsonl(path: Path, rows: Sequence[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    opener = gzip.open if str(path).endswith(".gz") else open
    kwargs = {"mode": "wt", "encoding": "utf-8", "newline": ""}
    with opener(path, **kwargs) as handle:
        for row in rows:
            handle.write(json.dumps(row, separators=(",", ":"), ensure_ascii=False))
            handle.write("\n")


def build(args: argparse.Namespace) -> dict:
    input_path = Path(args.input)
    skills, fieldnames = scan_draft_skill(input_path)
    strong_ids, cutoff, experienced_count = select_strong_drafts(
        skills,
        args.minimum_games,
        args.top_fraction,
        args.max_training_drafts,
    )
    if len(strong_ids) < 2:
        raise ValueError("At least two elite drafts are required for held-out consensus grading.")

    strong_set = set(strong_ids)
    trophy_ids, trophy_meta = scan_trophy_ids(input_path, strong_set)
    if args.max_trophy_drafts and len(trophy_ids) > args.max_trophy_drafts:
        trophy_ids = trophy_ids[: args.max_trophy_drafts]
    if not trophy_ids:
        raise ValueError("No elite trophy drafts were found for this set.")

    folds = min(args.folds, len(strong_ids))
    raw_first_pack = first_pack_number(input_path)
    all_counts, fold_counts, collected, min_pick, parsed_examples = train_first_pack(
        input_path,
        strong_set,
        set(trophy_ids),
        fieldnames,
        folds,
        raw_first_pack,
    )
    pick_offset = 1 if min_pick == 0 else 0
    pack_offset = 1 if raw_first_pack == 0 else 0
    metadata = load_card_metadata(Path(args.card_metadata) if args.card_metadata else None)

    rows: List[dict] = []
    complete_trophies = 0
    for draft_id in trophy_ids:
        picks = collected.get(draft_id) or []
        if len(picks) < args.minimum_first_pack_picks:
            continue
        model = OutOfFoldModel(all_counts, fold_counts[stable_fold(draft_id, folds)])
        rendered = render_replay(draft_id, picks, model, pack_offset, pick_offset, metadata)
        emitted = list(puzzle_rows(args.expansion.upper(), draft_id, rendered, skills[draft_id], trophy_meta[draft_id]))
        if len(emitted) < args.minimum_first_pack_picks:
            continue
        rows.extend(emitted)
        complete_trophies += 1

    if not rows:
        raise ValueError("No trophy drafts produced a complete first-pack puzzle sequence.")

    write_jsonl(Path(args.output), rows)
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "corpus_version": CORPUS_VERSION,
        "set_id": args.expansion.lower(),
        "format": "PremierDraft",
        "source_date": args.source_date,
        "elite": {
            "minimum_games": args.minimum_games,
            "top_fraction": args.top_fraction,
            "win_rate_cutoff": round(cutoff, 4),
            "experienced_drafts": experienced_count,
            "training_drafts": len(strong_ids),
        },
        "trophy_drafts": complete_trophies,
        "puzzles": len(rows),
        "first_pack_number_raw": raw_first_pack,
        "training_first_pack_examples": parsed_examples,
    }
    Path(args.manifest).parent.mkdir(parents=True, exist_ok=True)
    Path(args.manifest).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser()
    result.add_argument("--input", required=True)
    result.add_argument("--output", required=True)
    result.add_argument("--manifest", required=True)
    result.add_argument("--expansion", required=True)
    result.add_argument("--source-date", required=True)
    result.add_argument("--minimum-games", type=int, default=100)
    result.add_argument("--top-fraction", type=float, default=0.15)
    result.add_argument("--max-training-drafts", type=int, default=0)
    result.add_argument("--max-trophy-drafts", type=int, default=0)
    result.add_argument("--minimum-first-pack-picks", type=int, default=10)
    result.add_argument("--folds", type=int, default=5)
    result.add_argument("--card-metadata")
    return result


if __name__ == "__main__":
    args = parser().parse_args()
    if args.max_training_drafts <= 0:
        args.max_training_drafts = None
    if args.max_trophy_drafts <= 0:
        args.max_trophy_drafts = None
    print(json.dumps(build(args), indent=2))
