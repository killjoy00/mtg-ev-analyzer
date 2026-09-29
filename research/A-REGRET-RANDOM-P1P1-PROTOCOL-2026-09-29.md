# A regret bound from randomized Pack 1 variation

**Issue:** #756  
**Date:** 2026-09-29 PT  
**Status:** frozen before any new #756 outcome computation  
**Production impact:** none

This protocol continues the completed #529 research without reopening or retuning #529.

## 0. Decision rule

The practical threshold is fixed at **0.02 event match wins per decision**.

Primary P1P1 verdict:

- Let R_A be the average regret of incumbent research A relative to the best statistically supported offered alternative under the frozen randomized-offer value model.
- Report a two-sided 95% interval and its upper endpoint.
- **Optimal-enough gate:** the upper 95% endpoint for average P1P1 regret is **< 0.02 wins/decision**.
- Otherwise the study does not establish optimal-enough status. Report the point estimate and uncertainty; do not change 0.02 after outcomes.

This is a product materiality gate, not a claim that literal perfect play has been identified.

## 1. Incumbent A

A is the exact leakage-safe research-A definition already used by #529:

1. estimate strong_choice_probability with ArchiveSignalProvider from the set's frozen prior-training IDs only;
2. choose the highest probability candidate;
3. break exact ties by card name.

New #756 outcomes may never influence A.

The existing deployed-A/research-A parity work is separate. This study evaluates the frozen research-A decision rule because it can be reproduced leakage-safely on arbitrary historical packs.

## 2. Frozen P1P1 environments and prior-use boundary

Primary environments:

FIN, TDM, DFT, MSH, SOS

EOE is excluded because #529 already opened all 91,377 P1P1 outcomes outside its 13k boundary.

Before outcome analysis, reconstruct an exact prior-use ledger:

- FIN/TDM/DFT: exclude the original 13,000 #529 boundary and the subsequent exact 15,000-draft R independent-confirmation reserve. This is the first 28,000 stable-hash eligible drafts used by the retained #529 machinery.
- MSH/SOS: exclude every MSH/SOS draft in the pooled #529 core 8,000-draft cohort.
- Any additional exact prior-use ID discovered from retained #529 artifacts is also excluded conservatively.

Expected P1P1 supply from already recorded inventories, after the known later FIN/TDM/DFT confirmation use:

- FIN: 112,237
- TDM: 73,323
- DFT: 115,504
- MSH: 66,003
- SOS: 105,197
- total: 472,264

These are verification targets, not inputs to the estimator. The MSH target includes 1,146 additional exact early-exploratory prior-use IDs found in the retained #529 spent-draft ledger before any #756 outcome was opened. If regenerated counts differ, fail closed before outcomes rather than silently changing the cohort.

Use every remaining eligible P1P1 draft. No outcome-dependent subsampling.

## 3. Randomization and estimand

The exogenous shock is the legal **collated P1P1 pack** received by the drafter.

The card selected from that pack is observational.

For each set, define:

- Z: vector of offered-card indicators/counts in the random P1P1 pack;
- D: one-hot historical selected card;
- Y: recorded event match wins.

Primary value model is a **regularized card-action IV projection**:

Y_i = alpha_s + beta_(D_i) + epsilon_i

with historical chosen-card indicators treated as endogenous and offered-pack composition used as instruments.

The model is fit separately by set for the card coefficients and combined only at the regret aggregation stage. Set-specific fits avoid pretending unrelated card identities share a common absolute intercept.

Identification remains subject to the #529 exclusion caveat: card presence changes the rest of the collated pack, passed-card information, and possible P1P9 wheel behavior. Therefore the result is an IV/randomized-offer policy-value projection, not an assumption-free value of physically adding one card to a fixed pack.

## 4. Frozen support and regularization rules

No card enters the statistically supported action set unless, in the **training complement only**:

- P1P1 appearance count >= **250**;
- historical take count >= **50**;
- take rate when present >= **0.05**.

These thresholds are outcome-free.

For each set/fold:

