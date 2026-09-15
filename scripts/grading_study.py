#!/usr/bin/env python3
"""Blind grading-fairness study for Draft Run partial credit.

The evaluation harness answers "does the model predict what a strong player
took?". It cannot answer "is the score a player gets fair?", because the only
ground truth there is one trophy drafter's single choice, and that choice is not
always right either.

This asks drafters instead. It samples decisions from the served corpus, writes
a task file with every model number stripped out, and later compares the ratings
that come back against what Pack One would award.

The headline output is the exponent human judgement implies:

    score = 95 x (selected support / leader support) ** exponent

Production is exponent 1.0 today. Calibrating the model so its probabilities are
honest is equivalent to roughly 2.0, because normalising cancels in the ratio.
If drafters imply 1.0 the current curve is right and honest probabilities need
compensating in the formula; if they imply 2.0 the harsher curve is right; in
between says how far to go.

Nothing here reads or writes the database, and the task file never contains a
model probability, so a rater cannot see the answer they are being asked about.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import random
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "corpus/draft-run"
# draftRunConsensusCap() in draft-run.mjs — flat 95 for every pick.
SCORE_CAP = 95
STUDY_VERSION = "grading-fairness-v1"

# Severity of the gap between a card and the pack leader, in support ratio.
SEVERITY_BANDS = (
    ("leader", 1.0, 1.01),
    ("close", 0.7, 1.0),
    ("moderate", 0.2, 0.7),
    ("severe", 0.0, 0.2),
)


def stable_score(value: str) -> int:
    import hashlib
    return int.from_bytes(hashlib.sha256(value.encode("utf-8")).digest()[:8], "big")


def severity_of(ratio: float) -> str:
    for name, low, high in SEVERITY_BANDS:
        if low <= ratio < high:
            return name
    return "severe"


def pick_band(pick_number: int) -> str:
    if pick_number <= 3:
        return "early"
    if pick_number <= 7:
        return "mid"
    return "late"


def js_round(value: float) -> int:
    """Math.round semantics: ties go up, not to even.

    Python rounds 66.5 to 66 and JavaScript rounds it to 67. Draft Run scores
    are produced by Math.round, so anything comparing against what a player
    actually saw has to round the same way.
    """
    return math.floor(value + 0.5)


def displayed_score(ratio: float, is_trophy: bool, exponent: float = 1.0) -> int:
    """What Draft Run shows, reproducing gradeDraftRunPick exactly at exponent 1."""
    if is_trophy:
        return 100
    ratio = max(0.0, min(1.0, ratio))
    return js_round(SCORE_CAP * (ratio ** exponent))


@dataclass
class Decision:
    puzzle_id: str
    set_id: str
    pick_number: int
    candidates: List[dict]
    prior_picks: List[dict]
    trophy_id: str
    leader_id: str
    ratios: Dict[str, float]

    @property
    def trophy_ratio(self) -> float:
        return self.ratios[self.trophy_id]


def served_max_pick(set_id: str) -> int:
    policy = json.loads((ROOT / "data/selection-policy.json").read_text(encoding="utf-8"))
    key = "powered-cube" if set_id == "powered-cube" else "mixed"
    return int(policy["max_pick"][key])


def load_decisions(set_ids: Optional[Sequence[str]] = None) -> List[Decision]:
    """Every served decision in the corpus, with support ratios computed."""
    decisions: List[Decision] = []
    limits: Dict[str, int] = {}
    for path in sorted(CORPUS.glob("*.json.gz")):
        set_id = path.name[: -len(".json.gz")]
        if set_ids and set_id not in set_ids:
            continue
        limits.setdefault(set_id, served_max_pick(set_id))
        for puzzle in json.loads(gzip.decompress(path.read_bytes())):
            pick_number = int(puzzle.get("pick_number") or 0)
            if pick_number > limits[set_id]:
                continue
            candidates = puzzle.get("candidates") or []
            supports = {c["id"]: max(0.0, float(c.get("model_probability") or 0)) for c in candidates}
            if len(supports) < 4:
                continue
            leader_id = max(supports, key=lambda cid: (supports[cid], cid))
            leader = supports[leader_id]
            if leader <= 0:
                continue
            trophy_id = puzzle.get("historical_pick_id")
            if trophy_id not in supports:
                continue
            decisions.append(Decision(
                puzzle_id=puzzle["puzzle_id"], set_id=set_id, pick_number=pick_number,
                candidates=candidates, prior_picks=puzzle.get("prior_picks") or [],
                trophy_id=trophy_id, leader_id=leader_id,
                ratios={cid: value / leader for cid, value in supports.items()},
            ))
    return decisions


def rating_targets(decision: Decision, wanted: int) -> List[str]:
    """Cards to rate: the leader, the trophy pick, and alternatives spanning the range.

    The point of the study is where partial credit lands, so the sample has to
    reach down the support range rather than only comparing the top two.
    """
    chosen: List[str] = [decision.leader_id]
    if decision.trophy_id != decision.leader_id:
        chosen.append(decision.trophy_id)
    remaining = sorted(
        (cid for cid in decision.ratios if cid not in chosen),
        key=lambda cid: stable_score(f"{decision.puzzle_id}|{cid}"),
    )
    for band in ("close", "moderate", "severe"):
        if len(chosen) >= wanted:
            break
        for cid in remaining:
            if cid in chosen:
                continue
            if severity_of(decision.ratios[cid]) == band:
                chosen.append(cid)
                break
    for cid in remaining:
        if len(chosen) >= wanted:
            break
        if cid not in chosen:
            chosen.append(cid)
    return chosen[:wanted]


def stratified_sample(decisions: Sequence[Decision], size: int, seed: str) -> List[Decision]:
    """Balance over trophy-pick severity and pick depth, then fill by hash order.

    Severe disagreements are rare in the corpus but they are exactly the cases
    the curve is being judged on, so they are deliberately over-sampled.
    """
    buckets: Dict[Tuple[str, str], List[Decision]] = defaultdict(list)
    for decision in decisions:
        key = (severity_of(decision.trophy_ratio), pick_band(decision.pick_number))
        buckets[key].append(decision)
    for items in buckets.values():
        items.sort(key=lambda d: stable_score(f"{seed}|{d.puzzle_id}"))

    order = sorted(buckets)
    chosen: List[Decision] = []
    index = 0
    while len(chosen) < size and any(len(buckets[key]) > index for key in order):
        for key in order:
            if len(chosen) >= size:
                break
            if len(buckets[key]) > index:
                chosen.append(buckets[key][index])
        index += 1
    chosen.sort(key=lambda d: stable_score(f"{seed}|order|{d.puzzle_id}"))
    return chosen


def public_card(card: dict) -> dict:
    """A card as the rater sees it. model_probability is deliberately dropped."""
    return {key: card[key] for key in ("id", "name", "image_url", "mana_cost", "rarity", "type_line")
            if card.get(key)}


def build_task(decisions: Sequence[Decision], targets_per_decision: int, seed: str) -> Tuple[dict, dict]:
    tasks = []
    key = {}
    for decision in decisions:
        targets = rating_targets(decision, targets_per_decision)
        # Never present the targets in support order; that would leak the answer.
        shown = sorted(targets, key=lambda cid: stable_score(f"{seed}|show|{decision.puzzle_id}|{cid}"))
        tasks.append({
            "puzzle_id": decision.puzzle_id,
            "set_id": decision.set_id,
            "pick_number": decision.pick_number,
            "prior_picks": [public_card(c) for c in decision.prior_picks],
            "pack": [public_card(c) for c in decision.candidates],
            "rate": shown,
        })
        key[decision.puzzle_id] = {
            "set_id": decision.set_id,
            "pick_number": decision.pick_number,
            "trophy_id": decision.trophy_id,
            "leader_id": decision.leader_id,
            "ratios": {cid: round(decision.ratios[cid], 6) for cid in targets},
        }
    return (
        {"study_version": STUDY_VERSION, "seed": seed, "scale": {
            "cap": SCORE_CAP,
            "instructions": "Rate each highlighted card 0-100: how much credit does taking it deserve? "
                            "100 means it is the best pick available. Judge the pack on its own merits.",
        }, "decisions": tasks},
        {"study_version": STUDY_VERSION, "seed": seed, "answers": key},
    )


# --------------------------------------------------------------------------
# comparison
# --------------------------------------------------------------------------

def load_ratings(path: Path) -> List[dict]:
    """Accept either a bare list or the artifact's {ratings:[...]} export."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload.get("ratings", payload) if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        raise ValueError("Ratings must be a list, or an object with a 'ratings' list.")
    cleaned = []
    for row in rows:
        try:
            value = float(row["rating"])
        except (KeyError, TypeError, ValueError):
            continue
        if not 0 <= value <= 100:
            continue
        cleaned.append({"puzzle_id": str(row["puzzle_id"]), "card_id": str(row["card_id"]),
                        "rating": value, "rater": str(row.get("rater") or "anonymous")})
    return cleaned


