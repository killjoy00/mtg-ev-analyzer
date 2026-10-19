# Daily reminders: implementation and release controls

Tracks issue #1151 and PR #1247. This document describes the implementation and
release checks; it is not a production-deployment or delivery receipt.

**Source/schema and gateway are deployed, with delivery still default-off.**
Reviewed PRs #1247 and #1250 merged on October 19, 2026. The protected
secure-auth release succeeded on commit
`11df2732f5837532097374c8a71635aa4a7a4305`, including development
and production migration 0061, exact-revision functions and gateway checks.
The full native simulator acceptance/screenshot workflow passed, but this is
not physical-device receipt evidence.

A dedicated Resend webhook now exists for
`https://api.packone.pro/growth/v1/reminders/provider-event`, subscribed to
the four supported email events. **It is disabled** pending secure signing
secret provisioning and deployment. The existing unrelated account webhook
is unchanged. This branch includes a narrowly scoped guard that drops
unrelated account-wide email events before writing reminder metadata.

At the time of this update, production has **zero** opted-in reminder
settings, registered devices, deliveries or provider events, and the
dedicated scheduler trigger does not exist. Do not treat a code deployment,
simulator screenshot, or signed provider event fixture as real delivery.
Do not enable either channel or the scheduler before its matching credentials,
independent approval and opted-in test-account receipt evidence are available.
No native store submission or track change is included.

## Consent and scheduling

Email and push consent are independent and default off. Web email goes only to
the authenticated account's verified address. Native push additionally requires
an explicit enable action on that installation and operating-system permission.
The account/settings mutation includes an expected account identifier so a
browser cookie or native session change cannot silently save account A's form
into account B. The identifier is compared with authenticated ownership, not used
as authorization.

The schedule stores daily, once-weekly, or selected weekdays, a 24-hour local
wall time, and a validated IANA timezone. The first occurrence of a repeated
wall time is used at autumn fallback. A nonexistent spring wall time advances
to the first valid minute after that time. A skipped civil day is skipped.
Routine edits recalculate a future occurrence without changing the unsubscribe
capability. The shared preferred schedule does not imply shared channel consent.

Game identity and the all-three-completed suppression check use the existing
America/Los_Angeles Daily date. Reminder wall time does not change the game
calendar, immutable game schedules, scoring, or rankings.

## Durable dispatch

Migration `0061_daily_reminders.sql` adds the private account-owned state and
PostgreSQL functions. It is additive; do not patch a live database by hand.
The scheduler atomically advances a due schedule and inserts delivery work.
Later invocations recover existing queued work as well as eligible retries.
Work more than 20 minutes late, for a previous Pacific Daily, or invalidated by
an edit, opt-out, deletion, device rotation, or session change is suppressed.
An outage does not create a multi-day catch-up backlog.

Before a provider request, one atomic database operation checks current consent,
verified destination/suppression, deletion state, device/session version,
freshness, all-three-Daily completion, rate admission, and dispatch claims.
The account lock is shared with the existing deletion guard. Claims enforce both
account/channel/device/local-day and account/channel/device/Pacific-day
uniqueness, independent of schedule version. This deliberately prevents a
routine timezone edit from granting another reminder for the same Daily.

Provider requests have a stable per-delivery idempotency key and a stored payload
hash. An explicit 429 can retry at most three attempts, within the freshness
window, with the same payload. Ambiguous timeouts, 5xx responses, and abandoned
sending leases become uncertain, not blindly retryable. A database failure after
provider acceptance cannot authorize another unbounded send. Email tags carry
the opaque delivery identifier for matching an event that arrives before the
provider identifier is saved.

The dedicated trigger remains separate from Daily generation and account
maintenance. Its checked-in cadence is every five minutes. Dispatch is bounded
by a 90-second tick budget and a 20-minute occurrence-freshness window. Shared
database rate admission limits email to two requests per second and 60 per
minute, and push to 20 per second and 120 per minute. These are safety ceilings,
not a throughput guarantee. Before broad activation, validate the due-account
cohort and provider limits in development; change capacity only through reviewed
source and the existing scheduler release. Never use an unbounded catch-up loop.

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
mutating consent; POST disables only email. Ordinary schedule or push edits do
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
remains independently protected and disabled until its explicit release.
Existing Apple sign-in and secure-auth prerequisites remain intact.

Health exposes independent active/readiness fields. A stored opt-in or an active
flag does not prove the provider endpoint, trigger, or delivery works.

## Remaining private provisioning and acceptance

1. Privately provision the new dedicated webhook's Resend signing secret as
   `PACK1_REMINDER_RESEND_WEBHOOK_SECRET` in the protected GitHub release
   environment. Never copy the `whsec_` value to a public issue, PR,
   repository, build artifact or chat response. Provision a dedicated sender
   key separately if needed; preserve unrelated recovery/deletion email keys.
2. Review and merge the provider-event isolation fix in PR #1251. Reapply
   the protected source release with email approved only after the webhook
   credential is verified and an explicitly opted-in, verified test account
   is ready. Independently verify the production readiness flags.
3. Enable the dedicated Resend webhook only after the exact configured
   release reports ready. Confirm an actual test email arrives, and that
   delivery events reconcile, an old email's unsubscribe succeeds and
   later ticks do not send again. Non-opted-in accounts must remain untouched.
4. Enable the Neon reminder trigger only through the existing protected
   manual scheduler workflow for the verified deployed revision. Its normal
   five-minute cadence and resource limits are documented above.
5. Push requires separate protected credentials, channel approval and
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
5. Activate the dedicated reminder scheduler only through its protected manual
   release for the exact deployed commit. Confirm its enabled definition, next
   invocation, and successful dispatch. Verify an older email's unsubscribe
   link and that a later tick sends no further email to that account. Confirm
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
