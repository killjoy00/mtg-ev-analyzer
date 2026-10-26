# Selected model: GIH-led adaptive strength

Carry forward the **GIH-led adaptive blend** as the selected offline puzzle
model. It has the highest development validation score and the highest primary
point score in both later development games and an additional, previously unused
set. Plain smoothed GIH is a close runner-up; superiority over it is not
statistically established. Adjusted deck-outcome strength alone is no longer
the selected default for puzzle quality.

This is a decision among five tested strength estimators under the fixed v2
context gates. It is not a proof of the optimal possible selector, enjoyment,
or counterfactual drafting value. A prior benchmark's ability to predict whole
deck game outcomes did not establish the best strength ranking for competing
cards in a puzzle. This comparison measures that latter task directly.

## Objective and evidence

Require the historical choice and a substantive alternative to pass strength,
evidence, context, and colour-fit checks; rank by the weaker member's strength.
No observed or predicted Pack One choices enter ranking. A strong isolated bomb
still fails. A weak historical target cannot borrow strength from another card.

The primary objective rewards a selected pair whose two cards both remain above
their format's average later GIH, penalizes a weak/unverified selected pair, and
counts unused planned slots as zero. Sets and the 500/2,000 completed-draft
budgets receive equal weight. The reward is +1 and penalty -1, divided by planned
slots. Sensitivity uses penalties 0, .5, 1, and 2. This is an explicit selection
utility, not a measured player satisfaction score. GIH defines the primary
target; wins with the cards in the deck and opening hand are separate diagnostic
views, not grounds for changing the winner after assessment.

Six sets supplied development data. TMT supplied a new confirmation set: its
early partition fitted card strengths, but none of its validation/test outcomes
selected the candidate or blend weights. The final assessment has 630,944 games
from 114,986 source drafts, including 35,551 games / 6,319 drafts in TMT. All
experiment puzzle sources are excluded. Draft partitions are chronological and
boundary-purged. The finite evidence budgets use completion timestamps, so no
included game follows its strength cutoff. Mature contextual-support snapshots
remain a limitation; this is not an end-to-end release-day replay. The six-set
assessment archives were previously examined; TMT was not used in the earlier
experiments. Transfer calibration is retrospective, not a restriction that all
other sets predate a target set's historical release.

## Results

Counts below sum selections across two early-data scenarios; a puzzle may occur
in both scenarios. They are not counts of independent unique puzzles. Statistical
resampling keeps scenarios paired. Each candidate faced the same planned slots.

| Estimator | Six-set strong / selected | Six-set net utility | New-set strong / selected | New-set net utility |
|---|---:|---:|---:|---:|
| Smoothed GIH | 241 / 345 | 0.2683 | 45 / 56 | 0.4250 |
| Smoothed IWD | 238 / 336 | 0.2670 | 43 / 62 | 0.3000 |
| Adjusted outcome | 188 / 313 | 0.1204 | 33 / 46 | 0.2500 |
| Equal GIH/adjusted blend | 233 / 345 | 0.2348 | 44 / 57 | 0.3875 |
| **Adaptive GIH-led blend** | **247 / 351** | **0.2805** | **46 / 57** | **0.4375** |

The planned totals were 504 and 80 respectively. The selected candidate leads
the primary point objective in validation, development test, and new-set test,
and retains its lead at all four weak-pair penalty values in both early test
cohorts. It is not first in every individual set or evidence budget.

At matched selection volume, the adaptive blend has 199 later-strong pairs from
281 selections versus 176/281 for adjusted-only in the six development sets;
on TMT it has 38/45 versus 33/45. The improvement is not merely serving more
puzzles. Independent-view diagnostics favor the blend over adjusted-only too:
284 versus 206 early development selections have both cards above later deck
win-rate average; 173 versus 137 have both above later opening-hand average.
Those native-volume counts should not be mistaken for matched-volume accuracy.

