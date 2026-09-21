# Pack One recovery email delivery

Status: implementation candidate. Production Auth webhook remains disabled.

## Objective

Managed Neon remains the recovery-token issuer, Auth database owner, and password-reset authority. Pack One takes over only recovery email delivery so user-visible email content and reset links are Pack One-owned.

## Phase 0 live evidence

The separate Pack One Auth QA project proved the deployed Managed Neon behavior:

- password recovery emits `send.magic_link`;
- `X-Neon-Signature`, `X-Neon-Signature-Kid`, `X-Neon-Timestamp`, `X-Neon-Event-Type`, `X-Neon-Event-Id`, and `X-Neon-Delivery-Attempt` are present;
- the payload event is `send.magic_link` with `event_data.link_type = "forget-password"`;
- the payload exposes the raw recovery token;
- the webhook token SHA-256 exactly matched the token portion of the newly created `neon_auth.verification.identifier = 'reset-password:' + token` row;
- the detached Ed25519 JWS verified against the QA Auth JWKS using the exact raw request bytes;
- the observed successful delivery was attempt 1;
- while the webhook was enabled, no corresponding managed QA recovery email appeared through the existing SMTP path.

The QA webhook has been disabled again after the probe.

## Architecture deviation from the original handoff

The original handoff proposed a dedicated Neon Function. Live Managed Neon configuration rejected webhook URLs on Neon infrastructure with:

`Cannot use Neon infrastructure domains`

That contradicts the proposed hosting location, not the security boundary or product design.

The persistent receiver is therefore a dedicated Cloudflare Worker:

- QA service: `pack1-authhook-qa`
- production service: `pack1-authhook`
- server-to-server `workers.dev` endpoint
- not routed through `api.packone.pro`
- no change to `edge/gateway.mjs`
- no browser CORS, cookies, CSRF, Pack One session, or ingress secret

The Neon Auth signature is the webhook authentication boundary.

## Handler contract

The Worker allows only:

- `POST /webhook`
- `GET /health?quick=1`

For webhook requests it:

1. enforces a 64 KiB body limit;
2. preserves exact raw bytes;
3. validates timestamp freshness;
4. selects the JWKS key by `kid`, caches it, and refetches on failed verification;
5. verifies the detached Ed25519 JWS over the exact raw request bytes;
6. parses JSON only after verification;
7. accepts only `send.magic_link` + `forget-password`;
8. requires the header and payload event IDs to match;
9. hands the event to a per-event Durable Object;
10. sends through Resend with the Neon event ID as the namespaced idempotency key;
11. stores only the successful provider message ID and send timestamp for server-side dedupe;
12. returns 2xx for successful or duplicate delivery.

Raw recovery tokens, signatures, and recipient addresses are never logged.

## Email

Production sender is fixed server-side:

`Pack One <accounts@packone.pro>`

Production subject remains:

`Reset Your Password - Pack One`

Production reset URL:

`https://packone.pro/reset-password/#token=<raw-token>`

The email contains no visible Neon hostname or Neon footer. The copy/paste fallback is the same Pack One fragment URL.

QA uses the existing QA sender and localhost reset destination so the separate QA Auth token is never confused with production Auth.

## Reset-page rollback compatibility

The reset page permanently supports both:

- Pack One fragment: `#token=<token>`
- managed-email fallback query: `?token=<token>`

Fragment wins if both are present. The page immediately removes query and fragment material with `history.replaceState` and keeps the token only in memory.

## Release discipline

QA uses `.github/auth-webhook-request.json` and the dedicated QA release workflow. The QA workflow cannot deploy production.

Production integration into the secure-auth release workflow is intentionally deferred until these QA gates are complete:

1. Pack One email delivery through Resend;
2. real reset completion;
3. cold/warm latency measurement;
4. forced-failure retry measurement;
5. duplicate suppression;
6. managed-email fallback after disabling the QA webhook.

Production Managed Neon email remains the active recovery path until final production webhook enablement.
