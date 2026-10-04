# Pack One mobile store submission packet

Updated 2026-10-02. This file is the source-of-truth submission packet for the first free public mobile release.

## Current store release checkpoint — 2026-10-02

- **iOS 1.0 current post-#837 candidate:** signed build `100415`, source revision `fa588b40bc380946735385abfac0ff52586e1873`. GitHub Actions run `36957484955` uploaded it; App Store Connect reported `processingState=VALID` and `buildAudienceType=APP_STORE_ELIGIBLE`, and the workflow attached build `100415` to App Store version 1.0. Release type remains manual.
- **Android 1.0 current post-#837 candidate:** versionCode `100444`, source revision `fa588b40bc380946735385abfac0ff52586e1873`. Build run `36957485029` produced the Play-signed production AAB and exact-artifact release run `36965315032` uploaded it unchanged to Internal Testing, then promoted that same version unchanged to Closed Testing `production-access`. Google reported `releaseStatus=completed`, `requiresConsoleRollout=false`, and `committed=true`. VersionCode `100444` is the live qualification-track candidate.
- **Closed-test geography:** the `production-access` track targets Canada and the United States. Legacy `alpha` is not the qualification track.
- **Apple public availability:** the owner completed first-time App Store availability setup for **United States + Canada only** in App Store Connect on 2026-10-01. The repo now carries a read-only API verifier; it must confirm exactly `CAN,USA`, `availableInNewTerritories=false`, and no pre-order state.
- **Store assets:** Apple iPhone/iPad screenshots and the Elite review screenshot are uploaded. Google Play has the reviewed icon, five phone screenshots, and the feature graphic committed. Re-capture only if the final accepted RC materially changes a captured scene.
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
- Terms: https://packone.pro/terms/
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

Pack One is unofficial Fan Content permitted under the Wizards Fan Content Policy and is not approved or endorsed by Wizards. Card metadata and images are sourced from Scryfall. See packone.pro/terms/ for attribution and source-license details.

### App Review notes

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

These revised instructions apply only to a candidate containing #910. Do not use the October 2 builds (iOS 100415 / Android 100444) to accept this repair.

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
1. Open Account and sign in with the supplied demo credentials.
2. Open Practice.
3. Verify regular practice.
4. Verify Elite Powered Cube and custom-set practice.
5. Open Career and Leaderboard.
6. Verify sign-out. Do not delete the shared review account during routine review.

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

1. **Finish any remaining App Review Information contact/notes fields.**
   - The non-expiring reviewer credentials are already entered in App Store Connect.
   - App Store Connect -> Apps -> Pack One -> version 1.0 -> **App Review Information**.
   - Confirm the review contact **name, phone, and email** are filled in.
   - Confirm the **Notes** field contains the prepared review instructions/reviewer path in this document.
   - Do not submit the app for review until the exact iOS RC has completed the separate physical-device acceptance gates in issue #575.

Physical iPhone/iPad acceptance remains separate and is intentionally not listed here.

### Google Play Console

2. **Wait for the closed-test qualification clock to complete.**
   - All currently available Google Play console setup is complete, including App content, Ads, Sign-in details/App access, Target audience/content, IARC content rating, Data Safety, store assets/listing, and Production countries **United States + Canada**.
   - Leave **Closed testing -> production-access** unchanged while the qualification clock is running.
   - Keep at least 12 testers continuously opted in for the required 14-day period.
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
- attaching the current successful App Store-eligible iOS RC to App Store version 1.0; post-#837 build `100415` is already `VALID`, `APP_STORE_ELIGIBLE`, and attached by run `36957484955`;
- building/uploading/promoting the Android RC; versionCode `100444` is already signed, uploaded, and active on `production-access`;
- Google Data Safety or store graphics (already done);
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

