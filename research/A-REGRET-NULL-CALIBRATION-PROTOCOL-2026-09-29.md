# Issue #756 follow-up — null calibration and conclusion correction protocol

**Date:** 2026-09-29 PT  
**Status:** frozen before synthetic calibration outcomes are generated  
**Production impact:** none

## Purpose

Test whether the #756 regret statistic itself produces large positive values when A has zero or known regret.

The statistic under audit is unchanged from #756:

`regret = max(0, V_best - V_A)`

where `V_best` is selected by the same fitted card values used to measure the gap.

## Hard outcome boundary

This follow-up **must not read `event_match_wins`**.

All calibration outcomes are synthetic. The draft archives are used only for draft IDs, event type, pick stage, historical pick, offered cards, pool cards, and the frozen research-A skill inputs `user_game_win_rate_bucket` / `user_n_games_bucket`.

For later-pick research-A reconstruction, the game archive may be read only for:
- `draft_id`;
- `main_colors`;
- `deck_*` presence needed by the already-frozen colour-fit model.

The game `won` column and all match/game outcome columns are forbidden.

Before simulation, reconstructed research-A picks/margins must be checked against the retained #756 result artifacts. A mismatch fails closed.

## Frozen #756 machinery

Keep unchanged:
- FIN, TDM, DFT, MSH, SOS;
- exact retained #529 prior-use exclusions;
- research-A definition and tie break;
- 5 folds and salt `a-regret-v1:<draft_id>`;
- P1P1 support rules and lambda=10;
- later-pick H representation, support rules, ridge penalties, recentering and identification gates;
- #756 regret definition.

The frozen analyzer functions for support, first stage, second stage, recentering and scoring are recovered from the exact #756 commits and imported directly.

Only the outcome source is replaced by synthetic Y. Research A is reconstructed outcome-free but must reproduce retained #756 A outputs exactly before any calibration result is accepted.

## Replicates and seeds

P1P1: **30 replicates per scenario**.

Later picks: **12 replicates** for the pure-noise null.

Synthetic draft noise standard deviation: **2.18 wins**, matching the requested calibration.

Randomness is deterministic from SHA-256 of:
`756-null-v1|environment|scenario|replicate|component`.

Card-level perturbations are one draw per card per environment/replicate and are shared across drafts in that replicate.

Draft noise is one draw per source draft.

## P1P1 scenarios

Let A rank all cards in an environment by frozen P1P1 research-A tendency, with card-name tie break.

Normal score for rank r among N cards, rank 1 best:

`z_r = Phi^-1((N - r + 0.5) / N)`.

For every draft:

`Y = v[historical_pick] + Normal(0, 2.18^2)`.

Scenarios:

1. **null**: v(card)=0.
2. **A-opt tau=.10**: v(card)=0.10*z(card).
3. **A-opt tau=.20**: v(card)=0.20*z(card).
4. **perturbed s=.05**: v(card)=0.10*z(card)+Normal_card(0,.05^2).
5. **perturbed s=.10**: v(card)=0.10*z(card)+Normal_card(0,.10^2).
6. **perturbed s=.20**: v(card)=0.10*z(card)+Normal_card(0,.20^2).

For every scored row, exact true regret is computed from v over the same supported offered-action set used by the estimator, conditional on A being supported.

For null and A-opt scenarios, true regret is exactly zero.

Report per scenario, pooled across all five environments:
- mean true regret;
- mean, SD, 2.5th and 97.5th percentile of the pooled #756 estimated-regret statistic over 30 replicates;
- A/IV-best disagreement rate;
- mean regret within the four frozen A-margin slices;
- a 10,000-draw environment-stratified row-bootstrap CI half-width for null replicate 0.

### Frozen P1P1 decision rule

Observed #756 P1P1 statistic: **0.1552391**.

If 0.1552391 lies inside the 2.5–97.5% replicate range of **null**, **A-opt tau=.10**, or **A-opt tau=.20**, record the original P1P1 statistic as **uninformative about A's regret**.

No post-result change to this rule.

## Later-pick null

Use the final #756 recentered P1P2–P1P8 analyzer semantics.

Scenario:
- true v = 0;
- one `Normal(0,2.18^2)` synthetic outcome per source draft;
- the same synthetic Y is used for all seven decisions from that draft.

Run **12 replicates**.

Report pooled #756 statistic mean, SD and 2.5–97.5% range, A/IV-best disagreement, and A-margin slice means.

### Frozen later-pick decision rule

Observed #756 P1P2–P1P8 statistic: **0.2290850**.

If 0.2290850 lies inside the null 2.5–97.5% replicate range, record the original later-pick statistic as **uninformative about A's regret**.

## Existing-artifact take-rate audit

No new outcomes.

For each retained P1P1 #756 row where actual IV-best != A:
- reconstruct that row's original fold training complement;
- compute take rate when offered = historical takes / appearances for the actual IV-best card and A card.

Report:
- row-weighted mean and median take rate for IV-best and A;
- mean/median paired difference IV-best - A;
- fraction IV-best lower/equal/higher than A.

## Independent-selection power design

P1P1 simulation only.

Define half assignment from the **same frozen salt**:

`half = int.from_bytes(sha256("a-regret-v1:<draft_id>")[:8],"big") % 2`.

For each scenario/replicate/environment:
1. fit #756 IV values on half 0 and half 1 separately using the frozen support rules and penalties;
2. for rows in half 1, choose B with half-0 fitted values and measure `V(B)-V(A)` with the half-1 fit;
3. for rows in half 0, choose B with half-1 fitted values and measure with the half-0 fit;
4. require A and candidate B to be supported in both selection and evaluation fits;
5. compute the exact true B-A gain from v on the identical rows;
6. pool decision-weighted across environments.

Report by scenario:
- mean true B-A gain;
- mean estimated B-A gain;
- bias = estimate - truth;
- SD of the estimated pooled gain across replicates.

For the requested power benchmark, use a two-sided alpha=.05 Normal approximation based on the empirical replicate SD:

`power(delta=.02) = P(|N(.02, SD^2)| > 1.96*SD)`.

Report whether power is >=80%.

## Correction rule

After calibration:
- retain only: **A was not demonstrated optimal-enough**;
- if the null calibration shows the estimator would fail the 0.02 gate for perfect A, state this explicitly;
- withdraw claims that #756 demonstrated A was systematically making materially improvable choices or a statistically significant/supported remaining value gap;
- state that the original reported row-bootstrap CIs condition on fitted coefficients and exclude coefficient-selection/estimation uncertainty;
- do not open a model-development issue based on #756.

No production changes.
