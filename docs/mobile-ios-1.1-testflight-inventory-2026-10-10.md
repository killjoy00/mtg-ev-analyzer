# Pack One iOS 1.1 TestFlight: exact-build feature inventory and release boundary

**Reconciled October 10, 2026 (America/Chicago); updated October 11, 2026.** Since this inventory was written, the server-side fixes it waited on are live in production: [#1136](https://github.com/killjoy00/mtg-ev-analyzer/pull/1136) (peer-stats gateway route and QA exclusion, [release run 38086879729](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/38086879729)), [#1139](https://github.com/killjoy00/mtg-ev-analyzer/pull/1139) (peer counts from per-pick observations and real trophy-drafter evidence, [run 38090705486](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/38090705486)) and the web-only account recovery [#1138](https://github.com/killjoy00/mtg-ev-analyzer/pull/1138) ([run 38100246402](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/38100246402)). Both store binaries (iOS 100733 and Android 100740) were built from the same source and remain current for native code. Owner tracker: [#575](https://github.com/killjoy00/mtg-ev-analyzer/issues/575). This is the current status of the **iOS TestFlight 1.1 candidate**, not authorization to submit or release a new App Store version. Preserve the historical iOS 1.0/100505 and Android 1.0/100491 evidence in the original #575 repair ledger.

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
| Last compared `main` | `ae0bbaf84773d25e9ccb543752c53745f14f2e33` (October 11) | `git diff 67c6d259..ae0bbaf8 -- mobile/` changes only `mobile/scripts/play-internal-release.mjs`, an Android Play-upload helper that is not part of the app binary. Everything else since the build is website, Draft/Growth backend, gateway, workflow or documentation code. **No later native application, build configuration or mobile dependency change.** Recompare if main changes. |

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
| Daily post-pick comparison | Native UI for peer pick percentages and trophy match-record text, read only after a pick is locked; no invented loss count | [#1129](https://github.com/killjoy00/mtg-ev-analyzer/pull/1129), merged before build. The production `/stats` route is live since #1136; a native-shaped request (`x-pack1-mobile-session`) reaches the Draft backend (401 for an invalid session) instead of the gateway's 404 |

The app renders the server-provided `trophyRecord` phrase. Since #1139 the server sends an exact Premier record (for example “went 7–1”), else the archived win rate (“has a 62% win rate”), else Mythic/Diamond rank, else nothing, so the line is omitted rather than repeating the always-true “won 7 matches”. This needed no binary change. The separate **web-only** grammatical reveal-copy PR [#1132](https://github.com/killjoy00/mtg-ev-analyzer/pull/1132) landed *after* the build; it did **not** update the native binary because native had already used grammatical sentence patterns. Do not claim the web PR was compiled into this build.

## Not included, not live, or not yet verified

| Item | Precise boundary / next action |
| --- | --- |
| Peer percentage availability | **Live in production** since #1136 (gateway allowlist and QA exclusion) and #1139 (indexed per-pick counts). Browser- and native-shaped requests reach the Draft backend. Percentages appear only after at least 10 distinct non-QA players have locked that Daily pick, so a quiet Daily shows nothing; that is expected, not a failure. Not yet observed with a real signed-in device session. |
| Bluesky/Discord automation | **Not an app binary feature.** Repository automation from #1130/#1136. No destination is configured, so since [#1140](https://github.com/killjoy00/mtg-ev-analyzer/pull/1140) the scheduled runs finish without posting until the owner adds one |
| Web-only changes after 100733 | #1132 website trophy text/CSS and later site version bumps are served separately. They do not imply a new embedded native app binary |
| App Store version 1.1 record | The protected finalizer found no 1.1 version and did not attach build 100733. The owner later reported (October 10) that App Store Connect now has a 1.1 version. **Selecting build 100733 for it is an owner step in App Store Connect and has not been independently verified.** No 1.1 App Review submission, approval or public release is established. Do not run a replacement upload as a workaround |
| App Store version 1.0 | Separate review track. Its prior October 6 EULA/metadata rejection and repair are recorded in [mobile-store-submission.md](mobile-store-submission.md). **Current Apple review state has not been independently rechecked**; do not claim it is approved, pending or withdrawn |
| TestFlight distribution and real devices | Owner reports 1.1 is visible in TestFlight. The upload workflow did **not** finish its automated beta-group availability check; no new verification of internal/external group membership, physical installation, iPhone/iPad gestures, accessibility, identity upgrade, StoreKit lifecycle, crash-free reporting or live associated-domain handoff is claimed. See #575 and [#673](https://github.com/killjoy00/mtg-ev-analyzer/issues/673) |
| Android 1.0 | Signed AAB **versionCode 100740** was built from the same source `67c6d259` ([production bundle run 38075036105](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/38075036105)) and uploaded unchanged to the Play bundle library in [run 38079116799](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/38079116799). On October 11 the owner authorized promoting it to the existing `production-access` closed-test track (`.github/android-closed-release-request.json`), replacing 100698. The promotion changes only the track's release; testers, groups and countries are not touched. Result is recorded in #575. Android marketing version remains **1.0** |
| Store graphics | Earlier store screenshots and provider results are preserved as historical 1.0 evidence. Do not assert that 1.1's changed About/navigation screens have been refreshed in the App Store listing without a separately reviewed new capture and provider verification |
| Public launch | Physical/provider checks, App Review, Play qualification/Production access, and explicit owner approval are still open. **TestFlight upload ≠ App Store submission ≠ public release** |

## Candidate acceptance and next safe actions

1. **Keep 1.0 review untouched**. Check its actual App Store Connect state before authorizing any new version-record or submission operation; retain manual release.
2. **Treat iOS 1.1/100733 and Android 100740 as the latest compiled native candidates as of the October 11 comparison above.** No further upload is needed for merged native code. Re-run the source comparison before making that claim against a later main SHA.
3. ~~Complete #1136 and deploy the protected backend/Cloudflare release.~~ **Done October 10–11** (release runs 38086879729, 38090705486, 38100246402). Live health reports the latest release commit, and `/stats` reaches the Draft backend for browser- and native-shaped requests.
4. **Run physical-device acceptance on exact 100733**: iPhone/iPad, narrow/landscape/large text, account/Apple/Google/email, reporter crash, Creator invites/continuation, real Daily picks and records, shared-run resume, upgrade data continuity, Live OS links, VoiceOver, StoreKit/Restore/refunds/revocation. Record exact devices/results under #575 and #673 rather than reusing October 4 simulator results.
5. **Android closed testing runs on 100740 from October 11.** Google counts the Production-access requirement per tester: at least 12 testers opted in continuously for the preceding 14 days ([Play Console Help](https://support.google.com/googleplay/android-developer/answer/14151465)). Replacing the build on the track does not opt anyone out, and Google recommends updating the app during closed testing. Keep testers opted in and using the app.
6. **App Store 1.1 is a later, separately approved release decision.** Apple must permit an editable 1.1 version record; recheck review state, version metadata, current device acceptance and submission packet. No workflow here submits App Review or releases publicly.

## Old PR housekeeping

- [#1046 — Deliver iOS 1.1 to TestFlight](https://github.com/killjoy00/mtg-ev-analyzer/pull/1046) was **closed unmerged** as obsolete after the later 100733 upload. Do not merge its outdated October 6 release request or upload a duplicate candidate.
- As of this reconciliation the **only open repository PR** was [#1136](https://github.com/killjoy00/mtg-ev-analyzer/pull/1136). It stays open because its backend/gateway/social bugs are genuine unfinished work; it does **not** require a new iOS binary.
- Issue [#575](https://github.com/killjoy00/mtg-ev-analyzer/issues/575) stays open for physical/store/qualification acceptance. Earlier 1.0 delivery evidence and screenshots remain useful historical records, not a substitute for 100733 acceptance.

This document is **source- and workflow-evidence only** except where owner TestFlight observation is expressly identified. It does not re-interpret a failed overall GitHub workflow as a successful final App Store submission.
