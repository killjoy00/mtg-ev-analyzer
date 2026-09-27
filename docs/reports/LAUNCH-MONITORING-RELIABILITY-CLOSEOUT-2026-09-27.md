# Launch-monitoring reliability closeout — 2026-09-27

## Status

Complete and live in production.

PR #696, **Recover launch monitoring from delayed GitHub cron**, merged as `c5cd292149cfe0a25173c81488cff1096b1d1a35`. The guarded secure-account release then deployed the reviewed watchdog path to production `pack1growth`, and live production evidence proved that the independent Neon schedule can recover launch coverage when GitHub's requested five-minute schedule does not materialize a root run on time.

This closeout does not claim GitHub cron became reliable. The production design now assumes it may be delayed: GitHub remains the launch-monitoring execution engine, while the independent Neon maintenance schedule is the bounded authenticated backstop that can start the existing workflow.

## Failure that was closed

The launch watcher already had durable #596 coverage state and, through merged #644, bounded immediate continuation chains after a root run existed. Those mechanics were working.

The remaining failure was root-run timeliness. On September 27, scheduled launch-alert roots were observed only around:

- 07:10 UTC;
- 13:04 UTC;
- 17:42 UTC;
- 20:26 UTC.

Those multi-hour gaps were incompatible with the 30-minute coverage-freshness limit. Once a root appeared, the existing continuation chain advanced coverage correctly. The failure was therefore GitHub schedule materialization, not catch-up continuation logic.

The independent Neon `pack1-account-deletion-maintenance` trigger continued to fire every ten minutes at `:09/:19/:29/:39/:49/:59` UTC during those GitHub gaps. Before #696 it could detect and email about stale coverage but could not restore execution.

## What #696 changed

The production `pack1growth` launch-watcher signal now has a bounded recovery dispatcher in `worker/launch-watcher-dispatch.mjs`.

When Neon sees #596 more than 30 minutes behind its edge-attested scheduled time, it may dispatch the existing `.github/workflows/launch-alert.yml` with `continuation_depth=0`. The watchdog does not inspect production logs or advance #596 itself. After dispatch, the existing launch-alert workflow remains authoritative for:

- Cloudflare/Neon telemetry inspection;
- the 15-minute calculation windows;
- the two-minute settlement delay;
- recent-window replay;
- the three-day conservative recoverability bound;
- monotonic #596 persistence;
- the existing Actions concurrency group;
- #644 bounded continuation chains;
- incident routing and recovery closure.

Independent recovery state is kept under `launch_watcher_recovery_dispatch_v1` in the existing `settings` table.

The state machine is intentionally bounded:

- compare-and-set claiming prevents concurrent Neon invocations from intentionally dispatching two roots;
- at most three independent root attempts are allowed in one stale episode;
- failed dispatches may retry after ten minutes;
- an accepted dispatch with no coverage progress waits 20 minutes before another attempt;
- an in-flight claim expires after ten minutes;
- any observed coverage progress suppresses another independent root;
- the first fresh check resets the episode to `fresh`.

The existing `launch_watcher_operator_alert_v1` email state remains separate. Dispatch failure does not suppress the independent stale email or the Neon 503 signal.

## Credential and release boundary

The recovery credential is:

`PACK1_LAUNCH_WATCHER_GITHUB_TOKEN`

It is a fine-grained GitHub token restricted to `killjoy00/mtg-ev-analyzer` with Actions write permission. No token value is recorded in this repository or this report.

The credential is stored in the protected `pack-one-mobile-release` GitHub Environment and is injected only into the production `pack1growth` deployment. Development intentionally does not receive it.

The guarded `.github/workflows/secure-auth-release.yml` release proves that boundary:

- preflight validates that the protected token is present and shaped like a fine-grained GitHub token;
- development smoke requires launch recovery to be unconfigured;
- production deployment injects the credential only into production `pack1growth`;
- production smoke requires launch recovery to report configured;
- `/health` exposes only a boolean configuration marker.

For rotation, replace the protected environment secret and rerun the guarded release so the development/production smoke boundary is re-proved. Do not widen the token to repository administration or move it to a repository-wide secret.

## Test and merge evidence

Final PR #696 head before merge:

`88cd039489a77419cce639a46bd3b3fc2b9db99d`

Required PR gates all passed:

| Gate | Run | Result |
| --- | ---: | --- |
| Test | 36353761104 | success |
| Browser / E2E | 36353761282 | success |
| Isolated Neon backend schema/integration | 36353761100 | success |

Focused watchdog tests cover:

- missed initial GitHub invocation;
- multiple delayed scheduler ticks;
- concurrent Neon recovery calls;
- GitHub dispatch failure and retry;
- accepted dispatch with no progress;
- the three-attempt stale-episode ceiling;
- production-only credential release scoping.

A final compatibility adjustment accepted GitHub workflow-dispatch success responses of either HTTP 200 or 204.

## Release evidence

PR #696 merged as:

`c5cd292149cfe0a25173c81488cff1096b1d1a35`

Guarded release:

- workflow: `release secure account auth`;
- run: **36355434171**;
- result: **success**;
- production `pack1growth` deployment: **73**;
- production deployment created: **2026-09-27T22:34:23.745703Z**.

The active production function environment includes the launch-watcher credential name. The secret value is not exposed.

## Production acceptance

### Delayed-scheduler recovery

At **2026-09-27T22:39:01Z**, the independent Neon trigger observed:

- `covered_through=2026-09-27T20:25:00Z`;
- coverage age **134 minutes**;
- allowed maximum **30 minutes**;
- `recovery_dispatch=dispatched`;
- `recovery_attempts=1`.

Neon dispatched GitHub Actions run **36356015651** using `workflow_dispatch`. It completed successfully.

That run advanced issue #596 contiguously to:

`covered_through=2026-09-27T22:35:00Z`

No manual launch-alert run was used for this acceptance path.

### Recovery confirmation

At **2026-09-27T22:49:00Z**, the next independent Neon maintenance interval recorded:

- `launch_watcher_recovered`;
- coverage age **14 minutes**;
- operator alert state `recovered`;
- recovery-dispatch state `recovered`.

Both persisted states then reset to `fresh`, and recovery attempts reset to zero.

Resend reported the **[Pack One] Launch coverage recovered** message sent at **22:49:01Z** as **delivered**.

### Normal subsequent interval

The **2026-09-27T22:59:00Z** Neon maintenance invocation ran normally. With #596 still through 22:35Z, coverage age was about **24 minutes**, below the unchanged 30-minute limit. No second GitHub recovery root was dispatched during that still-fresh interval.

This is the multi-interval acceptance evidence used to close the rollout; it is stronger than a single manual or recovery run.

### Subsequent repeated stale episode

GitHub schedule materialization remained unreliable after acceptance, which is the expected condition this design exists to tolerate.

At **2026-09-27T23:09:02Z**, Neon observed a new stale episode:

- prior `covered_through=2026-09-27T22:35:00Z`;
- coverage age **34 minutes**;
- `recovery_dispatch=dispatched`;
- `recovery_attempts=1`.

This was a distinct stale episode, not a duplicate dispatch from the 22:39 episode. GitHub Actions run **36357711248** completed successfully and advanced #596 to:

`covered_through=2026-09-27T23:05:00Z`

At **2026-09-27T23:19:01Z**, the next Neon maintenance interval recorded a second `launch_watcher_recovered` event with coverage age **14 minutes**. Both persisted launch-watcher states reset to `fresh`, and recovery attempts reset to zero again. Resend reported both the **23:09:02Z** stale notification and the **23:19:01Z** recovery notification as **delivered**.

This second complete stale→dispatch→fresh cycle demonstrates that recovery is reusable rather than a one-shot repair. The earlier cycle plus the 22:59 normal interval were already sufficient for acceptance; this later cycle adds independent repeat evidence under the same live scheduler failure mode.

## Preserved behavior

The rollout intentionally did not change:

- the 30-minute launch-coverage freshness limit;
- #596's sanitized monotonic watermark role;
- the five-minute launch-alert schedule request;
- #644 continuation semantics or maximum continuation depth;
- launch-alert workflow concurrency;
- late-event replay behavior;
- log-retention fail-closed behavior;
- alert-window deduplication;
- resource/usage thresholds;
- incident categories;
- operator-email deduplication and provider idempotency;
- account-deletion maintenance bounds;
- gameplay, player identity, quota, scoring or corpus behavior.

Issue #596 remains machine-managed coverage state and must not be repurposed as an incident tracker.

## Operating and incident notes

Healthy operation does **not** require GitHub cron to materialize every requested run. It requires the durable watermark to remain within the 30-minute bound, with Neon able to detect and recover a delayed root before the gap becomes unrecoverable.

If launch coverage goes stale:

1. Inspect the current #596 watermark and the latest `pack1growth` `launch_watcher_stale` / `launch_watcher_recovered` logs.
2. Inspect `launch_watcher_recovery_dispatch_v1` for `dispatching`, `dispatched`, `failed` or `exhausted`.
3. Confirm whether a `launch-alert.yml` `workflow_dispatch` root appeared and whether #596 advanced.
4. Preserve the existing workflow concurrency and #644 continuation chain; do not start parallel catch-up implementations.
5. If dispatch authentication fails, rotate the protected fine-grained token and redeploy through the guarded release. The independent Neon stale signal and operator email remain the observable fallback.
6. If recovery reaches the three-attempt ceiling or coverage becomes older than the retained-log recoverability bound, treat it as an operator incident rather than widening retry bounds.

## Final boundary

This closeout establishes that the September 27 timely-execution failure has an independent production recovery path and that the path worked in production across a real delayed-scheduler incident and subsequent normal Neon intervals.

It does not establish that future third-party schedulers, GitHub Actions, Neon Functions, Cloudflare logs or email delivery can never fail. The system remains intentionally fail-observable and bounded rather than attempting unlimited retries.

See [Launch operations](../LAUNCH-OPERATIONS.md) and [Neon scheduled maintenance](../NEON-SCHEDULERS.md) for the current runbooks.
