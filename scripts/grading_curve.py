#!/usr/bin/env python3
"""Test a scoring curve against what a game needs it to do.

Draft Run awards `95 * (selected support / leader support) ** exponent`, with
exponent 1.0 today. Calibrating the model so its probabilities are honest is
equivalent to about 2.0, because normalising cancels in the ratio. Prediction
metrics cannot choose between them: both rank cards identically, so log loss and
accuracy are blind to the exponent once the ranking is fixed.

What can choose between them is data. Two measurements here, neither of which
needs anyone's opinion:

  * SEPARATION. Train the model on elite drafters, then score the real picks of
    held-out elite drafters and of equally experienced ordinary drafters who
    were never trained on. A scoring curve exists to tell those two apart. The
    exponent that separates them best is the one doing that job best.

  * WHAT A SUPPORT RATIO IS WORTH. Average pick position (how early the whole
    drafting population takes a card) is computed straight from the archives and
    owes nothing to the consensus model. Relating support ratio to the gap in
    average pick position says whether a card at half the leader's support is
    genuinely a much worse card or only slightly worse - which is what decides
    whether halving its score is fair.

Read-only: caches on disk, no database, no served corpus.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import statistics
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_replays import normalize_probabilities  # noqa: E402
from eval_model import (  # noqa: E402
    VARIANTS,
    Cache,
    VariantModel,
    build_backbone,
    guard_test_split,
    load_examples,
    train_counts,
)

SCORE_CAP = 95
DEFAULT_EXPONENTS = (0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0)


def js_round(value: float) -> int:
    """Math.round semantics; Python's round() sends 66.5 down, JavaScript up."""
    return math.floor(value + 0.5)


def curve_score(ratio: float, exponent: float) -> int:
    """gradeDraftRunPick's award for a pick that is not the trophy pick."""
    return js_round(SCORE_CAP * (max(0.0, min(1.0, ratio)) ** exponent))


def served_picks(cache: Cache, draft_ids: Sequence[str], max_pick: int):
    """Only the slice Draft Run serves: pack 1, picks 1..max_pick."""
    pack_offset = cache.meta["pack_offset"]
    pick_offset = cache.meta["pick_offset"]
    for example in load_examples(cache, draft_ids):
        if example.raw_pack_number + pack_offset != 1:
            continue
        if example.raw_pick_number + pick_offset > max_pick:
            continue
        yield example


def support_ratios(model: VariantModel, example) -> Optional[Tuple[float, float]]:
    """(ratio of the drafter's pick to the pack leader, leader support)."""
    raw = {card: model.card_tendency(card, example.raw_pack_number,
                                     example.raw_pick_number, example.pool)
           for card in example.candidates}
    probabilities = normalize_probabilities(raw)
    leader = max(probabilities.values())
    if leader <= 0:
        return None
    return probabilities[example.historical_pick] / leader, leader


def cohen_d(a: Sequence[float], b: Sequence[float]) -> float:
    if len(a) < 2 or len(b) < 2:
        return float("nan")
    va, vb = statistics.variance(a), statistics.variance(b)
    pooled = math.sqrt(((len(a) - 1) * va + (len(b) - 1) * vb) / (len(a) + len(b) - 2))
    if pooled <= 0:
        return float("nan")
    return (statistics.fmean(a) - statistics.fmean(b)) / pooled


def auc(a: Sequence[float], b: Sequence[float]) -> float:
    """P(a random elite run outscores a random control run), ties counted half.

    Rank-based so it is invariant to any monotone rescaling of the scores -
    which is the point: it measures the curve's power to order drafters, not
    the units it happens to report them in.
    """
    if not a or not b:
        return float("nan")
    merged = sorted([(v, 0) for v in a] + [(v, 1) for v in b])
    ranks: Dict[int, float] = {}
    index = 0
    total_rank_a = 0.0
    while index < len(merged):
        stop = index
        while stop + 1 < len(merged) and merged[stop + 1][0] == merged[index][0]:
            stop += 1
        average = (index + stop) / 2.0 + 1.0
        for position in range(index, stop + 1):
            if merged[position][1] == 0:
                total_rank_a += average
        index = stop + 1
    n_a, n_b = len(a), len(b)
    return (total_rank_a - n_a * (n_a + 1) / 2.0) / (n_a * n_b)