def joined_rows(ratings: Sequence[dict], key: dict) -> List[dict]:
    answers = key["answers"]
    rows = []
    for rating in ratings:
        answer = answers.get(rating["puzzle_id"])
        if not answer:
            continue
        ratio = answer["ratios"].get(rating["card_id"])
        if ratio is None:
            continue
        rows.append({
            **rating,
            "ratio": float(ratio),
            "is_trophy": rating["card_id"] == answer["trophy_id"],
            "is_leader": rating["card_id"] == answer["leader_id"],
            "severity": severity_of(float(ratio)),
            "pick_band": pick_band(int(answer["pick_number"])),
            "set_id": answer["set_id"],
        })
    return rows


def error_at(rows: Sequence[dict], exponent: float, trophy_rule: bool) -> float:
    """Mean absolute gap between what Pack One awards and what raters gave."""
    if not rows:
        return float("nan")
    total = 0.0
    for row in rows:
        awarded = displayed_score(row["ratio"], trophy_rule and row["is_trophy"], exponent)
        total += abs(awarded - row["rating"])
    return total / len(rows)


def fit_exponent(rows: Sequence[dict], trophy_rule: bool,
                 grid: Sequence[float]) -> Tuple[float, float]:
    best = min(grid, key=lambda e: error_at(rows, e, trophy_rule))
    return best, error_at(rows, best, trophy_rule)


