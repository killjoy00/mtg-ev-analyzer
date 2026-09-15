#!/usr/bin/env python3
"""A pick-value model that weighs its evidence instead of assuming it.

Two independent signals say what a good pick is, and neither should be taken on
faith:

  BEHAVIOUR  what strong players take, in context (pool, pack, pick). Enormous
             volume and very little noise per observation, but it is imitation:
             whatever the consensus gets wrong, it gets wrong confidently.

  OUTCOME    what actually raised the win rate, measured by IWD from game data -
             the same decks split by whether the card was drawn, so deck quality
             cancels. Directly about winning, but noisier and blind to context:
             it cannot know a card is uncastable in your colours.

They are combined per decision, both standardised across the cards in the pack so
they are on one scale:

    value(card) = (1 - w) * z(behaviour) + w * z(outcome)

w is not chosen. It is fitted against an outcome the model never sees: whether a
drafter who gave up less value actually won more matches, measured WITHIN a
win-rate bucket so that "strong players both pick well and win" cannot manufacture
the result. w = 0 is today's model; w = 1 ignores behaviour entirely.

Reads caches and JSON on disk. No database, no served corpus.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_replays import logit, normalize_probabilities, open_text  # noqa: E402
from deck_fit import COLOURS, commit_bucket, commitment  # noqa: E402
from eval_model import (  # noqa: E402
    VARIANTS,
    Cache,
    VariantModel,
    load_examples,
    train_counts,
)

EPSILON = 1e-9


# --------------------------------------------------------------------------
# draft outcomes
# --------------------------------------------------------------------------

def draft_results(archive: Path) -> Dict[str, dict]:
    """draft_id -> match wins and skill, from a cheap scan of the draft archive.

    Match wins are the criterion the weighting is fitted against; the skill
    bucket is what it has to be controlled for.
    """
    results: Dict[str, dict] = {}
    with open_text(archive) as handle:
        reader = csv.reader(handle)
        header = next(reader)
        index = {name: position for position, name in enumerate(header)}
        for required in ("draft_id", "event_match_wins", "user_game_win_rate_bucket"):
            if required not in index:
                raise ValueError(f"draft archive has no {required} column")
        draft_at = index["draft_id"]
        wins_at = index["event_match_wins"]
        rate_at = index["user_game_win_rate_bucket"]
        for values in reader:
            if len(values) != len(header):
                continue
            draft_id = values[draft_at].strip()
            if not draft_id or draft_id in results:
                continue
            try:
                wins = int(float(values[wins_at]))
            except (TypeError, ValueError):
                continue
            results[draft_id] = {"wins": wins, "skill": values[rate_at].strip()}
    return results


# --------------------------------------------------------------------------
# combined value
# --------------------------------------------------------------------------

def standardise(values: Sequence[float]) -> List[float]:
    """z-scores within one pack; a pack where everything ties contributes nothing."""
    if len(values) < 2:
        return [0.0] * len(values)
    mean = statistics.fmean(values)
    spread = statistics.pstdev(values)
    if spread <= EPSILON:
        return [0.0] * len(values)
    return [(value - mean) / spread for value in values]


class OutcomeAxis:
    """Card impact, optionally weighted by whether the card reaches the deck.

    Raw IWD is context-free and reverses a pool-aware model's judgement at later
    picks. Multiplying by the measured probability that the card is played from
    this pool restores the context: a bomb you cannot cast is worth little, and a
    weak card you certainly will play is worth less than nothing.
    """

    def __init__(self, impact: Dict[str, float], fit: Optional[dict] = None):
        self.impact = impact
        self.fit = fit
        self.colours: Dict[str, frozenset] = {}
        if fit:
            for card, row in fit["cards"].items():
                letters = row.get("colours") or "C"
                self.colours[card] = frozenset(c for c in letters if c in COLOURS)

    @property
    def context_aware(self) -> bool:
        return self.fit is not None

    def value(self, card: str, pool: Dict[str, int]) -> Optional[float]:
        impact = self.impact.get(card)
        if impact is None:
            return None
        if not self.fit:
            return impact
        row = self.fit["cards"].get(card)
        if row is None:
            return None
        bucket = commit_bucket(commitment(pool, self.colours, card))
        played = row["by_commitment"].get(bucket, row["play_rate"])
        return played * impact


def behaviour_support(model: VariantModel, card: str) -> int:
    """How many times the behaviour model has actually seen this card offered."""
    return model._count("global_seen", card)


def decision_values(model: VariantModel, example, outcome: OutcomeAxis,
                    weights: Sequence[float],
                    adaptive: bool = False) -> Optional[Dict[float, Tuple[float, float]]]:
    """For each weight, (value of the taken card, value of the best available).

    A card with no outcome measurement contributes 0 on that axis rather than
    being dropped: dropping it would silently change which cards are comparable.
    """
    cards = example.candidates
    if len(cards) < 2:
        return None
    raw = {card: model.card_tendency(card, example.raw_pack_number,
                                     example.raw_pick_number, example.pool)
           for card in cards}
    support = normalize_probabilities(raw)
    behaviour = standardise([logit(support[card]) for card in cards])
    measured = [outcome.value(card, example.pool) for card in cards]
    known = [value for value in measured if value is not None]
    if len(known) < 2:
        return None
    mean = statistics.fmean(known)
    spread = statistics.pstdev(known)
    if spread <= EPSILON:
        outcome_z = [0.0] * len(cards)
    else:
        outcome_z = [((value - mean) / spread) if value is not None else 0.0
                     for value in measured]

    taken = cards.index(example.historical_pick)
    support = [behaviour_support(model, card) for card in cards] if adaptive else None
    out: Dict[float, Tuple[float, float]] = {}
    for weight in weights:
        if adaptive:
            # Weight each source by how much evidence it has for THIS card. A
            # card the behaviour model has barely seen leans on the outcome
            # measurement; a card it has seen thousands of times does not. The
            # swept value is the crossover point, in observations.
            per_card = [weight / (weight + count) if (weight + count) > 0 else 0.0
                        for count in support]
        else:
            per_card = [weight] * len(cards)
        values = [(1 - per_card[i]) * behaviour[i] + per_card[i] * outcome_z[i]
                  for i in range(len(cards))]
        out[weight] = (values[taken], max(values))
    return out


def draft_regret(model: VariantModel, cache: Cache, draft_ids: Sequence[str],
                 outcome: OutcomeAxis, weights: Sequence[float],
                 max_pick: int, all_picks: bool = False,
                 pick_range: Optional[Tuple[int, int]] = None,
                 adaptive: bool = False) -> Dict[str, Dict[float, float]]:
    """Mean value given up per decision, per draft, for each weight.

    Fitting uses every pick in the draft by default rather than only the ten the
    product serves: averaging over forty-odd decisions instead of ten roughly
    halves the noise in each draft's regret, and it is the card-value model being
    fitted here, not the serving policy.
    """
    pack_offset = cache.meta["pack_offset"]
    pick_offset = cache.meta["pick_offset"]
    totals: Dict[str, Dict[float, List[float]]] = defaultdict(lambda: defaultdict(list))
    for example in load_examples(cache, draft_ids):
        pick_number = example.raw_pick_number + pick_offset
        if pick_range is not None:
            # Isolating a band of pick numbers isolates pool size, which is what
            # a context-free signal should struggle with.
            if example.raw_pack_number + pack_offset != 1:
                continue
            if not pick_range[0] <= pick_number <= pick_range[1]:
                continue
        elif not all_picks:
            if example.raw_pack_number + pack_offset != 1:
                continue
            if pick_number > max_pick:
                continue
        values = decision_values(model, example, outcome, weights, adaptive)
        if values is None:
            continue
        for weight, (taken, best) in values.items():
            totals[example.draft_id][weight].append(best - taken)
    return {draft_id: {weight: statistics.fmean(gaps) for weight, gaps in per_weight.items()}
            for draft_id, per_weight in totals.items() if per_weight}


# --------------------------------------------------------------------------
# fitting the weight against held-out match outcomes
# --------------------------------------------------------------------------

def pearson(xs: Sequence[float], ys: Sequence[float]) -> Optional[float]:
    if len(xs) < 3:
        return None
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if sx <= EPSILON or sy <= EPSILON:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)


def within_skill_correlation(regret: Dict[str, float],
                             results: Dict[str, dict],
                             minimum_bucket: int = 200) -> Optional[dict]:
    """Correlation of regret with match wins, pooled across win-rate buckets.

    Pooling Fisher-z within buckets is what controls for skill. Correlating
    across the whole population instead would mostly rediscover that strong
    players win more, which says nothing about whether the model is right.
    """
    buckets: Dict[str, List[Tuple[float, float]]] = defaultdict(list)
    for draft_id, value in regret.items():
        record = results.get(draft_id)
        if record is None:
            continue
        buckets[record["skill"]].append((value, float(record["wins"])))

    weighted, total = 0.0, 0
    used = 0
    for rows in buckets.values():
        if len(rows) < minimum_bucket:
            continue
        r = pearson([row[0] for row in rows], [row[1] for row in rows])
        if r is None or abs(r) >= 1:
            continue
        # Fisher z so correlations from buckets of different size combine properly.
        weighted += (len(rows) - 3) * 0.5 * math.log((1 + r) / (1 - r))
        total += len(rows) - 3
        used += 1
    if not total:
        return None
    z = weighted / total
    return {"r": round((math.exp(2 * z) - 1) / (math.exp(2 * z) + 1), 5),
            "buckets": used, "drafts": total + 3 * used}


def bootstrap_r(regret: Dict[str, float], results: Dict[str, dict],
                draws: int, seed: int = 20260917) -> List[float]:
    """Resample drafts; recompute the within-skill pooled correlation each time."""
    import random
    rng = random.Random(seed)
    ids = list(regret)
    out = []
    for _ in range(draws):
        sample = [ids[rng.randrange(len(ids))] for _ in ids]
        resampled = {}
        for position, draft_id in enumerate(sample):
            resampled[f"{draft_id}#{position}"] = regret[draft_id]
        expanded = {f"{draft_id}#{position}": results[draft_id]
                    for position, draft_id in enumerate(sample) if draft_id in results}
        value = within_skill_correlation(
            {k: v for k, v in resampled.items() if k in expanded}, expanded, minimum_bucket=50)
        if value:
            out.append(value["r"])
    return out


def analyse(elite_cache: Path, archive: Path, outcomes: Path,
            weights: Sequence[float], cap: Optional[int],
            control_cache: Optional[Path] = None, draws: int = 400,
            all_picks: bool = False,
            pick_range: Optional[Tuple[int, int]] = None,
            deck_fit: Optional[Path] = None, adaptive: bool = False) -> dict:
    cache = Cache.load(elite_cache)
    max_pick = 11 if cache.set_id == "powered-cube" else 10

    payload = json.loads(outcomes.read_text(encoding="utf-8"))
    impact = {name: row["iwd_shrunk"] for name, row in payload["cards"].items()
              if row.get("iwd_shrunk") is not None}
    fit = json.loads(deck_fit.read_text(encoding="utf-8")) if deck_fit else None
    outcome = OutcomeAxis(impact, fit)

    train_ids = cache.split_drafts("train")
    if cap:
        train_ids = train_ids[:cap]
    counts, training_picks = train_counts(cache, train_ids)
    model = VariantModel(counts, VARIANTS["v2"])

    # The elite training split is the only data the model saw. Everything else -
    # the elite hold-out AND the whole control cohort - is fair game, and the
    # control cohort is what gives the skill axis enough spread to correlate on.
    held_out = cache.split_drafts("validation") + cache.split_drafts("test")
    regrets = draft_regret(model, cache, held_out, outcome, weights, max_pick,
                           all_picks, pick_range, adaptive)
    if control_cache is not None:
        control = Cache.load(control_cache)
        if control.set_id != cache.set_id:
            raise SystemExit(f"{control_cache} is a different set from {elite_cache}")
        regrets.update(draft_regret(model, control, control.meta["drafts"],
                                    outcome, weights, max_pick, all_picks, pick_range, adaptive))
    results = draft_results(archive)

    rows = []
    baseline_samples: List[float] = []
    for weight in weights:
        per_draft = {draft_id: values[weight] for draft_id, values in regrets.items()
                     if weight in values}
        correlation = within_skill_correlation(per_draft, results)
        samples = bootstrap_r(per_draft, results, draws) if correlation else []
        if weight == weights[0]:
            baseline_samples = samples
        ordered = sorted(samples)
        rows.append({
            "weight_on_outcome": weight,
            "within_skill_r": correlation["r"] if correlation else None,
            "r_ci95": [round(ordered[max(0, int(0.025 * len(ordered)) - 1)], 5),
                       round(ordered[min(len(ordered) - 1, int(0.975 * len(ordered)))], 5)]
            if ordered else None,
            "skill_buckets": correlation["buckets"] if correlation else 0,
            "drafts": correlation["drafts"] if correlation else 0,
            "mean_regret": round(statistics.fmean(per_draft.values()), 5) if per_draft else None,
        })
    return {
        "set_id": cache.set_id,
        "train_drafts": len(train_ids),
        "training_picks": training_picks,
        "held_out_drafts": len(regrets),
        "cards_with_outcome": len(impact),
        "outcome_axis": "play-weighted impact" if outcome.context_aware else "raw impact",
        "weighting": "per-card by evidence" if adaptive else "fixed",
        "scored_picks": f"pack 1, picks {pick_range[0]}-{pick_range[1]}" if pick_range
        else "every pick in the draft" if all_picks
        else f"pack 1, picks 1-{max_pick}",
        "weights": rows,
    }


def render(report: dict) -> str:
    out = ["=" * 76,
           "HOW MUCH SHOULD EACH SIGNAL COUNT?",
           "=" * 76,
           "Value given up per decision, correlated with the drafter's match wins,",
           "WITHIN win-rate bucket. More negative is better: giving up less value",
           "should mean winning more. w=0 is today's behaviour-only model.", ""]
    for entry in report["sets"]:
        out.append(f"--- {entry['set_id']} --- {entry['held_out_drafts']} held-out drafts, "
                   f"{entry['cards_with_outcome']} cards measured, "
                   f"outcome axis: {entry.get('outcome_axis', 'raw impact')}")
        label = "crossover n" if entry.get("weighting") == "per-card by evidence" else "w(outcome)"
        out.append(f"  {label:>11}{'within-skill r':>16}{'95% CI':>22}"
                   f"{'drafts':>9}{'buckets':>9}")
        usable = [row for row in entry["weights"] if row["within_skill_r"] is not None]
        best = min(usable, key=lambda row: row["within_skill_r"]) if usable else None
        for row in entry["weights"]:
            r = row["within_skill_r"]
            mark = "  <- strongest" if best is not None and row is best else ""
            ci = row.get("r_ci95")
            ci_text = f"[{ci[0]:+.5f},{ci[1]:+.5f}]" if ci else "-"
            out.append(f"  {row['weight_on_outcome']:>11.2f}"
                       f"{(f'{r:+.5f}' if r is not None else 'n/a'):>16}"
                       f"{ci_text:>22}"
                       f"{row['drafts']:>9}{row['skill_buckets']:>9}{mark}")
        out.append("")
    return "\n".join(out)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--set", action="append", required=True,
                        metavar="CACHE:DRAFT_ARCHIVE:OUTCOMES[:CONTROL_CACHE]",
                        help="elite cache, draft archive, card-outcome JSON and an "
                             "optional control cache; repeatable")
    parser.add_argument("--bootstrap-draws", type=int, default=400)
    parser.add_argument("--adaptive", action="store_true",
                        help="read each swept value as a crossover in observations: the "
                             "outcome signal carries a card only as far as the behaviour "
                             "model lacks evidence for it")
    parser.add_argument("--deck-fit", help="deck_fit.py JSON; makes the outcome axis "
                                          "pool-aware instead of raw impact")
    parser.add_argument("--pick-range", metavar="LO:HI",
                        help="restrict to pack 1 picks LO..HI, to isolate pool size")
    parser.add_argument("--all-picks", action="store_true",
                        help="fit on every pick, not only the slice the product serves")
    parser.add_argument("--weights", default="0,0.1,0.2,0.3,0.4,0.5,0.7,1.0")
    parser.add_argument("--cap", type=int, default=5000)
    parser.add_argument("--json-out")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    weights = [float(value) for value in args.weights.split(",")]
    entries = []
    for spec in args.set:
        parts = spec.split(":")
        if len(parts) not in (3, 4):
            raise SystemExit(f"--set needs CACHE:DRAFT_ARCHIVE:OUTCOMES[:CONTROL], got {spec!r}")
        entry = analyse(Path(parts[0]), Path(parts[1]), Path(parts[2]), weights, args.cap,
                        Path(parts[3]) if len(parts) == 4 else None, args.bootstrap_draws,
                        args.all_picks,
                        tuple(int(v) for v in args.pick_range.split(":")) if args.pick_range
                        else None,
                        Path(args.deck_fit) if args.deck_fit else None, args.adaptive)
        entries.append(entry)
        print(f"  analysed {entry['set_id']}", file=sys.stderr, flush=True)
    report = {"weights": weights, "cap": args.cap, "sets": entries}
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(render(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
