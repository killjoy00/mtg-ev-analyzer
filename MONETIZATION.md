# Pack One monetization

## November 18, 2026: ATT-denied iOS banner correction (code review only)

The owner reports that iOS 1.3 build **101036** was approved in the App Store
and AdMob shows the Pack One app as **Verified / Ready**. The signed build
has production AdMob enabled, but the current component suppresses all ads
when the iPhone's tracking permission is denied. Google's iOS SDK documentation
explicitly permits non-personalized ad requests without IDFA in that case.

The reviewed follow-up allows Google UMP-eligible guest/free users to request
a non-personalized Daily-home banner without ATT authorization. It retains
Google consent, membership exclusions, privacy manifest/usage auditing,
G-rated requests and the single Daily-home placement. This change is **not
present in approved build 101036** until a new binary is tested and released.
Privacy disclosures and physical-device acceptance must be reviewed before
a new public App Store submission.


Updated November 17, 2026. Website Google AdSense remains disabled. The owner confirms that native iOS AdMob is approved and App Privacy disclosures are complete; the separately gated iOS 1.3 TestFlight candidate will enable AdMob. Public Patreon linking and the Elite post-purchase activation flow remain active.

## Membership

The $3 Supporter and $7 Elite Member tiers both include ad-free browsing while signed in to Pack One with Patreon connected and verified. The policy is keyed to the Pack One campaign, tier IDs and provider state, never price: active patrons, former patrons that still retain the qualifying tier, free trials and gifted qualifying memberships are ad-free; declined memberships and declined/refunded/fraud/deleted charge states are not. Only Elite grants unlimited Cube practice and custom-set practice; regular practice remains free for authenticated accounts.

The Elite Patreon Welcome Note directs members to `https://packone.pro/?patreon=activate`. Pack One signs the member into the existing account flow as needed, authorizes Patreon only when necessary, and unlocks benefits only from authoritative provider-derived capabilities. Browser `patreon_activation_succeeded` is descriptive UX telemetry; conversion/abandonment reporting uses the server-only `elite_activated` entitlement transition with a 24-hour maturity window. Issue #181 is closed.

The Daily-home monetization slot sits after the Daily content and applicable practice/custom links, outside `#app` so Daily re-renders cannot replace it. While Google delivery is disabled, the slot shows one TCGplayer affiliate promotion to advertising-eligible visitors; when Google is enabled, the affiliate fallback is disabled rather than stacked with an AdSense unit. Neither provider appears in gameplay or result views, and the TCGplayer fallback is not used on editorial placements.

Guests may see the affiliate promotion without a membership lookup. Signed-in accounts use the same conservative `ads_allowed` boundary as display advertising: qualifying ad-free memberships suppress the affiliate promotion, and unknown, stale, pending or failed membership states keep the slot hidden. A signed-out Patreon member is treated as a guest because Pack One cannot verify the membership without the Pack One account session.

Account, Patreon-connect/disconnect and Elite-activation flows emit a nonce-only localStorage signal plus a same-tab event. An open tab clears any rendered Google or affiliate promotion on those signals and never refills it before a full reload. Changes made directly on patreon.com or by backend webhooks/scheduled reconciliation do not pass through a Pack One tab, so an already-open tab can retain its existing promotion until reload.

## Native Google AdMob: iOS 1.3 TestFlight (November 17; historical build 101036)

The owner has confirmed approval of the registered Pack One iOS AdMob
application and completion of Apple App Privacy disclosures. iOS 1.2 build
101034 was delivered to internal TestFlight testers with live ad requests
disabled. The **new iOS 1.3 TestFlight candidate** explicitly sets
`PACKONE_ADMOB_IOS_ENABLED=1` in both unsigned PR validation and the
protected signed iOS release workflow. Both archive paths must verify
the effective production Expo configuration has iOS AdMob enabled,
the production app and Daily banner IDs, and Android ads disabled.

