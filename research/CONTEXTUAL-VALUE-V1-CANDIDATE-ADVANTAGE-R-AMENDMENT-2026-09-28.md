# Candidate-advantage R pre-results amendment — 2026-09-28 UTC / 2026-09-27 PT

**Issue:** #529  
**PR:** #674  
**Branch:** `research/contextual-value-v1-h-freeze-audit-529`  
**Status:** pre-results amendment; no R fit or R validation outcome has been produced.

This amendment supersedes the affected sections of
`CONTEXTUAL-VALUE-V1-CANDIDATE-ADVANTAGE-R.md`. The original file remains
for audit history.

## Why an amendment is required

Three launch attempts failed **before R fitting/report generation**:

- run 36382973426: missing scikit-learn import dependency;
- run 36383037600: fold 0 lacked `behavior` / `q_simple`;
- run 36384470871: reconstructed fold 0, then stopped on fold 1 lacking the same arrays.

No R coefficients, validation policy estimate, validation CI, validation gate,
or R outcome report exists from those attempts.

The retained Phase A2 training shards 0..4 predate commit 07e49094 and contain
`phi_rich` / `phi_simple` but not `behavior` or `q_simple`. The nuisance
values must therefore be joined from the retained
`strong_offset_only-fold-{0..4}` artifacts in run 36280148906, not assumed to
be inside the shards.

The R workflow must pin `scikit-learn==1.9.1` because imported Phase A2 helper
code imports sklearn at module load.

## Existing status carried forward

Trust audit run **36377587255** completed successfully with
`reconstruction_validity_defect_found=false`. Q and Guard-10 remain retired
from threshold/blend tuning.

The spent 20k cohort contains **4,783 / 20,000 (23.9%)** records with fewer
than seven wins and fewer than three losses. This is an outcome-definition
limitation. **Never condition the R analysis on apparent event completion.**

The 20k cohort remains spent. Its only newly authorized use is the
all-eligible-vs-single-hashed estimator variance diagnostic described below.

## A. Amended evaluator

### Primary development / transfer estimand

At **every available eligible P1P1–P1P8 decision** in a draft (Phase A2
zero-based representation: `pack_number == 0`,
`0 <= pick_number < 8`), compute the paired policy terms for R-LCB and A.

For draft d with n_d available eligible decisions, decision j receives analysis
weight:

`u_dj = 1 / n_d`.

For caps 10 / 20 / 50 report:

- DR;
- direct;
- IPW;
- SNIPS;
- ESS / ESS-N;
- clipped fraction / maximum unclipped weight.

DR/direct/IPW are averaged within draft using u_dj and then across drafts.
SNIPS uses the same u_dj-weighted numerator and denominator. ESS uses the
corresponding weighted importance contributions.

Primary uncertainty is a **draft-cluster bootstrap**: resample drafts, retain
all of each sampled draft's eligible decisions, and recompute the paired
R-LCB minus A estimator.

This targets the average **one-step intervention effect over eligible
P1P1–P1P8 positions**. It is equivalent to the expectation of selecting one
eligible position uniformly within a draft when positions are all available;
it is **not** the effect of following R for eight picks or for an entire draft.

### Secondary estimator

Retain the historical deterministic single-hashed-decision estimator as a
secondary sensitivity only.

### Spent-20k efficiency diagnostic

Before any R validation outcome is read, rerun frozen A / Q / Guard-10 on the
spent 20k cohort at every eligible P1P1–P1P8 decision and report, separately
for Q-A and Guard-10-A:

- per-draft cap20 DR-delta variance under the registered single-hashed
  estimator;
- per-draft cap20 DR-delta variance under the amended all-eligible estimator;
- variance ratio `single / all`;
- point-estimate parity/sensitivity.

This is diagnostic only. The registered 20k result is unchanged.

## B. Estimator R-prime

The residual-on-residual target remains:

`mu_i = sum_a e_i(a) q_i(a)`

`r_i = Y_i - mu_i`

`z_i = x_i(A_observed) - sum_a e_i(a) x_i(a)`.

### Nuisance join / parity

For folds 0..4 join
`strong_offset_only-fold-{fold}.jsonl.gz` from run 36280148906 to the
retained Phase A2 shard by exact `decision_id` and candidate name.

Hard-stop assertions:

1. decision sets match exactly;
2. offered candidate sets match exactly;
3. `abs(sum_a e_i(a) - 1) <= 1e-9`;
4. on every unselected candidate,
   `phi_simple == q_simple` to exact floating-point equality;
5. on the selected candidate, recompute the stored cap20 pseudo-value from
   `q_simple`, `e`, outcome, and cap20 and require numerical equality at
   tolerance 1e-10.

No nuisance is refit to repair these old shards.

