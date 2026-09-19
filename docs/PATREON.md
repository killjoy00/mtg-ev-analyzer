# Patreon membership integration

Pack One keeps Neon Auth as its account identity. Patreon is an entitlement provider, not a login provider.

## Runtime flow

1. An authenticated Pack One account starts `POST /v1/patreon/connect`.
2. Pack One stores a one-time hashed OAuth state and sends the browser to Patreon API v2 with the minimal `identity` scope.
3. Patreon returns to the registered production callback:
   `https://br-orange-feather-ayps8kep-pack1growth.compute.c-5.us-east-2.aws.neon.tech/v1/patreon/callback`.
4. The backend exchanges the one-time code, reads only that user's membership to this creator campaign, stores the provider identity/membership snapshot, then discards the user OAuth token.
5. Current paid, gifted, or free-trial membership grants both `unlimited_cube_practice` and `custom_corpus`. A free/no-current-entitlement membership stays connected but receives no paid capabilities.
6. Patreon v2 member webhooks keep the membership snapshot and grants current. Disconnecting Patreon revokes Patreon grants but does not delete the Pack One account or gameplay history.

Per-user Patreon access/refresh tokens are deliberately not stored. `provider_accounts` stores the durable provider identity and current membership snapshot; `entitlement_grants` remains the source of effective paid capabilities.

## Secrets and release

Repository Actions secrets:
- `PATREON_CLIENT_ID`
- `PATREON_CLIENT_SECRET`
- `PATREON_CREATOR_ACCESS_TOKEN`
- `PATREON_CREATOR_REFRESH_TOKEN`
- optional until webhook setup: `PATREON_WEBHOOK_SECRET`

Only the client ID/secret and webhook secret belong in the production `pack1growth` runtime. Creator tokens are operational credentials for campaign/webhook setup and must not be deployed to the browser or ordinary API runtime.

The reviewed function deployment installs Patreon runtime variables only on production `pack1growth`. Linking remains disabled until both OAuth client credentials and a webhook secret are present, so a partially configured membership integration cannot grant access that will later drift.

## Webhook

Production endpoint:
`https://br-orange-feather-ayps8kep-pack1growth.compute.c-5.us-east-2.aws.neon.tech/v1/patreon/webhook`

Required v2 triggers:
- `members:create`
- `members:update`
- `members:delete`

Every request is verified against the raw body using Patreon's `X-Patreon-Signature` HMAC-MD5 signature before JSON parsing or database writes. Unlinked Patreon users are acknowledged without creating Pack One accounts.

## Admin visibility

Admin → Users continues to list authenticated Pack One accounts only. It now shows whether Patreon is connected, the current provider membership state, effective capabilities, and sync time. Anonymous/guest gameplay identities remain excluded from the Users list.
