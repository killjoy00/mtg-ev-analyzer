#!/usr/bin/env python3
"""Second criterion: does the blended value model predict strong-player picks?

The match-wins criterion in pick_value.py is not neutral between the two
signals. GIH win rate is itself a win rate over the same population and the same
games, so it is being judged in very nearly its own units, while pick behaviour
is judged in foreign ones. Worse, GIH is partly confounded by deck quality -
good decks both play good cards and win - so ranking cards by GIH partly ranks
them by "appears in a winning deck", which is close to what the criterion
rewards. IWD deliberately subtracts that out, so the tilt runs against it.

This measures the mirror image, on behaviour's home turf: given the same blended
value, how often is the highest-valued card the one a held-out strong player
actually took? Behaviour is trained for exactly this, so it should win here -
which is what makes the test hard. An outcome signal that improves prediction
even slightly is carrying real pick-relevant information rather than sharing
units with the criterion.

Top-1 accuracy and the rank of the taken card are used because both are
invariant to any monotone rescaling of value, so no temperature or calibration
parameter enters the comparison.

A signal worth having should help on BOTH criteria. One alone proves little.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_replays import logit, normalize_probabilities, stable_fold  # noqa: E402
from eval_model import (VARIANTS, Cache, VariantModel, build_backbone,  # noqa: E402
                        guard_test_split, load_examples, load_training_fit, train_counts)  # noqa: E402
from pick_value import (  # noqa: E402
    EPSILON,
    OutcomeAxis,
    behaviour_support,
    combo_label,
    standardise,
)


def value_vector(model: VariantModel, example, outcome: OutcomeAxis,
                 combos: Sequence[Tuple[float, float]], adaptive: bool,
                 fold: int) -> Optional[Dict[str, List[float]]]:
    """The full per-card value for each (lambda, weight), not just the taken one."""
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
    counts = ([behaviour_support(model, card, example.raw_pack_number,
                                 example.raw_pick_number) for card in cards]
              if adaptive else None)

    out: Dict[str, List[float]] = {}
    for lam, weight in combos:
        outcome_z = [lam * gih_z[i] + (1 - lam) * iwd_z[i] for i in range(len(cards))]
        if adaptive:
            per_card = [weight / (weight + count) if (weight + count) > 0 else 0.0
                        for count in counts]
        else:
            per_card = [weight] * len(cards)
        out[combo_label(lam, weight)] = [
            (1 - per_card[i]) * behaviour[i] + per_card[i] * outcome_z[i]
            for i in range(len(cards))]
    return out


def score_set(cache_path: Path, outcomes_path: Path, deck_fit_path: Optional[Path],
              combos: Sequence[Tuple[float, float]], cap: Optional[int],
              adaptive: bool, split: str = "validation",
              backbone: str = "v2", served_only: bool = True) -> dict:
    cache = Cache.load(cache_path)
    payload = json.loads(outcomes_path.read_text(encoding="utf-8"))

    def axes(table: dict):
        base = float(table.get("baseline_win_rate") or 0.5)
        return ({n: r["gih_wr_shrunk"] - base for n, r in table["cards"].items()
                 if r.get("gih_wr_shrunk") is not None},
                {n: r["iwd_shrunk"] for n, r in table["cards"].items()
                 if r.get("iwd_shrunk") is not None})

    fit = load_training_fit(deck_fit_path, cache) if deck_fit_path else None
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
    counts, _ = train_counts(cache, train_ids)
    model = build_backbone(cache, train_ids, counts, backbone, fit)

    # Validation by default. Reading validation and test together, as this did,
    # means every lambda and weight was chosen with the test split in view, and
    # no later run can undo that.
    held_out = cache.split_drafts(split)
    # The game only ever serves pack 1. Scoring all 42 positions of a draft
    # answers a question nobody is asking, and weights the late picks - where
    # pools are largest and the context term has most to say - far above the
    # ones a player will actually see.
    pack_offset, pick_offset = cache.meta["pack_offset"], cache.meta["pick_offset"]
    served_max = 11 if cache.set_id == "powered-cube" else 10
    hits: Dict[str, int] = defaultdict(int)
    ranks: Dict[str, int] = defaultdict(int)
    scored = 0
    for example in load_examples(cache, held_out):
        if served_only and not (example.raw_pack_number + pack_offset == 1
                                and example.raw_pick_number + pick_offset <= served_max):
            continue
        fold = stable_fold(example.draft_id, outcome.folds) if outcome.cross_fitted else 0
        vectors = value_vector(model, example, outcome, combos, adaptive, fold)
        if vectors is None:
            continue
        taken = example.candidates.index(example.historical_pick)
        scored += 1
        for label, values in vectors.items():
            best = values[taken]
            better = sum(1 for index, value in enumerate(values)
                         if value > best or (value == best and index < taken))
            if better == 0:
                hits[label] += 1
            ranks[label] += better + 1
    return {
        "set_id": cache.set_id,
        "split": split,
        "backbone": backbone,
        "slice": "served (pack 1)" if served_only else "all picks",
        "decisions": scored,
        "top1": {label: hits[label] / scored for label in hits} if scored else {},
        "mean_rank": {label: ranks[label] / scored for label in ranks} if scored else {},
    }


def render(report: dict) -> str:
    out = ["=" * 76,
           "SECOND CRITERION: predicting held-out strong-player picks",
           "=" * 76,
           "Behaviour is trained for exactly this, so it should win. An outcome",
           "signal that still improves top-1 here is carrying real pick information",
           "rather than sharing units with the match-wins criterion.",
           f"Sets: {len(report['sets'])}   decisions: {report['decisions']}"
           f"   split: {report['split']}   backbone: {report['backbone']}\n"
           f"Slice: {report['slice']}",
           ""]
    rows = report["pooled"]
    baseline = rows[0]
    out.append(f"  {'lambda':>7}{'crossover n':>12}{'top-1':>9}{'vs w=0':>10}{'mean rank':>11}")
    best = max(rows, key=lambda r: r["top1"])
    for row in rows:
        mark = "  <- best" if row is best else ""
        out.append(f"  {row['lam']:>7g}{row['weight']:>12g}{row['top1']:>9.4f}"
                   f"{row['top1'] - baseline['top1']:>+10.4f}{row['mean_rank']:>11.4f}{mark}")
    return "\n".join(out)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--set", action="append", required=True,
                        metavar="CACHE:OUTCOMES[:DECK_FIT]")
    parser.add_argument("--weights", default="0,1000,4000,16000,64000")
    parser.add_argument("--lambdas", default="0,0.5,0.75,0.9,1.0")
    parser.add_argument("--cap", type=int, default=5000)
    parser.add_argument("--backbone", default="v2",
                        help="behaviour model the outcome blend sits on (default: v2). "
                             "Refit the blend whenever the backbone changes")
    parser.add_argument("--split", default="validation", choices=["validation", "test"],
                        help="held-out split to score (default: validation; "
                             "pass test only for a frozen specification)")
    parser.add_argument("--final-test", action="store_true",
                        help="required alongside --split test; exists only to make\n                             reading the test split a deliberate act")
    parser.add_argument("--all-picks", action="store_true",
                        help="score every draft position instead of only the served "
                             "slice (pack 1, picks 1-10; 11 for Cube)")
    parser.add_argument("--adaptive", action="store_true")
    parser.add_argument("--json-out")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    guard_test_split(args.split, args.final_test)
    weights = [float(v) for v in args.weights.split(",")]
    lambdas = [float(v) for v in args.lambdas.split(",")]
    combos = [(lam, weight) for lam in lambdas for weight in weights]

    entries = []
    for spec in args.set:
        parts = spec.split(":")
        if len(parts) not in (2, 3):
            raise SystemExit(f"--set needs CACHE:OUTCOMES[:DECK_FIT], got {spec!r}")
        entry = score_set(Path(parts[0]), Path(parts[1]),
                          Path(parts[2]) if len(parts) == 3 else None,
                          combos, args.cap, args.adaptive, args.split, args.backbone,
                          not args.all_picks)
        entries.append(entry)
        print(f"  scored {entry['set_id']}: {entry['decisions']} decisions",
              file=sys.stderr, flush=True)

    total = sum(e["decisions"] for e in entries)
    pooled = []
    for lam, weight in combos:
        label = combo_label(lam, weight)
        pooled.append({
            "lam": lam, "weight": weight, "label": label,
            "top1": sum(e["top1"].get(label, 0) * e["decisions"] for e in entries) / total,
            "mean_rank": sum(e["mean_rank"].get(label, 0) * e["decisions"]
                             for e in entries) / total,
        })
    report = {"sets": entries, "decisions": total, "pooled": pooled,
              "split": args.split, "backbone": args.backbone,
              "slice": "all picks" if args.all_picks else "served (pack 1)"}
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(render(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
