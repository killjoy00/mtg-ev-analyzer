# Latest-set Daily selection

The latest-set Daily always draws from the newest Live regular set; today that
is Reality Fracture (`fra`). From release of this change it chooses puzzles
with the stakes rule the owner chose in the blinded puzzle review
(`docs/PUZZLE-REVIEW.md`). Grading, scoring, the run shape (P1P1–P1P8, one
puzzle per pick) and the difficulty plan are unchanged. The mixed and Powered
Cube Dailies and Practice keep today's band draw.

## The rule (`latest-stakes-v1`)

Each round keeps the Daily's planned band (one easy, five medium, two hard)
as its type. Every round:

- never serves a land trophy pick from P1P5 on;
- from P1P4 on, serves only trophy picks that made the trophy deck's main deck.

A contested round (planned medium or hard) draws from medium and hard puzzles
together, keeps those with at least two credible options (model support at
least 35% of the leader's, top three counted), ranks them by **stakes** (the
strongest credible option's strength) and draws uniformly from the top quarter
(at least three). An easy round draws uniformly from easy puzzles.

The existing serving filters, the `interesting` flag, source exclusion within
a run and the 14-day decision / 7-day source repeat windows all still apply
first, so the top quarter is taken over what remains.

If no puzzle qualifies in a round, that round makes today's band draw. The
schedule records `selection_rule='latest-stakes-v1'` when the rule chose the
Daily, and null for the band draw.

## Inputs

- **Card strength:** `corpus/card-strength/<set>.json` (see its README),
  built from the 17Lands Premier Draft game archives that the trophy decklists
  came from. All 31 sets with trophy decklists have a table.
- **Selection features:** `draft_run_puzzle_selection_features` (migration
  0068), one row per puzzle: stakes points, credible-option count, whether the
  trophy pick made the main deck (null without a decklist) and whether it is a
  land. Every loader scores each batch as it inserts it
  (`scripts/score-puzzle-selection.mjs`); `tests/puzzle-selection.test.mjs`
  checks these values equal the review generator's on the reviewed sets.

## Activation guard

The rule runs only when **every** serving P1P1–P1P8 puzzle of the latest set
has a features row scored against a strength table. Otherwise the whole Daily
makes today's band draw. So deploying the code changes nothing until the
latest set is scored, and a partly scored set never runs a half-applied rule.

## Release steps (Reality Fracture)

1. Merge this change. Until the release applies 0068, workflows that run
   `scripts/verify-neon-schema.mjs` against a database without it stop at that
   check (it now requires the features table and the `selection_rule` column).
2. Release through the reviewed release workflow (`secure-auth-release`),
   which applies 0068 to development, deploys there, then does the same for
   production. FRA's
   Daily still makes the band draw: production FRA puzzles predate import
   scoring.
3. Run **Score puzzle selection** with `target=development`, `sets=fra`, then
   with `target=production`, `sets=fra` and that run's ID as
   `validated_run_id`. The next FRA Daily generated afterwards uses the rule;
   a schedule already generated for a day is never changed.

Done on 2026-10-27: release run 105, FRA scored on development and production
(12,175 puzzles each), and the 2026-10-27 latest-set Daily was the first
generated with `latest-stakes-v1`.

Every puzzle is scored, so the rule can later cover the other Dailies and
Practice. A set imported from now on is scored as it loads. **Score puzzle
selection** with `sets` empty backfills everything: it reads the table once
in physical order, about 1,000 puzzles per sequential block-range read, in
four parallel stripes. It fails if any puzzle is still unscored at the end
(for example a row that moved while it was read); running it again finishes
the rest. The first version paged through each set with a sort per page; a
development run over all sets reached about 1.6 of 4.4 million puzzles before
its 3-hour limit.

To check it took effect: `SELECT day,selection_rule FROM draft_run_schedules
WHERE environment='latest' ORDER BY day DESC LIMIT 3`.

To turn it off: delete the latest set's features rows (or one of them); the
guard returns the Daily to the band draw from the next generated day.

## Reality Fracture at a glance

Read-only production checks on 2026-10-27 (approximate serving filter: it
omits snapshot membership and removed picks):

- All 277 card names that appear as credible options in FRA serving
  P1P1–P1P8 puzzles are in `fra.json`.
- Each pick has about 960–1,110 serving puzzles, 560–850 of them contested.
  The late-land gate removes 41–88 contested puzzles per pick at P1P5–P1P8.
  Before the deck gate, each top quarter holds roughly 140–200 puzzles.

## Limits

- The rule comes from one rater's blinded ratings over three rounds (32
  pairs, `docs/PUZZLE-REVIEW.md`): a directional result, not a measurement of
  player enjoyment.
- Stakes are a static ranking. Within one set the same top-quarter puzzles
  recur once the repeat windows pass; with pools this size that takes months.
- Strength is observational: winning decks that played a card.
