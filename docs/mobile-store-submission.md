# Pack One mobile store submission packet

Updated 2026-09-29. This file is the source-of-truth submission packet for the first free public mobile release.

## Current launch-preparation checkpoint — 2026-09-29

- Fresh signed source: merge `c04ab3ba9f9def47708c67c2581596bcbd35f5c4` from #772.
- iOS 1.0 build **100311** was signed and uploaded successfully to TestFlight Internal Only in run [36663311014](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36663311014). It supersedes build 100243 as launch-candidate evidence. Physical iPhone/iPad and StoreKit acceptance still remain before App Review.
- Android 1.0 versionCode **100311** was signed with the protected Pack One upload key and committed successfully to Google Play Internal Testing in run [36663310963](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36663310963). This packet requests promotion of that exact bundle, without rebuilding, to the existing `alpha` Closed Testing track.
- The owner confirmed the one-time first Google Play Closed Testing rollout was completed in Play Console, so the app is no longer waiting on the original draft-app rollout action.
- App Store listing metadata is configured with manual release; five iPhone screenshots, five iPad screenshots, and the Elite App Review screenshot are uploaded. Elite is configured at $7.00/month in the U.S., Apple's corresponding $9.00 Canadian price, USA/CAN availability only, Family Sharing off, and Production/Sandbox Server Notifications V2.
- Google Play has the reviewed 512 icon, five phone screenshots, and 1024x500 feature graphic. The Google Play Data Safety declaration was successfully submitted in run [36632174516](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36632174516).

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

## Remaining authenticated store-console / release actions

Already completed and verified through the protected store workflows: Apple product-page metadata and manual-release setting; Apple iPhone/iPad screenshots and Elite review screenshot; Google Play listing copy, icon, phone screenshots and feature graphic; Google Play Data Safety submission; and the owner's one-time initial Closed Testing rollout.

Remaining launch actions that are not yet evidenced as complete:
- complete/verify App Store App Privacy responses, reviewer account/review instructions, app-level USA/Canada distribution, final build attachment, and App Review submission;
- complete/verify Google Play Ads, App access/reviewer credentials, target-audience declarations, IARC content rating, Managed Publishing, and production-country selection if those console-only items are not already set;
- complete physical-device acceptance on the exact iOS/Android 100311 candidates, including iPhone/iPad StoreKit lifecycle acceptance and Android tester install/upgrade acceptance;
- keep the Play Closed Testing tester cohort continuously qualified for the period Play requires for this developer account, then apply for Production access when Play marks the account eligible;
- submit/release each store only after the exact accepted RC evidence is recorded in #575 and the owner gives final launch approval.

Do not re-open completed screenshot, Play listing-asset, or Play Data Safety work unless the candidate UI/data behavior materially changes.
