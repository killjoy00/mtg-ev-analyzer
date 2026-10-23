# Trophy deck context

`fra.mjs` is a compressed, generated serving catalog for 1,029 Reality Fracture
draft sources already represented in Pack One. It contains one exact main deck
and sideboard per draft, using the last observed game ordered by game time,
match number, game number, and build index. It never combines builds. One other
FRA source has draft records but no game records, so it has no deck link.

Source: [17Lands public datasets](https://www.17lands.com/public_datasets),
published October 17, 2026, with games through October 16. Used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Data has been
extracted, matched to Pack One sources, normalized, and enriched with card
display metadata from [Scryfall](https://scryfall.com/docs/api).

"Final" means the last recorded game deck, not a guaranteed submitted event-final
build. Traditional decks can include last-game sideboarding. All 81,314 draft
decks and the original published archives were retained in the research export;
this serving subset avoids shipping unrelated drafts to the application.

Regenerate with `scripts/build-trophy-deck-catalog.py --decks MATCHED_DECKS.json
--cards SCRYFALL_CARDS.json --output corpus/trophy-decks/fra.mjs`. The input deck
records use the normalized research export schema. Include only sources matched
to Pack One; the builder validates exact positive card quantities and known
source aliases. Regeneration does not alter scoring or source eligibility.
