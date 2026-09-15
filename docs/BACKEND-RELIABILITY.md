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

The follow-up review verified the prior deployment, then promoted the eight-pick implementation after migration 0014 and compatible frontend publication. Production now runs `draftrunapi` 16, `pack1growth` 7 and `pack1api` 10, all with embedded commit `76e9dca1c21f2122c051246476fdbc8c49aaf5ca`. Development runs the same content in deployments 18, 4 and 3 respectively. Exact HTTP acceptance and timing evidence are in [the follow-up report](EIGHT-PICK-REVIEW-2026-09-14.md).

## Selection and data integrity

`worker/draft-run-selection.mjs` queries eligible counts by set, pick and band once, then reads the deterministically selected puzzle and its source trajectory per round. Used-source trajectories are subtracted from the compact counts before the next draw. It keeps the existing seeded random draws, set weighting, pick windows, band mix, source exclusions and preference for distinct sets. It does not sample a fixed prefix of a large archive. Nine bounded SQL responses replace the full-pool download for a new eight-pick schedule or practice run (the preserved ten-pick selector uses eleven). Database work still depends on corpus size; no sub-second production latency is promised.

Existing Daily schedules are read before selection. Friend challenges load their exact stored eight or ten IDs, including eligible historical pick depths, without constructing a new run. Resumes keep their reserved session. Stored schedules are never rewritten by this release.

Rerolls filter by environment, pick window, seen sources, band and rating anchors in SQL, then return at most the closest twenty candidates under the existing distance formula. The shared reference selector revalidates those candidates and applies the existing seeded choice. SQL converts stored `real` metadata through its text representation to match the HTTP loader's JavaScript values.

The API no longer caches or downloads the million-row pool. `loadVerifiedPool` remains an offline audit/reference utility. Missing ratings are excluded by the serving join; `/health` separately reports `unrated_puzzles` and `missing_sets` and returns 503 for incomplete coverage. This makes data failures observable without taking every healthy run offline. Missing metadata for a specific stored challenge still fails explicitly.

## Planner statistics

Migration 0015 explicitly analyzes the scalar serving metadata on both puzzle and rating tables. Existing auto-analyze timestamps are not proof that a newly defaulted column has statistics: `pack_number` was missing them in both development and production during the September 15 follow-up. The mixed eligibility query underestimated its input and performed hundreds of thousands of rating-index probes. Development-only refresh of that column changed the query to a parallel hash join and reduced two warm-query observations from 4.53 seconds before to 1.92/1.67 seconds after. These are SQL timings, not full HTTP response times or a load-test SLO.

`worker/serving-statistics.mjs` provides fixed, metadata-only `ANALYZE` statements shared by full trophy imports and rating backfills. They run only after successful import/backfill accounting, not on player requests. The readiness check requires every listed column's statistics and fails closed if any are absent. Deployments and the isolated backend gate run that check; the gate also verifies exact mixed/Cube Daily draws before and after a repeat refresh. Empty tables do not have statistics and cannot pass serving readiness; populate the verified baseline, apply the current schema, backfill ratings, then check readiness before release. The historical baseline loader's `--schema` flag installs only migration 0004 and is not a current production bootstrap.

For an existing branch, apply migration 0015 with the configured owner connection and run `scripts/verify-neon-schema.mjs` using that branch's `DATABASE_URL`. Repeating the migration is safe. Do not rewrite old migrations, run a bulk import merely to refresh statistics, or use `VACUUM FULL`. PostgreSQL's [ANALYZE reference](https://www.postgresql.org/docs/current/sql-analyze.html) documents column-specific statistics and why bulk data changes warrant a refresh. Presence checks detect missing statistics, not arbitrary future distribution drift; keep measuring real query plans and refresh after bulk changes.

## Completion recovery

`draft_run_sessions.result_persisted_at` is set in the same SQL statement as the career, environment, ranked-score and completion-event writes. Once acknowledged, completed-run reads do not repeat those writes. If final answer storage succeeds but result persistence fails, an exact pick retry or later GET can still repair completion. Existing completed sessions populate the marker on their first recovery read. Unique keys continue to prevent duplicate results/events.

## Release and rollback

1. Run the PR's backend schema gate. It applies the known repeatable release backlog (migrations 0012/0013/0014/0015) plus new PR migrations on an expiring isolated Neon branch, verifies statistics readiness and repeat-refresh selection parity, compares SQL selection/rerolls with the exhaustive reference, and runs mixed, Cube, measurement and request-integrity integration suites. The parent can lag Git main; [CI synchronization details](REQUEST-INTEGRITY.md) explain why a PR-only migration diff is insufficient.
2. Inspect actual timings against the full copied production corpus. Compare cold and warm starts, existing Daily joins, friend starts, rerolls and concurrent starts. Statement-count reduction alone is not a latency result.
3. Apply migrations 0012–0015 to development before production; migration 0014 is additive and preserves existing schedules, while 0015 refreshes planner statistics without modifying game data. Publish the eight/ten-pick compatible frontend before activating the new backend. The old frontend assumes ten rounds.
4. Run **deploy neon functions** against `development`, specifying the full reviewed main commit SHA. Run it against `production` with the same SHA. The workflow pins Neon CLI 4.17.4 and esbuild 0.28.2, checks schema prerequisites, and requires that exact revision to pass complete mixed/Cube practice acceptance in development before production upload. It verifies that the compatible frontend is published. It bundles all three entry points once, checks the default handler and embedded Git revision, then deploys the checked content with `--no-bundle`. Production acceptance verifies all three revision markers, full corpus health, authenticated analytics, eight-pick completion/retry/scoring and stored friend challenges. QA sessions are private practice only, excluded from first-attempt measurements, and never write a ranked result. The [Neon deployment reference](https://neon.com/docs/compute/functions/deploy) documents prebuilt deployment. An ordinary Git merge still does not deploy Neon Functions.
5. After eight-pick sessions exist, a pre-eight-pick frontend/backend is not a safe rollback target. Keep eight/ten-pick completion, scoring and share support; fix forward or deploy a reviewed compatible revision. Additive schema may remain.

Trusted ingress rate limiting and a first-party cookie architecture are separate work. Never treat a client-supplied forwarded-IP header as an authenticated network identity, or claim that an in-memory function-instance counter protects the whole service.

`/health?quick=1` reports the embedded `release_commit` without a corpus scan. Full Draft Run `/health` remains the explicit coverage audit. The marker is compiled into each bundle, so a stale environment variable cannot make old code pass the release check. `scripts/build-neon-functions.mjs` is also usable for MCP/API uploads: its ZIPs contain `index.mjs` at the root. Build and promote the same reviewed commit; never label a modified workspace with a clean commit SHA.

Release acceptance checks all three markers both before and after gameplay to catch intervening deployments. The Cube image-refresh workflow must never deploy functions: its old unbundled development deployment bypassed revision verification and could overwrite a release under test. Image maintenance now checks that all six development/production functions expose the same valid revision before publishing refreshed shards, and checks again before production metadata updates. Finish a reviewed backend promotion first if this guard fails. Marker equality is a consistency check, not a substitute for the release's CI and gameplay acceptance.

The shared trophy-import/image-refresh HTTP gate also follows the current eight-pick policy, verifies round windows and final score, and creates only QA practice/friend sessions. Its former hardcoded ten-iteration loop failed by reading a ninth puzzle after the eight-pick run had already completed. A mocked full HTTP regression now exercises that operational gate in ordinary unit CI; the historical ten-pick game/browser gates remain separate and unchanged.
