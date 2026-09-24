# Pack One mobile v2 restart report

Original audit baseline: `38825d8ed4c349d9e592ae5310ef7f292605b16a`. The v2 foundation is rebased onto current `main` at `ffc17c57450852fea14a9f87aa8fad5ccdbc4126`, preserving the self-challenge fix and subsequent card-image publication work.

## Current architecture and product
Pack One is a static/native-JS web client backed by a Cloudflare gateway that routes to legacy, growth/account, and Draft Run Neon Functions. Neon/Postgres stays server-only. Delivery uses GitHub Actions, Neon Functions, and Cloudflare. Schema is additive through migration 0036 on current main; native auth uses the next migration number rather than colliding with existing history.

The current flagship product is eight decisions with three Pacific-date Dailies: mixed, Powered Cube, and Latest Set. Daily rerolls are disabled. The server owns selection, scoring, eligibility, history, and capabilities. Current card responses still expose repaired public `image_url` metadata.

## Mobile API target
Use existing gateway routes, not a duplicate backend: guest/session via `POST /growth/v1/session`; Draft Run via `POST /draft/v1/runs`, `GET /draft/v1/runs/:id`, and run pick/reroll/share/view mutations; status/leaderboard/capability/catalog reads from the Draft service; current profile/account routes from Growth.

The v2 foundation adds only a narrow bridge from a signed native guest-player token to Draft Run player routes. It does not forward arbitrary Authorization, grant account authority, or expose database credentials.

## Auth and entitlement
Browser auth now uses first-party Pack One account/player cookies plus CSRF and revocable seven-day account sessions; legacy Neon session headers are migration compatibility. Google exists in the current account flow. Apple native sign-in still needs an approved provider/configuration path. Account deletion is durable/tombstoned with passwordless verification support.

Capabilities remain server-authoritative. Patreon is a linked entitlement source. No current-main RevenueCat/store-purchase implementation was found, so billing remains deferred.

## Store status
Apple is verified: App Store app 6814318676, bundle ID `pro.packone.app`, SKU `packone-ios-001`; recent App Store Connect read/write workflows succeeded.

Google Play credentials are present and can mint an Android Publisher OAuth token, but the service account receives `403 PERMISSION_DENIED` for the Pack One edit API. Play app permission/linkage remains an external blocker.

The old mobile stack contains EAS configuration, but no Expo project is present on current main. Existing Expo project identity must be verified before creating anything new.

## Old mobile salvage matrix
| Old PR | Classification | Treatment |
|---|---|---|
| #196 | PORT WITH CURRENT-API ADAPTATION | Expo/Router/SecureStore/native guest UI; fresh branch only. |
| #200 | REDESIGN | Keep security concepts; discard obsolete schema/routes. |
| #206 | PORT WITH CURRENT-API ADAPTATION | Current three Dailies and Pacific calendar. |
| #207 | PORT WITH CURRENT-API ADAPTATION | Native leaderboard against current response. |
| #209 | PORT WITH CURRENT-API ADAPTATION | Preserve the stronger account+player linkage check for private career/history; reuse current profile/history contracts rather than permanent duplicate mobile endpoints. |
| #210 | REDESIGN | Preserve scoped practice idempotency, but re-number/re-audit the schema because old migration 0033 conflicts with current 0033_unique_usernames.sql. |
| #213 | PORT WITH CURRENT-API ADAPTATION | Career/history UI and current profile/history response shapes; #209 supplies the stronger linkage boundary. |
| #216 | REDESIGN | Regular-practice UX remains useful; pair it with a freshly reviewed successor to #210 for retry safety. |
| #218 | PORT WITH CURRENT-API ADAPTATION | Preserve the Practice hub and exact server capability gates (`unlimited_cube_practice`, `custom_corpus`). |
| #219 | PORT WITH CURRENT-API ADAPTATION | Same entitlement-aware practice direction as #218; current server capability authority wins. |
| #220 | REDESIGN | Reuse layout ideas; source copy from current web. |
| #221 | REDESIGN | Universal/App Links need verified signing identity. |
| #222 | PORT MOSTLY AS-IS | Crash-safe recovery is contract-light. |
| #223 | PORT WITH CURRENT-API ADAPTATION | Keep accessibility/zoom/resume; use Pacific rollover. |
| #224 | PORT WITH CURRENT-API ADAPTATION | Use verified store identities, no placeholders. |

## Known blockers
1. Google Play service account lacks Pack One Android Publisher permission.
2. Existing Expo/EAS project linkage is not yet verified.
3. Apple provider/signing capability needs final supported-provider and developer-portal verification.
4. Store billing architecture is intentionally undecided.
5. Real-device performance/accessibility validation cannot be claimed from CI.

## Fresh PR sequence
Foundation + current guest Daily; account/auth; full Daily parity; player surfaces; practice/Elite; current content; polish/deep links/observability; store billing after explicit architecture approval; beta/release.
