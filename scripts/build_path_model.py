#!/usr/bin/env python3
"""Build a compact counterfactual pool-conditioning model for Pack One.

The replay shards already contain leakage-safe out-of-fold support for the
historical drafter's actual pool. This artifact intentionally does *not*
replace those probabilities. It supplies a context delta that lets the browser
and score worker ask: how would strong-player support move if the player had
made different earlier picks?

To keep that delta independent of the scored replay seats, every replay draft
that also belongs to the selected strong-player training cohort is held out of
this model's counts.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Optional, Sequence

from build_replays import (
    CountStore,
    candidate_columns,
    open_text,
    parse_example,
    pool_columns,
    scan_draft_skill,
    select_strong_drafts,
)

MODEL_VERSION = "strong-player-counterfactual-path-v3"
PAIR_MIN_SEEN = 8
PAIR_PRIOR_STRENGTH = 24.0
CONTEXT_STRENGTH = 0.75
COMMITMENT_PICKS = 8.0
MAX_LOG_ADJUSTMENT = 0.90
SCHEMA_VERSION = 1


def replay_draft_ids(output_dir: Path) -> set[str]:
    manifest_path = output_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    ids: set[str] = set()
    for shard in manifest.get("shards", []):
        relative = str(shard.get("path", ""))
        filename = Path(relative).name
        payload = json.loads((output_dir / "shards" / filename).read_text(encoding="utf-8"))
        for replay in payload.get("replays", []):
            draft_id = str(replay.get("draft_id", "")).strip()
            if draft_id:
                ids.add(draft_id)
    return ids


def collect_counts(input_path: Path, strong_ids: set[str], excluded_ids: set[str], fieldnames: Sequence[str]):
    pack_cols = candidate_columns(fieldnames)
    pool_cols = pool_columns(fieldnames)
    counts = CountStore.empty()
    min_pack = 10**9
    min_pick = 10**9
    examples = 0
    drafts: set[str] = set()

    with open_text(input_path) as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            draft_id = (row.get("draft_id") or "").strip()
            if draft_id not in strong_ids or draft_id in excluded_ids:
                continue
            example = parse_example(row, pack_cols, pool_cols)
            if not example:
                continue
            counts.observe(example)
            examples += 1
            drafts.add(draft_id)
            min_pack = min(min_pack, example.raw_pack_number)
            min_pick = min(min_pick, example.raw_pick_number)

    if not examples:
        raise ValueError("No training examples remained after excluding replay drafts.")
    return counts, min_pack, min_pick, examples, len(drafts)


def render_model(expansion: str, source_date: str, counts: CountStore, min_pack: int, min_pick: int,
                 examples: int, training_drafts: int, excluded_count: int, cutoff: float) -> dict:
    names = sorted(counts.global_seen.keys())
    index = {name: idx for idx, name in enumerate(names)}
    pick_offset = 1 if min_pick == 0 else 0

    stats = []
    for card in names:
        exact = []
        for (name, raw_pack, raw_pick), seen in counts.exact_seen.items():
            if name != card or raw_pack != min_pack or seen <= 0:
                continue
            exact.append([
                int(raw_pick + pick_offset),
                int(seen),
                int(counts.exact_picked[(name, raw_pack, raw_pick)]),
            ])
        exact.sort(key=lambda row: row[0])
        stats.append([
            int(counts.global_seen[card]),
            int(counts.global_picked[card]),
            int(counts.pack_seen[(card, min_pack)]),
            int(counts.pack_picked[(card, min_pack)]),
            exact,
        ])

    pairs = []
    for (candidate, pool_card), seen in counts.pair_seen.items():
        if seen < PAIR_MIN_SEEN or candidate not in index or pool_card not in index:
            continue
        pairs.append([
            index[candidate],
            index[pool_card],
            int(seen),
            int(counts.pair_picked[(candidate, pool_card)]),
        ])
    pairs.sort(key=lambda row: (row[0], row[1]))

    return {
        "schema_version": SCHEMA_VERSION,
        "model_version": MODEL_VERSION,
        "set_id": expansion.lower(),
        "source": {
            "provider": "17Lands",
            "dataset_kind": "draft_data",
            "data_date": source_date,
        },
        "training": {
            "drafts": training_drafts,
            "picks": examples,
            "excluded_replay_drafts": excluded_count,
            "win_rate_cutoff": round(cutoff, 6),
        },
        "constants": {
            "pair_min_seen": PAIR_MIN_SEEN,
            "pair_prior_strength": PAIR_PRIOR_STRENGTH,
            "context_strength": CONTEXT_STRENGTH,
            "commitment_picks": COMMITMENT_PICKS,
            "max_log_adjustment": MAX_LOG_ADJUSTMENT,
        },
        "cards": names,
        "stats": stats,
        "pairs": pairs,
    }


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="17Lands draft_data CSV or CSV.gz")
    parser.add_argument("--output-dir", required=True, help="Existing data/<set> directory containing replay shards")
    parser.add_argument("--expansion", required=True)
    parser.add_argument("--source-date", required=True)
    parser.add_argument("--minimum-games", type=int, default=100)
    parser.add_argument("--top-fraction", type=float, default=0.15)
    parser.add_argument("--max-training-drafts", type=int, default=8000)
    parser.add_argument("--max-bytes", type=int, default=4_000_000)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    input_path = Path(args.input)
    output_dir = Path(args.output_dir)
    replay_ids = replay_draft_ids(output_dir)

    skills, fieldnames = scan_draft_skill(input_path)
    strong_ids, cutoff, _ = select_strong_drafts(
        skills,
        args.minimum_games,
        args.top_fraction,
        args.max_training_drafts,
    )
    strong_ids = set(strong_ids)
    held_out = replay_ids & strong_ids
    counts, min_pack, min_pick, examples, training_drafts = collect_counts(
        input_path,
        strong_ids,
        held_out,
        fieldnames,
    )
    model = render_model(
        args.expansion,
        args.source_date,
        counts,
        min_pack,
        min_pick,
        examples,
        training_drafts,
        len(held_out),
        cutoff,
    )
    encoded = json.dumps(model, separators=(",", ":")) + "\n"
    size = len(encoded.encode("utf-8"))
    if size > args.max_bytes:
        raise ValueError(f"Path model is {size:,} bytes, above the {args.max_bytes:,}-byte guardrail.")
    destination = output_dir / "path-model.json"
    destination.write_text(encoded, encoding="utf-8")
    print(json.dumps({
        "model": MODEL_VERSION,
        "set": args.expansion.lower(),
        "training_drafts": training_drafts,
        "training_picks": examples,
        "excluded_replay_drafts": len(held_out),
        "cards": len(model["cards"]),
        "pairs": len(model["pairs"]),
        "bytes": size,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
