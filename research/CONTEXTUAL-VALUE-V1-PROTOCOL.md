# `contextual-value-v1` frozen research protocol

**Issue:** #529  
**Protocol date:** 2026-09-25  
**Status:** frozen before viewing `contextual-value-v1` model results  
**Production impact:** none

This protocol converts the September 25 design report into the minimum predeclared experiment needed to decide whether Pack One should continue investing in an outcome-based contextual value engine. It is intentionally narrower than a production migration.

## 1. Estimand

Primary estimand:

> Expected Premier event match wins after replacing exactly one current pick with candidate `a`, followed by naturally occurring downstream drafting, deckbuilding, and gameplay.

This is a one-step intervention. It is not the value of taking a card and then following an optimal policy for every future pick.

For product-facing ranking, candidate value is standardized over a fixed reference skill distribution rather than the historical trophy drafter's exact bucket.

## 2. Population

Primary outcome population:

- modern 17Lands Premier drafts;
- recoverable `draft_id`;
- complete offered action set;
- terminal event result;
- usable pre-treatment skill/experience fields.

Do not require a trophy, elite status, or agreement with the historical pick.

The strong-player cohort remains separate and trains the expert behavior signal only.

## 3. Primary outcome

`event_match_wins` in Premier Draft.

Traditional and Premier events are not pooled into one raw-win outcome in v1.

Secondary diagnostics may include trophy probability, game win rate, and event losses, but they cannot replace the frozen primary endpoint after assessment begins.

## 4. Split and cross-fitting

Outer split salt:

`contextual-value-v1-outer`

Draft-level split:

- 60% train;
- 15% validation;
- 25% locked assessment.

All rows from one `draft_id` stay in one outer partition.

Inside development training, nuisance features/models must be cross-fitted by entire `draft_id`. For a held draft, its picks, games, final deck, and outcome may not influence its own aggregate features, propensity, or outcome nuisance model.

The previous `eval-split` test partition is not reused as a supposedly pristine final assessment for this objective.

## 5. Unit of observation

One real draft decision is the conceptual unit.

Each decision expands to one candidate row per offered card. Only the selected action receives the observed terminal outcome label for direct-Q fitting. Unchosen candidates never receive a copied outcome label.

Every draft-level outcome is repeated across decisions in the source archive, so training losses are normalized to total weight one per draft.

## 6. Primary OPE sample

Primary OPE uses exactly one deterministic hashed eligible decision per held-out draft, restricted to Pack One picks P1P1 through P1P8.

Secondary all-picks analyses may be reported only with draft-cluster uncertainty.

## 7. Nuisance objects

Maintain two distinct behavior objects:

1. `observed_propensity`: broad-population `P(A | S, X)` used for IPW/AIPW/DR.
2. `strong_choice_probability`: current isolated strong-player model used as expert evidence, prior/offset, incumbent policy, and sparse-support fallback.

The strong-player model is not the broad-sample causal propensity.

Outcome nuisance:

`Q0(S, A, X) = E[Y | S, A, X]`

Initial baselines:

- regularized linear Q;
- nonlinear tree/boosted Q challenger selected on validation only.

## 8. DR candidate value

For each available action `a`, use cross-fitted nuisance predictions to form:

`phi_ia = Q_i(a) + I(A_i=a)/e_i(a) * (Y_i - Q_i(A_i))`

Finite-sample fitting may clip inverse weights. Raw unclipped weights remain mandatory diagnostics.

The production-facing value learner, if fitted, is trained only after out-of-fold nuisance predictions/pseudo-outcomes exist.

## 9. Policy evaluation

Primary policy comparison is the contextual candidate policy versus the current v4 strong-player consensus policy.

Report, on the identical locked sample:

- doubly robust policy value (primary);
- direct-Q value;
- IPW;
- SNIPS;
- importance-weight distribution;
- percentage clipped;
- max unclipped weight;
- ESS and ESS/N.

Target-policy temperature is selected on validation and then frozen.

## 10. Clipping and overlap

