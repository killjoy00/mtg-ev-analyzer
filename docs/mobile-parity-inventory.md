# Mobile web/native parity inventory

Tracking: #575. Rebuilt from current main cf729490fd56bd34fa323cd58e9502891327d8ab on September 26, 2026.

This document replaces blanket source-string parity claims with an A–E inventory. **Implemented** means reviewed product code is present on main. It does not mean physical-device acceptance, live association-file verification, store-console approval, or public-release authorization.

Status vocabulary:

- **Implemented** — user-facing behavior is present on current main with behavioral coverage.
- **Deliberate continuation** — native intentionally opens a canonical HTTPS web surface because that is the safer/single-source implementation.
- **Policy decision open** — code intentionally does not claim storefront approval.
- **Release evidence open** — implementation exists but required device/signing/live-host evidence is still missing.

## A. User-facing product surfaces

| Web product surface | Native v1 state | Evidence / notes |
| --- | --- | --- |
| Daily home: all three Dailies, completion state, View result, ordering, streak/reset cue, ranking-identity warning, resume | **Implemented** | Home refresh/rollover and stale-response guards are covered in the lifecycle suite. |
| Draft Run gameplay | **Implemented** | Server-authoritative eight-pick flow, prior-pool context/zoom, stale-response protection, reroll rules and full result/review behavior are mounted-tested. |
| Post-pick comparison | **Implemented** | Your Pick vs Trophy Pick, score explanation, pack review and reopened completed decisions. |
| Revealed-card TCGplayer links | **Implemented** | Links appear only inside expanded score analysis, use exact card-specific destinations, carry visible affiliate disclosure, and fail visibly if OS handoff fails. |
| Practice | **Implemented** | Regular/custom/Cube access remains server-capability-authoritative. |
| Shared practice / friend run | **Implemented** | Explicit invitation acceptance, exact server run continuity, no silent replacement on failed GET, no recipient reroll, creator/result recovery, kill/relaunch/Home recovery. |
| Historical challenge compatibility | **Implemented** | Genuine 12-hex historical challenge links remain distinct from modern 24-hex shared runs. |
| Leaderboards / seasons | **Implemented** | Today / This week / This season / All time, current season context, three environments and public-profile navigation. |
| My Pack One / Career | **Implemented** | Current-season standings, snapshot, recent performance, best environments, achievements/showcase, paginated games, Daily history, archive progress, shared activity and record/profile sharing. |
| Public profiles | **Implemented** | Guest-safe public reads, privacy revocation, route changes, pagination, full returned detail and canonical sharing. |
| Profile activity | **Implemented** | Shared-run/challenge activity plus privacy-bound achievement and Daily sharing. |
| Membership / Patreon existing access | **Implemented** | Provider-independent account access is separate from Patreon provenance; connect/reconnect, refresh and disconnect are available. Unknown/failure is never labeled Free. |
| Join/upgrade Patreon membership | **Policy decision open** | Native intentionally does not sell or upgrade memberships. Current store/geography strategy must be chosen before adding purchase steering. |
| Learn: How to Play / Scoring / Method / Sets | **Implemented** | Core education is native. |
| Editorial drafting guides | **Deliberate continuation** | Opens canonical `https://packone.pro/learn/` so article copy remains single-source. |
| Published MSH/ECL/TMT/SOS archive analyses | **Implemented** | Native archive screen uses current checked-in web evidence, native routing and disclosed card links. |
| About / Support / Privacy / Terms | **Deliberate continuation** | First-class native entries open canonical Pack One HTTPS pages; no native credential is placed in the URL. |
| Daily-home TCGplayer fallback | **Implemented** | Guest visibility; signed-in visibility only when authoritative `ads_allowed===true`; unknown/pending/failure hides it; no gameplay/result placement. |
| Account sign-in / credential management | **Implemented, device evidence open** | Email/Google/Apple, password recovery/change, verification resend, sign-out/deletion and identity guards exist; exact-device Apple/relay/deletion acceptance remains open. |

## B. Routing, sharing and continuation parity

| Entry / link | Native behavior | Status |
| --- | --- | --- |
| Modern shared run `shared=<24hex>` | Routes to explicit shared-run invitation/accept/resume flow | **Implemented** |
| Compatible modern `challenge=<24hex>` | Routes to modern shared-run flow | **Implemented** |
| Historical `challenge=<12hex>` | Preserved as historical challenge compatibility | **Implemented** |
| Public profile `profile=<16hex>` | Routes to privacy-safe public profile | **Implemented** |
| `/open/shared/`, `/open/profile/`, `/open/daily/` HTTPS intents | Native configuration is present | **Release evidence open** — hosted AASA/assetlinks with production signing identities are not yet verified |
| Published set web routes for MSH/ECL/TMT/SOS | Rewritten to native set archive detail | **Implemented** |
| Reset-password credential links | Canonical HTTPS browser continuation | **Implemented, device evidence open** — never intercept reset credential in a custom scheme |
| Learn/support/legal | Canonical HTTPS continuation where single-source content is preferable | **Implemented** |
| Profile / Daily / achievement / record sharing | Canonical spoiler/privacy-aware share targets | **Implemented** |

