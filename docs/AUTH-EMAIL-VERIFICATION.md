# Pack One email ownership verification

Status: **complete and active in production**.

Issue #246 was closed on 2026-09-23 after the production required-verification policy, user migration, delivery path, resend/expired-link UX, WebKit coverage, recovery checks and post-release regressions all passed.

## Current production state

Production Managed Neon Auth:

- email/password auth: enabled;
- sign-up: enabled;
- verification method: `link`;
- verify on sign-up: enabled;
- require email verification: enabled;
- auto sign-in after successful verification: enabled;
- verify on sign-in: disabled;
- `allow_localhost: false`;
- custom email provider: Pack One / Resend;
- Google OAuth: unchanged.

Production trusted origins remain:

- `https://magic.planitnow.us`
- `https://packone.pro`
- `https://api.packone.pro`

The final secure Auth/backend release was verified at:

`d7dbaf89f391fd82b4f344285533aaee31f0fb0f`

The final production policy change merged as:

`7255252097787b28250a7458a709ee61d28037fd`

## Final Pack One policy

For email/password accounts:

- ownership verification is triggered immediately on sign-up;
- verification uses a click-through email link;
- an unverified password user cannot authenticate;
- successful verification returns the user to `https://packone.pro/?auth=verify`;
- verified users can then sign in normally;
- resend is available through Pack One's first-party account API;
- expired, invalid or already-consumed verification links have a Pack One recovery screen that can request a new link;
- verification links are presented to users as expiring after 15 minutes;
- password recovery remains a separate `forget-password` flow;
- Google OAuth remains independent of password email verification.

## Existing-account migration

Before the production requirement was enabled, production had exactly four credential/password users and all four were unverified.

Disposable production-child testing proved Managed Neon does **not** grandfather pre-existing unverified password accounts: an account that signed in with HTTP 200 before `require_email_verification=true` immediately received HTTP 403 afterward.

The owner confirmed the four existing password users. Before the policy flip, Pack One performed a one-time, owner-approved migration with hard pre/postcondition checks and a short-lived production-child checkpoint. The resulting production state was verified as:

- credential users: **4**;
- verified: **4**;
- unverified: **0**;
- linked non-credential providers: **0**.

This was an exceptional migration step for the existing population, not a reusable account-management interface. Normal product flows must not directly mutate Managed Neon Auth user/account/session rows.

## Measured Managed Neon behavior

The behavior below was measured on disposable branches rather than inferred from upstream Better Auth documentation.

### OTP mode

With verification required and OTP selected:

- signup returned HTTP 200;
- the user was created unverified;
- no authenticated session was returned;
- sign-in before verification returned HTTP 403;
- Neon persisted an OTP-style verification credential;
- the credential was unexpired;
- the subscribed verification webhook did not produce the useful delivery event needed for Pack One's desired UX.

OTP therefore was not selected for production.

### Link mode

With the Pack One custom email provider inherited by a disposable production child:

- signup returned HTTP 200;
- the user was created unverified;
- when verification was required, no authenticated session was returned;
- sign-in before verification returned HTTP 403;
- Neon emitted signed `send.magic_link`;
- `event_data.link_type` was exactly `email-verification`;
- the signed payload included `link_url`, `token` and `expires_at`;
- detached Ed25519 signature verification succeeded against the branch JWKS;
- the verification URL belonged to the disposable branch's Managed Neon Auth base.

### Independent flags

The two verification controls were measured independently.

With link verification sent on sign-up but `require_email_verification=false`:

- signup returned HTTP 200 with a session;
- the account remained unverified;
- password sign-in returned HTTP 200 with a session;
- the signed verification event was still emitted.

That result supported the temporary Phase 1 rollout, which exercised real production delivery without locking out existing accounts.

After the four-user migration and full acceptance, Phase 2 changed only `require_email_verification: false -> true`.

## Delivery contract

The Pack One Auth webhook keeps password recovery and email verification as separate explicit contracts.

For every signed event it:

1. enforces body-size and timestamp bounds;
2. verifies the detached Ed25519 Neon signature over the exact raw bytes;
3. validates header/payload event IDs;
4. rejects unrecognized signed event shapes.

Password recovery accepts only:

- `event_type = send.magic_link`;
- `link_type = forget-password`.

