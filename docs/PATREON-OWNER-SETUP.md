# Patreon setup and owner operations

Setup is complete. Public Patreon linking and the Elite post-purchase activation
flow are live. The real Elite connection, disconnect/reconnect, custom-set practice
and creator API reconciliation passed September 19, 2026. The Welcome Note activation
flow and server-authoritative activation measurement closed issue #181 on September
23, 2026. No further setup or credentials are needed now.

## Normal Elite post-purchase activation

The Elite tier Welcome Note points members to:

`https://packone.pro/?patreon=activate`

1. Open the activation link from the Patreon Welcome Note.
2. Sign in to Pack One if needed.
3. If the Pack One account is not already linked and entitled, authorize Patreon and
   return to Pack One.
4. When authoritative capabilities show Elite, Pack One shows **Elite is active** and
   exposes **Choose your sets** and Powered Cube practice.

An already-entitled Elite account intentionally stops at **Elite is active** without
another OAuth round trip. That steady-state visit is not a new `elite_activated`
transition.

## Account Patreon controls

For manual linking or recovery, sign in to Pack One, open **My Pack One → Account**,
and use the Patreon controls. **Connect Patreon** links an unconnected account;
**Refresh Patreon access** reauthorizes the same linked Patreon identity; **Disconnect
Patreon** removes only Patreon-derived grants and linkage. Switching Patreon identities
requires an explicit disconnect first.

Supporter ($3) and Elite ($7) both include ad-free browsing while signed in to
Pack One with Patreon connected and verified; Elite also unlocks premium practice.
Entitlements are determined from campaign, tier and provider state IDs, never the
price. A signed-out Patreon member is treated as a guest. One Daily-home-only
AdSense banner is wired but dormant (`enabled:false`); Google approval,
consent/privacy work and explicit owner authorization are still required before
delivery. Pack One-originated account or Patreon transitions clear an existing ad
across open tabs, but provider/backend changes that never pass through a Pack One
tab are only picked up after reload.

## Existing provider configuration

The existing API client, published tiers and saved secrets are in use. Do not
recreate them or paste credentials into chat. The callback is:

`https://br-orange-feather-ayps8kep-pack1growth.compute.c-5.us-east-2.aws.neon.tech/v1/patreon/callback`

The registered webhook endpoint is:

`https://br-orange-feather-ayps8kep-pack1growth.compute.c-5.us-east-2.aws.neon.tech/v1/patreon/webhook`

Selected member events are `members:create`, `members:update`, `members:delete`.
The signing secret is saved as `PATREON_WEBHOOK_SECRET` in repository Actions
secrets. Existing client and creator-token secrets remain separate.

## If access later looks stale

1. Confirm the member is signed in to the correct Pack One account and has connected Patreon.
2. Check **Admin > Users**, open the account and inspect membership, capabilities,
   expiration and **Last synced**.
3. Check the **Patreon membership reconciliation** workflow. The normal sync runs
   hourly; GitHub may delay schedules. Use **Run workflow > sync** to reconcile now.
4. If the workflow reports expired creator credentials, update the existing
   creator token secrets using the values from the owner's Patreon API client,
   then rerun sync. Never send secret values through chat or commit them.

The initial real billing-change/signed-webhook observation is still outstanding;
fixture coverage and successful API reconciliation are documented separately in
[the runbook](PATREON.md). No purchase or subscription change was made on your behalf.
