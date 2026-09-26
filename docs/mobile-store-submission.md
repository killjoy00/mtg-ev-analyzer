# Pack One mobile store submission packet

Updated 2026-09-25. This file is the source-of-truth submission packet for the first free public mobile release.

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
- Support email: `admin@packone.pro`
- Default language: English (U.S.)
- Recommended initial public region: United States only. Expand after the first release once review/operations are proven.

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

Keep practicing between Dailies with regular random runs. A free Pack One account adds leaderboard participation, career history, and cross-device continuity. Existing Elite access unlocks Powered Cube and custom-set practice.

Your Pack One account works across web, iPhone, and Android. Sign in with Apple, Google, or email. Account deletion is available in the app.

Pack One is unofficial Fan Content permitted under the Wizards Fan Content Policy and is not approved or endorsed by Wizards. Card metadata and images are sourced from Scryfall. See packone.pro/terms/ for attribution and source-license details.

### App Review notes

Pack One can be used without an account for the three Daily challenges. Account features include leaderboard participation, saved career/history, regular practice, and cross-device continuity.

Sign-in methods:
- Sign in with Apple
- Google
- Email/password

The app contains no in-app purchase flow and no mobile upgrade/purchase link.

For review of gated Elite practice, provide a non-expiring Pack One demo account with Elite already granted. Do not place reviewer credentials in this repository; enter them only in App Store Connect Review Information.

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

Native Pack One has no ad SDK, no third-party analytics SDK, no location permission, no contacts access, no camera/microphone feature, and no mobile purchase SDK.

Declare data collected by Pack One as follows, subject to final App Store Connect wording:
- Contact Info -> Name: collected for account/profile functionality; linked to the user; not used for tracking.
- Contact Info -> Email Address: collected for account, verification, recovery, and deletion; linked to the user; not used for tracking.
- Identifiers -> User ID: Pack One player/account identifiers are collected for app functionality and analytics; linked when signed in; not used for tracking.
- Usage Data -> Product Interaction: gameplay starts, choices, scores, completions, and related product events are collected for app functionality and product analytics; may be linked to the Pack One player/account; not used for tracking.

Do not declare:
- Purchases or payment information
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

Before submitting the Content Rights declaration, the account holder must confirm the current Wizards Fan Content Policy remains applicable to this exact commercial/affiliate configuration. Do not make an unsupported rights representation in App Store Connect.

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

Use real screenshots from the exact 1.0 release candidate. Recommended order:
1. Daily decision screen — `Eight decisions. One score.`
2. Reveal/comparison screen — `Compare with a real trophy draft.`
3. Daily hub — `Three fresh Dailies.`
4. Practice screen — `Keep drafting between Dailies.`
5. Career/leaderboard — `Track your Pack One career.`

Apple allows 1-10 screenshots per supported device size. Pack One v1 supports iPad (`ios.supportsTablet=true`), so iPad-specific QA and the required iPad App Store screenshots are mandatory for the accepted 1.0 release candidate.

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

- Ads: **No** for the native Android app. The mobile binary has no ad SDK and no native display-ad feature.
- App access: Some features are available without login; account and Elite features require access. Supply one non-expiring Elite reviewer account in Play Console Sign-in details. Do not store its password in Git.
- Privacy policy: https://packone.pro/privacy/
- Account deletion URL: https://packone.pro/privacy/#delete-account
- Target audience: default recommendation is ages 13 and over; do not select under-13 groups unless the product is intentionally redesigned for children.
- Content rating: complete IARC from the actual content. No gambling/wagering/chat. Card art may contain fantasy violence and must be reflected accurately.
- Data safety: use the declaration below.
- Contains ads: No.
- In-app purchases: No for v1.

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

Use screenshots from the exact release candidate rather than mock UI.

### Release / publishing settings

- Turn on Managed Publishing before sending store/app-content changes for review so approval does not accidentally publish changes immediately.
- Closed testing must be completed before production access if Play requires it for this developer account.
- The first production release does **not** offer a staged rollout percentage; Google documents staged percentages for updates, not the first production release. The first production release goes to all users in the selected production countries.
- Recommended first public region: United States only. Expand countries after the first release and operational pass.

## Items that still require authenticated store-console actions

The current ChatGPT environment cannot open the logged-in App Store Connect or Play Console UI, so these must be entered through a logged-in store session or a future store API workflow:
- upload final screenshots / Play feature graphic
- enter App Privacy / Data safety questionnaire responses
- answer the Apple age-rating and Play IARC questionnaires
- enter the final reviewer account credentials
- choose countries/regions
- submit for review / start closed testing / start production release

Do not treat those clicks as engineering work; the content above is the prepared source-of-truth for them.
