# Mobile web/native parity inventory

Tracking: #575. Reconciled through production secure-auth revision `a564a207e9f336639636624c366bff55c6a9759f` on September 27, 2026; Apple-IAP release-candidate work remains separately tracked in #673.

This document replaces blanket source-string parity claims with an A–E inventory. **Implemented** means reviewed product code is present on main. It does not mean physical-device acceptance, live association-file verification, store-console approval, or public-release authorization.

Status vocabulary:

- **Implemented** — user-facing behavior is present on current main with behavioral coverage.
- **Deliberate continuation** — native intentionally opens a canonical HTTPS web surface because that is the safer/single-source implementation.
- **Policy decision open** — code intentionally does not claim storefront approval.
- **Release evidence open** — implementation exists but required device/signing/live-host evidence is still missing.

## October 4 native repair — implementation merged; physical acceptance open

PR #910 merged as `ae70e2af79b804c137b8c289c2a1b0535e5c76dd` and addresses the original owner complaints, which were not completed by #890. See [the complaint/evidence ledger](mobile-native-ux-repair-575.md). Existing “Implemented” rows below describe source capability; they do not override failed physical observations or certify the old distributed binaries. Native run `37232560582` passed all 24 Android checks and 14 scenes plus measured text growth on each iPhone/iPad, with actual image review. Secondary tab-return correction #955 also passed 25 Android checks and the iPhone/iPad scenes in run `37236842723`; it merged as `f0f30c939d1016c70f5d3548d46b0b8b3f839e79`. Fresh exact-main smoke `37239878233` and #951 checks remain the signed-candidate prerequisites. Tester distribution and physical/provider acceptance remain separate gates recorded in that ledger.

## October 2, 2026 UAT parity candidate

Branch `codex/uat-auth-profile-parity-20261002` carries the Pack One acceptance changes below. These rows track source/automated status separately from physical-device acceptance so no item can be silently treated as complete.

| # | Acceptance item | Web | iPhone / iPad / Android | Remaining evidence / intentional difference |
| ---: | --- | --- | --- | --- |
| 1 | Create-account provider buttons | Create mode says **Create with Google / Create with Apple**; sign-in mode says **Sign in with…** | Google and Android Apple use the same mode-specific copy. iOS uses AppleAuthentication `SIGN_UP` / `SIGN_IN` native variants. | **Physical device open.** Apple controls the exact localized wording rendered by its native button; Pack One selects the supported sign-up/sign-in variant rather than drawing a fake Apple button. |
| 2 | Trim account consent | Signup has one sentence and one Terms link. Public Identity notice remains only where a display name/public profile is saved. | Same contract; canonical Terms/Public Identity URLs open in the browser. | **Physical device open** for VoiceOver/TalkBack focus and external-link return. |
| 3 | Verification email fallback URL | Verify button plus the complete clickable/copyable validated URL; text + HTML use the same URL and readable UTC expiry copy. | Same delivered email. | **Real received-email rendering still requires a mailbox/device canary** including long-link wrapping. |
| 4 | Verification completes onboarding | Same-browser provider auto-sign-in is bridged into a first-party Pack One session before **Your account is ready**. Different-browser/device links fail closed to a verified-but-sign-in recovery when no authenticated session can be established. | Native signup uses a native-marked verification callback. Returning to the originating app can finish the email signup on that device without another credential prompt; a different device/app restart falls back to sign-in. | **Physical device + real inbox open.** Guest identity remains bound through the existing mobile/web link boundary; no authenticated onboarding is shown without a valid session. |
| 5 | Save profile visibility | Save profile is top-right beside Change name, wraps on narrow screens, and shows saving/success/failure near the action. Failed edits remain in place. | Same top action pattern and semantic states. | **Physical larger-text/keyboard open.** |
| 6 | Patreon page declutter | Current access first, concise benefits, one relevant next action, troubleshooting below. Signed-out/unconnected/connected/Elite/error states remain distinct. | Membership keeps provider/store policy differences rather than copying web purchase UI. | **Physical + live provider return open.** |
| 7 | Daily status prominence | Reset countdown is always prominent at the top of the Daily section; real streak gets a badge and the reset cue updates through rollover. | #910 puts reset/streak before completion, with real zero, checking, unavailable and foreground/rollover states; native candidate acceptance is in progress. | **Physical device open**, including no-streak/loading/rollover and large text. |
| 8 | Public profile alignment | Full-row clickable/tappable control with the requested description and preserved opt-in semantics. | Same description and switch semantics. | **Physical screen-reader/touch open.** |
| 9 | Disconnect Patreon styling/copy | Bordered secondary/destructive action; explicitly says disconnecting Pack One does not cancel Patreon billing. | Same visual/action distinction. iOS subscription cancellation remains in Apple subscription management; Patreon disconnect stays provider-scoped. | **Physical + live disconnect/refresh open.** |
| 10 | Consolidated authentication screen | Provider methods, `or` divider, email/password, consent, and mode switch live in one compact panel. | Same information hierarchy, using the native Apple control on iOS. | **Physical keyboard/large-text open.** |
| 11 | First-time My Pack One | Zero-game accounts/guests get a welcome + Play Daily; missing scores are not displayed as real zeroes and empty sections are deferred. | Signed-out and signed-in zero-game Career use the same first-action pattern; established players keep the rich dashboard. | **Physical device open.** |
| 12 | Navigation names | Direct destinations use **My Pack One**, **Account settings**, **Dailies**, **Practice**; Back is reserved for actual return behavior on touched surfaces. | Stack titles/actions use the same names. | **Physical back-stack audit open.** |
| 13 | Secondary text readability | Auth/profile/metric hierarchy removes the smallest wide-spaced uppercase treatment from essential labels/statuses. | Corresponding account/profile/Career labels raised to readable sizes. | **Physical larger-text/contrast open.** |
| 14 | Buttons vs links | Filled `.button` links no longer inherit underlines; action hierarchy distinguishes primary/secondary/destructive controls. | Native controls use consistent minimum touch heights and semantic treatments. | **Physical pressed/focus state audit open.** |
| 15 | Success vs errors | Profile save has distinct saving/success/save-error states and field-level display-name rejection; failed edits stay stable. | Same semantics; no background refresh overwrites edits after failure. | **Physical slow-network/keyboard open.** |
| 16 | Human timestamps/status copy | Verification expiry and native Patreon sync times are human-readable with timezone context; refresh-pending copy distinguishes requested work from confirmed entitlement. | Native Patreon status uses locale-readable time + timezone. | **Live provider-state canary open.** |

