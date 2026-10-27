# Durable quota reservation preview

Related investigation: #1273. This is an isolated experiment, not a production rollout or a resolution claim.

Cloudflare's output gates hold outgoing responses until pending writes are durable. Removing `storage.sync()` does not eliminate that obligation. This candidate reduces writes instead, retaining normal output gates and the existing five-second gateway deadline and retry policy.

## Invariants and tradeoff

The persisted `buckets` row records an upper bound on consumed quota: admitted calls plus unused reserved credit. An instance reserves at most eight request credits, eight burst credits and two session credits, bounded by each window's remaining headroom. It consumes only those credits. Request, burst and session caps and fixed-window periods are unchanged. `/session-only` still avoids charging a previously charged request twice.

All candidate fetches and cleanup alarms share one queue, held through transaction completion and `sync()`. Storage callback retries publish no instance state. A failed operation discards all instance credits before the next queued operation. Rejected mixed requests neither write partial reservations nor consume their other available credits. Expired credits cannot be reused. Legacy rows remain authoritative. Malformed persisted counters fail closed.

After an acknowledged admission, eviction can forfeit up to seven unused credits from each request bucket and one session credit. Failed or lost acknowledgements may forfeit an entire new reservation. Repeated restarts can therefore cause earlier 429s; this is an explicit fairness cost, not an exact admission-equivalence claim. Rollback is safe because the old per-request implementation treats the reserved counts as spent. No counter reset or schema migration is needed.

## Automated checks

The gateway runtime workflow exercises both modes in real workerd with SQLite: simultaneous request/session caps, mixed refresh/creation calls, restart persistence, legacy denial, active-window cleanup and deletion. Unit tests additionally cover delayed/failed acknowledgement, queued concurrency, callback retries, exact window boundaries, rollback, corrupt state, 100 shared-network players completing paced gameplay, and generated mixed traffic with evictions against an independent model of the original limits.

At a fixed clock, 600 admitted request-only calls require 75 counter writes in the candidate versus 600 in the baseline; the initial cleanup alarm is one additional write in either mode. This is a controlled algorithm test, not a provider latency or billing measurement. Window expiration and mixed traffic cause additional replenishments.

## Isolated provider rehearsal

Run **isolated distributed launch acceptance** on the reviewed candidate revision, first with `quota_reservations` false and then true, using the same capacity target and existing policy. Both defaults are false. The input reaches only the disposable preview deployment. Activation also requires `MODE=preview`, an isolated branch ID, and the exact `preview-v1` switch. Production and the shared development branch are explicitly excluded. The checked-in Wrangler configuration does not enable it.

Keep the existing source checks, resource ownership lock, usage budgets, expiry, cleanup, unsampled client records, retained telemetry checks and failure thresholds. Do not reset counters between stages or relax a failed gate. Include the shared-NAT scenario and restart/quiet-traffic scenarios before proposing rollout.

Compare equivalent traffic across runs:

- Admitted requests, all 429s, 5xx and client timeouts; any candidate-only denial in the ordinary shared-network workload fails acceptance.
- Client and gateway quota p50/p95/p99, counts above one second, and existing gameplay latency limits. Repeated runs must improve the durability tail without moving the delay into queueing or increasing errors.
- Durable Object handler records: `quota_mode`, `reservation_write`, `transaction_callbacks`, `queue_ms` and `durability_ms`. Count counter writes from confirmed reservation writes; report sample coverage, failures, alarms and retries separately. `reservation_write` on an unconfirmed failure only indicates an attempted reservation, not proven durability. Handler elapsed time includes queue wait.
- Conservative denial under eviction: verify the documented forfeiture bound, quantify restart frequency, and record any shared-network impact.

Keep raw logs and detailed provider evidence private under the repository information policy. Local runtime tests do not reproduce Cloudflare's distributed durability latency. Do not enable production or close #1273 without provider rehearsal evidence and a separately reviewed guarded rollout. If the candidate cannot improve latency with acceptable fairness, leave production on per-request durability.

References: [Cloudflare output gates](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/) and [storage lifecycle](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/).
