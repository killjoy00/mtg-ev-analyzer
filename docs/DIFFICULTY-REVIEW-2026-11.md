# Difficulty and Easy-puzzle review (November 2026)

A review of what Pack One's difficulty bands measure, what players experience,
and how Easy puzzles are chosen. It closes the questions in
[issue #1585](https://github.com/killjoy00/mtg-ev-analyzer/issues/1585).

**Outcome:** one change. Easy rounds of the Latest Set and Main Dailies now
draw from *clear-Easy* decisions (below). Scoring, the band thresholds, the
one easy / five medium / two hard plan, contested rounds, Powered Cube,
Practice and every published Daily are unchanged.

Only aggregates appear here. Inputs and method:
[`research/difficulty-review-2026-11/`](../research/difficulty-review-2026-11/README.md).

## What was measured

Read-only, from production on 2026-11-16:

- **Served Dailies:** 624 puzzles with at least 50 first-encounter answers
  each, 97,207 answers, Dailies of 2026-10-21 to 2026-11-15, all three
  environments. First observed answer per person and puzzle; QA and
  administrator sessions excluded. The puzzle is the unit, not the voter.
- **Practice holdout:** 1,256 easy-band puzzles from 27 regular sets, 1,271
  first-encounter practice answers. Practice draws its Easy puzzles at random
  from the band, so this is a sample of the pool rather than of what a
  selector chose.
- **Unserved inventory:** the current serving Easy pools (P1P1 to P1P5) of
  FRA, HOB and the two smallest Live sets, KTK and TMT.

## 1. What the bands measure, and what players experience

`support-ratio-v1` rates a decision by the runner-up's model support as a
share of the leader's: easy below 50%, medium 50 to 79%, hard 80% and up. It
measures how close the model's top two cards are. Combined with partial
credit (`95 × your card's support / the leader's`), that produces the opposite
of what the labels suggest:

| Band | Puzzles | Matched trophy pick | Scored 75+ | Scored under 50 | Mean score | Median decision time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Easy | 78 | 62.5% | 67.4% | **32.6%** | 74.5 | 16.0 s |
| Medium | 367 | 48.8% | 62.4% | 22.2% | 76.8 | 16.3 s |
| Hard | 179 | 43.7% | **80.2%** | 13.5% | 83.7 | 15.7 s |

This reproduces the earlier audit (62.7 / 48.8 / 43.5% matched) on two more
days of data. Three things follow.

- **Easy is where players most often score badly.** In an easy decision every
  card but the leader has under half its support, so every miss scores under
  50. In a hard decision the runner-up is worth 76 or more by construction.
- **The rating barely tracks either thing a player feels.** Across puzzles its
  correlation with the trophy-match rate is -0.23, with median decision time
  -0.02.
- **Medium and Hard do not differ in a way players notice**, and in the
  Dailies that use the stakes rule they are not selected differently: every
  contested round draws from medium and hard together.

Two other pre-serving numbers do track players. Predicting each puzzle's
outcome for a whole format from the other four formats (mean squared error,
lower is better):

| Predictor | Trophy match | Under 50 | Mean score | Decision time |
| --- | ---: | ---: | ---: | ---: |
| Constant | 0.0698 | 0.0404 | 0.0215 | 0.0338 |
| Current rating | 0.0671 | 0.0365 | 0.0204 | 0.0339 |
| Model's share for the trophy pick | **0.0492** | 0.0404 | 0.0209 | 0.0285 |
| Trophy share + rating + support entropy | 0.0507 | **0.0303** | **0.0158** | **0.0265** |

The model's probability for the trophy pick predicts how often players find
it, better than the rating in all five held-out formats (error difference
0.018, bootstrap interval 0.013 to 0.023). How spread out the model's support
is (entropy) tracks low scores and thinking time: from the most concentrated
fifth of puzzles to the most spread, players under 50 rise from 12% to 31%
and median time from 12.9 s to 18.8 s.

A separate finding matters for Easy: when the trophy pick is not the model's
leading card, the match rate is about 25 to 35% in every band, against 52 to
69% when it is.

## 2. What the bands should mean

A decision has two difficulties that come apart under partial credit: how
hard it is to find the 100-point answer, and how likely a reasonable player is
to score badly. The band a slot carries should promise something on both.

- **Easy: a clear pick.** One card stands out, and the model, the trophy
  drafter and independent card-strength data agree on it. Most players should
  find it. Missing it costs a lot, so the answer must be defensible.
- **Medium: a real choice.** Two or three credible options. The alternatives
  earn meaningful credit.
- **Hard: a close call.** The top options are nearly tied. It is the hardest
  band to match exactly and the most forgiving in points.

The existing thresholds already describe Medium and Hard this way. Easy was
the band whose promise the selector did not keep.

## 3. The Easy problem

The stakes rule ranks contested rounds but drew Easy rounds uniformly from the
whole band. In the served sample of 52 regular-set Easy puzzles, 9 had a
majority of players scoring under 50. The band admits three kinds of decision
that are not a clear pick:

1. **The answer is not the obvious card.** The trophy drafter took a card the
   model gives less than half the leader's support. Players take the leader,
   score 95, and are told the answer was something else.
2. **The model's confidence is not backed by card strength.** Another card in
   the pack is stronger by independent 17Lands evidence, yet earns under 50.
   With no prior picks there is no context to justify that.
3. **The pick asks the player to change colours.** The card shares no colour
   with anything drafted so far. That is a contextual judgement, not an
   obvious pick, and players avoid such cards far more than the model does.

### The clear-Easy rule

An Easy round of the Latest Set or Main Daily serves an easy-band decision
only when all of these hold (`EASY_RULE` in `puzzle-selection.mjs`):

- the trophy pick is the model's leading card;
- no other rated card in the pack is stronger than the trophy pick
  (`corpus/card-strength`, the same tables the stakes rule uses);
- from P1P3 on, a coloured trophy pick shares at least one colour with the
  prior picks. One prior pick is not treated as a colour commitment.

Qualifying decisions are drawn uniformly. The existing late-land and trophy-
deck gates still apply. If no decision qualifies in a round, the round draws
from the whole easy band as before. Every input is known before a puzzle is
served and none is specific to a set or a card, so a new set is covered the
day it is imported.

### What was rejected

- **Requiring early trophy picks to make the final deck.** Not used. Two of
  the three owner-approved examples were cut from their decks.
- **Ranking qualifying decisions by card strength and drawing from the top.**
  Stronger answers do score better (below), but the top half of an FRA pool
  holds 14 to 22 distinct answer cards against 40 to 51 in the full clear
  pool, and one owner-approved example sits near the 88th percentile of its
  pool. A ranked draw would serve the same few bombs and drop a known good
  puzzle.
- **Maximising the predicted match rate.** That favours trivial packs. The
  rule removes the low end instead. In the four inventoried sets, 1% or fewer
  of clear-Easy decisions have a trophy pick the model gives 70% or more
  (under 1% in the band as a whole), and 95 to 99% of clear-Easy packs
  contain another above-average card.
- **Using player votes as an input.** Votes validate the rule afterwards. They
  never select a puzzle, so a new set needs none.

## 4. Validation

The success criterion was fixed before the practice export was read: the
decisions the rule keeps must have a share of answers under 50 at least 5
points lower than the decisions it drops, with a 95% interval excluding zero.
The measures are proxies. A lower share of low scores and a higher match rate
show that the Easy slot behaves more like an easy pick. They do not show that
puzzles are more enjoyable.

**Practice holdout** (27 sets; intervals from a puzzle bootstrap):

| | All easy (current) | Rule keeps | Rule drops | Keeps minus drops |
| --- | ---: | ---: | ---: | ---: |
| Puzzles | 1,256 | 697 (55%) | 559 | |
| Scored under 50 | 37.5% | 33.7% | 42.1% | -8.4 (-14.0 to -2.8) |
| Matched trophy pick | 54.4% | 66.3% | 39.6% | +26.7 (21.2 to 32.1) |
| Scored 75+ | 62.5% | 66.3% | 57.9% | +8.4 (3.1 to 13.7) |

The criterion is met. Against the current draw the rule lowers the under-50
share by 3.8 points (1.3 to 6.3) and raises the match rate by 12.0 (9.5 to
14.5). The direction holds in 13 of 18 sets with enough answers to compare,
and with FRA removed entirely (35.6% against 42.9%).

**Served Dailies** (regular sets; the sample the rule was shaped on, so not
independent):

| | Puzzles | Mean under-50 share | Mean match rate | Majority under 50 |
| --- | ---: | ---: | ---: | ---: |
| Current | 52 | 32.7% | 61.1% | 9 |
| Rule keeps | 33 | 23.0% | 77.0% | 1 |
| Rule drops | 19 | 49.5% | 33.5% | 8 |

The split is the same in FRA (23.5% against 47.1%) and in the other sets
(22.3% against 53.5%).

**Owner examples** (diagnostic, not training data): the three approved Easy
puzzles stay eligible and the four rejected ones do not. A regression test
holds both. The example the owner called uncertain is not asserted either
way.

**Inventory and slot filling.** The rule keeps 47 to 68% of each FRA Easy pool
(104 to 237 decisions per pick) and 40 to 64% in KTK, the Live set with the
smallest pools (57 to 124 per pick). Simulating one Easy a day for a year from a single set under
the Daily repeat windows, every day filled from the clear pool in FRA, HOB
and KTK, with no fallback. A set whose archive starts at P1P2 has no P1P1
Easy pool under either rule. The selector already serves a medium decision
there.

**Variety cost.** The clear pool leans toward each set's stronger cards. In
the same simulation the Latest Set Easy slot shows about 73 distinct answer
cards a year against 118, and repeats an answer card within a week on about
58 days against 34. Main Daily draws its Easy round from a different set most
days, so it is much less affected.

**Performance.** The Easy round runs the same two indexed statements as
before, with three more column comparisons, plus one more aggregate column in
the readiness check.

## 5. Other bands and modes

- **Medium and Hard.** No change. The thresholds describe decision shape
  consistently, and the telemetry cannot show that a different split would be
  more enjoyable. Trading the rating for the model's trophy-pick probability
  would predict match rates better, but it would also fill Hard with decisions
  where the trophy drafter departed from the model, the same pattern that
  makes a poor Easy. That needs separate evidence.
- **Main Daily** uses the rule exactly as Latest Set does.
- **Powered Cube.** No change. Its Easy puzzles do worst of all (37.9% under
  50 over 26 puzzles), but card strength there did not separate good from bad
  (lands and fast mana distort it), and the sample is too small to validate a
  cube-specific rule.
- **Practice.** No change in this release. The holdout shows the rule would
  help there too, but Practice selects through the batched serving snapshot,
  which is a separate, larger change.
- **Scoring.** Unchanged. Nothing here supports changing partial credit.

## Limits

- Player outcomes are proxies for an easy experience, not measurements of
  interest or enjoyment.
- The rule's form was shaped on the served-Daily sample and the eight owner
  examples. The practice holdout is independent of both, but its players and
  set mix differ from the Daily's, and it has about one answer per puzzle.
- The rule tested first on the holdout applied colour fit from P1P2 and did
  better there (31.9% under 50). It was relaxed to P1P3 because it removed an
  owner-approved puzzle. The table above is for the rule as shipped.
- Card strength is observational: winning decks that played a card. Agreement
  between it and the model is evidence, not proof, that a pick is right.
- A decision can pass all three checks and still be missed by most players.
  The rule lowers how often that happens. It does not end it.
- 26 days of Dailies, concentrated in FRA and Powered Cube.

## Checking it after release

No manual review is needed. Each schedule records the rule that chose it
(`latest-stakes-v2`, `mixed-stakes-v2`), so the existing decision-measurement
report can compare Easy outcomes before and after by `selection_rule`.
`research/difficulty-review-2026-11/evaluate.mjs` repeats every table above
from fresh read-only exports.
