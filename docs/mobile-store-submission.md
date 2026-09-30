# Pack One mobile store submission packet

Updated 2026-09-30. This file is the source-of-truth submission packet for the first free public mobile release.

## Current store release checkpoint — 2026-09-30

- **iOS 1.0:** signed build `100321`, source revision `5fce31805e277a1d234ff40ad3df381faf75602c`. GitHub Actions run `36722154047` uploaded the build, App Store Connect reported `processingState=VALID` and `buildAudienceType=APP_STORE_ELIGIBLE`, and the workflow attached that exact build to App Store version 1.0. Release type remains manual. The earlier build `100311` was TestFlight Internal Only and is not the customer-submission RC.
- **Android 1.0:** signed versionCode `100311`, source revision `c04ab3ba9f9def47708c67c2581596bcbd35f5c4`. Internal upload run `36663310963` committed it to Google Play Internal Testing. Closed-testing run `36668780511` then promoted the same bundle unchanged to the existing `production-access` Closed Testing track with `releaseStatus=completed`, `requiresConsoleRollout=false`, and `committed=true`.
- **Closed-test geography:** the owner confirmed the `production-access` track is active and targets Canada and the United States. The failed `alpha` attempt is not the qualification track and was rejected before commit because that track targeted no countries.
- **Store assets:** Apple iPhone/iPad screenshots and the Elite review screenshot are uploaded. Google Play has the reviewed icon, five phone screenshots, and the feature graphic committed.
- **Google Data Safety:** submitted successfully by run `36632174516`.
- **Apple metadata already live:** version 1.0 is manual release; the en-US listing copy, privacy policy/choices URLs, content-rights declaration, and reviewed 12+ age-rating answers are present.
- **Source equivalence note:** the changes between Android RC source `c04ab3b` and current `5fce318` are release-control/test files only; no Android/iOS application runtime source changed. The current exact-main RC smoke run `36722154500` also passed all stages.

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

Reviewer path after sign-in:
1. Home -> Practice
2. Verify regular practice is available
3. Verify Powered Cube practice is available
4. Verify custom-set practice is available
5. Career shows completed-game history
6. Account screen supports sign-out and permanent deletion

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

Capture outputs are generated for iPhone, iPad, and Android from the same production screen implementation. Before upload, visually compare the generated scenes against the accepted 1.0 RC and recapture any scene whose production layout or copy has materially changed.

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

- Ads: **Yes**. Native Pack One intentionally renders clearly disclosed TCGplayer affiliate promotional links (the Daily-home fallback and reviewed revealed-card destinations). The binary still has no third-party ad SDK and does not use an advertising ID.
  - Rationale: Google Play's current App Content guidance requires an ads declaration and explicitly includes display/native/banner ads; its examples are non-exhaustive. Pack One's affiliate promotional surfaces are therefore declared conservatively as ads even though they are first-party-rendered links rather than an ad SDK.
- App access: Some features are available without login; account and Elite features require access. Supply one non-expiring Elite reviewer account in Play Console Sign-in details. Do not store its password in Git.
- Privacy policy: https://packone.pro/privacy/
- Account deletion URL: https://packone.pro/privacy/#delete-account
- Target audience: default recommendation is ages 13 and over; do not select under-13 groups unless the product is intentionally redesigned for children.
- Content rating: complete IARC from the actual content. No gambling/wagering/chat. Card art may contain fantasy violence and must be reflected accurately.
- Data safety: use the declaration below.
- Contains ads: **Yes** for Play's declaration because the app contains disclosed third-party affiliate promotional surfaces; this is true even though there is no ad SDK.
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

- Turn on Managed Publishing before sending store/app-content changes for review so approval does not accidentally publish changes immediately.
- Closed testing must be completed before production access if Play requires it for this developer account.
- The first production release does **not** offer a staged rollout percentage; Google documents staged percentages for updates, not the first production release. The first production release goes to all users in the selected production countries.
- Initial public regions: **United States and Canada only**.

## Owner-only non-device actions still required

These are the remaining **non-physical-device** actions confirmed to be outside the current ChatGPT/GitHub-connected tooling boundary: they require the account holder to use a logged-in provider console, enter private credentials, accept legal/financial terms, supply human testers, or make an account-owner attestation. Everything else should remain with the automated release path.

### Apple / App Store Connect

