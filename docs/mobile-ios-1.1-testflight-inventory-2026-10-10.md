# Pack One iOS 1.1 TestFlight: exact-build feature inventory and release boundary

**Reconciled October 10, 2026 (America/Chicago).** Owner tracker: [#575](https://github.com/killjoy00/mtg-ev-analyzer/issues/575). This is the current status of the **iOS TestFlight 1.1 candidate**, not authorization to submit or release a new App Store version. Preserve the historical iOS 1.0/100505 and Android 1.0/100491 evidence in the original #575 repair ledger.

## Exact distributed candidate and source

| Fact | Verified result | Evidence and limitation |
| --- | --- | --- |
| iOS marketing version / build | **1.1 (100733)**, bundle `pro.packone.app` | [Protected TestFlight run 38075036098](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/38075036098), October 10 |
| Signed binary source | **`67c6d25917f3e8b632922b80c7a5479ca897af9f`** | Workflow archive metadata and signed-build verification |
| Apple processing | **`VALID` / `APP_STORE_ELIGIBLE`**, Apple build ID `a2760e26-0a09-45d9-8efd-999ef87cecad` | Apple response logged by run 38075036098 |
| Upload to Apple | **Succeeded** | Xcode upload step completed before the finalizer failed |
| Appearance in TestFlight | **Owner observed build 1.1 in TestFlight** | Firsthand owner observation, not an independent API verification of exact beta-group membership, tester installability or external testing |
| App Store 1.1 version attachment | **Failed** | Finalizer: `App Store version 1.1 was not found.` The overall GitHub workflow is **failed** even though upload and processing succeeded |
| Public iOS 1.1 availability | **Not released** | No 1.1 App Store review submission or public release established |
| Last compared `main` | `a2cf1e139b0fffadafc1e502f6b731200e6dd6a1` | GitHub comparison of upload SHA to main: **no later iOS/React Native application, iOS build configuration or mobile dependencies changed**; the only `mobile/` change was an Android Play-upload helper. Recompare if main changes. |

**Versioning nuance:** `mobile/app.json` retains an Expo base version of `1.0`; `mobile/store-release.json` supplies **iOS App Store 1.1** and **Google Play 1.0**. Production generation applies the platform-specific marketing version. `100733` is the iOS build number, **not** an Android versionCode or an App Store release version.

## Included in the signed iOS 1.1 (100733) binary

These are **compiled native app capabilities**, not a claim that every backing service, real-device path or production dependency has passed separate acceptance.

| Area | Included in 100733 | Source/evidence |
| --- | --- | --- |
| Existing app foundation | Three Pacific-day Dailies, regular/eligible practice, saved runs/recovery, shared Draft Runs, career/profile/leaderboard/account flows, sign-in, server-authorized membership and native Apple subscription purchase/restore UI | Prior native implementation and release source |
| Beat the Creator | Practice- and completed-Daily-derived invites, secure deep-link handling, guest/account continuation, eight-pick comparisons to creator and trophy drafter, result outcomes and sharing | [#985](https://github.com/killjoy00/mtg-ev-analyzer/pull/985), [#1001](https://github.com/killjoy00/mtg-ev-analyzer/pull/1001) |
| Native visual/navigation repair | Pack One typography/brand, redesigned member and guest tabs, responsive pick feedback, readable Back navigation, conditional Practice recovery and improved educational/account entry | [#890](https://github.com/killjoy00/mtg-ev-analyzer/pull/890), [#910](https://github.com/killjoy00/mtg-ev-analyzer/pull/910), [#955](https://github.com/killjoy00/mtg-ev-analyzer/pull/955), [#960](https://github.com/killjoy00/mtg-ev-analyzer/pull/960) |
| October 7 mobile parity | Larger **Play now / View result** Daily buttons; native **About, Support, Privacy, Terms**; removed legacy Help tab/stack and routed Help links to About; visible bottom About navigation; simplified Daily heading; native **Stats / Account settings** access in My Pack One | [#1057](https://github.com/killjoy00/mtg-ev-analyzer/pull/1057), merged before the signed build |
| Decision reporting | Native report UI with hardened static metadata imports and tests | #1057 plus prior decision-report work. **The suspected physical Report crash was not proven resolved** by that source change |
| Native branding | Website-matched Pack One P¹ launcher and adaptive marks | #1001 / prior icon work |
| Daily post-pick comparison | Native UI for peer pick percentages and trophy match-record text, read only after a pick is locked; no invented loss count | [#1129](https://github.com/killjoy00/mtg-ev-analyzer/pull/1129), merged before build. **The percentages' production API is still blocked until #1136 is deployed** |

The app can show a trophy drafter's verified wins even when losses are unknown. The separate **web-only** grammatical reveal-copy PR [#1132](https://github.com/killjoy00/mtg-ev-analyzer/pull/1132) landed *after* the build; it did **not** update the native binary because native had already used grammatical sentence patterns. Do not claim the web PR was compiled into this build.

## Not included, not live, or not yet verified

| Item | Precise boundary / next action |
| --- | --- |
| Peer percentage availability | **Not yet working in production:** the Cloudflare gateway returns 404 for `GET /draft/v1/runs/:id/stats` before the request reaches the backend; pending [#1136](https://github.com/killjoy00/mtg-ev-analyzer/pull/1136), production backend/gateway rollout and read-back. The 10-distinct-player threshold/QA traffic exclusion must also be verified after rollout. **Do not rebuild 100733 just to fix this server route.** |
| Bluesky/Discord automation | **Not an iOS binary feature.** The scheduled social publisher shipped as repository/server automation in #1130, but its record-key/retry/deduplication fixes and publishing readiness are in #1136. Real credential configuration and live posting are not certified by this inventory |
| Web-only changes after 100733 | #1132 website trophy text/CSS and later site version bumps are served separately. They do not imply a new embedded native app binary |
| App Store version 1.1 record | **Missing/not editable as of the protected finalizer**. The finalizer did not attach build 100733 to an App Store 1.1 version; no 1.1 App Review submission, approval or public release is established. Do not run a stale replacement upload as a workaround |
| App Store version 1.0 | Separate review track. Its prior October 6 EULA/metadata rejection and repair are recorded in [mobile-store-submission.md](mobile-store-submission.md). **Current Apple review state has not been independently rechecked**; do not claim it is approved, pending or withdrawn |
| TestFlight distribution and real devices | Owner reports 1.1 is visible in TestFlight. The upload workflow did **not** finish its automated beta-group availability check; no new verification of internal/external group membership, physical installation, iPhone/iPad gestures, accessibility, identity upgrade, StoreKit lifecycle, crash-free reporting or live associated-domain handoff is claimed. See #575 and [#673](https://github.com/killjoy00/mtg-ev-analyzer/issues/673) |
| Android 1.0 | Separately, signed AAB **versionCode 100740** was uploaded to the **Play bundle library only** in [run 38079116799](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/38079116799). **It was not promoted to Internal/Closed Testing**, and the existing `production-access` closed-test track and qualification clock were left unchanged. Android marketing version remains **1.0** |
| Store graphics | Earlier store screenshots and provider results are preserved as historical 1.0 evidence. Do not assert that 1.1's changed About/navigation screens have been refreshed in the App Store listing without a separately reviewed new capture and provider verification |
| Public launch | Physical/provider checks, App Review, Play qualification/Production access, and explicit owner approval are still open. **TestFlight upload ≠ App Store submission ≠ public release** |

## Candidate acceptance and next safe actions

1. **Keep 1.0 review untouched**. Check its actual App Store Connect state before authorizing any new version-record or submission operation; retain manual release.
2. **Treat iOS 1.1/100733 as the latest compiled native candidate as of the comparison above.** No further iOS upload is needed for merged native code. Re-run source comparison before making that claim against a later main SHA.
3. **Complete #1136 and deploy the protected backend/Cloudflare release**, then confirm on production that an authenticated, post-lock `/stats` request reaches Draft backend rather than 404ing at the gateway, and that QA sessions do not count as peers. These are **runtime prerequisites**, not TestFlight upload prerequisites.
4. **Run physical-device acceptance on exact 100733**: iPhone/iPad, narrow/landscape/large text, account/Apple/Google/email, reporter crash, Creator invites/continuation, real Daily picks and records, shared-run resume, upgrade data continuity, Live OS links, VoiceOver, StoreKit/Restore/refunds/revocation. Record exact devices/results under #575 and #673 rather than reusing October 4 simulator results.
5. **Keep Android's existing Closed Testing unchanged** until the 12-tester/14-day Production-access requirements are independently verified; bundle 100740 in Play's library is not a track rollout.
6. **App Store 1.1 is a later, separately approved release decision.** Apple must permit an editable 1.1 version record; recheck review state, version metadata, current device acceptance and submission packet. No workflow here submits App Review or releases publicly.

## Old PR housekeeping

- [#1046 — Deliver iOS 1.1 to TestFlight](https://github.com/killjoy00/mtg-ev-analyzer/pull/1046) was **closed unmerged** as obsolete after the later 100733 upload. Do not merge its outdated October 6 release request or upload a duplicate candidate.
- As of this reconciliation the **only open repository PR** was [#1136](https://github.com/killjoy00/mtg-ev-analyzer/pull/1136). It stays open because its backend/gateway/social bugs are genuine unfinished work; it does **not** require a new iOS binary.
- Issue [#575](https://github.com/killjoy00/mtg-ev-analyzer/issues/575) stays open for physical/store/qualification acceptance. Earlier 1.0 delivery evidence and screenshots remain useful historical records, not a substitute for 100733 acceptance.

This document is **source- and workflow-evidence only** except where owner TestFlight observation is expressly identified. It does not re-interpret a failed overall GitHub workflow as a successful final App Store submission.
