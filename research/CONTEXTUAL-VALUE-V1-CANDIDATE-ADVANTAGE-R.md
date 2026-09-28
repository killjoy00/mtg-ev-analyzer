# Candidate-advantage model R — frozen development protocol

**Issue:** #529  
**Status:** conditional next model family; do not execute unless the Q/Guard-10 evaluator-trust audit passes without a hard validity defect.

## Motivation

Q improved some outcome-prediction diagnostics but its raw argmax policy did not replicate on the frozen 20k confirmation. N likewise demonstrated that better prediction does not imply a better intervention.

Model R therefore changes the learning target rather than adding another generic predictor.

It estimates **relative candidate advantage** directly with an orthogonalized, strongly regularized, partially pooled model. It never assigns the observed draft outcome as a supervised label to every unchosen card.

## Inputs

Development only:

- retained Phase A1 rich pre-pick candidate/context features;
- retained Phase A2 outer-fold shards 0..4 for training;
- retained Phase A2 validation fold -1 for development evaluation;
- same cross-fitted simple-Q nuisance and strong-offset behavior probabilities already present in those shards.

The locked MSH/SOS/ECL/TLA assessment remains spent and cannot tune R.

EOE/FIN/TDM/DFT **fresh assessment partitions remain unopened** and are reserved for a later frozen transfer test if R earns it.

No 20k Q/Guard confirmation outcomes may train, select, tune, calibrate, or threshold R.

## Estimand / training objective

For each observed decision i with candidate set A_i:

- y_i = recorded event match wins;
- e_i(a) = retained cross-fitted behavior propensity;
- q_i(a) = retained cross-fitted simple-Q nuisance;
- x_i(a) = rich candidate feature vector, excluding strong-player choice fields.

Define the behavior-weighted baseline:

`mu_i = sum_a e_i(a) q_i(a)`

and outcome residual:

`r_i = y_i - mu_i`.

Define the behavior-residualized observed-action feature vector:

`z_i = x_i(A_observed) - sum_a e_i(a) x_i(a)`.

Fit a partially linear ridge model:

`r_i = intercept + z_i beta_global + z_i delta_set(i) + error`.

This is the variable-action-set analogue of an R/orthogonal learner: action selection is residualized by e, outcome level is residualized by mu, and only the factual observed action receives the realized outcome.

### Standardization

Compute feature scales from the **training z rows only**, using draft-normalized decision weights. Divide each z/candidate feature by that training scale. Near-constant features (weighted SD < 1e-8) receive scale 1 and are retained with effectively zero information.

No validation or assessment statistic may affect scaling.

### Partial pooling / regularization

One fixed model only:

- global candidate-advantage coefficients: L2 = **100**;
- per-environment deviations for MSH/SOS/ECL/TLA: L2 = **1000**;
- intercept unpenalized.

The set deviations are shrinkage terms, not separate per-set models.

No card-name identity coefficients are used. Candidate strength is represented by the existing leakage-safe aggregate signals/static metadata/pack-relative/pool-fit features.

## Policy

For candidate a in environment s:

`R_score(a) = x_scaled(a) beta_global + x_scaled(a) delta_s`.

The common baseline/intercept cancels for ranking.

Primary target policy **R-support**:

1. choose deterministic argmax R score with card-name tie-breaking;
2. if that leader's retained behavior propensity is below the existing project support threshold `max(0.01, 0.10 / candidate_count)`, fall back to A;
3. otherwise use the R leader.

The unconstrained R argmax is reported only as a secondary support diagnostic and cannot replace the primary policy after results are seen.

No score-margin threshold is introduced.

## Development evaluation

On the retained core validation fold only, compare frozen R-support vs the same research A comparator using the retained **simple-Q** and behavior nuisance:

- DR/direct/SNIPS/IPW at caps 10/20/50;
- paired draft-level DR CI95;
- ESS/N, clipping, max weight;
- set/pick/support slices;
- intervention rate vs A;
- unconstrained-R fallback rate and reasons;
- coefficient norms and largest standardized coefficients for interpretability.

H/N/Q/Guard may be shown descriptively but are not competing candidates.

### Development advancement gate

R-support advances only if all are true:

1. cap20 DR point estimate vs A > **+0.05 wins**;
2. DR is positive at caps 10, 20 and 50;
3. direct and SNIPS cap20 deltas are positive;
4. cap20 ESS/N >= 0.10;
5. cap20 CI95 lower bound > **-0.05**;
6. no environment cap20 point estimate < **-0.10**;
7. intervention rate vs A is at least 5% (the policy is substantively distinct);
8. no leakage/parity/support invariant fails.

No hyperparameter, feature-family, penalty, support threshold, or fallback rule changes are allowed after seeing validation.

If R fails, stop this model family. Do not create R2/R3 variants from the same validation result.

## Later untouched transfer test if R advances

Only after freezing exact R coefficients/schema/scales/policy from development may the project open the untouched EOE/FIN/TDM/DFT fresh-assessment partitions.

That transfer test is one challenger vs A:

- single primary R-support vs A;
- cap20 paired DR primary;
- two-sided CI95 must be entirely above zero;
- direct and SNIPS positive;
- caps 10/20/50 positive;
- ESS/N >= .10;
- no adequately evidenced material environment harm.

The fresh assessment may not tune R. A favorable transfer result still remains observational evidence under the documented confounding/timing limitations, but it would be materially stronger than another same-environment development result.

## Stop rule

This is the only new architecture authorized after the Q/Guard closeout.

If the trust audit finds a hard evaluator validity defect, do not run R until that defect is resolved.

If the trust audit passes and R fails its development gate, stop model architecture search under the current observational data/evaluator and retain A.
