# Daily reminders: implementation and release controls

Tracks issue #1151 and PR #1247. This document describes the implementation and
release checks; it is not a production-deployment or delivery receipt.

**Once-daily email design (migration 0062).** Everyone who turns on email
reminders gets at most one email a day from a single Neon trigger,
`pack1-daily-reminders`, at 23:05 UTC (15:05 PST / 16:05 PDT). There is no
per-account day, time or timezone choice. The web Account settings page offers
only an email On/Off control and does not mention push. Push code (backend,
schema and the mobile app) is kept unchanged for the mobile launch and stays off
until its own approval; the daily job sends push only when the push channel is
switched on.

Earlier state: reviewed PRs #1247 and #1250 shipped migration 0061, the
gateway and default-off delivery on October 19, 2026. The protected release
does not by itself prove a real email arrives; acceptance evidence is listed
at the end of this document.

A dedicated Resend webhook exists for
`https://api.packone.pro/growth/v1/reminders/provider-event`, subscribed to
the four supported email events. The existing unrelated account webhook is
unchanged. The handler drops unrelated account-wide email events before writing
reminder metadata.

## Consent and schedule

Email and push consent are independent and default off. Web email goes only to
the authenticated account's verified address. Native push additionally requires
an explicit enable action on that installation and operating-system permission.
The account/settings mutation includes an expected account identifier so a
browser cookie or native session change cannot silently save account A's form
into account B. The identifier is compared with authenticated ownership, not used
as authorization.

The schedule is fixed in source (`DAILY_REMINDER_SCHEDULE` and
`DAILY_REMINDER_CRON` in `worker/daily-reminders.mjs`, matched by the
`pack1-daily-reminders` entry in `scripts/reconcile-neon-schedulers.mjs`).
Settings writes store that shared schedule and ignore any client schedule
fields. `nextAt` in the settings response is the next 23:05 UTC. To move the
send time, change both constants and the scheduler entry in one reviewed PR,
release, and re-run the scheduler enable.

Game identity and the all-three-completed check use the existing
America/Los_Angeles Daily date. 23:05 UTC is always mid-afternoon Pacific, well
inside one Pacific Daily.

## Daily email dispatch

The trigger calls `/internal/daily-reminders` once a day. A trigger delivered
more than three hours late does nothing. The job first runs housekeeping
(event reconciliation, push receipts, abandoned-send and expiry sweeps,
retention deletes), then, when email is active:

1. Selects accounts with email on, a verified Auth email, and no email delivery
   row for today's Pacific Daily (bounded to 5,000 per run).
2. Skips an account whose current email fingerprint differs from the address
   it consented with; a changed address needs a fresh opt-in.
3. Calls `pack1_reminder_admit_daily_email` (migration 0062) per account. Under
   the account lock shared with deletion and consent writes, it rechecks
   deletion state, today's Pacific date, current consent and address,
   suppression, an existing email row for today, and completion of all three
   Dailies. Completion is read from finished `draft_run_sessions` owned by a
   linked player or by the account itself, so unranked completed runs count.
   It inserts one `sending` delivery row, unique per account and Pacific Daily.
4. Sends admitted rows to Resend's batch endpoint, up to 100 emails per request,
   about 0.6 seconds apart, within a 90-second budget; accounts not reached are
   reported as `deferred` and are not retried that day.

Each batch has a stable idempotency key. An explicit 429 gets one bounded wait
(at most 30 seconds) and one identical retry; a second 429 or any other 4xx marks
the batch `failed`. A timeout, 5xx, or a response that cannot be matched to the
batch marks rows `uncertain`, never resent. A crash after admission leaves the row
`sending`, later swept to `uncertain`; that Daily is never sent twice. Email tags
carry the opaque delivery identifier for matching an event that arrives before
the provider identifier is saved.

Push keeps its 0061 per-device path (enqueue, atomic claim, one request per
device) and runs in the same daily job only when the push channel is active.

## Email events and unsubscribe

`/growth/v1/reminders/provider-event` receives authenticated Resend events for
`email.sent`, `email.delivered`, `email.bounced`, and `email.complained`.
Preserve the signed raw request bytes through the gateway. The handler validates
Svix identifiers, signatures, timestamp tolerance, payload bounds, and event
shape. It stores minimal durable event metadata before reconciliation. Raw email
bodies, raw addresses, credentials, and the complete inbound payload are not
stored in the reminder event table.

Each delivery captures a keyed destination digest. Suppression applies to that
actual destination, not the account's later email address. Old-destination
bounces or complaints cannot revoke a newer address's consent. A destination
change requires explicit email consent for the new address. Replayed and
out-of-order events preserve stable timestamps and adverse-event precedence.
Unmatched authenticated events can be reconciled later; a deleted account or
delivery must not be recreated by a delayed tagged event.

Email contains the homepage play URL, a My Pack One management link, and a signed
unsubscribe URL with one-click headers. GET shows a confirmation page without
mutating consent; POST disables only email. Ordinary settings or push edits do
not rotate the capability, and repeat POSTs are harmless. Preserve the existing
signing secret during routine deployments. A separate security-key rotation
requires a reviewed old-link verification/retirement policy; do not silently
rotate it as part of this feature.

States distinguish queued, sending, retry, accepted, delivered, suppressed,
uncertain, and failed. An authenticated delivery event is evidence of provider
reported email delivery, not proof that a person opened or read the email.
Native provider/platform receipts are never labeled proof of device display.

## Native installation lifecycle

The server issues an installation-binding secret. Only its hash is stored on the
server; the client retains the secret in secure device storage. Push tokens are
encrypted at rest. Registration uses authenticated account/session ownership,
installation proof, and version checks. Concurrent additions cannot exceed the
five-active-device cap. A stale rotation or receipt cannot take over another
account's device or revoke a newer registration.

