# Pack One native AdMob: iOS-first release checklist

Prepared November 16, 2026. The existing approved/public App Store release and
iOS 1.1/101002 TestFlight build are unchanged by this draft implementation.

## Placement and ads policy

- One Google AdMob **banner** on the native Daily home **after** the Daily cards,
  never during picks, result review, shared challenges or the editorial guides.
- The AdMob banner **replaces** the existing Daily-home TCGplayer fallback; the
  two placements never stack. When AdMob is disabled, TCGplayer remains as before.
  The web AdSense gate in \`ad-config.js\` remains **disabled**.
- A guest is eligible. A signed-in player must have a *fresh* account-specific
  \`ads_allowed: true\` and \`ad_free: false\`; Supporter, Patreon/Apple Elite,
  manual Elite, unknown provider status and failed refreshes see no Google banner.
  Session changes unmount the banner before the membership recheck.
- The module is loaded only after eligibility. Google UMP consent is refreshed
  before SDK initialization or ad request. The native plugin delays ad measurement
  until then. The banner requests **non-personalized ads only** with maximum
  content rating G. A required UMP privacy-options action appears on both the
  banner and the Account screen.
- Consent failure or ad load failure leaves a blank slot; neither blocks play,
  adds an interstitial, nor falls through to the affiliate promotion.

## What the owner must set up in AdMob

1. At https://apps.admob.com/, add **Pack One (iOS)** using the App Store listing
   and bundle ID \`pro.packone.app\`. Obtain its **App ID**
   (\`ca-app-pub-...~...\`). It is **not** the web AdSense publisher ID.
2. Create a **Banner** ad unit for that iOS app and copy its **ad unit ID**
   (\`ca-app-pub-.../...\`). Ad units and app IDs are not interchangeable.
3. Configure and publish the applicable GDPR/US state privacy messages under
   **Privacy & messaging**. Test UMP's EU/US choices in a native preview build.
4. Provide these non-secret, app-specific values for the protected iOS signing
   job (or ask the repo automation to add them to the workflow environment):
   \`PACKONE_ADMOB_IOS_APP_ID\` and \`PACKONE_ADMOB_IOS_BANNER_ID\`.
   Set \`PACKONE_ADMOB_IOS_ENABLED=1\` **only** after policy, provider and device
   review. This flag is a native-build-time choice and requires a NEW signed build.
5. If Android ads are desired later, create **a separate Android AdMob app and
   banner unit**. Its identifiers use \`PACKONE_ADMOB_ANDROID_APP_ID\` and
   \`PACKONE_ADMOB_ANDROID_BANNER_ID\`, and Android ads are gated independently
   by \`PACKONE_ADMOB_ANDROID_ENABLED=1\`. Update Google Play **Contains ads**
   and Data Safety before any Android production release.

Without the explicit enabled flag, **production has no AdMob requests**, even
though its compiled SDK uses Google's official demo App IDs (required to avoid
startup crashes in a disabled/test build). Non-production preview/dev builds
use the same official sample IDs, and show test banners ONLY when
\`PACKONE_ADMOB_TEST_BANNERS=1\`. These are test creatives, never live inventory.
An enabled production build refuses missing/mismatched/demo publisher and unit IDs.
Do not ship a production build with the sample IDs in an active ad placement.

## App Store and privacy requirements

**Before merging/building/releasing an enabled binary:** update the published
Pack One privacy policy, the matching native copy, and App Store Connect's
**App Privacy** responses for the Google Mobile Ads SDK and any UMP data. Use
Google's current SDK data/Privacy Manifest descriptions to review identifiers,
usage data, diagnostics, third-party advertising, possible tracking and ATT.
Do not copy the existing "no third-party advertising SDK" declaration into a
binary that includes AdMob. Recheck third-party SDK privacy manifests and
\`mobile/scripts/audit-ios-archive.py\`: the existing no-tracking assertion is
a **real blocker** if a bundled manifest declares tracking, not a check to
silently delete. Add ATT if the actual approved integration will perform
cross-app tracking; non-personalized delivery alone is not a substitute for
an accurate App Store privacy declaration.

App Review guideline 2.5.18 requires ad reporting and age-appropriate ads.
Verify Google's rendered AdChoices/report affordance on real iPhone/iPad,
including screen reader and dynamic text. Keep manual public release and
existing subscription purchase/restore unchanged.

## Checks required before this can be called working

1. Reconcile latest site features and native source against build **101002**.
   Current source and the certified binary have matching native inputs on
   November 16, but code parity does not prove physical-device behavior.
2. Run mobile unit/lint/typecheck/config checks and native **iPhone, iPad and
   Android** smoke with *test* App IDs. Recheck source hash before signing.
3. Test UMP: consent required/declined/allowed, error/offline, US state options,
   and account change during the dialog. No ad SDK initialization for ad-free
   members, unknown/stale entitlements or disabled environments.
4. Test guest/free/Supporter/Elite entitlement transitions, purchase/restore,
   account A→B and app foreground; no lingering Google banner after upgrades.
5. Test three Dailies, scoring/reveal, practice, My Pack One, sign-in and sharing,
   links, subscription restoration, device orientation, screenshots/VoiceOver,
   and native deeplinks on physical iOS.
6. Ship **new version/build number** through the guarded iOS release workflow,
   inspect signed privacy manifests and Apple App Privacy again, verify TestFlight,
   complete device acceptance and **then** request Apple App Review. The already
   approved App Store binary cannot gain a native ad SDK without a new review.

Related: \`docs/mobile-parity-inventory.md\`, \`docs/releases/results-native-2026-11-16.md\`,
\`MONETIZATION.md\`. Web AdSense is a distinct product and stays dormant.
