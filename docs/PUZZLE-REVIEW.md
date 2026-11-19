# Puzzle review (blinded owner test)

`/admin/?area=puzzle-review` is a one-person blind comparison of two ways to
choose contested Daily puzzles. It does not change Daily selection, scoring,
or any stored data.

## Versions

The page serves the latest version. A rated version is frozen: its files must
regenerate unchanged, and any change to the rule or sample needs a new version.

| Version | Puzzles | Sets | Proposed rule adds |
| --- | --- | --- | --- |
| `puzzle-review-v1` | 12 pairs; picks 1–8, then 2, 4, 6, 8 | HOB, MSH, SOS | — |
| `puzzle-review-v2` | 10 pairs; picks 1–8, then 5, 7; plus 4 land probes | HOB, MSH, SOS, BLB, ECL | No land trophy pick from pick 5 on |
| `puzzle-review-v3` (served) | 10 pairs; picks 1–8, then 3, 6 | SOS, BLB, ECL, HOB, MSH | Close decisions only (support-ratio "hard" band); both arms drop late land answers |

Each version uses no source draft that an earlier version used.

## What is compared

Each pair has the same set and pick.

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

v2 also excludes a land trophy pick from pick 5 on in the proposed arm, and
adds four unpaired **land probes**: picks 5–8 where the trophy pick is a land
that made the main deck, taken over a non-land card that strong players also
rated (at least 35% of the leader's support) and that sits in the top 20% of
its set's strength table. They test whether "a late land is fine if it was
taken over a strong card" is worth adding to the rule. Only four such puzzles
exist in the five-set sample once v1's drafts are excluded, so the probes are
drawn before the pairs.

v3 tests closeness plus stakes on its own: both arms drop land trophy picks
from pick 5 on, and the proposed arm also requires the "hard" band (runner-up
support at least 80% of the leader's) before ranking by stakes.

## Rating and pass criteria

Each puzzle is rated after its trophy pick is revealed: Interesting, Fine,
Dull or Broken. The arm key is fetched only after all 24 are rated, and
ratings lock once results are shown.

The proposed rule passes only if both hold. These were fixed before any
rating:

- it has at most half as many Dull or Broken puzzles as today's selector;
- today's puzzle rates higher in at most a quarter of the pairs (3 of 12 in
  v1, 2 of 10 in v2).

If today's selector has no Dull or Broken puzzles, the first check passes
trivially and the page says so.

v3 states its own criteria, also fixed before rating: at least 8 of the 10
proposed-rule puzzles rated Interesting or Fine, and today's puzzle rates
higher in at most 2 of the 10 pairs.

Land probes (v2) are scored separately: allowing late land answers taken over
a strong card is worth adding only if at least 3 of the 4 are rated
Interesting or Fine. Otherwise the simpler rule stands: no land answers from
pick 5 on.

## Data and storage

The review set and key are static files in `admin/puzzle-review/`, generated
from checked-in inputs only: the `corpus/draft-run` sample, the trophy-deck
catalogs, and the card-strength benchmark tables in
`research/card-strength-v1-results/`. The seed is fixed in the generator.
The key is public in the repository; the rater should not open it before
finishing.

Ratings and notes are stored in the rater's browser (`localStorage`). The
results view can copy them as JSON text (for tablets that cannot attach a
downloaded file) or download them. Nothing is sent to the backend.

## Regenerate

```sh
node scripts/build-puzzle-review-set.mjs            # every version
node scripts/build-puzzle-review-set.mjs puzzle-review-v2
```

`tests/puzzle-review.test.mjs` fails if any committed file differs from a
fresh build. Browser progress is stored per version, so a new version never
inherits ratings for different puzzles.

The downloaded results keep the rater's rating in `rating` and the
support-ratio difficulty in `difficulty_rating`. v1 downloads made before this
fix show the difficulty number in each pair's `rating` field; their top-level
`ratings` map and `summary` are correct.

## Limits

- The local corpus sample has roughly 50–75 source drafts per set, so each
  proposed top quarter holds only 5–11 puzzles. Production pools are larger.
- The review uses the benchmark's six strength tables (training split only);
  v1 uses three sets, v2 and v3 five (FRA has no checked-in corpus sample).
  Production uses `corpus/card-strength/`, built for every set from all games;
  see `docs/LATEST-DAILY-SELECTION.md`.
- v3's close-only proposed pool holds 3–5 puzzles per set and pick in this
  sample.
- Four land probes are a taste check, not a measurement.
- Rated by the owner and other raters, 10–12 pairs per round: a
  directional check, not a measurement of player enjoyment.
