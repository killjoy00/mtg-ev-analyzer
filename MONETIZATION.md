# Pack One monetization setup

## Product decision, September 2026

Keep advertising disabled while the new game establishes retention. Blank slots are hidden. Draft Run and other active card-selection surfaces have no ad placements. Do not sell extra rerolls or gate the core game behind signup.

The preferred first experiment is one clearly labeled Daily sponsorship on the home/result surface, followed by an optional supporter/ad-free account if demand warrants it. Keep career history useful for free players. A paid tier needs server-verified entitlements and a separate payment/privacy review before activation; no subscription or paywall has been enabled in this release.

Measure completion, next-day return, second-game rate, account claims, and shares before optimizing ad revenue. `analytics/retention_funnel.sql` supplies descriptive legacy cohorts, not a QA-excluded first-Daily retention metric: its Daily view counts all Daily completers by challenge date. Use mature observation windows and define first-completion cohorts/session exclusions before making retention decisions. Player IDs and public leaderboard rows are not verified unique people or total audience counts. See the [independent review](docs/PRODUCT-REVIEW-2026-09-14.md).

## TCGplayer / Impact

The existing integration supports a configurable Impact deep-link template and does not depend on API pricing access. The owner must confirm campaign approval and supply the account's public template. Draft Run and Cube revealed-card comparisons now link to TCGplayer, as do legacy reveals. With `impactDeepLinkTemplate` empty, links use ordinary TCGplayer search destinations; no active commission tracking is claimed.

After approval:

1. In Impact, create/copy the TCGplayer deep-link template for the Pack One partner account.
2. Put that public tracking template in `tcgplayer-config.js` as `impactDeepLinkTemplate`. It must contain `{url}` where the encoded TCGplayer destination belongs.
3. Do not store TCGplayer API private keys, Impact credentials, or other secrets in this repository.
4. Verify a click lands on the intended TCGplayer card search and appears in Impact reporting.
5. Keep the disclosure page and `rel="sponsored"` attributes intact.

Pack One records `tcgplayer_click` analytics with card, set, surface, and whether affiliate routing was active.

## Google AdSense

The code uses manual ad slots only; Auto Ads are intentionally not enabled. Active gameplay hides the entire editorial/monetization shell.

Ads remain disabled and the client/slot configuration is empty. An existing `ads.txt` publisher entry or account meta tag does not establish account approval; confirm that in the publisher account before activation. Revenue, conversion and DAU thresholds in an external review are projections, not validated business results.

After AdSense approval:

1. Put the public AdSense client ID and approved slot IDs in `ad-config.js`, then set `enabled: true`.
2. Create a real `ads.txt` from `ads.txt.example` using the publisher ID supplied by AdSense.
3. Configure the required Google-certified consent flow for applicable regions before personalized advertising.
4. Keep ads out of active gameplay and away from game controls.
5. Use `?adpreview=1` for layout QA without requesting real ads.

## Domain move

Do not change canonicals or `CNAME` until `packone.pro` DNS is ready. The editorial pages currently canonicalize to the live `packone.pro` domain. Move those canonicals, sitemap origin, worker CORS allowlists, share origins, and CNAME together in the domain migration release.