1. build sparse offered-card instrument matrix Z;
2. build chosen-card action matrix D;
3. include a constant;
4. fit ridge first stage by solving (Z'Z + lambda I)^-1 Z'D;
5. form fitted actions D_hat;
6. fit second-stage ridge card values from Y on D_hat.

Frozen ridge penalty: **lambda = 10.0** in both stages, with the intercept unpenalized.

No lambda search is permitted.

Required identification diagnostics per set/fold:

- supported-card count >= **25**;
- design numerical rank >= **90%** of supported-card dimension;
- median own-card first-stage predicted-probability increase when offered >= **0.05**;
- 10th percentile own-card first-stage increase >= **0.01**.

If any environment fails these gates, that environment is reported as insufficiently identified and is excluded from the pooled primary regret only if the failure was determined without outcomes. The pooled report must show both the all-predeclared-environment gate status and the identified-environment result. No replacement set may be added.

## 5. Cross-fitting and winner's-curse control

Use **5 deterministic folds by draft_id**, stable hash salt:

a-regret-v1:<draft_id>

For each held-out fold:

- fit IV value coefficients using only the other four folds;
- fit/reproduce A using only the frozen prior-training IDs, never held-out #756 outcomes;
- score held-out P1P1 packs.

For a held-out pack, consider only cards satisfying the fold's frozen support rules.

Let:

- V_A: IV value estimate of A's selected card;
- V_star: maximum IV value among statistically supported offered cards.

Point regret:

r_i = max(0, V_star - V_A)

If A's card itself is unsupported, the decision is excluded from the primary regret denominator and counted explicitly. Coverage must be reported.

A naive in-sample maximum is forbidden. All pack-level maxima are computed from models that did not use that draft's outcome.

## 6. Primary inference

Primary aggregation weights every eligible held-out decision equally across all identified environments.

Uncertainty uses **environment-stratified draft bootstrap** over the already cross-fitted pack-level regret rows:

- 10,000 bootstrap draws;
- resample drafts with replacement within each environment;
- preserve each environment's original sample size;
- pooled statistic is the simple mean across all resampled eligible decisions.

Primary 95% interval is the percentile interval of the bootstrap distribution.

This interval captures finite-sample variation of the held-out regret distribution but not the full uncertainty of the fitted IV coefficients. Therefore add the following conservative model-uncertainty sensitivity:

- refit the 5-fold pipeline on **200 environment-stratified bootstrap resamples** of the full #756 cohort;
- recompute pooled average regret each time;
- report the 2.5/97.5 percentiles as the **refit-bootstrap interval**.

The **optimal-enough gate uses the larger upper endpoint** of:
1. the 10,000-draw held-row bootstrap CI;
2. the 200-refit bootstrap CI.

If the refit bootstrap cannot complete, the study cannot pass the optimal-enough gate.

## 7. P1P1 close-call / error audit

Predeclared descriptive slices:

1. A top-two strong_choice_probability margin:
   - <= 0.02
   - (0.02, 0.05]
   - (0.05, 0.10]
   - > 0.10
2. A vs IV-best disagreement.
3. A vs historical drafter disagreement.
4. A vs both IV-best and historical drafter.
5. A confidence quartiles.

For each slice report:
- n;
- mean regret;
- median regret;
- p90 regret;
- share with regret > 0.02;
- A/IV-best agreement rate where applicable.

These slices do not change the primary sample or threshold.

## 8. Later picks P1P2-P1P8

The P1P1 result is frozen first.

A later-pick extension is permitted only under a separate outcome-free freeze that implements a **recentered pack-shock instrument** conditional on the player's pre-pick pool/history. The simple P1P1 offer-indicator IV must not be reused unchanged.

Later-pick research must:
- simulate/reconstruct the conditional expected offered-card instrument under the observed pick/pool state;
- use observed - expected recentered instruments;
- verify mean-zero/balance outcome-free;
- keep one-step intervention followed by natural continuation;
- use the same 0.02 practical threshold unless a new threshold is frozen before any later-pick outcome.

## 9. Definitive future experiment

A randomized recommendation experiment remains the definitive direct policy test.

No retrospective analysis in this issue is to be described as equivalent to randomizing recommendations.

## 10. Stop rule

No post-outcome changes to:
- 0.02 threshold;
- environments;
- prior-use boundary;
- folds;
- support thresholds;
- lambda;
- IV specification;
- bootstrap rules;
- close-call slices.

If diagnostics fail, report insufficient identification. Do not rescue the result by changing the model after outcomes.
