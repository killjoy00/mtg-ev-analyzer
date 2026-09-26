# Core-pool nuisance audit and single optimizer comparison

Issue #529. Plan recorded on issue #529 in comment 5848924908 before new
comparison results. Scope: offline development diagnostics only.

## Why this step precedes a skill-interaction challenger

The first completed core result (run 36256947308 at aa5b17d9) is mixed:
G-A cap-20 DR +0.0524, exploratory paired CI [-0.1837, +0.2873], direct-Q
-0.0925 and SNIPS -0.0182. Q validation bias differs by skill group and
mean target/behavior weights differ materially from one.

`LinearSoftmaxPropensityModel.fit` always performs 250 diminishing-step updates.
There is no convergence evidence in the retained run. Before adding a new
propensity feature specification, test whether the current numerical fit is
close to its own optimum.

## Fixed inputs and unchanged boundaries

Reuse the six explicitly pinned ZIPs from run 36256947308: the compact
train+validation cohort, four full-train validation-fit feature shards (fold -1),
and the pooled artifact. The code records artifact IDs and independently
retrieved GitHub ZIP digests. It checks cohort identity, source code revision,
configuration, archive hashes, feature-complement hashes, fold, selected IDs,
training/validation coverage, offered actions and draft-normalized weights.

The globally selected 8000 MSH/SOS/ECL/TLA drafts and their existing assignments
are unchanged: 4789 train, 1218 validation, 1993 assessment withheld. The five
outer nuisance fits are not recomputed or replaced. No HOB/TMT result selects
anything. The input contract cannot substitute a new archive or cohort.

No raw assessment file is downloaded. The compact source contains only
train+validation outcomes; assessment IDs/counts remain solely manifest metadata.
The audit rejects assessment or unknown IDs before Decision construction.
No production tables, scoring, gameplay, puzzles, or corpora are touched.

## Single comparison, predeclared

The objective is exactly the existing draft-weighted offset conditional logit:

    [sum_i w_i * (logsumexp_a(offset_ia + x_ia beta)
                  - offset_i,chosen - x_i,chosen beta)
     + (lambda / 2) * ||beta||^2] / sum_i w_i

Each draft has total weight one, offsets and features are unchanged, lambda=1.
The normalization and penalty scaling match the scalar fitter. No feature
standardization or state interaction is introduced.

Baseline: reproduce all 250 updates, learning_rate=0.2 and
step=0.2/sqrt(1+epoch/25), zero initialization, in sparse numerical routines.
Tests compare against the native scalar implementation on variable-action-set
fixtures, missing features, offsets, unequal weights and state-only controls.
Finite differences independently test the analytical gradient.

Challenger: L-BFGS-B (no bounds) on that same objective, initialized at the
250-update baseline, maxiter=500, ftol=1e-12, gtol=1e-7. Stopping uses TRAINING
objective/gradient only, never validation. Report the optimizer's message and
whether gradient tolerance was actually reached; an ftol-based success alone
must not be reported as satisfying gtol.

Require maximum absolute baseline validation-probability replay error <=1e-9
and baseline A/G DR replay error <=1e-8 against the retained artifact before
interpreting the challenger. These tolerances allow floating-point accumulation
order differences, not changes in statistical specification. A failed replay
is an implementation failure, not evidence of a better model.

## What the comparison does and does not estimate

Freeze Q predictions, A's complement-refit consensus argmax, G's saved value
coefficients and temperature 0.25. Only the evaluation propensity changes.
Report held-out log loss, calibration, local support, weight normalization,
ESS/N, clipping at 10/20/50 and environment/pick/skill slices. Q diagnostics are
unchanged and separately retained. This is OPE **nuisance sensitivity**, not
retraining G with different pseudo-outcomes and not changing the primary target.
No configuration is selected merely because its G-A estimate is larger.

If solver convergence and held-out calibration improve, the next eligible
experiment is an explicitly specified end-to-end optimizer-only refit across
ALL five existing folds, followed by the unchanged validation protocol. It must
not mix improved validation propensity with old pseudo-outcomes and call that
a new G result. If held-out fit does not improve, audit calibration/local support
before expanding the specification. No assessment access follows either result.

## Skill-source timing remains unresolved

Official source checked September 26, 2026:
https://www.17lands.com/public_datasets (also served at api.17lands.com).
It describes overall user win rate but does not state the temporal cutoff of
`user_game_win_rate_bucket` or `user_n_games_bucket`. The website's separate
performance groups at https://www.17lands.com/metrics_definitions do not prove
archive-column timing. Constancy within a draft is insufficient proof that its
outcomes are excluded. No claim of contamination is made without that evidence.

Do not adopt candidate-specific skill/rank/experience interactions until the
upstream field definition is verified (pre-draft calculation timestamp and
current-event exclusion, or an equivalently defensible source contract).
The baseline already uses these fields in Q and strong-cohort construction;
this remains an identification/freeze risk, not resolved by this solver audit.
Public draft IDs also cannot establish independence of repeat drafts by player.

## Execution and recovery

The isolated PR/manual workflow runs numerical tests and the audit with read-only
permissions; it has no main-push trigger. New code is outside the pooled
workflow's trigger paths so merging it does not restart the 84-minute core run.
It validates that imported baseline modules are unchanged from aa5b17d9.
The original source ZIPs and successful checkpoints are never overwritten.
A failed audit retries only this audit, not any completed cohort/feature/fold job.

Research gate remains incomplete until required ablations, family comparisons,
out-of-environment checks, comparator/support/fallback/eligibility definitions
and configuration freeze are complete, followed by separately authorized locked
assessment. A prospective environment is additionally required for promotion.