### Candidate-feature cleanup fixed before outcomes

The candidate schema remains the frozen rich feature family, with these
predeclared linear-dependence removals:

- drop `card:metadata_missing` **only if** its residualized z column is
  identically zero in both training and validation features;
- drop all eight `packrel:*:range` columns **only if** residualized z is
  identically zero;
- drop all eight `packrel:*:present_fraction` columns **only if**
  residualized z is identically zero;
- among the five
  `packrel:{gih_wr,gnd_wr,iwd,log1p_gih_games,log1p_gnd_games}:present`
  columns, retain `packrel:gih_wr:present` and drop the other four **only
  if** all five residualized columns are exactly identical.

If any assertion fails, stop before R validation outcomes; do not silently
change the feature list.

### Final-stage observed-state controls

Fit weighted ridge:

`r_i = alpha + controls_i gamma + z_i beta_global + z_i delta_set(i) + error`.

Controls are fixed before outcomes are examined:

- set × exact draft-position intercepts, where position is the exact
  (`pack_number`, `pick_number`) pair;
- linear recorded `user_game_win_rate`;
- linear `log1p_user_games`;
- the frozen rank one-hot state columns.

Candidate z features are standardized using training rows only. Controls are
not used to rank cards; they are outcome-baseline controls in the final-stage
fit.

Regularization remains exactly:

- global candidate coefficient L2 = **100**;
- set-deviation L2 = **1000**;
- intercept and observed-state controls unpenalized.

The protocol no longer calls L2=100 “strongly regularized.” The pre-run report
must show the relevant Gram diagonals and penalty/curvature scale. J's archived
implementation used L2=10,000; this is a comparison, not a reason to retune R.

Set deviations remain fit-time nuisance/shrinkage terms only. The target policy
uses the global beta vector only.

### Secondary early-window fit

Report a **P1P1–P1P8-training-only** R-prime fit as a secondary diagnostic,
using the same feature cleanup, controls, penalties, support rule, and frozen
LCB constant. It cannot replace the primary all-pick training fit.

## C. Primary policy R-LCB

R-support no longer determines advancement.

For each eligible validation decision:

1. A's frozen leader is the baseline.
2. If A's leader has frozen strong-offset behavior propensity < **0.05**, keep A.
3. Candidate alternatives are eligible only when their frozen strong-offset
   behavior propensity is >= **0.05**.
4. For candidate a, define global-model advantage over A:

   `Delta_a = (x_a - x_A)^T beta_global`.

5. Estimate

   `s_a^2 = (x_a - x_A)^T V_beta (x_a - x_A)`,

   where `V_beta` is the global-beta block of a draft-clustered empirical
   sandwich covariance from the final training fit.
6. Choose the candidate maximizing

   `LCB_a = Delta_a - c * s_a`

   only if the best LCB is strictly > 0. Otherwise keep A.

### Frozen null calibration of c

No validation outcome is permitted.

Using:

- fitted training covariance `V_beta`;
- validation candidate features;
- frozen validation strong-offset propensities;
- frozen A leaders;

simulate **5,000** independent draws with seed **529**:

`beta* ~ N(0, V_beta)`.

For a fixed c, apply the exact R-LCB rule to every eligible validation decision
using beta* as the null coefficient draw. Define null deviation rate as the
mean fraction of eligible decisions that deviate from A across all draws.

Search deterministic grid:

`c in {0.00, 0.01, ..., 6.00}`.

Freeze the **smallest c** whose null deviation rate is <= **2.0%**.

If no grid value qualifies, stop before validation outcome evaluation.

The numeric c and its null deviation rate must be committed in the pre-run
report before R validation outcomes are read.

Unconstrained R argmax and the superseded R-support policy are secondary
diagnostics only.

## D. Behavior-model sensitivity

Primary policy actions are frozen using the strong-offset nuisance and R-LCB.
They are **not recomputed** under another evaluator.

Evaluate those same frozen R-LCB and A actions under both:

1. frozen `strong_offset_only` behavior nuisance;
2. the already-developed training-only rich/pick-shrunk behavior correction
   from run 36323128790, reconstructed without using R validation outcomes.

The prior artifact's eight training-only P1 lambdas are all 1.0, so the
“pick-shrunk” candidate equals the full rich correction; preserve artifact
parity rather than retuning it.

Advancement requires the **cap20 DR sign for R-LCB minus A to be positive under
both behavior nuisances**. The original primary gate remains evaluated under
the frozen strong-offset nuisance.

A historical labeling bug in
`contextual_value_behavior_rich_correction.py` defines its NLL
`primary_window` using `pack==1, pick 1..8` even though Phase A2 uses
zero-based pack/pick indices. That mislabeled NLL slice is not used to define
the amended R primary window or R-LCB actions. The fixed-policy sensitivity
result from run 36323128790 remains usable because its frozen evaluator uses
the normal primary-decision helpers, and all fitted shrinkage lambdas are 1.0.

