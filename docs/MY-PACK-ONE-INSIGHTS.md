# My Pack One: Drafting Insights (approved product specification)

- **Status:** Full Insights implemented and released on web and the private API October 11, 2026 (PRs #1156 and #1157); Android closed-test candidate 100765 and owner-confirmed iOS candidate 100758. A follow-up clarifies the no-standout comparison state without changing scoring or the approved counting thresholds. Data audit and thresholds are documented below.
- **Decision date:** October 11, 2026.
- **Tracking issue:** [#1150 — My Pack One: dedicated Insights tab](https://github.com/killjoy00/mtg-ev-analyzer/issues/1150).
- **Implementation handoff:** [MY-PACK-ONE-INSIGHTS-IMPLEMENTATION-PROMPT.md](MY-PACK-ONE-INSIGHTS-IMPLEMENTATION-PROMPT.md).
- **Related but independent:** [#1151 — opt-in Daily reminders](https://github.com/killjoy00/mtg-ev-analyzer/issues/1151) is **not** included in the Insights implementation.

This specification records the approved **Option B: Drafting Strengths & Progress** experience. Option A (a small standalone pick-by-pick chart inserted into Stats) was **not selected**, and must not be built as a separate product or release. Pick-depth analysis is a component of the complete Insights tab.

## Product decision and navigation

My Pack One will have **three local tabs in this order**:

| Tab | Purpose | Existing behavior |
| --- | --- | --- |
| **Stats** | Career Snapshot, Recent Performance, Best Environments, Achievements, Recent Games, Daily History, Archive Progress and existing sharing | Keep existing layout and functionality |
| **Insights** | New private analysis of how the player's real drafting decisions vary by pick, format, difficulty, and time | First-class new tab, not a teaser card on Stats |
| **Account settings** | Existing account, profile/visibility, membership, security and deletion settings | Keep existing functionality |

This is **not a sixth site/app top-level destination** and **not a new native bottom navigation tab**. The three choices appear *inside* My Pack One. The owner-approved mockups use the current restrained Pack One style; any example scores in those mockups are illustrative, not live account data.

### Current code to preserve / extend

- **Web:** my-pack-one.mjs currently implements a two-tab Stats/Account settings switch, selected styling and panel display. profile-product.mjs supplies existing account settings and profile binding. profile.css defines the My Pack One cards and current tab styling; visual-c.css supplies the active blue/white design tokens. Keep the global site navigation unchanged.
- **Native:** mobile/src/screens/career.tsx currently shows a two-choice Stats/Account settings control inside the My Pack One root. Account settings routes to the existing account screen, and mobile/src/components/ProfileOverview.tsx renders existing statistics. mobile/app/(tabs)/_layout.tsx defines the five signed-in bottom destinations; do not add Insights there. Retain the native account screen, activity routes and normal back/return behavior.
- **Private history:** existing profile APIs and backend source tables contain some relevant information, but the current game-level recent-score trend **cannot alone** establish pick-by-pick performance.

## Insights tab: proposed visual hierarchy

The Insights surface should feel like a natural continuation of Stats: light gray page, white bordered scorecard sections, navy accents, Barlow Condensed headings, Source Sans 3 labels, restrained charts and visible sample-size explanations. Reuse existing components and tokens, not a new fantasy/AI visual language.

1. **Heading and introduction.** "Your Drafting Insights" and one concise explanation: "Explore how your draft decisions vary by pick, format and difficulty." Describe analysis rather than promise an objectively measured skill diagnosis.
2. **Filters row.** Environment: Mixed / Latest Set / Powered Cube, plus a period selector based on validated available history. Make selected environment, time window, and eligible decision count obvious. Do not silently pool formats or incompatible scoring versions.
3. **Key observations.** Up to 2–3 short, explainable findings *only when a documented sample and comparison rule supports them*. Otherwise show a helpful "More decisions needed" state; never generate made-up coaching. The insights are deterministic/descriptive, not speculative LLM recommendations.
4. **Pick-by-pick strengths.** Horizontal or vertical accessible chart of average originally awarded points by **actual source pick number**, with decision count and optional trophy-match percent/partial-credit detail. Distinguish an eight-decision run position from a source pick number; Powered Cube's historical source numbering differs from regular drafts.
5. **Progress over time.** Bounded decision-score trend and/or recent-vs-earlier comparable periods. Label windows, scoring cohorts and counts. Only describe improvement if both groups have adequate, comparable records. Do not use overall game-result trends as per-pick evidence.
6. **Format patterns.** Mixed, Latest Set and Powered Cube comparisons with distinct sample counts and selection/scoring caveats. The format selector may drive the primary charts; a separate format overview may show eligible aggregates when comparison is valid.
7. **Difficulty context.** Performance by existing verified difficulty band or similar defensible context. Prefer unadjusted descriptive band summaries if a fair normalization cannot be substantiated. Expose missing historical difficulty classifications instead of assigning assumed values.
8. **Method and limitations.** Compact expandable explanation of which decisions count, scoring versions, first-encounter/repeat handling and why some rows or trends may be unavailable. Include a friendly return to Stats/Daily for brand-new accounts.

Use real app/backend data in production. **Never ship fabricated demo averages, samples, or player-specific conclusions.** Illustrative mockup values belong only in test fixtures or disconnected design previews.

### Responsive and accessible behavior

- **Web:** three evenly spaced buttons on the existing local My Pack One tab strip; each controls a proper tab panel. Follow ARIA tab patterns (selected and hidden states, roving focus, left/right arrows, Home/End where appropriate). Tab selection must not trigger another public profile or accidentally reset Account settings. Re-render/refetch safely.
- **Mobile:** the same three choices at the top of the My Pack One/Career experience. Insights can be a dedicated native sub-screen/route if this best preserves existing back navigation, but it remains a My Pack One **local tab** in UX; do not alter the signed-in bottom navigation destinations. Keep active-section semantics and ensure Back returns to a stable My Pack One view.
- All analytical charts require text labels/accessible alternatives; avoid color-only meaning. Support 320/390/768/1440 px web layouts and dynamic type on iOS/Android. Charts and filters must remain usable with long labels, screen readers and touch targets >=44 px.
- Signed-out/guest state must explain that private Insights require a linked account rather than expose another player's data. Empty history, partial history, loading, API errors and filtered-out cohorts have distinct states. Unavailable Insights must not break Stats or Account settings.

## Data sourcing and interpretation (audit before implementation)

Existing relevant authoritative records and helpers:

- draft_run_sessions: owned player, immutable scoring/version metadata, run environment, versioned puzzle IDs, saved answers (including awarded score/puzzle context), completion markers and QA flag.
- draft_run_decision_observations: keyed by (session_id, revision), with outcome (pick vs rerolls), selected card, awarded score, trophy match and optional observed/first-seen/timing metadata.
- draft_run_verified_puzzles: **pick_number** is the actual historical/source pick position. A game's first/second/... decision **is not necessarily** source P1P1/P1P2/... for all environments.
- draft_run_measurements / draft_run_source_measurements and existing admin measurement/report definitions: potential first-encounter, QA exclusion, difficulty version and source metadata references. These are **research aids, not an authorization grant** to expose Admin data to players.
- worker/draft-run-function.mjs: originally awarded scoring is recorded when a pick is locked; scoring variants must not be silently recomputed.
- worker/growth-function.js and mobile/web career APIs: existing private account/profile boundaries and account-link ownership need to be reused.

The read-only source-field and cohort audit is **done** (October 11, 2026, from the reviewed schema, worker code and synthetic checks). Its results and the resulting counting rules are recorded below; implementation follows them and only re-verifies them with fixtures.

### Required metric contract

- **Canonical unit:** one authoritative awarded **pick decision**, not a reroll, duplicate retry, game result, rendered card exposure or number of times the same answer appears in two joined tables. Decide and document how historical outcomes lacking observation telemetry are included/flagged.
- **Original awarded score:** mean of persisted per-decision awarded scores (0–100) for the stated eligible cohort; no rescoring based on today's model. Trophy-match percentage uses the same well-defined denominator where historical match data are available; never label a model-supported alternative categorically incorrect.
- **Real pick depth:** the answer's stored source pick_number, with a separate run_position if displayed. Current eight-pick Dailies use P1P1–P1P8 (Powered Cube P1P2–P1P9); eight-pick practice reaches up to P1P10 (Powered Cube P1P11) depending on the run's selection version. Use the stored number; never apply an offset.
- **Environments:** distinguish mixed, latest, powered-cube; compare only defensible cohorts (scoring/corpus/selection/difficulty version compatibility). When comparability cannot be supported, segment by version or show a caveated/disabled comparison.
- **Time trend:** compare well-defined windows of answered decision time, not visit time or overall game recency. Show dates, counts and incomplete-window warnings; do not imply a causally proven improvement from a descriptive difference.
- **Difficulty:** use the puzzle's `support-ratio-v1` band (the only difficulty definition that has ever existed; every verified puzzle is rated on insert), otherwise "unknown"; do not infer missing band labels or present an invented difficulty-adjusted ability score.
- **Duplicates and QA:** honor idempotent revision outcomes, clear reroll semantics, first encounters only and measurement_qa exclusions; ten-pick runs are excluded. Account linking and record merging must not multiply decisions.
- **No-data and confidence:** every chart and comparison shows its eligible sample size. Before writing qualitative "stronger", "improving" or "weaker" text, specify conservative per-group minimums and comparability rules; tests must cover below-threshold samples. Even over threshold, copy stays descriptive, not statistical significance or skill certification.

The thresholds and query plan below are decided. **Do not guess production coverage or assert unavailable measurements exist**; every metric must be explainable from the returned aggregation contract.

### Audit results (October 11, 2026)

Sources: migrations 0004, 0008, 0011, 0014 and 0054, `worker/draft-run-function.mjs`, `worker/decision-measurements.mjs`, `draft-run.mjs`, `draft-run-policy.mjs` and `worker/growth-function.js`, plus read-only aggregate queries against production on October 11, 2026 to confirm data coverage and that the thresholds below are reachable by existing accounts. Per [AGENTS.md](../AGENTS.md), production counts are never published in this repository.

| Question | Finding |
| --- | --- |
| Where is one pick recorded? | `draft_run_sessions.answers`, one element per locked pick. A pick is appended only when the request's `revision` and `round` match the session (optimistic concurrency), and an exact retry returns early, so **answers never contain duplicates**. Rerolls replace `puzzle_ids[round]` and never write an answer. |
| What does an answer hold? | `score` (0–100 as awarded), `historicalMatch` (trophy match), `selectedId`, `historicalId`, and `puzzle` with `puzzle_id`, `set_id` and the source `pick_number`. |
| When was it answered? | `draft_run_decision_observations` (migration 0011) gets one row per pick with `outcome='pick'`, `round` = answer index + 1 and `answered_at=now()`, written in the same statement as the answer. Eight-pick runs (migration 0014) all post-date 0011, so every eight-pick decision has an answer time, except picks whose rows the one-time retired-source cleanup in migration 0016 deleted; those are excluded by the counting rules below. |
| Do scoring versions change scores? | No, in practice. All stored profiles (`trophy-consensus-v2`, `-v3-calibrated-v1`, `-v3-linear-v2`) award 100 for a trophy match and round(95 × selected ÷ top model support) otherwise; the calibrated profile reaches the same ratio by an algebraically equivalent path. A synthetic check of 222,854 decisions across all three profiles found **zero** score differences. Scores still reflect the model and corpus in use at the time; Insights shows them as originally awarded and never rescores. |
| Difficulty coverage | One definition exists, `support-ratio-v1` (rating = round(100 × second ÷ top model support), band easy < 50 ≤ medium < 80 ≤ hard). A trigger added in migration 0008 rates every puzzle when it is inserted; there is no separate backfill. Puzzles are inserted per corpus version, and eight-pick runs serve corpus versions imported after 0008, so a band is expected for every counted decision. **Verified against production on October 11, 2026** (read-only aggregate query): every counted eight-pick decision had a pick observation, a difficulty band, a pick number, a score and a trophy-match flag. Any rating missing in future still shows as `unknown`. Sessions labelled `difficulty_version='legacy'` describe how puzzles were *selected*, not the puzzle's difficulty. |
| Repeats | The same puzzle can be answered again in practice, shared or creator challenges, and after an account merge. |
| Account scope and merges | `account_links` maps one account to one `player_id`. `merge_pack1_player` moves a guest's sessions onto the account player; a same-day, same-environment duplicate Daily is kept with `day=NULL` and `merged_daily_date` set. |
| QA traffic | `draft_run_sessions.measurement_qa`, or a player display name matching `^(QA([ _-]\|$)\|Import check$\|Production smoke\|Release check)` (the existing measurement rule). |
| Query cost | `draft_run_sessions_player_idx (player_id, created_at DESC)` supports a bounded per-player scan; no new index is required for the planned query. |

### Counting rules and thresholds

**Counted decision (canonical unit).** One element of `answers`, in a session that:
- belongs to the signed-in account's linked `player_id` (resolved on the server from `account_links`);
- is an **eight-pick run** (`isEightPickVersion(selection_version)`, so `jsonb_array_length(puzzle_ids)=8`). **Legacy ten-pick runs are excluded entirely**, with no fallbacks for older data (owner decision, October 11);
- is not QA (`measurement_qa` false and the display name does not match the QA rule).

Then, per puzzle, **only the first encounter counts**: the earliest answer for that `puzzle_id` by `answered_at`. Later answers to the same puzzle (practice replays, shared/creator challenges, merged duplicate Dailies) are excluded. All run types (Daily, practice, shared and creator challenges) count. Incomplete runs count every locked pick.

- **Score** = the answer's stored `score`. **Trophy match** = the answer's `historicalMatch`, over the same denominator.
- **Pick depth** = the answer's `puzzle.pick_number`. **Environment** = the session's `environment` (`mixed`, `latest`, `powered-cube`).
- **Decision time** = the pick observation's `answered_at`, matched on (session, round, `outcome='pick'`). A decision with no pick observation is excluded rather than given a guessed time.
- **Difficulty band** = the puzzle's `support-ratio-v1` band, else `unknown`.
- **Bound:** read at most the player's 1,000 most recent eight-pick sessions (about 8,000 decisions) via the player index, and state the cap in the method text when it applies.

**Thresholds** (deliberately conservative; owner-delegated decision, October 11). Scores range 0–100 and single picks swing widely, so small groups are not averaged and only large, clear gaps become text.

| Use | Rule |
| --- | --- |
| Insights tab unlocks | At least **8** counted decisions in the selected environment (one full run). Below that: a "Play a few more runs" state that shows the current count. |
| A chart group shows an average (pick number, difficulty band, environment) | At least **5** decisions in the group. Smaller groups show their count with "not enough to average". |
| A month shows on the progress chart (Pacific calendar months) | At least **10** decisions in that month. |
| Progress comparison | The most recent **40** counted decisions vs the **40** before them, in the selected environment, with both date ranges shown. Requires 80 decisions. |
| Any written observation ("higher", "lower", "up", "down") | Both sides have at least **40** decisions **and** the averages differ by at least **10** points. Otherwise say the averages are about the same or that more comparable decisions are needed. |
| Observations shown | At most **3** standout comparisons, preferring the largest smaller-side sample. If none qualifies, explain that no comparison cleared the **40 per side / 10-point gap** thresholds, then show up to three **descriptive snapshots** using existing aggregates: a format-wide average (5+ decisions), recent and previous 40-pick averages (80+ decisions), and a well-sampled pick-depth count and average (5+ decisions). Do not imply insufficient *total* history merely because the differences are below the standout threshold. These snapshots are not strength rankings or trend claims. |

Written observations stay descriptive: no "significant", no causal claims, no skill ratings. Cross-environment comparisons always carry a note that the card pools differ.

## Private API and lifecycle

- Build a **read-only, authenticated and account-owned** aggregate endpoint under the existing Growth/private-profile service or justify an equivalent route. Select player scope using the validated account session/link, never a client-supplied player ID, profile key or claimed ownership.
- Return **bounded grouped aggregates** (counts, means, group keys, windows, source/scoring-version caveats, missing-data counts, permitted descriptive findings) suitable for both web and native. Never download all detailed private decisions into the browser or add them to public profile JSON, shares or telemetry.
- If adding a public-facing gateway route, explicitly update its allowlist and test credentials/CORS/authorization paths; block public/guest access to personal results.
- Use index-friendly queries and query limits; measure reasonable account history and ensure no heavy unbounded scan per tab open. If schema/index changes are warranted, add additive migrations and protected backend tests. No historical-score data rewrite.
- Abort/invalidate in-flight requests on tab refresh, account logout/switch/retirement and component unmount. Account B must never see account A's previous cached charts or backfilled history.
- Error handling is fail-closed for privacy and fail-soft for UX: Stats, Account settings and existing Daily behavior remain usable when Insights data is unavailable.

## Out of scope

- Option A-only Stats-card implementation, generic game-score sparkline presented as pick quality, new top-level nav / native bottom tab, publicly shared private insights, new paid-access gate, LLM claims, new telemetry collection solely for display, scoring/puzzle/model changes.
- Daily reminder scheduling, email or push implementation from [#1151](https://github.com/killjoy00/mtg-ev-analyzer/issues/1151).
- App Review submission, public store release and provider credential changes. (New mobile builds are **in scope after merge**; see below.)

## Mobile delivery (owner decision, October 11, 2026)

Native Insights ships in the same PR as the backend and web. After the PR is merged with the owner's go-ahead and its backend/gateway release passes, build new binaries through the repository's existing guarded workflows, as was done for iOS 1.1/100733 and Android 100740 (see [mobile-release-runbook.md](mobile-release-runbook.md)):
- **iOS:** a new signed 1.1 build (next build number) uploaded to TestFlight. Do not submit to App Review or change the App Store version; the owner selects the build. If version 1.1 is already in App Review, upload to TestFlight only and report.
- **Android:** a new signed AAB with a new version code, uploaded and promoted unchanged to the existing `production-access` closed-test track. Do not change testers, groups, countries or the Production track.
- Update [CURRENT-STATE.md](CURRENT-STATE.md), the exact-build inventory and #575 with the new build numbers.

**Result (October 11):** the backend and gateway were released in [run 38182202420](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/38182202420). Android **100765** is on the `production-access` closed track (promotion `completed`). iOS 1.1/**100758** was uploaded and is `VALID` / `APP_STORE_ELIGIBLE`; the workflow did not attach it to a version (no `1.1` record found) or verify TestFlight availability.

## Acceptance and evidence

- [ ] Full **Stats | Insights | Account settings** internal navigation on web and native. Existing Stats/Account settings features unchanged and independently regression-tested.
- [ ] Substantive four-part Insights experience: real source pick depth, comparable time trend, environment differences, difficulty context and conservative observations; all sections show counts and valid empty states.
- [ ] Written, tested source/coverage audit and explicit definitions of counted picks, first encounters, repeated puzzles, QA, rerolls, historical ten-pick sessions, account merges and incompatible scoring versions.
- [ ] Private, bounded, authorized aggregate API reused by web/native; gateway, 401/403, cross-account, logout race and privacy tests included.
- [ ] Web keyboard/screen-reader, touch, narrow screens and native dynamic type/Back navigation verified with synthetic representative player fixtures.
- [ ] CI required test + browser checks green, and native/backend-specific tests green for changed paths.
- [ ] No historical rescoring, no changes to Daily/ranking selection, no public profile leakage, no reminder implementation and no effect on in-flight iOS/Android store reviews.
- [ ] After merge and backend/gateway release: new iOS TestFlight build and Android closed-test build containing Insights, recorded in CURRENT-STATE, the exact-build inventory and #575.

Implementation should proceed via **one** reviewed GitHub feature PR containing the backend, gateway, web, native, tests and docs. Merging and the production backend/gateway release need the owner's go-ahead; the mobile builds above follow automatically once merged.
