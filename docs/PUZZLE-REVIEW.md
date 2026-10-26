# Puzzle review (blinded owner test)

`/admin/?area=puzzle-review` is a one-person blind comparison of two ways to
choose contested Daily puzzles. It does not change Daily selection, scoring,
or any stored data.

## What is compared

Twelve matched pairs (24 puzzles) from The Hobbit, Marvel Super Heroes and
Secrets of Strixhaven. Each pair has the same set and pick. Picks 1–8 appear
once, then picks 2, 4, 6 and 8 again.

- **Today's selector:** a medium or hard puzzle (runner-up support at least
  50% of the leader), chosen at random. Hard is drawn one time in four at
  picks 1–5 and one time in three at picks 6–8, matching the Daily's band mix.
- **Proposed rule:** the same contested pool, plus:
  1. at least two credible options (model support at least 35% of the leader;
     the top three count);
  2. from pick 4 on, the trophy pick made the trophy deck's main deck;
  3. ranked by the strongest credible card's smoothed game-in-hand win rate
     minus the set average; one puzzle drawn at random from the top quarter
     (at least three) of its set and pick.

Both arms keep the existing serving floor and `interesting` flag. No source
draft appears twice.

## Rating and pass criteria

Each puzzle is rated after its trophy pick is revealed: Interesting, Fine,
Dull or Broken. The arm key is fetched only after all 24 are rated, and
ratings lock once results are shown.

The proposed rule passes only if both hold. These were fixed before any
rating:

- it has at most half as many Dull or Broken puzzles as today's selector;
- today's puzzle rates higher in at most 3 of the 12 pairs.

If today's selector has no Dull or Broken puzzles, the first check passes
trivially and the page says so.

## Data and storage

The review set and key are static files in `admin/puzzle-review/`, generated
from checked-in inputs only: the `corpus/draft-run` sample, the trophy-deck
catalogs, and the card-strength benchmark tables in
`research/card-strength-v1-results/`. The seed is fixed in the generator.
The key is public in the repository; the rater should not open it before
finishing.

Ratings and notes are stored in the rater's browser (`localStorage`) and can
be downloaded as JSON from the results view. Nothing is sent to the backend.

## Regenerate

```sh
node scripts/build-puzzle-review-set.mjs
```

`tests/puzzle-review.test.mjs` fails if the committed files differ from a
fresh build. A new review set needs a new version (`puzzle-review-v2`) so old
browser progress is not applied to different puzzles.

## Limits

- The local corpus sample has roughly 50–75 source drafts per set, so each
  proposed top quarter holds only 6–11 puzzles. Production pools are larger.
- Strength tables exist only for six sets; three are used here.
- One rater, 12 pairs: a directional check, not a measurement of player
  enjoyment.
