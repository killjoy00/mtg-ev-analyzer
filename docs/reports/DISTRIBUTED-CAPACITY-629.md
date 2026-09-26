# Next distributed capacity evidence (#629)

## Status and historical claims

This is the implementation and measurement protocol, **not a new supported-capacity claim**. Historical #516/#527 remain completed. Read `PRACTICE-LAUNCH-CLOSEOUT-2026-09-26.md` and `results/launch-closeout-2026-09-26`: 25 players on five verified real independent egress networks passed; 100 players on one shared network passed separately. The incomplete distributed 100 experiment admitted 18/20 generators and completed 90 players successfully. It was not measured backend saturation, and short paced runs were not endurance tests.

Reviewed application baseline: `731a0b4b897ca1b0d4b8f8bd9f8e96658f7a83dc`. Concurrent activation readiness and native parity work are preserved. The production monitoring fix (#601; guarded release 36245824236 at `7fcf203b30e35df663028bc1923893c4e3109ce0`) supplies the bounded retained-log reader. Production monitoring code, probes and machine-managed #596 state are unchanged.

## Predeclared stages

`scripts/launch-distributed-policy.json` is the authoritative policy. Its SHA-256 fingerprint, workflow run ID, attempt, exact tested merge SHA and isolated branch bind every fixture, state, report and decision. Policy edits require another measurement; do not move thresholds to pass observed results.

| Stage | Active mixed-lifecycle players | Persistent real egress networks | Initial window | Sustained hold | Drain | Recovery |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Requalification | 25 | 5 | 120 seconds | 120 seconds | 90 seconds | 60 seconds |
| Intermediate | 50 | 5 | 120 seconds | 180 seconds | 90 seconds | 60 seconds |
| Proposed next level | 100 | 5 | 120 seconds | 600 seconds | 90 seconds | 60 seconds |

Actors arrive over 15 seconds and perform eight view/pick pairs with 3–8-second thinking. Fixed ten-actor blocks contain five original guests and five original signed-in accounts; the last two accounts practice, and the other actors divide among Mixed, Cube and Latest Dailies. At 25 this gives 15 guests, ten original signed-in accounts, 21 Daily players and four initial practice players. At 50/100 the ratios are exactly 50/50 and 80/20. Fixtures retain 2,000 synthetic accounts and 180,000 historical score rows.

During each hold, original signed-in actors repeatedly finish entitled practice runs with rerolls, rotating Mixed, Cube, single-set custom and multi-set custom. Original guests poll Daily status and representative board periods every 15 seconds, including after the account-attachment subcase. Mutations drain before one existing actor per network exercises a full recovery minute. Exact final scoring, share behavior, eligibility, account attachment, self-profile and all eight Daily puzzle identities are checked. No identity, quota key or quota state is reset between stages. `launch-load.yml` remains the separate NAT/browser scenario; it is not relabeled distributed.

Route budgets, p95/p99 milliseconds: session 2000/5000, start 2000/8000, view 1000/3000, pick 2000/5000, reroll 2000/5000, read 2000/5000. Errors, unintended 429s and correctness failures must be zero. Complete-stage and phase-specific distributions must pass; absent required samples fail. A conservative per-generator rolling route window (up to 200 samples, minimum 25) also stops at a latency failure. Common-start and arrival lateness must each be at most one second. Every actor must complete initial gameplay and participate throughout the hold.

## Readiness and safety

The same five jobs remain alive across stages. A compare-and-swap row in the verified disposable database coordinates them. There is no start timestamp until all five have attested distinct gateway-observed network hashes and fresh heartbeats. A start is then armed 30 seconds ahead, and every runner must acknowledge it at least five seconds before arrival. Two-second heartbeats have a 20-second lease; refreshing late cannot erase an expired lease. Missing or duplicate runners, changed egress, wrong scope, missing acknowledgements, scheduling overruns and clock uncertainty are generator failures, not backend saturation.

Only fixed private `api-preview.packone.pro` ingress is allowed, under the existing shared `pack1-gateway-preview` concurrency lock. Provider metadata verifies branch/SQL-host ownership before coordinator SQL. The existing isolated deployment retains protected origins and sealed inherited utilities. The request allowlist excludes email, auth providers, Patreon, billing and administration; synthetic accounts use `example.invalid` and entitlements are local records. No application mutation is retried and no forwarding/real-IP headers manufacture independent networks. Credentials and raw egress hashes remain in the disposable database or authenticated encrypted transfer; public artifacts retain encrypted egress attestations and counts.

Cleanup always attempts preview-mapping removal and branch deletion, then independently verifies mapping absence and branch GET 404. A successful stage is not completed capacity evidence without verified cleanup. Emergency expiry protects against killed jobs. Encrypted transfer artifacts have one-day retention; deleted-branch credentials cease to provide a live target.

## Resource ceilings and accounting limitations

The experiment is bounded to 45 minutes from coordinator initialization and a 75-minute branch lifetime. Compute is verified at no more than eight CU with 300-second suspension, and exact observed settings are retained. Eight CU over the entire emergency lifetime is a ten-CU-hour upper envelope, not expected consumption. Job timeouts bound runner allocations below 270 runner-minutes.

Limits are 50,000 gateway requests including the machine-declared 60-request private telemetry preflight, 20,000 coordinator SQL calls, 256 MiB of decoded client response bodies, and 2 MiB per individual response. Worker allowances are partitioned, not multiplied per shard. A pre-provisioning whole-project Neon billing observation is compared before gameplay and after every stage. A reported increase above 1 GiB, missing/incomparable counter, reset or changed billing period blocks escalation.

The provider counter includes concurrent production, development and CI usage and has no accounting watermark. It is **not** attributed test egress or a hard actual-egress cap. Client decoded bytes, coordinator counts, compute-time bounds and provider counters are different metrics. These are resource envelopes and a conservative delayed usage signal, not a verified dollar invoice or production per-player cost. #541 and production alert thresholds are unchanged. Do not increase these envelopes merely because a run fails.

## Telemetry and evidence

Before gameplay, the machine-declared 60 bounded private health probes must produce retained exact-SHA telemetry through the real preview log API. The preflight waits the two-minute settlement allowance, then polls the same fixed historical window without generating more traffic until positive evidence arrives or the already-declared 240-second telemetry timeout expires. Retrying the read does not lower the positive-evidence requirement. After each stage and a two-minute settlement allowance, every active one-minute bin must retain at least one event and at least 2% of its known client request count. Errors are unacceptable even in quiet drain bins. Schema/access errors, truncation, wrong releases and absent/sparse active bins fail closed. The 10% success sampling cannot prove lossless collection or a population latency SLO: exact route percentiles come from client records; gateway/quota/upstream samples remain explicitly sampled.

Thirty-day artifacts:

* `distributed-capacity-setup`: exact declaration/policy/scope, verified compute/expiry, pre-provisioning usage, fixture counts/plans and positive telemetry preflight.
* `distributed-capacity-runner-0` through `-4`: sanitized client request timings, actor hold/recovery evidence, encrypted egress attestations, terminal generator state, cumulative resource counts, and leader stage decisions with telemetry/usage.
* `distributed-capacity-final`: independently recomputed acceptance plus cleanup evidence. Failed or absent stages are recorded, not discarded.

Regression tests execute state transitions, concurrent CAS contention, cookie/CSRF/idempotency transport, a stateful accelerated gameplay fixture, retained-log parsing/splitting, and negative acceptance cases. They are not live capacity evidence. Report exact workflow run/attempt and SHA, duration, real counts and distributions, all failures, resource settings, attribution limits and cleanup before increasing supported capacity. This protocol proves only finite closed-loop mixed-lifecycle sessions on five networks—not 100 continuously in-flight requests, geographic/provider diversity or indefinite endurance. Merged, production-deployed and isolated-verified statuses are separate.
