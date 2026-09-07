# Pack One monetization setup

## TCGplayer / Impact

TCGplayer's affiliate program currently operates through Impact. Apply through the TCGplayer campaign in Impact. New TCGplayer API developer access is not currently being granted, so this integration intentionally does **not** depend on API pricing access.

After approval:

1. In Impact, create/copy the TCGplayer deep-link template for the Pack One partner account.
2. Put that public tracking template in `tcgplayer-config.js` as `impactDeepLinkTemplate`. It must contain `{url}` where the encoded TCGplayer destination belongs.
3. Do not store TCGplayer API private keys, Impact credentials, or other secrets in this repository.
4. Verify a click lands on the intended TCGplayer card search and appears in Impact reporting.
5. Keep the disclosure page and `rel="sponsored"` attributes intact.

Pack One records `tcgplayer_click` analytics with card, set, surface, and whether affiliate routing was active.

## Google AdSense

The code uses manual ad slots only; Auto Ads are intentionally not enabled. Active gameplay hides the entire editorial/monetization shell.

After AdSense approval:

1. Put the public AdSense client ID and approved slot IDs in `ad-config.js`, then set `enabled: true`.
2. Create a real `ads.txt` from `ads.txt.example` using the publisher ID supplied by AdSense.
3. Configure the required Google-certified consent flow for applicable regions before personalized advertising.
4. Keep ads out of active gameplay and away from game controls.
5. Use `?adpreview=1` for layout QA without requesting real ads.

## Domain move

Do not change canonicals or `CNAME` until `packone.pro` DNS is ready. The editorial pages currently canonicalize to the live `magic.planitnow.us` domain. Move those canonicals, sitemap origin, worker CORS allowlists, share origins, and CNAME together in the domain migration release.