## E. Development advancement gate

Keep the prior thresholds, now applied to the **amended all-eligible-decision
evaluator** for primary R-LCB:

1. cap20 DR point estimate vs A > **+0.05 wins**;
2. DR positive at caps 10 / 20 / 50;
3. direct cap20 > 0;
4. SNIPS cap20 > 0;
5. cap20 ESS/N >= 0.10;
6. cap20 paired draft-cluster CI95 lower bound > **-0.05**;
7. no core environment cap20 point estimate < **-0.10**;
8. intervention rate vs A >= 5%;
9. no leakage / nuisance-parity / feature-degeneracy / covariance / support
   invariant fails;
10. cap20 DR sign is positive under the training-only alternative behavior
    sensitivity evaluator.

Before R validation outcomes are read, compute and commit the approximate
**80%-power minimum detectable effect** for this amended evaluator using only
the authorized spent-20k variance diagnostic and fixed development sample
size.

A gate failure means:

> no effect at least as large as the recorded pre-run detectable effect was
> demonstrated in development under this design.

It does **not** prove the candidate-advantage model family has zero effect or
can never work.

## F. Required pre-run report

Before any R validation outcome is read, commit a report generated without
accessing the validation `outcome` array. It must contain:

- exact nuisance-join parity counts / maximum errors;
- training draft / decision counts and fraction of training weight in
  P1P1–P1P8;
- z-balance diagnostics by recorded skill, experience, and pick stage;
- the specifically requested draft-level R² skill/experience balance
  diagnostics with deterministic permutation null (200 permutations,
  seed 529);
- early-pick GIH residual means by recorded-skill group;
- verified zero/identical feature columns removed;
- global and set-deviation Gram-diagonal / penalty scale diagnostics;
- draft-clustered sandwich covariance diagnostics for global beta;
- R-support noise-only deviation rate as a secondary diagnostic;
- frozen R-LCB c, its null deviation rate, and leader-propensity distribution;
- authorized spent-20k single-vs-all variance ratios for Q-A and Guard-10-A;
- pre-run 80%-power MDE.

This report may use training outcomes to fit the training-only R-prime
coefficients/covariance and may use the specifically authorized spent-20k
outcomes for the variance-ratio diagnostic. It may **not** read core validation
outcomes.

## Required tests before launch

Add:

1. end-to-end R loader -> nuisance join -> fit -> LCB policy -> report synthetic
   smoke test;
2. all-eligible draft-weighted evaluator invariants;
3. true-null semi-synthetic case with:
   - skill-dependent behavior;
   - a skill-blind behavior model;
   - a q nuisance containing only a noisy linear skill proxy;
   - no true action effect;
   and report the false advantage for both the amended DR evaluator and R-prime;
4. hard nuisance-join parity tests;
5. exact feature-degeneracy tests;
6. LCB null-calibration determinism tests.

## Correction to J description

J was **not** simply outcome-only residualization.

The archived implementation:

- centered selected candidate features by the **uniform pack mean**;
- subtracted the simple-q value of the observed pick from outcome;
- averaged P1P1–P1P8 candidate residual features within draft;
- used L2 = **10,000**.

R-prime remains substantively different because it uses behavior-weighted
action-feature residualization and a separate candidate-advantage policy, but
that distinction—not “J only residualized outcomes”—is the correct rationale.

## Transfer only if R-prime / R-LCB advances

Do not open a transfer cohort now.

If R advances development, freeze the exact fitted model/schema/scales,
covariance method, numeric c, behavior sensitivity, policy and evaluator, then
pre-register a never-scored cohort per environment:

`select_global_draft_ids(13000 + N) - select_global_draft_ids(13000)`.

Choose N from a predeclared minimum worthwhile effect and an 80%-power
calculation using the amended all-eligible estimator variance from the spent
20k diagnostic. Do not choose N from the R validation point estimate.

Retain the historical EOE/FIN/TDM/DFT 25% assessment partitions as a secondary
replication only.

A P1P1 pack-composition falsification test may be added only if its exact
regression, expected sign/slope interpretation, and power are preregistered
before transfer outcomes are read. Arena pack-generation independence is an
assumption to verify, not a current finding.

## Outcome / identification boundary

Even a positive R-LCB result would support an observational average one-step
policy improvement under measured-confounding / nuisance / support assumptions.
It would not establish:

- causal identification without residual confounding;
- equality to the literal deployed A artifact;
- whole-draft policy value;
- correctness of individual close card rankings;
- a causal effect restricted to “completed” events.

No production change is authorized by this amendment.
