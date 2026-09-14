# Bounded Draft Run serving

Implementation review: 2026-09-14. Production deployment is a separate release step; a merged backend PR does not deploy Neon Functions.

## Release status, 2026-09-14

Migrations **0012 and 0013 are applied on both Neon branches** (development
`br-twilight-hill-ayffyd2b` and production `br-orange-feather-ayps8kep`) and
verified: `result_persisted_at`, `player_request_limits` and the three serving
indexes (373-375 MB) are present in each. Production was re-checked healthy
afterwards. The additive schema is backward compatible with the previously
deployed function bundles, which ignore the new column, table and indexes, so
the database and code halves of this release are decoupled.

**The function bundles are not deployed yet.** Until they are, the new indexes
are unused and run-start latency is unchanged. Deploy with
`.github/workflows/deploy-functions.yml` (below); no local tooling is needed.

## Selection and data integrity

`worker/draft-run-selection.mjs` queries eligible counts by set, pick and band once, then reads the deterministically selected puzzle and its source trajectory per round. Used-source trajectories are subtracted from the compact counts before the next draw. It keeps the existing seeded random draws, set weighting, pick windows, band mix, source exclusions and preference for distinct sets. It does not sample a fixed prefix of a large archive. Eleven bounded SQL responses replace the full-pool download for a new ten-pick schedule or practice run. Database work still depends on corpus size; no sub-second production latency is promised.

Existing Daily schedules are read before selection. Friend challenges load their exact ten stored IDs, including eligible historical pick depths, without constructing a new run. Resumes keep their reserved session. Stored schedules are never rewritten by this release.

Rerolls filter by environment, pick window, seen sources, band and rating anchors in SQL, then return at most the closest twenty candidates under the existing distance formula. The shared reference selector revalidates those candidates and applies the existing seeded choice. SQL converts stored `real` metadata through its text representation to match the HTTP loader's JavaScript values.

The API no longer caches or downloads the million-row pool. `loadVerifiedPool` remains an offline audit/reference utility. Missing ratings are excluded by the serving join; `/health` separately reports `unrated_puzzles` and `missing_sets` and returns 503 for incomplete coverage. This makes data failures observable without taking every healthy run offline. Missing metadata for a specific stored challenge still fails explicitly.

## Completion recovery

`draft_run_sessions.result_persisted_at` is set in the same SQL statement as the career, environment, ranked-score and completion-event writes. Once acknowledged, completed-run reads do not repeat those writes. If final answer storage succeeds but result persistence fails, an exact pick retry or later GET can still repair completion. Existing completed sessions populate the marker on their first recovery read. Unique keys continue to prevent duplicate results/events.

## Release and rollback

1. Run the PR's backend schema gate. It applies the known additive release backlog (migrations 0012/0013) plus new PR migrations on an expiring isolated Neon branch, compares SQL selection/rerolls with the exhaustive reference, and runs mixed, Cube, measurement and request-integrity integration suites. The parent can lag Git main; [CI synchronization details](REQUEST-INTEGRITY.md) explain why a PR-only migration diff is insufficient.
2. Inspect actual timings against the full copied production corpus. Compare cold and warm starts, existing Daily joins, friend starts, rerolls and concurrent starts. Statement-count reduction alone is not a latency result.
3. Migrations 0012 and 0013 are already applied on development and production (see Release status above); a future migration must be applied before deploying code that needs it. Deploy the reviewed `draftrunapi`, `pack1growth` and `pack1api` bundles by running the **deploy neon functions** workflow with target `development`, checking its output, then running it again with target `production`. It can be started from the GitHub web UI or mobile app. The workflow bundles each entry point from `.github/neon-functions.txt` with esbuild (the runtime Neon's own CLI uses), refuses to upload a bundle that does not expose a default `fetch` handler, then asserts the new `/health` fields and times two practice run starts. No corpus rebuild is required. An ordinary merge still does not deploy anything.
4. Verify health coverage, practice creation/rerolls and recovery. A production ranked Daily completion requires an explicit QA/data-cleanup plan; local and isolated database checks do not establish native-device or production behavior.
5. If deployment regresses, restore the prior function bundle from the deployment history in the Neon console — that history is the only rollback path, because the API exposes no bundle download. Additive indexes/marker may remain. Old functions ignore the marker; a later redeployment repairs it safely.

Trusted ingress rate limiting and a first-party cookie architecture are separate work. Never treat a client-supplied forwarded-IP header as an authenticated network identity, or claim that an in-memory function-instance counter protects the whole service.
