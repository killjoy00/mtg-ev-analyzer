#!/usr/bin/env python3
"""Build static replay-study JSON from a 17Lands public draft-data CSV(.gz).

The first model is deliberately simple and inspectable: among the selected
high-win-rate cohort, it estimates each card's pick tendency by pack/pick
position and normalizes those tendencies across the cards in the current pack.
Predictions are produced out-of-fold at the *draft* level, so a historical
draft never contributes to the consensus probabilities used to grade itself.

This is a baseline, not the final pool-conditioned model. The output schema is
stable enough for the browser UI to consume future model versions unchanged.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Mapping, MutableMapping, Optional, Sequence, Tuple

SCHEMA_VERSION = 1
MODEL_VERSION = "strong-player-card-position-v1"
CARD_PREFIX = "pack_card_"
POOL_PREFIX = "pool_"


def open_text(path: Path):
    if str(path).endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8", newline="")
    return path.open("r", encoding="utf-8", newline="")


def stable_fold(value: str, folds: int) -> int:
    digest = hashlib.sha256(value.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") % folds


def stable_score(value: str) -> int:
    digest = hashlib.sha256(value.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


def slugify(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "card"


def _numbers(value: object) -> List[float]:
    if value is None:
        return []
    if isinstance(value, (int, float)):
        return [float(value)]
    text = str(value).strip().replace(",", "")
    if not text:
        return []
    return [float(match) for match in re.findall(r"-?\d+(?:\.\d+)?", text)]


def parse_rate_bucket(value: object) -> Optional[float]:
    nums = _numbers(value)
    if not nums:
        return None
    result = sum(nums[:2]) / min(len(nums), 2)
    if result > 1.0:
        result /= 100.0
    if not 0 <= result <= 1:
        return None
    return result


def parse_games_lower_bound(value: object) -> Optional[int]:
    nums = _numbers(value)
    if not nums:
        return None
    return int(max(0, nums[0]))


def truthy_count(value: object) -> int:
    if value is None:
        return 0
    text = str(value).strip()
    if not text:
        return 0
    lowered = text.lower()
    if lowered in {"false", "f", "no", "n", "none", "nan"}:
        return 0
    if lowered in {"true", "t", "yes", "y"}:
        return 1
    try:
        number = float(text)
    except ValueError:
        return 1
    if not math.isfinite(number) or number <= 0:
        return 0
    return max(1, int(round(number)))


def quantile_cutoff(values: Sequence[float], top_fraction: float) -> float:
    if not values:
        raise ValueError("No experienced drafts had a parseable win-rate bucket.")
    if not 0 < top_fraction <= 1:
        raise ValueError("top_fraction must be in (0, 1].")
    ordered = sorted(values)
    start = max(0, math.floor((1 - top_fraction) * len(ordered)))
    start = min(start, len(ordered) - 1)
    return ordered[start]


def candidate_columns(fieldnames: Sequence[str]) -> List[str]:
    return [name for name in fieldnames if name.startswith(CARD_PREFIX)]


def pool_columns(fieldnames: Sequence[str]) -> List[str]:
    return [name for name in fieldnames if name.startswith(POOL_PREFIX)]


def column_card_name(column: str, prefix: str) -> str:
    return column[len(prefix):]


@dataclass(frozen=True)
class DraftSkill:
    rate: float
    games_lower_bound: int


@dataclass
class PickExample:
    draft_id: str
    raw_pack_number: int
    raw_pick_number: int
    historical_pick: str
    candidates: List[str]
    pool: Dict[str, int]


@dataclass
class ModelCounts:
    exact_seen: Counter
    exact_picked: Counter
    pack_seen: Counter
    pack_picked: Counter
    global_seen: Counter
    global_picked: Counter

    @classmethod
    def empty(cls) -> "ModelCounts":
        return cls(Counter(), Counter(), Counter(), Counter(), Counter(), Counter())

    def observe(self, example: PickExample) -> None:
        for card in example.candidates:
            exact_key = (card, example.raw_pack_number, example.raw_pick_number)
            pack_key = (card, example.raw_pack_number)
            self.exact_seen[exact_key] += 1
            self.pack_seen[pack_key] += 1
            self.global_seen[card] += 1
        picked = example.historical_pick
        self.exact_picked[(picked, example.raw_pack_number, example.raw_pick_number)] += 1
        self.pack_picked[(picked, example.raw_pack_number)] += 1
        self.global_picked[picked] += 1

    def card_tendency(self, card: str, pack_number: int, pick_number: int) -> float:
        exact_key = (card, pack_number, pick_number)
        pack_key = (card, pack_number)
        exact_seen = self.exact_seen[exact_key]
        if exact_seen >= 20:
            return (self.exact_picked[exact_key] + 1.5) / (exact_seen + 7.5)
        pack_seen = self.pack_seen[pack_key]
        if pack_seen >= 30:
            return (self.pack_picked[pack_key] + 2.0) / (pack_seen + 10.0)
        global_seen = self.global_seen[card]
        if global_seen:
            return (self.global_picked[card] + 2.0) / (global_seen + 12.0)
        return 0.01


def scan_draft_skill(path: Path) -> Tuple[Dict[str, DraftSkill], List[str]]:
    skills: Dict[str, DraftSkill] = {}
    with open_text(path) as handle:
        reader = csv.DictReader(handle)
        fieldnames = reader.fieldnames or []
        required = {"draft_id", "pick"}
        missing = required - set(fieldnames)
        if missing:
            raise ValueError(f"Missing required columns: {', '.join(sorted(missing))}")
        if "user_game_win_rate_bucket" not in fieldnames:
            raise ValueError("Expected user_game_win_rate_bucket in 17Lands draft data.")
        if "user_n_games_bucket" not in fieldnames:
            raise ValueError("Expected user_n_games_bucket in 17Lands draft data.")

        for row in reader:
            draft_id = (row.get("draft_id") or "").strip()
            if not draft_id or draft_id in skills:
                continue
            rate = parse_rate_bucket(row.get("user_game_win_rate_bucket"))
            games = parse_games_lower_bound(row.get("user_n_games_bucket"))
            if rate is None or games is None:
                continue
            skills[draft_id] = DraftSkill(rate=rate, games_lower_bound=games)
    return skills, fieldnames


def select_strong_drafts(skills: Mapping[str, DraftSkill], minimum_games: int, top_fraction: float, max_training_drafts: Optional[int]) -> Tuple[List[str], float]:
    experienced = {draft_id: skill for draft_id, skill in skills.items() if skill.games_lower_bound >= minimum_games}
    cutoff = quantile_cutoff([skill.rate for skill in experienced.values()], top_fraction)
    eligible = [draft_id for draft_id, skill in experienced.items() if skill.rate >= cutoff]
    eligible.sort(key=stable_score)
    if max_training_drafts and len(eligible) > max_training_drafts:
        eligible = eligible[:max_training_drafts]
    return eligible, cutoff


def read_examples(path: Path, eligible_ids: set[str], fieldnames: Sequence[str]) -> List[PickExample]:
    pack_cols = candidate_columns(fieldnames)
    pool_cols = pool_columns(fieldnames)
    if not pack_cols:
        raise ValueError("No pack_card_* columns found in input.")
    examples: List[PickExample] = []

    with open_text(path) as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            draft_id = (row.get("draft_id") or "").strip()
            if draft_id not in eligible_ids:
                continue
            try:
                raw_pack = int(float(row.get("pack_number", 0)))
                raw_pick = int(float(row.get("pick_number", 0)))
            except (TypeError, ValueError):
                continue
            historical = (row.get("pick") or "").strip()
            if not historical:
                continue
            candidates = [column_card_name(col, CARD_PREFIX) for col in pack_cols if truthy_count(row.get(col)) > 0]
            if historical not in candidates:
                continue
            pool = {column_card_name(col, POOL_PREFIX): count for col in pool_cols if (count := truthy_count(row.get(col))) > 0}
            examples.append(PickExample(draft_id, raw_pack, raw_pick, historical, candidates, pool))
    return examples


def build_fold_models(examples: Sequence[PickExample], folds: int) -> List[ModelCounts]:
    models = [ModelCounts.empty() for _ in range(folds)]
    for example in examples:
        held_out = stable_fold(example.draft_id, folds)
        for fold, model in enumerate(models):
            if fold != held_out:
                model.observe(example)
    return models


def normalize_probabilities(raw: Mapping[str, float]) -> Dict[str, float]:
    total = sum(max(0.0, value) for value in raw.values())
    if total <= 0:
        uniform = 1.0 / max(1, len(raw))
        return {card: uniform for card in raw}
    return {card: max(0.0, value) / total for card, value in raw.items()}


def one_based_positions(examples: Sequence[PickExample]) -> Tuple[int, int]:
    min_pack = min((example.raw_pack_number for example in examples), default=1)
    min_pick = min((example.raw_pick_number for example in examples), default=1)
    return (1 if min_pack == 0 else 0, 1 if min_pick == 0 else 0)


def load_card_metadata(path: Optional[Path]) -> Dict[str, dict]:
    if not path:
        return {}
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if isinstance(data, list):
        return {str(item["name"]): item for item in data if isinstance(item, dict) and item.get("name")}
    if isinstance(data, dict):
        return data
    raise ValueError("Card metadata JSON must be a mapping or list of card records.")


def render_output(examples, fold_models, expansion, fmt, source_date, minimum_games, win_rate_cutoff, top_fraction, output_draft_ids, card_metadata):
    by_draft: MutableMapping[str, List[PickExample]] = defaultdict(list)
    for example in examples:
        if example.draft_id in output_draft_ids:
            by_draft[example.draft_id].append(example)

    pack_offset, pick_offset = one_based_positions(examples)
    replays = []
    for draft_id in output_draft_ids:
        picks = sorted(by_draft.get(draft_id, []), key=lambda item: (item.raw_pack_number, item.raw_pick_number))
        if not picks:
            continue
        model = fold_models[stable_fold(draft_id, len(fold_models))]
        rendered_picks = []
        for pick in picks:
            raw_scores = {card: model.card_tendency(card, pick.raw_pack_number, pick.raw_pick_number) for card in pick.candidates}
            probabilities = normalize_probabilities(raw_scores)
            ranked = sorted(probabilities, key=lambda card: (-probabilities[card], card))
            candidates = []
            used_ids = Counter()
            for card in pick.candidates:
                base_id = slugify(card)
                used_ids[base_id] += 1
                card_id = base_id if used_ids[base_id] == 1 else f"{base_id}-{used_ids[base_id]}"
                metadata = card_metadata.get(card, {})
                candidate = {"id": card_id, "name": card, "model_probability": round(probabilities[card], 6)}
                if metadata.get("image_url"):
                    candidate["image_url"] = metadata["image_url"]
                candidates.append(candidate)
            ids_by_name = {candidate["name"]: candidate["id"] for candidate in candidates}
            rendered_picks.append({
                "pack_number": pick.raw_pack_number + pack_offset,
                "pick_number": pick.raw_pick_number + pick_offset,
                "historical_pick_id": ids_by_name[pick.historical_pick],
                "consensus_pick_id": ids_by_name[ranked[0]],
                "pool": pick.pool,
                "candidates": candidates,
            })
        replays.append({"draft_id": draft_id, "picks": rendered_picks})

    return {
        "schema_version": SCHEMA_VERSION,
        "set_id": expansion.lower(),
        "name": expansion,
        "format": fmt,
        "is_fixture": False,
        "source": {"provider": "17Lands", "dataset_kind": "draft_data", "data_date": source_date, "license": "CC BY 4.0 unless otherwise noted by 17Lands"},
        "cohort": {
            "definition": f"experienced drafts in top {top_fraction:.0%} of parsed 17Lands user win-rate buckets",
            "minimum_games_bucket_lower_bound": minimum_games,
            "win_rate_cutoff": round(win_rate_cutoff, 6),
            "training_drafts": len({example.draft_id for example in examples}),
        },
        "model": {
            "model_version": MODEL_VERSION,
            "holdout": f"{len(fold_models)}-fold by draft_id",
            "probabilities_are_calibrated": False,
            "description": "Smoothed strong-player card pick tendency by pack/pick position, normalized across each pack.",
        },
        "replays": replays,
    }


def build(args: argparse.Namespace) -> dict:
    input_path = Path(args.input)
    skills, fieldnames = scan_draft_skill(input_path)
    strong_ids, cutoff = select_strong_drafts(skills, args.minimum_games, args.top_fraction, args.max_training_drafts)
    if not strong_ids:
        raise ValueError("No strong-player drafts survived the cohort filter.")
    examples = read_examples(input_path, set(strong_ids), fieldnames)
    if not examples:
        raise ValueError("No replayable picks survived parsing.")
    folds = min(args.folds, len({example.draft_id for example in examples}))
    if folds < 2:
        raise ValueError("At least two eligible drafts are required for holdout grading.")
    models = build_fold_models(examples, folds)
    replayable_ids = sorted({example.draft_id for example in examples}, key=stable_score)
    if args.max_output_drafts:
        replayable_ids = replayable_ids[: args.max_output_drafts]
    metadata = load_card_metadata(Path(args.card_metadata) if args.card_metadata else None)
    return render_output(examples, models, args.expansion, args.format, args.source_date, args.minimum_games, cutoff, args.top_fraction, replayable_ids, metadata)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="17Lands draft_data CSV or CSV.gz")
    parser.add_argument("--output", required=True, help="Output replay JSON")
    parser.add_argument("--expansion", required=True, help="Set code, e.g. MSH")
    parser.add_argument("--format", default="PremierDraft")
    parser.add_argument("--source-date", default=None)
    parser.add_argument("--minimum-games", type=int, default=100)
    parser.add_argument("--top-fraction", type=float, default=0.15)
    parser.add_argument("--max-training-drafts", type=int, default=10000)
    parser.add_argument("--max-output-drafts", type=int, default=250)
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--card-metadata", default=None)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    output = build(args)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(output, handle, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {len(output['replays'])} replays to {output_path} using cutoff {output['cohort']['win_rate_cutoff']:.3f}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