## C. Identity, state, privacy and authority parity

| Contract | Native state |
| --- | --- |
| Scoring, puzzle selection and entitlements remain server-authoritative | **Implemented** |
| Foreground/focus/rollover refresh cannot let older responses replace newer state | **Implemented** |
| Account A → B cannot retain A's private Career/profile data after B load failure | **Implemented** |
| Public profile becoming private removes stale cached public content and blocks share | **Implemented** |
| Shared run UUID continuity survives ambiguous responses, retry and relaunch | **Implemented** |
| Known shared-run UUID failure never silently starts a replacement run | **Implemented** |
| Invitation open does not create a run before explicit acceptance | **Implemented** |
| Shared-run async work is bound to player + account + share identity | **Implemented** |
| Authentication success is not converted to failure by optional enrichment errors | **Implemented** |
| Provider-independent account access is not inferred from Patreon-only grants | **Implemented** |
| Failed/unknown Patreon status is not presented as Free | **Implemented** |
| Patreon disconnect removes Patreon grants without deleting other-provider/manual access | **Implemented** |
| Signed-in affiliate visibility is authoritative/fail-closed | **Implemented** |

## D. Deliberate native/store differences

| Difference | Rationale / boundary |
| --- | --- |
| No native Patreon purchase/upgrade CTA | Existing-access management is implemented; storefront/geography strategy remains a release decision. Apple U.S. and Google U.S. external-purchase rules differ and must not be generalized worldwide. |
| Guides and policy copy are not duplicated into native source | Canonical HTTPS continuation prevents editorial/legal drift. |
| External credential reset remains canonical HTTPS | Avoids exposing reset credentials to interceptable custom schemes. |
| Affiliate links are restricted to reviewed surfaces | Revealed-card links live inside expanded score analysis; Daily-home fallback is outside active gameplay/results and fail-closed for ad-free/unknown signed-in membership. |
| Public-profile reads omit native account credentials | Public visibility is server-authoritative and should not create guest/native identity side effects. |
| iPad uses bounded responsive content widths rather than a separate product fork | Practice, Draft Run/results, article surfaces and other first-class screens are bounded; physical portrait/landscape acceptance is still required. |

## E. Automated evidence and release gates

### Merged implementation evidence

- Shared-run recovery, invitation, Home recovery and actual DraftRun reuse are covered by mounted production-screen suites.
- Membership has mounted controller/screen/API coverage for provider-independent grants, unknown/error states, OAuth return, disconnect and identity races.
- Public-profile/Career coverage includes account switching, privacy revocation, pagination, sharing and stale-response guards.
- Archive/Home affiliate/Learn/iPad work added mounted production-screen or release guards instead of source-only assertions.
- The integrated mobile command now exercises **150 mounted tests** before lint, strict TypeScript, Expo config and release preflight.

### Pending deterministic-build evidence

PR #637 pins Node/npm and npm lock inputs, uses `npm ci` in mobile/iOS/Android workflows and pins the Expo SDK 57-compatible React DOM / Reanimated / Worklets peer set. Its exact integrated head has test, E2E, mobile, Android-internal and iOS archive green; Android production bundle remains the final gate at the time of this document.

### Pending exact-main RC evidence

PR #648 adds a store-free exact-main RC smoke workflow. It:
- refuses non-main or stale-main execution;
- re-checks that the source SHA is still current main after both native builds finish;
- runs deterministic mobile validation;
- creates an unsigned production iOS archive and an Android production bundle;
- uploads GitHub Actions artifacts plus a SHA/version manifest; and
- has no App Store Connect, Google Play, release-environment or store-publishing credentials.

### Release evidence still open

- Physical iPhone acceptance on the exact signed TestFlight RC.
- Physical iPad portrait/landscape/accessibility acceptance and App Store screenshots.
- Physical Android acceptance on the exact Play Internal/Closed Testing RC.
- Upgrade-path acceptance from prior store builds.
- Sign in with Apple normal + Hide My Email, relay email and deletion/revocation acceptance.
- Hosted `.well-known/apple-app-site-association` and `.well-known/assetlinks.json` verification using the real Apple Team ID and Google Play **app-signing** certificate.
- Storefront/geography decision for Patreon join/upgrade; Google Play program enrollment evidence if external digital-purchase links are used.
- Signed binary hashes/build numbers and exact backend/gateway release recorded against the final store RCs.
- App Store / Play Console metadata, app-content declarations, reviewer access and production-access qualification.
- Explicit owner approval before TestFlight/Play/store publication.

## Parity-change rule going forward

A user-facing web change is not complete for v1 maintenance until one of these is recorded:

1. native behavior changes with it and behavioral coverage is updated;
2. the feature is already backed by the same server/canonical content and native behavior remains equivalent; or
3. a deliberate native/store difference is recorded in section D with the reason and acceptance evidence required.

Do not use matching strings, route names, or source-file existence as parity evidence. Prefer mounted behavior, server-authority contracts, live route tests and exact-candidate device/store evidence.
