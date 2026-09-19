# Current state

Updated 2026-09-19. This file distinguishes merged implementation from deployed services. Older dated reviews are historical evidence.

## Product and deployment boundary

Pack One is the eight-pick game in [CHARTER](CHARTER.md): Daily Draft Run, Daily Powered Cube, fixed universal Dailies without rerolls, trophy-match 100 and model-based alternatives capped at 95. The homepage is state-aware; a free authenticated account adds regular practice. Shared practice preserves exact decisions. Generic capabilities support future Cube/custom grants.

| Component | Verified state |
| --- | --- |
| Browser | GitHub Pages is deployed from main `ca81f3e783edac5ed49468e400e9b2486ef101f0`. The public set archive reads Live serving coverage from `/v1/set-catalog` instead of the historical replay sample. |
| Production Neon functions | `draftrunapi`, `pack1growth` and `pack1api` were deployed from release commit `ca81f3e783edac5ed49468e400e9b2486ef101f0` and passed development then production smoke in release run 35411929557. |
| Production corpus / selection | `elite-trophy-colour-stage-v7` / `eight-pick-v4`; 29 Live public environments at verification time: 28 regular sets plus Powered Cube. |
| Production model / scoring | `strong-player-colour-stage-v3`; trophy match remains 100 and model alternatives remain capped at 95. |
| Additive rebuild schema | Reviewed additive rebuild schema through migration 0023 is present in production. Migration 0023 was the missing prerequisite caught by release verification before the final production deploy. |
| Traditional source components | Powered Cube component `traditional-cube-p2p7-v3-v1` is Live. BLB/DFT/FIN Traditional study inventory remains separate follow-up work and is not Live production inventory. |

Do not infer backend deployment from Pages success or a checked-in catalog. Browser and function releases are separate, and production promotion must continue to verify schema and the exact reviewed release commit.

## Evidence and limitations

PRs 119–124 implement the core homepage, fixed Daily/account enforcement, recent-set selection, practice/capabilities, shared-run semantics, Corpus Operations and ingestion, offline research, scoring explanation and policy review. Applicable unit/browser/SQL checks passed before merge. Browser screenshots cover narrow mobile and desktop, not physical iPhone/native-share behavior.

A 100,000-Daily simulation met all quotas; 87.5993% of decisions came from the newest four releases. The six-set frozen-model scoring rerun selected the existing linear partial-credit curve in both environments. Production deployment verifies both complete unranked Daily flows, universal packs, no rerolls, scoring caps, retry/resume and universal Daily sharing.

Traditional-as-puzzle-source work is now split by environment and lifecycle. The reviewed Powered Cube P2–P7 Traditional component is Live without changing the Premier-trained model. Regular-set Traditional study work remains non-serving until its own evidence, staging and explicit publication gates pass. Historical Premier evidence and already-created schedules remain immutable.

The public set archive now reports lifecycle-backed Live environments, manifest-derived training/trophy counts and retained first-pack decision depth. It does not use the old roughly 300-seat replay sample as current serving coverage.

[Initial audit](REBUILD-2026-09-18.md), [distribution](../results/rebuild-2026-09-18/DAILY-DISTRIBUTION.md), [Traditional results](../results/rebuild-2026-09-18/TRADITIONAL-RESULTS.md), [scoring results](../results/rebuild-2026-09-18/SCORING-RESULTS.md).

## Architecture and safe release

GitHub Pages hosts the client. Production uses `pack1api`, `pack1growth` and `draftrunapi` Neon Functions on branch `br-orange-feather-ayps8kep`, project `patient-shadow-91417882`. Development uses `br-twilight-hill-ayffyd2b`. Admin reuses managed Neon authentication and existing membership; decision measurements and Corpus Operations are separate areas.

Neon stores immutable puzzles, source/import records, versioned manifests and audits. Schedules/sessions pin IDs and versions. Older puzzles, results, shared identities and already-created Dailies remain readable. Additive lifecycle/component migrations extend serving behavior without rewriting retained historical payloads.

For backend changes, deploy the same reviewed main SHA to development, require the development smoke to pass, verify production schema/front-end compatibility, then deploy that same SHA to production and run the production smoke. Never restore development over production or apply destructive historical migration 0016 as part of this rebuild.

Release verification is intentionally fail-closed. The 2026-09-19 set-archive release demonstrated that the browser may already be published while the backend is still awaiting promotion; schema verification also correctly stopped production until migration 0023 was present. Keep those checks explicit rather than treating Pages success as production-backend evidence.
