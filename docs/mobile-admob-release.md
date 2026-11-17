# Pack One iOS 1.2: native AdMob release checklist

Prepared November 16, 2026. Apple approved **iOS 1.0** and marked it
Ready for Distribution on November 16. The repository's last documented build
attached to App Store 1.0 is **100505**; Apple's approval email does not
identify its build number. The newer **iOS 1.1/101002 is TestFlight only**.
The next App Store marketing version is **1.2**, not 1.1. Its implementation
remains unmerged and unsigned as a public App Store update.

## Placement and ads policy

- One Google AdMob **banner** on the native Daily home **after** the Daily cards,
  never during picks, result review, shared challenges or the editorial guides.
- **iOS never shows the TCGplayer banner.** Its Daily home can show AdMob,
  and if AdMob is disabled, consent is declined, or loading fails, it displays
  no advertising promotion instead. Android retains the previously existing
  Daily-home TCGplayer fallback. The website's separate Daily-home affiliate
  promotion remains unchanged; the web AdSense gate in `ad-config.js`
  remains **disabled**.
- A guest is eligible. A signed-in player must have a *fresh* account-specific
  `ads_allowed: true` and `ad_free: false`; Supporter, Patreon/Apple Elite,
  manual Elite, unknown provider status and failed refreshes see no Google banner.
  Session changes unmount the banner before the membership recheck.
- The module is loaded only after eligibility. Google UMP consent is refreshed
  before SDK initialization or ad request. The native plugin delays ad measurement
  until then. The banner requests **non-personalized ads only** with maximum
  content rating G. A required UMP privacy-options action appears on both the
  banner and the Account screen.
- Consent failure or ad load failure leaves a blank slot on iOS; neither
  blocks play, adds an interstitial, nor falls back to TCGplayer.
- All card-specific shopping links are gone from native Draft Run and set
  archives; website card-specific links are removed in separate PR #1602.

## AdMob identifiers supplied and implemented (November 16)

The owner created the iOS AdMob app and ad unit. No further IDs are needed:

- **iOS App ID:** `ca-app-pub-1217971050094766~3792911821`
- **Daily-home Banner Ad Unit ID:** `ca-app-pub-1217971050094766/8989398185`
- **Authorized seller:** `google.com, pub-1217971050094766, DIRECT, f08c47fec0942fa0`
- **Published route:** https://packone.pro/app-ads.txt (fixed in #1604; the live Pages verification passed)

Both public SDK identifiers are now the iOS production defaults in
`mobile/app.config.ts`. The registered App ID appears in the native iOS
configuration even while ads are disabled. The banner ad unit is used only in
an explicitly enabled build. No GitHub secrets or environment variables for
these two identifiers are required. **Live ads remain disabled by default**;
turning on `PACKONE_ADMOB_IOS_ENABLED=1` requires policy clearance and a new
signed build. The mobile test configuration continues using Google's sample IDs.

## Remaining account steps (owner action)

1. In AdMob → Apps → Pack One → app-ads.txt, run **Check for updates** and verify
   that the seller record is approved; ensure App Store Connect's Marketing URL
   is `https://packone.pro/`.
2. In AdMob → **Privacy & messaging**, configure and publish required GDPR/EEA/UK
   and relevant US state notices. Test their choices through UMP. Do not turn on
   an IDFA/ATT message without implementing and disclosing the resulting tracking.
3. In App Store Connect → Pack One → **App Privacy**, review SDK/UMP data and
   possible tracking disclosures. Create marketing version **1.2**, if not done.
4. Test iPhone/iPad with **sample ads** and UMP test geography before enabling
   production banners; verify no banners on paid/ad-free accounts, correct
   AdChoices/reporting, purchase restore and no ad requests on consent failure.
5. Android advertising is a separate later setup; it remains disabled.

## Original AdMob setup steps (completed or superseded)

1. At https://apps.admob.com/, add **Pack One (iOS)** using the App Store listing
   and bundle ID `pro.packone.app`. Obtain its **App ID**
   (`ca-app-pub-...~...`). It is **not** the web AdSense publisher ID.
2. Create a **Banner** ad unit for that iOS app and copy its **ad unit ID**
   (`ca-app-pub-.../...`). Ad units and app IDs are not interchangeable.
3. In AdMob, copy its authorized-sellers `app-ads.txt` line. Pack One now has
   both the web `ads.txt` and the published `app-ads.txt`. Publish the verified line at
   `https://packone.pro/app-ads.txt`, confirm the App Store listing
   has `https://packone.pro/` as its Developer Website/Marketing URL,
   and run AdMob's **Verify app** and app readiness review. Do not infer approval
   from the app's Apple App Review status.
4. Configure and publish the applicable GDPR/US state privacy messages under
   **Privacy & messaging**. Test UMP's EU/US choices in a native preview build.
5. Provide these non-secret, app-specific values for the protected iOS signing
   job (or ask the repo automation to add them to the workflow environment):
   `PACKONE_ADMOB_IOS_APP_ID` and `PACKONE_ADMOB_IOS_BANNER_ID`.
   Set `PACKONE_ADMOB_IOS_ENABLED=1` **only** after policy, provider and device
   review. This flag is a native-build-time choice and requires a NEW signed build.
6. If Android ads are desired later, create **a separate Android AdMob app and
   banner unit**. Its identifiers use `PACKONE_ADMOB_ANDROID_APP_ID` and
   `PACKONE_ADMOB_ANDROID_BANNER_ID`, and Android ads are gated independently
   by `PACKONE_ADMOB_ANDROID_ENABLED=1`. Update Google Play **Contains ads**
   and Data Safety before any Android production release.

Without the explicit enabled flag, **production has no AdMob requests**. The
production iOS SDK embeds the real Pack One App ID. Android uses Google's
sample App ID while Android ads are disabled. Preview/dev builds continue to
use Google's official sample IDs and show test banners ONLY when
`PACKONE_ADMOB_TEST_BANNERS=1`. These are test creatives, never live inventory.
An enabled production build rejects mismatched or demo IDs.

## App Store and privacy requirements

**Before merging/building/releasing an AdMob binary:** verify and publish the
updated Pack One privacy policy and matching native copy, and update App Store Connect's
**App Privacy** responses for the Google Mobile Ads SDK and any UMP data. Use
Google's current SDK data/Privacy Manifest descriptions to review identifiers,
usage data, diagnostics, third-party advertising, possible tracking and ATT.
Do not copy the existing "no third-party advertising SDK" declaration into a
binary that includes AdMob. Recheck third-party SDK privacy manifests and
`mobile/scripts/audit-ios-archive.py`: the existing no-tracking assertion is
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
6. Create App Store version **1.2** and ship a **new 1.2 build number**
   through the guarded iOS release workflow,
   inspect signed privacy manifests and Apple App Privacy again, verify TestFlight,
   complete device acceptance and **then** request Apple App Review. The already
   approved App Store binary cannot gain a native ad SDK without a new review.

Related: `docs/mobile-parity-inventory.md`, `docs/releases/results-native-2026-11-16.md`,
`MONETIZATION.md`. Web AdSense is a distinct product and stays dormant.
