# Current state

Updated 2026-09-18. This file distinguishes merged implementation, validated research, and actually deployed production state. Older dated reviews are historical evidence.

## Product and deployment boundary

Pack One is the eight-pick game in [CHARTER](CHARTER.md): Daily Draft Run, Daily Powered Cube, fixed universal Dailies without rerolls, trophy-match 100 and model-based alternatives capped at 95. The homepage is state-aware; free-account regular practice becomes prominent after both Dailies. Shared practice preserves exact decisions. Generic capabilities support future Cube/custom practice.

| Component | Verified state |
| --- | --- |
| Browser | Main auto-publishes to GitHub Pages; core homepage and responsive pool cleanup are deployed and smoke-tested |
| Production Neon functions | `pack1api`, `pack1growth` and `draftrunapi` are still on the production deployment created around 2026-09-18 16:25 UTC from the reviewed rebuild release; no later function deployment has applied PR132 |
| Production corpus / selection | `elite-trophy-colour-stage-v7` / `eight-pick-v4`; 32 complete v3 imports; previously created schedules and v6/v2 history retained |
| Production model | `strong-player-colour-stage-v3`; Premier-only training evidence remains the production policy |
| Migrations 0017–0019 | Applied and verified for the rebuild release |
| Migration 0020 / source exclusions | Merged on main in PR132, but not present in the production schema yet; the verified exclusion report has not been applied |
| Traditional puzzle inventory | Research supports Candidate inventory for BLB, FIN and DFT, but production contains no Traditional trajectories and no Traditional puzzles are served |

Do not infer backend deployment from Pages success, a green production smoke, or checked-in code. Production state must be established from actual function deployment metadata, schema/corpus evidence and serving behavior.

## Core rebuild evidence

PRs 119–124 implemented the new homepage, fixed Daily/account enforcement, recent-set selection, practice/capabilities, shared-run semantics, Corpus Operations, offline research, scoring explanation and policy review. PR129 promoted the reviewed eight-pick backend release to production. Applicable unit/browser/SQL checks passed before merge, and production smoke verified complete unranked Daily flows, universal packs, no rerolls, scoring caps, retry/resume and universal Daily sharing.

A 100,000-Daily simulation met every quota; 87.5993% of decisions came from the newest four releases. The six-set frozen-model scoring rerun retained the existing linear partial-credit curve. Browser screenshots cover narrow mobile and desktop, but not physical-device authentication, native-share behavior or accessibility testing.

[Initial audit](REBUILD-2026-09-18.md), [distribution](../results/rebuild-2026-09-18/DAILY-DISTRIBUTION.md), [Traditional model experiment](../results/rebuild-2026-09-18/TRADITIONAL-RESULTS.md), [scoring results](../results/rebuild-2026-09-18/SCORING-RESULTS.md).

## Premier outcome audit and source exclusions

The 32-set frozen Premier outcome audit completed successfully after PR131. It verified every included source against the pinned v7 archives and accounted for legal 7-0, 7-1 and 7-2 trophy outcomes. The final audit reported:

- 12,499 approved 7-0 sources
- 32,631 approved 7-1 sources
- 48,622 approved 7-2 sources
- 9 blocked source trajectories requiring exclusion from new play

PR132 added an append-only `corpus_source_exclusions` registry and changed new selection/rerolls to omit blocked source trajectories while preserving historical puzzle IDs, schedules, results, shares and scoring payloads. That change is merged on main, but merging alone does not apply the audit report. As of this update, production does not yet have the `corpus_source_exclusions` table, so the nine blocked sources have not been operationally removed from new selection.

The remaining release step is additive: apply migration 0020, load the reviewed audit exclusions, deploy the compatible backend revision and verify that new play excludes those sources without rewriting history.

## Traditional puzzle-source evaluation

Traditional-as-model-evidence and Traditional-as-playable-puzzle inventory remain separate decisions.

The earlier held-out Premier/Traditional experiment did not establish every criterion needed to replace the Premier-only production training policy. Premier-only v3 therefore remains the production model.

The later Traditional puzzle-source workflow deliberately reused that unchanged Premier-trained v3 model and kept Traditional data out of training. It reconstructed the frozen Premier evidence, required parity before evaluation, applied predeclared support/calibration/difficulty/source-quality gates and produced unpublished Candidate inventory only.

Workflow run 35369484366 completed successfully with:

- BLB: passed
- FIN: passed
- DFT: passed
- HOB: failed the predeclared gates
- `passing_sets = ["blb", "fin", "dft"]`
- `expansion_supported = true`
- `production_changed = false`
- `model_training_changed = false`

The passing inventory represents 23,256 candidate decisions from 2,907 complete eight-pick Traditional trophy trajectories: BLB 852 trajectories, DFT 780 and FIN 1,275. HOB remains excluded. No Traditional publication has occurred; production currently contains zero `TradDraft` trajectory rows.

Operational publication of BLB/DFT/FIN remains a reviewed follow-up. It must preserve source-event provenance, leave HOB out, keep Premier v3 as the grader unless separately changed, and pass the applicable serving/Corpus Operations checks before becoming Live.

## Corpus Operations

The authenticated Corpus Operations area and Candidate/Live/Paused/Retired lifecycle are implemented. Automated discovery/import is configured to create non-serving Candidates and never auto-promote them.

The workflow is intended to run daily and can be manually dispatched against development or production. Its end-to-end new-set ingestion path should still be treated as needing operational proof on a real run/new Candidate before this part of the rebuild is considered fully closed. Archive availability alone never publishes a set.

See [CORPUS-OPERATIONS](CORPUS-OPERATIONS.md) for lifecycle and gate definitions.

## Architecture and safe release

GitHub Pages hosts the client. Production uses `pack1api`, `pack1growth` and `draftrunapi` Neon Functions on branch `br-orange-feather-ayps8kep`, project `patient-shadow-91417882`. Development uses `br-twilight-hill-ayffyd2b`. Admin reuses managed Neon authentication and existing membership; decision measurements and Corpus Operations are separate areas.

Neon stores immutable puzzles, source/import records, versioned manifests and audits. Schedules/sessions pin IDs and versions. Older puzzles, results, shared identities and already-created Dailies remain readable. Additive migrations and versioned releases are the production path; never restore development over production or replay destructive historical migration 0016.

Current release discipline is therefore:

1. verify the exact reviewed artifact/revision in development,
2. stage additive schema/data changes,
3. smoke-test the complete behavior,
4. deploy the same reviewed revision to production,
5. verify actual production release markers, schema and corpus state.

Pages deployment or a generic health smoke is not evidence that a newer backend revision is live.