def bootstrap_exponent(rows: Sequence[dict], trophy_rule: bool, grid: Sequence[float],
                       draws: int, seed: int = 20260915) -> List[float]:
    """Resample whole decisions: ratings inside one pack are not independent."""
    by_puzzle: Dict[str, List[dict]] = defaultdict(list)
    for row in rows:
        by_puzzle[row["puzzle_id"]].append(row)
    puzzles = list(by_puzzle)
    if len(puzzles) < 2:
        return []
    rng = random.Random(seed)
    fitted = []
    for _ in range(draws):
        sample: List[dict] = []
        for _ in puzzles:
            sample.extend(by_puzzle[puzzles[rng.randrange(len(puzzles))]])
        fitted.append(fit_exponent(sample, trophy_rule, grid)[0])
    return fitted


def summarize(rows: Sequence[dict], grid: Sequence[float], draws: int) -> dict:
    alternatives = [row for row in rows if not row["is_leader"]]
    best, best_error = fit_exponent(rows, True, grid)
    fitted = bootstrap_exponent(rows, True, grid, draws)
    interval = None
    if fitted:
        ordered = sorted(fitted)
        interval = [ordered[max(0, int(0.025 * len(ordered)) - 1)],
                    ordered[min(len(ordered) - 1, int(0.975 * len(ordered)))]]

    by_severity = {}
    for band, _, _ in SEVERITY_BANDS:
        group = [row for row in rows if row["severity"] == band]
        if not group:
            continue
        by_severity[band] = {
            "n": len(group),
            "mean_rating": round(statistics.fmean(row["rating"] for row in group), 2),
            "today": round(statistics.fmean(
                displayed_score(row["ratio"], row["is_trophy"], 1.0) for row in group), 2),
            "honest": round(statistics.fmean(
                displayed_score(row["ratio"], row["is_trophy"], 2.0) for row in group), 2),
        }

    trophy_rows = [row for row in rows if row["is_trophy"] and not row["is_leader"]]
    return {
        "study_version": STUDY_VERSION,
        "ratings": len(rows),
        "decisions": len({row["puzzle_id"] for row in rows}),
        "raters": sorted({row["rater"] for row in rows}),
        "error_today_exponent_1": round(error_at(rows, 1.0, True), 3),
        "error_honest_exponent_2": round(error_at(rows, 2.0, True), 3),
        "best_fit_exponent": best,
        "best_fit_error": round(best_error, 3),
        "best_fit_ci95": interval,
        "alternatives_only": {
            "n": len(alternatives),
            "error_today_exponent_1": round(error_at(alternatives, 1.0, True), 3),
            "error_honest_exponent_2": round(error_at(alternatives, 2.0, True), 3),
        },
        "trophy_rule": {
            "n": len(trophy_rows),
            "mean_rating_when_trophy_is_not_leader": round(
                statistics.fmean(row["rating"] for row in trophy_rows), 2) if trophy_rows else None,
            "rated_below_90": sum(1 for row in trophy_rows if row["rating"] < 90),
            "note": "Draft Run awards the trophy pick 100 automatically. These are raters' "
                    "judgements of that same card when it is not the model leader.",
        },
        "by_severity": by_severity,
    }


