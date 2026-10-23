# Trophy deck context

The versioned, server-only catalogs cover **110,232 of 110,413 source drafts
(99.8361%) across all 31 current environments**, including Powered Cube.
`coverage.json` records source counts, archive hashes and unavailable-record
reasons. The original FRA catalog remains unchanged: 1,029 of 1,030 sources.

Each entry contains one exact main deck and sideboard from the last observed
game. When the archive publishes game times, ordering uses game time, match,
game, then build index. Older archives omit game time; their match, game and
build sequence determines the last game, and the timestamp remains null.
Builds are never combined. Sources with no game record or an incomplete final
deck have no link; an earlier build or another drafter is never substituted.

Source: [17Lands public datasets](https://www.17lands.com/public_datasets),
using the catalog published October 20, 2026. Exact per-archive publication
dates and bytes are pinned in `coverage.json`. Used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
"Final" means the last recorded game deck, not a guaranteed submitted event-final
build. Traditional decks can include last-game sideboarding.

Card display data comes from [Scryfall](https://scryfall.com/docs/api), including
front/back images where available. `card-name-variants.json` retains the exact
names and display metadata already used by Pack One for 12 legacy, Arena or
encoding variants. Their mana values use the recorded front-face mana costs;
no card identity is guessed from a similar name. Case-only Scryfall name
differences are matched without changing the name in the game archive.

## Build

1. Export distinct set, format and source-hash metadata for the current parent
   corpus and its Live components. Do not export player identities or puzzle
   payloads. Store each set's inventory as `SET_ID.json`.
2. Pin official game archive URLs, sizes and ETags from the 17Lands dataset
   catalog in a manifest, then run:

   ```sh
   python scripts/backfill-trophy-decks.py --manifest ARCHIVES.json \
     --inventories SOURCE_INVENTORIES --output-dir PRIVATE_BUILD_INPUTS
   ```

   The runner validates and extracts archives resumably. Coverage reports
   distinguish absent records from incomplete or ambiguous final records.
   Normalized output retains raw draft IDs only as private build inputs;
   never commit these inputs or send them to the browser.
3. Collect the named cards' Scryfall metadata and required name variants.
   Generate each catalog:

   ```sh
   python scripts/build-trophy-deck-catalog.py --set-id SET_ID \
     --version SET_ID-SOURCE_DATE-v1 --decks MATCHED_DECKS.json \
     --cards SCRYFALL_CARDS.json \
     --supplemental-cards corpus/trophy-decks/card-name-variants.json \
     --output corpus/trophy-decks/SET_ID.mjs
   ```

   Include only sources matched to Pack One. The builder validates quantities,
   minimum sizes, source aliases, card metadata and set identity. It strips raw
   draft identifiers from the serving output.
4. Update the lazy registry and aggregate coverage. Run the catalog integrity,
   source isolation, owned-run and locked-pick checks before the normal
   development-then-production release.

Catalogs are imported and decoded by set when needed. Bounded caches retain
at most six decoded catalogs, 1,024 availability results and 128 expanded decks.
Answers contain only an availability flag. Full decklists are returned only
after the owning player locks the corresponding pick. Refreshes do not change
scoring, source eligibility, fixed Dailies or stored answers.
