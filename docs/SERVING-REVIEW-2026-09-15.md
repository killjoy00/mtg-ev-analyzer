# Serving and release follow-up

September 15, 2026. This continues the [eight-pick review](EIGHT-PICK-REVIEW-2026-09-14.md) and [initial product review](PRODUCT-REVIEW-2026-09-14.md). Trophy choices still earn 100, all existing modes remain, new runs still have eight picks, and historical ten-pick runs remain compatible.

## Completed implementation

[PR 91](https://github.com/killjoy00/mtg-ev-analyzer/pull/91), merged as `ae0122f05a09de4972051cfa7350137f56eb3906`, fixes missing PostgreSQL serving statistics. Both live branches lacked statistics for the defaulted `pack_number` column despite older auto-analyze timestamps. The mixed eligibility count underestimated approximately 879,000 matching rows and chose hundreds of thousands of rating-index lookups. Refreshing the column on development changed that plan to a parallel hash join without changing the query or population.

Migration 0015 now refreshes scalar metadata statistics on both serving tables, excluding large JSON payloads. It is applied and verified in development and production. Complete trophy imports and ratings backfills refresh and verify statistics once after successful accounting. Remote maintenance is restricted to the signed main import workflow; the Cube image identity and anonymous callers cannot invoke it, and no caller-supplied SQL is accepted. Deployment readiness rejects missing statistics. An isolated full-corpus test proves repeated refreshes preserve exact mixed/Cube Daily selections.

[PR 92](https://github.com/killjoy00/mtg-ev-analyzer/pull/92), merged as `25b455c7526be58ff008fec96938e88196347b4c`, fixes two operational gaps found during promotion:

- The image-refresh workflow could overwrite the development API with an unmarked build. It no longer deploys functions or receives the Neon deployment key. It requires matching valid revisions on all six development/production functions before publishing refreshed shards, and checks again before production metadata changes.
- The shared import/image smoke test still expected ten picks and failed after an eight-pick run had correctly completed. It now follows current length, set and pick-window policy, checks the final score, and marks friend sessions as QA. A mocked full HTTP regression exercises this operational test in ordinary unit CI.

Release acceptance now verifies all three revision markers before and after gameplay, detecting an intervening deployment. Import, scoring, backend, request-integrity, current-state and historical-report references have been updated.

## Measured database effect

The same `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` mixed eligibility query was run sequentially before and after maintenance. Both plans returned the same 858 groups from the same eligible population. No cache flush, compute restart or load-test isolation was imposed.

| Branch | Initial pre-maintenance query | Repeat before | After full metadata refresh, two observations |
|---|---:|---:|---:|
| Development | 10.412s | 4.528s | 1.756s / 1.697s |
| Production | 10.448s | 3.792s | 1.686s / 1.716s |

The production repeat comparison is about 55% lower SQL execution time. This is not an equivalent reduction in player-perceived start time, a p95, or a concurrency SLO. The query still scans eligibility metadata; the new hash join also spills temporary data. Statistics presence checks catch missing metadata, not all possible future distribution drift. See [planner maintenance](BACKEND-RELIABILITY.md#planner-statistics) and the [machine-readable evidence](audits/serving-release-2026-09-15.json).

## Release verification

All six live functions expose runtime revision `ae0122f05a09de4972051cfa7350137f56eb3906`. The same checked ZIP content was promoted through Neon's API; the later PR 92 changes operational scripts/workflows, not the gameplay bundles. The manual deployment workflow was not separately dispatched.

| Function | Development deployment | Production deployment |
|---|---:|---:|
| `draftrunapi` | 21 | 17 |
| `pack1growth` | 5 | 8 |
| `pack1api` | 4 | 11 |

Development and production each passed the final **37-request HTTP acceptance**: all revision markers before/after gameplay, full corpus coverage, rejection of anonymous analytics, both eight-pick completions, rerolls, completion retries, score means and exact stored friend challenges. Production SQL confirms four private QA practice sessions, two completed/persisted career results and zero ranked sessions or score rows for this release cohort. Existing Daily schedules were not rewritten or reserved by acceptance. The corrected import/image HTTP gate also completed both modes on development.

| Final acceptance environment | New mixed practice | Mixed friend | New Cube practice | Cube friend |
|---|---:|---:|---:|
| Development | 10.37s | 7.34s | 7.83s | 6.78s |
| Production | 14.32s | 8.18s | 8.59s | 7.35s |

These are one-pass HTTP observations from the review client, including client/proxy transit and function/database work. They are not controlled before/after samples or a claim about typical browser latency. Some quick-health calls also took several seconds in this environment. Representative browser and concurrent performance testing remains open.

The corrected [image workflow, attempt 2](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/34920585273/attempts/2), passed end to end: revision guards, image/data audits, development refresh and eight-pick gameplay, then production refresh and eight-pick gameplay. It did not deploy or replace any function. Its initial blocked attempt was rerun only after all six live markers matched.

Both final image refreshes reported zero changed puzzles and zero changed cards; the checked-in image source was already normalized, so the workflow created no additional data commit.

PR 91 passed hydrated unit/data/bundle checks, browser tests and the isolated SQL gate. PR 92 passed its hydrated unit/data/bundle and browser gates. The current suite passes 130 JavaScript and 72 Python tests in hydrated CI; locally 127 JavaScript and 72 Python tests pass, with three replay-dependent files intentionally requiring CI data. Browser coverage includes both eight-pick flows, legacy ten-pick compatibility, rerolls, shares, profile/account and mobile layout. The SQL gate additionally covers deterministic selector/reroll parity, first-attempt conflicts, completion recovery, scoring, measurements and request limits.

The old image workflow actually replaced development deployment 19 with unmarked deployment 20 during the first acceptance attempt. Its display-only refresh changed zero puzzles/cards, then its stale ten-pick smoke failed; production metadata steps were skipped. That overlapping acceptance is not counted as release evidence. Development was restored to the reviewed marked bundle, and the stronger 37-request acceptance passed afterward. A first production attempt stopped at the revision check before creating QA sessions while one endpoint still served the preceding revision. The new image guard likewise blocked before remote image publication during partial promotion. These failures are retained as evidence of the release gaps and the new guard's fail-closed behavior, not represented as successful acceptance.

The approved temporary branch `review-eight-picks-20260914` (`br-old-base-aybckkbe`) was deleted and its absence verified. Its disposable QA data was not retained as a restorable branch copy. Production data and saved review evidence were untouched by that deletion. PR 91's CI branch was automatically deleted by its existing cleanup workflow.

## What remains

- **End-to-end performance:** run representative cold/warm and concurrent measurements. Mixed creation remains a multi-second path; this fixes one proven planner problem, not every source of latency. Keep any future aggregation/cache/connection changes behind exact selector-parity and data-freshness tests.
- **Trusted ingress and sessions:** per-player database quotas do not prevent unlimited guest identities. Network-level creation quotas, first-party HTTP-only sessions and revocation need a verified DNS/edge/hosting design and the appropriate access; GitHub and Neon alone do not establish that routing authority. Do not trust arbitrary forwarded-IP headers.
- **Native devices:** real iPhone sharing, authentication and card-legibility checks remain unverified; browser emulation is not native-device proof.
- **Human evidence:** do not change difficulty thresholds or claim retention gains from QA traffic. The earlier 243 decisions from 21 non-QA player IDs are a historical observation, not a fresh human-uniqueness or retention measurement.
- **Set maintenance:** update registered release dates, display names and verified corpus coverage when adding environments. The three-set Daily guarantee uses released, supported catalog entries; it cannot invent missing source data. Already-played September 14 Dailies remain ten picks. New schedules use eight with the existing three-set guarantee and stronger recency weighting.
- **Product decisions:** choose-your-sets practice and verified competition policy remain unimplemented. No new game modes or trophy-scoring changes are included.

No additional external account access was needed for this follow-up. GitHub Actions used its existing configured data-service credentials; no new credentials were extracted or repurposed.
