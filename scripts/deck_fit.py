#!/usr/bin/env python3
"""How likely a card is to actually make your deck, given the pool you have.

IWD says how much a card helps when you draw it. It cannot say whether you will
ever draw it, because it does not know your colours: blending it raw into a
pool-aware pick model reverses that model's judgement at later picks, where the
pool is what decides castability.

This supplies the missing half. A pick is worth

    P(card reaches your deck | pool so far)  x  impact(card once played)

and the left factor is measured here, not assumed. Three passes, all over data
already on disk:

  1. From game data, per draft: which cards were played, and the deck's colours.
  2. Card colours are derived from that, not from an external card database. A
     mono-red card shows up almost only in decks containing red; a land or
     artifact shows up everywhere and comes out colourless, which is correct -
     it fits any pool.
  3. From the draft archive joined on draft_id: at each pick, how committed the
     pool already is to the card's colours, and whether the card was in fact
     played. The play rate by commitment is the estimate, shrunk per card toward
     its own overall play rate so a card seen rarely at some commitment level
     does not invent a number.

Reads local files, writes JSON. No database, no served corpus.
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, FrozenSet, List, Optional, Sequence, Set, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_replays import open_text  # noqa: E402
from eval_model import Cache, draft_split  # noqa: E402

COLOURS = ("W", "U", "B", "R", "G")
# A card counts as belonging to a colour when it is almost never played outside
# it. Lands and artifacts clear no colour and stay flexible, which is right.
COLOUR_THRESHOLD = 0.90
MIN_DECKS_FOR_COLOUR = 30
# Shrinkage of a per-commitment play rate toward the card's own overall rate.
PLAY_PRIOR = 25.0
COMMIT_BUCKETS = ((0, 0, "0"), (1, 2, "1-2"), (3, 5, "3-5"), (6, 9, "6-9"), (10, 10 ** 9, "10+"))
# How far into the draft the pick is, measured by the pool it was taken from -
# which is exactly the number of picks already made. Commitment cannot exceed
# it, so the two are correlated by construction and the marginal commitment
# curve reads draft stage as well as colour fit. Conditioning on this asks the
# question that was wanted: holding the number of cards taken fixed, does it
# matter how many of them share this card's colour?
STAGE_BUCKETS = ((0, 0, "s0"), (1, 2, "s1-2"), (3, 5, "s3-5"), (6, 9, "s6-9"),
                 (10, 19, "s10-19"), (20, 10 ** 9, "s20+"))
# Below this many picks a (stage, commitment) cell is not reported at all; the
# consumer falls back to the marginal curve rather than to a noisy cell.
MIN_STAGE_CELL = 200


def _bucket(buckets, count: int) -> str:
    for low, high, name in buckets:
        if low <= count <= high:
            return name
    return buckets[-1][2]


def commit_bucket(count: int) -> str:
    return _bucket(COMMIT_BUCKETS, count)


def stage_bucket(pool_size: int) -> str:
    return _bucket(STAGE_BUCKETS, pool_size)


# --------------------------------------------------------------------------
# pass 1 and 2: decks and card colours, from game data
# --------------------------------------------------------------------------

def scan_decks(archive: Path, keep: Optional[Set[str]] = None
               ) -> Tuple[Dict[str, set], Dict[str, Counter]]:
    """draft_id -> cards played, and card -> counter of its decks' colours.

    `keep` restricts both to those drafts. Colour identity is a fixed property
    of a card, so reading it from every deck in the set would be a leak with no
    plausible path to inflating anything - but "no plausible path" is not the
    same as none, and the caller can afford to hold the split.
    """
    played: Dict[str, set] = defaultdict(set)
    colour_hits: Dict[str, Counter] = defaultdict(Counter)
    with open_text(archive) as handle:
        reader = csv.reader(handle)
        header = next(reader)
        deck_at = [(position, name[len("deck_"):]) for position, name in enumerate(header)
                   if name.startswith("deck_")]
        if not deck_at:
            raise ValueError("game data has no deck_* columns")
        index = {name: position for position, name in enumerate(header)}
        for required in ("draft_id", "main_colors"):
            if required not in index:
                raise ValueError(f"game data has no {required} column")
        draft_at, colours_at = index["draft_id"], index["main_colors"]

        seen_draft_colours: Dict[str, Counter] = defaultdict(Counter)
        for values in reader:
            if len(values) != len(header):
                continue
            draft_id = values[draft_at].strip()
            if not draft_id or (keep is not None and draft_id not in keep):
                continue
            main = "".join(c for c in values[colours_at].strip().upper() if c in COLOURS)
            seen_draft_colours[draft_id][main] += 1
            cards = played[draft_id]
            for position, name in deck_at:
                value = values[position]
                if value and value != "0" and name not in cards:
                    cards.add(name)

    # One deck identity per draft: the build its games were most often played with.
    for draft_id, counter in seen_draft_colours.items():
        main = counter.most_common(1)[0][0]
        for card in played[draft_id]:
            colour_hits[card][main] += 1
    return dict(played), dict(colour_hits)


def card_colours(colour_hits: Dict[str, Counter]) -> Dict[str, FrozenSet[str]]:
    """A card's colours, inferred from the decks that played it."""
    result: Dict[str, FrozenSet[str]] = {}
    for card, counter in colour_hits.items():
        total = sum(counter.values())
        if total < MIN_DECKS_FOR_COLOUR:
            result[card] = frozenset()
            continue
        share = {colour: sum(count for main, count in counter.items() if colour in main) / total
                 for colour in COLOURS}
        result[card] = frozenset(c for c, value in share.items() if value >= COLOUR_THRESHOLD)
    return result


