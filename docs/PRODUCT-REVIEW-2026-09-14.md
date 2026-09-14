# Pack One independent product review and implementation report

Review date: 2026-09-14. Repository: `killjoy00/mtg-ev-analyzer`.

## Decision

The strongest direction is to make the existing games clearer to learn from, faster to enter, and more reliable to operate. The supplied review correctly identified missing consensus feedback, serious phone-layout problems and an expensive serving design. Its proposed scoring, difficulty, eligibility and growth changes do not all follow from its evidence.

The owner's confirmed goals are **learning and competition**. **Trophy picks earn 100, and every existing game mode stays.** Draft Run, Powered Cube, Top 3, Full Pack and their existing Daily/practice surfaces remain supported. This review preserves scoring versions, source eligibility, Daily weighting and historical schedules. It does not claim that existing human fairness or retention has been established.

## Evidence and limits

- Reviewed the supplied “Pack One — Full Product Review,” repository code, scoring/model and selection policies, frontend lifecycle, worker handlers, migrations, tests, deployment/import workflows and documentation. Starting main was `d7e17aaac81999758aed43d7c6bc79f956779563`.
- Reproduced the initial local suite: 106 JavaScript and 72 Python tests passed. Three distribution test files require private replay shards and skip locally; GitHub CI hydrates them and requires their execution. A local pass is not equivalent to that complete gate.
- Independently recomputed every card score in the checked-in frozen corpus: **22,155 puzzles, 201,680 card scores, zero invalid puzzles, zero formula mismatches**. Reproduce with `node scripts/review-draft-run-baseline.mjs`; [machine-readable results](audits/product-review-baseline-2026-09-14.json). This tests stored evidence and formula implementation, not whether model preferences are objectively correct.
- The supplied review's 315 live decisions, 3,065 score checks and player simulations were not accompanied by raw samples or reproduction scripts. Their exact statistics were **not independently reproduced**. They are reported observations, not a new verification performed here.
- Read-only production checks on September 14 returned 920,629 eligible puzzles, 1,003,025 archived interesting puzzles, 33 environments and 29 regular mixed environments. The public all-time Draft Run board returned five rows representing seven ranked player-days. These figures do not count all visitors, practice players, Cube players or unique humans.
- One production health request took 21.0 seconds and one public board request took 10.8 seconds from the review environment. These are individual end-to-end observations, not latency percentiles or evidence of the typical user experience. No new production player, practice run, ranked result or analytics event was intentionally created for this review.
- Browser verification used GitHub's Chromium matrix and saved screenshots, including narrow packs, contextual Cube picks, low-support feedback and the dock at the last pack row. Screenshots were inspected. This does not establish native iPhone authentication, sharing, accessibility or actual user completion rates.

## Implemented work

