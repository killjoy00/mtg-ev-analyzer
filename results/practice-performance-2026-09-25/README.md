# Practice selector baseline — September 25, 2026

[Workflow 36163131350](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36163131350)
ran the unchanged production selector on disposable production clone
`br-fragrant-cell-aybwgqe4`. Checkout: `a40f90dfc1caf37140d4de15eae3da2dba52054b`
(PR merge ref); benchmark head: `2115402c304c00aeecf70dd5b222ff88252992cc`.
The clone was removed by the workflow. PostgreSQL 18.6, work_mem 4 MB,
autoscaling range 0.25–8 CU; actual instantaneous CU was not recorded.

## Measurements

These are serial SQL-over-HTTP **selection plus metadata reload** timings. They
exclude authentication, capabilities, run persistence, Functions, gateway and
browser rendering. Metadata/discovery reads ran before the selector samples;
none is a confirmed-after-idle measurement. The three repeats use different
recorded deterministic seeds; differences also include candidate/trajectory work.

| Practice case | First observed | Three repeat samples | Repeat median |
|---|---:|---|---:|
| Mixed | 27.201 s | 9.570 / 7.563 / 6.642 s | 7.563 s |
| Powered Cube | 0.737 s | 0.530 / 0.554 / 0.538 s | 0.538 s |
| Single set (HOB) | 0.545 s | 0.508 / 0.475 / 0.472 s | 0.475 s |
| Multiple sets (HOB/MSH/SOS) | 3.525 s | 3.367 / 3.208 / 3.301 s | 3.301 s |

Unrestricted custom-set discovery took 24.930 s, of which 24.864 s was the
distinct-source coverage query. It returned 25 offered sets. This path needs
attention independently of the selected-set coverage check during a custom start.

## Query evidence and next work

- Mixed repeat group-count reads: 4.158–5.111 s. The later EXPLAIN ANALYZE took
  4.515 s, returned 831 groups, and recorded 33,456 temp blocks read and written
  (approximately 261 MiB each at an 8 KiB block size).
- Mixed repeat candidate/trajectory queries combined: 1.474–5.349 s across the
  eight rounds. Group caching alone may not achieve the full start budget;
  measure again before deciding whether row-level inventory is needed.
- Multi-set repeat group counts and custom coverage each cost about 1.4–1.5 s.
  Both are material, so puzzle counts alone will not address custom practice.
- The later unrestricted coverage plan took 5.294 s and wrote 46,323 temp blocks
  (approximately 362 MiB at an 8 KiB block size). Its lower time than the initial
  24.864 s is not a contradiction: it ran after the timing samples and substantial
  prior reads. Cold storage/compute/autoscaling contributions were not isolated.
- Cube and single-set selector costs were much smaller in this run. Do not
  generalize the Mixed bottleneck to all practice environments.

Proceed with the revision-consistent group-count and distinct-source coverage
design in #516. Keep source-exclusion/order/random-stream parity, single rebuild
per revision and invalidation tests. Do not treat these low-sample serial figures
as launch capacity, API latency or reliable p95/p99 estimates.

## Retained evidence and metadata correction

`baseline-report.json` preserves the report verbatim as parsed from the artifact.
`baseline-plans.json` retains all 11 full EXPLAIN JSON plans keyed by original
filename; whitespace is compacted to avoid thousands of presentation-only lines.

The first harness read `pg_stat_user_tables.n_live_tup` as an estimate. Those
activity counters were zero on the new branch and **do not mean these tables were
empty**. Subsequent harness revisions use planner `pg_class.reltuples` and keep
activity counters separate. The initial report also omitted suspend timeout
because the control-plane field name differs; subsequent reports capture
`suspend_timeout_seconds` or explicitly mark it unknown. Neither correction
changes the measured selector/query timings above.
