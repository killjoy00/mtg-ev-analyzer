# Isolated practice cache comparison — 2026-09-25

Workflow [36170811925](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36170811925),
head `8f4fddcadc4b69377d0a12717ef0dd26aa761d49`, disposable production clone
`br-shy-wildflower-aywhuerd`. The workflow
deleted the branch. Every one of the 16 samples matched the unchanged selector
at the same seed, including IDs, source trajectory metadata and difficulty data.
Custom-set metadata and distinct-source eligibility also matched.

| Case | Cached repeat median | Cached repeat maximum (3 samples) | Live repeat median |
| --- | ---: | ---: | ---: |
| Mixed | 357 ms | 418 ms | 6,010 ms |
| Powered Cube | 272 ms | 289 ms | 380 ms |
| Custom single | 272 ms | 273 ms | 379 ms |
| Custom multi | 342 ms | 361 ms | 3,329 ms |

Cached custom-set discovery: 73 ms. Initial build: 39.76 seconds; 1,058,907
candidate IDs across 1,035 groups. Inventory including indexes: 376,545,280 bytes
(359 MiB). Build time is a publication/warmup cost, not a warm request latency.
Two retained generations can approximately double this footprint; PostgreSQL
vacuum/bloat and transient rebuild space require monitoring after publications.

The database was PostgreSQL 18.6, work_mem 4 MiB, autoscaling 0.25–8 CU,
300-second suspend timeout. These are serial SQL-over-HTTP measurements from a
GitHub runner, not Function API, browser, cold-start or concurrency acceptance.
The three-repeat maximum is not a statistically stable p95. Plans were captured
after timed samples. Originals are retained in report.json and plans.json.
