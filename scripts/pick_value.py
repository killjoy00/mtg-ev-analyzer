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


def stratum_correlations(rows: Sequence[Tuple[str, float, float]],
                         minimum_bucket: int = 200) -> List[Tuple[float, int]]:
    """Per-stratum (correlation, size), one stratum per skill bucket.

    Correlating across the whole population instead would mostly rediscover that
    strong players win more, which says nothing about whether the model is right.
    """
    buckets: Dict[str, List[Tuple[float, float]]] = defaultdict(list)
    for skill, regret, wins in rows:
        buckets[skill].append((regret, wins))
    out = []
    for values in buckets.values():
        if len(values) < minimum_bucket:
            continue
        r = pearson([v[0] for v in values], [v[1] for v in values])
        if r is None or abs(r) >= 1:
            continue
        out.append((r, len(values)))
    return out


def pool_fisher(strata: Sequence[Tuple[float, int]]) -> Optional[dict]:
    """Combine strata into one correlation, weighting by stratum size.

    Every (set, skill bucket) pair is a stratum, so one number comes out for the
    whole corpus instead of one answer per set that can disagree by chance.
    """
    weighted = 0.0
    total = 0
    for r, n in strata:
        # Fisher z is undefined at |r| = 1, and a stratum of three carries no
        # weight; either one would otherwise take the whole pooled answer.
        if n <= 3 or abs(r) >= 1:
            continue
        weighted += (n - 3) * 0.5 * math.log((1 + r) / (1 - r))
        total += n - 3
    if not total:
        return None
    z = weighted / total
    return {"r": round((math.exp(2 * z) - 1) / (math.exp(2 * z) + 1), 5),
            "strata": len(strata),
            "drafts": sum(n for _, n in strata)}


