# Issue #756 — P1P2–P1P8 recentered-instrument protocol

**Date:** 2026-09-29 PT  
**Status:** frozen before inspecting any P1P2–P1P8 regret/value estimate  
**Production impact:** none  
**Role:** secondary extension of the completed P1P1 study

The same draft-level match outcomes were necessarily opened by the completed P1P1 analysis. Therefore this later-pick extension is **not a pristine new outcome holdout** and must never be described as one. The specification below is frozen before computing any later-pick value/regret estimate.

## 0. Product threshold

Keep the already-frozen **0.02 event match wins per decision** materiality threshold.

This extension asks whether the same conclusion holds over P1P2–P1P8 after recentering the passed-pack instruments for the drafter's pre-pick pool.

## 1. Cohort and incumbent

Use the exact same five #756 environments and exact same prior-use exclusions as the completed P1P1 stage:

FIN, TDM, DFT, MSH, SOS.

Use P1P2 through P1P8 only: raw pack_number=0 and pick_number=1..7.

Research A is unchanged:
- same frozen prior-training IDs;
- same strong-player model;
- highest strong_choice_probability;
- card-name tie break;
- no #756 outcome may influence A.

For later picks, use the strong model's **raw card tendency** before within-pack normalization as a context feature. It is a deterministic function of the frozen A training complement, candidate card, pick stage, and pre-pick pool.

## 2. Why recenter

At P1P1 the unopened pack is generated before the player's draft history.

At P1P2–P1P8 the pack received by the player has been acted on by upstream seats and the player's own pool/history is informative about the table state. Raw offer indicators are therefore not used directly as if they were unconditional random instruments.

For each held-out decision, define pre-treatment state H from the player's pool immediately before the pick.

The instrument is:

Z_tilde = Z - E[Z | H]

where Z is the observed passed-pack composition and E[Z|H] is estimated without that held-out draft.

## 3. State representation H

Fit each environment and pick number separately.

H contains:
- intercept;
- counts of cards already in the focal player's pool.

A pool-card column is retained in a training complement when it appears in at least **200** training pools.

No post-pick, final-deck, game, or outcome variable enters H.

Pool counts are used directly. No outcome-selected dimensionality reduction is permitted.

## 4. Supported actions

Within each environment / pick / fold, a candidate card enters the supported action set only when the training complement has:
- offer appearances >= **200**;
- historical takes >= **40**;
- take rate when offered >= **0.03**.

These rules use no outcomes.

## 5. Context-aware action value

A fixed card effect alone is too crude after P1P1 because pool fit matters.

For each candidate c in state H, define:

s_A(c,H) = logit(clipped frozen-A raw card tendency)

The endogenous action representation E has:
- one-hot selected-card indicators for supported cards;
- one scalar: s_A(selected card,H).

The corresponding candidate value used for held-out ranking is:

V(c,H) = beta_c + gamma * s_A(c,H)

The common state effect of H cancels when comparing cards in the same pack.

Using A's raw context score as one value feature makes the challenger conservative with respect to pool/synergy information already captured by A; it does not force A's ranking because beta_c and gamma are outcome-identified through recentered offer variation.

## 6. Recentered instrument representation

For supported cards, the raw instrument vector contains:
- offered-card indicators;
- maximum s_A among supported offered cards;
- mean s_A among supported offered cards.

For every training fold, regress each raw instrument column on H using ridge linear projection, then use the residual as the recentered instrument.

Frozen state-recentering ridge penalty: **100.0**, intercept unpenalized.

Also residualize the endogenous action representation E and outcome Y on the same H basis before IV fitting.

## 7. IV fitting

For each environment / pick / outer fold:

1. use the other four deterministic draft folds only;
2. construct H, raw Z, E outcome-free except for Y;
3. ridge-residualize Z, E, and Y against H;
4. first stage: residual E on residual Z;
5. second stage: residual Y on first-stage fitted residual E.

Frozen first-stage ridge penalty: **10.0**.
Frozen second-stage ridge penalty: **10.0**.
No penalty search or model-family search.

Deterministic fold salt remains:

a-regret-v1:<draft_id>

so all seven decisions from a source draft stay in the same outer fold.

## 8. Outcome-free recentering / identification gates

Before computing later-pick regret for an environment/pick/fold require:

- supported cards >= **20**;
- residual-instrument numerical rank >= **90%** of supported-card dimension;
- median own-card first-stage coefficient >= **0.03**;
- p10 own-card first-stage coefficient >= **0.005**;
- max absolute mean of held-out recentered offer instruments <= **0.05**;
- max absolute correlation between held-out recentered offer instruments and retained H columns <= **0.10**, computed where both columns have nonzero variance.

The held-out recentering model is trained on the other four folds.

If a pick/environment fails, label it insufficiently identified and do not substitute another environment/pick.

## 9. Regret

For each identified held-out decision:
- require A's pick to be a supported action;
- compute V(A,H);
- compute V for every supported offered candidate;
- IV-best is the candidate with highest V, card-name tie break;
- regret = max(0, V(best,H) - V(A,H)).

Report:
- per environment × pick;
- per pick pooled across environments;
- all P1P2–P1P8 pooled.

## 10. Inference

Because seven decisions share one draft outcome, inference clusters by source draft.

For the overall P1P2–P1P8 statistic:
- first average eligible regret within each draft;
- perform **10,000 environment-stratified draft bootstraps**;
- resample drafts with replacement within environment;
- pooled statistic is the decision-weighted mean of the resampled draft totals/counts.

Report percentile CI95.

This is a secondary analysis and no new “optimal enough” pass may override the failed primary P1P1 gate. The 0.02 threshold is retained only as a materiality reference.

## 11. Close-call audit

For later picks report the same frozen A-margin slices:
- <= .02
- (.02,.05]
- (.05,.10]
- > .10

Also report:
- A vs recentered-IV-best disagreement;
- A vs historical drafter disagreement;
- A vs both;
- by pick number.

## 12. Stop rule

After this freeze, do not change:
- environments;
- prior-use exclusions;
- P1P2–P1P8 window;
- H representation/floors;
- supported-action thresholds;
- A raw-score feature;
- instrument columns;
- ridge penalties;
- fold assignment;
- identification gates;
- bootstrap.

If the recentered instruments fail the gates, report insufficient identification rather than falling back to the unconditional P1P1 instrument.
