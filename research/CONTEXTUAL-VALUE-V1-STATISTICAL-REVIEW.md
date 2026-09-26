# contextual-value-v1 propensity and policy interpretation review

**Issue:** #529  
**Status:** development-only proposal; no locked assessment access

## Confirmed conditional-logit limitation

The current broad propensity is a shared-coefficient conditional logit over candidate feature rows. Any additive feature that has the same value for every candidate in one offered pack adds the same constant to every action score and therefore cancels in the softmax denominator.

In the current feature map this applies, absent interactions, to state-only terms such as:

- user game-win-rate bucket value;
- log experience;
- rank one-hot;
- set one-hot;
- pack and pick number;
- pool size; and
- candidate count.

Those terms can still be useful to Q/value regressions. They do **not** let the current linear propensity express that players of different skill/rank respond differently to candidate-specific signals.

The current shared feature map also mixes raw win-rate, log-experience, binary one-hots, and card-statistic scales under L2-regularized fits. For propensity, the action-invariant skill terms still cancel regardless of scale. For Q/value, feature scale changes the effective regularization penalty. Before freezing Q/value specification, either justify the current scales or predeclare train-complement-only standardization and evaluate it as an explicit development specification change; do not normalize using validation or assessment statistics.

## Source-timing boundary

The parser enforces that rank, user-game-win-rate bucket, and experience bucket are constant across all picks of one draft, and they are exposed through `pre_treatment_state()`. That is evidence of draft-level stability in the imported archive, not proof of the upstream timestamp semantics.

Before freezing a propensity specification, the source documentation/schema contract must establish that those skill fields summarize information available before the draft rather than outcomes updated by games after the draft. Until then they should be described as presumed pre-treatment source fields whose upstream timing still requires verification.

External verification on 2026-09-26 did not resolve this: the official 17Lands public-datasets page says draft rows include the user's overall win rate, but does not define the temporal cutoff used to build `user_game_win_rate_bucket` / `user_n_games_bucket`. The public schema listings identify those columns but likewise do not establish that the current event is excluded. Do not upgrade the causal claim until that upstream definition is confirmed. Source: https://www.17lands.com/public_datasets

Even if their timing is valid, the public archive does not provide a stable player identifier here. Draft-level clustering handles repeated picks inside one draft but cannot cluster repeated drafts by player. Unobserved player preference/skill confounding therefore remains an identification limitation.

## Policy estimand clarification

The frozen primary G endpoint is the validation-selected temperature-softened stochastic policy. A is a deterministic argmax of a leakage-safe v4-style strong-player refit. This is a valid comparison of those two target policies, but it does not by itself show that always choosing G's highest score improves outcomes.

The development report should therefore retain the stochastic G endpoint as primary and report deterministic argmax(G score) only as a clearly secondary diagnostic. A production fallback/eligibility rule must be explicitly frozen before it can be evaluated as a target policy.

The A comparator is reconstructed from the research training complement. Unless an exact deployed model snapshot is loaded and scored leakage-safely, it must not be described as the literal deployed production model.

## Smallest useful propensity experiment

Run one core-pool challenger against the existing propensity, using **MSH + SOS + ECL + TLA train and validation only**. HOB/TMT may be inspected later as stress tests but cannot choose the challenger.

Baseline: current shared-coefficient propensity and strong-choice offset, unchanged.

Single challenger: separate propensity-only feature map containing the current candidate-varying terms plus a small predeclared interaction block:

- train-complement-standardized skill × log strong-choice probability;
- standardized skill × GIH and IWD;
- standardized experience × log strong-choice probability; and
- rank-group × log strong-choice probability.

Do not put these interactions into Q/value merely to run this test. The plumbing should separate propensity features from Q features so the experiment isolates the behavior-model question. Keep the existing outer draft folds and inner aggregate complements. Use the existing propensity regularization initially so family and regularization are not changed simultaneously.

Primary nuisance diagnostics for baseline vs challenger:

1. out-of-fold selected-action multiclass log loss;
2. candidate-probability calibration;
3. leader/runner-up and candidate-rank local support by set, pick, skill and experience;
4. clipping fraction and ESS/N for A and G;
5. A-vs-G DR/direct/SNIPS direction and clipping sensitivity as downstream sensitivity diagnostics, not as a license to open assessment.

Persist optimizer objective/gradient or an equivalent convergence diagnostic for the challenger. The current fixed-iteration fitter does not expose enough information to establish convergence.

Decision rule: keep the simpler baseline unless the challenger materially improves held-out propensity fit/calibration or local support without creating unstable downstream OPE behavior. Any adoption is a global specification choice and must be made from core development evidence before the model is frozen.

## Remaining interpretation constraints

- Global ESS/N does not establish support for the leader or runner-up at a specific decision.
- Validation-selected confidence intervals are exploratory because policy/configuration selection has already seen validation.
- Set/pick/skill/experience stability slices are diagnostics; small slices are not independent confirmatory tests.
- The deterministic top-ranked-card diagnostic does not define a production fallback. That rule remains to be frozen.
