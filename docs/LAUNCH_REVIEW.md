# Draft Run launch review

## Decisions and limits

Draft Run is the main game. Ten independent puzzles use actual successful draft paths, starting at P1P1 and P1P2 and moving through contextual buckets. Choices in one puzzle do not affect the next. Each run gets one different-set reroll and one same-set pack reroll; both require a different source draft and similar model difficulty.

The trophy pick earns 100. Alternatives earn `round(95 × support / maximum support)`. This is the product owner’s settled design: matching the trophy drafter is the intended full-credit target. Preserve that rule; alternative scores use relative strong-player support. Difficulty matching is a model-based heuristic and needs player completion/reroll feedback as traffic grows. The early implementation's depth penalty and exponent 0.75 were removed: those inflated weak choices or penalized equally supported late alternatives.

Across 250 seeded runs per environment on v6, mixed Draft Run averaged 38.65 for random choices, 72.06 for consensus runner-up choices, and 10.73 for weakest choices. Powered Cube averaged 45.43, 75.31, and 17.75 respectively. Historical selections always earn 100. These are model-distribution checks, not validation against professional judgments. Existing Top 3 and Full Pack scoring remains intact.

## Corpus evidence

Only `draft_run_verified_puzzles`, version `elite-trophy-verified-v6`, is served. Coverage must match every loaded environment in `data/catalog.json`, including Powered Cube as a separate game. The verified release has 22,155 decisions from 2,075 trophy drafts across 32 expansion sets plus Powered Cube. Per-environment counts are recorded in `corpus/draft-run/catalog.json` and verified by tests. Ordinary Top 3 and Full Pack archives remain separate.

The old Neon table has 376,724 decisions. Its unversioned importer and model probabilities were not reproducible from the repository. TMT earlier-pick histories were malformed; WOE's old manifest count disagreed with its table. Those artifacts are retained for investigation but excluded from play.

Verification re-reads the official draft archive for every loaded environment and checks trophy outcomes, cohort evidence, all candidate names, the historical selection, and the exact model pool. Compact trajectory evidence includes source URL, ETag, byte count, full compressed-archive SHA-256, and matched replay counts. Models retain five-fold holdout by draft ID and the existing broader elite training cohort.

Modern sets require at least 100 prior games and the existing elite win-rate cutoff, at least 0.60. STX, MID, and VOW use their established earliest-game Diamond/Mythic cohort with at least 100 prior games. The original game archives are re-read for that rank and experience evidence; no win-rate value is invented. Every source draft independently has seven wins.

Powered Cube contains only Powered Cube trophy drafts. It starts at P1P2 because the source omits the complete opening pack, and shows the actual P1P1 card. It has ten independent decisions, two same-Cube pack rerolls, and no set reroll. Its schedules, first attempts, boards, and friend links are independent of expansion Draft Run.

For complete trophy coverage, use [the full Premier importer](ALL_TROPHY_IMPORT.md). The commands below reproduce only the frozen baseline; their 300-replay source sample must not constrain further trophy imports.

Reproduce the baseline artifacts:

1. Run `python scripts/extract_trophy_evidence.py --sets all --refresh` to audit the official archives, or use the checked-in compact evidence.
2. Run `python scripts/build_verified_trophy_corpus.py` to verify every loaded environment and regenerate serving artifacts.
3. Run `node --test tests/draft-run-corpus.test.mjs tests/draft-run.test.mjs`.
4. Apply migrations 0004–0007, then load with `node scripts/load_verified_draft_run.mjs /path/to/connection`.

The earlier v5 reconciliation script and source matches document the superseded ten-set audit; they do not build the current serving corpus. Card image supplements resolve missing metadata without changing scoring. Every served option and earlier pick requires an image. Decisions involving eight unresolved exact card names are excluded, with affected counts recorded per environment. STX, TLA, TMT, and ECL lack complete opening packs in the verified sources and enter mixed runs from P1P2 onward. Public datasets: https://www.17lands.com/public_datasets. Card images: Scryfall.

## Server and identity guarantees

Daily schedules are stored per Eastern date and environment (mixed expansions or Powered Cube). Starting reserves the first attempt. Revisions prevent concurrent answers/rerolls from committing twice, and retrying the same answer is idempotent. Answers and model support stay server-side until a pick is locked. Final result, environment contributions, ranked score, and completion events commit together and can be recovered after a lost response.

Account merges preserve the established account's identity and first Daily attempt, including an unfinished attempt, independently for each environment. Conflicting guest runs remain accessible as practice with their original date recorded. Environment progress and persistent achievements transfer. Public profiles require account claiming and explicit opt-in; private shares use the general site URL. Public responses exclude auth IDs, email, session tokens, and internal player IDs.

Friend links store the sender's final ten packs, including rerolls. Recipients can use their two rerolls, but changed packs become practice and do not generate a head-to-head W/L/T result. That keeps challenge records comparable.

## Retention and analytics

Profile presents a compact career summary, the next milestone, recent form, and best environments. Full archive and achievement lists use disclosure controls, with direct play links to unexplored environments. One Draft Run is one career game; sets visited contribute to archive progress separately. Best environments require three appearances; Draft Run, Top 3, Full Pack, and Cube have distinct performance summaries.

