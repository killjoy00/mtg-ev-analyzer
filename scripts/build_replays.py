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
# v3 is the immutable model identity of the currently published corpus and is
# retained for frozen historical reconstruction. v4 changes no scoring formula;
# it changes model construction so every fold statistic is derived from that
# fold's explicit training complement before any aggregation.
MODEL_VERSION = "strong-player-colour-stage-v3"
ISOLATED_MODEL_VERSION = "strong-player-colour-stage-v4"
# Weight on the colour-commitment shift, frozen with the rest of the
# specification in docs/MODEL-EVALUATION.md and validated on six held-out sets.
FIT_STRENGTH = 0.75
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
    # Sum of the stage-specific base rate over exactly the observations behind
    # pair_seen. The pair counts pool every pack and pick a pair was seen at,
    # while the base they were once differenced against is specific to one
    # position - so the difference read draft stage as a pool effect. Anchoring
    # on this instead removes that. Filled by a SECOND pass, because the base
    # rates it sums are only defined once the first pass has finished counting.
    pair_expected: Counter

    @classmethod
    def empty(cls) -> "CountStore":
        return cls(*(Counter() for _ in range(9)))

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

    def observe_expected(self, example: PickExample, base_of) -> None:
        """Second pass: accumulate the base rate expected at this position."""
        pool_cards = tuple(example.pool.keys())
        if not pool_cards:
            return
        for card in example.candidates:
            base = base_of(card, example.raw_pack_number, example.raw_pick_number)
            for pool_card in pool_cards:
                self.pair_expected[(card, pool_card)] += base


@dataclass(frozen=True)
class FoldTrainingData:
    """Every numeric input for one grader, built from its allowed IDs only."""

    fold: int
    training_ids: frozenset[str]
    held_out_ids: frozenset[str]
    observed_ids: frozenset[str]
    counts: CountStore


def fold_partitions(training_ids: set[str], folds: int) -> List[Tuple[set[str], set[str]]]:
    """Return (training, held-out) IDs for every fold with coverage assertions."""
    if folds < 2:
        raise ValueError("At least two folds are required for out-of-fold grading.")
    ids = set(training_ids)
    held = [{draft_id for draft_id in ids if stable_fold(draft_id, folds) == fold}
            for fold in range(folds)]
    if set().union(*held) != ids:
        raise AssertionError("Fold assignment did not cover every training draft.")
    if sum(len(group) for group in held) != len(ids):
        raise AssertionError("A training draft was assigned to more than one held-out fold.")
    result = []
    for fold, held_ids in enumerate(held):
        allowed = ids - held_ids
        if allowed & held_ids:
            raise AssertionError(f"Fold {fold}: training and held-out IDs overlap.")
        result.append((allowed, held_ids))
    return result


def build_fold_training(training_examples: Sequence[Tuple[str, PickExample]],
                        training_ids: set[str], folds: int) -> List[FoldTrainingData]:
    """Construct every fold from its permitted observations, never by subtraction.

    In v3, direct held-out counts were subtracted after global aggregation, but
    pair_expected had already been calculated from global base rates. That left
    a statistical trace of held answers. Here the held IDs are removed first;
    direct counts, base rates, pair expectations, priors and fallbacks are then
    all consequences of the same explicit training complement.
    """
    pairs = list(training_examples)
    ids = set(training_ids)
    foreign = {draft_id for draft_id, _ in pairs if draft_id not in ids}
    if foreign:
        raise AssertionError(f"Training examples include IDs outside the cohort: {sorted(foreign)[:3]}")

    partitions = fold_partitions(ids, folds)
    held_example_count = sum(
        1 for draft_id, _ in pairs
        if draft_id in partitions[stable_fold(draft_id, folds)][1]
    )
    if held_example_count != len(pairs):
        raise AssertionError("Every training observation must belong to exactly one held-out fold.")

    built: List[FoldTrainingData] = []
    for fold, (allowed_ids, held_ids) in enumerate(partitions):
        counts = CountStore.empty()
        observed_ids = set()
        for draft_id, example in pairs:
            if draft_id not in allowed_ids:
                continue
            if draft_id in held_ids:
                raise AssertionError(f"Fold {fold}: held-out observation reached direct aggregates.")
            counts.observe(example)
            observed_ids.add(draft_id)

        base_model = OutOfFoldModel(counts, CountStore.empty())
        memo: Dict[Tuple[str, int, int], float] = {}

        def base_of(card: str, pack: int, pick: int) -> float:
            key = (card, pack, pick)
            value = memo.get(key)
            if value is None:
                value = base_model.base_tendency(card, pack, pick)
                memo[key] = value
            return value

        for draft_id, example in pairs:
            if draft_id not in allowed_ids:
                continue
            if draft_id in held_ids:
                raise AssertionError(f"Fold {fold}: held-out observation reached pair expectations.")
            counts.observe_expected(example, base_of)

        if observed_ids - allowed_ids or observed_ids & held_ids:
            raise AssertionError(f"Fold {fold}: aggregate provenance contains held-out IDs.")
        built.append(FoldTrainingData(
            fold=fold,
            training_ids=frozenset(allowed_ids),
            held_out_ids=frozenset(held_ids),
            observed_ids=frozenset(observed_ids),
            counts=counts,
        ))
    return built


