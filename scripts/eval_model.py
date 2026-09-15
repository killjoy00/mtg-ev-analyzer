#!/usr/bin/env python3
"""Offline evaluation harness for the strong-player consensus model.

Nothing here touches the served corpus. It extracts a compact cache of the
eligible cohort from a 17Lands draft_data archive, splits it by draft_id, trains
one or more model variants on the train split only, and scores the untouched
test split.

Two questions are deliberately kept apart:

  * prediction - how well does the model predict a strong player's next pick?
    Measured with log loss, Brier score, top-1 accuracy, rank and calibration.
  * grading - how the scoring formula would treat the alternatives. Reported as
    support-ratio statistics, never mixed into the prediction metrics.

Variants are evaluated on identical held-out examples so differences can be
compared pairwise. Every headline difference carries a bootstrap interval,
because an unbootstrapped delta on one set is not evidence.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import random
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Dict, Iterator, List, Mapping, Optional, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_replays import (  # noqa: E402
    CountStore,
    DraftSkill,
    OutOfFoldModel,
    PickExample,
    candidate_columns,
    logistic,
    logit,
    normalize_probabilities,
    open_text,
    parse_example,
    parse_games_lower_bound,
    parse_rate_bucket,
    pool_columns,
    quantile_cutoff,
    stable_score,
)

def _fit_helpers():
    """deck_fit imports this module, so it cannot be imported at the top.

    Bound once per model rather than looked up per call: card_tendency runs
    tens of millions of times in a sweep.
    """
    from deck_fit import COLOURS, commit_bucket, commitment, stage_bucket  # noqa: E402
    return COLOURS, commit_bucket, commitment, stage_bucket


ROOT = Path(__file__).resolve().parents[1]
CACHE_VERSION = 3
SPLIT_SALT = "eval-split"
# Disjoint from the 60/15 train/validation prefix; 25% keeps per-set intervals
# tight enough to separate variants that differ by a few thousandths of a nat.
TRAIN_SHARE, VALIDATION_SHARE = 60, 15


# --------------------------------------------------------------------------
# cohort extraction
# --------------------------------------------------------------------------

def draft_split(draft_id: str) -> str:
    bucket = stable_score(f"{SPLIT_SALT}:{draft_id}") % 100
    if bucket < TRAIN_SHARE:
        return "train"
    if bucket < TRAIN_SHARE + VALIDATION_SHARE:
        return "validation"
    return "test"


def scan_skills(path: Path) -> Tuple[Dict[str, DraftSkill], List[str]]:
    """One cheap pass: draft_id -> skill, without parsing the wide card columns."""
    skills: Dict[str, DraftSkill] = {}
    with open_text(path) as handle:
        reader = csv.reader(handle)
        header = next(reader)
        required = {"draft_id", "pick", "pack_number", "pick_number",
                    "user_game_win_rate_bucket", "user_n_games_bucket"}
        missing = required - set(header)
        if missing:
            raise ValueError(f"Missing required columns: {', '.join(sorted(missing))}")
        index = {name: position for position, name in enumerate(header)}
        draft_at = index["draft_id"]
        games_at = index["user_n_games_bucket"]
        rate_at = index["user_game_win_rate_bucket"]
        for values in reader:
            if len(values) != len(header):
                continue
            draft_id = values[draft_at].strip()
            if not draft_id or draft_id in skills:
                continue
            rate = parse_rate_bucket(values[rate_at])
            games = parse_games_lower_bound(values[games_at])
            if rate is None or games is None:
                continue
            skills[draft_id] = DraftSkill(rate=rate, games_lower_bound=games)
    return skills, header


def eligible_cohort(skills: Mapping[str, DraftSkill], minimum_games: int,
                    top_fraction: float, cohort: str = "elite") -> Tuple[List[str], float, int]:
    """The full eligible population, uncapped and in production order.

    select_strong_drafts() truncates to max_training_drafts after this same
    hash ordering, so a prefix of this list is exactly what production trains
    on at any cap. Ties at the bucketed cutoff are admitted, which is why the
    eligible share lands above top_fraction.

    cohort="control" inverts the filter: equally experienced drafters whose win
    rate sits strictly below the same cutoff. They are never trained on. Scoring
    their picks with a model built from the elite cohort is how a scoring curve
    gets tested for what a game actually needs it to do - tell a strong drafter
    from an ordinary one.
    """
    experienced = {d: s for d, s in skills.items() if s.games_lower_bound >= minimum_games}
    if not experienced:
        raise ValueError("No drafts met the minimum games requirement.")
    cutoff = quantile_cutoff([s.rate for s in experienced.values()], top_fraction)
    if cohort == "control":
        chosen = [d for d, s in experienced.items() if s.rate < cutoff]
    elif cohort == "elite":
        chosen = [d for d, s in experienced.items() if s.rate >= cutoff]
    else:
        raise ValueError(f"Unknown cohort '{cohort}'.")
    chosen.sort(key=lambda draft_id: stable_score(f"train:{draft_id}"))
    return chosen, cutoff, len(experienced)


def extract(archive: Path, set_id: str, destination: Path, minimum_games: int,
            top_fraction: float, cohort: str = "elite",
            max_drafts: Optional[int] = None) -> dict:
    """Archive -> compact cache of a cohort's picks.

    The elite cache is uncapped on purpose: the training cap is a knob applied
    later, so cap experiments reuse one extraction instead of re-reading the
    archive. A control cache is capped, because the cohort is far larger than
    any analysis needs.
    """
    skills, header = scan_skills(archive)
    eligible, cutoff, experienced = eligible_cohort(skills, minimum_games, top_fraction, cohort)
    if max_drafts and len(eligible) > max_drafts:
        eligible = eligible[:max_drafts]
    wanted = set(eligible)
    order = {draft_id: position for position, draft_id in enumerate(eligible)}

    pack_cols = candidate_columns(header)
    pool_cols = pool_columns(header)
    if not pack_cols or not pool_cols:
        raise ValueError("Archive has no pack_card_* or pool_* columns.")

    vocabulary: Dict[str, int] = {}

    def intern(name: str) -> int:
        if name not in vocabulary:
            vocabulary[name] = len(vocabulary)
        return vocabulary[name]

    draft_at = header.index("draft_id")
    min_pack, min_pick, rows_kept = 10 ** 9, 10 ** 9, 0
    destination.parent.mkdir(parents=True, exist_ok=True)
    picks_path = destination.parent / f"{destination.name}.picks.jsonl.gz"

    with open_text(archive) as handle, gzip.open(picks_path, "wt", encoding="utf-8") as out:
        reader = csv.reader(handle)
        next(reader)
        for values in reader:
            if len(values) != len(header):
                continue
            if values[draft_at].strip() not in wanted:
                continue
            row = dict(zip(header, values))
            example = parse_example(row, pack_cols, pool_cols)
            if example is None:
                continue
            min_pack = min(min_pack, example.raw_pack_number)
            min_pick = min(min_pick, example.raw_pick_number)
            rows_kept += 1
            out.write(json.dumps([
                order[example.draft_id],
                example.raw_pack_number,
                example.raw_pick_number,
                intern(example.historical_pick),
                [intern(card) for card in example.candidates],
                [[intern(card), count] for card, count in sorted(example.pool.items())],
            ], separators=(",", ":")) + "\n")

    if not rows_kept:
        raise ValueError("Extraction produced no usable picks.")

    names = [""] * len(vocabulary)
    for name, position in vocabulary.items():
        names[position] = name
    meta = {
        "cache_version": CACHE_VERSION,
        "set_id": set_id,
        "cohort": cohort,
        "archive": archive.name,
        "minimum_games": minimum_games,
        "top_fraction": top_fraction,
        "win_rate_cutoff": round(cutoff, 6),
        "experienced_drafts": experienced,
        "eligible_drafts": len(eligible),
        "eligible_share": round(len(eligible) / experienced, 4),
        "picks": rows_kept,
        "pack_offset": 1 if min_pack == 0 else 0,
        "pick_offset": 1 if min_pick == 0 else 0,
        "drafts": eligible,
        "vocabulary": names,
        "picks_file": picks_path.name,
    }
    destination.write_text(json.dumps(meta), encoding="utf-8")
    return {k: v for k, v in meta.items() if k not in ("drafts", "vocabulary")}


@dataclass
class Cache:
    meta: dict
    path: Path

    @classmethod
    def load(cls, path: Path) -> "Cache":
        meta = json.loads(path.read_text(encoding="utf-8"))
        if meta.get("cache_version") != CACHE_VERSION:
            raise ValueError(f"{path}: stale cache, re-run extract.")
        return cls(meta, path)

    @property
    def set_id(self) -> str:
        return self.meta["set_id"]

    @property
    def names(self) -> List[str]:
        return self.meta["vocabulary"]

    def examples(self) -> Iterator[Tuple[str, PickExample]]:
        drafts = self.meta["drafts"]
        names = self.meta["vocabulary"]
        picks_path = self.path.parent / self.meta["picks_file"]
        with gzip.open(picks_path, "rt", encoding="utf-8") as handle:
            for line in handle:
                draft_index, pack, pick, chosen, candidates, pool = json.loads(line)
                draft_id = drafts[draft_index]
                yield draft_id, PickExample(
                    draft_id, pack, pick, names[chosen],
                    [names[i] for i in candidates],
                    {names[i]: count for i, count in pool},
                )

    def split_drafts(self, split: str) -> List[str]:
        return [d for d in self.meta["drafts"] if draft_split(d) == split]


# --------------------------------------------------------------------------
# model variants
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Variant:
    """A model configuration. `v2` reproduces production exactly."""
    name: str
    context: bool = True
    stage_matched: bool = False
    coverage: bool = False
    deck_fit: bool = False
    card_specific_fit: bool = True
    fit_stage_matched: bool = False
    fit_strength: float = 0.75
    pair_min_seen: int = 8
    pair_prior_strength: float = 24.0
    context_strength: float = 0.75
    temperature: float = 1.0
    notes: str = ""

    def describe(self) -> dict:
        return {
            "name": self.name, "context": self.context,
            "stage_matched": self.stage_matched, "coverage": self.coverage,
            "deck_fit": self.deck_fit, "fit_strength": self.fit_strength,
            "card_specific_fit": self.card_specific_fit,
            "fit_stage_matched": self.fit_stage_matched,
            "pair_min_seen": self.pair_min_seen,
            "pair_prior_strength": self.pair_prior_strength,
            "context_strength": self.context_strength,
            "temperature": self.temperature, "notes": self.notes,
        }

    def labelled(self) -> str:
        return self.name if self.temperature == 1.0 else f"{self.name}@T{self.temperature:g}"


VARIANTS: Dict[str, Variant] = {
    v.name: v for v in [
        Variant("v2", notes="production strong-player-pool-context-v2"),
        Variant("v2-no-context", context=False,
                notes="ablation: hierarchical base tendency only"),
        Variant("v3-stage-matched", stage_matched=True,
                notes="lift measured against the base rate expected at the stages the pair was observed at"),
        Variant("v3-stage-coverage", stage_matched=True, coverage=True,
                notes="stage-matched lift scaled by the share of the pool carrying usable pair evidence"),
        Variant("v2-coverage", coverage=True,
                notes="coverage scaling alone, keeping the pooled-stage baseline"),
        Variant("v3-deck-fit", context=False, deck_fit=True,
                notes="colour-commitment context replacing card-pair lift"),
        Variant("v3-fit-and-pair", deck_fit=True, stage_matched=True,
                notes="stage-matched pair lift and colour-commitment context, additive"),
        Variant("v3-colour-only", context=False, deck_fit=True, card_specific_fit=False,
                notes="one format-wide colour-commitment curve, no per-card play rates"),
        Variant("v3-colour-stage", context=False, deck_fit=True, card_specific_fit=False,
                fit_stage_matched=True,
                notes="format-wide colour curve held at a fixed point in the draft"),
        Variant("v3-colour-and-pair", deck_fit=True, card_specific_fit=False,
                stage_matched=True, fit_stage_matched=True,
                notes="stage-matched pair lift and stage-matched colour curve"),
    ]
}


def copy_weight(copies: int) -> float:
    return min(1.5, 1.0 + 0.15 * max(0, int(copies) - 1))


def sharpen(raw: Mapping[str, float], temperature: float) -> Dict[str, float]:
    """Raise every tendency to a fixed power before normalising.

    The normalised marginals are measurably under-dispersed: the card the model
    ranks first is taken far more often than the share it is given. One exponent
    corrects a bias that size without reordering anything, so it is the cheapest
    thing to try before reaching for a different model.
    """
    if temperature == 1.0:
        return dict(raw)
    return {card: max(0.0, value) ** temperature for card, value in raw.items()}


class VariantModel(OutOfFoldModel):
    """Production OutOfFoldModel with the pool-context term made configurable.

    base_tendency() is inherited unchanged, so every variant shares one
    hierarchy and differences are attributable to the context term alone.
    """

    def __init__(self, counts: CountStore, variant: Variant,
                 pair_expected: Optional[Mapping[Tuple[str, str], float]] = None,
                 fit: Optional[dict] = None):
        super().__init__(counts, CountStore.empty())
        self.variant = variant
        self.pair_expected = pair_expected or {}
        self.fit = fit
        self.fit_colours: Dict[str, frozenset] = {}
        if fit:
            (colours, self._commit_bucket, self._commitment,
             self._stage_bucket) = _fit_helpers()
            for name, row in fit["cards"].items():
                letters = row.get("colours") or "C"
                self.fit_colours[name] = frozenset(c for c in letters if c in colours)

    def _count(self, attr: str, key) -> int:
        return getattr(self.all, attr)[key]

    def fit_shift(self, card: str, pool: Mapping[str, int]) -> float:
        """How much this pool changes the odds the card ever reaches the deck.

        The card-pair term can only speak about pairs it has actually counted,
        so a card the drafter has never been seen holding alongside this pool
        card gets no context at all. Colour commitment generalises: every card
        in the pool that shares a colour is evidence about every card in the
        pack that shares it, which is the thing the pair counts were
        approximating one pair at a time.

        Measured as a log-odds shift against the card's own unconditional play
        rate, so a card that is usually abandoned is not penalised twice.
        """
        if not self.fit:
            return 0.0
        # The colour-only variants still need the card's colours, to know which
        # of the pool counts; what they drop is the card's own play rates.
        row = (self.fit["cards"].get(card) if self.variant.card_specific_fit
               else (self.fit if card in self.fit["cards"] else None))
        if row is None:
            return 0.0
        bucket = self._commit_bucket(self._commitment(dict(pool), self.fit_colours, card))
        conditioned = reference = None
        if self.variant.fit_stage_matched:
            # Commitment can never exceed the pool it is counted from, so the
            # marginal curve reads draft stage as well as colour fit. Hold the
            # stage and the shift is colour fit alone.
            cell = self.fit.get("by_stage", {}).get(self._stage_bucket(sum(pool.values())))
            if cell:
                conditioned, reference = cell.get(bucket), cell.get("*")
        if conditioned is None or reference is None:
            # No usable stage cell: fall back to the marginal curve rather than
            # to a cell too thin to report.
            conditioned, reference = row["by_commitment"].get(bucket), row.get("play_rate")
        if not conditioned or not reference:
            return 0.0
        clamp = lambda p: min(1 - 1e-6, max(1e-6, p))
        return logit(clamp(conditioned)) - logit(clamp(reference))

    def card_tendency(self, card: str, pack_number: int, pick_number: int,
                      pool: Mapping[str, int]) -> float:
        base = self.base_tendency(card, pack_number, pick_number)
        variant = self.variant
        # The colour-commitment shift is defined even at an empty pool - bucket
        # "0" is a real estimate, not a missing one - so it is applied before
        # the pair term's empty-pool short circuit.
        fit_shift = variant.fit_strength * self.fit_shift(card, pool) if variant.deck_fit else 0.0
        if not variant.context or not pool:
            return logistic(logit(base) + fit_shift) if fit_shift else base

        weighted_lift = 0.0
        total_weight = 0.0
        possible_weight = 0.0
        for pool_card, copies in pool.items():
            copies_weight = copy_weight(copies)
            possible_weight += copies_weight
            key = (card, pool_card)
            seen = self._count("pair_seen", key)
            if seen < variant.pair_min_seen:
                continue
            picked = self._count("pair_picked", key)
            if variant.stage_matched:
                # The pair counts pool every pack/pick position the pair was seen
                # at, so comparing them to a position-specific base measures draft
                # stage as well as pool effect. Anchor on the base rate expected
                # over exactly those observations instead.
                reference = self.pair_expected.get(key)
                if reference is None:
                    continue
                reference = min(1 - 1e-6, max(1e-6, reference / seen))
            else:
                reference = base
            pair_rate = (picked + variant.pair_prior_strength * reference) / (seen + variant.pair_prior_strength)
            lift = logit(pair_rate) - logit(reference)
            weight = min(1.0, math.sqrt(seen / 80.0)) * copies_weight
            weighted_lift += lift * weight
            total_weight += weight

        if not total_weight:
            return logistic(logit(base) + fit_shift) if fit_shift else base

        context = weighted_lift / total_weight
        pool_commitment = min(1.0, sum(pool.values()) / 8.0)
        scale = variant.context_strength * pool_commitment
        if variant.coverage and possible_weight > 0:
            # How much of this pool actually carries usable pair evidence.
            # Numerator and denominator both carry the duplicate-copy weight.
            scale *= min(1.0, total_weight / possible_weight)
        return logistic(logit(base) + scale * context + fit_shift)


def behaviour_support(model: VariantModel, card: str, pack: int, pick: int) -> int:
    """Observations behind the behaviour model's estimate FOR THIS decision.

    base_tendency falls back exact position -> pack -> global, so the evidence
    that matters is the count at the level it actually used. A card seen five
    thousand times across the format can still rest on a handful of observations
    at this exact pick, and a global count would call that certain.

    The thresholds here mirror base_tendency's and have to move with it.
    """
    exact = model._count("exact_seen", (card, pack, pick))
    if exact >= 20:
        return exact
    pack_seen = model._count("pack_seen", (card, pack))
    if pack_seen >= 30:
        return pack_seen
    return model._count("global_seen", card)


# Bucket edges sit around the observed median (161 on hob at cap 5,000), so the
# thin and the well-supported land on opposite sides of it rather than all in
# one bucket.
EVIDENCE_BUCKETS = ((0, 24, "evidence 0-24"), (25, 79, "evidence 25-79"),
                    (80, 159, "evidence 80-159"), (160, 399, "evidence 160-399"),
                    (400, 10 ** 12, "evidence 400+"))


def evidence_bucket(count: int) -> str:
    for low, high, name in EVIDENCE_BUCKETS:
        if low <= count <= high:
            return name
    return EVIDENCE_BUCKETS[-1][2]


def train_counts(cache: Cache, draft_ids: Sequence[str]) -> Tuple[CountStore, int]:
    wanted = set(draft_ids)
    counts = CountStore.empty()
    used = 0
    for draft_id, example in cache.examples():
        if draft_id in wanted:
            counts.observe(example)
            used += 1
    return counts, used


def pair_expectations(cache: Cache, draft_ids: Sequence[str],
                      counts: CountStore) -> Dict[Tuple[str, str], float]:
    """Sum of the base tendency over exactly the observations behind pair_seen.

    Second pass, because the base tendencies it sums are only defined once the
    first pass has finished counting.
    """
    wanted = set(draft_ids)
    model = OutOfFoldModel(counts, CountStore.empty())
    memo: Dict[Tuple[str, int, int], float] = {}
    totals: Dict[Tuple[str, str], float] = defaultdict(float)
    for draft_id, example in cache.examples():
        if draft_id not in wanted or not example.pool:
            continue
        pool_cards = tuple(example.pool)
        for card in example.candidates:
            key = (card, example.raw_pack_number, example.raw_pick_number)
            base = memo.get(key)
            if base is None:
                base = model.base_tendency(card, example.raw_pack_number, example.raw_pick_number)
                memo[key] = base
            for pool_card in pool_cards:
                totals[(card, pool_card)] += base
    return dict(totals)


# --------------------------------------------------------------------------
# metrics
# --------------------------------------------------------------------------

@dataclass
class Accumulator:
    """Streaming sums for one breakout cell."""
    n: int = 0
    log_loss: float = 0.0
    log_loss_sq: float = 0.0
    brier: float = 0.0
    top1: int = 0
    reciprocal_rank: float = 0.0
    rank: int = 0
    candidates: int = 0

    def add(self, log_loss: float, brier: float, hit: bool, rank: int, candidates: int) -> None:
        self.n += 1
        self.log_loss += log_loss
        self.log_loss_sq += log_loss * log_loss
        self.brier += brier
        self.top1 += 1 if hit else 0
        self.reciprocal_rank += 1.0 / rank
        self.rank += rank
        self.candidates += candidates

    def summary(self) -> dict:
        if not self.n:
            return {"n": 0}
        mean = self.log_loss / self.n
        variance = max(0.0, self.log_loss_sq / self.n - mean * mean)
        return {
            "n": self.n,
            "log_loss": round(mean, 5),
            "log_loss_stderr": round(math.sqrt(variance / self.n), 5),
            "brier": round(self.brier / self.n, 5),
            "top1_accuracy": round(self.top1 / self.n, 5),
            "mean_reciprocal_rank": round(self.reciprocal_rank / self.n, 5),
            "mean_rank": round(self.rank / self.n, 4),
            "mean_candidates": round(self.candidates / self.n, 3),
        }


@dataclass
class Calibration:
    """Two diagnostics, because they answer different questions.

    confidence: is the model's top pick right as often as it claims?
    per_card:   over every card it scores, does probability p happen p of the time?
    """
    bins: int = 10
    confidence_weight: List[float] = field(default_factory=lambda: [0.0] * 10)
    confidence_hits: List[float] = field(default_factory=lambda: [0.0] * 10)
    confidence_n: List[int] = field(default_factory=lambda: [0] * 10)
    card_weight: List[float] = field(default_factory=lambda: [0.0] * 10)
    card_hits: List[float] = field(default_factory=lambda: [0.0] * 10)
    card_n: List[int] = field(default_factory=lambda: [0] * 10)

    def _bin(self, probability: float) -> int:
        return min(self.bins - 1, max(0, int(probability * self.bins)))

    def add(self, probabilities: Sequence[float], chosen: int) -> None:
        top = max(range(len(probabilities)), key=lambda i: probabilities[i])
        slot = self._bin(probabilities[top])
        self.confidence_weight[slot] += probabilities[top]
        self.confidence_hits[slot] += 1.0 if top == chosen else 0.0
        self.confidence_n[slot] += 1
        for index, probability in enumerate(probabilities):
            slot = self._bin(probability)
            self.card_weight[slot] += probability
            self.card_hits[slot] += 1.0 if index == chosen else 0.0
            self.card_n[slot] += 1

    @staticmethod
    def _error(weight: List[float], hits: List[float], counts: List[int]) -> Tuple[float, List[dict]]:
        total = sum(counts)
        error = 0.0
        table = []
        for index, count in enumerate(counts):
            if not count:
                continue
            predicted = weight[index] / count
            observed = hits[index] / count
            error += (count / total) * abs(predicted - observed)
            table.append({"bin": round(index / len(counts), 2), "n": count,
                          "predicted": round(predicted, 5), "observed": round(observed, 5)})
        return error, table

    def summary(self) -> dict:
        confidence_error, confidence_table = self._error(
            self.confidence_weight, self.confidence_hits, self.confidence_n)
        card_error, card_table = self._error(self.card_weight, self.card_hits, self.card_n)
        return {
            "confidence_ece": round(confidence_error, 5),
            "per_card_ece": round(card_error, 5),
            "confidence_bins": confidence_table,
            "per_card_bins": card_table,
        }


@dataclass
class GradingStats:
    """What the scoring formula would do. Reported beside prediction, never inside it.

    trophy_below_leader is a disagreement rate, not an error rate; severity is
    what decides whether a disagreement costs a player real points.
    """
    n: int = 0
    chosen_is_leader: int = 0
    support_ratio: float = 0.0
    below_fifth: int = 0
    below_half: int = 0
    displayed_scores: Counter = field(default_factory=Counter)

    def add(self, probabilities: Sequence[float], chosen: int) -> None:
        leader = max(probabilities)
        if leader <= 0:
            return
        ratio = probabilities[chosen] / leader
        self.n += 1
        self.chosen_is_leader += 1 if probabilities[chosen] >= leader else 0
        self.support_ratio += ratio
        self.below_fifth += 1 if ratio < 0.2 else 0
        self.below_half += 1 if ratio < 0.5 else 0
        self.displayed_scores[min(100, round(95 * ratio))] += 1

    def summary(self) -> dict:
        if not self.n:
            return {"n": 0}
        return {
            "n": self.n,
            "historical_pick_is_leader": round(self.chosen_is_leader / self.n, 5),
            "historical_below_leader": round(1 - self.chosen_is_leader / self.n, 5),
            "mean_support_ratio": round(self.support_ratio / self.n, 5),
            "below_one_fifth_of_leader": round(self.below_fifth / self.n, 5),
            "below_half_of_leader": round(self.below_half / self.n, 5),
            "median_displayed_score": _median_from_counter(self.displayed_scores),
        }


def _median_from_counter(counter: Counter) -> Optional[int]:
    total = sum(counter.values())
    if not total:
        return None
    seen = 0
    for value in sorted(counter):
        seen += counter[value]
        if seen * 2 >= total:
            return value
    return None


def pick_metrics(probabilities: Sequence[float], chosen: int) -> Tuple[float, float, bool, int]:
    probability = max(1e-12, probabilities[chosen])
    brier = sum((p - (1.0 if i == chosen else 0.0)) ** 2 for i, p in enumerate(probabilities))
    better = sum(1 for i, p in enumerate(probabilities)
                 if p > probabilities[chosen] or (p == probabilities[chosen] and i < chosen))
    return -math.log(probability), brier, better == 0, better + 1


# --------------------------------------------------------------------------
# evaluation
# --------------------------------------------------------------------------

def rarity_index() -> Dict[str, str]:
    """Card rarity from files already in the repo. No network, no new dependency."""
    rarities: Dict[str, str] = {}
    images = ROOT / "corpus/draft-run/card-images.json"
    if images.exists():
        for record in json.loads(images.read_text(encoding="utf-8")).values():
            if isinstance(record, dict) and record.get("name") and record.get("rarity"):
                rarities[record["name"]] = record["rarity"]
    for shard in sorted((ROOT / "data").glob("*/shards/*.json")):
        try:
            payload = json.loads(shard.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        for replay in payload.get("replays", []):
            for pick in replay.get("picks", []):
                for card in pick.get("candidates", []):
                    if card.get("name") and card.get("rarity"):
                        rarities.setdefault(card["name"], card["rarity"])
    for corpus in sorted((ROOT / "corpus/draft-run").glob("*.json.gz")):
        try:
            rows = json.loads(gzip.decompress(corpus.read_bytes()))
        except (ValueError, OSError):
            continue
        for puzzle in rows:
            for card in puzzle.get("candidates", []) + puzzle.get("prior_picks", []):
                if card.get("name") and card.get("rarity"):
                    rarities.setdefault(card["name"], card["rarity"])
    return rarities


def pool_bucket(size: int) -> str:
    if size == 0:
        return "pool 0"
    if size <= 2:
        return "pool 1-2"
    if size <= 5:
        return "pool 3-5"
    if size <= 10:
        return "pool 6-10"
    return "pool 11+"


def load_examples(cache: Cache, draft_ids: Sequence[str]) -> List[PickExample]:
    wanted = set(draft_ids)
    return [example for draft_id, example in cache.examples() if draft_id in wanted]


def evaluate(cache: Cache, variant: Variant, model: "VariantModel",
             test_examples: Sequence[PickExample], rarities: Mapping[str, str],
             served_max_pick: int, train_drafts: int, training_picks: int,
             test_drafts: int) -> dict:
    pack_offset = cache.meta["pack_offset"]
    pick_offset = cache.meta["pick_offset"]

    overall = Accumulator()
    served = Accumulator()
    calibration = Calibration()
    served_calibration = Calibration()
    grading = GradingStats()
    served_grading = GradingStats()
    cells: Dict[str, Dict[str, Accumulator]] = {
        "rarity": defaultdict(Accumulator),
        "pick": defaultdict(Accumulator),
        "pool": defaultdict(Accumulator),
        "pack": defaultdict(Accumulator),
        # "pick" pools a position across all three packs, so it cannot cut the
        # served slice, which is pack 1 only. This one can.
        "served_pick": defaultdict(Accumulator),
        # How much behavioural evidence stood behind this decision. If a context
        # or outcome correction only helps where the strong-player counts are
        # thin, that says where it belongs rather than that it belongs
        # everywhere.
        "evidence": defaultdict(Accumulator),
    }
    per_example: List[Tuple[str, float, float, int]] = []
    # The game only ever serves pack 1, so a change is worth making on the
    # strength of this slice, not of the whole draft. Kept separately because a
    # paired bootstrap over all picks answers a question nobody is asking.
    served_per_example: List[Tuple[str, float, float, int]] = []

    for example in test_examples:
        raw = {card: model.card_tendency(card, example.raw_pack_number,
                                         example.raw_pick_number, example.pool)
               for card in example.candidates}
        probabilities_by_card = normalize_probabilities(sharpen(raw, variant.temperature))
        probabilities = [probabilities_by_card[card] for card in example.candidates]
        chosen = example.candidates.index(example.historical_pick)
        log_loss, brier, hit, rank = pick_metrics(probabilities, chosen)

        overall.add(log_loss, brier, hit, rank, len(probabilities))
        calibration.add(probabilities, chosen)
        grading.add(probabilities, chosen)
        per_example.append((example.draft_id, log_loss, brier, 1 if hit else 0))

        pack_number = example.raw_pack_number + pack_offset
        pick_number = example.raw_pick_number + pick_offset
        cells["pack"][f"pack {pack_number}"].add(log_loss, brier, hit, rank, len(probabilities))
        cells["pick"][f"pick {pick_number:02d}"].add(log_loss, brier, hit, rank, len(probabilities))
        cells["pool"][pool_bucket(sum(example.pool.values()))].add(
            log_loss, brier, hit, rank, len(probabilities))
        cells["rarity"][rarities.get(example.historical_pick, "unknown")].add(
            log_loss, brier, hit, rank, len(probabilities))

        # Evidence behind the pack, not behind one card: the decision is only as
        # well supported as its thinnest plausible alternative is, so the median
        # candidate is the honest summary of what the model had to work with.
        support = sorted(behaviour_support(model, card, example.raw_pack_number,
                                           example.raw_pick_number)
                         for card in example.candidates)
        cells["evidence"][evidence_bucket(support[len(support) // 2])].add(
            log_loss, brier, hit, rank, len(probabilities))

        if pack_number == 1 and pick_number <= served_max_pick:
            served.add(log_loss, brier, hit, rank, len(probabilities))
            served_calibration.add(probabilities, chosen)
            served_grading.add(probabilities, chosen)
            served_per_example.append((example.draft_id, log_loss, brier, 1 if hit else 0))
            cells["served_pick"][f"served pick {pick_number:02d}"].add(
                log_loss, brier, hit, rank, len(probabilities))

    return {
        "variant": variant.describe(),
        "set_id": cache.set_id,
        "train_drafts": train_drafts,
        "training_picks": training_picks,
        "test_drafts": test_drafts,
        "distinct_pairs": len(model.all.pair_seen),
        "overall": overall.summary(),
        "served_slice": served.summary(),
        "served_definition": f"pack 1, picks 1-{served_max_pick}",
        "calibration": calibration.summary(),
        "served_calibration": served_calibration.summary(),
        "grading": grading.summary(),
        "served_grading": served_grading.summary(),
        "breakouts": {name: {key: cell.summary() for key, cell in sorted(group.items())}
                      for name, group in cells.items()},
        "_per_example": per_example,
        "_served_per_example": served_per_example,
    }


def paired_bootstrap(baseline: Sequence[Tuple[str, float, float, int]],
                     candidate: Sequence[Tuple[str, float, float, int]],
                     draws: int = 2000, seed: int = 20260915) -> dict:
    """Cluster bootstrap over drafts, on the examples both variants scored.

    Resampling drafts rather than picks keeps picks from the same draft
    together; they are not independent and treating them as such would make
    every interval look far tighter than it is.
    """
    if len(baseline) != len(candidate):
        raise ValueError("Paired bootstrap needs identical example sets.")
    by_draft: Dict[str, List[Tuple[float, float, int]]] = defaultdict(list)
    for (draft_id, base_loss, base_brier, base_hit), (_, cand_loss, cand_brier, cand_hit) in zip(baseline, candidate):
        by_draft[draft_id].append((cand_loss - base_loss, cand_brier - base_brier, cand_hit - base_hit))
    drafts = list(by_draft)
    if not drafts:
        return {}

    def means(sample: Sequence[str]) -> Tuple[float, float, float]:
        total = [0.0, 0.0, 0.0]
        n = 0
        for draft_id in sample:
            for loss, brier, hit in by_draft[draft_id]:
                total[0] += loss
                total[1] += brier
                total[2] += hit
                n += 1
        return (total[0] / n, total[1] / n, total[2] / n) if n else (0.0, 0.0, 0.0)

    observed = means(drafts)
    rng = random.Random(seed)
    samples = [means([drafts[rng.randrange(len(drafts))] for _ in drafts]) for _ in range(draws)]
    return {
        "drafts": len(drafts),
        "log_loss_delta": round(observed[0], 5),
        "log_loss_ci95": _interval([s[0] for s in samples]),
        "brier_delta": round(observed[1], 5),
        "brier_ci95": _interval([s[1] for s in samples]),
        "top1_delta": round(observed[2], 5),
        "top1_ci95": _interval([s[2] for s in samples]),
    }


def _interval(values: List[float]) -> List[float]:
    ordered = sorted(values)
    low = ordered[max(0, int(0.025 * len(ordered)) - 1)]
    high = ordered[min(len(ordered) - 1, int(0.975 * len(ordered)))]
    return [round(low, 5), round(high, 5)]


def significant(interval: Sequence[float]) -> bool:
    return interval[0] > 0 or interval[1] < 0


# --------------------------------------------------------------------------
# reporting
# --------------------------------------------------------------------------

def daily_weights() -> Dict[str, float]:
    """Daily set weights, read from the same policy file the worker uses."""
    policy = json.loads((ROOT / "data/selection-policy.json").read_text(encoding="utf-8"))
    order = policy["regular_sets_newest_first"]
    release = policy.get("release_dates", {})
    ranked = sorted([s for s in order if s in release],
                    key=lambda s: (release[s], s), reverse=True)
    weights: Dict[str, float] = {set_id: 1.0 for set_id in order}
    position = 0
    for tier in policy["daily_weight_tiers"]:
        for set_id in ranked[position:position + tier["count"]]:
            weights[set_id] = float(tier["weight"])
        position += tier["count"]
    return weights


def weighted_headline(results: Sequence[dict], slice_name: str) -> dict:
    """Aggregate across sets in proportion to how often the Daily serves them."""
    weights = daily_weights()
    totals = Counter()
    mass = 0.0
    covered = []
    for result in results:
        weight = weights.get(result["set_id"])
        summary = result[slice_name]
        if weight is None or not summary.get("n"):
            continue
        covered.append({"set_id": result["set_id"], "weight": weight, "n": summary["n"]})
        mass += weight
        for key in ("log_loss", "brier", "top1_accuracy", "mean_reciprocal_rank"):
            totals[key] += weight * summary[key]
    if not mass:
        return {"note": "no evaluated set carries a Daily weight"}
    return {"sets": covered, "total_weight": mass,
            **{key: round(value / mass, 5) for key, value in totals.items()}}


def format_table(rows: Sequence[Sequence[object]], headers: Sequence[str]) -> str:
    widths = [len(h) for h in headers]
    text = [[("" if c is None else str(c)) for c in row] for row in rows]
    for row in text:
        for index, cell in enumerate(row):
            widths[index] = max(widths[index], len(cell))
    line = "  ".join(h.ljust(widths[i]) for i, h in enumerate(headers))
    out = [line, "  ".join("-" * w for w in widths)]
    for row in text:
        out.append("  ".join(cell.ljust(widths[index]) for index, cell in enumerate(row)))
    return "\n".join(out)


def render(report: dict) -> str:
    out: List[str] = []
    out.append("=" * 78)
    out.append("PACK ONE MODEL EVALUATION")
    out.append("=" * 78)
    out.append(f"split: {report['split']}   bootstrap: cluster over drafts, {report['bootstrap_draws']} draws")
    for run in report["runs"]:
        out.append("")
        label = run['variant']['name'] if run['variant']['temperature'] == 1.0 else f"{run['variant']['name']}@T{run['variant']['temperature']:g}"
        out.append(f"--- {run['set_id']}  (cap {run['cap_label']}, variant {label}) ---")
        out.append(f"    train {run['train_drafts']} drafts / {run['training_picks']} picks"
                   f"    test {run['test_drafts']} drafts"
                   f"    distinct pairs {run['distinct_pairs']}")
        for label, key in (("all picks", "overall"), (run["served_definition"], "served_slice")):
            s = run[key]
            if not s.get("n"):
                continue
            out.append(f"    {label:<24} n={s['n']:<7} logloss={s['log_loss']:.4f}"
                       f" (SE {s['log_loss_stderr']:.4f})  brier={s['brier']:.4f}"
                       f"  top1={s['top1_accuracy']:.4f}  MRR={s['mean_reciprocal_rank']:.4f}")
    if report.get("comparisons"):
        out.append("")
        out.append("PAIRED COMPARISONS (negative log loss / Brier = better; positive top-1 = better)")
        rows = []
        for comparison in report["comparisons"]:
            delta = comparison["paired"]
            rows.append([
                comparison["set_id"], comparison["slice"],
                f"{comparison['baseline']} -> {comparison['candidate']}",
                f"{delta['log_loss_delta']:+.4f}",
                f"[{delta['log_loss_ci95'][0]:+.4f}, {delta['log_loss_ci95'][1]:+.4f}]",
                f"{delta['top1_delta']:+.4f}",
                "yes" if significant(delta["log_loss_ci95"]) else "no",
            ])
        out.append(format_table(rows, ["set", "slice", "comparison", "d(logloss)",
                                       "95% CI", "d(top1)", "separated"]))
    if report.get("daily_weighted"):
        out.append("")
        out.append("DAILY-WEIGHTED HEADLINE (served slice, weighted by Daily set exposure)")
        rows = []
        for key, value in report["daily_weighted"].items():
            if "note" in value:
                rows.append([key, value["note"], "", "", ""])
                continue
            rows.append([key, f"{value['log_loss']:.4f}", f"{value['brier']:.4f}",
                         f"{value['top1_accuracy']:.4f}", f"{value['total_weight']:.0f}"])
        out.append(format_table(rows, ["variant/cap", "logloss", "brier", "top1", "weight"]))
    return "\n".join(out)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def cap_prefix(train_ids: Sequence[str], cap: Optional[int]) -> List[str]:
    """Production ordering, so cap=5000 is a strict subset of cap=10000."""
    return list(train_ids[:cap]) if cap else list(train_ids)


def run_extract(args: argparse.Namespace) -> int:
    summary = extract(Path(args.archive), args.set_id, Path(args.cache),
                      args.minimum_games, args.top_fraction, args.cohort, args.max_drafts)
    print(json.dumps(summary, indent=2))
    return 0


def run_evaluate(args: argparse.Namespace) -> int:
    rarities = rarity_index()
    caps: List[Optional[int]] = [None if c in ("all", "0") else int(c) for c in args.caps.split(",")]
    for name in args.variants.split(","):
        if name not in VARIANTS:
            raise SystemExit(f"Unknown variant '{name}'. Known: {', '.join(VARIANTS)}")
    temperatures = [float(t) for t in args.temperatures.split(",")]
    variants = [replace(VARIANTS[name], temperature=temperature)
                for name in args.variants.split(",") for temperature in temperatures]

    runs: List[dict] = []
    comparisons: List[dict] = []
    needs_expectations = any(v.stage_matched for v in variants)
    needs_fit = any(v.deck_fit for v in variants)
    fit_dir = Path(args.deck_fit_dir) if args.deck_fit_dir else None
    if needs_fit and not fit_dir:
        raise SystemExit("--deck-fit-dir is required by the deck-fit variants")
    for cache_path in args.caches:
        cache = Cache.load(Path(cache_path))
        fit = None
        if needs_fit:
            fit_path = fit_dir / f"{cache.set_id}.json"
            if not fit_path.exists():
                raise SystemExit(f"No deck-fit table for {cache.set_id} at {fit_path}")
            fit = json.loads(fit_path.read_text(encoding="utf-8"))
        train_pool = cache.split_drafts("train")
        # Capping the held-out set trades interval width for sweep time. The
        # cap takes a prefix of the split's own stable order, so the same drafts
        # are held out for every variant and every set at a given cap.
        test_ids = cap_prefix(cache.split_drafts(args.split), args.max_test_drafts)
        served_max = 11 if cache.set_id == "powered-cube" else 10
        print(f"{cache.set_id}: loading {len(test_ids)} {args.split} drafts",
              file=sys.stderr, flush=True)
        test_examples = load_examples(cache, test_ids)
        by_key: Dict[Tuple[str, str], dict] = {}
        for cap in caps:
            train_ids = cap_prefix(train_pool, cap)
            cap_label = str(cap) if cap else f"all ({len(train_ids)})"
            # Counts and stage expectations depend only on the cap, so build
            # them once and let every variant at this cap share them.
            counts, training_picks = train_counts(cache, train_ids)
            expectations = pair_expectations(cache, train_ids, counts) if needs_expectations else None
            for variant in variants:
                model = VariantModel(counts, variant,
                                     expectations if variant.stage_matched else None,
                                     fit if variant.deck_fit else None)
                result = evaluate(cache, variant, model, test_examples, rarities,
                                  served_max, len(train_ids), training_picks, len(test_ids))
                result["cap"] = cap
                result["cap_label"] = cap_label
                by_key[(cap_label, variant.labelled())] = result
                runs.append(result)
                print(f"  scored {cache.set_id} cap={cap_label} variant={variant.name}"
                      f" logloss={result['overall']['log_loss']:.4f}", file=sys.stderr, flush=True)

        baseline_cap = str(caps[0]) if caps[0] else f"all ({len(cap_prefix(train_pool, caps[0]))})"
        baseline_key = (baseline_cap, variants[0].labelled())
        for key, result in by_key.items():
            if key == baseline_key:
                continue
            base = by_key[baseline_key]
            for slice_name, field in (("all picks", "_per_example"),
                                      (f"served (pack 1, picks 1-{served_max})",
                                       "_served_per_example")):
                comparisons.append({
                    "set_id": cache.set_id,
                    "slice": slice_name,
                    "baseline": f"{baseline_key[1]}@{baseline_key[0]}",
                    "candidate": f"{key[1]}@{key[0]}",
                    "paired": paired_bootstrap(base[field], result[field],
                                               args.bootstrap_draws),
                })

    # Group by the requested cap, not its per-set label: "all" resolves to a
    # different size in every set and must still aggregate as one row.
    daily = {}
    for cap in caps:
        cap_name = str(cap) if cap else "all eligible"
        for variant in variants:
            selected = [r for r in runs if r["cap"] == cap
                        and r["variant"]["name"] == variant.name
                        and r["variant"]["temperature"] == variant.temperature]
            if selected:
                daily[f"{variant.labelled()} @ cap {cap_name}"] = weighted_headline(selected, "served_slice")

    for run in runs:
        run.pop("_per_example", None)
        run.pop("_served_per_example", None)
    report = {
        "split": f"train {TRAIN_SHARE}% / validation {VALIDATION_SHARE}% / test {100 - TRAIN_SHARE - VALIDATION_SHARE}% by draft_id",
        "evaluated_split": args.split,
        "bootstrap_draws": args.bootstrap_draws,
        "runs": runs,
        "comparisons": comparisons,
        "daily_weighted": daily,
    }
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(render(report))
    return 0


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    extract_parser = sub.add_parser("extract", help="Archive -> cached eligible cohort")
    extract_parser.add_argument("--archive", required=True)
    extract_parser.add_argument("--set-id", required=True)
    extract_parser.add_argument("--cache", required=True)
    extract_parser.add_argument("--minimum-games", type=int, default=100)
    extract_parser.add_argument("--top-fraction", type=float, default=0.15)
    extract_parser.add_argument("--cohort", default="elite", choices=["elite", "control"],
                                help="elite: the drafters production trains on. "
                                     "control: equally experienced drafters below the same cutoff")
    extract_parser.add_argument("--max-drafts", type=int,
                                help="cap the extracted cohort (control caches only need a sample)")
    extract_parser.set_defaults(func=run_extract)

    evaluate_parser = sub.add_parser("evaluate", help="Score variants on held-out drafts")
    evaluate_parser.add_argument("caches", nargs="+")
    evaluate_parser.add_argument("--variants", default="v2")
    evaluate_parser.add_argument("--caps", default="5000",
                                 help="comma-separated training caps; 'all' for uncapped")
    evaluate_parser.add_argument("--temperatures", default="1.0",
                                 help="comma-separated exponents applied to tendencies before "
                                      "normalising; 1.0 is production")
    # Defaults to validation, not test. Choosing a variant while reading the
    # test split turns it into more validation data, and nothing afterwards can
    # undo that. Reaching for test has to be a thing someone typed.
    evaluate_parser.add_argument("--split", default="validation",
                                 choices=["validation", "test"],
                                 help="held-out split to score (default: validation; "
                                      "pass test only for a frozen specification)")
    evaluate_parser.add_argument("--max-test-drafts", type=int,
                                 help="cap the held-out drafts per set (default: all)")
    evaluate_parser.add_argument("--deck-fit-dir",
                                 help="directory of per-set deck_fit.py tables, named <set>.json")
    evaluate_parser.add_argument("--bootstrap-draws", type=int, default=2000)
    evaluate_parser.add_argument("--json-out")
    evaluate_parser.set_defaults(func=run_evaluate)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
