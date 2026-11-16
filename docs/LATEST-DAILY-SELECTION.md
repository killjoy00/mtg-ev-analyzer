# Daily stakes selection

The latest-set Daily always draws from the newest Live regular set; its initial
stakes rollout on 2026-10-27 used Reality Fracture (`fra`). The Main (`mixed`)
Daily now applies the **same stakes puzzle ranking within each chosen set**,
without changing its eight-slot set plan: two newest, four from the next three,
and two weighted across all Live regular sets. Its rollout is independent of
Latest Set and opt-out controlled.

The rule was chosen in the blinded puzzle review (`docs/PUZZLE-REVIEW.md`).
Grading, scoring, the run shape (P1P1–P1P8, one puzzle per pick) and the
difficulty plan are unchanged. Powered Cube and Practice keep the band draw.

## The shared stakes rule (`latest-stakes-v1` / `mixed-stakes-v1`)

Each round keeps the Daily's planned band (one easy, five medium, two hard)
as its type. Every round:

- never serves a land trophy pick from P1P5 on;
- from P1P4 on, serves only trophy picks that made the trophy deck's main deck.

A contested round (planned medium or hard) draws from medium and hard puzzles
together, keeps those with at least two credible options (model support at
least 35% of the leader's, top three counted), ranks them by **stakes** (the
strongest credible option's strength) and draws uniformly from the top quarter
(at least three). An easy round draws uniformly from the clear-Easy puzzles
described next.

The existing serving filters, the `interesting` flag, source exclusion within
a run and the 28-day decision / 7-day source repeat windows all still apply
first, so the top quarter is taken over what remains.

If no puzzle qualifies in a round, that round makes today's band draw.
When enabled and scored, the schedule records `selection_rule='latest-stakes-v2'`
for Latest Set or `selection_rule='mixed-stakes-v2'` for Main Daily. It records
the `-v1` names when the stakes rule ran without the clear-Easy rule, and null
if the whole Daily falls back to the original selector.

## The clear-Easy rule (`latest-stakes-v2` / `mixed-stakes-v2`)

An easy decision leaves little room for partial credit: every card but the
leader earns under 50. So an Easy round serves an easy-band puzzle only when
three independent signals agree on one card (`EASY_RULE`):

- the trophy pick is the model's leading card (trophy support ratio 1);
- no other rated card in the pack is stronger than the trophy pick (strength
  margin of zero or more, from the same card strength tables);
- from P1P3 on, a coloured trophy pick shares at least one colour with the
  coloured prior picks. One prior pick is not a colour commitment.

Qualifying puzzles are drawn uniformly, not ranked: ranking by strength would
serve the same few cards. The late-land and trophy-deck gates above still
apply. If no easy puzzle qualifies in a round, the round draws uniformly from
all easy puzzles, as `-v1` did.

The rule and its evidence are in the
[November 2026 difficulty review](DIFFICULTY-REVIEW-2026-11.md). It was
validated on held-out practice answers from 27 sets, uses no player data as
an input, and keeps roughly 40 to 75% of each Easy pool.

## Inputs

- **Card strength:** `corpus/card-strength/<set>.json` (see its README),
  built from the 17Lands Premier Draft game archives that the trophy decklists
  came from. All 31 sets with trophy decklists have a table.
- **Selection features:** `draft_run_puzzle_selection_features` (migration
  0068), one row per puzzle: stakes points, credible-option count, whether the
  trophy pick made the main deck (null without a decklist) and whether it is a
  land. Migration 0077 adds the clear-Easy features: the trophy pick's strength
  margin over the strongest other rated card (null without a table or a
  rating) and whether it is off-colour. Every loader scores each batch as it inserts it
  (`scripts/score-puzzle-selection.mjs`); `tests/puzzle-selection.test.mjs`
  checks these values equal the review generator's on the reviewed sets.

## Activation guard

The rule runs only when **every** serving P1P1–P1P8 puzzle of **each set in
the Daily's selected set plan** has a features row scored against a strength
table. Main Daily checks its selected sets, not all 27 Live sets on every run.
If any planned set is incompletely scored, the **whole Daily** uses the old
band draw, never a partially converted run. A round with no eligible stakes
puzzle also independently falls back to its planned band.

The `mixed` enable check is separate from `latest`: setting the Draft Run
worker's environment variable `PACK1_MIXED_DAILY_STAKES=off` disables
Main Daily stakes only, at the next deployment/configuration update. Unset
or any other value leaves it enabled. Main Daily's `selection_rule` is
recorded independently, and **existing schedules are never rewritten**.

The clear-Easy rule has its own guard on top of the stakes guard: every
serving P1P1–P1P8 puzzle of the planned sets must carry the 0077 features. A
row scored before 0077, or a database without those columns, keeps the stakes
rule for contested rounds and returns **every Easy round of that Daily** to
the uniform easy draw; the schedule then records the `-v1` rule.
`PACK1_DAILY_CLEAR_EASY=off` does the same on purpose, for both Dailies.

## Release steps (clear-Easy rule)

1. Merge. Until the release applies 0077, workflows that run
   `scripts/verify-neon-schema.mjs` against a database without it stop at that
   check, as they did for 0068.
2. Release through `secure-auth-release`, which applies 0077 (two nullable
   columns) and deploys. Dailies keep the `-v1` behaviour: existing feature
   rows predate the new columns.
3. Run **Score puzzle selection** with `target=development` and `sets` empty,
   then with `target=production` and that run's ID as `validated_run_id`. The
   backfill treats rows without the new features as stale and rewrites them.
   Running `sets=fra` first activates Latest Set sooner; Main Daily follows as
   each day's planned sets finish. The full backfill rewrites every feature
   row once; if a run reaches its time limit, running it again resumes with
   the rows that remain.
4. The next Daily generated after its sets are complete uses the rule.
   Schedules already generated are never changed.

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

Every puzzle is scored, so the rule can cover Main Daily in addition to
Latest Set. A set imported from now on is scored as it loads. **Score puzzle
selection** with `sets` empty backfills everything: it reads the table once
in physical order, about 1,000 puzzles per sequential block-range read, in
four parallel stripes. It fails if any puzzle is still unscored at the end
(for example a row that moved while it was read); running it again finishes
the rest. The first version paged through each set with a sort per page; a
development run over all sets reached about 1.6 of 4.4 million puzzles before
its 3-hour limit.

To check it took effect: `SELECT day,environment,selection_rule FROM draft_run_schedules
WHERE environment IN ('latest','mixed') ORDER BY day DESC,environment LIMIT 6`.

To roll back Main Daily without changing Latest Set, set
`PACK1_MIXED_DAILY_STAKES=off` in the Draft Run deployment configuration
and roll out that configuration through the guarded release process. New
Main Daily schedules use the old band selector; already-published schedules
stay frozen. The latest-set guard continues to fall back automatically if
its features become incomplete.

To roll back only the clear-Easy rule, set `PACK1_DAILY_CLEAR_EASY=off` the
same way. Both Dailies keep the stakes rule and draw Easy rounds uniformly
from the easy band again.

## Reality Fracture at a glance

Read-only production checks on 2026-10-27 (approximate serving filter: it
omits snapshot membership and removed picks):

- All 277 card names that appear as credible options in FRA serving
  P1P1–P1P8 puzzles are in `fra.json`.
- Each pick has about 960–1,110 serving puzzles, 560–850 of them contested.
  The late-land gate removes 41–88 contested puzzles per pick at P1P5–P1P8.
  Before the deck gate, each top quarter holds roughly 140–200 puzzles.

## Limits

- The rule comes from blinded ratings by the owner and other raters over
  three rounds (32 pairs, `docs/PUZZLE-REVIEW.md`): a directional result, not
  a measurement of player enjoyment.
- Stakes are a static ranking, so a top-quarter puzzle can return once the
  28-day decision window passes.
- Strength is observational: winning decks that played a card.
- The clear-Easy rule was validated on player outcomes (fewer low scores,
  more trophy matches), which are proxies, not a measurement of enjoyment. It
  narrows the Easy slot's answer cards: in a simulated year of Latest Set
  Dailies, about 73 distinct answer cards against 118.
