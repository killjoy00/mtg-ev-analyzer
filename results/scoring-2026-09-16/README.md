# Automated scoring experiment — September 16, 2026

**Recommendation: retain production scoring. Keep the corrected color-and-pair model as the stronger predictor, but do not ship its raw support ratios as a drop-in grading upgrade.** No tested model/curve cleared the predeclared scoring rule. This does not establish that all candidates are worse; it establishes that this experiment did not demonstrate an improvement in eight-pick score separation.

This work uses model predictions and observed drafts throughout. It requires no manual grading panel. GIH/IWD is not blended into either predictor.

## Data and procedure

Six public draft/game archives: TMT, HOB, BLB, MSH, SOS and Powered Cube. The full validation measurement contains **130,254 decisions** from elite and experienced control cohorts. Elite decisions divide into 24,830 for display calibration, 26,703 for curve selection, and **25,399 from 2,554 drafts for assessment**. Assessment also includes 17,441 control decisions.

The protocol and implementation were committed before calculating the aggregate selection/assessment report. Models use the same train split and behavior training cap of 5,000; small sets have fewer training drafts. Color tables use only elite training drafts, with cache and train-ID provenance checked. Both models use the same table-independent base counts. The original unknown-color fix is included in the new predictor.

These are three disjoint partitions of existing validation data, **not a fresh final test**. Earlier work used this validation population. Powered Cube also appeared in the earlier variant-reserve work. Do not combine this report with the original frozen comparison and call the combined set untouched.

## Prediction improves after accounting for calibration

Display exponents fitted on the separate calibration partition: v2 **2.0**, color-and-pair **1.75**.

| Assessment metric | v2 | Corrected color-and-pair |
|---|---:|---:|
| Top-choice accuracy | 53.40% | 55.53% |
| Raw log loss, exponent 1 | 1.44577 | 1.30084 |
| Log loss with current display exponent 2 | 1.30915 | 1.24059 |
| Log loss with independently fitted display exponent | 1.30915 | 1.22358 |
| Brier score with fitted display exponent | 0.61553 | 0.58554 |
| Top-choice calibration error with fitted exponent | 3.66% | 1.02% |
| Runner-up calibration error with fitted exponent | 1.02% | 1.13% |

The fair calibrated log-loss comparison improves **6.5%**, with a paired draft-bootstrap delta of **−0.08556**, 95% interval **[−0.09115, −0.08051]**. The raw comparison improves about 10%. Calibration changes account for some of the difference between raw and calibrated gains; they do not eliminate the predictor improvement. These numbers are from this sample, not a recalculation of the original six reserve sets.

Accuracy improves **2.13 percentage points**, 95% interval **[1.714, 2.655] points**. Calibrated log loss improves with intervals below zero in all six sets. TMT's assessment top-1 change is exactly zero; HOB's interval includes zero. The improvement is not equally established for every metric and set. Runner-up calibration also shows why a better top-choice calibration number does not certify every alternative's percentage.

## Better prediction does not automatically improve points

With the existing raw scoring curve `round(95 * selected / leader)`, underlying credit below 25 becomes more common for strong-player choices in **every** measured set:

| Set | Assessment decisions | v2 below 25 | New model below 25 |
|---|---:|---:|---:|
| TMT | 1,098 | 4.19% | 6.74% |
| HOB | 1,120 | 3.84% | 7.32% |
| BLB | 7,981 | 4.76% | 7.15% |
| MSH | 4,860 | 5.84% | 9.36% |
| SOS | 7,590 | 4.74% | 6.98% |
| Powered Cube | 2,750 | 4.25% | 7.71% |

Across the 232,349 candidate appearances in those assessment packs, the share scoring below 25 rises from **50.30% to 62.53%**. Mean candidate credit falls by **6.17 points**; the mean change for the card actually chosen is **−1.66 points**. **13.50%** of candidate appearances move by at least 20 points, and the model leader changes in **18.24%** of packs.

These are underlying model awards. Actual trophy matches still receive 100 under the existing product rule, which is excluded from this diagnostic. Strong players can make mistakes; a low score for one observed choice is not by itself proof of a model error. The tail guard is the declared product tolerance for how much a proposed scoring change may increase such penalties.

## Eight-pick scoring rule did not pass

The selection partition tests both predictors at raw exponents 0.5, 0.75, 1, 1.25 and 1.5. A replacement must have a positive paired AUC interval lower bound and satisfy the per-set severe-tail limit. None does. Selection therefore freezes the incumbent for both environments before assessment.

For reference, the assessment comparison at the unchanged raw exponent 1 is:

| Eight-pick simulation | Incumbent AUC | New predictor AUC | Paired delta, 95% interval |
|---|---:|---:|---:|
| Mixed Daily, sampled sets | 0.58444 | 0.57518 | −0.00925 [−0.03951, 0.00075] |
| Powered Cube | 0.59753 | 0.57571 | −0.02183 [−0.04659, 0.01045] |

Each partition/environment has 2,000 complete runs and 200 valid source-draft bootstrap replicates, with 500 paired runs per replicate. Intervals condition on the fitted models. Every synthetic run uses eight distinct source drafts. Profiles use the product's pick windows, difficulty composition and set-selection helpers, restricted to these six sets.

This cohort-separation metric is a useful diagnostic, not an oracle for pick quality. The cohorts faced different packs and built different pools. A better context model can explain behavior common to both skill groups, so reduced discrimination need not mean worse advice. Conversely, higher prediction accuracy alone does not justify harsher scoring. The point of reporting both is to expose this tension, not hide it behind one headline.

The outcome-correlation diagnostic is too small to decide this question: only 886 assessment drafts survive its minimum 200-draft set/skill-stratum requirement. Its regret definition also differs from the earlier Decision 2 experiment. It must not be compared directly with that earlier `r = −0.07125`, or used to reopen the outcome-blend decision.

## What to do next

1. Keep the current live grading and the separation between displayed probabilities and points. Do not change scores merely because the new predictor passed a prediction test.
2. Preserve the corrected color-and-pair predictor and its independently fitted 1.75 display exponent as the candidate for the next version. This dataset supports its predictive improvement. Treat 1.75 as a six-set development fit, not a universal constant certified for all formats.
3. Before promotion, measure candidate credit on a versioned corpus and run the same automated protocol on a newly declared temporal holdout. Improve state matching for cohort comparisons and add stability under retraining. Use independent data to confirm a selected curve; do not keep adjusting the criterion after seeing these assessment numbers.
4. If the product intentionally chooses more generous credit, state that preference explicitly and test a gentler curve against a predeclared noninferiority tolerance. This experiment demanded an improvement in discrimination; it does not prove that a gentler curve is unacceptable. Changing that decision rule now would be a new experiment.

No human-labeling project is a dependency. No production model, corpus or past score was changed by this work.

## Audit and reproduction

- [Protocol](protocol.json): decision rule, grids, sample and declared limits.
- [Full report](report.json): inputs, implementation hashes, both development partitions, calibration bins, subgroup tails and bootstrap intervals.
- [Download manifest](downloads.json): public URLs, archive sizes, ETags and SHA-256 hashes.
- [Runner](run.py): `python results/scoring-2026-09-16/run.py --workers 3` from the repository root.
- [Method and interpretation](../../docs/AUTOMATED-SCORING.md).

Validation: `npm test` passed 134 JavaScript tests and 211 Python tests. Three existing JavaScript suites requiring private replay shards were skipped locally by the repository's test runner; GitHub CI is configured to hydrate those shards and require them. The original Decision 1 artifact still passes the hardened verdict checker, and malformed/incomplete artifacts now fail with a nonzero exit status.
