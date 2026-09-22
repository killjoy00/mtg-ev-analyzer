# Pack One email ownership verification

Status: **delivery implementation merged; production verification remains disabled pending migration and final QA acceptance**.

Issue: #246.

## Current production state

Production Managed Neon Auth remains unchanged:

- email/password auth: enabled;
- sign-up: enabled;
- verification method configured: `otp`;
- verify on sign-up: disabled;
- require email verification: disabled;
- custom email provider: Pack One / Resend;
- Google OAuth: unchanged.

No production verification flag is changed by the delivery implementation.

## Measured Managed Neon behavior

The behavior below was measured on disposable branches rather than inferred from upstream Better Auth documentation.

### OTP mode

With verification required and OTP selected:

- signup returned HTTP 200;
- the user was created unverified;
- no authenticated session was returned;
- sign-in before verification returned HTTP 403;
- Neon persisted one verification record with identifier shape `email-verification-otp-<email>`;
- the credential was unexpired;
- no subscribed `send.otp` / `send.magic_link` webhook event was observed in that probe.

### Link mode

Neon documents that verification links require a custom email provider. A disposable child of production inherited the Pack One custom Resend SMTP configuration and accepted link mode.

Measured link behavior:

- signup returned HTTP 200;
- the user was created unverified;
- no authenticated session was returned;
- sign-in before verification returned HTTP 403;
- Neon emitted a signed `send.magic_link` event;
- `event_data.link_type` was exactly `email-verification`;
- the signed payload contained `link_url`, `token`, and `expires_at`;
- detached Ed25519 signature verification succeeded against the branch JWKS;
- the verification link host was the disposable branch's Managed Neon Auth host;
- link mode did not create the OTP-style `neon_auth.verification` row;
- the disposable branch's email/password and webhook settings were restored after the probe.

Production itself was not targeted.

## Existing-account impact

A read-only production query on 2026-09-22 found:

- credential accounts: **4**;
- verified credential users: **0**;
- unverified credential users: **4**.

A disposable production-child acceptance test then created an unverified credential account while verification was disabled. That account signed in successfully with HTTP 200. After the same branch was switched to `require_email_verification=true`, the exact same account immediately received HTTP 403 at sign-in. Managed Neon therefore does **not** grandfather pre-existing unverified credential users when the requirement is enabled.

If production were flipped today, the four currently unverified credential accounts would be expected to be blocked on their next password sign-in. Production `require_email_verification` must remain disabled until those accounts are migrated/verified with an explicitly supported user flow.

## Target policy

Subject to the existing-account gate above, the intended Pack One policy is:

- new email/password accounts prove ownership before they can authenticate;
- verification is triggered immediately on password signup;
- verification uses a click-through link, not an OTP entry screen;
- the existing signup UI remains the verification-pending experience ("Check your email");
- Google OAuth remains independent and unchanged;
- existing password accounts are not retroactively locked out without an explicit, supported migration/grandfathering step;
- password recovery remains a separate `forget-password` flow.

## Delivery contract

The Pack One Auth webhook keeps password recovery and verification as separate explicit contracts.

For every request it still:

1. enforces the body-size and timestamp bounds;
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

The verification delivery boundary receives the validated `link_url` but not the separate raw token field. The email is Pack One branded and delivered through the same dedicated Resend credential, with a separate verification subject and idempotency namespace.

Other signed event/link types remain rejected and observable without logging credentials.

## Acceptance evidence boundaries

Pack One intentionally separates two kinds of verification evidence:

- **Delivered-email evidence:** a real delivered Pack One verification email has already been inspected through Resend, including branding and the delivered Neon `/verify-email` link shape. This is the evidence that the email content itself contains the expected verification link.
- **Automated CI evidence:** the disposable-branch acceptance should prove the signed Neon webhook is accepted, the already validated verification URL can be redeemed only after signup completes, `neon_auth.user.emailVerified` becomes true, and password sign-in succeeds afterward.

Automated CI must not be described as proof of mailbox contents unless it actually reads the delivered message. Resend API keys currently expose only `sending_access` or `full_access`; there is no read-only key scope. Pack One will not broaden the production send credential or add a full-access QA credential solely to make CI read messages. The safer acceptance design is a QA-only one-shot redemption seam that never returns or logs the stored verification URL/token.

## Production gate

Before enabling production verification, QA must prove end-to-end:

- Pack One verification email is delivered and branded correctly;
- the actual delivered link verifies a synthetic user;
- sign-in is 403 before verification and succeeds after verification;
- password recovery still sends and completes independently;
- Google OAuth remains unchanged;
- repeat/expired-link behavior is understood sufficiently for user-facing recovery/resend UX;
- pre-existing unverified credential-account behavior is measured and the grandfathering decision is documented;
- mobile Safari/WebKit signup state remains correct.

Until those gates pass, production stays on its current verification-disabled configuration.
