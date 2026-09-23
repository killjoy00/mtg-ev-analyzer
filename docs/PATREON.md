# Patreon membership release

Public linking is enabled after the real member checks on September 19, 2026.
The owner completed OAuth, disconnect/reconnect and an Elite custom practice run.
Creator API reconciliation run 35461859312 confirmed the exact Elite tier and
renewed both premium grants. Public release 053541429b7adf01168eb27b344204e706ca67f9
passed development 35462022892 and production 35462227708; all three health markers
were verified independently. Discovery run 35459558651 verified the required secrets.
The verified policy maps campaign **16808916** to **Elite Member 29631843 ($5)**.
**Supporter 29631835 ($3)** and the free tier **29623888** grant no premium tools.
Regular practice remains free to authenticated Pack One accounts. Both paid tiers
include display-ad suppression when signed in and connected; Google ads remain
disabled pending approval and a separate owner activation. This benefit is
independent of premium practice grants.

The OAuth client, creator credentials and webhook signing secret are present in
GitHub. No secret values were exposed. The connection requires the account owner
to authorize Patreon through the normal OAuth flow; no email-based grants or
account impersonation are used.

## Access policy

- Only a current entitlement to the explicitly configured all-access tier in the
  Pack One campaign grants `unlimited_cube_practice` and `custom_corpus`.
- Gifted and trial access use the same exact tier requirement. Declined payments,
  refunds, missing membership, and empty entitlement lists do not grant access.
- A cancelled subscription retains access while Patreon still lists the current
  all-access tier, then loses access when that entitlement ends.
- Manual grants remain independent. Disconnecting Patreon revokes only Patreon
  grants and retains the Pack One account, results, and other grants.

