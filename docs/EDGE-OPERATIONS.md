# Gateway operations and rollout

Prepared 2026-09-16. This is a **private development preview**, not a production migration. Merging its code does not enable origin protection on existing functions or switch the public frontend.

## What the inventory established

The [successful Cloudflare audit](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/35045006615) found an active zone, four unproxied apex A records, an unproxied `www` CNAME to GitHub Pages, a proxied `data` CNAME to Cloudflare and no Worker routes. That inventory did not cover Worker custom domains, TLS, WAF or redirects. The [audit snapshot](audits/edge-inventory-2026-09-16.json) also records the sanitized Neon function inventory.

| Browser traffic | Current destination | Proposed preview path |
|---|---|---|
| Legacy scores/challenges | `pack1api` on the production Neon branch | `/legacy/v1/…` |
| Guest identity, profile, account linking, analytics | `pack1growth` on the production Neon branch | `/growth/v1/…` |
| Daily, mixed and Cube runs | `draftrunapi` on the production Neon branch | `/draft/v1/…` |
| Email signup/signin | Neon Auth URL embedded in `growth-api.mjs` | Not proxied in this release |
| Replay/static files | Pages and `data.packone.pro` | Unchanged |

The first three URLs come from `leaderboard-config.js`. Browser bearer and Neon Auth session tokens are still stored in localStorage. Changing the website's DNS proxy flag would not move those API calls behind Cloudflare.

Neon lists 17 function names on each existing branch; only three are declared in `.github/neon-functions.txt`. The other 14 names are not referenced in repository source. Their deployed code and authorization have **not** been verified. Do not call their URLs to discover their behavior: a historical utility may perform work on GET. Do not delete them based on their names. Obtain a deployment-source inventory and usage evidence, classify each, then retire or protect it through a separate reviewed change. This is a production cutover gate.

## Implemented preview boundary

- Worker `pack1-gateway-preview`, fixed custom domain `api-preview.packone.pro`. Its config disables `workers.dev` and preview URLs. The controller never changes apex, `www`, `data`, the public frontend, existing Neon branches or managed Auth.
- Each deployment creates a new branch from development, with a 24-hour expiry and 60-second compute suspend. It deploys the exact main revision, checks schema readiness and refuses an existing branch or unexpected inherited function names. Failed/unused preview branches expire automatically.
- The workflow generates three independent random keys: origin authentication, preview access and quota hashing. They are masked and used only in the runner and service secret stores; no key is checked into Git, returned in reports or uploaded as an artifact. A new deployment replaces these preview keys.
- All three Neon handlers support `PACK1_REQUIRE_INGRESS=1` and a 64-character random hex `PACK1_INGRESS_SECRET`. In that mode they reject every unauthenticated request before routing or database work, including health, preflight, import and admin URLs. Missing/partial configuration fails closed. Existing deployments with both variables absent retain their current behavior.
- The gateway accepts only fixed player API routes. It does not expose admin/import routes, the full corpus health scan, or Neon Auth. No caller can supply a target URL. Redirects are not followed. Bodies retain the 128 KiB streaming JSON-object limit. Only selected response headers are relayed; cookies are not bridged.
- Preview requests require the workflow-generated preview key. The gateway overwrites the origin authentication header and omits cookies and forwarded-IP headers upstream. Network quotas use Cloudflare's `CF-Connecting-IP`, never `X-Forwarded-For`. IPv6 addresses are grouped by /64, then HMAC-hashed before selecting a Durable Object. No raw address is stored in the object or logged by this code.
- One globally addressed SQLite-backed Durable Object per hashed network enforces 120 requests/minute and a separate 10 guest-creation attempts/10 minutes shared across all three APIs. Transactions arbitrate concurrent requests; failures close the gateway. Invalid session bodies count before validation but do not create identities. Normal play has a separate budget. An alarm clears idle counters after 11 minutes. These are preview settings, not evidence that the same limits are fair for production shared networks.
- Quotas are an abuse control, not proof of one human per identity, a botnet defense or a spending cap. Cloudflare service limits and request charges can still apply. No plan upgrade is automated.

## One-time owner setup

Keep the existing read-only `CLOUDFLARE_AUDIT_TOKEN`. Create a separate token for operations:

1. Open [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token** → **Create Custom Token**. Name it `Pack One GitHub gateway operations`.
2. Add **Account → Workers Scripts → Edit**. Under account resources, include only the account containing `packone.pro`.
3. Add **Zone → Zone → Read** and **Zone → DNS → Read**. Under zone resources, include only `packone.pro`.
4. Choose an expiry appropriate for ongoing operations, for example 90 days, and create the token. Record its expiry for rotation. Do not add billing, membership, global account administration, broad DNS edit or R2 permissions.
5. Open [repository Actions secrets](https://github.com/killjoy00/mtg-ev-analyzer/settings/secrets/actions) → **New repository secret**. Name it **`CLOUDFLARE_EDGE_TOKEN`**, paste the token as the value, and save.
6. Tell the assistant the secret is saved. No token or workflow click is needed in chat. The existing `NEON_API_KEY` is used by the runner; no additional Neon credential is requested.

Cloudflare's standard Workers Scripts edit permission is account-scoped, not restricted to one Worker. The workflow limits its own writes to this preview Worker and hostname, but that code boundary is narrower than the token's underlying authority. The owner can revoke or rotate the token at any time. The account identifier is discovered from the selected zone, so it need not be supplied separately.

The [custom-domain attachment API](https://developers.cloudflare.com/api/python/resources/workers/subresources/domains/methods/update/) accepts Workers Scripts Write. [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) create their own DNS/certificate association, so this controller does not request general DNS edit permission. It first checks for existing DNS and domain ownership and refuses conflicting records. API errors fail without printing raw credential-bearing responses. If an account policy requires another permission, report the actual denied operation before expanding scope.

## Operations through reviewed PRs

Change `.github/edge-preview-request.json` through a reviewed PR. `operation` must be one of:

| Operation | Effect |
|---|---|
| `check-access` | Read scoped Cloudflare configuration and check hostname/Worker ownership. No provisioning. |
| `deploy-preview` | Create an expiring Neon branch, deploy guarded origins and the private gateway, then run live acceptance. |
| `disable-preview` | Remove only this Worker's verified preview custom-domain attachment. Keep backend guards enabled. |

Also change the human-readable `reason` for a new request. Merging that exact file into `main` triggers **operate private gateway preview**. Ordinary merges do not deploy. Manual dispatch remains optional. The workflow has read-only GitHub permissions and no PR-secret execution path. The controller accepts no arbitrary command, URL, branch or production target from the request. Keep the workflow/controller at a reviewed revision.

The initial checked-in request is `check-access`. A missing operations token intentionally fails before provisioning. After setup, the assistant can rerun the failed job or merge another request itself. Never change a failed gate to green merely to continue.

## Verification and recovery

Local handler tests cover missing/forged origin credentials, partial configuration, allowed routes, fixed upstreams, spoofed forwarding headers, oversized bodies, redirects, CORS and IPv6 grouping. The separate **gateway runtime tests** job builds the Worker, tests concurrent quota enforcement and persistence across Miniflare/workerd restarts, and runs Wrangler's deployment dry run. Backend changes also run the existing isolated SQL/gameplay gate.

After deployment, live acceptance verifies all three origin rejections and release markers, private preview access, full corpus health using the private origin credential, mixed/Cube eight-pick practice, rerolls, completion retries, scoring, friend challenges and an edge creation quota under changed forwarding headers. It writes no ranked result. New domain TLS has a bounded readiness wait. A failed acceptance is not a successful release.

If preview deployment or acceptance fails, production is unaffected. Fix forward through another reviewed request, or use `disable-preview`; do not reopen the origin as a workaround. A new deployment rotates the preview keys, and in-flight preview requests can fail during rotation. Previous branches expire within a day. The Worker and its private URL can remain configured after database expiry but will fail rather than fall back to production. Rebuilding a preview is a new PR request. SQLite migrations need a new migration tag; do not delete/recreate durable namespaces to hide a failure.

## Production and cookie migration gates

The preview deliberately has no production mode. The next reviewed release must resolve all of the following before changing public traffic:

1. Account for the 14 other deployed function names, inspect custom domains and prove there is no alternate API entry point. Inventory failed/inactive versions separately from active functions.
2. Pass live preview acceptance with the new token; test latency, shared-network limits, mobile Safari, resume and account flows. Local/runtime tests do not establish Internet routing or TLS behavior.
3. Add a production deployment plan with a fixed production hostname, pinned revision, controlled key rotation and tested rollback. Update operational imports, admin callers, health probes, release acceptance and image-refresh guards to authenticate at their intended ingress. Current production jobs expect direct public function URLs and would fail if the guard were enabled prematurely.
4. Publish a compatible frontend using first-party API URLs before enforcing origin closure. Test cached older clients, preserve existing runs/identities and provide a recoverable upgrade path. Keep production data changes additive; do not reset accounts or score history.
5. Implement browser sessions as host-only `__Host-` Secure, HttpOnly cookies on the API host, with `credentials: include`, exact-origin credentialed CORS and explicit CSRF protection for writes. The Pages mirror is cross-site; decide and test its redirect/canonical-host behavior rather than relaxing cookie protections.
6. Use random opaque session identifiers with only hashes in a database session table, expiry, revocation and rotation on sign-in/account linking. Logout must invalidate the server session as well as the browser cookie. Stop returning bearer/auth tokens in JSON. A one-time, origin/CSRF-protected migration may exchange an existing token and clear localStorage only after confirmation; test failures and retries without account loss.
7. Review Neon Auth's first-party proxy/trusted-domain and callback requirements before sending passwords or rewriting its cookies. The gateway in this release does not handle passwords or pretend that relaying a cookie automatically migrates authentication.

HttpOnly reduces token theft through JavaScript; it does not cure XSS or CSRF. Production cookie work and revocation remain outstanding. Trophy picks still earn 100; game modes, eight-pick flow and Daily selection policy are unchanged.

References: [Durable Object transactions and alarms](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [runtime testing](https://developers.cloudflare.com/workers/testing/miniflare/storage/durable-objects/), [Neon deployment environment variables](https://neon.com/docs/compute/functions/environment-variables), [request integrity](REQUEST-INTEGRITY.md), [release controls](BACKEND-RELIABILITY.md).
