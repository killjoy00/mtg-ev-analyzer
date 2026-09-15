#!/usr/bin/env python3
"""A pick-value model that weighs its evidence instead of assuming it.

Two independent signals say what a good pick is, and neither should be taken on
faith:

  BEHAVIOUR  what strong players take, in context (pool, pack, pick). Enormous
             volume and very little noise per observation, but it is imitation:
             whatever the consensus gets wrong, it gets wrong confidently.

  OUTCOME    what actually raised the win rate. Two measures, because they fail
             in opposite directions. GIH WR is absolute and keeps the fact that
             some colours are simply better, but lets a good deck flatter its own
             cards. IWD is a within-deck contrast, so deck quality cancels - at
             the cost of giving the best card in a bad colour full marks for
             lifting a deck you should not be in.

Combined per decision, everything standardised across the cards in the pack:

    outcome(card) = lambda * z(GIH) + (1 - lambda) * z(IWD)
    value(card)   = (1 - w) * z(behaviour) + w * outcome(card)

Neither lambda nor w is chosen. Both are fitted against an outcome the model
never sees: whether a drafter who gave up less value actually won more matches,
measured WITHIN a win-rate bucket so that "strong players both pick well and
win" cannot manufacture the result. w = 0 is today's model; w = 1 ignores
behaviour entirely.

Reads caches and JSON on disk. No database, no served corpus.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_replays import logit, normalize_probabilities, open_text, stable_fold  # noqa: E402
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


def combo_label(lam: float, weight: float) -> str:
    return f"L{lam:g}|W{weight:g}"


class OutcomeAxis:
    """Two measures of card strength, kept separate because they fail oppositely.

    GIH WR is absolute: the win rate of games where the card was in hand. It
    keeps the fact that some colours and archetypes are simply better, but a
    mediocre card carried by the best deck in the format inherits that deck's
    win rate.

    IWD is a within-deck contrast - the same decks split by whether the card was
    drawn - so deck quality cancels. That is what makes it honest about a card's
    own contribution, and also what makes it blind: the best card in a bad colour
    scores full marks for lifting a deck you should not be in.

    They are biased in opposite directions, so the blend between them is fitted
    rather than picked. Both are centred (GIH against the set's baseline win
    rate) so that multiplying by the probability the card reaches your deck means
    the same thing on each.
    """

    def __init__(self, gih, iwd, fit: Optional[dict] = None, folds: int = 1):
        # gih/iwd are either one dict, or a list of per-fold dicts. With folds,
        # a draft is scored from a table built without its own games.
        self.folds = folds
        self.gih_folds = gih if isinstance(gih, list) else [gih]
        self.iwd_folds = iwd if isinstance(iwd, list) else [iwd]
        self.fit = fit
        self.colours: Dict[str, frozenset] = {}
        if fit:
            for card, row in fit["cards"].items():
                letters = row.get("colours") or "C"
                self.colours[card] = frozenset(c for c in letters if c in COLOURS)

    @property
    def context_aware(self) -> bool:
        return self.fit is not None

    @property
    def cross_fitted(self) -> bool:
        return self.folds > 1

    def measured(self) -> int:
        return len(set(self.gih_folds[0]) & set(self.iwd_folds[0]))

    def play_probability(self, card: str, pool: Dict[str, int]) -> Optional[float]:
        if not self.fit:
            return 1.0
        row = self.fit["cards"].get(card)
        if row is None:
            return None
        bucket = commit_bucket(commitment(pool, self.colours, card))
        return row["by_commitment"].get(bucket, row["play_rate"])

    def pair(self, card: str, pool: Dict[str, int],
             fold: int = 0) -> Optional[Tuple[float, float]]:
        """(absolute strength, within-deck contribution), both play-weighted."""
        index = fold if self.folds > 1 else 0
        gih = self.gih_folds[index].get(card)
        iwd = self.iwd_folds[index].get(card)
        if gih is None or iwd is None:
            return None
        played = self.play_probability(card, pool)
        if played is None:
            return None
        return played * gih, played * iwd


def behaviour_support(model: VariantModel, card: str, pack: int, pick: int) -> int:
    """Observations behind the behaviour model's estimate FOR THIS decision.

    base_tendency falls back exact position -> pack -> global, so the evidence
    that matters is the count at the level it actually used. A card seen five
    thousand times across the format can still rest on a handful of observations
    at this exact pick, and a global count would call that certain.
    """
    exact = model._count("exact_seen", (card, pack, pick))
    if exact >= 20:
        return exact
    pack_seen = model._count("pack_seen", (card, pack))
    if pack_seen >= 30:
        return pack_seen
    return model._count("global_seen", card)


def decision_values(model: VariantModel, example, outcome: OutcomeAxis,
                    combos: Sequence[Tuple[float, float]],
                    adaptive: bool = False,
                    fold: int = 0) -> Optional[Dict[str, Tuple[float, float]]]:
    """For each (lambda, weight), (value of the taken card, best available).

    A card with no outcome measurement contributes 0 on that axis rather than
    being dropped: dropping it would silently change which cards are comparable.
    """
    cards = example.candidates
    if len(cards) < 2:
        return None
    raw = {card: model.card_tendency(card, example.raw_pack_number,
                                     example.raw_pick_number, example.pool)
           for card in cards}
    normalised = normalize_probabilities(raw)
    behaviour = standardise([logit(normalised[card]) for card in cards])

    pairs = [outcome.pair(card, example.pool, fold) for card in cards]
    if sum(1 for value in pairs if value is not None) < 2:
        return None

    def axis(index: int) -> List[float]:
        known = [value[index] for value in pairs if value is not None]
        mean = statistics.fmean(known)
        spread = statistics.pstdev(known)
        if spread <= EPSILON:
            return [0.0] * len(cards)
        return [((value[index] - mean) / spread) if value is not None else 0.0
                for value in pairs]

    gih_z, iwd_z = axis(0), axis(1)
    taken = cards.index(example.historical_pick)
    counts = ([behaviour_support(model, card, example.raw_pack_number,
                                 example.raw_pick_number) for card in cards]
              if adaptive else None)

    out: Dict[str, Tuple[float, float]] = {}
    for lam, weight in combos:
        outcome_z = [lam * gih_z[i] + (1 - lam) * iwd_z[i] for i in range(len(cards))]
        if adaptive:
            # Weight each source by how much evidence it has for THIS card. A
            # card the behaviour model has barely seen leans on the outcome
            # measurement; a card it has seen thousands of times does not. The
            # swept value is the crossover point, in observations.
            per_card = [weight / (weight + count) if (weight + count) > 0 else 0.0
                        for count in counts]
        else:
            per_card = [weight] * len(cards)
        values = [(1 - per_card[i]) * behaviour[i] + per_card[i] * outcome_z[i]
                  for i in range(len(cards))]
        out[combo_label(lam, weight)] = (values[taken], max(values))
    return out


def draft_regret(model: VariantModel, cache: Cache, draft_ids: Sequence[str],
                 outcome: OutcomeAxis, combos: Sequence[Tuple[float, float]],
                 max_pick: int, all_picks: bool = False,
                 pick_range: Optional[Tuple[int, int]] = None,
                 adaptive: bool = False) -> Dict[str, Dict[str, float]]:
    """Mean value given up per decision, per draft, for each weight.

    Fitting uses every pick in the draft by default rather than only the ten the
    product serves: averaging over forty-odd decisions instead of ten roughly
    halves the noise in each draft's regret, and it is the card-value model being
    fitted here, not the serving policy.
    """
    pack_offset = cache.meta["pack_offset"]
    pick_offset = cache.meta["pick_offset"]
    totals: Dict[str, Dict[str, List[float]]] = defaultdict(lambda: defaultdict(list))
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
        fold = (stable_fold(example.draft_id, outcome.folds)
                if outcome.cross_fitted else 0)
        values = decision_values(model, example, outcome, combos, adaptive, fold)
        if values is None:
            continue
        for label, (taken, best) in values.items():
            totals[example.draft_id][label].append(best - taken)
    return {draft_id: {label: statistics.fmean(gaps) for label, gaps in per_label.items()}
            for draft_id, per_label in totals.items() if per_label}


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


def bootstrap_pooled(observations: Dict[str, List[Tuple[str, str, float, float]]],
                     labels: Sequence[str], draws: int,
                     seed: int = 20260918) -> Dict[str, List[float]]:
    """Resample drafts, recompute every stratum, re-pool. Paired across weights.

    One resample of draft indices is reused for every combo, because each combo
    scores the same drafts; independent resamples would hide the pairing and
    widen every interval.
    """
    import random
    rng = random.Random(seed)
    base = observations[labels[0]]
    samples: Dict[str, List[float]] = {label: [] for label in labels}
    for _ in range(draws):
        picks = [rng.randrange(len(base)) for _ in range(len(base))]
        for label in labels:
            rows = observations[label]
            grouped: Dict[str, List[Tuple[str, float, float]]] = defaultdict(list)
            for index in picks:
                stratum, skill, regret, wins = rows[index]
                grouped[stratum].append((skill, regret, wins))
            strata: List[Tuple[float, int]] = []
            for values in grouped.values():
                strata.extend(stratum_correlations(values, minimum_bucket=50))
            pooled = pool_fisher(strata)
            if pooled:
                samples[label].append(pooled["r"])
    return samples


def analyse(elite_cache: Path, archive: Path, outcomes: Path,
            combos: Sequence[Tuple[float, float]], cap: Optional[int],
            control_cache: Optional[Path] = None, draws: int = 400,
            all_picks: bool = False,
            pick_range: Optional[Tuple[int, int]] = None,
            deck_fit: Optional[Path] = None, adaptive: bool = False) -> dict:
    cache = Cache.load(elite_cache)
    max_pick = 11 if cache.set_id == "powered-cube" else 10

    payload = json.loads(outcomes.read_text(encoding="utf-8"))

    def axes(table: dict) -> Tuple[Dict[str, float], Dict[str, float]]:
        # GIH is centred on the set's own baseline so both measures sit around
        # zero; otherwise multiplying by the play probability would mostly
        # measure the play probability.
        base = float(table.get("baseline_win_rate") or 0.5)
        return ({n: r["gih_wr_shrunk"] - base for n, r in table["cards"].items()
                 if r.get("gih_wr_shrunk") is not None},
                {n: r["iwd_shrunk"] for n, r in table["cards"].items()
                 if r.get("iwd_shrunk") is not None})

    fit = json.loads(deck_fit.read_text(encoding="utf-8")) if deck_fit else None
    if payload.get("tables"):
        folds = int(payload["folds"])
        built = [axes(payload["tables"][str(f)]) for f in range(folds)]
        outcome = OutcomeAxis([b[0] for b in built], [b[1] for b in built], fit, folds)
    else:
        gih, iwd = axes(payload)
        outcome = OutcomeAxis(gih, iwd, fit)

    train_ids = cache.split_drafts("train")
    if cap:
        train_ids = train_ids[:cap]
    counts, training_picks = train_counts(cache, train_ids)
    model = VariantModel(counts, VARIANTS["v2"])

    # The elite training split is the only data the model saw. Everything else -
    # the elite hold-out AND the whole control cohort - is fair game, and the
    # control cohort is what gives the skill axis enough spread to correlate on.
    held_out = cache.split_drafts("validation") + cache.split_drafts("test")
    regrets = draft_regret(model, cache, held_out, outcome, combos, max_pick,
                           all_picks, pick_range, adaptive)
    if control_cache is not None:
        control = Cache.load(control_cache)
        if control.set_id != cache.set_id:
            raise SystemExit(f"{control_cache} is a different set from {elite_cache}")
        regrets.update(draft_regret(model, control, control.meta["drafts"],
                                    outcome, combos, max_pick, all_picks, pick_range, adaptive))
    results = draft_results(archive)

    labels = [combo_label(lam, weight) for lam, weight in combos]
    observations: Dict[str, List[Tuple[str, str, float, float]]] = {
        label: [] for label in labels}
    for draft_id, values in regrets.items():
        record = results.get(draft_id)
        if record is None:
            continue
        for label in labels:
            if label in values:
                observations[label].append(
                    (cache.set_id, record["skill"], values[label], float(record["wins"])))
    return {
        "observations": observations,
        "set_id": cache.set_id,
        "train_drafts": len(train_ids),
        "training_picks": training_picks,
        "held_out_drafts": len(regrets),
        "cards_with_outcome": outcome.measured(),
        "outcome_axis": "play-weighted impact" if outcome.context_aware else "raw impact",
        "cross_fitted_folds": outcome.folds,
        "weighting": "per-card by evidence" if adaptive else "fixed",
        "scored_picks": f"pack 1, picks {pick_range[0]}-{pick_range[1]}" if pick_range
        else "every pick in the draft" if all_picks
        else f"pack 1, picks 1-{max_pick}",
    }


def render(report: dict) -> str:
    out = ["=" * 84,
           "HOW MUCH SHOULD EACH SIGNAL COUNT?  (one fit, pooled over every set)",
           "=" * 84,
           "Value given up per decision, correlated with the drafter's match wins.",
           "Every (set, win-rate bucket) pair is a stratum, so one number comes out for",
           "the corpus rather than one per set that can disagree by chance.",
           "lambda = share of the outcome signal taken from absolute GIH win rate;",
           "the rest comes from IWD, the within-deck contrast. More negative r is better.",
           f"Sets: {', '.join(entry['set_id'] for entry in report['sets'])}",
           ""]
    wlabel = "crossover n" if report.get("weighting") == "per-card by evidence" else "w"
    out.append(f"  {'lambda':>7}{wlabel:>12}{'pooled r':>11}{'95% CI':>22}"
               f"{'vs baseline':>13}{'95% CI':>22}{'drafts':>9}")
    usable = [row for row in report["pooled"] if row["r"] is not None]
    best = min(usable, key=lambda row: row["r"]) if usable else None
    for row in report["pooled"]:
        if row["r"] is None:
            continue
        ci, dci = row["ci95"], row["vs_baseline_ci95"]
        sep = "*" if dci and (dci[0] > 0 or dci[1] < 0) else " "
        mark = "  <- strongest" if row is best else ""
        out.append(f"  {row['lam']:>7g}{row['weight']:>12g}{row['r']:>+11.5f}"
                   f"  [{ci[0]:>+8.5f},{ci[1]:>+8.5f}]"
                   f"{row['vs_baseline']:>+13.5f}"
                   f"  [{dci[0]:>+8.5f},{dci[1]:>+8.5f}]{sep}"
                   f"{row['drafts']:>8}{mark}")
    out.append("  * = change from the baseline combo separated from zero (paired bootstrap)")
    loso = report.get("leave_one_set_out") or []
    if loso:
        picked = Counter(row["chosen_on_the_other_sets"] for row in loso)
        held = [row["r_on_held_out_set"] for row in loso
                if row["r_on_held_out_set"] is not None]
        base = [row["r_baseline_on_held_out_set"] for row in loso
                if row["r_baseline_on_held_out_set"] is not None]
        out.append("")
        out.append("LEAVE-ONE-SET-OUT: combo chosen on the other sets, read on the held-out one")
        out.append(f"  sets held out       : {len(loso)}")
        out.append(f"  combo chosen        : " +
                   ", ".join(f"{label} x{count}" for label, count in picked.most_common()))
        if held:
            out.append(f"  median r held out   : {statistics.median(held):+.5f}"
                       f"   (baseline {statistics.median(base):+.5f})" if base
                       else f"  median r held out   : {statistics.median(held):+.5f}")
            out.append(f"  beat baseline on    : "
                       f"{sum(1 for h, b in zip(held, base) if h < b)}/{len(base)} held-out sets"
                       if base else "")
    out.append("")
    out.append("Per set, at the pooled best combo (a breakdown, not separate fits):")
    out.append(f"  {'set':<14}{'held-out':>10}{'cards':>8}{'r baseline':>12}{'r best':>10}")
    for entry in report["sets"]:
        base, tuned = entry.get("r_baseline"), entry.get("r_best")
        base_text = f"{base:+.4f}" if base is not None else "n/a"
        tuned_text = f"{tuned:+.4f}" if tuned is not None else "n/a"
        out.append(f"  {entry['set_id']:<14}{entry['held_out_drafts']:>10}"
                   f"{entry['cards_with_outcome']:>8}{base_text:>12}{tuned_text:>10}")
    return "\n".join(out)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--set", action="append", default=[],
                        metavar="CACHE:DRAFT_ARCHIVE:OUTCOMES[:CONTROL_CACHE]",
                        help="one set's inputs; repeat for every set in the fit")
    parser.add_argument("--weights", default="0,1000,4000,16000,64000")
    parser.add_argument("--lambdas", default="0,0.5,1.0",
                        help="share of the outcome signal taken from absolute GIH win "
                             "rate; the rest comes from IWD")
    parser.add_argument("--cap", type=int, default=5000)
    parser.add_argument("--bootstrap-draws", type=int, default=300)
    parser.add_argument("--adaptive", action="store_true",
                        help="read each weight as a crossover in observations: the outcome "
                             "signal carries a card only as far as the behaviour model "
                             "lacks evidence for it")
    parser.add_argument("--deck-fit", action="append", default=[],
                        help="deck_fit.py JSON, in the same order as --set")
    parser.add_argument("--pick-range", metavar="LO:HI",
                        help="restrict to pack 1 picks LO..HI, to isolate pool size")
    parser.add_argument("--all-picks", action="store_true",
                        help="fit on every pick, not only the slice the product serves")
    parser.add_argument("--json-out")
    parser.add_argument("--observations-out",
                        help="write this set's measured observations and stop; lets every "
                             "set be measured in parallel before one pooled fit")
    parser.add_argument("--observations-in", action="append", default=[],
                        help="pool previously measured observation files; repeat per set")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    weights = [float(v) for v in args.weights.split(",")]
    lambdas = [float(v) for v in args.lambdas.split(",")]
    combos = [(lam, weight) for lam in lambdas for weight in weights]
    labels = [combo_label(lam, weight) for lam, weight in combos]
    pick_range = tuple(int(v) for v in args.pick_range.split(":")) if args.pick_range else None

    entries: List[dict] = []
    combined: Dict[str, List[Tuple[str, str, float, float]]] = {l: [] for l in labels}

    for path in args.observations_in:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        missing = [l for l in labels if l not in payload["observations"]]
        if missing:
            raise SystemExit(f"{path} lacks {missing[:3]}; re-measure it")
        for label in labels:
            combined[label].extend(tuple(row) for row in payload["observations"][label])
        entry = payload["meta"]
        entry["_observations"] = {l: [tuple(r) for r in payload["observations"][l]]
                                  for l in labels}
        entries.append(entry)

    for position, spec in enumerate(args.set):
        parts = spec.split(":")
        if len(parts) not in (3, 4):
            raise SystemExit(f"--set needs CACHE:DRAFT_ARCHIVE:OUTCOMES[:CONTROL], got {spec!r}")
        fit = args.deck_fit[position] if position < len(args.deck_fit) else None
        entry = analyse(Path(parts[0]), Path(parts[1]), Path(parts[2]), combos, args.cap,
                        Path(parts[3]) if len(parts) == 4 else None, args.bootstrap_draws,
                        args.all_picks, pick_range, Path(fit) if fit else None, args.adaptive)
        observations = entry.pop("observations")
        print(f"  measured {entry['set_id']}: {entry['held_out_drafts']} held-out drafts",
              file=sys.stderr, flush=True)
        if args.observations_out:
            Path(args.observations_out).write_text(json.dumps({
                "labels": labels,
                "meta": {k: v for k, v in entry.items() if not k.startswith("_")},
                "observations": {l: observations[l] for l in labels},
            }), encoding="utf-8")
            print(f"  wrote {args.observations_out}", file=sys.stderr, flush=True)
            return 0
        for label in labels:
            combined[label].extend(observations[label])
        entry["_observations"] = observations
        entries.append(entry)

    pooled_by_label: Dict[str, Optional[dict]] = {}
    for label in labels:
        strata: List[Tuple[float, int]] = []
        per_set: Dict[str, List[Tuple[str, float, float]]] = defaultdict(list)
        for stratum, skill, regret, wins in combined[label]:
            per_set[stratum].append((skill, regret, wins))
        for values in per_set.values():
            strata.extend(stratum_correlations(values))
        pooled_by_label[label] = pool_fisher(strata)

    print("  bootstrapping the pooled fit", file=sys.stderr, flush=True)
    samples = bootstrap_pooled(combined, labels, args.bootstrap_draws)
    baseline = labels[0]

    pooled_rows = []
    for (lam, weight), label in zip(combos, labels):
        value = pooled_by_label[label]
        ordered = sorted(samples.get(label, []))
        paired = sorted(a - b for a, b in zip(samples.get(label, []),
                                              samples.get(baseline, [])))
        pooled_rows.append({
            "lam": lam, "weight": weight, "label": label,
            "r": value["r"] if value else None,
            "ci95": [round(ordered[max(0, int(.025 * len(ordered)) - 1)], 5),
                     round(ordered[min(len(ordered) - 1, int(.975 * len(ordered)))], 5)]
            if ordered else None,
            "vs_baseline": round(value["r"] - pooled_by_label[baseline]["r"], 5)
            if value and pooled_by_label[baseline] else 0.0,
            "vs_baseline_ci95": [round(paired[max(0, int(.025 * len(paired)) - 1)], 5),
                                 round(paired[min(len(paired) - 1, int(.975 * len(paired)))], 5)]
            if paired else None,
            "strata": value["strata"] if value else 0,
            "drafts": value["drafts"] if value else 0,
        })

    # Leave-one-set-out. Choosing the combo on every set and then reporting its
    # correlation on those same sets is not a held-out number; picking on 32
    # sets and reading the 33rd is. Per-set observation files make it free.
    set_ids = sorted({row[0] for row in combined[labels[0]]})
    loso = []
    if len(set_ids) > 2:
        for holdout in set_ids:
            scores = {}
            for label in labels:
                strata: List[Tuple[float, int]] = []
                grouped: Dict[str, List[Tuple[str, float, float]]] = defaultdict(list)
                for stratum, skill, regret, wins in combined[label]:
                    if stratum != holdout:
                        grouped[stratum].append((skill, regret, wins))
                for values in grouped.values():
                    strata.extend(stratum_correlations(values))
                pooled = pool_fisher(strata)
                if pooled:
                    scores[label] = pooled["r"]
            if not scores:
                continue
            chosen = min(scores, key=lambda label: scores[label])
            rows = [(skill, regret, wins)
                    for stratum, skill, regret, wins in combined[chosen]
                    if stratum == holdout]
            held = pool_fisher(stratum_correlations(rows, minimum_bucket=50))
            baseline_rows = [(skill, regret, wins)
                             for stratum, skill, regret, wins in combined[baseline]
                             if stratum == holdout]
            held_baseline = pool_fisher(stratum_correlations(baseline_rows, minimum_bucket=50))
            loso.append({
                "held_out_set": holdout,
                "chosen_on_the_other_sets": chosen,
                "r_on_held_out_set": held["r"] if held else None,
                "r_baseline_on_held_out_set": held_baseline["r"] if held_baseline else None,
            })

    best = min((row for row in pooled_rows if row["r"] is not None),
               key=lambda row: row["r"], default=None)
    for entry in entries:
        observations = entry.pop("_observations")
        for key, label in (("r_baseline", baseline),
                           ("r_best", best["label"] if best else baseline)):
            rows = [(skill, regret, wins) for _, skill, regret, wins in observations[label]]
            pooled = pool_fisher(stratum_correlations(rows))
            entry[key] = pooled["r"] if pooled else None

    report = {"labels": labels, "cap": args.cap, "sets": entries, "leave_one_set_out": loso,
              "weighting": "per-card by evidence" if args.adaptive else "fixed",
              "pooled": pooled_rows,
              "best": {"lambda": best["lam"], "weight": best["weight"]} if best else None}
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(render(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
