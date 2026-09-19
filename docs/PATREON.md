# Patreon membership release

Public linking remains disabled pending a real member canary. A controlled production
connection is restricted to the account explicitly authorized by the owner; the
policy stores only a hash of its managed Auth ID. Discovery run 35459558651 on
2026-09-19 verified all five required secrets, including the saved webhook secret.
The verified policy maps campaign **16808916** to **Elite Member 29631843 ($5)**.
**Supporter 29631835 ($3)** and the free tier **29623888** grant no premium tools.
Regular practice remains free to authenticated Pack One accounts.

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
may be delayed. Grants expire three hours after the last successful provider
snapshot. Provider/API failures cannot extend access indefinitely. The workflow
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

## Activation gate

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
   same checked commit to development and production. Until then the public site
   offers the Patreon support link and accurately says linking is coming soon.

Automated fixture tests cover tier/campaign denial, gifts/trials, cancellations,
invalid signatures, failed pagination, duplicate identity, downgrade/upgrade,
stale snapshots, grant expiry, disconnect, and manual-grant preservation. They do
not substitute for the real provider canary.
