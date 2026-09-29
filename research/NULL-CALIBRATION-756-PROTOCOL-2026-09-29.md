# Issue #756 follow-up — null calibration and conclusion correction protocol

**Date:** 2026-09-29 PT  
**Status:** frozen before any synthetic-outcome calibration result  
**Production impact:** none  
**Outcome rule:** synthetic outcomes only. No call to either frozen analyzer's `read_new_outcomes` / `read_outcomes` function is permitted.

## Purpose

Calibrate the positive-max regret statistic used by #756:

`max(0, V_best - V_A)`

where `best` is selected by the same fitted values used to measure the gap.

This follow-up tests whether the observed #756 statistics (P1P1 0.1552391; P1P2-P1P8 0.2290850) can arise when A's true regret is zero.

## Frozen estimator paths

Use the exact #756 research cohorts, prior-use exclusions, A training IDs, fold salt `a-regret-v1:<draft_id>`, support rules, ridge penalties, identification gates, recentering, and regret definition.

Recovered frozen sources:
- `research/null_calibration_756/frozen_a_regret_p1p1.py`
- `research/null_calibration_756/frozen_a_regret_later.py`

The later source is the final execution-equivalent source: original frozen estimator plus the #756 accounting/sparse-algebra recovery patch. The sparse change is algebraically identical and does not alter the estimator.

The calibration wrapper may replace only the outcome source and collect additional simulation diagnostics. It may not call the real-outcome readers.

## P1P1 scenarios

Five environments: FIN, TDM, DFT, MSH, SOS.

Noise SD: **2.18 wins**, independent by draft.

Use **20 replicates per scenario**.

### Normal score definition

Within each environment, score all P1P1 cards with frozen research A's context-free P1P1 `card_tendency(card, 0, 0, {})`.

Sort from worst to best by A tendency, breaking exact tendency ties so the higher card-name-tiebreak preference receives the higher rank consistently with A's deterministic choice rule. For rank r=1..N from worst to best, define the Blom normal score:

`z_r = Phi^-1((r - 0.375) / (N + 0.25))`.

### Scenarios

- **a/null:** `v(card)=0`.
- **b/A-optimal-0.10:** `v(card)=0.10*z_A(card)`.
- **b/A-optimal-0.20:** `v(card)=0.20*z_A(card)`.
- **c/noisy-card-0.05:** `v(card)=0.10*z_A(card)+eta_card`, `eta_card ~ N(0,0.05^2)`.
- **c/noisy-card-0.10:** same with card SD 0.10.
- **c/noisy-card-0.20:** same with card SD 0.20.

Card-level noise is redrawn independently by environment and replicate and is fixed for all drafts in that environment/replicate.

Synthetic draft outcome:

`Y_i = v(historical_pick_i) + epsilon_i`, `epsilon_i ~ N(0,2.18^2)`.

For every scenario report pooled true regret on the exact rows eligible to the #756 statistic, pooled estimated regret, replicate SD/range, A/IV-best disagreement, A-margin slice means, and the replicate-0 environment-stratified row-bootstrap CI half-width.

### P1P1 decision rule

Fixed before simulation:

If observed **0.1552391** lies inside the replicate 2.5–97.5% range for scenario (a) **or either scenario (b)**, record the P1P1 #756 result as **uninformative about A's true regret**.

## Later-pick null

Use the same five environments and final frozen P1P2-P1P8 analyzer path.

Use **20 replicates**.

For each replicate draw exactly one synthetic outcome per source draft and share it across P1P2-P1P8:

`Y_draft ~ N(0,2.18^2)`.

All true action values are zero.

### Later decision rule

If observed **0.2290850** lies inside the 2.5–97.5% replicate range, record the later-pick #756 regret statistic as **uninformative about A's true regret**.

## Existing-artifact take-rate diagnostic

Use the original retained P1P1 regret rows only; do not read any outcome.

For each A/IV-best disagreement row, reconstruct the row's frozen fold training complement and compare:
- training-complement take rate when offered for IV-best;
- training-complement take rate when offered for A.

Report pooled mean rates, paired mean difference, and share of disagreements where IV-best has the lower take rate.

## Split-selection valid-design simulation

P1P1 only. Deterministic half split:

`sha256("a-regret-null-power-v1:" + draft_id)` parity.

For each scenario/replicate and each environment:

1. Fit the frozen P1P1 IV value estimator on half 0.
2. On half 1 packs, choose B using half-0 fitted values among cards supported in both half fits.
3. Estimate `V(B)-V(A)` using the half-1 fitted values only.
4. Swap halves.
5. Pool the two directions and all environments by eligible decision count.

Thus the coefficient vector that chooses B is never the coefficient vector that evaluates B.

Report replicate-level estimator bias (`estimate - exact true gain`) and SD for each scenario.

For 0.02-gain power, use the empirical SD of the centered estimation error and a two-sided 5% normal approximation:

`power = P(|N(0.02, SD_error)| > 1.96*SD_error)`.

Report whether any scenario reaches **80%** power. This is a simulation power diagnostic, not a new outcome analysis.

## Seeds

All simulation RNG seeds are deterministic SHA-256-derived seeds from:
`756-null-calibration-v1:<environment>:<scenario>:<replicate>:<component>`.

## Correction rule

If the null calibration shows that a perfect A could produce the observed statistic, amend both #756 result docs and the issue:

- retain: **A was not demonstrated optimal-enough**;
- state the design could not have passed even with a perfect A;
- withdraw claims that A is systematically making materially improvable choices or that #756 established a statistically supported remaining value gap;
- state explicitly that the reported held-row/draft bootstrap CIs condition on fitted coefficients and exclude coefficient uncertainty;
- do not open a model-development issue on the basis of #756.