def paired_auc_delta(elite_runs: Dict[float, List[float]],
                     control_runs: Dict[float, List[float]],
                     exponents: Sequence[float], baseline: float,
                     draws: int, seed: int = 20260916) -> Dict[float, dict]:
    """Bootstrap the AUC change from the baseline exponent, paired over drafters.

    Every exponent scores the same drafters on the same decisions, so one
    resample of drafter indices is reused across exponents. Comparing
    independent resamples would hide the pairing and widen every interval.
    """
    rng = random.Random(seed)
    n_elite = len(elite_runs[baseline])
    n_control = len(control_runs[baseline])
    observed = {e: auc(elite_runs[e], control_runs[e]) for e in exponents}
    samples: Dict[float, List[float]] = {e: [] for e in exponents}
    for _ in range(draws):
        ei = [rng.randrange(n_elite) for _ in range(n_elite)]
        ci = [rng.randrange(n_control) for _ in range(n_control)]
        base = auc([elite_runs[baseline][i] for i in ei],
                   [control_runs[baseline][i] for i in ci])
        for e in exponents:
            if e == baseline:
                samples[e].append(0.0)
                continue
            samples[e].append(auc([elite_runs[e][i] for i in ei],
                                  [control_runs[e][i] for i in ci]) - base)
    return {e: {"delta": round(observed[e] - observed[baseline], 5),
                "ci95": interval(samples[e], 5)} for e in exponents}


def bootstrap_gap(elite: Sequence[float], control: Sequence[float],
                  draws: int, seed: int = 20260915) -> List[float]:
    rng = random.Random(seed)
    out = []
    for _ in range(draws):
        a = [elite[rng.randrange(len(elite))] for _ in elite]
        b = [control[rng.randrange(len(control))] for _ in control]
        out.append(statistics.fmean(a) - statistics.fmean(b))
    return out


def interval(values: Sequence[float], places: int = 3) -> List[float]:
    ordered = sorted(values)
    low = ordered[max(0, int(0.025 * len(ordered)) - 1)]
    high = ordered[min(len(ordered) - 1, int(0.975 * len(ordered)))]
    return [round(low, places), round(high, places)]


# --------------------------------------------------------------------------
# average pick position, straight from the archive
# --------------------------------------------------------------------------

def average_taken_at(caches: Sequence[Cache], minimum: int = 40) -> Dict[str, float]:
    """Mean pick number at which each card was taken, over every cached drafter.

    This is the drafting population's own valuation of a card. It is computed
    from the archive and never touches the consensus model, so comparing the two
    is a real external check rather than the model grading itself.
    """
    taken: Dict[str, List[int]] = defaultdict(list)
    for cache in caches:
        pick_offset = cache.meta["pick_offset"]
        pack_offset = cache.meta["pack_offset"]
        for _, example in cache.examples():
            if example.raw_pack_number + pack_offset != 1:
                continue
            taken[example.historical_pick].append(example.raw_pick_number + pick_offset)
    return {card: statistics.fmean(picks) for card, picks in taken.items()
            if len(picks) >= minimum}


RATIO_BANDS = ((0.85, 1.01, "0.85-1.00"), (0.70, 0.85, "0.70-0.85"),
               (0.50, 0.70, "0.50-0.70"), (0.30, 0.50, "0.30-0.50"),
               (0.15, 0.30, "0.15-0.30"), (0.0, 0.15, "0.00-0.15"))


def band_of(ratio: float) -> str:
    for low, high, name in RATIO_BANDS:
        if low <= ratio < high:
            return name
    return RATIO_BANDS[-1][2]


def value_of_a_ratio(model: VariantModel, cache: Cache, draft_ids: Sequence[str],
                     ata: Dict[str, float], max_pick: int) -> dict:
    """For each support-ratio band, how much later does the population take it?"""
    rows: Dict[str, List[float]] = defaultdict(list)
    for example in served_picks(cache, draft_ids, max_pick):
        raw = {card: model.card_tendency(card, example.raw_pack_number,
                                         example.raw_pick_number, example.pool)
               for card in example.candidates}
        probabilities = normalize_probabilities(raw)
        leader_card = max(probabilities, key=lambda c: (probabilities[c], c))
        leader_support = probabilities[leader_card]
        leader_ata = ata.get(leader_card)
        if leader_support <= 0 or leader_ata is None:
            continue
        for card, support in probabilities.items():
            if card == leader_card:
                continue
            card_ata = ata.get(card)
            if card_ata is None:
                continue
            rows[band_of(support / leader_support)].append(card_ata - leader_ata)
    summary = {}
    for _, _, name in RATIO_BANDS:
        values = rows.get(name)
        if not values:
            continue
        summary[name] = {
            "n": len(values),
            "mean_picks_later": round(statistics.fmean(values), 3),
            "median_picks_later": round(statistics.median(values), 3),
        }
    return summary


