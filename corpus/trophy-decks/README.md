# Trophy deck context

The versioned, server-only catalogs cover **110,373 of 110,554 source drafts
(99.8363%) across all 31 current environments**, including Powered Cube.
`coverage.json` records source counts, archive hashes and unavailable-record
reasons. FRA includes the separately approved Traditional supplement from
#1303. Including its deck data does not activate or publish that component.

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
   corpus, its Live components, and the approved FRA Traditional supplement. Do not export player identities or puzzle
   payloads. Store each set's inventory as `SET_ID.json`.
2. Pin official game archive URLs, sizes and ETags from the 17Lands dataset
   catalog in a manifest, then run:

   ```sh
   python scripts/backfill-trophy-decks.py --manifest ARCHIVES.json \
     --inventories SOURCE_INVENTORIES --output-dir PRIVATE_BUILD_INPUTS
   ```

   The runner validates and extracts archives resumably. Coverage reports
   distinguish absent records from incomplete or ambiguous final records.
   Normalized output remains a private build input. The catalog retains each
   matched public draft's canonical `https://www.17lands.com/draft/<id>` URL;
   it does not include account identities or the normalized input records.
3. Collect the named cards' Scryfall metadata and required name variants.
   Generate each catalog:

   ```sh
   python scripts/build-trophy-deck-catalog.py --set-id SET_ID \
     --version SET_ID-SOURCE_DATE-v1 --decks MATCHED_DECKS.json \
     --cards SCRYFALL_CARDS.json --sources ALL_STORED_SET_SOURCES.json \
     --supplemental-cards corpus/trophy-decks/card-name-variants.json \
     --output corpus/trophy-decks/SET_ID.mjs
   ```

   Include only sources matched to Pack One. The builder validates quantities,
   minimum sizes, source aliases, card metadata and set identity. The source
   inventory must include all stored corpus versions, so older runs keep their
   deck links. Unused hash forms are omitted to keep the function deployable.
   It keeps the canonical public draft URL for the post-pick deck dialog.
4. Update the lazy registry and aggregate coverage. Run the catalog integrity,
   source isolation, owned-run and locked-pick checks before the normal
   development-then-production release.

Puzzle imports must check deck coverage every time; see "Trophy decklist check" in
`docs/CORPUS-OPERATIONS.md`. When an import reports puzzles without decks, rebuild
the affected set's catalog from this procedure.

Catalogs use Node's built-in Brotli compression and are imported and decoded
by set when needed. Building them requires Node.js as well as Python. The
function build verifies its compressed archive against the pinned deployment
tool's 10 MiB limit before any deployment. Bounded caches retain
at most six decoded catalogs, 1,024 availability results and 128 expanded decks.
Answers contain only an availability flag. Full decklists are returned only
after the owning player locks the corresponding pick. Refreshes do not change
scoring, source eligibility, fixed Dailies or stored answers.

## Full draft links

The deck dialog links to the same source draft on 17Lands. `source.draft_url` is
returned with the deck only after the existing ownership and locked-pick checks.
The browser accepts only canonical HTTPS 17Lands draft URLs and opens them in a
new tab. Public log availability is controlled by 17Lands.

To add URLs to older catalogs without rebuilding their card/deck data:

```sh
python scripts/backfill-trophy-draft-links.py --cache PRIVATE_ARCHIVE_CACHE
```

This resolves the existing source hashes against official game archives and
requires every catalog alias to resolve to the same draft for that deck before
writing any catalog. `draft-links.json` records the archive hashes and coverage.
Decks, source membership and event types are preserved. No card-based matching
or substitute draft is used.
