# Durable quota reservation preview

Related investigation: #1273. This is an isolated experiment, not a production rollout or a resolution claim.

Cloudflare's output gates hold outgoing responses until pending writes are durable. Removing `storage.sync()` does not eliminate that obligation. This candidate reduces writes instead, retaining normal output gates and the existing five-second gateway deadline and retry policy.

## Invariants and tradeoff

The persisted `buckets` row records an upper bound on consumed quota: admitted calls plus unused reserved credit. An instance reserves at most eight request credits, eight burst credits and two session credits, bounded by each window's remaining headroom. It consumes only those credits. Request, burst and session caps and fixed-window periods are unchanged. `/session-only` still avoids charging a previously charged request twice.

Candidate debit batches and cleanup alarms share one queue, held through transaction completion and `sync()`. Calls that can use already-confirmed credits finish before a new write begins. When a refill is needed, up to 256 already-queued calls are planned together in arrival order and use one counter write and acknowledgement. Each call is admitted or denied against all its scopes together. Only actual queued calls are coalesced; speculative unused credit remains bounded at seven per request bucket and one session credit. Storage callback retries publish no instance state. A failed operation discards all instance credits and rejects the entire unconfirmed batch before the next queued operation. No successful decision or new credit is published before acknowledgement. Rejected mixed requests neither write partial reservations nor consume their other available credits. Expired credits cannot be reused. Legacy rows remain authoritative. Malformed persisted counters fail closed.

After an acknowledged admission, eviction can forfeit up to seven unused credits from each request bucket and one session credit. Failed or lost acknowledgements may additionally forfeit the charges for an unconfirmed batch of at most 256 queued calls, plus its bounded speculative credit; clients cannot distinguish committed requests from lost acknowledgements. No rejected mixed call partially charges another scope. Repeated restarts can therefore cause earlier 429s; this is an explicit fairness cost, not an exact admission-equivalence claim. Rollback is safe because the old per-request implementation treats the reserved counts as spent. No counter reset or schema migration is needed.

## Automated checks

The gateway runtime workflow exercises both modes in real workerd with SQLite: simultaneous request/session caps, mixed refresh/creation calls, restart persistence, legacy denial, active-window cleanup and deletion. Unit tests additionally cover delayed/failed acknowledgement, queued concurrency, callback retries, exact window boundaries, rollback, corrupt state, 100 shared-network players completing paced gameplay, and generated mixed traffic with evictions against an independent model of the original limits.

At a fixed clock, 600 sequential admitted request-only calls require 75 counter writes in the candidate versus 600 in the baseline; the initial cleanup alarm is one additional write in either mode. This is a controlled algorithm test, not a provider latency or billing measurement. Window expiration and mixed traffic cause additional replenishments. In a controlled single-turn workload, 650 queued calls use three counter commits while admitting exactly 600 and denying 50; this is not a provider latency measurement.

## Isolated provider rehearsal

### Bounded synthetic probe

The **isolated synthetic quota comparison** workflow creates its own expiring,
authenticated Worker and two SQLite namespaces. It has no Neon database or
application/production bindings and verifies cleanup by readback. On reviewed
main it runs a fixed extended profile, capped at 10,000 HTTP calls:

- Eight paired cohorts, alternating mode/order, with 128 warm samples per mode
  per cohort. Report client and handler p95/p99 per cohort and in aggregate.
  Candidate warm samples also separate refill/credit calls with queue and
  durability timing from the limiter's own metric object. Native storage APIs
  remain untouched; these timings do not claim to include provider dispatch.
  Shared-network candidate records also report queue/durability percentiles and
  the number of calls served in coalesced batches. `reservation_write` identifies
  one owner per committed write; `batch_write` marks every call awaiting that
  shared write, and `batch_size` counts calls planned together.
- Exact fresh burst/session ceilings, plus 100 simultaneous session creations
  and 20 paced request rounds for each mode (2,100 admissions per shared quota).
- Resume a quiet quota after more than a minute, then independently verify the
  new burst window admits 600 calls and denies the next. Expired unused credits
  cannot reopen that window.