# --------------------------------------------------------------------------
# separation
# --------------------------------------------------------------------------

def run_scores(model: VariantModel, cache: Cache, draft_ids: Sequence[str],
               exponents: Sequence[float], max_pick: int,
               minimum_picks: int = 4) -> Tuple[Dict[float, List[float]], Dict[float, List[int]], int]:
    """Per-drafter average score and every per-decision score, for each exponent."""
    by_draft: Dict[str, List[float]] = defaultdict(list)
    decisions = 0
    for example in served_picks(cache, draft_ids, max_pick):
        result = support_ratios(model, example)
        if result is None:
            continue
        ratio, _ = result
        by_draft[example.draft_id].append(ratio)
        decisions += 1
    runs: Dict[float, List[float]] = {}
    singles: Dict[float, List[int]] = {}
    for exponent in exponents:
        run_list, single_list = [], []
        for ratios in by_draft.values():
            if len(ratios) < minimum_picks:
                continue
            scores = [curve_score(r, exponent) for r in ratios]
            run_list.append(statistics.fmean(scores))
            single_list.extend(scores)
        runs[exponent] = run_list
        singles[exponent] = single_list
    return runs, singles, decisions


def analyse_set(elite_path: Path, control_path: Path, exponents: Sequence[float],
                cap: Optional[int], draws: int,
                split: str = "validation", backbone: str = "v2") -> dict:
    elite = Cache.load(elite_path)
    control = Cache.load(control_path)
    if elite.set_id != control.set_id:
        raise SystemExit(f"{elite_path} and {control_path} are different sets.")
    max_pick = 11 if elite.set_id == "powered-cube" else 10

    train_ids = elite.split_drafts("train")
    if cap:
        train_ids = train_ids[:cap]
    counts, training_picks = train_counts(elite, train_ids)
    model = build_backbone(elite, train_ids, counts, backbone)

    # Was hardcoded to the test split. A curve chosen while reading test data
    # is chosen on the final exam, exactly the hole the other three surfaces
    # had; this one was missed because it lives in the grading track rather
    # than the prediction track.
    elite_test = elite.split_drafts(split)
    control_ids = control.meta["drafts"]

    elite_runs, elite_singles, elite_decisions = run_scores(
        model, elite, elite_test, exponents, max_pick)
    control_runs, control_singles, control_decisions = run_scores(
        model, control, control_ids, exponents, max_pick)

    ata = average_taken_at([elite, control])
    worth = value_of_a_ratio(model, elite, elite_test, ata, max_pick)

    # AUC is rank-based, so it would be unchanged by rescaling a single score.
    # It moves across exponents only because a run score is the MEAN of
    # transformed decisions, and the mean of a transform is not the transform of
    # the mean - so the exponent really does reorder drafters.
    baseline = 1.0 if 1.0 in exponents else exponents[0]
    paired = paired_auc_delta(elite_runs, control_runs, exponents, baseline, draws)
    rows = []
    for exponent in exponents:
        a, b = elite_runs[exponent], control_runs[exponent]
        gaps = bootstrap_gap(a, b, draws)
        rows.append({
            "exponent": exponent,
            "elite_run_mean": round(statistics.fmean(a), 3),
            "control_run_mean": round(statistics.fmean(b), 3),
            "gap": round(statistics.fmean(a) - statistics.fmean(b), 3),
            "gap_ci95": interval(gaps),
            "cohens_d": round(cohen_d(a, b), 4),
            "auc": round(auc(a, b), 4),
            "auc_vs_baseline": paired[exponent]["delta"],
            "auc_vs_baseline_ci95": paired[exponent]["ci95"],
            "elite_decision_mean": round(statistics.fmean(elite_singles[exponent]), 2),
            "control_decision_mean": round(statistics.fmean(control_singles[exponent]), 2),
        })
    return {
        "set_id": elite.set_id,
        "train_drafts": len(train_ids),
        "training_picks": training_picks,
        "elite_runs": len(elite_runs[exponents[0]]),
        "control_runs": len(control_runs[exponents[0]]),
        "elite_decisions": elite_decisions,
        "control_decisions": control_decisions,
        "cards_with_average_pick": len(ata),
        "separation": rows,
        "ratio_worth": worth,
    }