Email verification accepts only:

- `event_type = send.magic_link`;
- `link_type = email-verification`;
- a valid recipient email;
- an expiry timestamp;
- an HTTPS `link_url` whose origin and path remain under the configured Neon Auth base.

The verification delivery boundary receives the validated `link_url` but not the separate raw token field. Verification and recovery have separate copy and idempotency namespaces. Verification email copy says **verification link**; recovery copy continues to say **reset link**.

Other signed event/link types remain rejected and observable without logging credentials.

## Resend and expired-link UX

Pack One exposes verification resend through the first-party account API rather than directly from the browser to Neon.

The resend endpoint:

- uses the fixed Pack One verification callback;
- returns a generic public response so it does not disclose account existence;
- uses a dedicated HMAC-hashed rate-limit namespace;
- rejects hostile browser-supplied callback destinations;
- preserves the same trusted-origin boundary as the account API.

The client supports:

- resend from the verification-pending sign-up state;
- resend after an expired/invalid verification return;
- `?auth=verify` success and error handling;
- removal of verification/error query parameters after handling the return.

The focused Chromium + WebKit mobile verification contract covers the pending state, resend, expired-link recovery and successful return.

## Acceptance evidence

Delivered-email evidence and automated acceptance are intentionally distinct.

A real Pack One verification email was inspected independently through Resend. It used Pack One branding and contained the expected Managed Neon `/verify-email` link.

Automated disposable acceptance proves the application/provider state transition without claiming that CI read mailbox contents. The QA Worker stores the already validated verification URL behind a per-run secret and exposes it only to the isolated acceptance runner; production has no such route.

Final required-mode disposable acceptance was run in GitHub Actions run **35798972501** and proved:

- the inherited Phase 1 baseline;
- legacy-account sign-in 200 before `require=true` and 403 afterward;
- required-mode signup creates a user with no session;
- verification resend returns HTTP 200;
- two signed `email-verification` deliveries are observed;
- the resent link redirects cleanly to Pack One;
- reusing the consumed link is rejected;
- the verified user reaches `emailVerified=true`;
- post-verification sign-in returns HTTP 200 with a session;
- password-reset request returns HTTP 200;
- the independent `forget-password` delivery remains functional;
- original disposable Auth/webhook config is restored;
- the temporary Worker and disposable branch are removed.

## Production release and final checks

The final secure release workflow was GitHub Actions run **35803802418**. It successfully:

- deployed the exact reviewed backend revision to production;
- deployed the dedicated production Auth webhook Worker;
- deployed the fixed first-party gateway;
- verified the live secure gateway;
- verified Google OAuth start;
- verified the Auth webhook production release marker at exact revision `d7dbaf89f391fd82b4f344285533aaee31f0fb0f`.

The guarded Phase 2 policy workflow was run **35804229759**. Its logged delta was exactly:

- before: link verification on sign-up, `require_email_verification=false`;
- after: link verification on sign-up, `require_email_verification=true`.

Independent production readback matched the target and confirmed the four credential users remained verified.

Post-policy checks all passed:

- production smoke: run **35804229852**;
- full test: run **35804229822**;
- e2e: run **35804229803**;
- Pages deployment: run **35804229270**;
- account deletion maintenance: run **35804312429**.

## Operations after closeout

Canonical implementation/operations paths:

- delivery: `edge/auth-webhook.mjs`;
- first-party account backend: `worker/growth-function.js`;
- browser account UX: `growth.mjs`;
- verification QA workflow: `.github/workflows/auth-verification-qa.yml`;
- verification QA runner: `scripts/auth-verification-qa-acceptance-v2.mjs`;
- production policy controller: `scripts/auth-email-verification-policy.mjs`;
- policy workflow: `.github/workflows/auth-email-verification-policy.yml`.

The verification QA workflow supports reviewed push requests and `workflow_dispatch`, so environmental retries do not require another code change. Temporary QA branches must be disposable children with expiry and must never target production or the serving development branch.

The checked-in request JSON files are retained as records of the last reviewed operations; they are not declarations that those disposable branches still exist.

Future verification-policy changes should be new reviewed changes with fresh production release markers and current population checks. Do not loosen required verification, change Google OAuth, alter the Resend sender, or reuse a stale production-policy request merely to work around a failed test.
