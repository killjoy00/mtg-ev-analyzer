# Difficulty and Easy-puzzle review (November 2026)

A review of what Pack One's difficulty bands measure, what players experience,
and how Easy puzzles are chosen. It closes the questions in
[issue #1585](https://github.com/killjoy00/mtg-ev-analyzer/issues/1585).

**Outcome:** one change. Easy rounds of the Latest Set and Main Dailies now
draw from *clear-Easy* decisions and rotate their answer cards (below).
Scoring, the band thresholds, the
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
  first-encounter practice answers from 164 players. Practice draws its Easy
  puzzles at random from the band, so this is a sample of the pool rather
  than of what a selector chose.
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

Qualifying decisions are drawn uniformly, with one preference: **answer-card
rotation**. An Easy round first avoids any answer card that was the Easy
answer of a Latest Set or Main Daily in the last 28 days (the same length as
the decision repeat window). If every qualifying decision has a recent answer,
the round ignores rotation rather than leave the clear pool. The existing
late-land and trophy-deck gates still apply. If no decision qualifies at all,
the round draws from the whole easy band as before. Every input is known
before a puzzle is served and none is specific to a set or a card, so a new
set is covered the day it is imported.

**Missing data.** A puzzle with no strength table, an unrated trophy pick, or
no other rated card in the pack has no strength margin and never qualifies;
it can still be served through the fallback. Unrated cards in the pack (basic
lands) are ignored. A card with no printed mana cost counts as colourless and
is never off-colour. In the four inventoried sets and the practice holdout,
no easy puzzle lacked a margin.

### What was rejected

- **Requiring early trophy picks to make the final deck.** Not used. Two of
  the three owner-approved examples were cut from their decks.
- **Ranking qualifying decisions by card strength and drawing from the top.**
  Stronger answers do score better (below), but the top half of an FRA pool
  holds 14 to 22 distinct answer cards against 40 to 51 in the full clear
  pool, and one owner-approved example sits near the 88th percentile of its
  pool. A ranked draw would serve the same few bombs and drop a known good
  puzzle.
- **Drawing an answer card first, then a puzzle for it.** It spreads answers
  about as widely as rotation but still repeats a card within a week about
  as often as today, and it shifts the draw toward weaker answers.
- **Maximising the predicted match rate.** That favours trivial packs. The
  rule removes the low end instead. In the four inventoried sets, 1% or fewer
  of clear-Easy decisions have a trophy pick the model gives 70% or more
  (under 1% in the band as a whole), and 95 to 99% of clear-Easy packs
  contain another above-average card.
- **Using player votes as an input.** Votes validate the rule afterwards. They
  never select a puzzle, so a new set needs none.

## 4. Validation

The measures are proxies. A lower share of low scores and a higher match rate
show that the Easy slot behaves more like an easy pick. They do not show that
puzzles are more enjoyable.

### What was pre-registered, and what was not

Before the practice export was read, one rule and one criterion were written
down. The rule required colour fit from **P1P2**. The criterion: decisions
the rule keeps must have a share of answers under 50 at least 5 points lower
than the decisions it drops, with a 95% interval excluding zero.

That pre-registered rule passed. It was then relaxed to colour fit from
**P1P3**, because it removed an owner-approved puzzle (a strong off-colour
card taken second). The relaxation was made after the holdout had been read,
so **the shipped rule has not passed an untouched holdout**. Its numbers
below are exploratory. The relaxation moves the rule toward the current
behaviour, so it could only weaken the measured effect, but that is an
argument, not a test.

The rule is now locked. Nothing further was tuned on the practice export or
the owner examples: the strength cutoff, the colour-fit pick and the rotation
window keep the values they were given for stated reasons, and the
sensitivity table below was not used to choose them.

### Practice holdout

1,271 first-encounter answers on 1,256 easy puzzles from 27 sets. They come
from only **164 players**: half of them gave one or two answers, one gave
151, and the five most active gave 400 (31%). Intervals therefore resample
whole players, not puzzles or answers.

| Answers scoring under 50 | Current | Rule keeps | Rule drops | Keeps minus drops | Keeps minus current |
| --- | ---: | ---: | ---: | ---: | ---: |
| Pre-registered rule (keeps 50%) | 37.5% | 31.9% | 42.9% | -11.0 (-16.0 to -5.9) | -5.5 (-8.4 to -3.0) |
| Shipped rule (keeps 55%), exploratory | 37.5% | 33.7% | 42.1% | -8.4 (-13.5 to -3.3) | -3.8 (-6.2 to -1.5) |

Trophy-match rate for the shipped rule: 66.3% kept against 39.6% dropped
(+26.7, 21.5 to 31.4) and 54.4% today.

Player clustering changes the intervals very little, and three checks that
do not depend on the heaviest players agree:

- **Each player against themselves.** Among the 78 players who answered both
  kinds, the under-50 share was 15.8 points lower on kept decisions (5.8 to
  25.7): lower for 45 players, equal for 10, higher for 23.
- **Without the five most active players:** 36.2% kept against 44.5% dropped.
- **Without FRA:** 35.6% against 42.9%.

**Variation by set** (shipped rule; sets with 40 or more answers):

| Set | Answers | Kept: n, under 50 | Dropped: n, under 50 | Difference |
| --- | ---: | ---: | ---: | ---: |
| BLB | 42 | 22, 31.8% | 20, 35.0% | -3.2 |
| DFT | 42 | 19, 26.3% | 23, 47.8% | -21.5 |
| DSK | 51 | 26, 34.6% | 25, 28.0% | +6.6 |
| ECL | 55 | 26, 19.2% | 29, 37.9% | -18.7 |
| EOE | 63 | 33, 39.4% | 30, 46.7% | -7.3 |
| FDN | 50 | 30, 33.3% | 20, 45.0% | -11.7 |
| FIN | 57 | 32, 34.4% | 25, 40.0% | -5.6 |
| FRA | 87 | 46, 6.5% | 41, 31.7% | -25.2 |
| HOB | 84 | 53, 22.6% | 31, 32.3% | -9.6 |
| MH3 | 44 | 28, 57.1% | 16, 43.8% | +13.4 |
| MKM | 40 | 21, 33.3% | 19, 42.1% | -8.8 |
| MSH | 95 | 54, 37.0% | 41, 41.5% | -4.4 |
| SOS | 86 | 56, 26.8% | 30, 36.7% | -9.9 |
| TDM | 56 | 34, 32.4% | 22, 27.3% | +5.1 |
| TLA | 45 | 22, 27.3% | 23, 39.1% | -11.9 |
| TMT | 47 | 19, 47.4% | 28, 28.6% | +18.8 |

The rule arm is lower in 12 of these 16 sets, and in 19 of the 26 sets with
at least 10 answers in each arm (median difference -8.8, quartiles -11.9 and
-3.2, range -40.9 to +18.8). Single sets rest on 16 to 56 answers per arm and
are noisy: the rule is supported on average across sets, not set by set.

### Strength-cutoff sensitivity

The cutoff is zero: no other rated card is stronger. Because the strength
estimates are observational, the question is whether a hair's difference
decides too much. Moving the cutoff, with nothing else changed:

| Cutoff (points) | Kept share | Under 50, kept | Under 50, dropped | Keeps minus drops |
| ---: | ---: | ---: | ---: | ---: |
| -1.0 | 65.0% | 35.4% | 41.3% | -6.0 (-11.3 to -0.1) |
| -0.5 | 61.4% | 35.3% | 40.8% | -5.5 (-10.7 to 0.2) |
| -0.25 | 58.0% | 34.3% | 41.8% | -7.4 (-12.8 to -2.0) |
| **0 (shipped)** | 55.2% | 33.7% | 42.1% | -8.4 (-13.6 to -3.3) |
| +0.25 | 52.0% | 33.1% | 42.1% | -9.0 (-14.7 to -3.6) |
| +0.5 | 47.8% | 32.1% | 42.3% | -10.2 (-16.3 to -4.7) |
| +1.0 | 40.7% | 30.8% | 42.0% | -11.3 (-17.8 to -5.7) |

Nothing turns on the exact value. Within a quarter point either side the
kept share moves by about 3 points and the outcome by under 1. Only 2.8% of
all easy answers are rejected by a deficit smaller than 0.25 points. Outcomes
improve steadily as the cutoff rises and weaken as it falls, so there is no
case here for a tolerance below zero, and the data do not single out any
other value. Zero is kept because it is the one cutoff with a meaning.

### Served Dailies

Regular sets. This is the sample the rule was shaped on, so it is not
independent.

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

### Inventory, slot filling and variety

The rule keeps 47 to 68% of each FRA Easy pool (104 to 237 decisions per
pick) and 40 to 64% in KTK, the Live set with the smallest pools (57 to 124
per pick). The clear pool leans toward each set's stronger cards, which
narrows the answers. Rotation is there to stop that turning into repetition.
One Easy a day for a simulated year from a single set, under the Daily repeat
windows, averaged over 20 years:

| FRA (Latest Set) | Distinct answer cards | Most frequent answer | Same answer within a week | Unfilled |
| --- | ---: | ---: | ---: | ---: |
| Current draw | 119 | 22 days | 33 days | 0 |
| Clear-Easy, no rotation | 73 | 36 days | 60 days | 0 |
| **Clear-Easy with rotation (shipped)** | 84 | 12 days | 0 days | 0 |

HOB and KTK behave the same way (69 and 73 distinct answers with rotation, 12
days for the most frequent, none repeated within a week). Rotation never had
to be relaxed and the clear pool never ran out. A set whose archive starts at
P1P2 has no P1P1 Easy pool under any rule; the selector already serves a
medium decision there.

So the rule still shows fewer different Easy answers in a year than today
(84 against 119 in the newest set). That is inherent in asking for the
strongest card in the pack. What rotation removes is the part a daily player
notices: no answer card comes back inside four weeks, and the most frequent
one appears about once a month instead of every two weeks today. The mean
strength margin of what is served barely moves (2.15 points with rotation,
2.23 without), so rotation is not expected to cost the outcome gain. Main
Daily draws its Easy round from a different set most days and is much less
affected either way.

**Performance.** The Easy round runs the same two indexed statements as
before with a few more column comparisons, one more when rotation has to be
relaxed, plus one small read of recent Easy answers per Daily and one more
aggregate column in the readiness check.

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
- The shipped rule has no untouched holdout (section 4). The pre-registered
  rule did, and passed.
- The practice holdout has 164 players and about one answer per puzzle. Its
  players and set mix differ from the Daily's.
- The rule's form was shaped on the served-Daily sample and the eight owner
  examples.
- Card strength is observational: winning decks that played a card. Agreement
  between it and the model is evidence, not proof, that a pick is right.
- A decision can pass all three checks and still be missed by most players.
  The rule lowers how often that happens. It does not end it.
- Rotation and variety were measured by simulation on four sets' current
  pools, not on live schedules.
- 26 days of Dailies, concentrated in FRA and Powered Cube.

## Forward check (locked)

This is the independent test the shipped rule still owes. It needs no manual
review: each schedule records the rule that chose it, and
`research/difficulty-review-2026-11/evaluate.mjs` prints Easy outcomes by
`selection_rule` from fresh read-only exports.

- **Sample:** the first 56 Easy puzzles scheduled by `latest-stakes-v2` or
  `mixed-stakes-v2` that reach 50 first-encounter answers (about four weeks
  of both Dailies).
- **Baseline:** the 28 Easy puzzles the `-v1` rules served: mean under-50
  share 36.7%, 7 with a majority under 50.
- **Confirmed** if the `-v2` mean under-50 share is 31.7% or lower (5 points
  below the baseline).
- **Reversed** if it is above 36.7%: turn the rule off with
  `PACK1_DAILY_CLEAR_EASY=off` and report.
- **Otherwise** unconfirmed: keep the rule and repeat once on the next 56.

It is a before-and-after comparison, so player mix and the age of the set
differ between the two periods, and 56 puzzles can confirm only an effect of
roughly 6 points or more. The rule is not to be changed before this check
reports.