# --------------------------------------------------------------------------
# pass 3: commitment at each pick, joined to whether the card was played
# --------------------------------------------------------------------------

def commitment(pool: Dict[str, int], colours: Dict[str, FrozenSet[str]],
               card: str) -> int:
    """How many pool cards share a colour with this card.

    A colourless card is playable from any pool, so it is credited with the
    whole pool rather than with nothing.
    """
    wanted = colours.get(card) or frozenset()
    if not wanted:
        return sum(pool.values())
    total = 0
    for pool_card, count in pool.items():
        if colours.get(pool_card, frozenset()) & wanted:
            total += count
    return total


def observe(cache: Cache, played: Dict[str, set], colours: Dict[str, FrozenSet[str]],
            split: Optional[str] = None
            ) -> Tuple[Dict[Tuple[str, str], List[int]], Dict[str, List[int]]]:
    """(card, commitment bucket) -> played flags, and card -> played flags.

    `split` restricts to one split of the cache. Estimating play rates on the
    same drafts the value model is later scored against would let the model
    learn from its own evaluation set, so the pipeline fits this on train only.
    """
    by_bucket: Dict[Tuple[str, str], List[int]] = defaultdict(list)
    by_card: Dict[str, List[int]] = defaultdict(list)
    by_stage: Dict[Tuple[str, str], List[int]] = defaultdict(list)
    for draft_id, example in cache.examples():
        deck = played.get(draft_id)
        if deck is None:
            continue
        if split is not None and draft_split(draft_id) != split:
            continue
        card = example.historical_pick
        flag = 1 if card in deck else 0
        commit = commit_bucket(commitment(example.pool, colours, card))
        by_bucket[(card, commit)].append(flag)
        by_card[card].append(flag)
        # Card identity dropped: this is the format's curve, cut by how far into
        # the draft the pick was. "*" is the whole stage, whatever the colours.
        stage = stage_bucket(sum(example.pool.values()))
        by_stage[(stage, commit)].append(flag)
        by_stage[(stage, "*")].append(flag)
    return by_bucket, by_card, by_stage