- Three forced instance resets per mode, each after one confirmed session
  admission. Verify a new instance ID after each reset and surviving durable
  counts. Baseline must admit exactly 120 total; candidate exactly 117, losing
  one unused session credit per reset. No counters are deleted or reset.

The reset route exists only in the disposable probe. It calls the documented
`DurableObjectState.abort()` API; it cannot reach the application namespaces.
Successful workflow execution means these correctness scenarios passed.
`preview_tail_acceptance` is a separate result: client and handler p95 must
improve, neither p99 may regress, at least six of eight cohorts must meet those
conditions, and shared-network client/handler p99 may not regress.
`production_ready` remains false even when those synthetic gates pass: real
distributed gameplay rehearsal, naturally occurring eviction frequency and a
separately reviewed rollout are still required.

The [first short hosted run](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/40552520368)
passed exact caps and reduced counter-write decisions from 195 to 27. Its
192 warm samples per mode gave mixed tail evidence:

| Measurement | Baseline | Candidate |
| --- | ---: | ---: |
| Client p95 | 165.14 ms | 107.52 ms |
| Client p99 | 337.37 ms | 184.64 ms |
| Handler p95 | 32 ms | 20 ms |
| Handler p99 | 37 ms | 78 ms |

The handler p99 regression prevents treating the faster p95 as rollout
acceptance. This is synthetic evidence, not production telemetry or billing
savings. Write decisions exclude provider-internal transaction retries.

The [first extended hosted rehearsal](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/40555131767)
completed all 9,157 scenario calls on retry and verified cleanup. Exact caps,
2,100 shared-network admissions per mode, expiry and the documented three-credit
restart forfeiture passed. However, the original serialized candidate failed
latency acceptance: shared-network client p99 was 1,822.58 ms versus 489.78 ms
for baseline, and only two of eight paired cohorts improved both tails. Faster
aggregate warm p99 did not override this failed gate.

To address the refill queue, the current preview coalesces already-waiting
calls into a single confirmed commit, without increasing speculative credit.
It must pass the same provider gates; the failed rehearsal is not rollout evidence.
The auth preflight still fails closed and now requires a Worker-owned 403
signature, reporting only a bounded HTTP status if provider preflight fails.

### Full gameplay rehearsal

Run **isolated distributed launch acceptance** on the reviewed candidate revision, first with `quota_reservations` false and then true, using the same capacity target and existing policy. Both defaults are false. The input reaches only the disposable preview deployment. Activation also requires `MODE=preview`, an isolated branch ID, and the exact `preview-v1` switch. Production and the shared development branch are explicitly excluded. The checked-in Wrangler configuration does not enable it.

Keep the existing source checks, resource ownership lock, usage budgets, expiry, cleanup, unsampled client records, retained telemetry checks and failure thresholds. Do not reset counters between stages or relax a failed gate. Include the shared-NAT scenario and restart/quiet-traffic scenarios before proposing rollout.

Compare equivalent traffic across runs:

- Admitted requests, all 429s, 5xx and client timeouts; any candidate-only denial in the ordinary shared-network workload fails acceptance.
- Client and gateway quota p50/p95/p99, counts above one second, and existing gameplay latency limits. Repeated runs must improve the durability tail without moving the delay into queueing or increasing errors.
- Durable Object handler records: `quota_mode`, `reservation_write`, `transaction_callbacks`, `queue_ms` and `durability_ms`. Count counter writes from confirmed reservation writes; report sample coverage, failures, alarms and retries separately. `reservation_write` on an unconfirmed failure only indicates an attempted reservation, not proven durability. Handler elapsed time includes queue wait.
- Conservative denial under eviction: verify the documented forfeiture bound, quantify restart frequency, and record any shared-network impact.

Keep raw logs and detailed provider evidence private under the repository information policy. Local runtime tests do not reproduce Cloudflare's distributed durability latency. Do not enable production or close #1273 without provider rehearsal evidence and a separately reviewed guarded rollout. If the candidate cannot improve latency with acceptable fairness, leave production on per-request durability.

References: [Cloudflare output gates](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/) and [storage lifecycle](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/).
