# Pack One monetization

Updated September 23, 2026. Google ads remain disabled at the owner's direction while approval is pending. Public Patreon linking and the Elite post-purchase activation flow are active.

## Membership

The $3 Supporter and $5 Elite Member tiers both include ad-free browsing while signed in to Pack One with Patreon connected. Only Elite grants unlimited Cube practice and custom-set practice; regular practice remains free for authenticated accounts. Exact campaign/tier matching is authoritative, never payment amount.

The Elite Patreon Welcome Note directs members to `https://packone.pro/?patreon=activate`. Pack One signs the member into the existing account flow as needed, authorizes Patreon only when necessary, and unlocks benefits only from authoritative provider-derived capabilities. Browser `patreon_activation_succeeded` is descriptive UX telemetry; conversion/abandonment reporting uses the server-only `elite_activated` entitlement transition with a 24-hour maturity window. Issue #181 is closed.

The ad loader checks backend membership before requesting Google's script. Supporter/Elite members receive no Google script or ad slot. Unknown, stale, pending, failed or older-backend membership responses keep ads hidden. Account changes immediately clear existing slots. Static placeholders are hidden even with JavaScript disabled. `?adpreview=1` cannot bypass disabled advertising. No ads appear in active gameplay, and no ad slots have been added to the homepage.

Signed-out visitors cannot be identified as members; members must sign in and connect Patreon on that browser. Provider membership changes flow through the hourly authoritative sync. This suppression is independent of practice grants and does not grant Supporter premium gameplay.

## Google AdSense: deferred

`ad-config.js` remains `enabled: false`, with empty client/slot values. Publisher verification metadata and `ads.txt` remain in place; they do not establish approval or load ads. No Google ad request is made by the disabled loader.

After approval, and only when the owner asks to activate ads:

1. Confirm approval in the AdSense account and copy the public publisher/client and manual slot IDs.
2. Confirm the applicable consent setup and privacy copy before enabling delivery.
3. Configure a limited editorial placement; keep Auto Ads and gameplay placements off.
4. Re-run guest, free-account, Supporter, Elite and failed-membership checks before release. Neither paid tier should contact Google's advertising endpoint.
5. Measure whether revenue justifies any effect on completion, return visits and page speed.

No ad activation or Google account change was performed.

## TCGplayer / Impact: active affiliate trial

TCGplayer approved Pack One's Impact referral application on September 19, 2026. Existing revealed-card comparisons and selected set articles now route their card-search links through the approved referral URL using the Impact deep-link form `https://partner.tcgplayer.com/c/7742974/1780961/21018?u={url}`. Pack One preserves the card-specific TCGplayer destination by URL-encoding it into `{url}`.

The code continues to record `tcgplayer_click` with card, set (when supplied), surface and affiliate-active status. Applicable links use `rel="sponsored noopener"`, and visible copy identifies them as affiliate links or places an affiliate disclosure directly beside the link group. Pack One may earn a commission from eligible purchases at no added cost to the buyer.

Keep this as a small, relevant experiment: no banners, store page, pricing feed or extra purchase prompts. Compare actual Impact conversions against outbound clicks before expanding placement. Affiliate links are not for the owner's personal purchases.

TCGplayer documents its [Impact-based affiliate program](https://docs.tcgplayer.com/docs/tcgplayer-affiliate-program). Its [partner guidelines](https://help.tcgplayer.com/hc/en-us/articles/31411199594391-TCGplayer-Partner-Guidelines) require clear disclosure and prohibit personal use of affiliate links.

The live domain remains `packone.pro`; no domain migration is pending.