Foreground refresh never requests OS permission and never silently enrolls an
installation. Local opt-out clears local consent before network cleanup. Logout
and account switching revoke the applicable registration. Account-wide push
opt-out revokes every device, including sleeping devices; explicitly enabling
one later does not resurrect its peers. Account/version checks guard foreground
presentation and notification taps from background and cold starts.

Provider-accepted notifications already in flight cannot be recalled reliably.
The payload is generic and short-lived (60-second TTL), and the app rejects stale
owner/version interactions. Physical-device tests must include this boundary;
do not promise that an OS-controlled notification already accepted by APNs/FCM
can be removed remotely after an account switch.

## Privacy and retention

Account deletion removes preferences, change history, dispatch claims, delivery
records, suppressions, and device registrations, and erases linked pending event
metadata. The cleanup path runs before external Auth removal.

Routine cleanup is bounded: event receipts seven days, delivery evidence 90 days,
change history 365 days, revoked registrations 30 days, and rate buckets one
hour. Public logs and issue comments use aggregate categories/counts and release
identifiers, not addresses, tokens, private account identifiers, individual
engagement, or message contents. Never attach live database/provider output to
a public issue or workflow artifact.

## Independent activation

The owner-authorized secure-account release integration in PR #1247 uses separate controls. These approvals default off and apply only to the protected secure-auth release job:

| Control | Purpose |
| --- | --- |
| `PACK1_REMINDER_EMAIL_APPROVED=1` | Release authorization for email delivery |
| `PACK1_REMINDER_PUSH_APPROVED=1` | Separate release authorization for push |
| `PACK1_REMINDER_RESEND_API_KEY` | Dedicated reminder sender key; the existing account-deletion Resend key is a compatibility fallback |
| `PACK1_REMINDER_RESEND_WEBHOOK_SECRET` | Verification secret for the dedicated reminder endpoint |
| `PACK1_RATE_LIMIT_SECRET` | Existing server-only signing/destination-digest secret; preserve it |
| `PACK1_REMINDER_TOKEN_KEY` | Push-token encryption key, required only for push |
| `PACK1_EXPO_PUSH_ACCESS_TOKEN` | Push-service authorization when enabled on the Expo project |

Once reviewed and applied, the protected release sets
`PACK1_REMINDER_EMAIL_ENABLED` and `PACK1_REMINDER_PUSH_ENABLED` explicitly
and independently in development and production. A missing approval sets the
corresponding flag to `0`; `1` is accepted only after its own credential
validation. An email approval requires a valid sender key (a dedicated key
or the existing deletion-sender fallback) and a dedicated provider-event
verification secret, but does not require a push-token encryption key. Push
approval requires the 64-hex-character token-encryption key without requiring
email credentials. The old shared delivery flag has no effect. The scheduler
trigger is enabled separately through the shared scheduler release.
Existing Apple sign-in and secure-auth prerequisites remain intact.

Health exposes independent active/readiness fields. A stored opt-in or an active
flag does not prove the provider endpoint, trigger, or delivery works.

## Remaining acceptance

1. Confirm the dedicated Resend webhook for the provider-event endpoint is
   enabled, so deliveries, bounces and complaints reconcile.
2. After the release that carries migration 0062, enable the scheduler through
   `.github/workflows/neon-scheduler-release.yml` with the exact released SHA.
   Confirm `pack1-daily-reminders` is enabled with cron `5 23 * * *` and a next
   run time, and that the other scheduler definitions are unchanged.
3. With an explicitly opted-in, verified test account, confirm one real email
   arrives after 23:05 UTC, its delivery event reconciles, its unsubscribe link
   works, and no second email arrives that Pacific day. Keep account details
   private.
4. Push requires separate protected credentials, channel approval and
   authorized signed physical-device testing. Do not upload mobile builds,
   change tracks/testers or restart pending testing clocks without approval.

## Protected release and acceptance

1. Review actual source in the existing PR. Require exact-head `test` and
   `browser`, reminder PostgreSQL contracts, backend/schema, gateway, and affected
   native checks. Database execution is mandatory, not an optional-file test.
2. Merge only after review and relevant checks. Use the normal reviewed
   `.github/secure-auth-release-request.json` process; do not deploy an unmerged
   branch or bypass environment approval.
3. Apply and verify migrations in development, then deploy and verify the exact
   revision. Promote that same approved revision and verify production schema,
   backend/gateway release identifiers, and normal monitoring. Check Pages and
   the web module/cache-version chain independently.
4. Configure the dedicated provider-event endpoint without changing password
   verification/recovery handling. Use an explicitly opted-in verified test
   account, keep its details private, and confirm the actual email plus signed
   event reconciliation. Controlled provider fixtures do not satisfy this step.
5. Activate the reminder trigger only through the shared scheduler release for
   the exact deployed commit. Confirm its enabled definition, next invocation,
   and successful dispatch. Verify an older email's unsubscribe link and that a
   later run sends no further email to that account the same day. Confirm
   non-opted-in accounts remain untouched. Preserve existing Daily/deletion
   trigger definitions.
6. Prepare an authorized signed native candidate separately. Record its source
   SHA and iOS/Android build identifiers before physical acceptance. Do not
   replace pending submissions, alter testers/tracks, restart testing clocks,
   upload, submit, or promote without applicable authorization.

Physical iOS and Android acceptance must cover explicit permission enable,
denial and device Settings recovery, actual notification receipt, foreground/
background/cold-start taps to Daily home, token rotation, invalid tokens,
multiple devices, logout and account A-to-B switching, per-device and global
opt-out, and deletion. Keep issue #1151 open until these and the independent
web/backend delivery acceptance steps have real evidence.
