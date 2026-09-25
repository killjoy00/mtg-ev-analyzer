# Practice serving cache

Issue #516's baseline found 4–5 seconds of repeated Mixed group aggregation,
expensive distinct-source custom coverage, and up to several seconds for eight
candidate lookups. Migration 0039 materializes the eligible candidate identifiers,
per-set/pick/band counts, distinct-source coverage and Live set metadata. It does
not materialize finished runs or change random draws.

The cache key contains corpus, difficulty, serving policy, schema and a database
revision. Each mutation transaction bumps the revision once, including bulk
imports whose per-row rating writer otherwise causes repeated invalidation.
Statement triggers cover puzzle membership and selection metadata, ratings,
exclusions, component status, environment policy and corpus-version membership.
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
runs and rerolls retain their existing paths.

Apply 0039 before deploying Functions. Run `node scripts/warm-practice-cache.mjs`
with the target DATABASE_URL after publication and before enabling traffic. The
secure release workflow does this for development and production. Later serving
mutations invalidate automatically; the first request rebuilds if publication did
not prewarm. During that rebuild other starts may return a retryable 503. Do not
retry non-idempotent starts automatically; retain a start idempotency key or ask
the player to retry. This is a deliberate bounded availability tradeoff.

Rollback Functions to the previous revision; the additive cache tables/triggers
can remain. Do not disable invalidation while cache-enabled Functions serve.

The isolated performance workflow verifies branch ownership, applies 0039 only
to its disposable production clone, records build/storage costs, and compares
every sampled cached result (including metadata) with the unchanged selector at
the same seed. SQL-over-HTTP results are not browser or concurrency acceptance.
Backend tests cover revision families, rollback, bulk transaction deduplication,
warm reuse, bounded generations, single-builder contention and selection parity.
