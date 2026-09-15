#!/usr/bin/env python3
"""Outcome-based card strength from 17Lands game data.

The consensus model measures what strong players take. That is a strong signal
and this does not replace it - it supplies a second, independent one, so the two
can be weighed against each other instead of one being assumed to be the truth.

Three measures per card, all computed here rather than taken from an aggregate:

  GIH WR  win rate in games where the card was in hand (opening hand, drawn, or
          tutored). The familiar number, but it flatters cards that sit in good
          decks, because a better deck wins more whatever it draws.

  GND WR  win rate in games where the card was in the deck and NOT drawn.

  IWD     GIH WR - GND WR: the win rate of decks holding the card, split by
          whether it actually showed up. Much better controlled for deck quality
          than GIH alone, but NOT a clean causal estimate of the card's own
          contribution. It pools across the decks holding a card rather than
          differencing within each, and whether a card was drawn correlates with
          how many cards were drawn, hence with game length and mulligans. Treat
          it as a strong within-deck-quality proxy, not as the card's effect.
          A game-level model with draft fixed effects would be cleaner; the
          columns for it (num_turns, num_mulligans, on_play) are in this data.

Every rate is reported with its sample size and a shrunk estimate, because a
mythic seen 200 times and a common seen 40,000 times are not equal evidence and
must not be weighted as if they were.

Reads a local archive, writes JSON. No database, no network.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import sys
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_replays import stable_fold  # noqa: E402

CARD_GROUPS = ("deck_", "opening_hand_", "drawn_", "tutored_", "sideboard_")
# Shrinkage strength in "pseudo-games" toward the set's own average. Chosen to
# leave a card with a few thousand games essentially unshrunk while pulling a
# card with a few dozen most of the way back to the mean.
PRIOR_GAMES = 400.0
IWD_PRIOR_GAMES = 400.0


def open_text(path: Path):
    if str(path).endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8-sig", newline="")
    return path.open("r", encoding="utf-8-sig", newline="")


def count_of(value: str) -> int:
    """Card columns hold small integers; '' and '0' are the common case."""
    if not value or value == "0":
        return 0
    try:
        return max(0, int(float(value)))
    except ValueError:
        return 0


def column_index(header: Sequence[str]) -> Tuple[Dict[str, Dict[str, int]], Dict[str, int]]:
    """card name -> {group: column index}, plus the plain columns we need."""
    cards: Dict[str, Dict[str, int]] = {}
    for position, name in enumerate(header):
        for group in CARD_GROUPS:
            if name.startswith(group):
                cards.setdefault(name[len(group):], {})[group] = position
                break
    plain = {name: position for position, name in enumerate(header)
             if name in {"won", "draft_id", "user_game_win_rate_bucket",
                         "user_n_games_bucket", "main_colors", "rank"}}
    missing = {"won"} - set(plain)
    if missing:
        raise ValueError(f"game data is missing required columns: {sorted(missing)}")
    if not cards:
        raise ValueError("game data has no per-card columns")
    return cards, plain


def tally(archive: Path, folds: int = 1) -> Tuple[List[Dict[str, Dict[str, int]]], List[int], List[int]]:
    """One pass, tallied per fold of draft_id.

    Cross-fitting matters more here than the per-draft share of a card's sample
    suggests. Every draft contributes its own wins to the cards it played, and
    is then scored on whether it picked high-win-rate cards; all drafts do this
    at once, so the bias does not average out and points the same way as the
    effect being measured. Splitting by draft and scoring each fold from the
    others removes it. GIH is hit hardest - IWD is a difference, so a draft's
    wins lift both halves and partly cancel.
    """
    with open_text(archive) as handle:
        reader = csv.reader(handle)
        header = next(reader)
        cards, plain = column_index(header)
        won_at = plain["won"]
        draft_at = plain.get("draft_id")
        if folds > 1 and draft_at is None:
            raise ValueError("cross-fitting needs a draft_id column")

        # Flatten to parallel lists so the hot loop avoids dict lookups.
        names: List[str] = []
        deck_at: List[int] = []
        hand_at: List[Tuple[int, ...]] = []
        for name, groups in cards.items():
            if "deck_" not in groups:
                continue
            in_hand = tuple(groups[g] for g in ("opening_hand_", "drawn_", "tutored_")
                            if g in groups)
            if not in_hand:
                continue
            names.append(name)
            deck_at.append(groups["deck_"])
            hand_at.append(in_hand)

        size = len(names)
        blank = lambda: [[0] * size for _ in range(folds)]
        gih_games, gih_wins = blank(), blank()
        gnd_games, gnd_wins = blank(), blank()
        deck_games, deck_wins = blank(), blank()
        game_wins = [0] * folds
        rows = [0] * folds
        seen_fold: Dict[str, int] = {}

        for values in reader:
            if len(values) != len(header):
                continue
            won = 1 if values[won_at] in ("True", "true", "1") else 0
            if folds > 1:
                draft_id = values[draft_at]
                fold = seen_fold.get(draft_id)
                if fold is None:
                    fold = stable_fold(draft_id, folds)
                    seen_fold[draft_id] = fold
            else:
                fold = 0
            rows[fold] += 1
            game_wins[fold] += won
            for index in range(size):
                if not count_of(values[deck_at[index]]):
                    continue
                deck_games[fold][index] += 1
                deck_wins[fold][index] += won
                drawn = 0
                for position in hand_at[index]:
                    drawn += count_of(values[position])
                if drawn:
                    gih_games[fold][index] += 1
                    gih_wins[fold][index] += won
                else:
                    gnd_games[fold][index] += 1
                    gnd_wins[fold][index] += won

    per_fold = []
    for fold in range(folds):
        result = {}
        for index, name in enumerate(names):
            if not deck_games[fold][index]:
                continue
            result[name] = {
                "gih_games": gih_games[fold][index], "gih_wins": gih_wins[fold][index],
                "gnd_games": gnd_games[fold][index], "gnd_wins": gnd_wins[fold][index],
                "deck_games": deck_games[fold][index], "deck_wins": deck_wins[fold][index],
            }
        per_fold.append(result)
    return per_fold, rows, game_wins


def merge_excluding(per_fold: Sequence[Dict[str, Dict[str, int]]], skip: int
                    ) -> Dict[str, Dict[str, int]]:
    """Every fold but `skip`, summed. This is the table used to score fold skip."""
    merged: Dict[str, Dict[str, int]] = {}
    for fold, table in enumerate(per_fold):
        if fold == skip:
            continue
        for name, counts in table.items():
            row = merged.setdefault(name, {k: 0 for k in counts})
            for key, value in counts.items():
                row[key] += value
    return merged


def shrink(wins: int, games: int, mean: float, prior: float) -> float:
    return (wins + prior * mean) / (games + prior) if games or prior else mean


def summarise(counts: Dict[str, Dict[str, int]], rows: int, game_wins: int) -> dict:
    # The set's true game win rate, over game rows. Summing each card's
    # deck-games instead would weight a deck by how many distinct cards it
    # played, and GIH excess is centred on this number.
    baseline = game_wins / rows if rows else 0.5
    total_games = sum(c["deck_games"] for c in counts.values())

    cards = {}
    for name, c in counts.items():
        gih = c["gih_wins"] / c["gih_games"] if c["gih_games"] else None
        gnd = c["gnd_wins"] / c["gnd_games"] if c["gnd_games"] else None
        shrunk_gih = shrink(c["gih_wins"], c["gih_games"], baseline, PRIOR_GAMES)
        shrunk_gnd = shrink(c["gnd_wins"], c["gnd_games"], baseline, PRIOR_GAMES)
        # Both halves shrink toward the same baseline, so an unsupported card's
        # IWD collapses to zero rather than to a large spurious swing.
        support = min(c["gih_games"], c["gnd_games"])
        cards[name] = {
            "gih_games": c["gih_games"],
            "gnd_games": c["gnd_games"],
            "deck_games": c["deck_games"],
            "gih_wr": round(gih, 5) if gih is not None else None,
            "gnd_wr": round(gnd, 5) if gnd is not None else None,
            "gih_wr_shrunk": round(shrunk_gih, 5),
            "iwd": round(gih - gnd, 5) if (gih is not None and gnd is not None) else None,
            "iwd_shrunk": round((shrunk_gih - shrunk_gnd)
                                * (support / (support + IWD_PRIOR_GAMES)), 5),
            "support_games": support,
        }
    return {"baseline_win_rate": round(baseline, 5),
            "game_rows": rows, "deck_card_games": total_games, "cards": cards}


def run(args: argparse.Namespace) -> int:
    folds = max(1, args.folds)
    per_fold, rows, game_wins = tally(Path(args.archive), folds)
    if folds == 1:
        summary = summarise(per_fold[0], rows[0], game_wins[0])
    else:
        # One table per fold, each built from the other folds only.
        summary = {"folds": folds, "tables": {}}
        for fold in range(folds):
            summary["tables"][str(fold)] = summarise(
                merge_excluding(per_fold, fold),
                sum(r for f, r in enumerate(rows) if f != fold),
                sum(w for f, w in enumerate(game_wins) if f != fold))
        # A pooled view for reporting; never used for scoring.
        summary.update(summarise(merge_excluding(per_fold, -1), sum(rows), sum(game_wins)))
    summary["set_id"] = args.set_id
    summary["archive"] = Path(args.archive).name
    summary["game_rows"] = sum(rows)
    Path(args.out).write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    ranked = sorted((c for c in summary["cards"].items() if c[1]["iwd"] is not None),
                    key=lambda item: -item[1]["iwd_shrunk"])
    print(json.dumps({
        "set_id": args.set_id, "game_rows": sum(rows), "folds": folds,
        "cards": len(summary["cards"]),
        "baseline_win_rate": summary["baseline_win_rate"],
        "median_support_games": sorted(c["support_games"] for c in summary["cards"].values())
        [len(summary["cards"]) // 2],
        "out": args.out,
    }, indent=2))
    print("\nhighest measured impact (shrunk IWD):", file=sys.stderr)
    for name, row in ranked[:8]:
        print(f"  {name[:38]:<38} IWD {row['iwd_shrunk']:+.4f}  "
              f"GIH {row['gih_wr']:.4f}  n={row['support_games']}", file=sys.stderr)
    print("lowest:", file=sys.stderr)
    for name, row in ranked[-5:]:
        print(f"  {name[:38]:<38} IWD {row['iwd_shrunk']:+.4f}  "
              f"GIH {row['gih_wr']:.4f}  n={row['support_games']}", file=sys.stderr)
    return 0


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--archive", required=True, help="game_data_public.<SET>.PremierDraft.csv.gz")
    parser.add_argument("--set-id", required=True)
    parser.add_argument("--folds", type=int, default=1,
                        help="cross-fit by draft_id: emit one table per fold, each built "
                             "from the other folds, so a draft is never scored using its "
                             "own games")
    parser.add_argument("--out", required=True)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    return run(parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
