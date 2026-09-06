#!/usr/bin/env python3
"""Build sharded Limited replay-study data from a 17Lands draft_data CSV(.gz).

The live site never calls a model or the 17Lands API. This script runs offline,
selects an experienced high-win-rate cohort, trains an interpretable strong-
player consensus model, scores replay drafts out-of-fold, and writes compact
static JSON shards for the browser.

Consensus model v2 combines:
  * hierarchical card pick tendency by pack/pick position; and
  * shrinkage-adjusted card/pool co-pick lift, so probabilities change with
    the historical pool entering the pick.

All statistics used to score a replay exclude that replay's draft_id fold.
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

SCHEMA_VERSION = 2
MODEL_VERSION = "strong-player-pool-context-v2"
CARD_PREFIX = "pack_card_"
POOL_PREFIX = "pool_"
PAIR_MIN_SEEN = 8
PAIR_PRIOR_STRENGTH = 24.0
CONTEXT_STRENGTH = 0.75


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


def column_card_name(column: str, prefix: str) -> str:
    return column[len(prefix):]


def candidate_columns(fieldnames: Sequence[str]) -> List[str]:
    return [name for name in fieldnames if name.startswith(CARD_PREFIX)]


def pool_columns(fieldnames: Sequence[str]) -> List[str]:
    return [name for name in fieldnames if name.startswith(POOL_PREFIX)]


def clamp_probability(value: float) -> float:
    return min(1 - 1e-6, max(1e-6, value))


def logit(value: float) -> float:
    value = clamp_probability(value)
    return math.log(value / (1 - value))


def logistic(value: float) -> float:
    if value >= 0:
        z = math.exp(-value)
        return 1 / (1 + z)
    z = math.exp(value)
    return z / (1 + z)


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
class CountStore:
    exact_seen: Counter
    exact_picked: Counter
    pack_seen: Counter
    pack_picked: Counter
    global_seen: Counter
    global_picked: Counter
    pair_seen: Counter
    pair_picked: Counter

    @classmethod
    def empty(cls) -> "CountStore":
        return cls(*(Counter() for _ in range(8)))

    def observe(self, example: PickExample) -> None:
        pool_cards = tuple(example.pool.keys())
        for card in example.candidates:
            exact_key = (card, example.raw_pack_number, example.raw_pick_number)
            pack_key = (card, example.raw_pack_number)
            self.exact_seen[exact_key] += 1
            self.pack_seen[pack_key] += 1
            self.global_seen[card] += 1
            for pool_card in pool_cards:
                self.pair_seen[(card, pool_card)] += 1

        picked = example.historical_pick
        self.exact_picked[(picked, example.raw_pack_number, example.raw_pick_number)] += 1
        self.pack_picked[(picked, example.raw_pack_number)] += 1
        self.global_picked[picked] += 1
        for pool_card in pool_cards:
            self.pair_picked[(picked, pool_card)] += 1


class OutOfFoldModel:
    def __init__(self, all_counts: CountStore, held_out_counts: CountStore):
        self.all = all_counts
        self.held = held_out_counts

    def _count(self, attr: str, key) -> int:
        return max(0, getattr(self.all, attr)[key] - getattr(self.held, attr)[key])

    def base_tendency(self, card: str, pack_number: int, pick_number: int) -> float:
        exact_key = (card, pack_number, pick_number)
        pack_key = (card, pack_number)
        exact_seen = self._count("exact_seen", exact_key)
        if exact_seen >= 20:
            return (self._count("exact_picked", exact_key) + 1.5) / (exact_seen + 7.5)
        pack_seen = self._count("pack_seen", pack_key)
        if pack_seen >= 30:
            return (self._count("pack_picked", pack_key) + 2.0) / (pack_seen + 10.0)
        global_seen = self._count("global_seen", card)
        if global_seen:
            return (self._count("global_picked", card) + 2.0) / (global_seen + 12.0)
        return 0.01

    def card_tendency(self, card: str, pack_number: int, pick_number: int, pool: Mapping[str, int]) -> float:
        base = self.base_tendency(card, pack_number, pick_number)
        if not pool:
            return base

        weighted_lift = 0.0
        total_weight = 0.0
        for pool_card, copies in pool.items():
            key = (card, pool_card)
            seen = self._count("pair_seen", key)
            if seen < PAIR_MIN_SEEN:
                continue
            picked = self._count("pair_picked", key)
            pair_rate = (picked + PAIR_PRIOR_STRENGTH * base) / (seen + PAIR_PRIOR_STRENGTH)
            lift = logit(pair_rate) - logit(base)
            support_weight = min(1.0, math.sqrt(seen / 80.0))
            copy_weight = min(1.5, 1.0 + 0.15 * max(0, int(copies) - 1))
            weight = support_weight * copy_weight
            weighted_lift += lift * weight
            total_weight += weight

        if not total_weight:
            return base

        context = weighted_lift / total_weight
        commitment = min(1.0, sum(pool.values()) / 8.0)
        return logistic(logit(base) + CONTEXT_STRENGTH * commitment * context)


def normalize_probabilities(raw: Mapping[str, float]) -> Dict[str, float]:
    total = sum(max(0.0, value) for value in raw.values())
    if total <= 0:
        uniform = 1.0 / max(1, len(raw))
        return {card: uniform for card in raw}
    return {card: max(0.0, value) / total for card, value in raw.items()}


def parse_example(row: Mapping[str, str], pack_cols: Sequence[str], pool_cols: Sequence[str]) -> Optional[PickExample]:
    draft_id = (row.get("draft_id") or "").strip()
    historical = (row.get("pick") or "").strip()
    if not draft_id or not historical:
        return None
    try:
        raw_pack = int(float(row.get("pack_number", 0)))
        raw_pick = int(float(row.get("pick_number", 0)))
    except (TypeError, ValueError):
        return None
    candidates = [column_card_name(col, CARD_PREFIX) for col in pack_cols if truthy_count(row.get(col)) > 0]
    if historical not in candidates:
        return None
    pool = {
        column_card_name(col, POOL_PREFIX): count
        for col in pool_cols
        if (count := truthy_count(row.get(col))) > 0
    }
    return PickExample(draft_id, raw_pack, raw_pick, historical, candidates, pool)


def scan_draft_skill(path: Path) -> Tuple[Dict[str, DraftSkill], List[str]]:
    skills: Dict[str, DraftSkill] = {}
    with open_text(path) as handle:
        reader = csv.DictReader(handle)
        fieldnames = reader.fieldnames or []
        required = {"draft_id", "pick", "pack_number", "pick_number", "user_game_win_rate_bucket", "user_n_games_bucket"}
        missing = required - set(fieldnames)
        if missing:
            raise ValueError(f"Missing required columns: {', '.join(sorted(missing))}")
        if not candidate_columns(fieldnames):
            raise ValueError("No pack_card_* columns found in input.")
        if not pool_columns(fieldnames):
            raise ValueError("No pool_* columns found in input.")

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


def select_strong_drafts(skills: Mapping[str, DraftSkill], minimum_games: int, top_fraction: float, max_training_drafts: Optional[int]) -> Tuple[List[str], float, int]:
    experienced = {draft_id: skill for draft_id, skill in skills.items() if skill.games_lower_bound >= minimum_games}
    cutoff = quantile_cutoff([skill.rate for skill in experienced.values()], top_fraction)
    eligible = [draft_id for draft_id, skill in experienced.items() if skill.rate >= cutoff]
    eligible.sort(key=lambda draft_id: stable_score(f"train:{draft_id}"))
    if max_training_drafts and len(eligible) > max_training_drafts:
        eligible = eligible[:max_training_drafts]
    return eligible, cutoff, len(experienced)


def choose_output_ids(strong_ids: Sequence[str], max_output_drafts: int) -> List[str]:
    ordered = sorted(strong_ids, key=lambda draft_id: stable_score(f"replay:{draft_id}"))
    return ordered[:max_output_drafts] if max_output_drafts else ordered


def train_and_collect(path: Path, strong_ids: set[str], output_ids: set[str], fieldnames: Sequence[str], folds: int) -> Tuple[CountStore, List[CountStore], Dict[str, List[PickExample]], int, int, int]:
    pack_cols = candidate_columns(fieldnames)
    pool_cols = pool_columns(fieldnames)
    all_counts = CountStore.empty()
    fold_counts = [CountStore.empty() for _ in range(folds)]
    outputs: MutableMapping[str, List[PickExample]] = defaultdict(list)
    min_pack = 10**9
    min_pick = 10**9
    parsed_examples = 0

    with open_text(path) as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            draft_id = (row.get("draft_id") or "").strip()
            if draft_id not in strong_ids:
                continue
            example = parse_example(row, pack_cols, pool_cols)
            if not example:
                continue
            parsed_examples += 1
            min_pack = min(min_pack, example.raw_pack_number)
            min_pick = min(min_pick, example.raw_pick_number)
            all_counts.observe(example)
            fold_counts[stable_fold(example.draft_id, folds)].observe(example)
            if draft_id in output_ids:
                outputs[draft_id].append(example)

    return all_counts, fold_counts, dict(outputs), min_pack, min_pick, parsed_examples


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


def render_replay(draft_id: str, picks: Sequence[PickExample], model: OutOfFoldModel, pack_offset: int, pick_offset: int, card_metadata: Mapping[str, dict]) -> dict:
    rendered_picks = []
    for pick in sorted(picks, key=lambda item: (item.raw_pack_number, item.raw_pick_number)):
        raw_scores = {card: model.card_tendency(card, pick.raw_pack_number, pick.raw_pick_number, pick.pool) for card in pick.candidates}
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
            for key in ("image_url", "mana_cost", "rarity", "type_line"):
                if metadata.get(key):
                    candidate[key] = metadata[key]
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
    return {"draft_id": draft_id, "picks": rendered_picks}


def build(args: argparse.Namespace) -> dict:
    input_path = Path(args.input)
    skills, fieldnames = scan_draft_skill(input_path)
    strong_ids, cutoff, experienced_count = select_strong_drafts(skills, args.minimum_games, args.top_fraction, args.max_training_drafts)
    if len(strong_ids) < 2:
        raise ValueError("At least two strong-player drafts are required for holdout grading.")

    folds = min(args.folds, len(strong_ids))
    output_ids = choose_output_ids(strong_ids, args.max_output_drafts)
    all_counts, fold_counts, collected, min_pack, min_pick, parsed_examples = train_and_collect(input_path, set(strong_ids), set(output_ids), fieldnames, folds)
    metadata = load_card_metadata(Path(args.card_metadata) if args.card_metadata else None)
    pack_offset = 1 if min_pack == 0 else 0
    pick_offset = 1 if min_pick == 0 else 0

    replays = []
    for draft_id in output_ids:
        picks = collected.get(draft_id, [])
        if len(picks) < args.minimum_picks:
            continue
        fold = stable_fold(draft_id, folds)
        model = OutOfFoldModel(all_counts, fold_counts[fold])
        replays.append(render_replay(draft_id, picks, model, pack_offset, pick_offset, metadata))

    if not replays:
        raise ValueError("No output drafts met the minimum-picks requirement.")

    return {
        "schema_version": SCHEMA_VERSION,
        "set_id": args.expansion.lower(),
        "name": args.expansion,
        "format": args.format,
        "is_fixture": False,
        "source": {"provider": "17Lands", "dataset_kind": "draft_data", "data_date": args.source_date, "license": "CC BY 4.0 unless otherwise noted by 17Lands"},
        "cohort": {
            "definition": f"experienced drafts in top {args.top_fraction:.0%} of parsed 17Lands user win-rate buckets",
            "minimum_games_bucket_lower_bound": args.minimum_games,
            "win_rate_cutoff": round(cutoff, 6),
            "experienced_drafts": experienced_count,
            "training_drafts": len(strong_ids),
            "training_picks": parsed_examples,
        },
        "model": {
            "model_version": MODEL_VERSION,
            "holdout": f"{folds}-fold by draft_id",
            "probabilities_are_calibrated": False,
            "description": "Hierarchical strong-player pick tendency adjusted by shrinkage-weighted card/pool co-pick lift; normalized within each pack.",
            "pool_conditioned": True,
        },
        "replays": replays,
    }


def write_sharded_dataset(dataset: dict, output_dir: Path, shard_size: int) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    shards_dir = output_dir / "shards"
    shards_dir.mkdir(parents=True, exist_ok=True)
    for old in shards_dir.glob("*.json"):
        old.unlink()

    replays = dataset["replays"]
    shard_entries = []
    set_meta = {key: value for key, value in dataset.items() if key != "replays"}
    for index in range(0, len(replays), shard_size):
        chunk = replays[index:index + shard_size]
        filename = f"{index // shard_size:03d}.json"
        payload = {
            "schema_version": dataset["schema_version"],
            "set_id": dataset["set_id"],
            "name": dataset["name"],
            "format": dataset["format"],
            "model": dataset["model"],
            "replays": chunk,
        }
        (shards_dir / filename).write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        shard_entries.append({"path": f"./data/{output_dir.name}/shards/{filename}", "replay_count": len(chunk)})

    manifest = {**set_meta, "replay_count": len(replays), "shard_size": shard_size, "shards": shard_entries}
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def update_catalog(catalog_path: Path, manifest: Mapping[str, object], output_dir: Path) -> None:
    if catalog_path.exists():
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    else:
        catalog = {"schema_version": 2, "sets": []}
    set_id = str(manifest["set_id"])
    entry = {
        "id": set_id,
        "name": str(manifest["name"]),
        "format": str(manifest["format"]),
        "manifest_path": f"./data/{output_dir.name}/manifest.json",
        "replay_count": int(manifest["replay_count"]),
        "model_version": str(manifest["model"]["model_version"]),
        "data_date": str(manifest["source"]["data_date"]),
        "is_fixture": False,
        "win_rate_cutoff": float(manifest["cohort"]["win_rate_cutoff"]),
        "training_drafts": int(manifest["cohort"]["training_drafts"]),
    }
    existing = [item for item in catalog.get("sets", []) if item.get("id") not in {set_id, f"{set_id}-fixture"}]
    catalog["schema_version"] = 2
    catalog["sets"] = [entry, *existing]
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    catalog_path.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="17Lands draft_data CSV or CSV.gz")
    parser.add_argument("--output-dir", required=True, help="Directory for manifest.json + shards/")
    parser.add_argument("--catalog", help="Optional catalog.json to update with this set")
    parser.add_argument("--expansion", required=True, help="Set code, e.g. MSH")
    parser.add_argument("--format", default="PremierDraft")
    parser.add_argument("--source-date", required=True)
    parser.add_argument("--minimum-games", type=int, default=100)
    parser.add_argument("--top-fraction", type=float, default=0.15)
    parser.add_argument("--max-training-drafts", type=int, default=8000)
    parser.add_argument("--max-output-drafts", type=int, default=300)
    parser.add_argument("--minimum-picks", type=int, default=30)
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--shard-size", type=int, default=10)
    parser.add_argument("--card-metadata")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    dataset = build(args)
    output_dir = Path(args.output_dir)
    manifest = write_sharded_dataset(dataset, output_dir, args.shard_size)
    if args.catalog:
        update_catalog(Path(args.catalog), manifest, output_dir)
    print(json.dumps({
        "replays": manifest["replay_count"],
        "shards": len(manifest["shards"]),
        "training_drafts": manifest["cohort"]["training_drafts"],
        "win_rate_cutoff": manifest["cohort"]["win_rate_cutoff"],
        "model": manifest["model"]["model_version"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
