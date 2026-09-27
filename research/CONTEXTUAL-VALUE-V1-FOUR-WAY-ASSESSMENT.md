# contextual-value-v1 four-way locked-assessment amendment

**Issue:** #529  
**Decision date:** 2026-09-27  
**Status:** frozen before opening the locked assessment  
**Production impact:** none

This amendment preserves the original `research/CONTEXTUAL-VALUE-V1-PROTOCOL.md` estimand, outcome, cohort, primary OPE unit, overlap requirements, clipping caps, harm margin, and production boundary. It changes only the finalist/evaluation multiplicity handling after the completed fresh-environment confirmation.

## 1. Why this amendment exists

The original protocol assumed one contextual-value finalist would reach assessment. After development plus the predeclared fresh-environment confirmation, four already-frozen score policies remain scientifically relevant and the user explicitly directed that all four remain alive:

- **H** — simple deterministic contextual-value policy using the strong-offset-only behavior nuisance during development, with learned strong-player choice fields removed from Q/value ranking;
- **J** — frozen propensity-free outcome-residual card-specific correction on simple Q, with `L2=10000`;
- **N** — deterministic no-strong-player-evidence value policy;
- **Q** — frozen rich boosted-Q deterministic policy.

This amendment does **not** authorize a new model, new feature, new hyperparameter, new threshold, or post-assessment tuning.

## 2. Frozen model identity

The four score policies must be loaded unchanged from:

- source workflow run: **36337059424**
- artifact: `contextual-value-v1-four-way-freeze`
- artifact id: **10937572236**
- artifact digest: `sha256:a4fe172b10cb2a435e5a21df85d9b263ccfeaca4cfc647a8d690fcdbfaef933f`
- model bundle fingerprint: `d1f3cb78d1674b1424805b33637c89d3f3977baa890db61ff534fa7700cb5f33`
- source branch commit: `63b0c9148c1416c01c97f0290fb0e41955468dc0`

The bundle parity checks must remain true before assessment outcomes are read.

## 3. Locked assessment identity

Use the **original immutable 8,000-draft MSH/SOS/ECL/TLA cohort** created before model results were viewed:

- source workflow run: **36256947308**
- artifact: `contextual-value-v1-preprocessed-core-8000`
- artifact id: **10911228866**
- artifact digest: `sha256:664bb3a1c84a905f6d8e228cb0af8af529397d13f23e2be7366ca4c55be1a232`

The assessment set is exactly the rows whose saved cohort manifest has `split == "assessment"`. Do not reselect draft IDs from current archives.

Before loading assessment outcomes, downloaded MSH/SOS/ECL/TLA draft/game archives must match the SHA-256 values recorded in the original `archive-manifest.json`. Any mismatch is a hard stop.

## 4. Development-only fitting allowed at assessment time

The four target score policies are not refit.

The following nuisance/evaluation components may be fit using only the original **train + validation** draft IDs:

- leakage-safe aggregate signals used to score assessment decisions;
- the fixed strong-offset-only behavior nuisance used by the primary OPE analysis;
- the fixed no-strong-entirely behavior nuisance used only as sensitivity analysis;
- the fixed `L2=10` margin/outcome calibration used for incremental-prediction diagnostics.

No assessment outcome may influence any coefficient, feature definition, model choice, threshold, clipping constant, calibration fit, or nuisance fit.

## 5. Primary assessment sample

Retain the original protocol:

- Premier Draft only;
- MSH/SOS/ECL/TLA pooled locked assessment;
- Pack 1 picks 1 through 8;
- exactly one deterministic hashed eligible decision per assessment draft for primary OPE;
- `event_match_wins` as the primary outcome;
- current v4 strong-player consensus policy **A** as incumbent.

## 6. Per-model research gate

For each of H/J/N/Q versus A, retain the original #529 gate:

1. cap-20 paired draft-cluster DR delta has a 95% CI entirely above zero;
2. direct-Q and SNIPS deltas at cap 20 are positive;
3. DR delta is positive at caps 10, 20, and 50;
4. cap-20 ESS/N is at least 0.10;
5. no adequately powered environment has its complete 95% CI below `-0.05` expected match wins per one-pick intervention;
6. prior ablations remain coherent and no leakage proxy has been exposed;
7. completed out-of-environment/fresh-environment evidence shows no separated material harm.

The unresolved historical question of what numerically constitutes an "adequately powered environment" is not retroactively redefined here.

## 7. Four-model multiplicity control

Because four frozen challengers are now being assessed simultaneously, a model is called **familywise-confirmed** only if, in addition to the per-model gate above, its paired draft-bootstrap cap-20 DR delta versus A has a **98.75% two-sided percentile interval entirely above zero**.

This is a Bonferroni family-wise rule for four primary comparisons (`alpha = 0.05 / 4 = 0.0125`). The ordinary 95% interval is still reported to preserve continuity with the original protocol.

Use 10,000 deterministic bootstrap draws with seed 529 and resample assessment drafts jointly across all four policies and A.

## 8. Multiple passers

If exactly one challenger is familywise-confirmed and clears the original gate, it becomes the sole assessment-confirmed challenger.

If multiple challengers clear both gates, do **not** select the largest point estimate. Compute paired cap-20 DR differences among the passers on the identical assessment drafts with 95% paired-bootstrap intervals.

A unique assessment leader may be named only if its 95% interval is entirely above zero against every other passer. Otherwise all passing models remain co-finalists for serving-corpus shadow evaluation.

If no challenger clears the family-wise rule, current v4/A remains the incumbent even if one or more models look promising on point estimates.

## 9. Secondary diagnostics

Report, without using them to retune models:

- incremental held-out MSE/MAE beyond the shared pre-pick/simple-Q baseline;
- historical-pick agreement;
- J card-specific correction versus state-only control;
- H/J/N/Q pairwise disagreement rates;
- strong-offset-only and no-strong-entirely OPE sensitivity;
- per-set assessment slices for MSH/SOS/ECL/TLA;
- direct, DR, SNIPS, IPW, ESS/N, clipping and maximum weights at caps 10/20/50.

## 10. After assessment

No post-assessment model tuning is authorized.

- Passing challenger(s): shadow-score the current Pack One serving corpus against A, preserving uncertainty/support diagnostics.
- No passer: retain A and record the four-way assessment as negative/inconclusive evidence.
- Production migration still requires a separate versioned model/corpus/scoring decision and the untouched-next-environment confirmation required by the original protocol.