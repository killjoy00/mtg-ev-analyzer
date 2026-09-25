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
from typing import Dict, FrozenSet, List, Mapping, Optional, Sequence, Set, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_replays import open_text  # noqa: E402
from card_outcomes import count_of  # noqa: E402
from eval_model import Cache, cache_identity, draft_split, guard_test_split  # noqa: E402

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
# Distinguishes "this card is not in the table" from "this card is in the table
# with unknown colours". Both decline the colour judgement, but conflating them
# with frozenset() is the bug this whole three-state scheme exists to prevent.
MISSING = object()
# What the serialised table writes for each of the three states.
COLOURLESS_MARK, UNKNOWN_MARK = "C", "?"


def colour_mark(value) -> str:
    """Serialise one of the three colour states. Unknown must not read as 'C'."""
    if value is MISSING or value is None:
        return UNKNOWN_MARK
    return "".join(sorted(value)) or COLOURLESS_MARK


def parse_colour_mark(mark: Optional[str]) -> Optional[FrozenSet[str]]:
    """Read a serialised table back into the three states."""
    if not mark or mark == UNKNOWN_MARK:
        return None
    if mark == COLOURLESS_MARK:
        return frozenset()
    if any(c not in COLOURS for c in mark):
        return None
    return frozenset(c for c in mark if c in COLOURS)


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

def scan_deck_observations(archive: Path, keep: Optional[Set[str]] = None
                           ) -> Tuple[Dict[str, set], Dict[str, str]]:
    """Read deck membership and one deterministic colour identity per draft.

    Keeping the per-draft observations separate is important for cross-fold
    production builds: each fold can derive its own colour statistics from its
    permitted training IDs without rereading the multi-million-row game archive.
    """
    played: Dict[str, set] = defaultdict(set)
    seen_draft_colours: Dict[str, Counter] = defaultdict(Counter)
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
                if count_of(values[position]) and name not in cards:
                    cards.add(name)

    # Counter.most_common is deterministic because the source row order is
    # deterministic and Counter preserves first-seen order for ties.
    main_by_draft = {
        draft_id: counter.most_common(1)[0][0]
        for draft_id, counter in seen_draft_colours.items()
        if counter
    }
    return dict(played), main_by_draft


def colour_hits_for_drafts(played: Mapping[str, set],
                           main_by_draft: Mapping[str, str],
                           keep: Optional[Set[str]] = None
                           ) -> Dict[str, Counter]:
    """Aggregate card-colour evidence from an explicit set of draft IDs."""
    colour_hits: Dict[str, Counter] = defaultdict(Counter)
    for draft_id in sorted(played):
        if keep is not None and draft_id not in keep:
            continue
        main = main_by_draft.get(draft_id)
        if main is None:
            continue
        for card in sorted(played[draft_id]):
            colour_hits[card][main] += 1
    return dict(colour_hits)


def scan_decks(archive: Path, keep: Optional[Set[str]] = None
               ) -> Tuple[Dict[str, set], Dict[str, Counter]]:
    """draft_id -> cards played, and card -> counter of its decks' colours.

    `keep` restricts every derived statistic to those drafts. This wrapper is
    retained for the independent evaluation harness; production cross-fold
    builds use scan_deck_observations once and aggregate each fold explicitly.
    """
    played, main_by_draft = scan_deck_observations(archive, keep)
    return played, colour_hits_for_drafts(played, main_by_draft, keep)


def card_colours(colour_hits: Dict[str, Counter]) -> Dict[str, Optional[FrozenSet[str]]]:
    """A card's colours, inferred from the decks that played it.

    THREE states, not two. This returned an empty frozenset both for a card that
    is genuinely colourless and for a card with too little evidence to say - and
    commitment() reads empty as "playable from anywhere, count the whole pool".
    One deck either side of the threshold therefore moved a red card from "the
    entire blue pool supports me" to "none of it does", and it did so exactly
    where the evidence was thinnest. On a new set, where most cards sit under
    the threshold, nearly every card took the wrong branch.

      frozenset({...})  known colours
      frozenset()       known to be colourless - an artifact or land appears in
                        decks of every colour, so no colour clears the share
                        threshold. This is a real finding, not a missing one.
      None              unknown; too few decks to say anything

    Gold cards are handled correctly by the share rule and need no special case:
    every deck playing a WU card is a W deck and a U deck, so both shares reach
    1.0 and both clear the threshold.
    """
    result: Dict[str, Optional[FrozenSet[str]]] = {}
    for card, counter in colour_hits.items():
        total = sum(counter.values())
        if total < MIN_DECKS_FOR_COLOUR:
            result[card] = None
            continue
        share = {colour: sum(count for main, count in counter.items() if colour in main) / total
                 for colour in COLOURS}
        result[card] = frozenset(c for c, value in share.items() if value >= COLOUR_THRESHOLD)
    return result


