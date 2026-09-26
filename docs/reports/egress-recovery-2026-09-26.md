# Egress recovery investigation - 26 September 2026

Issue: #541. PR: #625. Inspected source: `0edef5a9ae6db1303a77b1091ddb8da73c58164c` (not the historical review baseline).

## Evidence and limits

Provider: Neon. Project: `patient-shadow-91417882`. Endpoint:
`GET /api/v2/projects/{project_id}`. Metric: `project.data_transfer_bytes`, bytes,
**entire project including production, development and CI**, not daily production.
The current response reports period `2026-09-08T14:17:51Z` to
`2026-10-01T00:00:00Z`. No consumption measurement watermark is exposed;
project `updated_at` is not one.

The existing no-op fix #547 merged at `2026-09-25T19:42:23Z` as
`e8c906cfb2037d73e4fa0abfe8b4acc44730fc85`. Do not attribute the full billing
counter, or all of the 25 September daily interval, to post-fix activity.

| Collection time (UTC) | Reported counter (bytes) | Retained evidence |
| --- | ---: | --- |
| 2026-09-26T13:43:58.858Z | 87,990,387,341 | Release run 36245824236, artifact 10907198134 |
| 2026-09-26T17:59:18.713Z | 87,990,387,341 | Egress evidence run 36260913631, artifact 10911919239 |

Reported difference: **0 bytes across 15,319.855 seconds (4h 15m 19.855s)**.
This is a qualified manual comparison of the same reported project counter and
billing start. The older report omitted the period end; the current report
supplies both boundaries. It is **not proof of zero actual egress or a settled
recovery interval**. The new strict automated format establishes a complete
baseline instead of silently normalizing the older incomplete report.

The older artifact was `production-launch-telemetry-36245824236`, source
`7fcf203b30e35df663028bc1923893c4e3109ce0`. The new artifact is
`neon-egress-evidence`, generated for PR head
`df29eb9dbdf324e6c98ca96f2d1d801c2a274b8c`; its recorded `source_revision`
`020eb4da2cc2cb5ee77fc784c9cadd01b954a23a` is the synthetic PR test merge,
not an application deployment. Both artifacts lack provider measurement time.

The fresh collector requested hourly history for **2026-09-25T20:00:00Z to
2026-09-26T15:00:00Z**, a 19-hour wholly post-fix interval excluding the most
recent hours. Both `/consumption_history/v2/projects` and
`/consumption_history/v2/branches` returned **HTTP 404**, using the organization
ID returned by the project response. No usage delta is claimed for that
requested interval. History access/availability is a remaining provider
limitation; 404 is not zero usage. Future observations retain exact collection
timestamps, complete period metadata, strict deltas and raw history responses.

Branch metadata separately exposed `main` (`br-orange-feather-ayps8kep`) at
68,264,336,819 bytes and `dev-draft-run-product-review`
(`br-twilight-hill-ayffyd2b`) at 15,745,609,898 bytes. These are **single branch
counter observations**, not post-fix increments. Branch responses lack an
independent consumption-period watermark. Other extant branches include QA
and release probes; deleted branches are not accounted for by that list.
Do not label the project-minus-visible-branches remainder "CI usage".

## Focused fixes and meaningful tests

The earlier no-op guard and daily metadata-only report are retained. Two
additional targeted-check defects were reproduced on PostgreSQL using fixture
rows / EXPLAIN, not actual corpus payloads:

1. The set-mode `wanted_first_class` UNION included a row-number column on only
   one side. PostgreSQL rejected it with `each UNION query must have the same
   number of columns`. Explicitly project the three required columns on both
   sides and deduplicate an active snapshot that is also the latest snapshot.
2. Historical snapshots deliberately map to legacy NULL `source_snapshot_id`
   puzzle rows. The old `($3 IS NULL OR source_snapshot_id=$3)` predicate made
   NULL an all-snapshots wildcard, including newer Candidate payloads. Payload
   pagination and pick-band counts now use null-safe exact equality. This is a
   demonstrated over-broad targeted read, **not proof of a new recurring leak**.

The initial egress workflow run `36260913631` passed 11 provider/counter,
actual workflow-shell and alert-routing tests, plus actual PostgreSQL SELECT
execution on isolated CTE fixtures. SQL tests include pre-fix negative controls,
exact snapshot isolation, requested-set filtering, active/latest deduplication
and execution of the real metadata reporter without touching payload tables.
Necessary manual full health checks, scoped ingestion gates and development
gameplay canaries remain enabled.

The standard repository gate exposed a false-positive structural guard: it
matched `check-corpus-health.mjs` in the new workflow's trigger paths, even
though no payload command was executed. The guard now inspects executable
inline/literal/folded shell blocks rather than trigger metadata. Positive
fixtures prove actual forbidden commands are still rejected. Final head/main
CI evidence is recorded on #625 and #541, separately from these initial runs.

## Resolution rule and release scope

Keep #541 open while `neon_egress_billing_period_usage` still fires. The unchanged
50-GiB threshold is **53,687,091,200 bytes**, below the current counter. The daily
threshold remains **5 GiB (5,368,709,120 bytes)**. A billing reset creates a new
comparison baseline, never negative usage or proof of remediation.

After the provider reports a new period (current end: **1 October 2026,
00:00 UTC**), verify the actual usage condition clears, retain a meaningful
comparable post-remediation interval, and record remaining freshness or
attribution limits. Error, latency, quota and coverage incidents continue to
route independently through the existing launch watcher. The daily metadata
workflow retains 90 days of evidence; it does not automatically close issues.

No application function, gateway, database schema, production capacity or data
is changed by this patch. Source merge and successful repository operational
workflow runs are distinct from an application release. No application release
is needed solely for these repository-run scripts. No production corpus payload
was read to conduct this investigation or its SQL fixture tests.
