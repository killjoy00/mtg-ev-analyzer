# Pack One monetization

Updated September 23, 2026. Google ads remain disabled at the owner's direction while approval is pending. Public Patreon linking and the Elite post-purchase activation flow are active.

## Membership

The $3 Supporter and $7 Elite Member tiers both include ad-free browsing while signed in to Pack One with Patreon connected and verified. The policy is keyed to the Pack One campaign, tier IDs and provider state, never price: active patrons, former patrons that still retain the qualifying tier, free trials and gifted qualifying memberships are ad-free; declined memberships and declined/refunded/fraud/deleted charge states are not. Only Elite grants unlimited Cube practice and custom-set practice; regular practice remains free for authenticated accounts.

The Elite Patreon Welcome Note directs members to `https://packone.pro/?patreon=activate`. Pack One signs the member into the existing account flow as needed, authorizes Patreon only when necessary, and unlocks benefits only from authoritative provider-derived capabilities. Browser `patreon_activation_succeeded` is descriptive UX telemetry; conversion/abandonment reporting uses the server-only `elite_activated` entitlement transition with a 24-hour maturity window. Issue #181 is closed.

The Daily-home monetization slot sits after the Daily content and applicable practice/custom links, outside `#app` so Daily re-renders cannot replace it. While Google delivery is disabled, the slot can show one TCGplayer affiliate promotion; when Google is enabled, the affiliate fallback is disabled rather than stacked with an AdSense unit. Neither provider appears in gameplay or result views, and the TCGplayer fallback is not used on editorial placements.

Guests may see the affiliate promotion without a membership lookup. Signed-in accounts use the same conservative `ads_allowed` boundary as display advertising: qualifying ad-free memberships suppress the affiliate promotion, and unknown, stale, pending or failed membership states keep the slot hidden. A signed-out Patreon member is treated as a guest because Pack One cannot verify the membership without the Pack One account session.

Account, Patreon-connect/disconnect and Elite-activation flows emit a nonce-only localStorage signal plus a same-tab event. An open tab clears any rendered Google or affiliate promotion on those signals and never refills it before a full reload. Changes made directly on patreon.com or by backend webhooks/scheduled reconciliation do not pass through a Pack One tab, so an already-open tab can retain its existing promotion until reload.

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

TCGplayer approved Pack One's Impact referral application on September 19, 2026. Existing revealed-card comparisons and selected set articles now route their card-search links through the approved referral URL using the Impact deep-link form `https://partner.tcgplayer.com/c/7742974/1780961/21018?u={url}`. Pack One preserves the card-specific TCGplayer destination by URL-encoding it into `{url}`.

The code continues to record `tcgplayer_click` with card, set (when supplied), surface and affiliate-active status. Applicable links use `rel="sponsored noopener"`, and visible copy identifies them as affiliate links or places an affiliate disclosure directly beside the link group. Pack One may earn a commission from eligible purchases at no added cost to the buyer.

Keep this as a small, relevant experiment: no banners, store page, pricing feed or extra purchase prompts. Compare actual Impact conversions against outbound clicks before expanding placement. Affiliate links are not for the owner's personal purchases.

TCGplayer documents its [Impact-based affiliate program](https://docs.tcgplayer.com/docs/tcgplayer-affiliate-program). Its [partner guidelines](https://help.tcgplayer.com/hc/en-us/articles/31411199594391-TCGplayer-Partner-Guidelines) require clear disclosure and prohibit personal use of affiliate links.

The live domain remains `packone.pro`; no domain migration is pending.