def _colour_helpers():
    """deck_fit imports eval_model which imports this module, so the colour
    primitives cannot be imported at the top. Bound once per model rather than
    looked up per call: card_tendency runs millions of times in a build."""
    from deck_fit import (commit_bucket, commitment,  # noqa: E402
                          parse_colour_mark, stage_bucket)
    return commit_bucket, commitment, parse_colour_mark, stage_bucket


class OutOfFoldModel:
    def __init__(self, all_counts: CountStore, held_out_counts: CountStore,
                 fit: Optional[dict] = None):
        self.all = all_counts
        self.held = held_out_counts
        # The colour table. Without one the colour term contributes nothing and
        # the model degrades to the stage-matched pair term alone, which is a
        # different model from the validated one - so build() requires it.
        self.fit = fit
        self.fit_colours: Dict[str, Optional[frozenset]] = {}
        (self._commit_bucket, self._commitment,
         parse_colour_mark, self._stage_bucket) = _colour_helpers()
        if fit:
            for name, row in fit["cards"].items():
                self.fit_colours[name] = parse_colour_mark(row.get("colours"))

    def _expected(self, key) -> float:
        return max(0.0, self.all.pair_expected[key] - self.held.pair_expected[key])

    def fit_shift(self, card: str, pool: Mapping[str, int]) -> float:
        """How much this pool changes the odds the card ever reaches the deck.

        Colour commitment generalises where card-pair counts cannot: every pool
        card sharing a colour is evidence about every pack card sharing it.
        Held at a fixed draft stage, because commitment can never exceed the
        pool it is counted from, so the marginal curve reads stage as well as
        colour fit and the two pull opposite ways.

        One format-wide curve, not a per-card table: the per-card version lost
        to this one on both criteria, and it estimated a counterfactual the data
        cannot identify.
        """
        if not self.fit or not pool:
            return 0.0
        if card not in self.fit["cards"]:
            return 0.0
        matched = self._commitment(dict(pool), self.fit_colours, card)
        if matched is None:
            return 0.0    # colours unknown: decline the judgement, do not invent one
        bucket = self._commit_bucket(matched)
        conditioned = reference = None
        cell = self.fit.get("by_stage", {}).get(self._stage_bucket(sum(pool.values())))
        if cell:
            conditioned, reference = cell.get(bucket), cell.get("*")
        if conditioned is None or reference is None:
            # Too thin a stage cell to report: fall back to the marginal curve
            # rather than to noise.
            conditioned = self.fit["by_commitment"].get(bucket)
            reference = self.fit.get("play_rate")
        if not conditioned or not reference:
            return 0.0
        clamp = lambda p: min(1 - 1e-6, max(1e-6, p))
        return logit(clamp(conditioned)) - logit(clamp(reference))

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
        """strong-player-colour-stage-v3.

        Ported from the eval harness's `v3-colour-and-pair`, which is the
        configuration validated on six held-out sets. A test asserts the two
        agree to twelve places on identical inputs; if they ever diverge, what
        ships is no longer what was measured.
        """
        base = self.base_tendency(card, pack_number, pick_number)
        shift = FIT_STRENGTH * self.fit_shift(card, pool)
        if not pool:
            return logistic(logit(base) + shift) if shift else base

        weighted_lift = 0.0
        total_weight = 0.0
        for pool_card, copies in pool.items():
            key = (card, pool_card)
            seen = self._count("pair_seen", key)
            if seen < PAIR_MIN_SEEN:
                continue
            expected = self._expected(key)
            if not expected:
                continue
            # Anchor the lift on the base rate expected over exactly these
            # observations, not on the base rate at the position being scored.
            reference = min(1 - 1e-6, max(1e-6, expected / seen))
            picked = self._count("pair_picked", key)
            pair_rate = (picked + PAIR_PRIOR_STRENGTH * reference) / (seen + PAIR_PRIOR_STRENGTH)
            lift = logit(pair_rate) - logit(reference)
            support_weight = min(1.0, math.sqrt(seen / 80.0))
            copy_weight = min(1.5, 1.0 + 0.15 * max(0, int(copies) - 1))
            weight = support_weight * copy_weight
            weighted_lift += lift * weight
            total_weight += weight

        if not total_weight:
            return logistic(logit(base) + shift) if shift else base

        context = weighted_lift / total_weight
        pool_commitment = min(1.0, sum(pool.values()) / 8.0)
        return logistic(logit(base) + CONTEXT_STRENGTH * pool_commitment * context + shift)


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