def render(summary: dict) -> str:
    out = ["=" * 72, "GRADING FAIRNESS — what curve do raters imply?", "=" * 72]
    out.append(f"{summary['ratings']} ratings over {summary['decisions']} decisions "
               f"from {len(summary['raters'])} rater(s)")
    out.append("")
    out.append(f"  mean error, today's curve (exponent 1.0) : {summary['error_today_exponent_1']:.2f} points")
    out.append(f"  mean error, honest curve  (exponent 2.0) : {summary['error_honest_exponent_2']:.2f} points")
    ci = summary["best_fit_ci95"]
    ci_text = f"  95% CI [{ci[0]:g}, {ci[1]:g}]" if ci else "  (too few decisions for an interval)"
    out.append(f"  best-fitting exponent                    : {summary['best_fit_exponent']:g}{ci_text}")
    out.append("")
    out.append("By how far the card sits below the pack leader:")
    out.append(f"  {'band':<10}{'n':>6}{'raters say':>12}{'today':>10}{'honest':>10}")
    for band, values in summary["by_severity"].items():
        out.append(f"  {band:<10}{values['n']:>6}{values['mean_rating']:>12.1f}"
                   f"{values['today']:>10.1f}{values['honest']:>10.1f}")
    trophy = summary["trophy_rule"]
    if trophy["n"]:
        out.append("")
        out.append(f"Trophy pick when it is not the model leader ({trophy['n']} rated): "
                   f"raters average {trophy['mean_rating_when_trophy_is_not_leader']:.1f}, "
                   f"{trophy['rated_below_90']} rated below 90. Draft Run awards 100.")
    return "\n".join(out)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def run_sample(args: argparse.Namespace) -> int:
    set_ids = args.sets.split(",") if args.sets else None
    decisions = load_decisions(set_ids)
    if not decisions:
        raise SystemExit("No served decisions found in corpus/draft-run.")
    chosen = stratified_sample(decisions, args.size, args.seed)
    task, key = build_task(chosen, args.targets, args.seed)
    Path(args.task).write_text(json.dumps(task, indent=2) + "\n", encoding="utf-8")
    Path(args.key).write_text(json.dumps(key, indent=2) + "\n", encoding="utf-8")

    spread = Counter((severity_of(d.trophy_ratio), pick_band(d.pick_number)) for d in chosen)
    print(json.dumps({
        "corpus_decisions": len(decisions),
        "sampled": len(chosen),
        "ratings_requested": sum(len(d["rate"]) for d in task["decisions"]),
        "sets": sorted({d.set_id for d in chosen}),
        "spread": {f"{severity}/{band}": count for (severity, band), count in sorted(spread.items())},
        "task_file": args.task,
        "key_file": args.key,
    }, indent=2))
    return 0


def run_compare(args: argparse.Namespace) -> int:
    key = json.loads(Path(args.key).read_text(encoding="utf-8"))
    ratings = load_ratings(Path(args.ratings))
    rows = joined_rows(ratings, key)
    if not rows:
        raise SystemExit("No ratings matched the answer key. Check the files belong together.")
    grid = [round(0.25 * step, 2) for step in range(2, 17)]
    summary = summarize(rows, grid, args.bootstrap_draws)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(render(summary))
    return 0


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    sampler = sub.add_parser("sample", help="Draw a blind rating task from the served corpus")
    sampler.add_argument("--size", type=int, default=40, help="decisions to rate")
    sampler.add_argument("--targets", type=int, default=4, help="cards rated per decision")
    sampler.add_argument("--sets", help="comma-separated set ids; default every set")
    sampler.add_argument("--seed", default="study-1")
    sampler.add_argument("--task", default="grading-task.json")
    sampler.add_argument("--key", default="grading-key.json")
    sampler.set_defaults(func=run_sample)

    compare = sub.add_parser("compare", help="Compare returned ratings against Pack One's curve")
    compare.add_argument("--ratings", required=True)
    compare.add_argument("--key", required=True)
    compare.add_argument("--bootstrap-draws", type=int, default=2000)
    compare.add_argument("--json-out")
    compare.set_defaults(func=run_compare)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