Automated browser evidence for this candidate emits screenshots for compact auth (390 + desktop), verification pending/expired/account-ready/different-browser on Chromium and WebKit, profile settings at 320/390/1440 plus 125% text, Daily status at 320/390/1440, and Patreon signed-out/unconnected/Elite states. Mounted native tests cover first-time Career, profile persistence semantics, membership refresh wording and account/provider contracts. Store publication, production deployment and physical-device approval gates are unchanged.

## A. User-facing product surfaces

| Web product surface | Native v1 state | Evidence / notes |
| --- | --- | --- |
| Daily home: all three Dailies, completion state, View result, ordering, streak/reset cue, ranking-identity warning, resume | **Implemented** | Home refresh/rollover and stale-response guards are covered in the lifecycle suite. |
| Draft Run gameplay | **Implemented** | Server-authoritative eight-pick flow, prior-pool context/zoom, stale-response protection, reroll rules and full result/review behavior are mounted-tested. |
| Post-pick comparison | **Implemented** | Your Pick vs Trophy Pick, score explanation, pack review and reopened completed decisions. |
| Revealed-card TCGplayer links | **Implemented** | Links appear only inside expanded score analysis, use exact card-specific destinations, carry visible affiliate disclosure, and fail visibly if OS handoff fails. |
| Practice | **Implemented** | Regular/custom/Cube access remains server-capability-authoritative. |
| Shared practice / friend run | **Implemented** | Explicit invitation acceptance, exact server run continuity, no silent replacement on failed GET, no recipient reroll, creator/result recovery and kill/relaunch. #910 moves local checkpoint discovery from Home to conditional Practice shared activity. |
| Historical challenge compatibility | **Implemented** | Genuine 12-hex historical challenge links remain distinct from modern 24-hex shared runs. |
| Leaderboards / seasons | **Implemented** | Today / This week / This season / All time, current season context, three environments and public-profile navigation. |
| My Pack One / Career | **Implemented** | Current-season standings, snapshot, recent performance, best environments, achievements/showcase, paginated games, Daily history, archive progress, shared activity and record/profile sharing. |
| Public profiles | **Implemented** | Guest-safe public reads, privacy revocation, route changes, pagination, full returned detail and canonical sharing. |
| Profile activity | **Implemented** | Shared-run/challenge activity plus privacy-bound achievement and Daily sharing. |
| Membership / Patreon existing access | **Implemented** | Provider-independent account access is separate from Patreon provenance; connect/reconnect, refresh and disconnect are available. Unknown/failure is never labeled Free. |
| Elite subscription purchase | **Implemented on iOS; deliberate difference on Android** | iOS offers Pack One Elite as an Apple auto-renewable subscription using StoreKit, StoreKit-displayed pricing, Restore Purchases, and Apple subscription management. Patreon remains an existing-access provider with no native Patreon purchase/upgrade CTA. Google Play billing is deliberately outside this v1 change. |
| Learn: How to Play / Scoring / Method / Sets | **Implemented** | Core education is native. |
| Editorial drafting guides | **Deliberate continuation** | In #910, Learn opens the selected, individually described article directly; browser close returns to the native screen. Native capture evidence remains open. |
| Published MSH/ECL/TMT/SOS archive analyses | **Implemented** | Native archive screen uses current checked-in web evidence, native routing and disclosed card links. |
| About / Support / Privacy / Terms | **Deliberate continuation** | First-class native entries open canonical Pack One HTTPS pages; no native credential is placed in the URL. |
| Daily-home TCGplayer fallback | **Implemented** | Guest visibility; signed-in visibility only when authoritative `ads_allowed===true`; unknown/pending/failure hides it; no gameplay/result placement. |
| Account sign-in / credential management | **Implemented, device evidence open** | Email/Google/Apple, password recovery/change, verification resend, sign-out/deletion and identity guards exist. A successfully consumed password-reset link now verifies that exact account email; merely requesting a reset does not. Exact-device Apple/relay/deletion acceptance remains open. |

