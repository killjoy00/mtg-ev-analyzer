# Practice and launch acceptance: issues #516 and #527

The final browser and shared-network gates passed, and the supported 25-player distributed target passed. This report retains exact test revisions, measurement limits and the guarded production release record.

## Implementation

Practice starts retain fresh seeded selection. The durable cache stores coherent candidate inventory, group counts, distinct-source coverage and metadata, keyed by corpus/difficulty/policy/schema/revision. Atomic publication, single-builder locking, final revision validation and bounded retries prevent mixed-revision selection. Frozen Daily schedules and historical selection semantics remain intact. Scale-to-zero remains enabled.

Snapshot-aware invalidation from 0041/0042 preserves active-corpus correctness while avoiding invalidation for non-active snapshot staging and no-op puzzle/rating updates. Updates still increment the revision at most once per transaction. Release applies current migrations and prewarms before deploying Functions.

Rerolls retain their exact distance arithmetic, C-collated ties, eligibility and RNG policy. The covering index and ordered candidate plan reduce work before the same 20 eligible candidates reach the shared selector. The expanded isolated gate compared every candidate row/order and final result in 42 cases across Mixed, Cube, single/multi custom, pack/set rerolls and early/later rounds. Historical exhaustive selector integration also passed.

Network protection charges actual guest identity creation, including invalid-cookie paths. Existing verified identities retain their exemption from creation limits. Validated shared-network policy is 3,600 requests/minute, 600/10 seconds and 120 creations/10 minutes; credential/account limits remain independent. JSON 429 scope and Retry-After are preserved. Routine deployment retains QUOTA_KEY.

## Isolated SQL evidence

[Run 36211850053](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36211850053) passed exact cache parity, publication rollback, writer contention and expanded reroll parity. Retained JSON is under `results/launch-closeout-2026-09-26`.

| Practice mode | Cached SQL warm median | Live reference median |
|---|---:|---:|
| Mixed | 474 ms | 10,797 ms |
| Cube | 290 ms | 465 ms |
| Single custom | 288 ms | 448 ms |
| Multi custom | 332 ms | 3,682 ms |

These use three repeated samples per mode, plus a first-observed sample. They are SQL-over-HTTP measurements, not browser latency or capacity evidence. Before/after sequencing includes cache-warming effects. The original pre-change browser cold baseline was not reconstructed; browser acceptance below tests the absolute declared budgets.

A missing-generation build took 57.08 seconds for 936 groups. The clone retained 2,052,976 inventory rows using 1,105,928,192 physical bytes including indexes and prior generations; the reroll index is approximately 457 MiB. This differs from cold compute with an already-built cache. Unwarmed publication can temporarily return retryable 503s while one builder runs; release and planned corpus activation must prewarm. Retention bounds live generations per cache key; ordinary PostgreSQL vacuum/reuse governs physical allocation.

Under current triggers, a rollback-only 1,000-row real metadata update spent 9.84–11.84 ms in 1,000 update-trigger calls. A deliberately held two-second publication transaction delayed another writer by 1,952 ms. These are diagnostic samples, not full-import throughput claims. Keep import transactions bounded.

## Workload and interpretation

Both scenarios use disposable production clones, private preview ingress, synthetic accounts/entitlements, all three Dailies, practice and rerolls, eight view/pick pairs, score/share correctness, public boards and a profile/account-attachment cohort. NAT fixtures add 90,000 score rows; distributed fixtures add 180,000. No external email, billing or identity-provider calls are used. Raw fixture credentials remain private to the runners and encrypted transfer artifacts.

The supported target was declared as 25 active players before testing. NAT stages are 25/50/100; distributed stages are 25/100/500/1,000, stopping at the first failed gate. Actors arrive over 15 seconds and think for 3–8 seconds between picks. Each actor completes one paced run; this is not an indefinite endurance guarantee. Compute is 0.25–8 CU with a 300-second suspend timeout.

Route p95/p99 budgets in seconds: session 2/5, start 2/8, view 1/3, pick 2/5, reroll 2/5, reads 2/5. Correctness failures and unintended 429s must be zero. Distributed acceptance verifies real distinct egress and arrival lateness, rather than spoofed headers. No quota reset occurs between stages.

