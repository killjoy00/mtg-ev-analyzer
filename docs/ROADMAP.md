# Remaining work and future scope

Use [CURRENT-STATE](CURRENT-STATE.md) for deployment and [CHARTER](CHARTER.md) for the product. Updated October 11, 2026 (newly approved product backlog; prior operating priorities retained).

The rebuild, serving optimization, leakage-corrected v8/v4 model release, Traditional v4 publication, three Dailies, Elite custom/Cube practice, public Patreon linking, and the Patreon purchase-to-activation loop are complete. The launch-attribution/habit release and the static campaign-link/Admin Link Builder follow-on are also complete; campaign vanity publishing is now an operating workflow, not remaining product scope. Issue #181 is closed after the Welcome Note activation route, authoritative OAuth verification, identity-stability protections, server-written `elite_activated` measurement, and live mobile acceptance for the already-entitled path. Issue #164 is also closed after complement-only fold construction, held-label invariance coverage, measured impact, and separately versioned release. Prior PR149/150/153/154 are closed and superseded by reviewed releases.

## Approved product scope — not yet implemented

- **[#1150](https://github.com/killjoy00/mtg-ev-analyzer/issues/1150): My Pack One Insights.** The chosen **Option B** is a complete **Stats | Insights | Account settings** internal-tab experience on web and native. Insights includes private pick-depth, time trend, environment comparisons, difficulty context, and sample-qualified descriptive observations. It is **not** an Option A-only Stats chart, new native bottom tab, or currently shipped feature. Read the [My Pack One Insights approved specification](MY-PACK-ONE-INSIGHTS.md) and reuse the [Insights implementation prompt](MY-PACK-ONE-INSIGHTS-IMPLEMENTATION-PROMPT.md) for implementation.
- **[#1151](https://github.com/killjoy00/mtg-ev-analyzer/issues/1151): opt-in Daily reminders** remain an independent product request: configurable frequency, web email and native push. Reminders are **not** part of #1150, and native store-review gates remain in force.


1. Observe the next genuinely new archive through the automated Candidate pipeline. Keep explicit publication and existing quality gates. SIR's v4 Traditional component remains Candidate under its Candidate parent; HBG/HOB/KTK/PIO Traditional sources remain blocked.
2. Validate physical-device authentication, native sharing, and assistive technology with real devices. Browser viewport tests do not establish those results.
3. Observe the next genuine Patreon billing/tier change and correlate it with signed provider webhook/reconciliation evidence. Exact tier boundaries, revocation, ordering, expiry, manual-grant preservation, activation routing and authoritative `elite_activated` transitions have automated coverage; real OAuth, reconnect, premium practice, authoritative API reconciliation and the Welcome Note route have passed. This is continuing provider-observation work, not an open #181 acceptance blocker. Do not purchase or modify subscriptions merely to manufacture evidence.
4. Watch hourly membership reconciliation and token-expiry failures. Use the reviewed sync workflow for recovery; keep stale-sync visibility in Admin Users.
5. Keep AdSense dormant: `ad-config.js` has client `ca-pub-1217971050094766`, home unit `1543495960`, and `enabled:false`; there are no gameplay ads or configured article placements. Google approval, applicable consent/privacy work and explicit owner authorization all remain blockers. While Google is disabled, the Daily-home slot shows the TCGplayer affiliate fallback to advertising-eligible visitors; Google activation replaces rather than stacks with it. Supporter ($3) and Elite ($7) use campaign/tier/state IDs rather than price for ad-free eligibility while signed in and verified.
6. Keep TCGplayer as a small measured affiliate experiment: existing revealed-card links plus one Daily-home banner, no gameplay/result or editorial banner. Impact approval and the public deep-link template are active; compare `daily_home_banner` outbound clicks with Impact conversion reporting before expanding placement.
7. Gather non-QA first-encounter measurements before changing scoring or making skill-ranking claims. A dedicated probability-calibration change, new model family or Traditional training pool needs new versioned evidence; trophy matches remain 100.

Historical compatibility and audit evidence remain preserved. No old game mode, fixed-schedule rewrite, automatic Candidate promotion, or model retraining is implied by this roadmap.


Traditional v4 release evidence and the required development-before-production component lifecycle are recorded in [the September 21 production closeout](reports/TRADITIONAL-V4-RELEASE-2026-09-21.md).

Campaign-link release evidence and the owner workflow are recorded in [the September 25 campaign links closeout](reports/CAMPAIGN-LINKS-CLOSEOUT-2026-09-25.md) and [Campaign Links owner guide](CAMPAIGN-LINKS-OWNER-GUIDE.md).