def train_and_collect(path: Path, strong_ids: set[str], output_ids: set[str],
                      fieldnames: Sequence[str], folds: int,
                      colour_examples: Optional[list] = None
                      ) -> Tuple[List[FoldTrainingData], Dict[str, List[PickExample]], int, int, int]:
    """Parse once, then build each grader from an explicit training complement."""
    pack_cols = candidate_columns(fieldnames)
    pool_cols = pool_columns(fieldnames)
    outputs: MutableMapping[str, List[PickExample]] = defaultdict(list)
    training_examples: List[Tuple[str, PickExample]] = []
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
            training_examples.append((draft_id, example))
            if draft_id in output_ids:
                outputs[draft_id].append(example)
            elif colour_examples is not None:
                # Preserve the existing stronger rule: no served draft informs
                # any colour fit, even when it is outside the fold being scored.
                colour_examples.append((draft_id, example))

    fold_training = build_fold_training(training_examples, set(strong_ids), folds)
    return fold_training, dict(outputs), min_pack, min_pick, parsed_examples


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


def build_colour_table(game_archive: Path, examples, contributing: set, set_id: str) -> dict:
    """The colour table, built here rather than shipped as a committed artifact.

    A stale table is a silent model change - the colour term would keep
    producing numbers, just the wrong ones - so it is derived from the same two
    public archives the rest of the build reads.

    `contributing` excludes the drafts that will be served. A served puzzle's
    own deck should not inform the table that scores it. The influence of any
    one draft on a format-wide curve is small, but "small" was the wrong answer
    to this question once already in this project.
    """
    from deck_fit import (card_colours, colour_mark, estimate,  # noqa: E402
                          observe_examples, scan_decks)
    played, colour_hits = scan_decks(game_archive, contributing)
    colours = card_colours(colour_hits)
    by_bucket, by_card, by_stage = observe_examples(
        ((draft_id, example) for draft_id, example in examples
         if draft_id in contributing), played, colours)
    if not by_card:
        raise ValueError(
            f"{game_archive}: no draft in the training cohort matched the game "
            f"data. Wrong set, or a draft/game archive pair from different runs?")
    fit = estimate(by_bucket, by_card, colours, by_stage)
    fit["set_id"] = set_id
    fit["split"] = "train"
    fit["contributing_drafts"] = len(contributing)
    fit["decks_matched"] = len(played)
    unknown = sum(1 for row in fit["cards"].values()
                  if row["colours"] == colour_mark(None))
    fit["cards_with_unknown_colour"] = unknown
    return fit


def build_colour_tables_by_fold(game_archive: Path,
                                examples: Sequence[Tuple[str, PickExample]],
                                fold_training: Sequence[FoldTrainingData],
                                set_id: str) -> List[dict]:
    """Build colour/stage reference tables from each fold's training IDs only.

    The game archive is scanned once into per-draft observations. Card colours,
    commitment curves, stage cells, play-rate fallbacks and every other fit
    statistic are then re-aggregated separately for each permitted ID set.
    """
    from deck_fit import (card_colours, colour_hits_for_drafts, colour_mark,  # noqa: E402
                          estimate, observe_examples, scan_deck_observations)

    example_ids = {draft_id for draft_id, _ in examples}
    allowed_union = set().union(*(set(fold.training_ids) for fold in fold_training))
    scan_ids = example_ids & allowed_union
    played, main_by_draft = scan_deck_observations(game_archive, scan_ids)
    fits: List[dict] = []

    for fold in fold_training:
        contributing = example_ids & set(fold.training_ids)
        if contributing & set(fold.held_out_ids):
            raise AssertionError(f"Fold {fold.fold}: held-out IDs reached colour inputs.")
        fold_played = {draft_id: played[draft_id] for draft_id in contributing
                       if draft_id in played}
        colour_hits = colour_hits_for_drafts(played, main_by_draft, contributing)
        colours = card_colours(colour_hits)
        by_bucket, by_card, by_stage = observe_examples(
            ((draft_id, example) for draft_id, example in examples
             if draft_id in contributing),
            fold_played, colours)
        if not by_card:
            raise ValueError(
                f"{game_archive}: fold {fold.fold} has no training draft matched "
                "to game data. Wrong set, or mismatched draft/game archives?")
        fit = estimate(by_bucket, by_card, colours, by_stage)
        fit["set_id"] = set_id
        fit["split"] = "fold-train"
        fit["holdout_fold"] = fold.fold
        fit["training_ids_sha256"] = hashlib.sha256(
            "\n".join(sorted(fold.training_ids)).encode()).hexdigest()
        fit["contributing_drafts"] = len(contributing)
        fit["decks_matched"] = len(fold_played)
        fit["cards_with_unknown_colour"] = sum(
            1 for row in fit["cards"].values()
            if row["colours"] == colour_mark(None))
        fits.append(fit)

    if len(fits) != len(fold_training):
        raise AssertionError("Every fold must have exactly one colour fit.")
    return fits