Browser acceptance measures 20 warm samples and one separately confirmed-idle sample per mode. Warm API p95 must be <=2 s; click-to-first-cards p95 <=3 s; each confirmed-idle click <=6 s. One idle observation per mode is a regression sample, not a population p95. Image decoding is recorded separately. The harness keeps normal static caching and sends API traffic only to the private preview.

## Final browser and shared-network acceptance

[Run 36213435234](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36213435234) passed at tested merge revision `bc94bdf5d7cb2f45da24cce6beb0513e2a32e5f5` (PR #534 head `3ae0159763e3794d180ecff751964e434b50c628`). Preview route removal and disposable branch deletion both passed.

All 80 warm browser samples and four separately confirmed-idle samples passed, with zero browser errors and 3,492 static cache hits. Times below are milliseconds.

| Mode | Warm API p95 | Warm click p95 | Confirmed-idle click |
|---|---:|---:|---:|
| mixed | 1505 | 1833 | 4051 |
| powered-cube | 492 | 942 | 3403 |
| custom-single | 417 | 438 | 1793 |
| custom-multi | 452 | 483 | 2046 |

All NAT stages passed without resetting quota state. Each stage completed one paced run per actor in approximately 67–68 seconds; the combined measurement window was 03:36:49–03:40:12 UTC. All 3,774 requests returned 200/201, with zero correctness failures, errors or 429s. Observed arrival lateness p99 was at most 2 ms.

| Players | Completed | Requests | Start p95/p99 ms | Pick p95/p99 ms | Reroll p95/p99 ms | Read p95/p99 ms |
|---:|---:|---:|---:|---:|---:|---:|
| 25 | 25 | 539 | 601.8/839.59 | 240.04/450.96 | 649.82/649.82 | 381.21/586.84 |
| 50 | 50 | 1078 | 586.32/965.27 | 197.16/245.81 | 1007.55/1007.55 | 216.72/557.5 |
| 100 | 100 | 2157 | 603.9/986.63 | 223.08/362.73 | 867.14/937.81 | 238.66/404.59 |

This validates the tested 100-player shared-network scenario. The overall supported launch target remains 25 because independent-egress testing above 25 was incomplete. Neither scenario establishes indefinite endurance or a universal capacity ceiling.

## Distributed gateway acceptance

[Run 36213206670](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36213206670), tested merge revision `11f263c382b27efe971bbb73daa42b69f16839cf`, passed the supported 25-player stage across five verified distinct real egress networks. All 25 players completed; all 539 requests returned 200/201. Route p95/p99 in milliseconds: session 514/724, start 516/944, view 175/385, pick 204/377, reroll 1,100/1,100, reads 285/720. Correctness, arrival timing and quota gates passed.

The 100-player experiment did not establish capacity: two of 20 GitHub runners started more than 60 seconds after the common scheduled start and failed before sending gameplay. The other 18 runners completed 90 players and 1,941 successful requests, but the collector correctly rejected the incomplete cohort. Stages 500 and 1,000 were skipped. This is a generator scheduling limitation, not a demonstrated backend saturation point. Retained summaries include the failed stage; only 25 distributed players are validated.

## Production operations and limits

Gateway timing/status/quota events exclude credentials, cookies, raw IPs and network digests. The production watcher queries retained events, checks usage budgets and opens separate incidents by condition. GitHub scheduling is best effort; the runbook describes delay and manual response. The guarded release verifies a retained event for its exact release SHA.

Public response caching was not added: public boards/profile plans were captured before deciding whether optimization was needed. With 180,000 synthetic score rows, the seven measured board/profile queries took 0.26–44.32 ms inside Postgres and 57–89 ms over SQL HTTP; distributed read p95 was 285 ms at the supported target. The fixture report retains both 90,000- and 180,000-row plans. These bounded measurements justify deferring a shared-cache design at 25 players. Private responses remain no-store. Non-idempotent mutations are never blindly retried.

Issue #541 remains a separate whole-project billing-period egress warning, including CI branches. The account does not expose daily Neon consumption history through the available API, so billing-period counters are explicitly labeled. This work does not claim exact production-only or per-player cost attribution.