Only the Daily home, after the Dailies, may show a native Google banner.
iOS has no TCGplayer fallback. No ads during picks, reveal, or editorial
views. Guest/free accounts may receive a banner; confirmed Supporter/Elite
or unknown/stale membership accounts never request ads. Google UMP must
allow requests, then iOS ATT must be granted *before* the Google SDK is
initialized; all ad requests are non-personalized and G-rated.

This section documents the **original TestFlight candidate for build 101036**
and is superseded by the November 18 correction above. At the time, it was
a **TestFlight-only release**. Do not submit to App Review or
publicly publish in this workflow. Real-device consent/ATT, ad rendering,
privacy choices, membership and subscription transitions still need
acceptance before public launch. The current implementation intentionally
shows no banner when UMP consent or ATT authorization does not permit it.
See `docs/mobile-admob-release.md`.

## Google AdSense: deferred

`ad-config.js` remains `enabled: false`. The public client is `ca-pub-1217971050094766` and the dormant Daily-home unit is `1543495960`; `articleTop` remains empty and Auto Ads are not used. Publisher verification metadata and `ads.txt` remain in place. With the release gate disabled, the loader makes no membership request and no Google advertising request. Static ad placeholders remain hidden even with JavaScript disabled, and `?adpreview=1` cannot bypass the disabled release gate.

This is technically prepared for later activation, not ready merely because a boolean can be flipped. Google AdSense approval, applicable consent/privacy work and explicit owner authorization all remain blockers to live delivery.

After those blockers are cleared, and only when the owner asks to activate ads:

1. Confirm approval in the AdSense account and re-confirm the public publisher/client and manual home-unit ID.
2. Complete the applicable consent setup and privacy copy before enabling delivery.
3. Enable only the reviewed Daily-home placement; keep Auto Ads, article ads and gameplay/result placements off.
4. Re-run guest, free-account, Supporter, Elite, stale/unknown and failed-membership checks before release. Qualifying ad-free memberships must not contact Google's advertising endpoint.
5. Measure whether revenue justifies any effect on completion, return visits and page speed.

No ad activation or Google account change was performed.

## TCGplayer / Impact: active affiliate trial

TCGplayer approved Pack One's Impact referral application on September 19, 2026. **All card-specific storefront links were retired on November 16, 2026**, including Draft Run result analysis and the four published set archives, on both the website and native apps. Card imagery, enlarged views, scores and model support remain.

The website's optional Daily-home affiliate promotion stays active while web AdSense remains disabled. Android retains its separate native Daily-home affiliate promotion. iOS 1.2 removes the native TCGplayer promotion entirely, regardless of whether AdMob is enabled.

The Daily-home route uses the approved Impact deep-link template `https://partner.tcgplayer.com/c/7742974/1780961/21018?u={url}`, with the fixed Magic shopping destination encoded into `{url}`. Web affiliate clicks are tracked by the `daily_home_banner` surface. Pack One may earn a commission from eligible purchases at no added cost to the buyer.

The Daily-home fallback is the one approved expansion of this experiment. It uses the official TCGplayer logo asset on a neutral Pack One surface, routes the CTA through the approved Impact deep-link template to TCGplayer's Magic category, carries the visible disclosure “Affiliate link. Pack One may earn a commission from purchases.”, and records the surface as `daily_home_banner`. The logo is served locally; no TCGplayer or Impact script/pixel loads merely because the banner is displayed.

Keep this measured: no store section, pricing feed, gameplay/result banner or additional affiliate placements. Compare the home-banner outbound clicks with Impact conversion reporting before expanding further. Affiliate links are not for the owner's personal purchases.

TCGplayer documents its [Impact-based affiliate program](https://docs.tcgplayer.com/docs/tcgplayer-affiliate-program). Its [partner guidelines](https://help.tcgplayer.com/hc/en-us/articles/31411199594391-TCGplayer-Partner-Guidelines) require clear disclosure and prohibit personal use of affiliate links.

The live domain remains `packone.pro`; no domain migration is pending.