def bootstrap_pooled(observations: Dict[float, List[Tuple[str, str, float, float]]],
                     weights: Sequence[float], draws: int,
                     seed: int = 20260918) -> Dict[float, List[float]]:
    """Resample drafts, recompute every stratum, re-pool. Paired across weights.

    One resample of draft indices is reused for every weight, because each
    weight scores the same drafts; independent resamples would hide the pairing
    and widen every interval.
    """
    import random
    rng = random.Random(seed)
    base = observations[weights[0]]
    samples: Dict[float, List[float]] = {weight: [] for weight in weights}
    for _ in range(draws):
        picks = [rng.randrange(len(base)) for _ in range(len(base))]
        for weight in weights:
            rows = observations[weight]
            grouped: Dict[str, List[Tuple[str, float, float]]] = defaultdict(list)
            for index in picks:
                stratum, skill, regret, wins = rows[index]
                grouped[stratum].append((skill, regret, wins))
            strata: List[Tuple[float, int]] = []
            for values in grouped.values():
                strata.extend(stratum_correlations(values, minimum_bucket=50))
            pooled = pool_fisher(strata)
            if pooled:
                samples[weight].append(pooled["r"])
    return samples


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

    observations: Dict[float, List[Tuple[str, str, float, float]]] = {
        weight: [] for weight in weights}
    for draft_id, values in regrets.items():
        record = results.get(draft_id)
        if record is None:
            continue
        for weight in weights:
            if weight in values:
                observations[weight].append(
                    (cache.set_id, record["skill"], values[weight], float(record["wins"])))
    return {
        "observations": observations,
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
    out = ["=" * 78,
           "HOW MUCH SHOULD EACH SIGNAL COUNT?  (one fit, pooled over every set)",
           "=" * 78,
           "Value given up per decision, correlated with the drafter's match wins.",
           "Every (set, win-rate bucket) pair is a stratum, so the answer is one number",
           "for the corpus rather than one per set that can disagree by chance.",
           f"Sets: {', '.join(entry['set_id'] for entry in report['sets'])}",
           ""]
    label = "crossover n" if report.get("weighting") == "per-card by evidence" else "w(outcome)"
    out.append(f"  {label:>11}{'pooled r':>11}{'95% CI':>22}{'vs w=0':>11}"
               f"{'95% CI':>22}{'strata':>8}{'drafts':>9}")
    usable = [row for row in report["pooled"] if row["r"] is not None]
    best = min(usable, key=lambda row: row["r"]) if usable else None
    for row in report["pooled"]:
        if row["r"] is None:
            continue
        ci = row["ci95"]
        delta, dci = row["vs_baseline"], row["vs_baseline_ci95"]
        sep = "*" if dci and (dci[0] > 0 or dci[1] < 0) else " "
        mark = "  <- strongest" if row is best else ""
        out.append(f"  {row['weight']:>11g}{row['r']:>+11.5f}"
                   f"  [{ci[0]:>+8.5f},{ci[1]:>+8.5f}]"
                   f"{delta:>+11.5f}"
                   f"  [{dci[0]:>+8.5f},{dci[1]:>+8.5f}]{sep}"
                   f"{row['strata']:>7}{row['drafts']:>9}{mark}")
    out.append("  * = change from w=0 separated from zero (paired bootstrap over drafts)")
    out.append("")
    out.append("Per set, at the pooled best weight (a breakdown, not separate fits):")
    out.append(f"  {'set':<14}{'held-out':>10}{'cards':>8}{'r at w=0':>11}{'r at best':>11}")
    for entry in report["sets"]:
        base = entry.get("r_baseline")
        tuned = entry.get("r_best")
        base_text = f"{base:+.4f}" if base is not None else "n/a"
        tuned_text = f"{tuned:+.4f}" if tuned is not None else "n/a"
        out.append(f"  {entry['set_id']:<14}{entry['held_out_drafts']:>10}"
                   f"{entry['cards_with_outcome']:>8}{base_text:>11}{tuned_text:>11}")
    return "\n".join(out)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--set", action="append", required=True,
                        metavar="CACHE:DRAFT_ARCHIVE:OUTCOMES[:CONTROL_CACHE]",
                        help="one set's inputs; repeat for every set in the fit")
    parser.add_argument("--weights", default="0,0.15,0.3,0.5,0.7,1.0")
    parser.add_argument("--cap", type=int, default=5000)
    parser.add_argument("--bootstrap-draws", type=int, default=300)
    parser.add_argument("--adaptive", action="store_true",
                        help="read each swept value as a crossover in observations: the "
                             "outcome signal carries a card only as far as the behaviour "
                             "model lacks evidence for it")
    parser.add_argument("--deck-fit", action="append", default=[],
                        help="deck_fit.py JSON, in the same order as --set; makes the "
                             "outcome axis pool-aware instead of raw impact")
    parser.add_argument("--pick-range", metavar="LO:HI",
                        help="restrict to pack 1 picks LO..HI, to isolate pool size")
    parser.add_argument("--all-picks", action="store_true",
                        help="fit on every pick, not only the slice the product serves")
    parser.add_argument("--json-out")
    parser.add_argument("--observations-out",
                        help="write this set's measured observations and stop; lets every "
                             "set be measured in parallel before one pooled fit")
    parser.add_argument("--observations-in", action="append", default=[],
                        help="pool previously measured observation files instead of "
                             "measuring again; repeat per set")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    weights = [float(value) for value in args.weights.split(",")]
    pick_range = tuple(int(v) for v in args.pick_range.split(":")) if args.pick_range else None

    entries: List[dict] = []
    combined: Dict[float, List[Tuple[str, str, float, float]]] = {w: [] for w in weights}

    if args.observations_in:
        for path in args.observations_in:
            payload = json.loads(Path(path).read_text(encoding="utf-8"))
            stored = [float(w) for w in payload["weights"]]
            if stored != weights:
                raise SystemExit(f"{path} was measured at weights {stored}, not {weights}")
            for weight in weights:
                combined[weight].extend(tuple(row) for row in payload["observations"][str(weight)])
            entry = payload["meta"]
            entry["_observations"] = {w: [tuple(r) for r in payload["observations"][str(w)]]
                                      for w in weights}
            entries.append(entry)
        args.set = []

    for position, spec in enumerate(args.set):
        parts = spec.split(":")
        if len(parts) not in (3, 4):
            raise SystemExit(f"--set needs CACHE:DRAFT_ARCHIVE:OUTCOMES[:CONTROL], got {spec!r}")
        fit = args.deck_fit[position] if position < len(args.deck_fit) else None
        entry = analyse(Path(parts[0]), Path(parts[1]), Path(parts[2]), weights, args.cap,
                        Path(parts[3]) if len(parts) == 4 else None, args.bootstrap_draws,
                        args.all_picks, pick_range, Path(fit) if fit else None, args.adaptive)
        observations = entry.pop("observations")
        for weight in weights:
            combined[weight].extend(observations[weight])
        entry["_observations"] = observations
        entries.append(entry)
        print(f"  measured {entry['set_id']}: {entry['held_out_drafts']} held-out drafts",
              file=sys.stderr, flush=True)
        if args.observations_out:
            Path(args.observations_out).write_text(json.dumps({
                "weights": weights,
                "meta": {k: v for k, v in entry.items() if not k.startswith("_")},
                "observations": {str(w): observations[w] for w in weights},
            }), encoding="utf-8")
            print(f"  wrote {args.observations_out}", file=sys.stderr, flush=True)
            return 0

    grouped_by_weight: Dict[float, Optional[dict]] = {}
    for weight in weights:
        strata: List[Tuple[float, int]] = []
        per_set: Dict[str, List[Tuple[str, float, float]]] = defaultdict(list)
        for stratum, skill, regret, wins in combined[weight]:
            per_set[stratum].append((skill, regret, wins))
        for values in per_set.values():
            strata.extend(stratum_correlations(values))
        grouped_by_weight[weight] = pool_fisher(strata)

    print("  bootstrapping the pooled fit", file=sys.stderr, flush=True)
    samples = bootstrap_pooled(combined, weights, args.bootstrap_draws)
    baseline = weights[0]

    pooled_rows = []
    for weight in weights:
        value = grouped_by_weight[weight]
        ordered = sorted(samples.get(weight, []))
        paired = sorted(a - b for a, b in zip(samples.get(weight, []),
                                              samples.get(baseline, [])))
        pooled_rows.append({
            "weight": weight,
            "r": value["r"] if value else None,
            "ci95": [round(ordered[max(0, int(.025 * len(ordered)) - 1)], 5),
                     round(ordered[min(len(ordered) - 1, int(.975 * len(ordered)))], 5)]
            if ordered else None,
            "vs_baseline": round((value["r"] - grouped_by_weight[baseline]["r"]), 5)
            if value and grouped_by_weight[baseline] else 0.0,
            "vs_baseline_ci95": [round(paired[max(0, int(.025 * len(paired)) - 1)], 5),
                                 round(paired[min(len(paired) - 1, int(.975 * len(paired)))], 5)]
            if paired else None,
            "strata": value["strata"] if value else 0,
            "drafts": value["drafts"] if value else 0,
        })

    best = min((row for row in pooled_rows if row["r"] is not None),
               key=lambda row: row["r"], default=None)
    for entry in entries:
        observations = entry.pop("_observations")
        for key, weight in (("r_baseline", baseline),
                            ("r_best", best["weight"] if best else baseline)):
            rows = [(skill, regret, wins) for _, skill, regret, wins in observations[weight]]
            pooled = pool_fisher(stratum_correlations(rows))
            entry[key] = pooled["r"] if pooled else None

    report = {"weights": weights, "cap": args.cap, "sets": entries,
              "weighting": "per-card by evidence" if args.adaptive else "fixed",
              "pooled": pooled_rows,
              "best_weight": best["weight"] if best else None}
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(render(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
