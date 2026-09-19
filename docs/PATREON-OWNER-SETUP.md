# Patreon setup and owner operations

Setup is complete. Public Patreon linking is live. Your real Elite connection,
disconnect/reconnect, custom-set practice and creator API reconciliation passed
on September 19, 2026. No further setup or credentials are needed now.

## Normal member connection

1. Open [Pack One](https://packone.pro/) and sign in.
2. Open **Account** on Pack One, then find **Patreon** and select **Connect Patreon**.
3. Authorize the Patreon account with the intended membership and return to Pack One.
4. Elite members can select **Choose your sets** on the homepage or start Cube practice.

This Account menu is on Pack One, not in Patreon's own navigation. Supporter helps
fund the site and includes future ad-free browsing; Elite also unlocks premium
practice. Google ads remain disabled for everyone pending approval.

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
