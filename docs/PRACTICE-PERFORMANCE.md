# Practice performance baseline (#516)

`scripts/practice-performance.mjs` measures the current selector before cache
changes. It performs only repository-owned read queries and EXPLAIN ANALYZE of
those reads. It creates no players, runs, schedules, scores or entitlement rows,
and invokes no Functions, email or billing providers.

## Isolated execution

The `isolated practice performance baseline` workflow creates a disposable copy
of production, with a two-hour emergency expiry. The runner verifies the clone's
parent and that the supplied database endpoint belongs to that clone using the
Neon control plane before issuing SQL. Both established production/development
branch IDs are refused. The workflow cleans up only the branch it just created.

The workflow runs when its benchmark files change in a same-repository PR. After
merge it also supports manual dispatch. No special credentials are needed beyond
the repository's existing Neon CI key. The benchmark stores no credentials in
logs or artifacts; failures record only coarse status/error classes.

For an already-created disposable production clone, supply `DATABASE_URL`,
`NEON_API_KEY` and `PACK1_BENCHMARK_BRANCH` through the environment and run
`node scripts/practice-performance.mjs`. `PACK1_BENCHMARK_SAMPLES` defaults to 3
and accepts 1–10 repeated samples per case, in addition to one first-observed
sample. This standalone command verifies but does not create/delete the branch.

## Report contents and limits

The artifact `practice-performance-<run_id>` contains `report.json` and separate
JSON plans. It records:

- Actual checkout SHA, PR head SHA, corpus/selection/difficulty/serving versions,
  Pacific date, clone/parent IDs, compute sizing, work_mem and server version.
- Estimated table row counts and analyze timestamps, explicitly labeled as
  estimates rather than newly counted exact corpus totals.
- Full custom practice-set discovery time, including distinct-source coverage.
- Mixed, Cube, single-set and multi-set custom selection plus metadata reload,
  using reproducible seeds and selected puzzle IDs/fingerprints.
- Every selector query's family, elapsed time, returned row count and outcome.
- First-observed samples separately from repeats; repeat sample counts and
  nearest-rank p50/p95/p99. With three repeats p95/p99 are simply the maximum;
  they are not reliable estimates of production tail latency.
- EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) for the first group-count, coverage and
  candidate/trajectory query in each applicable case, collected after timings.

The benchmark uses the same raw-text SQL-over-HTTP parameter/result contract as
the application, with a 90-second per-query transport deadline and no retries.
A timeout fails the run rather than disappearing from the report. Control-plane
target verification and metadata/discovery reads precede measurements: these are
**not confirmed-after-idle samples**. Query plan collection executes each read
again and is kept separate from timing samples.

This is a serial selector diagnostic, **not full start API latency, browser
click-to-first-cards, or supported concurrency evidence**. Authentication,
capabilities, session persistence, Function startup, rendering and images are
not represented. The workflow does not assert the issue's API/browser budgets.
Use the existing rotated, control-plane-confirmed idle methodology for browser
measurements; #527 owns the distributed/shared-NAT launch workload.

## Next implementation gate

Review the baseline and plans before adding the group-count cache. Keep counts,
metadata, candidates and final acceptance on one coherent serving revision;
either stale-count direction can silently alter an otherwise successful draw.
Define atomic publication, bounded rebuild/fallback/retry, per-request count
copies and bulk-writer invalidation before measuring the cached path against
these same seeds. Row-level inventory and a driver migration remain conditional
on evidence rather than prerequisites.
