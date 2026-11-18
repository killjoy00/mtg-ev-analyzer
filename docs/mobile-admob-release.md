# Pack One iOS AdMob release status

## Upcoming fix: non-personalized Daily banner with ATT denied (not yet shipped)

The App Store-approved iOS 1.3 build **101036** was signed with live AdMob
enabled and an overly restrictive ATT check. For visitors with Apple's global
tracking switch off, that build never initializes the Google SDK, even if the
guest is eligible and Google's separate UMP consent allows ad requests.

This follow-up permits **non-personalized, G-rated** Daily-home banner requests
when ATT is denied or restricted. Google documents that its iOS SDK does not
send IDFA when ATT is denied:
https://developers.google.com/admob/ios/privacy/idfa

The flow still waits for fresh guest/account ad eligibility and Google UMP
consent. ATT remains checked (prompting only when undetermined) **before** SDK
initialization, but a denied/restricted result no longer suppresses an
otherwise-consented request. App Tracking Transparency is not consent for
Google's separate privacy requirements; failed or disallowed UMP stays closed.
Supporter/Elite accounts, stale membership state, and gameplay never get ads.
The app's ad request continues to set
`requestNonPersonalizedAdsOnly: true` regardless of ATT status.

**Privacy:** The bundled Google Ads SDK can collect other data besides IDFA.
Retain the ATT usage description and strict signed-archive privacy manifest
audit; don't falsely claim that non-personalized ads eliminate all data
collection. Review App Store Connect's privacy answers against the signed
SDK manifest before public submission. Test on a real iPhone with the global
tracking switch off as well as ATT granted/denied/restricted, UMP allowed and
disallowed, guest/free vs ad-free accounts, ad load/no-fill, and AdChoices.

This is code review only, not an App Store submission, signed TestFlight
upload, or change to the already approved 101036 binary.


## iOS 1.3 live-AdMob TestFlight candidate — November 17, 2026 (historical)

The notes in this section describe the original build 101036, not the
updated denied-ATT policy proposed above.

**Owner-confirmed:** Google approved the Pack One iOS AdMob app, and the
App Store Connect App Privacy disclosure is done. This is a statement from
the owner, not a new readback of AdMob or App Store Connect account settings.

The previous iOS **1.2 / 101034** build was uploaded, processed
`VALID`, and verified available in internal TestFlight with live ads
**disabled**. The reviewed **1.3** candidate uses the same registered
iOS App ID and Daily banner unit already specified below, but explicitly
sets `PACKONE_ADMOB_IOS_ENABLED=1` in the unsigned iOS archive check and
in the protected signing job. The release workflow fails before signing
if the effective version is not 1.3, the approved app/banner identifiers
are absent, the ATT plugin is missing, or Android ads are unexpectedly
enabled. The App Store Connect distribution still requires exact-main,
signed privacy audit, Apple processing and internal beta-group verification.

**No public release is authorized.** Leave manual release and existing
TestFlight groups unchanged. The new binary may request live, non-personalized,
G-rated Daily-home banner inventory only after eligibility, Google UMP
consent, and Apple ATT authorization. If consent is declined or ATT is
denied, the game remains ad-free and fully playable.

**Device acceptance for public launch, not a precondition to an internal
TestFlight upload:** exercise guest/free versus Supporter/Elite,
ATT granted/denied/restricted, applicable UMP notices and privacy options,
ad load/failure, Apple subscription restore, VoiceOver and iPad layout.
Confirm Google's AdChoices/report controls in the real rendered ad before
App Review. If App Store Connect version 1.3 is not safely editable, the
TestFlight finalizer may verify internal testing without attaching the new
build to a public App Store version; it must not modify 1.2 as a workaround.

---

## Previous iOS 1.2 integration notes (historical)

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
- **ATT gate in approved build 101036 (historical, corrected above):** The bundled Google Mobile Ads manifest marks Device ID
  as tracked. After Google UMP consent and **before Google SDK initialization**,
  Expo TrackingTransparency checks Apple's system authorization and prompts once
  only if undetermined. Denied, restricted, or unavailable authorization
  suppresses all Google ad initialization/requests without blocking the game.
  Even non-personalized advertising may use IDs for reporting, so the app's
  permission copy describes advertising measurement rather than personalized ads.
  An AdMob ATT explainer message is optional; UMP and the app should not present
  duplicate system prompts. Configure and test this on physical devices.
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
   an additional IDFA/ATT explainer without verifying that the app's Expo ATT
   permission flow and UMP don't double-prompt.
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

**Before signing TestFlight 1.2:** require a green unsigned-archive privacy
audit, mobile tests and a reviewed current-main source. The known bundled
Google Mobile Ads Device ID tracking declaration is allowed **only** with the
ATT usage description present and permission-gated Google SDK initialization.
The archive audit must still fail for any unreviewed tracked SDK/data type,
missing ATT explanation, top-level tracking declaration, or unrelated sensitive
permission. Unit tests cover UMP and ATT grant/denial paths. Non-personalized
ads are not automatically exempt from tracking disclosures.

**Before enabling live AdMob or submitting 1.2 to public App Review:** verify
the published Pack One privacy policy, its native copy, all current App Privacy
answers, real-device UMP + ATT dialogs and denial behavior, Apple Elite/ad-free
membership transitions and AdMob account/app-ads.txt readiness. Never treat a
TestFlight upload as public approval. The default production configuration
has live AdMob disabled; this TestFlight candidate can establish binary parity
while native ad-device acceptance continues.

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