## B. Routing, sharing and continuation parity

| Entry / link | Native behavior | Status |
| --- | --- | --- |
| Modern shared run `shared=<24hex>` | Routes to explicit shared-run invitation/accept/resume flow | **Implemented** |
| Compatible modern `challenge=<24hex>` | Routes to modern shared-run flow | **Implemented** |
| Historical `challenge=<12hex>` | Preserved as historical challenge compatibility | **Implemented** |
| Public profile `profile=<16hex>` | Routes to privacy-safe public profile | **Implemented** |
| `/open/shared/`, `/open/profile/`, `/open/daily/` HTTPS intents | Native configuration is present | **Release evidence open** — hosted AASA/assetlinks with production signing identities are not yet verified |
| Published set web routes for MSH/ECL/TMT/SOS | Rewritten to native set archive detail | **Implemented** |
| Reset-password credential links | Canonical HTTPS browser continuation | **Implemented, device evidence open** — never intercept reset credential in a custom scheme; successful browser completion resets the password and verifies the exact Auth account |
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
| Successful password-reset completion is mailbox proof for the exact reset-token Auth UUID; reset requests and failed reset attempts do not verify | **Implemented and production-released** |
| Provider-independent account access is not inferred from Patreon-only grants | **Implemented** |
| Failed/unknown Patreon status is not presented as Free | **Implemented** |
| Patreon disconnect removes Patreon grants without deleting other-provider/manual access | **Implemented** |
| Apple purchase is granted only after server verification of Apple-signed transaction data | **Implemented** |
| StoreKit appAccountToken is the signed Pack One Auth-user UUID and a subscription chain cannot migrate between Pack One accounts | **Implemented** |
| Apple expiry/revocation changes only apple-app-store grants; Patreon/manual access survives | **Implemented** |
| App Store Server Notifications are signature-verified, idempotent, stale-event resistant, and fail closed on app/product/account mismatch | **Implemented** |
| Signed-in affiliate visibility is authoritative/fail-closed | **Implemented** |

## D. Deliberate native/store differences

| Difference | Rationale / boundary |
| --- | --- |
| Provider-specific purchase surfaces | Patreon remains passive existing-account OAuth with no Patreon purchase link, price, or upgrade CTA. iOS sells equivalent Elite digital access only through Apple IAP. Android has no Google Play billing in this v1 change and therefore retains the passive existing-access membership surface. |
| Guides and policy copy are not duplicated into native source | Canonical HTTPS continuation prevents editorial/legal drift. |
| External credential reset remains canonical HTTPS | Avoids exposing reset credentials to interceptable custom schemes. |
| Affiliate links are restricted to reviewed surfaces | Revealed-card links live inside expanded score analysis; Daily-home fallback is outside active gameplay/results and fail-closed for ad-free/unknown signed-in membership. |
| Public-profile reads omit native account credentials | Public visibility is server-authoritative and should not create guest/native identity side effects. |
| iPad uses bounded responsive content widths rather than a separate product fork | Practice, Draft Run/results, article surfaces and other first-class screens are bounded; physical portrait/landscape acceptance is still required. |

## E. Automated evidence and release gates

### Merged implementation evidence

