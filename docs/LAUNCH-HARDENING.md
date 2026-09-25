# Launch hardening (#527)

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

## Remaining launch gates

The revised issue #527 tracks shared-network burst/sustained budgets, persistent
quota identity across routine deployments, telemetry/alerts, isolated distributed
and NAT load tests, public-cache policy, query capacity, bounded overload
behavior and the final incident runbook. This document is an implementation
note, not a completed launch-capacity report. #516 separately owns consistent
practice selection caching and before/after timing evidence.
