# Finish Patreon setup

The site is prepared for your published **$3 Supporter** and **$5 Elite Member**
tiers. Supporter helps fund the site; Elite Member unlocks Cube practice and
custom-set practice. Your existing API client credentials work.

Account linking remains disabled until the missing webhook secret is saved and a
real membership test passes. You do not need to recreate the tiers or API client.

## 1. Confirm the OAuth callback

1. Sign in to [Patreon’s API clients page](https://www.patreon.com/portal/registration/register-clients).
2. Open the existing Pack One client.
3. Confirm its redirect/callback URL is exactly:

```text
https://br-orange-feather-ayps8kep-pack1growth.compute.c-5.us-east-2.aws.neon.tech/v1/patreon/callback
```

4. Save if you changed it.

## 2. Create or check the webhook

1. Open [Patreon’s My Webhooks page](https://www.patreon.com/portal/registration/register-webhooks).
2. Select the Pack One campaign. Create a webhook, or edit the existing one if
   it already uses the endpoint below.
3. Enter this exact endpoint:

```text
https://br-orange-feather-ayps8kep-pack1growth.compute.c-5.us-east-2.aws.neon.tech/v1/patreon/webhook
```

4. Select the v2 member events: `members:create`, `members:update`, and
   `members:delete`.
5. Save and copy the webhook signing secret shown by Patreon. Do not paste it
   into chat. An endpoint test can report unavailable while linking is disabled;
   the final connection check happens after the secret is installed.

## 3. Save the signing secret in GitHub

1. Open [the repository’s Actions secrets](https://github.com/killjoy00/mtg-ev-analyzer/settings/secrets/actions).
2. Choose **New repository secret**.
3. Enter the name `PATREON_WEBHOOK_SECRET`.
4. Paste the signing secret from Patreon into the secret field and save it.
   If this secret already exists, update it instead of creating a second name.

## 4. Tell me setup is ready

Reply **“Webhook saved”** and identify the Pack One account available for the real
membership test. A creator account alone does not demonstrate subscriber access;
we need to verify a real Elite Member connection and confirm Supporter access is
excluded. Do not send passwords, access tokens, or the signing secret.

I can then install the runtime secret, prepare the controlled member test, verify
linking, access changes, disconnect/reconnect and reconciliation, and enable the
public connection button after those checks pass. No purchase or subscription
change has been made on your behalf.
