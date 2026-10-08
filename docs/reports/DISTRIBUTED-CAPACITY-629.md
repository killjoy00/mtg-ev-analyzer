# Distributed capacity evidence (#629)

## Verified 50-player qualification — 2026-10-07

Reconciled on 2026-10-08 from all five cohort artifacts and the independently
recomputed final acceptance and cleanup artifacts. **50 active mixed-lifecycle
players passed the complete policy-v3 25→50 ladder**, including the 600-second
hold at 50, drain and recovery. The prior statements that 50 was unqualified
were stale. This satisfies the longer-hold promotion condition for the exact
tested revision; it does not qualify 100 players or every later release.

- Workflow [37595851332](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/37595851332), attempt 1; PR [#1051](https://github.com/killjoy00/mtg-ev-analyzer/pull/1051) head `6eeaabc34a4fb70412af1d19da33599167320f31`.
- Tested merge SHA: `3ab2ec1491ff024b2610cae8c0c34f9ab5d3309d`.
- Bound policy: version 3, SHA-256 `30e135698a1c5fcb55140b77ca6dba26e7d3b27f6828f0ee8b9645c668a17a96`.
- Five distinct real egress networks; 50 initial completions and 325 completed
  hold Practice runs. The preceding 25-player stage also passed.
- All 10,165 measured 50-stage requests returned HTTP 200/201: 10,140/25.
  Zero correctness failures, request errors or legitimate 429s. Phase latency,
  rolling abort checks, telemetry, resource and recovery gates passed.
- Cleanup independently passed at `2026-10-07T09:35:54.452Z`: preview mapping
  absent and disposable branch GET returned 404.

| Route | Samples | p95 ms | p99 ms | Bound p95/p99 ms |
| --- | ---: | ---: | ---: | ---: |
| Session | 50 | 418.12 | 544.25 | 2000/5000 |
| Start | 375 | 1355.57 | 2468.74 | 3000/8000 |
| View | 3000 | 189.33 | 355.05 | 1000/3000 |
| Pick | 3000 | 285.63 | 1112.94 | 2000/5000 |
| Reroll | 335 | 736.62 | 966.09 | 2000/5000 |
| Read | 3405 | 333.68 | 936.72 | 2000/5000 |

The full experiment recorded 11,795 gateway requests, 98,260,656 decoded
response bytes and 8,256 coordinator queries. The tested request ceiling was
50,000; the later 30,000 ceiling is a separate policy change and must not be
substituted into this run's fingerprint. Whole-project billing counters are
delayed and include other branches; they do not establish zero actual usage or
a per-player price.

Durable evidence: [original final acceptance](evidence/distributed-capacity-2026-10-07/distributed-acceptance.json),
[original cleanup](evidence/distributed-capacity-2026-10-07/cleanup.json), and
[all start timing observations](evidence/distributed-capacity-2026-10-07/start-timings.json).
Final artifact `11472877818` ZIP SHA-256:
`3e056a60720ee329edcdeaedd6bc51c464bb840b6804aafa244d115421ff70a6`.
The timing projection records the five source ZIP digests and excludes encrypted
network attestations and fixture credentials.

This is a finite isolated qualification on five networks, not a measurement of
the deployed production release, geographic diversity or indefinite endurance.
Later failed runs remain failed. The ordinary 25-player check remains the
cheaper default; its scope does not erase this 50-player evidence.
The [October 8 selection investigation](PRACTICE-SELECTION-INVESTIGATION-2026-10-08.md)
uses these existing observations without launching another rehearsal.

## Required check update — 2026-10-07

The owner chose to defer the 50-player experiment. Ordinary PRs and manual
dispatches now default to the cheaper 25-player check; selecting
`capacity_target=50` manually retains the original 25→50 experiment and its
600-second final hold. The full envelope remains in
`scripts/launch-distributed-policy.json`; `selectCapacityPolicy` selects and
validates the required stages before provisioning. The selected policy's
fingerprint binds all setup, generator and collector evidence. All five
cohorts must complete, with unchanged latency, zero-error, correctness,
telemetry, resource and cleanup gates. This default-check choice is separate
from the verified October 7 qualification above.

The separate NAT workflow uses the same default-25/manual-50 choice. Run
37664468633 passed NAT at 25 but failed the optional 50 stage (reroll p95
2,381.45 ms against 2,000 ms) and independently failed browser run-start
acceptance; it remains failed. Distributed run 37664468834 used 25 correctly
but aborted after actor 1's pick connection timed out at 503.76 ms before
headers or body were sent. Cleanup passed. The runner now gives each connection
address one second rather than Node's default 250 ms, without retrying picks
or changing measured route budgets. Fresh acceptance is required.

Run [37647716245](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/37647716245),
attempt 2, passed the complete 25-player stage: 1,541 requests, all HTTP
200/201, 25 initial completions, 30 hold completions, zero correctness failures,
positive telemetry and usage gates. It later aborted the 50-player stage on
`coordinator_or_clock_failed`. Preview removal and branch GET 404 passed.
That run remains a failed full-ladder run; the new 25-only policy requires
fresh acceptance and does not retroactively relabel it.

## Policy update — 2026-10-02

100-player stages were removed on 2026-10-02 (owner decision); earlier results are in git history.

Policy version 3 (`scripts/launch-distributed-policy.json`) uses a **25→50** ladder. The 50-player stage is final and has a 600-second sustained hold; every other gate, budget and envelope is unchanged.

Before that policy update, 50 players passed completely three times under policy version 2:
- run 36326543142;
- run 36792854202, attempt 4;
- run 37011654672 (#847).

All three used the earlier 180-second 50-player hold. At the October 2 decision, formal supported distributed capacity stayed at 25 pending a complete policy-v3 25→50 run with the 600-second hold. The October 7 run above subsequently satisfied that condition.

## Release decision — 2026-09-27

The current-practice selector work is accepted for the release path. No further selector/model tuning is a v1 release blocker on the evidence below. This decision does **not** retroactively change the predeclared capacity gates.

Runtime-code evidence is PR #655 head `dcb543da1abc4777d1e36bf3ad599e4af4454671`, tested merge SHA `0ea8e67bbfd969dd7a49e3c2f3264bca43894752`, workflow run [36326543142](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36326543142). Normal test, E2E, gateway-runtime, backend-schema and isolated-practice-performance workflows also passed on that runtime-code head. Subsequent #655 commits through this documentation update change only Markdown/release bookkeeping; they do not change runtime or schema behavior; isolated practice performance is run [36326543143](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36326543143).

- **25 players: PASS.** 1,543 requests, zero correctness failures. Start p95/p99 1,638.03/1,788.31 ms; reroll p95/p99 959.98/1,134.17 ms.
- **50 players: PASS.** 3,968 requests, 3,943 HTTP 200 + 25 HTTP 201, zero correctness failures. Start p95/p99 1,602.65/2,188.32 ms; synchronized-hold start p95 1,898.40 ms; reroll p95/p99 1,217.49/1,867.57 ms; view p99 383.79 ms; read p99 900.66 ms. This is the first complete five-egress 50-player pass under the unchanged #629 policy.
- **Cleanup: PASS.** The private preview mapping was removed and disposable Neon branch `br-bitter-scene-ay6jerfh` was deleted.

At this September 27 release decision, formal supported distributed capacity stayed at 25; 50 had passed the earlier shorter hold. Further selector tuning was not a v1 blocker. This historical capacity interpretation is superseded by the complete October 7 policy-v3 qualification above.

## Status and historical claims

The current recorded qualification is 50 players on the exact October 7 tested revision above. The remainder preserves the implementation protocol and earlier evidence. Historical #516/#527 remain completed. Read `PRACTICE-LAUNCH-CLOSEOUT-2026-09-26.md` and `results/launch-closeout-2026-09-26`: 25 players on five verified real independent egress networks passed, and the later five-egress 50-player stage also passed under the earlier shorter hold. Short paced runs were not endurance tests.

Reviewed application baseline: `731a0b4b897ca1b0d4b8f8bd9f8e96658f7a83dc`. Concurrent activation readiness and native parity work are preserved. The production monitoring fix (#601; guarded release 36245824236 at `7fcf203b30e35df663028bc1923893c4e3109ce0`) supplies the bounded retained-log reader. Production monitoring code, probes and machine-managed #596 state are unchanged.

## Predeclared stages

`scripts/launch-distributed-policy.json` is the authoritative policy. Its SHA-256 fingerprint, workflow run ID, attempt, exact tested merge SHA and isolated branch bind every fixture, state, report and decision. Policy edits require another measurement; do not move thresholds to pass observed results.

| Stage | Active mixed-lifecycle players | Persistent real egress networks | Initial window | Sustained hold | Drain | Recovery |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Requalification | 25 | 5 | 120 seconds | 120 seconds | 90 seconds | 60 seconds |
| Proposed level (policy v3) | 50 | 5 | 120 seconds | 600 seconds | 90 seconds | 60 seconds |

Policy version 2 (through 2026-10-02) used a 180-second hold at 50. Policy version 3 makes 50 the final stage and extends its hold to 600 seconds.

Actors arrive over 15 seconds and perform eight view/pick pairs with 3–8-second thinking. Fixed ten-actor blocks contain five original guests and five original signed-in accounts; the last two accounts practice, and the other actors divide among Mixed, Cube and Latest Dailies. At 25 this gives 15 guests, ten original signed-in accounts, 21 Daily players and four initial practice players. At 50 the ratios are exactly 50/50 and 80/20. Fixtures retain 2,000 synthetic accounts and 180,000 historical score rows.

During each hold, original signed-in actors repeatedly finish entitled practice runs with rerolls, rotating Mixed, Cube, single-set custom and multi-set custom. Original guests poll Daily status and representative board periods every 15 seconds, including after the account-attachment subcase. Mutations drain before one existing actor per network exercises a full recovery minute. Exact final scoring, share behavior, eligibility, account attachment, self-profile and all eight Daily puzzle identities are checked. No identity, quota key or quota state is reset between stages. `launch-load.yml` remains the separate NAT/browser scenario; it is not relabeled distributed.

Route budgets, p95/p99 milliseconds: session 2000/5000, start 3000/8000, view 1000/3000, pick 2000/5000, reroll 2000/5000, read 2000/5000.

The start-route p95 budget was changed from 2000 ms to 3000 ms only for measurements after failed run 36269646999. That run remains a failure under its bound policy and is not retroactively accepted. Its 50-player hold opened with a deliberately synchronized burst of 25 practice starts: the aggregate partial-stage start p95 was about 2.85 seconds, while subsequent starts were mostly about 0.3-0.9 seconds and other routes remained within budget. The 3-second value is therefore an explicit product/SLO decision for the user-visible transition, not an optimization claim; p99 remains 8 seconds and all zero-error, correctness, telemetry, egress, resource and cleanup gates are unchanged. A fresh exact-policy run must pass before supported capacity changes. Errors, unintended 429s and correctness failures must be zero. Complete-stage and phase-specific distributions must pass; absent required samples fail. A conservative per-generator rolling route window (up to 200 samples, minimum 25) also stops at a latency failure. Common-start and arrival lateness must each be at most one second. Every actor must complete initial gameplay and participate throughout the hold.

## Readiness and safety

The same five jobs remain alive across stages. A compare-and-swap row in the verified disposable database coordinates them. There is no start timestamp until all five have attested distinct gateway-observed network hashes and fresh heartbeats. A start is then armed 30 seconds ahead, and every runner must acknowledge it at least five seconds before arrival. Two-second heartbeats have a 20-second lease; refreshing late cannot erase an expired lease. Missing or duplicate runners, changed egress, wrong scope, missing acknowledgements, scheduling overruns and clock uncertainty are generator failures, not backend saturation.

Only fixed private `api-preview.packone.pro` ingress is allowed, under the existing shared `pack1-gateway-preview` concurrency lock. Provider metadata verifies branch/SQL-host ownership before coordinator SQL. The existing isolated deployment retains protected origins and sealed inherited utilities. The request allowlist excludes email, auth providers, Patreon, billing and administration; synthetic accounts use `example.invalid` and entitlements are local records. No application mutation is retried and no forwarding/real-IP headers manufacture independent networks. Credentials and raw egress hashes remain in the disposable database or authenticated encrypted transfer; public artifacts retain encrypted egress attestations and counts.

Cleanup always attempts preview-mapping removal and branch deletion, then independently verifies mapping absence and branch GET 404. A successful stage is not completed capacity evidence without verified cleanup. Emergency expiry protects against killed jobs. Encrypted transfer artifacts have one-day retention; deleted-branch credentials cease to provide a live target.

## Resource ceilings and accounting limitations

The experiment is bounded to 45 minutes from coordinator initialization and a 75-minute branch lifetime. Compute is verified at no more than eight CU with 300-second suspension, and exact observed settings are retained. Eight CU over the entire emergency lifetime is a ten-CU-hour upper envelope, not expected consumption. Job timeouts bound runner allocations below 270 runner-minutes.

The October 7 bound policy allowed 50,000 gateway requests; current dispatches allow 30,000, including the machine-declared 60-request private telemetry preflight, 20,000 coordinator SQL calls, 256 MiB of decoded client response bodies, and 2 MiB per individual response. Worker allowances are partitioned, not multiplied per shard. A pre-provisioning whole-project Neon billing observation is compared before gameplay and after every stage. A reported increase above 1 GiB, missing/incomparable counter, reset or changed billing period blocks escalation.

The provider counter includes concurrent production, development and CI usage and has no accounting watermark. It is **not** attributed test egress or a hard actual-egress cap. Client decoded bytes, coordinator counts, compute-time bounds and provider counters are different metrics. These are resource envelopes and a conservative delayed usage signal, not a verified dollar invoice or production per-player cost. #541 and production alert thresholds are unchanged. Do not increase these envelopes merely because a run fails.

## Telemetry and evidence

Before gameplay, the machine-declared 60 bounded private health probes must produce retained exact-SHA telemetry through the real preview log API. Preflight applies the same attribution boundary as stage telemetry: exact-SHA `health` 200 evidence is required; wrong-release events and retained 429/5xx fail closed; unauthenticated preview-only 4xx boundary rejects are counted in the artifact but do not masquerade as cohort failures. The preflight waits the two-minute settlement allowance, then polls the same fixed historical window without generating more traffic until positive evidence arrives or the already-declared 240-second telemetry timeout expires. Retrying the read does not lower the positive-evidence requirement. After each stage and a two-minute settlement allowance, every active one-minute bin must retain at least one event and at least 2% of its known client request count. Every generated client request is recorded before fetch, so any cohort non-2xx remains a hard application failure independent of retained telemetry. The fixed preview hostname can also receive unauthenticated Internet traffic; preview-only 4xx boundary rejects are therefore retained with status/route counts but are not attributed to the cohort. Retained 429 or 5xx events, wrong releases, schema/access errors, truncation and absent/sparse active bins still fail closed, including in quiet drain bins. The finite private preview emits every success and error event, avoiding a random zero-event minute like run 36278169493's 11-request bin under 10% sampling. Production remains 10% success / 100% error sampled. Retained log collection still cannot prove a lossless ledger or population latency SLO; exact route percentiles come from unsampled client records.

The replacement isolated run 36279317519 (`e998e4d9636dd791634af54ff2861b2590e37695`) retained all 60 preflight probes but stopped at 25 players on the unchanged reroll p95 gate: 34 rerolls p95 2424.52 ms (2-second limit), concentrated in the synchronized hold opening. All 1,545 client requests succeeded, all 25 initial players completed, 30 hold runs completed, and correctness failures were zero; start p95 was 1397.65 ms. Preview removal and branch GET 404 passed. No 50-player stage ran and no capacity claim changes. The start phase headers localized the first 25 hold starts' p95 1231.7 ms selection to 1198.75 ms summed candidate/trajectory queries; gateway quota p95 was 64 ms. A representative disposable-clone plan for the existing inventory draw scanned thousands of index entries, but a proposed pick-window index yielded similar warm execution time and added 223 MB. It is not adopted from that serial plan alone. The next preview candidate adds bounded reroll phase/query timing to distinguish database selection, session writes and gateway delay without changing the policy or production headers.

Thirty-day artifacts:

* `distributed-capacity-setup`: exact declaration/policy/scope, verified compute/expiry, pre-provisioning usage, fixture counts/plans and positive telemetry preflight.
* `distributed-capacity-runner-0` through `-4`: sanitized client request timings, actor hold/recovery evidence, encrypted egress attestations, terminal generator state, cumulative resource counts, and leader stage decisions with telemetry/usage.
* `distributed-capacity-final`: independently recomputed acceptance plus cleanup evidence. Failed or absent stages are recorded, not discarded.

Regression tests execute state transitions, concurrent CAS contention, cookie/CSRF/idempotency transport, a stateful accelerated gameplay fixture, retained-log parsing/splitting, and negative acceptance cases. They are not live capacity evidence. Report exact workflow run/attempt and SHA, duration, real counts and distributions, all failures, resource settings, attribution limits and cleanup before increasing supported capacity. This protocol proves only finite closed-loop mixed-lifecycle sessions on five networks—not continuously in-flight requests, geographic/provider diversity or indefinite endurance. Merged, production-deployed and isolated-verified statuses are separate.
