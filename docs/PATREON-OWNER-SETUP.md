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
monetization slot is wired; AdSense remains dormant (`enabled:false`) pending
Google approval, consent/privacy work and explicit owner authorization. While
Google is disabled, the slot shows the TCGplayer affiliate fallback to
advertising-eligible visitors, and qualifying Supporter/Elite memberships suppress
it as part of ad-free browsing. Pack One-originated account or Patreon transitions
clear an existing promotion across open tabs, but provider/backend changes that
never pass through a Pack One tab are only picked up after reload.

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

## Membership offer and ad-free contract

The website offers Free, Supporter ($3/month on Patreon), and Pack One Elite
($7/month on Patreon) before account creation. A new purchase and connecting an
existing membership have separate actions. Apple pricing comes from StoreKit,
including its localized price and billing period. Do not change provider prices
as part of a copy update.

Free includes all three Dailies and unlimited regular mixed-set practice with a
free account. Supporter funds ongoing development and removes promotions. Elite
adds custom-set and unlimited Powered Cube practice. Both paid tiers suppress
individual-card TCGplayer links and affiliate disclosures in web/native reveals
and set archives, as well as the web promotional slot. Full Elite capabilities
from Apple or manual grants suppress those promotions too. Unknown membership
status keeps card promotions hidden. Identity changes and foreground/focus checks
invalidate previous eligibility.

### Patreon editor copy (prepared; requires creator publication)

Keep the existing tier IDs and prices. Rename **Elite Member** to **Pack One Elite**.
Remove the duplicate “Unlimited power cube draft runs” benefit when replacing the
benefit list. These are proposed editor values, not proof of a live Patreon change.

**Supporter description**

Help keep Pack One going. Your membership supports development, infrastructure,
and new set coverage. Supporters get ad-free browsing, including no individual-card
TCGplayer promotions, while signed in with their membership connected.

All three Dailies are free. A free Pack One account also includes unlimited regular,
mixed-set practice. Supporter adds ad-free browsing; Elite adds more ways to practice.

After joining, open https://packone.pro/?patreon=activate, sign in to Pack One, and
connect Patreon. Use that same Pack One account on the website and app.

**Pack One Elite description**

Choose what you practice. Pack One Elite includes:

- Custom-set practice: choose one set or combine several.
- Unlimited Powered Cube practice.
- All Supporter benefits, including no display ads or individual-card TCGplayer promotions.

All three Dailies and regular mixed-set practice remain free. After joining, open
https://packone.pro/?patreon=activate, sign in to Pack One, and connect Patreon.
Use that same Pack One account on the website and app.

**Welcome note for both tiers**

Thanks for supporting Pack One. Connect your membership at
https://packone.pro/?patreon=activate. Sign in to Pack One, then connect Patreon.
Your benefits work on the website and app when you use the same Pack One account.
Already connected? Check your membership at https://packone.pro/patreon/.

### Conversion measurement

`analytics/membership_funnel.sql` reports offer, purchase intent, actual provider
handoff, connection, restoration, cancellation, and verified-status UX stages.
It separately reports server-owned Patreon grant transitions and Apple first
subscription observations, then premium usage within 24 hours. Exclude staff/QA,
keep Apple Sandbox separate, and let cohorts mature for 24 hours. These are not
payment receipts: a restore or reactivation must not count as a new purchase.
`elite_upgrade_handoff` is an internal membership-page visit, not checkout.
Do not publish production analytics outputs in this public repository.
