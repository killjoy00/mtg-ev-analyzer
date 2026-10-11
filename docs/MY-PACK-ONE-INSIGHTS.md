# My Pack One: Drafting Insights (approved product specification)

- **Status:** Approved design and implementation scope; **not yet implemented or released**.
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

The first engineering task is a **read-only source-field and cohort audit** on representative synthetic fixtures / reviewed schema. Determine coverage for legacy sessions, incomplete and ten-pick runs, unobserved client outcomes, rerolls, score/difficulty/model version drift and repeat puzzle exposures. Record exact inclusion/exclusion and provenance decisions in this document **before or alongside code**.

### Required metric contract

- **Canonical unit:** one authoritative awarded **pick decision**, not a reroll, duplicate retry, game result, rendered card exposure or number of times the same answer appears in two joined tables. Decide and document how historical outcomes lacking observation telemetry are included/flagged.
- **Original awarded score:** mean of persisted per-decision awarded scores (0–100) for the stated eligible cohort; no rescoring based on today's model. Trophy-match percentage uses the same well-defined denominator where historical match data are available; never label a model-supported alternative categorically incorrect.
- **Real pick depth:** verified puzzle source pick_number, with a separate run_position if displayed. Regular eight-pick sources typically correspond to P1P1–P1P8; Powered Cube source positions can be P1P2–P1P9. Verify actual available source data, including legacy ten-pick releases; do not hardcode a made-up universal offset.
- **Environments:** distinguish mixed, latest, powered-cube; compare only defensible cohorts (scoring/corpus/selection/difficulty version compatibility). When comparability cannot be supported, segment by version or show a caveated/disabled comparison.
- **Time trend:** compare well-defined windows of answered decision time, not visit time or overall game recency. Show dates, counts and incomplete-window warnings; do not imply a causally proven improvement from a descriptive difference.
- **Difficulty:** use rated/known difficulty attached to the decision's historically applicable version, otherwise "unknown"; do not infer missing band labels or present an invented difficulty-adjusted ability score.
- **Duplicates and QA:** honor idempotent revision outcomes, clear reroll semantics, genuine first encounters, repeat encounters, imported/legacy gaps and measurement_qa exclusions. Account linking and record merging must not multiply decisions.
- **No-data and confidence:** every chart and comparison shows its eligible sample size. Before writing qualitative "stronger", "improving" or "weaker" text, specify conservative per-group minimums and comparability rules; tests must cover below-threshold samples. Even over threshold, copy stays descriptive, not statistical significance or skill certification.

The exact cohort thresholds and query/index plan are engineering decisions backed by the audit; **do not guess production coverage or assert unavailable measurements exist**. Every metric should be explainable from the returned aggregation contract.

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
- App-store approval, tester-track promotion, binary signing/upload, provider credential changes and production activation as side effects of building Insights.

## Acceptance and evidence

- [ ] Full **Stats | Insights | Account settings** internal navigation on web and native. Existing Stats/Account settings features unchanged and independently regression-tested.
- [ ] Substantive four-part Insights experience: real source pick depth, comparable time trend, environment differences, difficulty context and conservative observations; all sections show counts and valid empty states.
- [ ] Written, tested source/coverage audit and explicit definitions of counted picks, first encounters, repeated puzzles, QA, rerolls, historical ten-pick sessions, account merges and incompatible scoring versions.
- [ ] Private, bounded, authorized aggregate API reused by web/native; gateway, 401/403, cross-account, logout race and privacy tests included.
- [ ] Web keyboard/screen-reader, touch, narrow screens and native dynamic type/Back navigation verified with synthetic representative player fixtures.
- [ ] CI required test + browser checks green, and native/backend-specific tests green for changed paths.
- [ ] No historical rescoring, no changes to Daily/ranking selection, no public profile leakage, no reminder implementation and no effect on in-flight iOS/Android store reviews.

Implementation should proceed via a reviewed GitHub feature PR. **Do not interpret this documentation approval as permission to promote backend/schema to production or submit new mobile builds**; release gating is separately controlled.