Full-data secondary results are mixed relative to plain GIH. Development utility
is 0.5164 adaptive versus 0.5156 GIH and 0.3846 adjusted. On TMT, GIH leads at
0.5250 versus 0.4750 adaptive and 0.3750 adjusted. The early-set objective, fixed
before assessment, determines the selected candidate; the full-data result is
reported rather than used to retroactively change its weights.

## Uncertainty and selection history

The paired bootstrap resamples assessment game-source drafts and sets, retaining
shared-card effects across puzzles and budgets. It conditions on fitted strength
tables and fixed portfolios; it does not refit the selection procedure or cluster
unidentified repeated players. The 95% interval for adaptive-minus-adjusted net
utility is [0.027, 0.247] across the six sets and [0.0125, 0.3625] on TMT. The
four-comparison-adjusted intervals cross zero. Against GIH, both ordinary 95%
intervals also cross zero. Thus this is the best observed and independently
corroborated operational candidate, not a demonstrated unique statistical winner.

One selection-rule revision occurred after development validation and before
opening any test results. A candidate-specific one-SE simplicity rule preferred
noisier, lower-scoring IWD to the validation leader. It was replaced with highest
validation utility, complexity breaking exact ties only. The original decision
and protocol are preserved privately. No candidate, data split, eligibility gate,
utility weight, or confirmation outcome changed. See the
[full protocol](PUZZLE-QUALITY-MODEL-SELECTION-V3.md).

## Selected artifacts and implementation

The final weight calibration uses only the six development validation sets:

| Tested strength evidence recipe | GIH component | Adjusted component |
|---|---:|---:|
| 500 completed drafts | 75% | 25% |
| 2,000 completed drafts | 100% | 0% |
| Complete fitting partition | 75% | 25% |

These are weights on format-standardized strength scores, not probabilities of
winning. They are frozen per tested artifact, not a claim that 2,000 is an optimal
live switch point. Do not interpolate a deployment schedule from three research
regimes. Unknown cards remain unknown; zero target-set 17Lands evidence is not
solved by these models. Zero Pack One response history is supported by design.

`scripts/puzzle_quality_v3.py` provides standard-library inference for the selected
estimator and comparators. It verifies the artifact's strength hash, source
exclusions, model/corpus versions, event type, duplicate identities, trajectory,
and removals. The original v1/v2 modules and their historical artifacts remain
unchanged. The 13 new tests cover estimator adaptation, missing components,
immutable evidence, response/future-data isolation, completed-draft cutoffs,
identity recovery after invalid rows, source guards, weight-training isolation,
utility denominators, and the corrected selection rule. All 45 puzzle-quality
tests plus 9 strength benchmark tests pass locally.

The selected full-data artifact was applied to the same 88 supported launch
puzzles: 44 qualify, versus 26 previously; 6 of the 24 pick-7/pick-8 cases qualify,
versus zero. Gates were not relaxed. Detailed cases, new rankings, raw input
snapshots, fitted artifacts, and uncertainty outputs remain private.

Reproduce with authorized private inputs and official game caches:

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python scripts/puzzle_quality_model_selection.py prepare
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python scripts/puzzle_quality_model_selection.py elect
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python scripts/puzzle_quality_model_selection.py assess
python scripts/puzzle_quality_v3.py \
  --contexts raw-data/launch-quality-audit/contexts.json \
  --strength artifacts/puzzle-quality-v3/strength-all.json \
  --selector artifacts/puzzle-quality-v3/selector-all.json \
  --removals raw-data/puzzle-quality-v1/removals.json \
  --out artifacts/puzzle-quality-v3/launch-scores.json
```

Keep the protocol-freeze receipt and input snapshots from the private evidence
package. The phase order freezes the decision before opening test metrics.
Sources: [17Lands public datasets](https://www.17lands.com/public_datasets),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), and
[interpretation guidance](https://blog.17lands.com/posts/using-win-rate-data/).

**Model selection is complete for this comparison.** The selected model is
implemented and available for a serving-adapter rollout. Production Daily
selection, scoring, leaderboards, and database behavior were not changed.
