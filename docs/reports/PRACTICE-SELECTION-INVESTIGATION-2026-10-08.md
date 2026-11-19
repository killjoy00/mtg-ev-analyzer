# Practice selection investigation — 2026-10-08

The existing evidence supports keeping the verified 50-player qualification.
It does **not** identify a new SQL change likely to establish 100-player
capacity. No new load rehearsal, provider branch, database query, runtime
change or migration was performed for this investigation.

## Where the remaining delay occurs

Source: [October 7 run 37595851332](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/37595851332),
attempt 1, tested merge `3ab2ec1491ff024b2610cae8c0c34f9ab5d3309d`.
The [capacity report](DISTRIBUTED-CAPACITY-629.md) records its complete pass;
[all 375 start observations](evidence/distributed-capacity-2026-10-07/start-timings.json)
are retained with source artifact IDs and ZIP hashes.

| Start population | Requests | Route p95 ms | Candidate-call p50/p95 ms |
| --- | ---: | ---: | ---: |
| All 50-stage starts | 375 | 1355.57 | 33.07/918.19 |
| First 25 hold Practice starts | 25 | 2634.11 | 960.36/2038.65 |
| Later hold Practice starts | 300 | 288.47 | 30.54/80.33 |

The all-start candidate distribution contains 335 samples: 325 hold Practice
starts and ten initial Practice starts. The 40 initial Daily starts do not call
the Practice candidate selector.

Exactly 26 starts exceeded one second. All 25 synchronized opening Practice
starts began 0.38–1.04 seconds into the hold and exceeded one second. One later
start, 47.53 seconds into the hold, took 2251.70 ms, including 2032.87 ms in
the candidate call. No other later start exceeded one second. Selection
accounted for about 79% of backend time among slow starts. This identifies the
candidate call as the main measured delay, rather than the gateway quota or
session-write phases. It is not a timeout or correctness failure.

The current path in `worker/draft-run-selection.mjs` loads a serving snapshot,
calls `pack1_select_serving_run_v1` once for all eight decisions, then verifies
the revision. The current selector and migration 0051 match the tested
implementation. Later start-function changes add phase timing around Daily
lookup/schedule/metadata; they do not replace this Practice selector.

## The obvious optimization is already installed

PRs [#938](https://github.com/killjoy00/mtg-ev-analyzer/pull/938),
[#939](https://github.com/killjoy00/mtg-ev-analyzer/pull/939) and
[#940](https://github.com/killjoy00/mtg-ev-analyzer/pull/940) already implemented,
accepted and promoted the exact-pick covering index and equality draw.
Migration `0051_exact_pick_draw_index.sql` indexes
`(snapshot_id,set_id,band,pick_number,puzzle_id)` and includes the source hash.
Adding that index again is not a new fix.

The retained final comparison is
[run 37179231416](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/37179231416),
attempt 1, head `5b745284b5f642efd5895b71b9ab92990d14f493`,
report/merge SHA `61bdaacf54cedc82c83eda02653541bcad516840`.
Artifact `11294861955` ZIP SHA-256:
`a8f9a051102b592888ed64f31d2a6766d3bcd3c5583f42400c01278ba42cbea1`.
[Phase summaries and original draw plans](evidence/distributed-capacity-2026-10-07/draw-comparison-summary.json)
are retained here.

| Phase, 50 SQL starts in two waves of 25 | p50 ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: |
| Original range draw, before new index | 678 | 1749 | 1915 |
| Exact-pick draw with new index | 181 | 321 | 439 |
| Range draw recheck, new index present | 144 | 214 | 311 |
| Exact-pick draw recheck | 139 | 196 | 220 |

The high-offset original draw used 309 buffer hits and filtered 13,939 rows;
the indexed exact-pick draw used 41 hits and filtered none. The measured plan
took 0.548 ms, with zero heap fetches, shared reads or temporary writes.
The recheck used 0.563 ms. These are warm standalone draw plans on the earlier
snapshot, not plans of the eight-decision function during October 7 contention.

The index work demonstrably reduced scan work. The initial phase's large
latency reduction also includes phase ordering and warming; once the new
index exists, the range recheck can use it too. The rechecks therefore do not
support promising another fivefold improvement from an equality rewrite.

## What the evidence cannot resolve

The candidate header measures the entire SQL-over-HTTP function call. It
does not separate connection/queue delay, planning, buffer reads, group JSON
work, per-source decrement lookups or the eight draw/metadata operations.
The October 7 fixture artifact retains board/profile plans, not nested
selector plans. The earlier serial performance report has no selector plans.

The opening concentration is consistent with shared contention and first-use
work, but neither cause is established. The later two-second outlier also
prevents claiming that a one-time warm-up fully resolves the tail. There is no
retained CPU/autoscaling trace or slow-call parameter/seed record sufficient to
identify an expensive mode or reproduce that exact call.

The current readiness builder does not explicitly vacuum the serving inventory;
the CI maintenance script vacuums verified puzzles and ratings. That is a
question to profile, not a demonstrated missing maintenance fix. The earlier
indexed draw had zero heap fetches, and there is no October 7 plan showing
inventory visibility or heap reads caused the delay. Do not prescribe vacuum,
another index or a query rewrite from aggregate timing alone.

## How this relates to the old 100-player failure

[Run 37011654672](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/37011654672),
attempt 1, tested merge `6da313ddc82888f9dea327f2ef143bed0f507409`,
completed all 100 initial runs. Initial start p95 was 312.21 ms and pick p95
255.71 ms. It stopped at the synchronized hold opening: leaderboard read p95
was 3926.87 ms and Daily-status read p95 was 1174.72 ms; only five successful
hold-start samples were retained before abort. The complete 100 hold did not
pass.

That earlier run predates the promoted exact-pick work and the current
Daily-status consolidation. Current Daily status shares one SQL request for
history, streak, paid capability and membership, alongside ranking, rather
than the earlier independent fanout. The October 7 50-stage read p95/p99 was
333.68/936.72 ms. These changes justify treating the old failure as historical,
but extrapolating them to a current 100-player pass would be unsupported.
There is no current evidence for a broad response-cache project.

## Decision and bounded next step

Stop at the existing evidence for now. 50 has passed, and none of the retained
plans establishes a new fix worth implementing. Another complete capacity run
would repeat a costly symptom without exposing the missing SQL detail.

If actual demand or user-visible burst delays justify further spending, the
next useful experiment is one isolated selector profile on the current
snapshot: at most two waves of 25 SQL-only starts, with a ten-minute total
budget, capturing first-use and repeat timings plus nested
`EXPLAIN (ANALYZE, BUFFERS)` evidence for the slow operations and resource
observations. Keep seeded selection, candidate inventory, source exclusions
and ordering unchanged. No Daily/board load, long holds or automatic retries
are needed to answer this narrow question.

Do not run that profile until the capture method can expose nested function
costs; timing only the outer function would leave the same uncertainty. If it
does not identify a dominant repeatable cause within its budget, stop and keep
100 unqualified. If it does, make one focused change and compare on the same
bounded workload with exact selection parity. A full 100 qualification would
be a separate product decision after a measured improvement, not a repeated
default test.
