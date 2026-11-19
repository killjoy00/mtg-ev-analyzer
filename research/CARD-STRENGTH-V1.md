# Card strength benchmark v1

Frozen before fitting or examining assessment outcomes, October 25, 2026.
Scope: an offline card-strength feature for puzzle selection. This does not
change the historical target, grader, corpus, selection, or any live service.
No Pack One responses, identities, scores, or telemetry are inputs.

## Question and estimand

Which inexpensive card-strength estimator adds the most predictive information
about future game wins, beyond a shared player/format/pregame baseline?
This is predictive strength, not the causal effect of replacing a card or the
value of a draft action. Deck construction, unobserved player skill, metagame,
mulligan selection, and game-length effects remain potential confounders.
It does not establish enjoyment or select an optimal pick policy.

The three candidates, with no additional variants or test-driven tuning:

1. **A: smoothed GIH.** In-hand wins/games, shrunk toward the training set's
   game win rate with 400 pseudo-games. In-hand means opening hand, drawn, or
   tutored; count a game once per card, not once per copy.
2. **B: smoothed IWD.** Difference between smoothed in-hand and not-drawn win
   rates; additionally shrink by min(n_hand,n_not_drawn)/(min(n_hand,n_not_drawn)+400),
   matching the existing `card_outcomes.py` method.
3. **C: adjusted deck-outcome strength.** L2 logistic regression of wins on
   nonbasic card copy counts and pregame controls (reported player skill/rank,
   main colours, on-play status, mulligans, and deck size). C=0.1, fixed. The
   card coefficients are the strength table; controls are not card strength.
   Correlated cards make coefficients associations, not causal effects.

All emit a format-relative strength independent of the offered pack. Standardize
over cards seen in the fitting data, using fitting data only. Unseen cards get a
neutral value and an explicit coverage marker, never an invented low rating.
Exclude the eleven named basic/snow basic lands from strength features; retain
nonbasic lands. Preserve complete decks for controls. Game-level GIH here is not
claimed to reproduce every copy-weighting detail of the 17Lands website.

## Data and partitions

Official 17Lands public game archives, PremierDraft only: FRA, HOB, MSH, SOS,
BLB, ECL. Retain URL, SHA-256, Last-Modified, size, and parsing exclusions.
All outcomes qualify, not just trophies; no skill-based sample selection.
Freeze source manifests after downloads. No Cube/Traditional claim is made.

Order whole source drafts by their first recorded game time, tie-break by draft
ID. Earliest 60% fit strength; next 20% calibrate; final 20% assess. Purge entire
fit or validation drafts whose last game reaches the next partition's first
game. A source draft can never occur in multiple partitions. Invalid outcomes,
negative/nonintegral card counts, inconsistent in-hand/deck counts, duplicate
game keys, missing identities/times, and invalid decks must be rejected or
explicitly accounted for; do not silently turn invalid outcomes into losses.

Test the same three models at 500 fitting drafts, 2,000 fitting drafts, and the
complete fitting partition. These are card-evidence budgets, not release-day
guarantees. Validation/test data never enter card-strength estimation.

## Common evaluation, with transfer

For each budget and held-out set, fit the same small logistic calibrator on the
validation partitions of the OTHER five sets. Inputs: common pregame controls,
training-only set baseline and coverage, plus a single mean nonbasic-deck
strength feature. The target set's validation outcomes are excluded. Compare
with the identical calibrator without card strength. Scaling is fit only on
those five validation partitions; regularization C=1 is frozen. Weight
calibration drafts equally and sets equally. There are no set/card identity
features in the transferable calibrator. Target-set 17Lands fitting data is
allowed; target-set Pack One data is never allowed or required.

Primary: test log loss, first averaged within source draft, then equally over
the six sets and three budgets. Lower is better. This asks whether stronger
decks predict better results; it does not grade models against their own GIH or
IWD rankings. Report Brier score and calibration as secondary diagnostics.

Secondary: add opening-hand mean strength minus deck mean strength to each
common calibrator, with nonbasic opening-hand count as a shared control.
This checks whether the strength table also detects better starting hands.
Opening-hand composition is known before play; drawn/tutored counts and game
length are never evaluation predictors. This remains observational because
players choose mulligans. Also report rare/unseen-card coverage and each set
separately. No secondary metric may silently replace the primary.

## Winner rule and uncertainty

Freeze all models and calibration predictions before opening assessment labels.
Require explicit `--final-test`; record protocol and source hashes in outputs.
Run 2,000 paired hierarchical bootstraps: resample sets, then source drafts
within each set, retaining all budgets/models together. Report paired primary
differences with 98.333% intervals for the three pairwise candidate comparisons
(Bonferroni familywise 5%). Set-level estimates are diagnostics, not thousands
of independent card tests.

The lowest primary loss is the empirical leader. Recommend the simplest
candidate within one paired-bootstrap standard error of that leader (A, B, C
complexity order). Call a candidate a demonstrated winner only if its pairwise
intervals exclude zero in its favour against both alternatives and its 95%
interval versus the no-strength baseline excludes zero. Otherwise explicitly
report an operational recommendation without claiming superiority, or no useful
strength signal if none beats the baseline. Do not tune after seeing the test.

## Limits and follow-up

This compares reusable estimation recipes with early target-set 17Lands data;
it does not validate a no-17Lands-data/card-text model. Export sample counts and
uncertainty alongside strengths. The winning recipe must later be tested for
pack-level relevance, draft-pool fit, and predicted player debate; a standalone
card rank is not a puzzle-quality score. Existing retrospective pick-policy
research is not reopened and no production policy is promoted by this study.

Data attribution: 17Lands.com public datasets, CC BY 4.0; transformed by Pack One.
See https://www.17lands.com/public_datasets and
https://creativecommons.org/licenses/by/4.0/ . Raw archives, draft IDs, and
per-game arrays stay in ignored working directories. Public results are
aggregate research metrics and card-level derived statistics only.
