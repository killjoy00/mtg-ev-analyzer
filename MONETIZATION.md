# Pack One monetization

Updated September 19, 2026. Google ads remain disabled at the owner's direction while approval is pending. Public Patreon linking is active.

## Membership

The $3 Supporter and $5 Elite Member tiers both include ad-free browsing while signed in to Pack One with Patreon connected. Only Elite grants unlimited Cube practice and custom-set practice; regular practice remains free for authenticated accounts. Exact campaign/tier matching is authoritative, never payment amount.

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

## TCGplayer / Impact: optional, low priority

Current revealed-card comparisons and selected set articles link to TCGplayer card searches. `tcgplayer-config.js` contains an empty `impactDeepLinkTemplate`, so affiliate routing is inactive. The code records `tcgplayer_click` with card, set (when supplied), surface and affiliate-active status. Clicks alone do not establish conversions or revenue.

Recommendation: keep the small, relevant card-search links; do not add banners, store pages, pricing feeds or extra purchase prompts now. If approved, test affiliate routing on those existing links and compare actual Impact conversions against outbound clicks. Draft-learning visitors may not be shopping, so revenue is unproven. Stop expanding the experiment if observed returns do not justify it.

TCGplayer documents its [Impact-based affiliate program](https://docs.tcgplayer.com/docs/tcgplayer-affiliate-program). Its [partner guidelines](https://help.tcgplayer.com/hc/en-us/articles/31411199594391-TCGplayer-Partner-Guidelines) require clear disclosure and prohibit self-use of affiliate links. Current account approval and commission terms must be confirmed in the owner's Impact account; no rate or earnings forecast is assumed here.

If the owner later chooses to activate:

1. Follow the official TCGplayer affiliate-program page to the Impact application and confirm approval for Pack One.
2. Copy the public deep-link template supplied for that partnership. It must contain `{url}` for the encoded destination; do not share login credentials or API secrets.
3. Add that template to `tcgplayer-config.js`, keep `rel="sponsored"`, and place clear affiliate disclosure beside applicable links.
4. Verify destination routing and Impact reporting using the partner's approved validation process. Do not make a self-purchase to test commission credit.
5. Evaluate a small measured trial before expanding placements. Card links are optional navigation, separate from Google display ads.

The live domain remains `packone.pro`; no domain migration is pending.
