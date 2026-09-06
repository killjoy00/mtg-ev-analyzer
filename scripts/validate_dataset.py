#!/usr/bin/env python3
"""Validate generated replay shards before they are published."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Optional, Sequence


def validate(manifest_path: Path, minimum_replays: int = 1) -> dict:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    errors = []
    if manifest.get("is_fixture"):
        errors.append("production manifest is marked as a fixture")
    if not manifest.get("model", {}).get("pool_conditioned"):
        errors.append("model is not marked pool-conditioned")
    shards = manifest.get("shards") or []
    expected = int(manifest.get("replay_count") or 0)
    if expected < minimum_replays:
        errors.append(f"only {expected} replays; expected at least {minimum_replays}")

    seen_drafts = set()
    replay_count = 0
    candidate_count = 0
    image_count = 0
    pick_count = 0
    repo_root = manifest_path.parent.parent.parent

    for shard_meta in shards:
        rel = str(shard_meta.get("path") or "").removeprefix("./")
        shard_path = repo_root / rel
        if not shard_path.exists():
            errors.append(f"missing shard {rel}")
            continue
        shard = json.loads(shard_path.read_text(encoding="utf-8"))
        replays = shard.get("replays") or []
        if len(replays) != int(shard_meta.get("replay_count") or -1):
            errors.append(f"shard count mismatch for {rel}")
        for replay in replays:
            replay_count += 1
            draft_id = replay.get("draft_id")
            if not draft_id or draft_id in seen_drafts:
                errors.append(f"duplicate or missing draft_id: {draft_id}")
            seen_drafts.add(draft_id)
            picks = replay.get("picks") or []
            if not picks:
                errors.append(f"draft {draft_id} has no picks")
            for pick in picks:
                pick_count += 1
                candidates = pick.get("candidates") or []
                ids = [card.get("id") for card in candidates]
                if not candidates or len(ids) != len(set(ids)):
                    errors.append(f"invalid candidate ids in {draft_id} P{pick.get('pack_number')}P{pick.get('pick_number')}")
                    continue
                if pick.get("historical_pick_id") not in ids:
                    errors.append(f"historical pick missing from pack in {draft_id}")
                if pick.get("consensus_pick_id") not in ids:
                    errors.append(f"consensus pick missing from pack in {draft_id}")
                total = sum(float(card.get("model_probability") or 0) for card in candidates)
                if abs(total - 1.0) > 0.002:
                    errors.append(f"probabilities sum to {total:.6f} in {draft_id}")
                for card in candidates:
                    probability = float(card.get("model_probability") or 0)
                    if not 0 <= probability <= 1:
                        errors.append(f"invalid probability {probability} in {draft_id}")
                    candidate_count += 1
                    image_count += int(bool(card.get("image_url")))

    if replay_count != expected:
        errors.append(f"manifest replay_count={expected}, actual={replay_count}")
    if errors:
        raise ValueError("Dataset validation failed:\n- " + "\n- ".join(errors[:30]))

    return {
        "replays": replay_count,
        "picks": pick_count,
        "candidates": candidate_count,
        "image_coverage": (image_count / candidate_count) if candidate_count else 0,
    }


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest")
    parser.add_argument("--minimum-replays", type=int, default=1)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    result = validate(Path(args.manifest), args.minimum_replays)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