- Password-reset mailbox proof shipped through PR #705 and secure-auth release run **36357289329**. Unit coverage verifies exact-user `emailVerified:true` finalization only after provider reset success and session revocation on post-password verification-finalization failure; Chromium/WebKit mobile password-recovery and email-verification contracts passed before release.
- Shared-run recovery, invitation, Home recovery and actual DraftRun reuse are covered by mounted production-screen suites.
- Membership has mounted controller/screen/API coverage for provider-independent grants, unknown/error states, OAuth return, disconnect and identity races.
- Public-profile/Career coverage includes account switching, privacy revocation, pagination, sharing and stale-response guards.
- Archive/Home affiliate/Learn/iPad work added mounted production-screen or release guards instead of source-only assertions.
- The integrated mobile command now exercises **150 mounted tests** before lint, strict TypeScript, Expo config and release preflight.

### Deterministic-build evidence

PR #637 merged as `aeba264e00466991a2fd2ec5806f621cfe18a430` after all six exact-head workflows passed. It pins Node/npm and npm lock inputs, uses `npm ci` in mobile/iOS/Android workflows, pins the Expo SDK 57-compatible React DOM / Reanimated / Worklets peer set, and the integrated mobile run executed 150/150 mounted tests before lint, strict TypeScript, Expo config and production preflight.

### Exact-main RC mechanism and current recertification

PR #648 merged as `528ed80a0c15afb9760ba2b71d8c4693e342324a` and adds a store-free exact-main RC smoke workflow. It:
- refuses non-main or stale-main execution;
- re-checks that the source SHA is still current main after both native builds finish;
- runs deterministic mobile validation;
- creates an unsigned production iOS archive and an Android production bundle;
- uploads GitHub Actions artifacts plus a SHA/version manifest; and
- has no App Store Connect, Google Play, release-environment or store-publishing credentials.

The first main run began on `528ed80a...` and became stale when #651 advanced main, as designed. #654 then widened recertification coverage for release-workflow changes, and #656 changed exact-main concurrency so obsolete runs cancel when a newer qualifying main run starts.

Workflow **36278475765** subsequently completed green on exact current main `8956f8c5011a7bdffd71c2184a5006558b362d69`. Validation, the unsigned iOS production archive, Android production bundle and final evidence job all passed. The evidence job re-fetched `main` after both native builds and confirmed that the source SHA had not moved. It records App Store version **1.0**, Play version name **1.0** and `publication: none`. The unsigned iOS artifact ZIP digest is `882be6c7e6218b39316857634832e2b7ad1483c576423b217980cedefa80af60`; the Android RC artifact ZIP digest is `7d4720461e7b080ed69931f47535a959076d7b42aa2fc3b318bf0d91a0c70246`, with versionCode **300003**.

This historical exact-main evidence does not certify the current repair. Apply the source-freeze rules in [the release runbook](mobile-release-runbook.md#exact-main-source-freeze-before-signed-candidates): any later shipped runtime, configuration, dependency or binary build-input change requires new certification. A documentation/store-control-only compare must prove binary-input equivalence and be recorded in #575; it must never be presented as a smoke run on a different SHA.

### Release evidence still open

- Completion of the guarded #651 card-image normalization / production gameplay smoke after the Titania display-art fix.
- Physical iPhone acceptance on the exact signed TestFlight RC.
- Physical iPad portrait/landscape/accessibility acceptance and App Store screenshots.
- Physical Android acceptance on the exact Play Internal/Closed Testing RC.
- Upgrade-path acceptance from prior store builds.
- Sign in with Apple normal + Hide My Email, relay email and deletion/revocation acceptance.
- Hosted `.well-known/apple-app-site-association` and `.well-known/assetlinks.json` verification using the real Apple Team ID and Google Play **app-signing** certificate.
- App Store Connect subscription group/product `pro.packone.app.elite.monthly`, pricing/localization/review metadata, and App Store Server Notifications V2 production+sandbox URLs configured for the final app.
- TestFlight/Sandbox acceptance for Apple subscribe, server verification, renewal, cancellation-at-period-end, billing grace, refund/revocation, Restore Purchases, Manage Subscription, account switching, and duplicate-provider protection.
- Signed binary hashes/build numbers and exact backend/gateway release recorded against the final store RCs.
- App Store / Play Console metadata, app-content declarations, reviewer access and production-access qualification.
- Explicit owner approval before TestFlight/Play/store publication.

## Parity-change rule going forward

A user-facing web change is not complete for v1 maintenance until one of these is recorded:

1. native behavior changes with it and behavioral coverage is updated;
2. the feature is already backed by the same server/canonical content and native behavior remains equivalent; or
3. a deliberate native/store difference is recorded in section D with the reason and acceptance evidence required.

Do not use matching strings, route names, or source-file existence as parity evidence. Prefer mounted behavior, server-authority contracts, live route tests and exact-candidate device/store evidence.