def render(report: dict) -> str:
    out = ["=" * 78, "WHICH SCORING CURVE ACTUALLY SEPARATES GOOD DRAFTERS FROM ORDINARY ONES",
           "=" * 78,
           "Model trained on elite drafters only. Scored: held-out elite drafters vs",
           "equally experienced drafters below the same win-rate cutoff, never trained on.",
           "AUC = chance a random elite run outscores a random ordinary one.", ""]
    for entry in report["sets"]:
        out.append(f"--- {entry['set_id']} --- elite runs {entry['elite_runs']}, "
                   f"ordinary runs {entry['control_runs']}, "
                   f"trained on {entry['train_drafts']} drafts")
        out.append(f"  {'exp':>5}{'elite':>9}{'ordinary':>10}{'gap':>8}"
                   f"{'d':>8}{'AUC':>8}{'vs exp 1.0':>12}{'95% CI':>22}")
        best = max(entry["separation"], key=lambda r: r["auc"])
        for row in entry["separation"]:
            ci = row["auc_vs_baseline_ci95"]
            sep = "*" if (ci[0] > 0 or ci[1] < 0) else " "
            mark = "  <- best" if row is best else ""
            out.append(f"  {row['exponent']:>5g}{row['elite_run_mean']:>9.2f}"
                       f"{row['control_run_mean']:>10.2f}{row['gap']:>8.2f}"
                       f"{row['cohens_d']:>8.3f}{row['auc']:>8.4f}"
                       f"{row['auc_vs_baseline']:>+12.5f}"
                       f"  [{ci[0]:>+8.5f},{ci[1]:>+8.5f}]{sep}{mark}")
        out.append("  * = AUC change separated from zero (paired bootstrap over drafters)")
        out.append("")
    out.append("=" * 78)
    out.append("WHAT A SUPPORT RATIO IS WORTH, IN HOW EARLY THE POPULATION TAKES THE CARD")
    out.append("=" * 78)
    out.append("Average pick position comes from the archives, not the model. A card at")
    out.append("half the leader's support that is taken only a little later is a card the")
    out.append("population rates nearly as highly.")
    out.append("")
    header = f"  {'support ratio':<16}" + "".join(f"{e['set_id']:>16}" for e in report["sets"])
    out.append(header)
    for _, _, band in RATIO_BANDS:
        cells = []
        for entry in report["sets"]:
            value = entry["ratio_worth"].get(band)
            cells.append(f"{value['mean_picks_later']:>+9.2f} ({value['n']//1000}k)" if value
                         else f"{'-':>16}")
        out.append(f"  {band:<16}" + "".join(cells))
    out.append("")
    out.append("  (mean picks later the population takes it, vs the pack leader)")
    return "\n".join(out)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pair", action="append", required=True, metavar="ELITE:CONTROL",
                        help="elite cache and control cache for one set; repeatable")
    parser.add_argument("--exponents", default=",".join(str(e) for e in DEFAULT_EXPONENTS))
    parser.add_argument("--cap", type=int, default=5000,
                        help="training cap, matching production")
    parser.add_argument("--split", default="validation", choices=["validation", "test"],
                        help="elite held-out split to score (default: validation)")
    parser.add_argument("--final-test", action="store_true",
                        help="required alongside --split test")
    parser.add_argument("--backbone", default="v2",
                        help="behaviour model the curve is measured on")
    parser.add_argument("--bootstrap-draws", type=int, default=1000)
    parser.add_argument("--json-out")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    guard_test_split(args.split, args.final_test)
    exponents = [float(value) for value in args.exponents.split(",")]
    entries = []
    for pair in args.pair:
        elite_path, _, control_path = pair.partition(":")
        if not control_path:
            raise SystemExit(f"--pair needs ELITE:CONTROL, got {pair!r}")
        entry = analyse_set(Path(elite_path), Path(control_path), exponents,
                            args.cap, args.bootstrap_draws, args.split, args.backbone)
        entries.append(entry)
        print(f"  analysed {entry['set_id']}", file=sys.stderr, flush=True)
    report = {"exponents": exponents, "cap": args.cap, "sets": entries,
              "split": args.split, "backbone": args.backbone}
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(render(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
