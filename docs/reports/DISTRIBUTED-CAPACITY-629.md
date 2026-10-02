# Next distributed capacity evidence (#629)

## 100-player target dropped — 2026-10-02

Owner decision: 100 players is no longer a distributed-capacity target. Policy version 3 (`scripts/launch-distributed-policy.json`) reduces the ladder to **25→50**. The 50-player stage becomes the final stage and inherits the 600-second sustained hold that the 100 stage carried. Every other gate, budget and envelope is unchanged. #685 is closed by this change.

Evidence at the time of the decision:
- 50 players passed completely three times under policy version 2:
  - run 36326543142;
  - run 36792854202, attempt 4;
  - run 37011654672 (#847).

  All three used the 180-second 50-player hold.
- Run 37011654672's 100 stage stopped on `rolling_route_latency` at the synchronized hold opening. Reads took 1.5–4.0 s and practice starts 2.5–4.4 s on all five runners. No transport failure occurred.
- Earlier 100-stage attempts stopped on a single slow request or on single-connection transport failures; see #685.

This does not reinterpret any earlier run. **Formal supported distributed capacity remains 25** until a complete 25→50 run passes under policy version 3, including the longer 600-second hold at 50. The historical evidence below is unchanged.

## Release decision — 2026-09-27

The current-practice selector work is accepted for the release path. No further selector/model tuning is a v1 release blocker on the evidence below. This decision does **not** retroactively change the predeclared capacity gates or call the 100-player stage a pass.

Runtime-code evidence is PR #655 head `dcb543da1abc4777d1e36bf3ad599e4af4454671`, tested merge SHA `0ea8e67bbfd969dd7a49e3c2f3264bca43894752`, workflow run [36326543142](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36326543142). Normal test, E2E, gateway-runtime, backend-schema and isolated-practice-performance workflows also passed on that runtime-code head. Subsequent #655 commits through this documentation update change only Markdown/release bookkeeping; they do not change runtime or schema behavior; isolated practice performance is run [36326543143](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36326543143).

- **25 players: PASS.** 1,543 requests, zero correctness failures. Start p95/p99 1,638.03/1,788.31 ms; reroll p95/p99 959.98/1,134.17 ms.
- **50 players: PASS.** 3,968 requests, 3,943 HTTP 200 + 25 HTTP 201, zero correctness failures. Start p95/p99 1,602.65/2,188.32 ms; synchronized-hold start p95 1,898.40 ms; reroll p95/p99 1,217.49/1,867.57 ms; view p99 383.79 ms; read p99 900.66 ms. This is the first complete five-egress 50-player pass under the unchanged #629 policy.
- **100 players: NOT CERTIFIED.** All 100 session/start requests were observed before abort. Partial aggregate start p95/p99 was 318.68/478.46 ms, reroll p95 616.92 ms, read p95 264.67 ms, and there were zero recorded correctness failures. One shard recorded a single 3,210.81 ms initial `view` request; with 74 local view samples at that point, that outlier pushed the conservative per-runner rolling view p99 above the unchanged 3,000 ms limit and stopped the cohort. Across the 380 partial view samples, aggregate p99 was 322.84 ms. The 600-second hold, recovery, final telemetry and complete-stage gates therefore did not finish, so 100 is not a pass.
- **Cleanup: PASS.** The private preview mapping was removed and disposable Neon branch `br-bitter-scene-ay6jerfh` was deleted.

The release interpretation is intentionally split: **formal supported distributed capacity remains 25** because the predeclared protocol requires a complete 25→50→100 ladder before promotion; **50-player distributed capacity has now been directly demonstrated**; and the partial 100-player evidence is strong but not a certification. Product/release work may proceed with the current selector implementation. Formal 100-player certification is tracked in #685 as post-release follow-up work, not a reason to keep optimizing the selector for v1.

## Status and historical claims

This is the implementation and measurement protocol, **not a new supported-capacity claim**. Historical #516/#527 remain completed. Read `PRACTICE-LAUNCH-CLOSEOUT-2026-09-26.md` and `results/launch-closeout-2026-09-26`: 25 players on five verified real independent egress networks passed; 100 players on one shared network passed separately. The incomplete distributed 100 experiment admitted 18/20 generators and completed 90 players successfully. It was not measured backend saturation, and short paced runs were not endurance tests.

Reviewed application baseline: `731a0b4b897ca1b0d4b8f8bd9f8e96658f7a83dc`. Concurrent activation readiness and native parity work are preserved. The production monitoring fix (#601; guarded release 36245824236 at `7fcf203b30e35df663028bc1923893c4e3109ce0`) supplies the bounded retained-log reader. Production monitoring code, probes and machine-managed #596 state are unchanged.

## Predeclared stages

`scripts/launch-distributed-policy.json` is the authoritative policy. Its SHA-256 fingerprint, workflow run ID, attempt, exact tested merge SHA and isolated branch bind every fixture, state, report and decision. Policy edits require another measurement; do not move thresholds to pass observed results.

| Stage | Active mixed-lifecycle players | Persistent real egress networks | Initial window | Sustained hold | Drain | Recovery |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Requalification | 25 | 5 | 120 seconds | 120 seconds | 90 seconds | 60 seconds |
| Proposed level (policy v3) | 50 | 5 | 120 seconds | 600 seconds | 90 seconds | 60 seconds |

Policy version 2 (through 2026-10-02) used a 180-second hold at 50 and a final 100-player stage with a 600-second hold; the evidence above was measured under it.

Actors arrive over 15 seconds and perform eight view/pick pairs with 3–8-second thinking. Fixed ten-actor blocks contain five original guests and five original signed-in accounts; the last two accounts practice, and the other actors divide among Mixed, Cube and Latest Dailies. At 25 this gives 15 guests, ten original signed-in accounts, 21 Daily players and four initial practice players. At 50/100 the ratios are exactly 50/50 and 80/20. Fixtures retain 2,000 synthetic accounts and 180,000 historical score rows.

During each hold, original signed-in actors repeatedly finish entitled practice runs with rerolls, rotating Mixed, Cube, single-set custom and multi-set custom. Original guests poll Daily status and representative board periods every 15 seconds, including after the account-attachment subcase. Mutations drain before one existing actor per network exercises a full recovery minute. Exact final scoring, share behavior, eligibility, account attachment, self-profile and all eight Daily puzzle identities are checked. No identity, quota key or quota state is reset between stages. `launch-load.yml` remains the separate NAT/browser scenario; it is not relabeled distributed.

Route budgets, p95/p99 milliseconds: session 2000/5000, start 3000/8000, view 1000/3000, pick 2000/5000, reroll 2000/5000, read 2000/5000.

The start-route p95 budget was changed from 2000 ms to 3000 ms only for measurements after failed run 36269646999. That run remains a failure under its bound policy and is not retroactively accepted. Its 50-player hold opened with a deliberately synchronized burst of 25 practice starts: the aggregate partial-stage start p95 was about 2.85 seconds, while subsequent starts were mostly about 0.3-0.9 seconds and other routes remained within budget. The 3-second value is therefore an explicit product/SLO decision for the user-visible transition, not an optimization claim; p99 remains 8 seconds and all zero-error, correctness, telemetry, egress, resource and cleanup gates are unchanged. A fresh exact-policy run must pass before supported capacity changes. Errors, unintended 429s and correctness failures must be zero. Complete-stage and phase-specific distributions must pass; absent required samples fail. A conservative per-generator rolling route window (up to 200 samples, minimum 25) also stops at a latency failure. Common-start and arrival lateness must each be at most one second. Every actor must complete initial gameplay and participate throughout the hold.

## Readiness and safety

The same five jobs remain alive across stages. A compare-and-swap row in the verified disposable database coordinates them. There is no start timestamp until all five have attested distinct gateway-observed network hashes and fresh heartbeats. A start is then armed 30 seconds ahead, and every runner must acknowledge it at least five seconds before arrival. Two-second heartbeats have a 20-second lease; refreshing late cannot erase an expired lease. Missing or duplicate runners, changed egress, wrong scope, missing acknowledgements, scheduling overruns and clock uncertainty are generator failures, not backend saturation.

Only fixed private `api-preview.packone.pro` ingress is allowed, under the existing shared `pack1-gateway-preview` concurrency lock. Provider metadata verifies branch/SQL-host ownership before coordinator SQL. The existing isolated deployment retains protected origins and sealed inherited utilities. The request allowlist excludes email, auth providers, Patreon, billing and administration; synthetic accounts use `example.invalid` and entitlements are local records. No application mutation is retried and no forwarding/real-IP headers manufacture independent networks. Credentials and raw egress hashes remain in the disposable database or authenticated encrypted transfer; public artifacts retain encrypted egress attestations and counts.

Cleanup always attempts preview-mapping removal and branch deletion, then independently verifies mapping absence and branch GET 404. A successful stage is not completed capacity evidence without verified cleanup. Emergency expiry protects against killed jobs. Encrypted transfer artifacts have one-day retention; deleted-branch credentials cease to provide a live target.

## Resource ceilings and accounting limitations

The experiment is bounded to 45 minutes from coordinator initialization and a 75-minute branch lifetime. Compute is verified at no more than eight CU with 300-second suspension, and exact observed settings are retained. Eight CU over the entire emergency lifetime is a ten-CU-hour upper envelope, not expected consumption. Job timeouts bound runner allocations below 270 runner-minutes.

Limits are 50,000 gateway requests including the machine-declared 60-request private telemetry preflight, 20,000 coordinator SQL calls, 256 MiB of decoded client response bodies, and 2 MiB per individual response. Worker allowances are partitioned, not multiplied per shard. A pre-provisioning whole-project Neon billing observation is compared before gameplay and after every stage. A reported increase above 1 GiB, missing/incomparable counter, reset or changed billing period blocks escalation.

The provider counter includes concurrent production, development and CI usage and has no accounting watermark. It is **not** attributed test egress or a hard actual-egress cap. Client decoded bytes, coordinator counts, compute-time bounds and provider counters are different metrics. These are resource envelopes and a conservative delayed usage signal, not a verified dollar invoice or production per-player cost. #541 and production alert thresholds are unchanged. Do not increase these envelopes merely because a run fails.

## Telemetry and evidence

Before gameplay, the machine-declared 60 bounded private health probes must produce retained exact-SHA telemetry through the real preview log API. Preflight applies the same attribution boundary as stage telemetry: exact-SHA `health` 200 evidence is required; wrong-release events and retained 429/5xx fail closed; unauthenticated preview-only 4xx boundary rejects are counted in the artifact but do not masquerade as cohort failures. The preflight waits the two-minute settlement allowance, then polls the same fixed historical window without generating more traffic until positive evidence arrives or the already-declared 240-second telemetry timeout expires. Retrying the read does not lower the positive-evidence requirement. After each stage and a two-minute settlement allowance, every active one-minute bin must retain at least one event and at least 2% of its known client request count. Every generated client request is recorded before fetch, so any cohort non-2xx remains a hard application failure independent of retained telemetry. The fixed preview hostname can also receive unauthenticated Internet traffic; preview-only 4xx boundary rejects are therefore retained with status/route counts but are not attributed to the cohort. Retained 429 or 5xx events, wrong releases, schema/access errors, truncation and absent/sparse active bins still fail closed, including in quiet drain bins. The finite private preview emits every success and error event, avoiding a random zero-event minute like run 36278169493's 11-request bin under 10% sampling. Production remains 10% success / 100% error sampled. Retained log collection still cannot prove a lossless ledger or population latency SLO; exact route percentiles come from unsampled client records.

The replacement isolated run 36279317519 (`e998e4d9636dd791634af54ff2861b2590e37695`) retained all 60 preflight probes but stopped at 25 players on the unchanged reroll p95 gate: 34 rerolls p95 2424.52 ms (2-second limit), concentrated in the synchronized hold opening. All 1,545 client requests succeeded, all 25 initial players completed, 30 hold runs completed, and correctness failures were zero; start p95 was 1397.65 ms. Preview removal and branch GET 404 passed. No 50/100 stage ran and no capacity claim changes. The start phase headers localized the first 25 hold starts' p95 1231.7 ms selection to 1198.75 ms summed candidate/trajectory queries; gateway quota p95 was 64 ms. A representative disposable-clone plan for the existing inventory draw scanned thousands of index entries, but a proposed pick-window index yielded similar warm execution time and added 223 MB. It is not adopted from that serial plan alone. The next preview candidate adds bounded reroll phase/query timing to distinguish database selection, session writes and gateway delay without changing the policy or production headers.

Thirty-day artifacts:

* `distributed-capacity-setup`: exact declaration/policy/scope, verified compute/expiry, pre-provisioning usage, fixture counts/plans and positive telemetry preflight.
* `distributed-capacity-runner-0` through `-4`: sanitized client request timings, actor hold/recovery evidence, encrypted egress attestations, terminal generator state, cumulative resource counts, and leader stage decisions with telemetry/usage.
* `distributed-capacity-final`: independently recomputed acceptance plus cleanup evidence. Failed or absent stages are recorded, not discarded.

Regression tests execute state transitions, concurrent CAS contention, cookie/CSRF/idempotency transport, a stateful accelerated gameplay fixture, retained-log parsing/splitting, and negative acceptance cases. They are not live capacity evidence. Report exact workflow run/attempt and SHA, duration, real counts and distributions, all failures, resource settings, attribution limits and cleanup before increasing supported capacity. This protocol proves only finite closed-loop mixed-lifecycle sessions on five networks—not 100 continuously in-flight requests, geographic/provider diversity or indefinite endurance. Merged, production-deployed and isolated-verified statuses are separate.
