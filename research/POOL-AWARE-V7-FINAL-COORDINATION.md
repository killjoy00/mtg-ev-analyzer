# Final v7 coordination contract — issue #1863

Owner coordination addendum, 2026-11-28. Supersedes conflicting earlier
task-specific decision protocols. See the binding issue comment
https://github.com/killjoy00/mtg-ev-analyzer/issues/1863#issuecomment-7241663357.

## Frozen reference and data firewall

Fallback is the reviewed contrast refit from run 46107297635, registry
SHA-256 ba978db88bb5b569a100cfbc53103a697e2ee0a496b1ec9a9c2fcba1f90a6bdc.
Do not use its full-residual coefficients as the reference for a residual
holdout decision. Refit each decision reference on the same training slice.

Use the stage experiment's chronological 70/30 source-draft split for all
design decisions. One cutoff per format across both experienced cohorts;
keep whole sources and exact timestamp ties together, choose the boundary
nearest 70% of sources (earlier boundary on tie). Preserve source pins,
baseline offsets, cohort cutoff, exclusions and pick range. Training-only
eligibility, coefficients, normalizations and draft/game-derived signals.
Baseline data may be used only as predeclared. No validation-window choice
labels in any exploratory job. The final original validation windows are
reserved for one combined acceptance. Earlier validation results are
informational and cannot select a change.

## Dependency DAG (fail closed)

1. Second-color Step 1: derive A/B triggers on the shared residual 30% using
   the same original strata, thresholds and bootstrap, after fitting the
   reference on the 70%. Publish all 31 format split identities, A/B decisions
   and exact feature implementation identity. Missing evidence blocks.
2. Stage: run the one predeclared early/late interaction comparison on that
   feature set. If A fires, established_support is included in both arms
   (single coefficient versus early/late coefficients); if B fires, both
   arms use the approved B feature definition. No new bucketings.
3. Rarity: use the same shared split and selected context structure. Record
   a conditional rarity decision under the card-term rules already frozen.
4. Calibration and ALSA: only after that feature/structure freeze, run their
   residual-holdout decisions. Uniform calibration gap is owner-report-only;
   no global scale, temperature, exponent or generosity correction.
   Context-specific correction must be predeclared, trained on the 70% and
   tested on the 30% across formats. Any established-second-color correction
   belongs exclusively to A. ALSA uses baseline and training residual
   drafts from the full same-format/mode population (mostly ordinary).
   Report ALSA variance explained by existing card terms and v6 support
   by format, eligible versus ineligible, before fitting. Only stage
   interaction or signal for no-card-term cards is permitted.
5. Freeze all adopted/rejected changes and inputs in one manifest. Do one
   combined full-residual refit. The outcome, strong-only and contrast
   card terms are scored under their predeclared rules in the same ONE
   reviewed validation; if multiple alternatives pass, choose the higher
   pooled Strict separation. One read-only production shadow.
6. Every current-refit acceptance check plus second-color calibration
   and noninferiority versus the current refit must pass. Otherwise retain
   current refit. No subsets, second combination, retuning or individual
   promotion. No research deployment, CI gate changes, historical regrades
   or production writes. Use independent workflow concurrency groups or
   cancel-in-progress: false; do not reuse the shared cancellation group.

## Earlier runs

These IDs identify immutable prior work, not approvals:
- 46160682977: second-color full-residual trigger is superseded; its
  separate descriptive validation is not authorized as part of this new
  decision sequence.
- 46160142490: stage residual comparison is provisional. Reuse only if
  A/B both false, exact feature and split parity established, and all
  required reports present; otherwise rerun the fixed comparison only
  after the approved A/B feature implementation is frozen.
- 46160457273: rarity provisional; require the corrected second-color and
  selected stage dependency. Do not treat the old stage dependency as
  authorization.
- 46159835947: calibration validation-window/scale selection superseded.
- 46159931481: ALSA validation-window selection superseded.
- 46158605617 and 46160300756: earlier strong-only/outcome validations
  informational, not final decisions.

Existing historical example replay is descriptive only, never a decision
input; use only anonymous pack/pool/pick inputs and not validation choices.

## Manifest required before final acceptance

Record protocol version; per-format source/window pins; shared split
implementation hash, cutoff and draft counts for each cohort, and
source-membership digest (no raw IDs); ordered decision artifact/run IDs
and SHA-256s; feature/parser and selected stage identity; eligibility
and prior recipe; every adopted, rejected or blocked change; card-term
fit/validation rules; final candidate and fallback identities; final
workflow/run identity. Require all 31 formats for decisions and artifact
provenance. Missing or incompatible inputs cannot pass. The existing
reviewed validation/shadow must not start on a partial manifest.

This document is a coordination contract, not a completed manifest or
empirical adoption result. No new execution is initiated by adding it.
