# Egress recovery investigation - 26 September 2026

Issue: #541. Inspected source: `0edef5a9ae6db1303a77b1091ddb8da73c58164c` (not the historical review baseline).

## Evidence and limits

The provider is Neon, project `patient-shadow-91417882`. The warning concerns
`GET /api/v2/projects/{project_id}` -> `project.data_transfer_bytes`, in bytes,
for the **entire project, including development and CI**, not daily production
traffic. The current project response reports period start
`2026-09-08T14:17:51Z` and end `2026-10-01T00:00:00Z`. It does not expose a
consumption measurement watermark. Project `updated_at` is not such a watermark.

The existing no-op fix #547 merged at `2026-09-25T19:42:23Z` as
`e8c906cfb2037d73e4fa0abfe8b4acc44730fc85`. Do not attribute the full billing
counter, or all of the 25 September daily interval, to post-fix activity.

A retained **post-fix** observation is the `report.json` in artifact
`10907198134` (`production-launch-telemetry-36245824236`), run
`36245824236`, source `7fcf203b30e35df663028bc1923893c4e3109ce0`:

- collection timestamp: `2026-09-26T13:43:58.858Z`;
- metric value: **87,990,387,341 bytes**;
- billing start: `2026-09-08T14:17:51Z`;
- source: project billing-period counters; daily history unavailable;
- period end and provider measurement time were not included in that artifact.

A later connected-project read returned the same value and the above complete
period. This is evidence of **no increase in the reported counter**, not proof
of zero actual egress or a settled recovery interval. The follow-up evidence
workflow retains exact collection timestamps, complete period boundaries,
comparable-counter deltas, and the provider's bounded history responses. Its
first run and subsequent observations are recorded in #541 / the associated PR.

Current branch metadata exposed `main` (`br-orange-feather-ayps8kep`) at
68,264,336,819 bytes and `dev-draft-run-product-review`
(`br-twilight-hill-ayffyd2b`) at 15,745,609,898 bytes. These are **single branch
counter observations**, not post-fix increments. Branch responses do not carry
an independent consumption-period watermark. Other extant branches include QA
and release probes; absent/deleted branches are not accounted for by that list.
Do not label the difference from the project counter "CI usage". Branch-level
interval history must be available and complete before asserting that split.

## Remaining source defects demonstrated without scanning a corpus

The earlier no-op guard and daily metadata-only report are retained. Two
additional targeted-check defects were reproduced on PostgreSQL using fixture
rows / EXPLAIN, not actual corpus payloads:

1. The set-mode `wanted_first_class` UNION combined `s.*` with a row-number
   column on one side and without it on the other. PostgreSQL rejected the query
   with `each UNION query must have the same number of columns`. Explicitly
   project the three required columns on both sides and deduplicate an active
   snapshot that is also the latest snapshot.
2. A historical snapshot deliberately maps to legacy NULL `source_snapshot_id`
   puzzle rows. The old `($3 IS NULL OR source_snapshot_id=$3)` predicate treated
   that NULL as an all-snapshots wildcard, including newer Candidate payloads.
   Both payload pagination and pick-band counts now use null-safe exact
   equality. This is a demonstrated over-broad targeted read, **not evidence
   that a new recurring production leak has occurred**.

Regression coverage executes the actual workflow shell with subprocess spies,
executes the actual health SELECT statements against an empty disposable
PostgreSQL service populated only by CTE fixtures (including pre-fix negative
controls), runs the real metadata reporter against those fixtures, and exercises
alert routing with a pre-existing #541-style warning. Necessary manual full
health checks, scoped ingestion gates and gameplay canaries remain enabled.

## Resolution rule

Do not close #541 while `neon_egress_billing_period_usage` still fires. The
unchanged threshold is 50 GiB (53,687,091,200 bytes); the last observation is still
above it. The daily threshold remains 5 GiB (5,368,709,120 bytes). A normal billing
reset creates a new comparison baseline, never negative usage.

After the provider reports a new period (currently ending 1 October), verify the
active usage condition actually clears, retain at least one complete comparable
post-remediation observation interval, and record any remaining freshness or
attribution limits. Error, latency, quota and coverage incidents continue to
route independently through the existing launch watcher. No automatic issue
closure or monitoring threshold changes are introduced here.

No application function, gateway, database schema, production capacity or data
is changed by this patch. Source merge and successful operational workflow runs
must be reported separately from any application release; no application release
is needed solely for these repository-run scripts.