def load_deck_fit(path: Path) -> dict:
    """The colour table, checked for the two things that would silently change
    the model: the wrong split, and a missing stage curve."""
    fit = json.loads(path.read_text(encoding="utf-8"))
    if fit.get("split") != "train":
        raise ValueError(f"{path}: deck fit must be built on the train split, "
                         f"not {fit.get('split')!r}")
    for required in ("cards", "by_commitment", "by_stage", "play_rate"):
        if required not in fit:
            raise ValueError(f"{path}: deck fit lacks {required!r}; rebuild with "
                             f"the current deck_fit.py")
    return fit


def build(args: argparse.Namespace) -> dict:
    if getattr(args, "deck_fit", None):
        raise ValueError(
            "A single prebuilt --deck-fit cannot be shared across held-out folds. "
            "Pass --game-data so each fold's colour statistics are built from its "
            "explicit training IDs.")
    if not getattr(args, "game_data", None):
        raise ValueError("Pass --game-data. Fold-isolated colour tables must be "
                         "derived from the same training complement as the pick model.")
    input_path = Path(args.input)
    skills, fieldnames = scan_draft_skill(input_path)
    strong_ids, cutoff, experienced_count = select_strong_drafts(skills, args.minimum_games, args.top_fraction, args.max_training_drafts)
    if len(strong_ids) < 2:
        raise ValueError("At least two strong-player drafts are required for holdout grading.")

    folds = min(args.folds, len(strong_ids))
    output_ids = choose_output_ids(strong_ids, args.max_output_drafts)
    colour_examples: List[Tuple[str, PickExample]] = []
    fold_training, collected, min_pack, min_pick, parsed_examples = train_and_collect(
        input_path, set(strong_ids), set(output_ids), fieldnames, folds, colour_examples)
    metadata = load_card_metadata(Path(args.card_metadata) if args.card_metadata else None)
    deck_fits = build_colour_tables_by_fold(
        Path(args.game_data), colour_examples, fold_training, args.expansion.lower())
    pack_offset = 1 if min_pack == 0 else 0
    pick_offset = 1 if min_pick == 0 else 0

    replays = []
    for draft_id in output_ids:
        picks = collected.get(draft_id, [])
        if len(picks) < args.minimum_picks:
            continue
        fold = stable_fold(draft_id, folds)
        fold_data = fold_training[fold]
        if draft_id not in fold_data.held_out_ids or draft_id in fold_data.training_ids:
            raise AssertionError(f"{draft_id}: invalid fold provenance before scoring.")
        model = OutOfFoldModel(fold_data.counts, CountStore.empty(), deck_fits[fold])
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
            "model_version": ISOLATED_MODEL_VERSION,
            "holdout": f"{folds}-fold by draft_id",
            "probabilities_are_calibrated": False,
            "description": "Hierarchical strong-player pick tendency, adjusted by a stage-matched card/pool co-pick lift and a stage-matched colour-commitment shift; normalized within each pack.",
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
    parser.add_argument("--shard-size", type=int, default=2)
    parser.add_argument("--card-metadata")
    parser.add_argument("--game-data",
                        help="17Lands game_data archive for this set. The colour "
                             "table is built from it, excluding the drafts this "
                             "build will serve.")
    parser.add_argument("--deck-fit",
                        help="a prebuilt deck_fit.py table instead of --game-data. "
                             "One of the two is required: without a colour table "
                             "the colour term contributes nothing and what ships "
                             "is a different model from the one validated.")
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