Mandatory clipping sensitivity caps:

- 10;
- 20;
- 50.

A result whose direction depends on the clipping constant does not pass.

Initial candidate support gate:

`observed_propensity >= max(0.01, 0.10 / candidate_count)`

Weak support creates an unsupported/ingradable decision, not a confident hard puzzle.

## 11. Leakage contract

Forbidden same-draft inputs for a prediction made before the pick include:

- terminal wins/losses;
- future picks;
- realized final deck membership;
- final colors;
- whether the candidate was played/drawn;
- future game outcomes;
- later-draft archetype;
- any aggregate statistic containing the held draft.

Every derived aggregate must carry enough provenance to show which training complement produced it.

## 12. Frozen comparison set

Evaluate:

A. current v4 strong-player consensus  
B. historical trophy choice (agreement only; not same-record OPE)  
C. GIH-only  
D. IWD/IIH-only  
E. existing simple behavior/outcome blend  
F. direct Q without propensity correction  
G. contextual-value-v1 DR candidate

If a trophy-behavior policy comparator is needed, it must be trained out of fold rather than using the observed successful action after the fact.

## 13. Mandatory diagnostics

Outcome model on observed actions:

- MAE;
- RMSE;
- mean bias;
- calibration by prediction decile;
- calibration by set, pick, and skill group.

Overlap/stability:

- propensity distribution;
- target/behavior weight distribution;
- clipped fraction;
- ESS/N;
- coverage by set/pick/skill/candidate rank;
- leader/runner-up support;
- set, pick, skill, experience, rarity, color, commitment, and sparse-card slices.

Bootstrap/uncertainty clusters at `draft_id`, never individual picks.

## 14. Ablations

At minimum remove, one at a time:

- strong-player choice probability;
- GIH;
- IWD/IIH;
- GND;
- deck-fit probability;
- pool/context;
- skill controls;
- card metadata;
- relative-to-pack features;
- propensity correction.

Strong-player evidence must also be compared as propensity initializer/offset, Q feature, prior, fallback, and omitted entirely.

## 15. Pass/fail gate

Before reading locked assessment results, freeze model family, target-policy temperature, feature set, reference skill population, support gates, and clipping rules.

`contextual-value-v1` passes the research gate only if all of the following hold:

1. pooled DR delta versus v4 has a 95% CI entirely above zero;
2. direct-Q and SNIPS deltas have the same positive direction;
3. DR delta remains positive at caps 10, 20, and 50;
4. pooled ESS/N is at least 0.10;
5. no adequately powered environment has its complete 95% CI below `-0.05` expected match wins per one-pick intervention;
6. ablations are coherent and do not expose a leakage proxy;
7. the predeclared out-of-environment holdout shows no separated material harm;
8. before production promotion, the next untouched complete Premier environment reproduces the positive direction and remains above the harm margin.

If overlap fails, the result is inconclusive rather than a win. If the primary CI fails, v4 remains incumbent.

## 16. Environment holdout

HOB may be used as the historical out-of-environment holdout only if excluded from all contextual-value-v1 development.

It is not considered pristine because it has been visible to earlier Pack One work.

The stronger confirmation is the next newly available complete Premier draft/game archive after the model and protocol are frozen.

## 17. Puzzle eligibility

Classify future shadow decisions as:

- supported clear leader;
- supported genuine near-tie;
- unsupported.

Initial support/stability rules include the propensity threshold above, no top contender dominated by clipped residual weights, adequate candidate/context effective support, and at least 80% leader/runner-up pair stability across bootstrap refits for clear/near-tie classification.

The uncertainty-width threshold is selected on validation only.

## 18. Research-only implementation boundary

This phase may create only offline research code and result artifacts under `results/contextual-value-v1/`.

It must not:

- change served puzzle selection;
- change scoring;
- rebuild the published corpus in place;
- write contextual-value outputs into production tables;
- reinterpret existing historical scores.

Any production migration requires a separate versioned corpus/model/scoring decision after the gate above clears.
