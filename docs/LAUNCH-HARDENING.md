# Launch hardening (#527)

Final measurements, supported capacity and release evidence are maintained in
[the #516/#527 acceptance report](reports/PRACTICE-LAUNCH-CLOSEOUT-2026-09-26.md).
The first-increment notes below describe the original rollout sequence.

## First increment: verified session refresh

Cookie presence no longer authorizes the session-quota exemption. A browser
with a player cookie is sent to the origin's read-only
`POST /internal/player-session-refresh` endpoint. A verified existing player
gets the same refresh response in one upstream request. The route does not
create a player, update a nickname or issue cookies.

Only an origin response of `401` with `x-pack1-session-state: missing` permits
the gateway to consume the session-creation bucket and make one creation call.
Malformed/forged tokens and tombstoned players take that path. Requests without
a cookie are charged before their ordinary creation call. The Durable Object's
`/session-only` operation charges the delayed creation without charging the
general request bucket a second time. It is not a public gateway route.

An origin error, timeout, unmarked 401 or missing endpoint never permits
creation. No automatic retries are introduced. The two origin calls, when
needed, share the existing 120-second deadline. The internal marker is stripped
from public responses and client-supplied markers are never forwarded.

Quota responses retain `error` and `Retry-After`, and add
`code: network_rate_limited` and `scopes: [request]`, `[session]` or both.
Credentialed CORS exposes `Retry-After` so a browser can read it. This increment
does not change the 120/minute or 10/10-minute thresholds and does not establish
that they are suitable for a launch or shared Wi-Fi.

## Release and rollback order

1. Pass unit, real Workers-runtime, and isolated SQL-backed session tests.
2. Deploy the reviewed growth backend with the refresh endpoint before deploying
   the gateway. Existing gateways remain compatible with the new backend.
3. Verify the same release SHA and refresh/create behavior in the isolated
   preview, then use the existing reviewed release process. The production
   gateway smoke checks that refreshing a cookie preserves the player ID.
4. If rolling back the backend, roll back the gateway first. A new gateway with
   an older backend fails closed with 404 for cookie refreshes; it does not
   fall back to creating uncharged identities. Rolling back the gateway restores
   the old exemption bug, so keep that interval short and treat it as a security
   regression, not a normal operating configuration.

No database migration or token rotation is needed for this increment.

## Launch acceptance record

The acceptance report records shared-network burst/sustained budgets, persistent
quota identity across routine deployments, telemetry/alerts, isolated distributed
and NAT load tests, public-read plans and the supported capacity limit. The
[incident runbook](LAUNCH-OPERATIONS.md) covers production response. #516 owns
consistent practice selection caching and its separate SQL/browser evidence.

## Quota identity and minimum gateway telemetry

Routine production deploys retain the existing `QUOTA_KEY` secret. Only the first
installation generates it. The controller rejects a non-secret binding and
verifies the secret still exists after upload. Rotation is a separate incident
operation: it resets both Durable Object network identities and authenticated
credential-network digests, so never rotate to work around ordinary NAT pressure.

Workers Logs stores structured `gateway_request` events. Invocation logs are
disabled. The application emits fixed route families, method, release SHA,
response/upstream status, request/quota/upstream milliseconds, upstream call
count, quota scope and coarse exception class. It does not emit headers, tokens,
body, query string, run/player IDs, IPs or network digests. Successful requests
are sampled at 10%; errors at 100%. Each event contains `sample_rate`; weight
counts by its reciprocal. Provider logging limits may apply additional sampling.

In Cloudflare → Workers → pack1-gateway → Observability → Query Builder, filter
`event = gateway_request` and the release SHA. Group by route/status/quota_scope;
compare p95/p99 of duration_ms with upstream_ms and quota_ms. High quota latency
with no origin calls points to ingress; high upstream latency points downstream.
A request deadline or failed response does not prove a mutation rolled back.
Use the existing run revision/idempotency recovery; never blindly replay writes.

The Durable Object call has a five-second caller deadline. Upstream requests
retain the existing shared 120-second deadline until isolated load evidence
supports a tighter policy. A caller abort does not promise server cancellation.

The Cloudflare configuration enables storage, but a successful dry run is not
proof that production logs/alerts are live. The reviewed release must verify
stored events and alert delivery. See the acceptance report for the tested
revision, retained release event and limits of the capacity claim.