def estimate(by_bucket, by_card, colours, by_stage=None) -> dict:
    overall = {card: statistics.fmean(flags) for card, flags in by_card.items() if flags}
    grand = statistics.fmean(overall.values()) if overall else 0.5
    rows: Dict[str, dict] = {}
    for card, flags in by_card.items():
        base = overall[card]
        buckets = {}
        for _, _, name in COMMIT_BUCKETS:
            observed = by_bucket.get((card, name))
            if not observed:
                continue
            # Shrink toward this card's own overall play rate, so a bucket seen
            # a handful of times reports close to the card's usual behaviour.
            buckets[name] = round(
                (sum(observed) + PLAY_PRIOR * base) / (len(observed) + PLAY_PRIOR), 5)
        rows[card] = {
            "play_rate": round(base, 5),
            "observations": len(flags),
            "colours": "".join(sorted(colours.get(card, frozenset()))) or "C",
            "by_commitment": buckets,
        }

    # The same curve with the card identity dropped: how much does colour
    # commitment alone move the odds a pick is played? A model built on this
    # needs only which colours a card is - something already on the card - and
    # never has to ship a per-card table, so it is worth knowing how much of the
    # per-card version's value is just this.
    pooled: Dict[str, dict] = {}
    for (_, name), observed in by_bucket.items():
        cell = pooled.setdefault(name, {"played": 0, "picks": 0})
        cell["played"] += sum(observed)
        cell["picks"] += len(observed)
    format_curve = {name: round(cell["played"] / cell["picks"], 5)
                    for name, cell in pooled.items() if cell["picks"]}
    overall_rate = (sum(c["played"] for c in pooled.values())
                    / sum(c["picks"] for c in pooled.values())) if pooled else 0.5

    # The same curve again, this time held at a fixed point in the draft.
    # Commitment can never exceed the pool it is counted from, so the marginal
    # curve above confounds "your colours are settled" with "you are 20 picks
    # in" - and the two pull opposite ways, because a late pick is more often a
    # card that gets cut. Cells thinner than MIN_STAGE_CELL are dropped so the
    # consumer falls back to the marginal curve rather than to noise.
    stage_curve: Dict[str, Dict[str, float]] = {}
    stage_picks: Dict[str, Dict[str, int]] = {}
    for (stage, commit), observed in sorted((by_stage or {}).items()):
        if len(observed) < MIN_STAGE_CELL:
            continue
        stage_curve.setdefault(stage, {})[commit] = round(statistics.fmean(observed), 5)
        stage_picks.setdefault(stage, {})[commit] = len(observed)

    return {"grand_play_rate": round(grand, 5),
            "play_rate": round(overall_rate, 5),
            "by_commitment": format_curve,
            "bucket_picks": {name: cell["picks"] for name, cell in pooled.items()},
            "by_stage": stage_curve,
            "stage_picks": stage_picks,
            "cards": rows}


def run(args: argparse.Namespace) -> int:
    cache = Cache.load(Path(args.cache))
    keep = set(cache.split_drafts(args.split)) if args.split else None
    played, colour_hits = scan_decks(Path(args.games), keep)
    colours = card_colours(colour_hits)
    by_bucket, by_card, by_stage = observe(cache, played, colours, args.split)
    if not by_card:
        raise SystemExit("No drafts in the cache matched the game data. Same set?")
    summary = estimate(by_bucket, by_card, colours, by_stage)
    summary["set_id"] = cache.set_id
    summary["drafts_with_decks"] = len(played)
    summary["split"] = args.split or "all"
    summary["matched_drafts"] = len({d for d, _ in cache.examples() if d in played})
    Path(args.out).write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    spread = Counter(row["colours"] for row in summary["cards"].values())
    example = max(summary["cards"].items(),
                  key=lambda item: item[1]["observations"] if item[1]["by_commitment"] else 0)
    print(json.dumps({
        "set_id": cache.set_id,
        "cards": len(summary["cards"]),
        "drafts_with_decks": summary["drafts_with_decks"],
        "matched_drafts": summary["matched_drafts"],
        "grand_play_rate": summary["grand_play_rate"],
        "colour_spread": dict(spread.most_common()),
        "out": args.out,
    }, indent=2))
    print(f"\nplay rate by pool commitment, {example[0]} ({example[1]['colours']}):",
          file=sys.stderr)
    for name, value in example[1]["by_commitment"].items():
        print(f"  pool cards sharing its colour {name:>5}  ->  played {value:.3f}", file=sys.stderr)
    return 0


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--games", required=True, help="game_data_public.<SET>.PremierDraft.csv.gz")
    parser.add_argument("--cache", required=True, help="a draft cache from eval_model.py extract")
    parser.add_argument("--split", choices=["train", "validation", "test"],
                        help="restrict to one split of the cache; use train so the "
                             "estimate never sees a draft the value model is scored on")
    parser.add_argument("--out", required=True)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    return run(parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
