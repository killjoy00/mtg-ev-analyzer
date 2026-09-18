# Current state

Updated 2026-09-18. This file distinguishes merged implementation from deployed services. Older dated reviews are historical evidence.

## Product and deployment boundary

Pack One is the eight-pick game in [CHARTER](CHARTER.md): Daily Draft Run, Daily Powered Cube, fixed universal Dailies without rerolls, trophy-match 100 and model-based alternatives capped at 95. The homepage is state-aware; free-account regular practice becomes prominent after both Dailies. Shared practice preserves exact decisions. Generic capabilities support future Cube/custom practice.

| Component | Verified state |
| --- | --- |
| Browser | Main auto-publishes to GitHub Pages; core homepage and responsive pool cleanup deployed and smoke-tested |
| Production Neon functions | Last audited release `18f625f320d137b6b5f660bd388c3fb2719b45f6`; backend rebuild not yet promoted |
| Production corpus / selection | `elite-trophy-verified-v6` / `eight-pick-v3` at audit; historical data retained |
| Rebuild target | `elite-trophy-colour-stage-v7`, model `strong-player-colour-stage-v3`, selection `eight-pick-v4` |
| Migrations 0017–0019 | Verified on isolated Neon clones and development (run 35353001925); production application pending reviewed release |

Do not infer backend deployment from Pages success or a checked-in catalog. Update this table using actual health/schema/corpus evidence after rollout.

## Evidence and limitations

PRs 119–124 implement the core homepage, fixed Daily/account enforcement, recent-set selection, practice/capabilities, shared-run semantics, Corpus Operations and ingestion, offline research, scoring explanation and policy review. Applicable unit/browser/SQL checks passed before merge. Browser screenshots cover narrow mobile and desktop, not physical iPhone/native-share behavior.

A 100,000-Daily simulation met all quotas; 87.5993% of decisions came from the newest four releases. Traditional research retained Premier-only production evidence because complete pooling criteria were not established. The six-set frozen-model scoring rerun selected the existing linear partial-credit curve in both environments; production promotion remains separate.

[Initial audit](REBUILD-2026-09-18.md), [distribution](../results/rebuild-2026-09-18/DAILY-DISTRIBUTION.md), [Traditional results](../results/rebuild-2026-09-18/TRADITIONAL-RESULTS.md), [scoring results](../results/rebuild-2026-09-18/SCORING-RESULTS.md).

## Architecture and safe release

GitHub Pages hosts the client. Production uses `pack1api`, `pack1growth` and `draftrunapi` Neon Functions on branch `br-orange-feather-ayps8kep`, project `patient-shadow-91417882`. Development uses `br-twilight-hill-ayffyd2b`. Admin reuses managed Neon authentication and existing membership; decision measurements and Corpus Operations are separate areas.

Neon stores immutable puzzles, source/import records, versioned manifests and audits. Schedules/sessions pin IDs and versions. Older puzzles, results, shared identities and already-created Dailies remain readable. Migration 0019 preserves manifests by set/version. The older deployed API still reads single-version manifests, so staging must explicitly preserve those until the version-aware runtime is deployed.

Reuse the complete verified v7 development import through additive staging, verify signatures/counts, deploy to development, smoke-test, then deploy the same reviewed SHA to production. Never restore development over production or apply destructive historical migration 0016 as part of this rebuild.

The owner subsequently authorized a separate Traditional-as-puzzle-source evaluation using the unchanged Premier-trained v3 model. This is active follow-up work: check partial-credit/disagreement/difficulty and source gates before publishing eligible Traditional inventory. Failure to establish combined-training interchangeability is not the gate for that separate use.
