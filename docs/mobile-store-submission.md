# Pack One mobile store submission packet

Updated October 11, 2026. This remains the source-of-truth **first public release (1.0) submission packet**. The separate [iOS 1.1 exact-build feature and release inventory](mobile-ios-1.1-testflight-inventory-2026-10-10.md) records the newer TestFlight 1.1/100733 candidate, its complete included/excluded scope and why it is not an App Store 1.1 release. **Do not substitute the 1.1 TestFlight upload for the 1.0 App Review submission or silently change the 1.0 reviewer metadata.**

## Current TestFlight 1.1 candidate — October 10, 2026

- **iOS 1.1 / 100733**, signed binary source `67c6d25917f3e8b632922b80c7a5479ca897af9f`: [run 38075036098](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/38075036098) uploaded successfully and Apple reported `VALID` / `APP_STORE_ELIGIBLE`. The owner can see it in TestFlight; internal-group association was **not** independently reverified by the failed finalizer.
- **The workflow failed after upload**, at **`App Store version 1.1 was not found`**. There is no confirmed editable 1.1 App Store record, build attachment, 1.1 submission, 1.1 approval, or public 1.1 release. Current 1.0 review state must be read from Apple before any further version-record or submission operation.
- Comparison of the signed source with current-main snapshot `a2cf1e139b0fffadafc1e502f6b731200e6dd6a1` shows no later iOS/React Native app changes. The 1.1 binary **includes** October 7 native About/legal/navigation parity (#1057), Beat the Creator native flows (#985/#1001), Daily post-pick peer UI and trophy records (#1129) and prior original v1 repairs. **It does not include** the subsequent website-only copy fix (#1132) as native code; native already uses grammatical text.
- **Peer comparison live:** [#1136](https://github.com/killjoy00/mtg-ev-analyzer/pull/1136) and [#1139](https://github.com/killjoy00/mtg-ev-analyzer/pull/1139) are released; the endpoint reaches the Draft backend from browser and native clients. No new iOS build was needed. Physical acceptance, Apple purchase lifecycle and the original #575 owner/store gates remain open.
- **Android is separately 1.0**. AAB versionCode **100740** (same source `67c6d259` as iOS 100733) was accepted into Google Play's bundle library ([run 38079116799](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/38079116799)). On October 11 the owner authorized promoting it to the existing `production-access` closed-test track, replacing 100698. Testers, groups and countries are unchanged; see #575 for the run result.

The October 4 signed candidates in the next section remain **historical 1.0 repair/qualification evidence**, not the newest iOS TestFlight build.

## Historical 1.0 native-repair test candidates — 2026-10-04 CDT

Final signed binary source: `747478440400e242aae32469d6ed18f1785b591d` (protected #963 merge). The mobile app, native configuration, dependencies and binary build workflows match certified runtime `3a8244eb0568769c133365ea2821d512c62a3515`; exact-main certification run `37244011180` is attributed to that earlier SHA, not relabelled as the delivery source. Concurrent #961 operations and #962 admin/backend work are preserved. Later #964/#965/#966 change release controls/probes and the gateway release request, with no mobile binary-input or supplied web-reference changes. #962 changes the production smoke contract, not the mobile binary inputs. Later #969 changes hosted social-preview metadata and assets, including index.html Open Graph/Twitter image references; it does not change visible homepage UI or mobile binary inputs. The final control-source refresh through #971 preserves that work.

- **iOS 1.0 / 100505:** signed run `37247429564`, Apple build `ba5e31a1-8e53-4123-b014-dcd883d83171`; `VALID`, `APP_STORE_ELIGIBLE`, attached to editable App Store 1.0, and verified internal `IN_BETA_TESTING` with the existing all-builds group. No tester/group mutation or App Review submission. External `READY_FOR_BETA_SUBMISSION` is not external distribution.
- **Android 1.0 / 100491:** signed Internal run `37247429578` accepted and committed the bundle as draft; exact-version promotion run `37249437434` reports existing `production-access`, `completed`, `committed=true`, `requiresConsoleRollout=false`, `createdTrack=false`. No rebuild, tester/country/track change or Production release.
- **Store images:** final main-source capture `37244011193` passed every job. All 17 original Android/iPhone/iPad/membership images were individually inspected and approved. Apple replacement run `37251116289`, after processing-only fix #971, verified five iPhone, five iPad and the subscription review image after provider processing/order checks. Play run `37249880752` committed and independently verified five phone screenshots and the identical approved icon; feature graphic untouched.

Original provider results and source-attributed delivery metadata are retained in [mobile-evidence/575-native-3a8244eb/README.md](mobile-evidence/575-native-3a8244eb/README.md). Prior core repair builds iOS 100500 / Android 100488 remain historical evidence and exclude #960. At the October 4 1.0 repair checkpoint, upgrades from iOS 100415 / Android 100444 targeted **100505 / 100491**. **For current iOS 1.1 physical acceptance, use 100733**; for Android, confirm the tester device has updated to 100740 after the October 11 closed-track promotion.

Physical upgrades, iOS gestures, iPad landscape/narrow windows, accessibility, real auth/billing/deletion and provider reviewer Notes reconfirmation remain open in #575. No App Review submission or public release is authorized by this delivery.

## Historical distributed checkpoint — 2026-10-02

These earlier binaries predate #890/#910/#955 and are upgrade starting points, not repair acceptance targets.

- **Previously distributed iOS 1.0 post-#837 candidate:** signed build `100415`, source revision `fa588b40bc380946735385abfac0ff52586e1873`. GitHub Actions run `36957484955` uploaded it; App Store Connect reported `processingState=VALID` and `buildAudienceType=APP_STORE_ELIGIBLE`, and the workflow attached build `100415` to App Store version 1.0. Release type remains manual.
- **Previously distributed Android 1.0 post-#837 candidate:** versionCode `100444`, source revision `fa588b40bc380946735385abfac0ff52586e1873`. Build run `36957485029` produced the Play-signed production AAB and exact-artifact release run `36965315032` uploaded it unchanged to Internal Testing, then promoted that same version unchanged to Closed Testing `production-access`. Google reported `releaseStatus=completed`, `requiresConsoleRollout=false`, and `committed=true`. VersionCode `100444` was the qualification-track candidate before replacement by 100488.
- **Closed-test geography:** the `production-access` track targets Canada and the United States. Legacy `alpha` is not the qualification track.
- **Apple public availability:** the owner completed first-time App Store availability setup for **United States + Canada only** in App Store Connect on 2026-10-01. The repo now carries a read-only API verifier; it must confirm exactly `CAN,USA`, `availableInNewTerritories=false`, and no pre-order state.
- **Historical store assets:** The prior Apple/Play set predated #910 and was replaced by the reviewed final main-source captures, with the successful provider results recorded above. The approved icon and feature graphic remain unchanged.
- **Google Play console setup:** complete for the currently available first-launch forms/settings: Ads, Sign-in details/App access, Target audience/content, IARC content rating, Data Safety, listing/assets, and Production countries **United States + Canada**. The remaining Google owner gate is the closed-test qualification clock followed by the Production-access application when Google enables it.
- **Google Data Safety:** submitted successfully by run `36632174516`.
- **Apple metadata already live:** version 1.0 is manual release; the en-US listing copy, privacy policy/choices URLs, content-rights declaration, and reviewed 12+ age-rating answers are present.

## Shared release identity

- App name: `Pack One`
- iOS bundle ID: `pro.packone.app`
- Android package: `pro.packone.app`
- Marketing version: `1.0`
- Marketing URL: https://packone.pro/
- Support URL: https://packone.pro/contact/
- Privacy policy: https://packone.pro/privacy/
- Privacy choices / account deletion: https://packone.pro/privacy/#delete-account
- Terms: https://packone.pro/terms/

## Apple Elite subscription

- Product ID: `pro.packone.app.elite.monthly`
- Type: auto-renewable subscription
- Display name: Pack One Elite
- Price: **$7.00/month in the United States**. The live localized price shown to users must still come from App Store Connect / StoreKit. Canada uses Apple's adjusted equalization from the U.S. $7.00 price point.
- Benefits: Powered Cube practice and custom-set practice on the signed-in Pack One account. Regular Draft Run practice remains included without Elite.
- Restore Purchases and Manage Apple Subscription are first-class controls on the native Membership screen.
- Apple Standard Terms of Use (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
- Pack One supplemental terms: https://packone.pro/terms/
- Privacy: https://packone.pro/privacy/
- App Store Server Notifications V2 Production and Sandbox URL: `https://api.packone.pro/growth/v1/apple-subscriptions/notifications`
- Review account must be able to sign in to Pack One before purchasing so the StoreKit `appAccountToken` can bind the transaction to the exact Pack One account.
- Patreon is shown only as an existing-account connection. There is no Patreon purchase, price, join, or upgrade CTA in the iOS app.

- Support email: `admin@packone.pro`
- Default language: English (U.S.)
- Initial public regions: **United States and Canada only**.

## Apple App Store

### Product page

- Name: `Pack One`
- Subtitle: `Practice real draft decisions`
- Primary category: Games
- Game subcategories: Card, Strategy
- Promotional text:
  `Make eight picks from real trophy drafts, compare your choices with the original drafter and model-supported alternatives, and build your Pack One career.`
- Keywords:
  `limited,draft,card,booster,pick,practice,strategy,leaderboard,training,trophy`

### Description

Pack One is a short Limited draft-decision game built from real trophy drafts.

Make eight picks with the original drafter's earlier cards visible. Lock each choice before you see the trophy drafter's pick and Pack One's model-supported alternatives. Matching the trophy pick earns 100 points; strong alternatives can still receive partial credit.

Three fixed Daily challenges refresh each day:
- Daily Draft Run
- Daily Powered Cube
- Daily Latest Set

Everyone gets the same decisions for each Daily, so scores are directly comparable.

Keep practicing between Dailies with regular random runs. A free Pack One account adds leaderboard participation, career history, and cross-device continuity.

Your Pack One account works across web, iPhone, iPad, and Android. Sign in with Apple, Google, or email. Account deletion is available in the app.

Pack One is unofficial Fan Content permitted under the Wizards Fan Content Policy and is not approved or endorsed by Wizards. Card metadata and images are sourced from Scryfall. See https://packone.pro/terms/ for attribution and source-license details.

Terms of Use (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
Pack One Terms: https://packone.pro/terms/
Privacy Policy: https://packone.pro/privacy/

### App Review notes

**App Review metadata repair — 2026-10-06:** Apple stopped review of iOS 1.0 because the auto-renewable subscription listing did not include a functional Terms of Use (EULA) link in the App Store product-page metadata. Pack One uses Apple's standard EULA, not a custom App Store Connect license agreement. The en-US App Store description now includes the full Apple standard EULA URL, the Pack One Terms URL, and the Privacy Policy URL. This is a metadata-only correction and does not require a new binary.

Pack One can be used without an account for the three Daily challenges. Account features include leaderboard participation, saved career/history, regular practice, and cross-device continuity.

Sign-in methods:
- Sign in with Apple
- Google
- Email/password

Email/password recovery uses the Pack One reset email and canonical HTTPS reset page. Successfully completing that reset both changes the password and marks the same account email verified; a reviewer does not need to complete a second verification-email step after a successful reset. Requesting a reset alone does not verify an account.

The iOS app includes the native Pack One Elite auto-renewable subscription through Apple's StoreKit flow. The Membership screen shows the live App Store price, supports purchase and Restore Purchases, and links to Apple subscription management after an Apple subscription is linked. The Pack One backend verifies the Apple-signed transaction before granting Elite capabilities or finishing the transaction.

Native Patreon interaction remains limited to existing-account OAuth authentication and membership reconciliation; the iOS app does not provide a Patreon purchase, price, join, or upgrade CTA. Provide a non-expiring reviewer account for account-only review paths, but reviewers can also exercise the Apple IAP flow from the Membership screen. Do not place reviewer credentials in this repository; enter them only in App Store Connect Review Information.

Reviewer path for the native navigation repair (#910):
1. Signed out, use Daily / How to Play / Sign in. How to Play opens the quick start directly and includes a Play Daily Draft Run action.
2. Signed in, use the Daily / Practice / Leaders / Learn / My Pack One bottom tabs. Root tabs have no Back button; child screens return with a human-readable Back label.
3. In Practice, verify free regular practice and, with Elite access, Powered Cube and custom-set practice.
4. Complete eight picks, open decision review, then return to Daily or Practice. Results retain the actual attempt.
5. Open a player from Leaders and return. My Pack One shows the member dashboard, with a welcome/play action for a new account.
6. Open My Pack One → Account settings for profile, membership, sign-in/security, sign-out and permanent deletion. Help and policies are available from Help or Account settings.
7. Shared invitations require explicit acceptance. Practice shows Continue shared run / View shared result only for a valid identity-bound checkpoint on this device; it is not a cloud history list.

**These seven historical reviewer steps apply to iOS 1.0/100505 and Android 1.0/100491**, containing #890/#910/#955/#960. They are not the complete iOS 1.1 navigation instructions. Do not use the October 2 builds (iOS 100415 / Android 100444) to accept this repair.

**Future iOS 1.1 review-note delta (not submitted):** In 100733 the legacy Help stack is gone. Reviewers should find in-app **About, Support, Privacy and Terms** screens through About or their native entry points, use **Stats / Account settings** from My Pack One, and see the larger Daily **Play now / View result** buttons. Beat the Creator challenge invitations can replay completed Practice or Daily sources without creating another ranked Daily. New post-lock peer percentages are live since #1136 but appear **only after ten real players have locked the same Daily pick**, so do not promise them to a reviewer. Validate/report the original iOS 1.0 review state before replacing its Notes with any 1.1-specific instructions. See [iOS 1.1 exact-build feature and release inventory](mobile-ios-1.1-testflight-inventory-2026-10-10.md).

Apple-linked account deletion requires fresh Apple authorization and revokes the Apple authorization before provider cleanup completes.

Release setting: **Manually release this version** after App Review approval.

### Privacy labels - conservative v1 declaration

Native Pack One has no ad SDK, no third-party analytics SDK, no location permission, no contacts access, and no camera/microphone feature. The iOS app uses StoreKit through `expo-iap` for Pack One Elite. Apple handles payment credentials; Pack One receives and stores subscription transaction/entitlement state needed to verify and operate Elite access.

Declare data collected by Pack One as follows, subject to final App Store Connect wording:
- Contact Info -> Name: collected for account/profile functionality; linked to the user; not used for tracking.
- Contact Info -> Email Address: collected for account, verification, recovery, and deletion; linked to the user; not used for tracking.
- Identifiers -> User ID: Pack One player/account identifiers are collected for app functionality and analytics; linked when signed in; not used for tracking.
- Purchases -> Purchase History: Apple subscription transaction/entitlement identifiers and state are collected for app functionality and account management; linked to the signed-in Pack One account; not used for tracking.
- Usage Data -> Product Interaction: gameplay starts, choices, scores, completions, and related product events are collected for app functionality and product analytics; may be linked to the Pack One player/account; not used for tracking.

Do not declare:
- Payment information
- Precise or approximate location
- Contacts
- Photos/videos
- Audio
- Health/fitness
- Sensitive information
- Advertising data
- Tracking across other companies' apps/sites

Privacy Policy URL: https://packone.pro/privacy/
User Privacy Choices URL: https://packone.pro/privacy/#delete-account

### Content rights

Pack One displays third-party card names/art and uses licensed/public draft data. The Terms page records:
- 17Lands public datasets / CC BY 4.0 attribution
- Scryfall card metadata/image sourcing
- Wizards intellectual-property ownership
- Wizards Fan Content Policy notice

Complete the App Store Connect Content Rights declaration from the already-approved Pack One rights record. This submission packet does not reopen or re-adjudicate that resolved rights review.

### Age rating

Answer the questionnaire from the actual app content. The product has:
- no gambling or wagering
- no loot boxes
- no sexual content authored by Pack One
- no drugs/alcohol/tobacco feature
- no direct messaging/chat
- no unrestricted web browser

Card artwork can contain fantasy combat/violence. Review a representative current card-image sample before choosing Apple's violence-frequency answers; do not submit a zero-violence answer solely from code inspection.

### Screenshots

The repository includes a deterministic store-screenshot harness that renders the **real native Pack One screens and components** with review-safe fixture data. It runs only under the isolated `pro.packone.preview` bundle/package IDs; `EXPO_PUBLIC_PACKONE_SCREENSHOT_FIXTURES=1` is explicitly rejected when `EXPO_PUBLIC_PACKONE_ENV=production`.

The guarded `Mobile store screenshots` workflow captures:
1. Daily decision screen — `Eight decisions. One score.`
2. Reveal/comparison screen — `Compare with a real trophy draft.`
3. Daily hub — `Three fresh Dailies.`
4. Practice screen — `Keep drafting between Dailies.`
5. Career/leaderboard — `Track your Pack One career.`
6. iOS Membership purchase state for the App Store subscription review screenshot.

Capture outputs are generated for iPhone, iPad, and Android from the same production screen implementation. Before upload, visually compare the generated scenes against the accepted 1.0 RC and recapture any scene whose production layout or copy has materially changed. #910 changes Daily, Practice, Career, typography and feedback, so the earlier screenshot set is not evidence for this candidate. Only passing native captures identified in the repair ledger may replace those store assets; failed diagnostic captures must not be uploaded.

Apple allows 1-10 screenshots per supported device size. Pack One v1 supports iPad (`ios.supportsTablet=true`), so iPad-specific QA and required iPad App Store screenshots remain mandatory.

## Google Play

### Main store listing

- App name: `Pack One`
- Category: Game -> Card
- Short description:
  `Practice real draft decisions, compare trophy picks, and track your career.`

### Full description

Pack One turns real trophy drafts into short, repeatable draft-decision practice.

Make eight picks with the original drafter's earlier cards visible. Lock your choice, then compare it with the trophy drafter's actual pick and Pack One's model-supported alternatives.

Three fixed Daily challenges refresh each day:
- Daily Draft Run
- Daily Powered Cube
- Daily Latest Set

Everyone gets the same Daily decisions, so scores are directly comparable.

Practice between Dailies with random runs. A free Pack One account adds leaderboard participation, career history, and cross-device continuity. Existing Elite access unlocks Powered Cube and custom-set practice.

Use the same Pack One identity on web, iPhone, and Android with Apple, Google, or email sign-in. Permanent account deletion is available in the app.

Pack One is unofficial Fan Content permitted under the Wizards Fan Content Policy and is not approved or endorsed by Wizards. Card metadata and images are sourced from Scryfall. See packone.pro/terms/ for attribution and source-license details.

### App content declarations

- Ads: **Yes (conservative declaration).** Native Pack One renders a dedicated, clearly disclosed Daily-home TCGplayer sponsored affiliate promotion/banner outside gameplay, plus contextual revealed-card affiliate links. The binary has no third-party ad SDK and does not use an advertising ID.
  - Rationale: Play's ads declaration explicitly covers display/native/banner advertising but does not specifically classify every affiliate link as an ad. Pack One therefore bases the conservative **Yes** on the dedicated banner-like sponsored promotion, not on contextual revealed-card links alone.
- App access: Some features are available without login; account and Elite features require access. Supply one non-expiring Elite reviewer account in Play Console Sign-in details. Do not store its password in Git.
- Privacy policy: https://packone.pro/privacy/
- Account deletion URL: https://packone.pro/privacy/#delete-account
- Target audience: default recommendation is ages 13 and over; do not select under-13 groups unless the product is intentionally redesigned for children.
- Content rating: complete IARC from the actual content. No gambling/wagering/chat. Card art may contain fantasy violence and must be reflected accurately.
- Data safety: use the declaration below.
- Contains ads: **Yes** as the conservative declaration because Pack One contains the dedicated Daily-home sponsored affiliate promotion/banner; there is still no ad SDK or advertising ID.
- In-app purchases: No for v1; Pack One does not sell digital access in the Android app.

### Data safety - conservative v1 declaration

Security:
- Data encrypted in transit: Yes
- Users can request deletion: Yes
- In-app deletion: Yes
- External deletion resource: https://packone.pro/privacy/#delete-account
- Data sold: No

Collected data:
- Personal info -> Name: optional account/profile data; app functionality/account management.
- Personal info -> Email address: optional account/authentication data; account management, verification, recovery, deletion.
- App activity -> App interactions: game starts, picks, scores, completions and related usage; app functionality and analytics.
- Device or other IDs -> User IDs: Pack One player/account identifiers; app functionality and analytics.

Do not declare collection of location, contacts, photos/videos, audio, health, financial/payment data, advertising ID, or crash telemetry unless the mobile implementation changes before submission.

The app uses Apple/Google identity providers and infrastructure/service providers to operate the service. Re-evaluate Play's current definition/exclusions for "data sharing" in the console against the exact provider relationships at submission time; do not mark data as sold or used for advertising/tracking.

### Reviewer instructions

If the supplied email/password reviewer account ever needs recovery, complete the emailed Pack One password-reset link. A successful reset also verifies that exact account email; do not expect a separate verification step afterward.

Commercial-content note for review: Pack One includes disclosed TCGplayer affiliate links to a third-party marketplace for physical cards. Pack One does not process those purchases, does not use an ad SDK or advertising ID, and does not place the Daily-home promotion inside active gameplay/results.

Guest path:
1. Launch app.
2. Choose any Daily.
3. Complete a run and view the result/share UI.

Account path:
1. Use the Sign in tab with the supplied demo credentials. The member tabs are Daily / Practice / Leaders / Learn / My Pack One.
2. Open Practice and verify free regular practice.
3. With Elite access, verify Powered Cube and custom-set practice.
4. Complete a run, open decision review, and return to the existing Practice tab.
5. Open Leaders → player profile → Back, then My Pack One → Account settings → Back.
6. Practice offers Continue shared run or View shared result only for a valid checkpoint belonging to this account on this device.
7. Verify sign-out from My Pack One → Account settings. Do not delete the shared review account during routine review.

### Graphics

Required Play assets:
- 512x512 store icon
- 1024x500 feature graphic, JPEG or 24-bit PNG without alpha
- at least two screenshots to publish; use at least four 1080px portrait screenshots for stronger merchandising eligibility

Recommended phone screenshot story mirrors iOS:
1. Daily decision
2. Pick reveal / model comparison
3. Three-Daily hub
4. Practice
5. Career / leaderboard

Use the repository's deterministic native screenshot harness rather than mock marketing UI, then visually verify the generated scenes against the accepted 1.0 RC before upload.

### Release / publishing settings

- Managed Publishing is intentionally **not** used for the first Pack One production launch; the owner chose the normal publishing flow and will control the production release directly.
- Closed testing must be completed before production access if Play requires it for this developer account.
- The first production release does **not** offer a staged rollout percentage; Google documents staged percentages for updates, not the first production release. The first production release goes to all users in the selected production countries.
- Initial public regions: **United States and Canada only**.

## Owner-only non-device actions still required

Only unfinished owner actions are listed here. Completed, intentionally declined, and intentionally skipped items are omitted so this section functions as an actionable launch checklist.

### Apple / App Store Connect

1. **Reconfirm App Review Notes against the final repaired navigation.**
   - The non-expiring reviewer credentials are already entered in App Store Connect.
   - App Store Connect -> Apps -> Pack One -> version 1.0 -> **App Review Information**.
   - Review contact fields and credentials are already configured; the remaining check is the updated Notes.
   - Confirm the **Notes** field contains the prepared review instructions/reviewer path in this document.
   - Do not submit the app for review until the exact iOS RC has completed the separate physical-device acceptance gates in issue #575.

Physical iPhone/iPad acceptance remains separate and is intentionally not listed here.

### Google Play Console

2. **Wait for the closed-test qualification clock to complete.**
   - All currently available Google Play console setup is complete, including App content, Ads, Sign-in details/App access, Target audience/content, IARC content rating, Data Safety, store assets/listing, and Production countries **United States + Canada**.
   - Keep at least 12 testers continuously opted in for the required 14-day period. Google counts this per tester: testers who opt out before 14 days don't count, and an opt-out restarts that tester's 14 days ([Play Console Help](https://support.google.com/googleplay/android-developer/answer/14151465)).
   - Updating the build on **Closed testing -> production-access** (as on October 7 and 11) does not opt testers out; Google recommends updating the app during closed testing. Do not remove testers, change groups or create a new track while the clock is running.
   - No owner action is required unless Play reports that tester count/continuity was broken.

3. **Apply for Production access when Google enables the application.**
   - When Play Console says the testing requirement is satisfied, open the Production access application.
   - Answer Google's questions about the closed test, tester engagement/feedback, app purpose, and production readiness truthfully.
   - Submit the application.
   - Record the submission date and later the approval date in issue #575.

### Not owner-only / leave to automation

Do **not** spend console time on these unless an automated probe reports a problem:
- Google Cloud WIF narrowing and the repo-side non-publishing Google Play access probe are complete; run `37017937127` passed on `main` and verified WIF authentication, Play track-read access, and Play signing fingerprint coverage in `.well-known/assetlinks.json`;
- uploading/replacing the current RC binaries;
- **historical 1.0 attachment:** repair builds 100500 and later 100505 had separate verified App Store 1.0 attachment/availability evidence; the automated finalizer did **not** attach 1.1/100733; the owner reports a 1.1 version now exists in App Store Connect, and selecting 100733 for it is an owner step not yet independently verified;
- **Android closed-test candidate:** repair 100488, 100491 and 100698 had verified promotion; **100740** promotion to `production-access` was authorized on October 11 (see #575 for the run);
- Google Data Safety (already done) or replacement store graphics after reviewed-main capture and visual inspection;
- App Store listing copy, manual-release flag, reviewed age-rating answers, or content-rights declaration (already present);
- release-track/API status audits;
- App Store/Play production release mechanics after all prerequisites and explicit owner approval — these can be handled through the guarded API workflows.

## Public identity / UGC safeguards for store review

Pack One has no posts, comments, DMs, image uploads, or anonymous chat. Its user-generated-content surface is limited to an account-owned public username/profile identity that can appear on leaderboards, public profiles, and attributed shares.

Reviewer notes should state the following safeguards exactly:

- only signed-in accounts appear on leaderboards; the sign-in/sign-up screens and the leaderboard-name/public-profile save controls state that continuing or saving means agreeing to the Pack One Terms, including the **Public Identity rules**, and saving records the accepted rules version;
- Pack One rejects clearly prohibited usernames server-side, including severe abusive content, Pack One staff impersonation, contact/URL patterns, and invisible/control-character abuse;
- public profiles expose in-app **Report** and **Block** controls on web, iOS, and Android;
- reports are persisted with reporter, target, reason, status, and timestamps, with duplicate-open-report suppression;
- blocking removes the target identity from the blocking viewer's personalized public-profile/leaderboard experience where viewer identity is available;
- authenticated admin moderation can hide a public identity, records an audit action, resolves open reports as appropriate, and scrubs attributed shared identity without deleting gameplay/career history;
- a moderated identity cannot republish until an admin restores eligibility, and restore does not automatically re-own or republish the old name;
- private profiles remain private by default; gameplay data is not made public merely by signing in;
- community rules and a contact path are published in Pack One Terms and at **admin@packone.pro**.

Moderation operations and response procedure are documented in `docs/PUBLIC-IDENTITY-SAFETY.md`.