The API uses Patreon's v2 `currently_entitled_tiers` relationship as recommended
in the [official API reference](https://docs.patreon.com/). Neon Auth remains the
account identity; Patreon is a linked provider, not a login replacement.

## Elite Welcome Note activation

Phase 0 on September 22, 2026 verified with the same already-linked owner Patreon
identity that the existing `identity` OAuth scope returns the Pack One campaign
membership and exact Elite tier. The OAuth callback immediately reapplied the
authoritative Elite snapshot and premium capabilities without waiting for scheduled
reconciliation, so no broader Patreon membership scope is requested.

The Elite tier Welcome Note was updated on September 23, 2026 and now directs
members to the production activation route:

**Activate your Pack One Elite benefits**

Go to:

`https://packone.pro/?patreon=activate`

Sign in to Pack One if needed, then authorize Patreon. Pack One will verify the
membership and unlock Elite benefits. A live mobile acceptance from that Welcome
Note link correctly short-circuited to **Elite is active** for the already-entitled
owner account, without forcing another OAuth round trip or manufacturing another
`elite_activated` transition. Issue #181 is closed.

This reuses the existing Patreon client, campaign, tiers, webhook, callback and
Pack One account infrastructure. Do not create a second Patreon client or another
post-purchase communication path.

Browser funnel stages are recorded as `patreon_activation_started`,
`patreon_activation_oauth_started`, and `patreon_activation_succeeded`. The browser
success event is UX telemetry only and is never the activation numerator.
`applyPatreonMembership` writes the reserved server-only `elite_activated` event
when authoritative Patreon premium grants transition from revoked/not-present to
active. Run `analytics/patreon_activation_funnel.sql` for the 30-day funnel; its
success and abandonment metrics use `elite_activated` with a 24-hour maturity
window so delayed reconciliation can land before a journey is labeled abandoned.

## Synchronization and failure behavior

OAuth requests only `identity`, reads the linked user's membership in the creator
campaign, and discards the access token. The state is hashed, expires after ten
minutes, is single-use, and can be cancelled by disconnecting while the callback
is in flight. Provider identity uniqueness prevents linking one Patreon account
to multiple Pack One accounts.

Signed webhooks are deduplicated by a digest of event type and raw body. They only
request reconciliation, so replayed or out-of-order payloads cannot grant stale
access. The scheduled workflow reads all pages of the authoritative campaign
membership list each hour before applying any changes. No partial list can revoke
members on an unread page. A revision check discards snapshots overtaken by a
webhook, reconnect, or disconnect. Snapshot and grant changes are atomic.

Membership changes normally take effect at the next hourly sync; GitHub schedules
may be delayed by several hours. Grants expire twelve hours after the last successful
provider snapshot so ordinary scheduler delays do not demote valid members between
syncs. Provider/API failures still cannot extend access indefinitely. The workflow
fails visibly on an expired creator token; it does not rotate secrets silently.

## Configuration

Existing GitHub Actions secrets are used in place:

- `PATREON_CLIENT_ID`, `PATREON_CLIENT_SECRET`
- `PATREON_CREATOR_ACCESS_TOKEN`, `PATREON_CREATOR_REFRESH_TOKEN`
- `PATREON_WEBHOOK_SECRET`

Only the client credentials and webhook secret are installed on production
`pack1growth`, and only after reviewed activation. Creator credentials stay in
the operational workflow. Nothing secret is stored in source, browser code,
provider-account rows, webhook receipts, or workflow artifacts.

Run **Patreon membership reconciliation → Run workflow → discover** to inspect
public campaign and tier IDs and boolean secret availability. Discovery does not
change memberships, billing, or Pack One grants. Assign the all-access tier by its
ID; never infer it from a price or arbitrary membership ordering.

Register this exact OAuth callback in the Patreon API client:

`https://br-orange-feather-ayps8kep-pack1growth.compute.c-5.us-east-2.aws.neon.tech/v1/patreon/callback`

Register the webhook URL with `members:create`, `members:update`, `members:delete`:

`https://br-orange-feather-ayps8kep-pack1growth.compute.c-5.us-east-2.aws.neon.tech/v1/patreon/webhook`

## Release checklist and observed evidence

1. Confirm the published supporter and all-access tiers, then record the campaign
   and all-access tier IDs from discovery in the policy.
2. Confirm callback and webhook registration and save the webhook signing secret
   in GitHub. Do not paste credentials into chat.
3. Run isolated SQL/backend and browser checks, then deploy the controlled
   production canary restricted by the owner-authorized managed account ID hash.
   Verify real OAuth linking and premium access. Fixture checks cover supporter
   denial, downgrade/expiration, disconnect and reconnection; verify real
   disconnect/reconnect with the owner before public activation. A creator login alone does not prove
   a paid subscriber's tier behavior.
4. Verify reconciliation succeeds and that Admin → Users reports the provider,
   effective capabilities, membership state, and last synchronization time.
5. Record the real canary evidence, enable the reviewed policy, and deploy the
   same checked commit to development and production. These activation steps
   passed on September 19; public account linking is now available.

Automated fixture tests cover tier/campaign denial, gifts/trials, cancellations,
invalid signatures, failed pagination, duplicate identity, downgrade/upgrade,
stale snapshots, grant expiry, disconnect, and manual-grant preservation. They do
not substitute for the real provider canary.

## Remaining real-provider acceptance

A real billing/tier change and an actual signed provider webhook delivery have
not been observed. Real connection/reconnection and authoritative API sync do not
substitute for those events. Automated fixtures cover tier changes, revocation,
signatures, ordering, expiry and manual-grant preservation. Observe the next
legitimate provider change without purchasing or cancelling subscriptions solely
for testing. Started practice retains its recorded session; new paid practice
starts require current capabilities.

## Ad-free membership

`adFreeTierIds` explicitly includes Supporter and Elite. The provider status
response supplies `ad_free` and `ads_allowed`; it never grants Supporter the Elite
practice capabilities. A stale snapshot, pending sync, failed request or unknown
response suppresses advertising. This conservative advertising behavior does not
extend expired premium gameplay grants. Sign-in and a connected membership are
required on the current browser; a signed-out visitor cannot be identified as a
member. All Google delivery remains off in `ad-config.js`.
