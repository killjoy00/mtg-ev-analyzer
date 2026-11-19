# Native archive exploration and dated activity sharing

Tracking: #575. Additive to #630's private Career/public-profile privacy work. Source completion, automated evidence, deployed behavior and physical-device acceptance are separate milestones.

## Product contract

Career and public ProfileOverview expose explicit Archive, Achievements and Daily-finish browsing entry points. Public entry points carry only a validated public profile key; an invalid key cannot become a private-account fallback. Private browsing resolves the currently persisted signed-in player/account pair, not a profile passed through route parameters.

Archive progress uses the same published `data/catalog.json` source as web `profile-core.mjs:environmentProgress`, omits fixture entries, and matches returned per-environment game records by identifier. The live `/draft/v1/set-catalog` is a separate metadata lookup. It must not define the progress denominator: a retained archive environment can be absent from live serving coverage. Out-of-catalog results do not inflate that denominator. Search, All/Played/Unplayed filters, favorites, Cube identity, per-environment statistics and expandable live coverage are available. Failed catalog reads are unavailable, not zero-of-zero completion; failed live coverage does not erase archive progress. Neither catalog read starts a game, grants practice access or follows manifest URLs.

Achievements retain the server's locked/unlocked state, descriptions, numeric progress, earned date and showcase label. Only currently unlocked records can be shared. Progress bars are presentation, not client-side unlock logic.

Daily finishes show every row returned by the profile endpoint rather than only the twelve-row overview. This is not a claim of unbounded lifetime Daily history: the existing server response limit remains. Date, environment and mode jointly identify a share target. A fresh server response supplies the shared score, name and standing. Zero is a score, not missing data. `final=true` is Final, `final=false` is Live/so far, and an absent final marker is not promoted to Final. The literal Daily date is never shifted through a local timezone.

Historical sharing uses a freshly verified public-profile URL only when opted in, otherwise the canonical home URL, matching the destination boundary in web `share-cards.mjs:cardUrl`. It does not invent a replayable historical Daily URL, pretend a past result is today's, or post to create a challenge. Current gameplay's existing Daily/share-run flow is unchanged.

## Privacy and async contract

All profile activity reads and shares are scoped to the current route. Private loads and share preflights recheck secure storage; persisted session notifications remove the old record immediately. Different account, player, credentials, sign-out, unreadable storage, old response or navigation cannot authorize export of the previous record. Public browsing does not create or read a native session and uses #630's credential-free public adapter. Explicit privacy/denial/deletion responses and invalid payloads remove cached activity. Same-scope transient outages may preserve previously loaded data with an error, but every new share still needs a fresh read.

A share tap contributes identifiers only. The action fetches the current profile and re-finds the unlocked achievement or dated Daily before opening the platform sheet. Duplicate taps are blocked synchronously; foreground refresh cannot start another share while a sheet is pending. Navigation invalidates pending work. Once the OS has accepted a payload, it cannot be retracted from another app; these guards apply before handoff and to retained in-app content.

The native sheet receives the tapped control's anchor when available for iPad. No successful-send analytics or success message is inferred from the Share promise. Verified text is selectable as a fallback after an attempted handoff; sign-out or identity invalidation clears it. This is text/link sharing and system text selection, not generated image cards or a one-tap clipboard API.

## Automated evidence

`mobile/tests/profile-activity.test.cjs` executes the production model, controller and archive adapter with mocked IO. It covers published-versus-live scope, fixture and duplicate rejection, filters, correct zero/date/mode/final semantics, private links, current unlock lookup, identity changes, stale responses, privacy denial, duplicate actions, cancellation/failure and optional catalog failure.

`mobile/tests/profile-activity-screen.test.cjs` mounts the production activity screen and ProfileOverview with the actual controller/model, mocking platform/router/API boundaries. Cases exercise real entry points, filters and expanded coverage, all returned Daily rows, locked/unlocked controls, fresh sharing, selectable fallback, sign-out, public-route changes, visibility denial, invalid scope, adaptive card widths and the iPad anchor. All pre-existing suites remain in `npm test`; no previous assertion is removed.

Local model/controller/API execution is recorded separately from CI-mounted React execution. Exact-head mobile lint/typecheck/config/preflight and iOS/Android archive results must be recorded before merging. Native-only root/browser workflow fast-path success is not full browser E2E evidence.

## Remaining parity and exact-RC acceptance

This source batch does not complete graphical achievement badge parity, generated image share cards, one-tap clipboard sharing, editorial set-archive analyses, complete trends, Learn/support/legal/affiliate work, or the wider adaptive-iPad audit. Those #575 requirements remain open. The new activity route uses two archive columns on sufficiently wide, standard-text layouts and one column with large text; that rule is tested but is not screenshot/device acceptance.

On exact iPhone/iPad/Android candidates, verify entry from Career and a public profile, actual back-stack restoration, public-to-private visibility changes, sign-out/account switch during delayed reads and share preflight, locked SecureStore, OS cancellation and native share destinations, selectable fallback, iPad popover placement, large text, narrow split view, orientation and screen-reader focus. Verify live catalog versus published catalog differences against deployed endpoints. Historical result links must not appear to reopen or rerank past Dailies.

Primary platform references checked September 26, 2026:
- Expo Router layouts and automatic file routes: https://docs.expo.dev/router/basics/navigation-layouts/
- React Native Share, dismissal semantics and iPad anchor: https://reactnative.dev/docs/next/share

No production deployment request, store publication, database/schema mutation, entitlement change, new dependency or minimum-supported-version change is included.
