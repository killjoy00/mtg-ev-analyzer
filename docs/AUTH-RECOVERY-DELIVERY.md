# Pack One recovery email delivery

Status: **production active**. Managed Neon remains the recovery-token issuer, Auth database owner, and password-reset authority. Pack One owns recovery email delivery and user-visible reset links.

## Production state

Production Neon Auth branch:

- project: `patient-shadow-91417882`
- branch: `br-orange-feather-ayps8kep` (`main`)
- Auth base: `https://ep-hidden-bonus-ayfmcpys.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth`

Production recovery receiver:

- service: `pack1-authhook`
- webhook: `https://pack1-authhook.killjoy00.workers.dev/webhook`
- health: `https://pack1-authhook.killjoy00.workers.dev/health?quick=1`
- sender: `Pack One <accounts@packone.pro>`
- subject: `Reset Your Password - Pack One`
- header brand: inline email-safe `P¹` Pack One mark matching the site header; no remote image dependency
- reset URL: `https://packone.pro/reset-password/#token=<raw-token>`

Production Neon Auth webhook configuration is fixed to:

- enabled: `true`
- URL: `https://pack1-authhook.killjoy00.workers.dev/webhook`
- events: `send.magic_link` only
- timeout: 5 seconds
- `send.otp`: not enabled

The configuration is managed by the reviewed main-only workflow `.github/workflows/production-auth-webhook-config.yml`. Its request file is `.github/production-auth-webhook-config-request.json`.

## Architecture

Managed Neon issues and redeems the recovery credential. Pack One never replaces the Auth database or reset authority.

The persistent receiver is a dedicated Cloudflare Worker because Managed Neon rejects Neon-infrastructure webhook destinations. The production receiver is intentionally separate from `api.packone.pro` and `edge/gateway.mjs`.

The Worker allows only:

- `POST /webhook`
- `GET /health?quick=1`

For webhook requests it:

1. enforces a 64 KiB body limit;
2. preserves exact raw bytes;
3. validates the Neon timestamp freshness window;
4. selects the JWKS key by `kid`, caches it, and refetches on failed verification;
5. requires protected JWS `alg = EdDSA` and a matching `kid`;
6. verifies the detached Ed25519 JWS over the exact raw request bytes;
7. parses JSON only after signature verification;
8. accepts only `send.magic_link` with `event_data.link_type = "forget-password"`;
9. requires payload/header event IDs to match;
10. hands the event to a per-event Durable Object;
11. sends through Resend with a namespaced Neon event-ID idempotency key;
12. stores only the successful provider message ID and send timestamp for duplicate suppression;
13. returns 2xx for successful or already-delivered events.

Raw recovery tokens, signatures, recipient addresses, and credentials are not logged.

## Failure observability and alerting

Production Workers observability is enabled for `pack1-authhook`. The structured `pack1_authhook_timing` record now covers three failure classes that require operator attention:

- `invalid_signature`: signature/timestamp/JWKS verification failed;
- `delivery_failure`: a verified recovery event could not be delivered through the dedupe/Resend boundary;
- `rejected_event`: the request was signature-verified and parsed, but its signed event shape was not accepted by the recovery-only contract.

`rejected_event` records include only bounded `event_type` and `link_type` values, delivery attempt, and timings. Tokens, email addresses, signatures, and raw payloads are not logged. In QA the same rejected-event details are also written to the existing hashed-event telemetry store, so event-taxonomy probes can observe the signed `event_type` / `link_type` pair without exposing recovery credentials.

`.github/workflows/auth-webhook-alert.yml` polls Cloudflare Workers Observability every five minutes with a fifteen-minute lookback. It filters only the production `pack1-authhook` timing records above and deduplicates overlap by Cloudflare event ID. New failures are routed to an open GitHub issue titled `[authhook alert] Production recovery webhook failure`, assigned to the repository owner; if that issue has been closed, the next failure creates a new assigned issue. The workflow never copies raw Worker log payloads into GitHub.

The alert query uses Cloudflare's supported Workers Observability telemetry API. The working production token has passed the live query. In Cloudflare's legacy custom-token UI the writable permission is shown as **Account → Workers Observability → Edit**; Cloudflare's API reference may describe the corresponding capability as `Workers Observability Write`. Pull requests run the same retained-log query in check-only mode so a missing permission fails before merge instead of silently disabling the alert.

## Live QA evidence

The separate QA Auth project proved the provider contract before production activation:

- password recovery emits `send.magic_link`;
- all six expected `X-Neon-*` headers were observed;
- the payload event was `send.magic_link` with `link_type = "forget-password"`;
- the raw recovery token was present;
- the webhook token SHA-256 exactly matched the token portion of the contemporaneous `neon_auth.verification.identifier = 'reset-password:' + token` row;
- detached Ed25519 verification succeeded against the QA JWKS using the exact raw request body;
- enabling the webhook suppressed the managed QA recovery email;
- a real Pack One QA email was delivered through Resend with the Pack One fragment URL;
- the same token completed the password reset and sign-in with the new password;
- measured successful webhook totals included 456 ms and 617 ms for first/warm acceptance requests;
- post-send retry acceptance observed three attempts: one send plus two duplicate-safe retries, with totals 423 ms, 19 ms, and 21 ms;
- pre-send forced-failure acceptance observed three Managed Neon delivery attempts with no email send; totals were 151 ms, 0 ms, and 0 ms;
- disabling the QA webhook restored the managed Neon email path immediately, including its Neon-hosted recovery URL and Neon footer.

The QA webhook is disabled after acceptance. Temporary QA probe/helper functions, triggers, users, and recovery rows were removed.

## Production release and smoke evidence

The production recovery Worker is part of the secure-auth release workflow and is deployed from the exact reviewed release revision. The successful secure-auth release also passed the normal production gateway, credentialed CORS, player cookie, and Google OAuth start smoke.

The initial production smoke intentionally caught a configuration problem: the Worker was healthy, but the production Auth webhook API reported:

- enabled: `false`
- URL: empty
- events: empty
- timeout: 5 seconds

That explained why Managed Neon still sent its built-in recovery email.

The reviewed production webhook-config workflow then set and re-read the exact recovery-only configuration above.

The corrected production smoke passed:

- disposable production signup: HTTP 200;
- password-reset request: HTTP 200;
- signup time: 336 ms;
- reset-request time: 1299 ms;
- a production `neon_auth.verification` recovery row was created;
- the recovery-row token SHA-256 was `6dec9d07839275131231d2ae94c07940bce21a6dcc695f6e2dee93b8d5370fa4`;
- the token in the delivered Pack One email hashed to the exact same value;
- Resend reported the email delivered;
- sender was `Pack One <accounts@packone.pro>`;
- subject was `Reset Your Password - Pack One`;
- the email used only `https://packone.pro/reset-password/#token=...`;
- the email contained no Neon-hosted reset URL and no Neon Auth footer;
- no second managed-Neon email appeared for the corrected smoke.

The disposable production user and recovery row were removed after the smoke.

## Real email-client acceptance

A real production reset was requested for an existing production account and completed through Gmail on 2026-09-22.

Measured acceptance evidence:

- client: Gmail;
- observed delivered link shape: `https://packone.pro/reset-password/#token=<redacted>`;
- Gmail preserved the fragment through the actual email-client click/redirect chain;
- the Pack One reset page received the credential and the password reset completed successfully;
- no reset token contents were recorded in repository evidence.

Outlook was not tested because the owner does not use Outlook. This is recorded as unavailable coverage, not as a failed acceptance result.

The managed-Neon `?token=` fallback remains permanently supported regardless of this successful Gmail fragment proof.

## Reset-page rollback compatibility

The reset page permanently supports both:

- Pack One fragment: `#token=<token>`
- managed-email fallback query: `?token=<token>`

Fragment wins if both are present. The page immediately removes query and fragment material from the visible URL/history and keeps the token only in memory for the current attempt.

## Release and rollback

QA deployment/testing uses:

- `.github/auth-webhook-request.json`
- `.github/workflows/auth-webhook-release.yml`

Production Worker deployment is part of:

- `.github/workflows/secure-auth-release.yml`

Production webhook configuration uses:

- `.github/production-auth-webhook-config-request.json`
- `.github/workflows/production-auth-webhook-config.yml`

The production config workflow supports two fixed operations:

- `ensure-enabled`: require the exact recovery-only subscription;
- `disable`: disable the webhook while preserving the fixed URL/event/timeout contract.

Emergency rollback is therefore:

1. change the reviewed production config request operation to `disable`;
2. merge the request;
3. verify the workflow re-reads `enabled = false`;
4. Managed Neon resumes its existing SMTP recovery email path.

QA already proved that disabling the webhook restores the managed recovery path. The Pack One reset page retains the managed-token fallback permanently, so rollback does not require an application release.

## Related production Auth hardening

Production localhost-origin hardening is documented separately in [`AUTH-HARDENING.md`](AUTH-HARDENING.md). That runbook records the final `allow_localhost:false` production state, QA restore behavior, intended-origin verification, rollback logic, and disposable smoke-user cleanup.

## Security boundaries preserved

This work did **not** change:

- Managed Neon as token issuer/reset authority;
- custom SMTP/DKIM/SPF;
- Google OAuth identity/configuration;
- the first-party production gateway security model;
- session revocation behavior after reset;
- the existing raw-token redemption path in the growth function.

The recovery-email Resend credential is dedicated, sending-only, and restricted to the verified `packone.pro` domain.