Milestones are persisted when derived and remain earned after a streak ends or an average falls. Historical percentile milestones consider all history, while the recent profile list shows at most 120 Daily finishes. Today is provisional; closed-board percentile is recomputed using players tied at or above the score, with at least ten players required. A tied group does not manufacture top-1% finishes.

Result screens show a nearby milestone and a light save-progress offer after a strong score, multiple games, or a streak. Guest play is unrestricted.

Client events are batched and properties allowlisted. A random session identifier groups visits. Names, emails, raw URLs, and credentials are excluded. Authoritative account claims, publication, achievement unlocks, and Draft Run completions are emitted by the backend. Canceled/failed shares do not count as completed shares.

| Question | Evidence |
| --- | --- |
| Visitor → start → first result → second game → claim → public profile | `analytics_player_career_funnel`, `analytics_retention_cohorts` |
| Daily completion → next-day return | `analytics_daily_next_day_retention`; Eastern dates and observation-complete flag |
| Daily start/completion | `daily_started` or legacy `game_start` with daily=true; `daily_completed` |
| Set / Cube discovery | `practice_set_selected`, `cube_started`, `cube_completed` |
| Profile / board use | `profile_view`, `leaderboard_view` |
| Achievements / archive / streak | `achievement_unlocked`, `achievement_view`, `achievement_share`, `archive_milestone_reached`, `streak_milestone_reached` |
| Share and friend loop | `share_click`, `share_completed`, `profile_share`, `daily_result_share`, `challenge_created`, `challenge_open`, `challenge_start`, `challenge_complete` |

Use `analytics/retention_funnel.sql`. Career results are authoritative; raw event counts are diagnostics, not unique-person conversion rates. Browser storage loss creates a new guest; account linking merges identities. Newly observed cohorts have less time to convert, and historical players may predate visitor instrumentation. Milestone event time is the first derivation time, not necessarily the instant the underlying historical game was played.

## Performance and release gates

History uses indexed keyset pagination. Public lookup uses a partial lowercase-name index and only links unambiguous names. Final-percentile queries aggregate each relevant board in one indexed scan rather than three; old qualifying finishes remain available to achievements. Per-set contributions are indexed by result ID. Token signing keys are cached for 60 seconds, bounding the rotation delay while removing repeated secret queries. No raw archives or full corpus are fetched by the browser.

Profile aggregation is proportional to one player's history; board counting grows with that player's historical board participation. Current tests use real development-branch data. For much larger histories, measure p95 latency and consider versioned closed-board aggregates with explicit invalidation on identity merges. No speculative cache or background infrastructure was introduced.

Measured development queries: 126 historical board comparisons took 1.45 ms; ten per-environment contributions took 0.13 ms. These are small-data query checks, not a load-test claim. Development integration had previously alternated between 124–236 ms when warm and roughly 10–12 seconds after some idle gaps.

Production release verification on 2026-09-10 did not reproduce that stall. In a fresh 390 px mobile browser, the homepage reached the release UI in 2.09 seconds and the first mixed-practice pack in 1.16 seconds; a subsequent Powered Cube practice pack loaded in 0.47 seconds. Rerolls completed in 0.10–0.28 seconds and all 20 pick submissions completed in 0.12–0.22 seconds end to end. Direct warm backend calls in that pass were mostly 45–237 ms; a separate post-load health diagnostic returned the growth service in 142 ms and Draft Run in 72 ms. This is a small release-verification sample, not a p95 or load-test claim; real traffic should still be monitored for cold-start outliers.

Required gates are complete JavaScript/Python suites, production data audit, legacy and Draft Run browser regressions, mobile/desktop screenshot inspection, and `tests/draft-run-backend-smoke.mjs` / `tests/cube-run-backend-smoke.mjs` against an isolated development branch. The integration test covers concurrency, account linking/merges, profile privacy, percentile ties, persistent events, and forged-score rejection. Additive migrations and the verified v6 corpus must be loaded before deploying the functions; Pages is published only after CI succeeds and the exact release commit is then verified live.

Release outcome (2026-09-10): migrations 0004–0007, the v6 corpus, `draftrunapi` deployment 3, and `pack1growth` deployment 3 were active in production before the Pages release. The exact merge commit passed post-merge tests, E2E, and Pages deployment. A fresh production browser then completed one mixed practice run and one Powered Cube practice run using the full allowed reroll sets, made 20 real picks, rendered every served card image, showed all ten review rows, opened stored friend challenges and both leaderboards, retained both career results, and opened the private guest/account UI. The mobile pages showed no horizontal overflow, no page errors, and no failed application or Neon requests. The only console noise was the browser's default `/favicon.ico` request; the site does not currently declare a favicon.

## Monetization decision

Ads remain disabled. Empty placeholders are hidden and active drafting has no ad placements. Preserve guest access and free core scoring. Start any future monetization with a clearly labeled Daily sponsorship or a supporter/ad-free option after retention improves; do not insert ads between decisions or sell rerolls. Payment, consent, and entitlement systems require their own verified release. See `MONETIZATION.md`.