# --------------------------------------------------------------------------
# pass 3: commitment at each pick, joined to whether the card was played
# --------------------------------------------------------------------------

def commitment(pool: Dict[str, int], colours: Mapping[str, Optional[FrozenSet[str]]],
               card: str) -> Optional[int]:
    """How many pool cards share a colour with this card, or None if unknown.

    A genuinely colourless card is playable from any pool, so it is credited
    with the whole pool. A card whose colours we could not determine gets None,
    and every caller must then decline to make a colour judgement rather than
    invent one - absence of evidence produces absence of adjustment.

    A pool card of unknown colour likewise contributes nothing to the match: it
    might share a colour, and guessing that it does would recreate the same bug
    one level down.
    """
    wanted = colours.get(card, MISSING)
    if wanted is MISSING or wanted is None:
        return None
    if not wanted:
        return sum(pool.values())
    total = 0
    for pool_card, count in pool.items():
        known = colours.get(pool_card)
        if known and known & wanted:
            total += count
    return total


def observe_examples(pairs, played: Dict[str, set],
                     colours: Mapping[str, Optional[FrozenSet[str]]]
                     ) -> Tuple[Dict[Tuple[str, str], List[int]],
                                Dict[str, List[int]],
                                Dict[Tuple[str, str], List[int]]]:
    """The estimator, over any iterable of (draft_id, example).

    Takes examples rather than a Cache so the replay builder can feed it its
    own, and so the caller decides which drafts are admissible instead of that
    being wired to one split scheme.
    """
    by_bucket: Dict[Tuple[str, str], List[int]] = defaultdict(list)
    by_card: Dict[str, List[int]] = defaultdict(list)
    by_stage: Dict[Tuple[str, str], List[int]] = defaultdict(list)
    for draft_id, example in pairs:
        deck = played.get(draft_id)
        if deck is None:
            continue
        card = example.historical_pick
        flag = 1 if card in deck else 0
        by_card[card].append(flag)
        matched = commitment(example.pool, colours, card)
        if matched is None:
            # Unknown colours: the pick still counts toward the card's overall
            # play rate, but it cannot be filed under a commitment level without
            # inventing one.
            continue
        commit = commit_bucket(matched)
        by_bucket[(card, commit)].append(flag)
        # Card identity dropped: this is the format's curve, cut by how far into
        # the draft the pick was. "*" is the whole stage, whatever the colours.
        stage = stage_bucket(sum(example.pool.values()))
        by_stage[(stage, commit)].append(flag)
        by_stage[(stage, "*")].append(flag)
    return by_bucket, by_card, by_stage


def observe(cache: Cache, played: Dict[str, set],
            colours: Mapping[str, Optional[FrozenSet[str]]],
            split: Optional[str] = None):
    """Cache-shaped wrapper. Estimating play rates on the same drafts the model
    is later scored against would let it learn from its own evaluation set, so
    the CLI fits this on train only."""
    return observe_examples(
        ((draft_id, example) for draft_id, example in cache.examples()
         if split is None or draft_split(draft_id) == split),
        played, colours)


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
            "colours": colour_mark(colours.get(card, MISSING)),
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
    guard_test_split(args.split, args.final_test)
    split = None if args.split == "all" else args.split
    keep = set(cache.split_drafts(split)) if split else None
    played, colour_hits = scan_decks(Path(args.games), keep)
    colours = card_colours(colour_hits)
    by_bucket, by_card, by_stage = observe(cache, played, colours, split)
    if not by_card:
        raise SystemExit("No drafts in the cache matched the game data. Same set?")
    summary = estimate(by_bucket, by_card, colours, by_stage)
    summary["set_id"] = cache.set_id
    summary["drafts_with_decks"] = len(played)
    summary["split"] = split or "all"
    summary["fit_schema_version"] = 2
    summary["cache_identity"] = cache_identity(cache)
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
    # Defaulted to no restriction, which means every split including test. The
    # pipeline always passed train, so nothing was actually contaminated - but a
    # standalone invocation was one omitted flag away from building a table out
    # of the data the model is later scored on. Train is the only sane default;
    # "all" stays reachable for a deliberate descriptive run.
    parser.add_argument("--split", default="train",
                        choices=["train", "validation", "test", "all"],
                        help="restrict to one split of the cache (default: train, so "
                             "the estimate never sees a draft the model is scored on)")
    parser.add_argument("--final-test", action="store_true",
                        help="required alongside --split test")
    parser.add_argument("--out", required=True)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    return run(parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
