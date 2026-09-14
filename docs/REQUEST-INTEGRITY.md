# Request and identity integrity

Reviewed 2026-09-14. Backend changes require deployment after migration 0013; merging code does not deploy Neon Functions.

## Implemented protections

- Both legacy and growth APIs use `worker/request-json.mjs`: JSON objects only, valid UTF-8, at most 128 KiB measured while streaming, with explicit 400/413/415 responses. Session creation validates before token/identity work; invalid bodies no longer silently create guests.
- Analytics submission requires a signed guest/player token. Browser submissions cannot create server-owned account, public-profile, achievement or Draft Run start/completion milestones. Legacy browser events such as `game_start`, `daily_completed` and `challenge_complete` remain descriptive client observations; they are not proof of scoring or unique humans. Authoritative results remain in `scores` and `game_results`.
- Atomic database counters limit a player to 300 accepted analytics events per minute, 60 legacy career-result submissions per ten minutes, and 30 new Draft Run/Cube sessions per ten minutes. A resumed Daily returns before consuming a creation limit. Answering/resuming existing games remains available. Counters reuse one row per player/scope, work across function instances, reset after their window and return HTTP 429 with `Retry-After`.
- Production CORS excludes localhost by default. An isolated local-development function may set `PACK1_ALLOW_LOCALHOST=1`; production should leave it unset. CORS is a browser policy, not authentication or an abuse firewall.
- Growth JSON responses use `Cache-Control: no-store`; unexpected legacy database errors return a generic error. Fresh legacy signing-key initialization uses cryptographic random bytes, preserving any existing key.
- One `game-date.mjs` implementation owns Eastern dates for frontend, Today, both backend modules and legacy aliases. Misnamed UTC callers are removed; DST and midnight regression cases cover every entry point.
- Today refreshes on a completed result, return to the page and a date change. Old asynchronous results cannot overwrite newer state. Today and Profile subscribe to the common rendering lifecycle, now included in the architecture gate.

## Remaining ingress and account work

These limits do **not** stop a caller creating many new guest identities. `/v1/session` still needs a trusted IP/edge quota, and expensive public health/reporting endpoints need ingress protection. Determine which proxy overwrites the client IP header, block direct-origin bypass, and verify spoofed headers before enforcing a quota. Do not trust arbitrary `X-Forwarded-For` or claim a function-local memory counter protects a serverless deployment. No new infrastructure, guessed proxy header or opaque challenge has been enabled.

Guest leaderboards identify devices/accounts, not verified humans. Optional account claiming alone cannot prevent multiple-account answer harvesting. Keep guest access while deciding whether competition warrants a separate verified board and what verification actually means. Never seed simulated scores as players or treat duplicate display names as verified identities.

Tokens still live in localStorage and player tokens remain long lived. Consolidated escaping reduces drift but is not an XSS or revocation solution. A first-party HttpOnly cookie requires a compatible first-party API/auth proxy and a reviewed CSRF/session/revocation flow: the current Pages frontend and Neon API/Auth hosts are different sites. Do not switch to SameSite cookies without verifying cross-site browser behavior. The API is not a place to store account credentials in GitHub.

The release gate uses an expiring isolated Neon branch for concurrency, quota expiry, spoofed milestone and response-header tests. Its parent can lag merged code: the gate therefore explicitly replays the additive, idempotent release backlog (0012, 0013 and 0014), plus newly added PR migrations. Keep that list synchronized until the parent is promoted; never assume a Git merge updates the database or blindly replay historical migrations. This setup modifies only the disposable CI branch.

Apply migrations 0012 and 0013 in order and deploy all affected functions in development before production. Existing counters can remain during a function rollback. Trusted edge configuration and real-device authentication/sharing require access beyond the repository workflow.
