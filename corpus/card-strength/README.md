# Card strength tables

One table per set with a Premier Draft trophy archive in
`corpus/trophy-decks/coverage.json` (31 sets). The latest-set Daily uses them
to rank contested decisions by stakes (`puzzle-selection.mjs`,
`docs/LATEST-DAILY-SELECTION.md`).

## Measure

`cards` maps each card name to `[points, in_hand_games]`. Points are the card's
game-in-hand win rate, shrunk toward the set average with 400 pseudo-games,
minus the set's average game win rate, in percentage points
(`strength_version` `gih-shrunk-400-v1`; `scripts/card_outcomes.py`). A card
seen in few games stays near zero. Basic lands are omitted.

This is the card-strength benchmark's `A_gih` measure
(`research/card-strength-v1-results/`), computed on every game in the archive
instead of the benchmark's training split. On the six sets both cover, the two
correlate at 0.987–0.993. It describes winning decks that played a card; it is
not a causal estimate of what the card adds.

## Source and license

Derived from [17Lands public game data](https://www.17lands.com/public_datasets),
which 17Lands licenses under the
[Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/)
unless a dataset says otherwise. Changes: game rows aggregated into one
smoothed per-card statistic. Each table records the archive URL, ETag,
Last-Modified, size and SHA-256 it was built from. When these tables were
built, every archive matched the SHA-256 recorded for the trophy decklists.

## Rebuild

```sh
python3 scripts/build_card_strength_tables.py                 # every set
python3 scripts/build_card_strength_tables.py --sets fra hob  # some sets
```

Archives are downloaded to a temporary directory and deleted. 17Lands
refreshes archives in place, so a rebuild can change values; review the diff.
After a changed table is merged, rescore that set's puzzles with the
"Score puzzle selection" workflow (stored rows record the table's SHA-256, so
only stale rows are rewritten).