| PR | Changes | Verification and release status |
| --- | --- | --- |
| [#83: learning and mobile](https://github.com/killjoy00/mtg-ev-analyzer/pull/83) | Locked consensus and full support comparison; three-column phone packs; 72px prior-pick thumbnails; rerolls in the dock; distinct round/score labels; full set names; date/emoji text sharing; TCGplayer comparison links; common escaping; contrast and reduced-motion improvements. | Merged. [Unit/data gate](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/34877619437) and [browser gate](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/34877619456) passed. The new frontend feedback module was confirmed served by packone.pro. |
| [#84: backend reliability](https://github.com/killjoy00/mtg-ev-analyzer/pull/84) | Bounded SQL selection/rerolls; existing-Daily fast path; direct friend-pack loading; health coverage aggregates; isolation of missing ratings; completion persistence marker with retry recovery; serving indexes. | Merged. [Backend gate](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/34878131647), [unit/data gate](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/34878131601) and [browser gate](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/34878131632) passed. Neon migration/deployment remains a separate release step. |
| [#85: request and date integrity](https://github.com/killjoy00/mtg-ev-analyzer/pull/85) | Shared Eastern dates; refreshed Today state with stale-response protection; common render lifecycle; strict bounded JSON requests; authenticated analytics; reserved server milestones; atomic per-player quotas; production CORS cleanup; CI handling of undeployed migrations. | Merged after [backend](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/34879681759), [unit/data](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/34879681737) and [browser](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/34879681814) gates. Backend protections require migrations 0012/0013 and function deployment. |

The final implementation's local suite passed 114 JavaScript and 72 Python tests, with the same three local distribution-file exclusions. Final hydrated CI passed **117 JavaScript and 72 Python tests**, with zero failures. SQL tests exercised actual isolated Neon databases: selector/reference parity across mixed/Cube, Daily/practice and rerolls; concurrent answer revisions; first-attempt reservation; exact retries; completion repair; identity/environment boundaries; measurements; atomic quota contention and expiry. Today browser tests cover completion refresh, stale requests, Eastern rollover and failure states without creating runs merely to display status.

An initial PR #85 backend gate failed because it applied only that PR's migration while the Neon parent lacked the already-merged migration 0012. The fixed gate explicitly replays the known additive, idempotent release backlog on an expiring disposable branch, then applies new PR migrations. It does not modify the production parent. Git main and deployed SQL are now explicitly distinguished in release documentation.

## Independent assessment of code findings

| Finding | Assessment and disposition |
| --- | --- |
| **C1 — full-pool cold load** | Confirmed the paginated million-row metadata load. Replaced it with grouped eligibility counts once and the selected source trajectory per round: eleven bounded responses for a new ten-pick draw. Retains exhaustive eligibility and seeded policy; it does not sample an arbitrary prefix. Existing schedules bypass selection. The claim this alone guarantees sub-second starts is rejected. |
| **C2 — abuse and leaderboard farming** | Confirmed insufficient application quotas and formerly optional analytics authentication. Added persistent per-player quotas and strict bodies. **Partial:** new guest creation still bypasses those quotas by creating fresh identities. Trusted ingress quotas, direct-origin protection and identity-abuse policy remain open. Optional account claiming alone cannot prevent multiple-account answer harvesting. Duplicate names are an identity/UI limitation, not proof of duplicate people. |
| **C3 — discarded consensus feedback** | Confirmed and fixed. Locked answers identify the trophy choice and elite consensus separately, show selected support relative to the leader, expose the top alternatives and allow expansion to every card. Low scores are explained by support magnitude. Comparison labels explicitly avoid presenting support as correctness or win probability. |
| **C4 — repeated result writes** | Confirmed. Added an atomic persistence marker so acknowledged completion skips repeated writes. Retained recovery on GET/exact retry when the final answer committed but result persistence failed. Simply moving all work to the final answer would lose this recovery path. |
| **C5 — localStorage tokens** | Confirmed residual risk; no exploitable injection was established in this review. Consolidated escaping, including apostrophes. **Open:** long-lived player tokens and localStorage remain. A first-party HttpOnly cookie needs a compatible first-party API/auth route, CSRF treatment and revocation design. The current Pages frontend and Neon API/Auth origins make this more than changing a cookie flag. |
| **C6 — duplication** | Consolidated escaping and Eastern-date ownership; retained a compatibility date export for cached callers. Today/Profile now use the common render lifecycle. The original architecture test missed their additional observers. Browser/worker path-model copies and legacy scoring duplication remain, with existing parity coverage; a separate refactor must preserve both deployable entry points. |
| **C7 — one missing rating disables all play** | New selection joins only rated puzzles; health reports incomplete coverage and fails visibly. A healthy run can proceed while an unrated row is isolated. An existing specific challenge with missing evidence still fails explicitly. Offline integrity audits remain strict. |
| **C8 — client QA flag** | Correct that this is a convenience, not a security boundary. A display-name regex is also client-controlled and does not solve that limitation. Keep test exclusions; distinguish session provenance from unique-human verification before interpreting measurements. |
| **Low cleanup** | Fixed localhost CORS defaults, preserved nullable target-support ratios, removed unreachable score arithmetic and renamed misleading UTC callers. No score version or numerical rule changed. |

### Performance result, without extrapolation

On PR #84's isolated database gate, existing Daily joins took **106–210 ms**; the first measured new practice run took **6.4 seconds**. A later integration fixture created its new run in about **2.4 seconds**. The final PR #85 gate measured another new run at **6.75 seconds**, so the remaining delay is repeatable in that environment. The first selector implementation passed correctness tests but remained slow; counts were then changed from per-round rescans to one initial query before merge.

This removes the full-pool transfer and establishes policy parity. It does **not** finish latency work. Measure deployed cold/warm starts, rerolls, friend starts, public boards, health and concurrency against the full corpus before declaring a performance target met. See [backend release and rollback instructions](BACKEND-RELIABILITY.md).

## Independent assessment of scoring and selection recommendations

| Finding | Assessment and disposition |
| --- | --- |
| **B1 — difficulty versus stakes** | The support ratio measures ambiguity between leading cards. Random-choice score loss is a different quantity. Their relationship follows partly from the score formula and does not demonstrate inverted human difficulty. Keep the hidden composition/reroll heuristic and collect real first-attempt behavior. Do not ship `stakes-v1`/`first-pack-v3` on simulation alone. |
| **B2 — unreachable 100** | The proposed probability calculation does not describe displayed run scores: nine trophy matches plus one 95 average 99.5 and display **100**. `p^10` concerns ten matches, assumes independence and misses rounding. “97 is perfect” would misdescribe the fixed rules. Scores and trophy-match counts remain separate; achievement design can later distinguish sustained mastery without changing prior awards. |
| **B3 — low scores are illegible** | Agreed about missing explanation. Fixed feedback and preserved the linear score curve. No score floor or tail inflation was justified. |
| **B4 — simulations establish skill fairness** | The reported strategy experiments can support separation under their model assumptions. They do not establish human skill measurement, fairness, calibration or observed retention. Reroll histories can also produce different realized packs despite a shared starting Daily. Keep the formula, but do not market simulations as human validation. |
| **B5 — low trophy support proves bad play** | Rejected. A disagreement may reflect an unusual historical choice, context missing from the model or model error. Removing disagreements would select puzzles for agreement with the same model used to judge them. Keep eligibility and show the disagreement after lock. Human/expert review should precede any versioned quality exclusion. |
| **B6 — recency and familiarity** | Familiarity is a plausible learning barrier, not a measured explanation of current scores. The suggested “mostly top three sets” does not follow from stronger weights while the selector prefers distinct sets: a ten-distinct-set run can contain at most three of those sets. Full names and inspection help now. Choose-your-sets practice remains a concrete candidate requiring separate prioritization and pool validation. |
| **B7 — Cube is redundant** | Sharing a formula does not make the card environment and learning task interchangeable. Keep the separate Cube Daily/practice/board, as explicitly required by the owner. |

The frozen-baseline audit independently found the expected ambiguity/stakes relationship:

| Unweighted eligible-puzzle statistic | Mixed | Cube |
| --- | ---: | ---: |
| Puzzles | 17,299 | 585 |
| Uniform-card mean score | 40.27 | 46.20 |
| Model-leader mean score | 97.73 | 97.21 |
| Trophy support below 20% of leader | 2.53% | 2.39% |
| Uniform-card mean, easy band | 24.89 | 28.52 |
| Uniform-card mean, medium band | 39.36 | 41.97 |
| Uniform-card mean, hard band | 49.02 | 55.78 |

These are equally weighted **puzzles** in a frozen baseline. They are neither balanced-run averages nor current production estimates and must not become leaderboard benchmark rows. The reproducible script states its tie convention. The broader elite model and held-out-by-draft construction were retained; this work does not retrain it or re-download original raw archives.

## Independent assessment of design findings

| Finding | Assessment and disposition |
| --- | --- |
| **D1 — phone pack/context/dock** | Fixed the grid, compact context thumbnails, duplicate headings and reroll placement. Verified computed layout and screenshots at phone widths. Zoom remains available because thumbnails cannot replace readable card text. Real-device completion testing remains open. |
| **D2 — missing heading whitespace** | Fixed both “Ten picks. Your call.” and Cube when the line break is hidden. |
| **D3 — mixed indices and scores** | Round numbers remain round numbers; earned scores are separate small values. |
| **D4 — Today visual differences** | The serif/green Today treatment had just been approved in PR #82. A different visual treatment is not itself a defect. Preserved it; did not undo that decision based on taste. |
| **D5 — platform fonts** | A fallback can alter typography. The report's blanket device-font claims were not verified on actual devices. No new webfont dependency was added without evaluating legibility, licensing and loading cost. |
| **D6 — repeated home CTAs** | The current Today insertion is already above feature blocks, so the supplied ordering claim is stale for this baseline. Found and fixed more concrete issues: stale completion/date status and racing requests. Further returning-player simplification needs observed navigation/completion evidence. |
| **D7 — accessibility** | Darkened faint text and added reduced-motion treatment. Small text, full contrast coverage, touch/zoom, focus behavior and screen-reader interaction still need an accessibility pass. Dark mode is a product option, not by itself proof of accessibility failure. No blanket WCAG conformance is claimed. |
| **D8 — achievements** | Current archive achievements count environment exposure, so a mixed run intentionally advances several environments. The claim that they were meant to represent months is unsupported by their definitions. Preserve earned awards; add distinct depth/mastery goals only with an explicit definition. |
| **D9 — smaller issues** | Full names now come from a checked-in [Scryfall metadata snapshot](../data/set-display-names.json); the existing catalog actually contained codes, contrary to the report. Collapse the repeated revealed pack/context, keep card zoom, default result sharing to text, and hide result editorial material. TCGplayer links now have a relevant revealed-card surface. Distinct round indices explain repeated P1P10 contexts. Today circles already have decorative semantics; they need not become controls. |

## Independent assessment of growth and monetization recommendations

| Finding | Assessment and disposition |
| --- | --- |
| **M1 — five rows means zero users** | Rejected. Five public ranked identities do not establish total usage or launch status. Real acquisition, completion and repeat-play cohorts are needed. |
| **M2 — corpus done, stop imports** | A completed archive snapshot is not perpetual freshness. Keep inexpensive freshness accounting and deliberate validated imports. Corrected documentation to distinguish the scheduled legacy replay backlog from manually dispatched full-trophy imports and legacy skill backfills. A fixed 20/80 time split has no supporting measurement here. |
| **M3 — positioning** | Homepage copy now gives the learning purpose: compare your choices with verified trophy drafts and elite consensus. Avoid “ten pick-one decisions,” because most questions are contextual later picks. Avoid an unmeasured two-minute promise and unsupported exclusivity claims about public 17Lands-derived data. |
| **M4 — share loop** | Implemented default spoiler-free text with ten score squares, game family, score, trophy matches and actual Eastern Daily date. Keep images secondary. A sequential number needs an agreed epoch; no launch date was invented. Sharing is a useful experiment, not a guaranteed or sole acquisition engine. |
| **M5 — empty boards and benchmarks** | Keep honest empty boards. Do not insert simulated players. Any future benchmark belongs in a separately labeled comparison computed for the actual pack set, with reroll handling and a stated method; corpus-wide rounded means cannot stand in for today's score. |
| **M6 — affiliate surface** | Added revealed-card TCGplayer links. The Impact template is empty, so these currently use ordinary search destinations and do not establish active commissions. `ads.txt`/a publisher meta tag does not prove AdSense approval. Owner-side account confirmation and a verified tracking template remain open; ads remain disabled. |
| **M7 — revenue ladder** | Pricing, conversion, revenue and DAU thresholds in the supplied table are unsupported projections. No payment system, paywall or sold rerolls was added. Keep the existing free core and useful career history; test a sponsorship/supporter proposition only after observed demand. |
| **M8 — distribution** | Creator challenges and carefully sourced editorial pages are reasonable experiments, not established best channels. Existing stored friend links already preserve exact packs and a display name; a new persistent-link mechanism is not a prerequisite. Existing public 17Lands data is not proprietary evidence no one else can analyze. Aggregate pages must state sample/eligibility and separate real frequencies from model support. Four detailed set articles do not mean only four environments are playable. No outreach, creator message, community post or ad buy was sent. |
| **M9 — retention and 90-day gate** | The existing `analytics_daily_next_day_retention` view includes all Daily completers by challenge date, not only each player's first Daily, and it does not exclude QA. Corrected documentation/SQL comments; do not use it as the claimed first-Daily retention metric. Cohort maturity matters. The proposed 15%/30% thresholds are not validated decision rules. |
| **M10 — delete modes** | Rejected by the owner's explicit constraint. Existing modes and their regression/data gates stay. |

## Remaining work, in order

| Priority | Work and acceptance evidence | Dependency |
| --- | --- | --- |
| **1 — release** | Apply migrations 0012 and 0013 in development, deploy the reviewed `draftrunapi`, `pack1growth` and `pack1api` bundles, run HTTP smoke/recovery checks, then promote the same revision. Verify production health coverage and timings. Leave additive schema in place for rollback. | **Neon deployment access or an owner-operated, approved release workflow.** GitHub merge alone does not deploy these functions. |
| **2 — serving latency** | Measure cold/warm new-run, reroll, friend, board and health latency and concurrency in the deployed environment. Investigate remaining scan/startup cost using query plans before adding a different serving architecture. Keep SQL/reference parity and immutable scheduled packs. | Deployed backend and runtime/query-plan access. |
| **3 — ingress and identity abuse** | Verify trusted client-IP provenance, enforce guest-creation/public-endpoint quotas, block origin bypass and test spoofing. Define a verified competition policy if needed. Inspect inactive identities before considering deletion; do not impose a TTL that loses legitimate guest history. | Hosting/edge configuration and owner identity-policy decisions. |
| **4 — account/session hardening** | Design first-party HttpOnly session handling with revocation, expiry, sign-out and CSRF protection; test across devices and account claiming. Preserve guest play and existing identities. | API/auth routing access and a reviewed migration plan. |
| **5 — device/accessibility** | Native iPhone sign-in, share/cancel/copy fallback, resume, Eastern midnight, card zoom, dock occlusion, focus and screen-reader checks. Verify actual completion friction before redesigning home again. | Actual devices or suitable device-testing access. |
| **6 — trustworthy retention and learning** | Define first-ever completed Daily cohorts by actual completion time, separate environment/mode, exclude known QA using session provenance, and observe the complete next Eastern day. Report identity/telemetry limitations and uncertainty. Then review human first-attempt score, time, rerolls and disagreement cases before tuning. | Private analytics access, agreed cohort definitions and enough non-QA activity. No current retention percentage is asserted. |
| **7 — distribution and commercial setup** | Test traceable creator/friend sharing and one sourced editorial experiment; evaluate observed returns before scaling. Confirm Impact routing and account approval before commission claims. | Explicit outreach/publication direction; owner affiliate-account configuration. |

Choose-your-sets practice, deeper achievements, dark mode, extra typography, wider SEO coverage and a paid tier remain candidates, not requirements inferred from this review. The next product decisions should follow observed learning and competition outcomes. No existing mode needs to be removed to complete the higher-priority work.

## Documentation and reproduction map

- [Current state](CURRENT-STATE.md), [charter](CHARTER.md), [roadmap](ROADMAP.md) and [documentation index](README.md) distinguish fixed rules, merged improvements and deployment work.
- [Scoring and difficulty](SCORING-AND-DIFFICULTY.md) describes hidden pre-answer evidence, rounded run scores and the limits of model support. Public [how-to](../how-it-works/index.html), [scoring](../scoring/index.html) and [methodology](../methodology/index.html) pages now reflect current late-pick caps, rounded totals and revealed relative support.
- [Data management](DATA-MANAGEMENT.md), [full trophy imports](ALL_TROPHY_IMPORT.md) and the [repository README](../README.md) distinguish frozen baselines, expanded production and actual workflow triggers.
- [Request integrity](REQUEST-INTEGRITY.md) and [backend reliability](BACKEND-RELIABILITY.md) describe concrete protections, residual gaps and rollout/rollback.
- [Monetization](../MONETIZATION.md) and [retention query notes](../analytics/retention_funnel.sql) no longer imply verified revenue/account approval or a first-Daily/QA-clean cohort that the current SQL does not produce.
- [Baseline audit script](../scripts/review-draft-run-baseline.mjs) and [output](audits/product-review-baseline-2026-09-14.json) reproduce the independent score checks without production writes or raw archive downloads.
