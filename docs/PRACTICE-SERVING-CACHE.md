# Practice serving cache

Issue #516's baseline found 4–5 seconds of repeated Mixed group aggregation,
expensive distinct-source custom coverage, and up to several seconds for eight
candidate lookups. Migration 0039 materializes the eligible candidate identifiers,
per-set/pick/band counts, distinct-source coverage and Live set metadata. It does
not materialize finished runs or change random draws.

The cache key contains corpus, difficulty, serving policy, schema and a database
revision. Each mutation transaction bumps the revision once, including bulk
imports whose per-row rating writer otherwise causes repeated invalidation.
Migrations 0041/0042 make invalidation aware of the active source snapshot.
Statement triggers cover insert/delete/truncate and publication dependencies;
row triggers distinguish actual puzzle/rating updates from no-ops. The revision
counter still changes at most once per transaction. Staging a non-active snapshot
does not invalidate live selection. Exclusions, component status, environment
policy and corpus-version membership remain covered.
Payload-only image/display maintenance does not alter selector inputs.

One transaction builds and publishes a complete generation under a nonblocking
advisory lock. It rechecks the revision before publication. Concurrent builders
receive a retryable 503 with Retry-After instead of multiplying expensive work.
The latest two generations per cache key are retained. No unbounded in-memory
cache or persistent warm-compute requirement is introduced.

Requests copy mutable group counts, apply date-sensitive release policy, consume
the existing PRNG draws and use C-collated puzzle ordering. Candidate lookup uses
the compact inventory; source trajectories and difficulty metadata retain the
original queries and numeric decoding. A final revision check rejects selections
that overlap committed eligibility changes. Session insertion also locks and
checks that revision. Bounded retries reuse the same seed and charge the player
rate limit once. Persisted Daily schedules, Daily generation, shared historical
runs retain their existing paths. Rerolls use the same live eligibility and exact
distance/tie ordering, with an ordered candidate plan that bounds rating lookups.

Apply the reviewed pending migrations through 0043 before deploying Functions.
Replaying 0039/0041/0042 must be followed by 0043 to preserve the readiness gate.
The original coherent builder is retained as `pack1_build_serving_snapshot`;
`pack1_serving_snapshot` serves only the current verified generation for a
registered release cache key. It never delegates a pending build to a player.
The guarded release registers the complete corpus/difficulty/policy/schema key
and runs `node scripts/warm-practice-cache.mjs` on development, then production.
A successful process exit means the current revision is built and serving-verified,
not merely that an activation or job insertion committed. `--inspect` is read-only
and fails if current readiness is not established.

## Durable activation and recovery (#624)

The existing authenticated admin lifecycle and guarded component-publication
paths retain their admission gates. Each actual serving-revision change queues
readiness in the same transaction using a deferred outbox trigger. The trigger
captures the final source/component intent and associates its revision with the
audit event. Non-serving Candidate staging retains 0042's no-churn behavior.
Activation commits before the initiating handler runs one readiness attempt;
no activation transaction or publication lock spans the expensive cache build.
The response distinguishes `activation_committed` from `ok` and `readiness.ready`.
A lost response does not prove rollback: inspect the audit/status rather than
blindly replaying the activation. Snapshot switches also accept the UI's expected
active snapshot to reject a stale administration form.

Readiness states are queued, warming, verifying, retry_wait, ready, failed and
superseded. The lightweight admin readiness read includes operation/current
revision, attempts, lease, cache generation, exact worker release, proof and
sanitized errors. The dashboard shows admission quality separately from serving
readiness, retains #614's active/staged/retained counts and offers authorized
readiness retry without changing publication. Polling never claims or builds work.

An executor claims a five-minute fenced lease, builds with the existing advisory
single-builder lock, audits compact inventory against the runtime predicate in
both directions, and exercises the affected source through cached practice,
rerolls and Daily/Latest planning where applicable. Cube uses its real P2-P9
windows. A representative multi-set sample is also verified. No schedule,
session, score or finished practice run is created by these proofs.
The short completion transaction locks and checks the current revision, complete
cache key, lease token, captured intent and Pacific verification date. A writer
cannot commit between that check and marking ready. Any newer serving revision
supersedes previous readiness immediately; obsolete workers cannot make it ready.

Transient failures have at most four attempts per retry cycle with backoff.
Expired leases and due retries are recovered by the existing authenticated
`pack1-account-deletion-maintenance` invocation (every ten minutes), after its
existing identity verification. This adds no recurring compute wakeup schedule
and leaves scale-to-zero settings unchanged. The daily corpus smoke is a second
backstop; explicit guarded warmup and authorized admin retry use the same
executor. Terminal verification failures require inspection and an explicit retry;
there is no automatic rollback, obsolete-generation fallback or quality bypass.
If persistence fails too, the durable lease expires and remains recoverable.
At most 128 completed/superseded operations per key are retained, separately from
the unchanged two-generation cache storage bound.

A bounded refresh window is intentional: new cache-dependent practice requests
receive a retryable 503 while readiness is pending or failed. They do not build
or silently use stale counts. Existing fixed Dailies and stored historical runs
keep their established paths. Do not automatically replay non-idempotent starts;
retain the existing start idempotency key or ask the player to retry.

This is not a zero-downtime staged-publication design. Automatic recovery can
wait for the next ten-minute maintenance invocation after interruption; the admin
can explicitly retry when safe. A successful prior job does not guarantee future
readiness after another publication, and a healthy unchanged Live corpus does not
need recurring full-payload health scans merely to keep serving.

Rollback Functions to the previous revision; the additive cache tables/triggers
can remain. Do not disable invalidation while cache-enabled Functions serve.

The isolated performance workflow verifies branch ownership, applies 0039 and the subsequent snapshot migrations
only to its disposable production clone, records build/storage costs, and compares
every sampled cached result (including metadata) with the unchanged selector at
the same seed. SQL-over-HTTP results are not browser or concurrency acceptance.
Backend tests cover revision families, rollback, bulk transaction deduplication,
warm reuse, bounded generations, single-builder contention and selection parity.

Under the current 0042 triggers, a rollback-only 1,000-row real metadata change
spent 9.8–11.8 ms in update triggers (1,000 calls, one revision increment per
transaction). A deliberately held two-second publication transaction delayed a
second writer by 1,952 ms. These are bounded diagnostic samples, not full-import
throughput claims. Keep import transactions bounded and prewarm after activation.
