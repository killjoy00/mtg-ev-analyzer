# Native membership: implementation and release acceptance

Tracking: #575; replaces the unsafe assumptions identified in the review of #599. This document does not certify a public/store release.

## Product contract

Account and Practice headers open a dedicated Membership screen with a normal stack push. The Account form is not reloaded, rebound to provider data, or modified by a membership read/browser return. Actual navigation and retained edits still require exact-RC device acceptance.

Overall account access comes from `accountCapabilities()` in `worker/capabilities.mjs`, the provider-independent authority used by gameplay. The native status adds `account_capabilities`; the existing `capabilities` field continues to describe only current Patreon grants. A disconnected Patreon, an expired Patreon grant, or a failed provider read must never be interpreted as an account-wide Free tier. Partial capabilities are described individually rather than called full Elite.

Unknown/loading/failed status is explicitly unverified. Browser closure is not a successful connection, and a refresh request is not completed reconciliation. POST refresh marks `sync_requested_at` and advances the existing provider revision; only the existing authoritative reconciler may issue/extend grants. A subsequent GET reports pending status. There is no silent mutation retry.

Disconnect requires an account-bound confirmation and revokes only Patreon-provided grants. It cancels outstanding Patreon OAuth states. Other providers' grants survive. Disconnecting Pack One access does not cancel Patreon billing.

## Identity and transport

The exact endpoints are GET `/growth/v1/patreon/mobile/status` and POST `/growth/v1/patreon/mobile/{connect,refresh,disconnect}`. The common route policy admits only those method/path pairs. The existing growth dispatcher already owns this provider prefix; unrelated auth, recovery, deletion and gameplay dispatch remain unchanged.

The gateway requires both native player and account headers and excludes browser cookies on these endpoints. The origin uses the existing cryptographic player verifier, requires a current native account session without cookie/legacy fallback, and verifies the exact `account_links` pair. Every native UI async boundary checks the persisted session. Late responses and old disconnect confirmations cannot act as a newly signed-in account.

Native OAuth state is `m_` plus 32 random bytes encoded as hex. The complete string is hashed into the existing state table. Changing the prefix invalidates the hash rather than changing a stored flow's completion surface. The callback obtains the initiating account only from the consumed state row, regardless of browser sign-in. Provider code exchange and identity resolution remain server-side with the existing approved identity scope and registered callback configuration.

The native callback redirects to `/mobile-membership-complete/?result=<allowlisted outcome>`, not the normal web account or activation page. That standalone page has no purchase/account-navigation links and no provider/account credentials. It asks the user to return to the app and check the authoritative status. The outcome URL is informational, not an access grant. The original browser completion path remains unchanged.

An OAuth request authorized by account A remains bound to A even when the device later switches to B; it can never attach to B based on browser cookies. The app discards A's late result. Existing server-side deletion locks and disconnect state cancellation continue to protect A.

## Automated evidence to obtain on the exact candidate

- `tests/mobile-patreon.test.mjs`: real provider handler/helper and gateway modules, mocked provider/SQL boundaries; identity mismatch, provider-independent grants, exact routes, explicit refresh/disconnect, native random state, signed-out/wrong-browser-account callbacks, expired/cancelled callbacks, token-free completion, native header forwarding and cookie exclusion.
- `tests/patreon-mobile-backend-smoke.mjs`: real disposable PostgreSQL fixture and growth handler, invoked by the existing Patreon backend smoke. Covers valid cryptographic player/native account sessions, manual grants, expired/revoked Patreon grants, pending refresh, wrong pair, revoked account session, Patreon-only disconnect and cancelled OAuth state. It must not run against production.
- `mobile/tests/membership.test.cjs`: mounted production Membership screen, controller and API adapter with mocked platform/navigation/transport. Covers unknown/error status, partial/non-Patreon access, pending/failed refresh, browser cancel/read failure, URL allowlisting, account races, duplicate actions, bound disconnect confirmation, and absence of profile enrichment side effects.
- All existing lifecycle, DraftRun, shared-run and SecureStore suites remain in the mobile test command. Existing Patreon reconciliation/webhook/lifecycle tests remain unchanged except for chaining the additive native database fixture.

Passing source guards or mocked transport tests do not substitute for the real database fixture, a live provider authorization, or device navigation acceptance. Record workflow IDs, head SHA, merge SHA and deployment SHA separately in #575.

## Storefront and purchase strategy remains a release blocker

This change implements existing-access management, not join/upgrade purchase parity. No purchase steering, billing system, regional exception, store entitlement or storefront detection is asserted or introduced.

Primary policies reviewed September 26, 2026:

- Apple App Review Guidelines, especially 3.1.1 and 3.1.3(b): https://developer.apple.com/app-store/review/guidelines/
- Google Play Payments-policy explanation, including consumption-only apps and administrative pages: https://support.google.com/googleplay/android-developer/answer/10281818?hl=en
- Patreon OAuth registration, state and server-side code exchange: https://docs.patreon.com/

Apple's multiplatform provision includes an in-app-purchase condition; a game is not automatically a reader app. Google's consumption-only allowance does not by itself approve an administrative browser flow that eventually reaches prohibited alternative payment. Storefront-specific exceptions must not be generalized worldwide. These observations do not establish approval for this app.

Before public distribution, decide and implement a documented iOS/Android/storefront purchase strategy, assess the full real Patreon authorization path (including navigation available on provider pages), and provide store-review evidence. The absence of a Buy button is not sufficient evidence. The standalone completion page removes the prior first-party activation funnel but cannot control all provider navigation. Do not mark Patreon/Elite parity, store-ready, or public-ready complete solely because this implementation merges.

## Exact-RC physical acceptance

On iPhone, iPad and Android: open Membership from Account with unsaved name/profile/credential fields, complete or cancel authorization, return and verify those edits remain; repeat with browser signed out and signed in to a different Pack One account. Exercise account switching/sign-out during status, browser, refresh and the disconnect alert. Verify a manually granted Elite account without Patreon, connected Supporter/Elite, revoked/expired grants, failed/locked network, pending reconciliation, successful disconnect with manual grants preserved, and duplicate taps. Verify the actual server callback configuration and deployed gateway/backend revision match the candidate. Inspect accessibility, large text, tablet layout and Back behavior.

No production deployment, release request, store upload, billing change or minimum-supported-version increase is included in this source change.
