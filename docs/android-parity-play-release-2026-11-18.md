# Pack One Android: web parity and Google Play candidate (November 18, 2026)

Status: **source review and release preparation**. A signed Play candidate, physical
device acceptance, live Play Console state and public publication are separate
gates. This is not an authorization to publish to Production.

## Release baseline

- Application/package: `pro.packone.app`; first public marketing version
  remains Android **1.0**. Google Play requires a fresh monotonically increasing
  `versionCode` for each newly uploaded AAB.
- Existing Google Play **Internal Testing**: 1.0/**100970**, signed from
  `c1d838cacb27027913be01cc968a78bf3b1ac522` and activated November 16.
- Existing **Closed Testing**: 1.0/**100963** on the original
  `production-access` track, successfully activated November 7. Do not change
  its testers, groups, countries or qualification history.
- Public **Production**: no verified public release and no publication
  requested. A Google Play production-access application remains a separate
  Console/owner step; test opt-in alone does not guarantee approval.

## Web vs. current Android shared source

| Area | Current source review | Required live confirmation |
| --- | --- | --- |
| Daily home text and three environments | Web `daily-home.mjs` names/descriptions, headings, free-account prompts and next-action copy are mirrored by `mobile/src/screens/index.tsx` and `mobile/src/api/draftRun.ts`; regression test covers both. | Android device layout, large fonts and Pacific rollover |
| Draft Run and results | Native shared screens have eight picks, reveal/scoring, trophy decklists, all-cards review, report controls, friend shares and multi-Daily shares. Latest shared fixes record foreground decision time and preserve completed result at midnight. | Full on-device run, background/resume, expired/offline decision, share/open and decklist |
| Practice, Leaderboards, My Pack One | Native free practice, premium entitlement-controlled Powered Cube/custom sets, season rankings, public profiles, Career and Insights are implemented; server controls eligibility. | Guest/account sign-in, membership access, real profiles and history |
| Communication/privacy | Native results/news opt-in, published-name exclusions and November 16 legal copy are present; `results-copy.json` is checked against `mobile/src/resultsCopy.ts`. | Consent persistence, unsubscribe, reminders separate, account switching and privacy actions |
| Navigation and editorial | Learn/Scoring/Method, set guides, About, Support, Privacy and Terms are native or deliberately open canonical HTTPS pages. App Links include profile, shared, daily and creator routes. | Signed Android App Links, browser return, accessibility, offline errors |
| Commerce and ads | Per-card shopping links retired on web/native. Android intentionally retains its *eligible-user* TCGplayer promotion **on Daily home only**, unlike iOS AdMob. Android has **no Google Play Billing purchase CTA**; existing membership access is supported. | Confirm affiliate/ad-free logic and policy-consistent disclosure on Android |

The browser layout, iOS StoreKit purchase flow, Apple ATT consent and iOS-only
advertising diagnostics are **not Android feature requirements**. They must not
be mistaken for missing Android parity. Source tests do not prove signed-device
behavior.

## Google Play and Android SDK checks

- Expo SDK 57 specifies Android `compileSdkVersion=36` and
  `targetSdkVersion=36`, meeting Google's August 31, 2026 new-app minimum.
  **Inspect the generated signed manifest and actual Play Console acceptance**
  before claiming compliance; `mobile/android-toolchain.json` pins compile 36.
- Preserve the existing upload certificate from Google Secret Manager and the
  Play App Signing certificate/hosted `assetlinks.json` match. Never generate
  a new Android signing identity for this release.
- The new `react-native-google-mobile-ads` dependency is present for iOS
  but **Android live AdMob is disabled**. Audit the actual Android merged manifest
  for SDK-added permissions and advertising ID disclosures and reconcile any
  changed Google Play Data safety/Ads declarations before public submission.
- Play Console setup previously included App access, target audience/content,
  content rating, Data safety, ads and US/Canada countries. Those are historical
  confirmations: recheck the live forms, app availability, policy warnings
  and review credentials before Production; do not treat this file as a
  live Google Play API probe.
- Previous Android store screenshot assets predate the November 18 Daily home
  and result wording. Recapture **Android** screenshots from the new build,
  compare visually and replace stale store images before public release.
- Physical Android upgrade/install QA and signed OS App Links remain open.
  These cannot be certified by unit tests or iOS simulator screenshots.

## Safe two-stage delivery

1. A protected `main` change to
   `.github/android-production-bundle-request.json` starts a newly restored,
   narrowly scoped Android production bundle workflow. It must run full
   mobile tests, Expo/Gradle prebuild, signing, API/manifest audits and produce
   a signed `pack-one-play-signed-aab` artifact. This stage **does not upload
   to Play or change any track**. Ordinary Android PR/push CI remains paused.
2. Only after inspecting the passing run, obtain its exact source SHA,
   artifact ID, SHA-256 digest and allocated `versionCode`. A **separately
   reviewed** `.github/android-exact-aab-release-request.json` may import
   that same AAB unchanged and promote it to existing
   `production-access` Closed Testing. The protected action refuses
   post-build mobile-source drift, new tracks or a wrong/expired artifact.
   It must verify completed (not draft) release state; Internal Testing and
   the public Production track must not be confused with Closed Testing.
3. Run device QA and verify the Play Console track and testing qualification
   after promotion. Apply for Production access separately if eligible;
   **never publish to Production without explicit confirmation**.

Source evidence: `docs/mobile-parity-inventory.md`,
`docs/mobile-store-submission.md`, `docs/android-ci-pause.md`,
and the protected Android GitHub Actions workflows.