1. **Complete and publish App Privacy.**
   - App Store Connect -> Apps -> Pack One -> **App Privacy**.
   - Declare that Pack One collects data and use the conservative v1 declarations in this document: Name, Email Address, User ID, Purchase History, and Product Interaction; linked as described; no tracking.
   - Confirm the Privacy Policy URL is `https://packone.pro/privacy/`.
   - Publish the App Privacy answers.

2. **Enter the private App Review account credential and contact details.**
   - Open App Store version 1.0 -> **App Review Information**.
   - Enter the real review contact name, phone, and email.
   - Set demo account required as appropriate and enter the non-expiring reviewer account username/password directly in App Store Connect.
   - Do **not** put the reviewer password in Git, an issue, or chat.
   - Use the review notes and reviewer path already prepared in this document.

3. **Verify Apple agreements, tax, and banking are active for paid subscriptions.**
   - App Store Connect -> Business / Agreements, Tax, and Banking.
   - Confirm there is no agreement, tax-form, or banking action blocking paid auto-renewable subscriptions.

Physical iPhone/iPad acceptance remains separate and is intentionally not listed here.

### Google Play Console

4. **Finish the remaining App content forms.**
   - Play Console -> Pack One -> **Policy and programs -> App content**.
   - **Ads:** declare **Yes** using the rationale in this document (disclosed TCGplayer affiliate promotional links; no ad SDK/advertising ID).
   - **App access:** state that some features work as a guest, but account/Elite features require sign-in. Enter the private non-expiring Elite reviewer credential directly in Play Console; do not put it in Git or chat.
   - **Target audience and content:** select the intended **13+** audience; do not select under-13 groups.
   - **Content rating (IARC):** complete the questionnaire from the real app: no gambling/wagering/chat, but card art can contain fantasy combat/violence.
   - Data Safety is already submitted; do not redo it unless Play reports a new required correction.

5. **Turn on Managed Publishing before production-review changes.**
   - Play Console -> **Publishing overview**.
   - Under Managed publishing status, choose **Turn on managed publishing** and save.
   - Leave it on while the first production submission/review is being prepared so approval does not publish unexpectedly.

6. **Set the public Production countries to United States + Canada only.**
   - Play Console -> **Production** -> **Countries / regions**.
   - Target **United States** and **Canada** only for the first public release.
   - Do not assume the `production-access` closed-test geography automatically configures the Production track; treat these as separate settings.

7. **Verify the closed-test qualification clock and tester count.**
   - Open **Closed testing -> production-access**.
   - Confirm the tester opt-in link is the one being used and that the required testers are shown as continuously opted in.
   - If this developer account is subject to Google's newer-personal-account rule, keep at least 12 testers continuously opted in for 14 days. Do not reset/recreate the track during that period.

8. **Apply for Production access when Play enables the application.**
   - When the Dashboard says the testing requirement is satisfied, open the Production access application.
   - Answer Google's questions about the closed test, tester engagement/feedback, app purpose, and production readiness truthfully.
   - Submit the production-access application.
   - Record the submission/approval date in issue #575.

### GitHub / Google Cloud release-credential boundary

9. **Protect the GitHub release Environment.**
   - GitHub repo -> Settings -> Environments -> `pack-one-mobile-release`.
   - Restrict deployment branches to the intended protected release branch policy and add the desired required reviewer(s).
   - Keep Apple release secrets scoped to this Environment rather than generally available repository secrets.

10. **Narrow Google Workload Identity trust.**
   - In Google Cloud IAM / Workload Identity Federation, restrict the Pack One provider/service-account trust so store credentials are accepted only from the intended Pack One repository and approved release context.
   - Do not broaden repository workflow access merely to make a release pass.
   - After you make this change, the repo can re-run the non-publishing Apple/Google access probes and record the result.

### Not owner-only / leave to automation

Do **not** spend console time on these unless an automated probe reports a problem:
- uploading/replacing the current RC binaries;
- attaching iOS build 100321 to App Store version 1.0 (already done);
- moving Android 100311 to the `production-access` Closed Testing track (already done);
- Google Data Safety or store graphics (already done);
- App Store listing copy, manual-release flag, reviewed age-rating answers, or content-rights declaration (already present);
- release-track/API status audits;
- App Store/Play production release mechanics after all prerequisites and explicit owner approval — these can be handled through the guarded API workflows.

