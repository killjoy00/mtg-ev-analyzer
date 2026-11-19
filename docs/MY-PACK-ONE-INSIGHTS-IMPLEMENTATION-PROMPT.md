# Implementation prompt: My Pack One Insights tab

**Purpose:** Copy the prompt below into a coding agent working on [Pack One](https://github.com/killjoy00/mtg-ev-analyzer). It implements **issue #1150 only**, following the owner-approved [Insights product specification](MY-PACK-ONE-INSIGHTS.md).

---

You are implementing the fully approved **My Pack One Insights tab** in the GitHub repository **killjoy00/mtg-ev-analyzer**, tracked by **#1150**.

This is an **end-to-end feature implementation task, not a brainstorming exercise**. Read AGENTS.md, docs/MY-PACK-ONE-INSIGHTS.md, docs/DESIGN-SYSTEM.md, docs/CI-AND-MERGING.md, docs/DECISION-MEASUREMENTS.md and the relevant current source/tests. Inspect the actual current branch before changing anything. Follow repository safety, auth, privacy, test and release gates.

## Non-negotiable product decisions

1. My Pack One contains exactly **three local sections/tabs: Stats | Insights | Account settings**, in that order, on web and mobile. **Insights is the middle tab.**
2. **Option B only: Drafting Strengths & Progress**, as a full independent Insights view. **Do not build Option A first**, and do not just add a small chart beneath Recent Performance.
3. Keep all existing Stats and Account settings content/behavior and preserve the current signed-in top navigation and native five-item bottom tab bar. Insights is **not** a global sixth item.
4. Match Pack One's existing navy/white/light gray visual system, Barlow Condensed/Source Sans 3 typography, scorecard cards, spacing and compact charts. The approved mockup is directional; never hardcode its sample statistics into production.
5. Insights stays **private to the signed-in account**; do not expose data or conclusions on public profiles, sharing surfaces, leaderboards or analytics. Guests see sign-in guidance.
6. **Do not implement issue #1151 (Daily reminders)** as part of this project. That remains separately tracked.
7. **One PR** contains everything: backend endpoint, gateway route, web tab, native screen, tests and docs. Do not split it.
8. **Only current eight-pick runs count.** Legacy ten-pick runs are excluded entirely; build no fallbacks or special handling for older data.

## User-facing feature

Build the complete, responsive Insights tab, with four real analysis areas and conservative evidence-based observations:

- **Pick-depth patterns:** awarded score and sample size by verified **source pick_number**, optionally trophy-match share. Distinguish source P1P* from game round. Use each answer's stored pick_number (Powered Cube starts at P1P2); never assign an offset.
- **Progress over time:** honest, bounded recent/earlier comparisons or rolling decision trends for comparable versions and periods; display dates, decision counts, and what qualifies for the comparison.
- **Format patterns:** Mixed, Latest Set and Powered Cube selectors and/or summaries; no unqualified cross-format skill ranking or misleading pooling.
- **Difficulty context:** show distributions/averages by historically applicable verified difficulty band; mark unknowns rather than inventing a difficulty-adjusted rating.
- **Top observations:** 2–3 optional concise, rule-based, well-supported descriptive findings (e.g. changes in averages within a valid cohort), each with denominators and context. Below-threshold or non-comparable cohorts should show "Not enough comparable decisions yet" or equivalent, not guesses.

Provide filters, empty/insufficient-data states, accessible readable charts, count/uncertainty notes, loading/error/retry handling, and a compact "How these insights are calculated" explanation. Use live account-authorized aggregates, **not mock data in production**.

## Data and backend: rules are decided

The data audit is **done**. Implement the [Audit results](MY-PACK-ONE-INSIGHTS.md#audit-results-october-11-2026) and [Counting rules and thresholds](MY-PACK-ONE-INSIGHTS.md#counting-rules-and-thresholds) in the spec exactly; do not redesign them. In short:

- **Counted decision:** one element of `draft_run_sessions.answers` in the account's linked player's non-QA **eight-pick** sessions, first encounter per `puzzle_id` only (earliest `answered_at`). Rerolls never appear in `answers`; incomplete runs count their locked picks.
- **Fields:** stored `score` and `historicalMatch` (never rescore), `puzzle.pick_number`, session `environment`, the pick observation's `answered_at` (no observation → excluded), and the puzzle's `support-ratio-v1` band (else `unknown`).
- **Thresholds:** unlock at 8 decisions; averages need 5 per group; months need 10; progress compares the latest 40 decisions with the 40 before; written observations need 40 per side and a 10-point gap; at most 3 observations.
- **Bound:** at most the 1,000 most recent eight-pick sessions via `draft_run_sessions_player_idx`; no migration is expected.

Re-verify these rules with synthetic fixtures (PostgreSQL contract tests). If the code contradicts a recorded finding, stop and report it rather than silently changing the rule. **No production data is needed or permitted**: never query production for this work, and never put production counts or player data in code, tests, PRs or comments (see AGENTS.md).

Implement a **private, bounded, read-only aggregate endpoint** in the Growth service, with shared stable response types for web and mobile. Resolve account/player identity **on the server** from the authenticated session (browser cookie or native account token). No client-chosen player ID, public profile key or unbounded history dump may authorize another person's analytics. Add the route to the gateway's browser and native account allowlists and test the 401/403 paths. The endpoint returns chart-ready grouped values with counts (environment, pick number, difficulty band, month, the 40/40 progress windows with date ranges), the qualifying observations, and coverage notes. Forbid public/guest access; prevent cross-account cache leaks and stale in-flight responses after logout, account switch or account deletion.

## Web implementation

Start with **my-pack-one.mjs**, **profile-product.mjs**, **profile.css**, **visual-c.css**, current Growth client APIs and profile/browser tests. Extend the existing two-tab control into **Stats | Insights | Account settings**; add a real third tabpanel rather than a page-wide placeholder. Preserve Stats/Account panel functionality and tab persistence during expected profile refreshes. Implement full ARIA tab/tabpanel and keyboard behavior (left/right arrows across all three, Home/End if appropriate, roving tabindex, sensible focus, hidden panel states). Ensure responsive 320/390/768/1440-width layout and readable accessible chart descriptions.

## Native implementation

Start with **mobile/src/screens/career.tsx**, **mobile/src/components/ProfileOverview.tsx**, the existing account and Profile activity routes, mobile/src/api/career.ts and **mobile/app/(tabs)/_layout.tsx**. Inside My Pack One, present the same three choices. A native Insights subroute is acceptable if it reads like a local My Pack One section and Back restores the right context. **Do not add another global bottom tab.** Reuse native typography/theme, implement loading/empty/error and pull-to-refresh or retry, screen-reader labels, touch sizing, dynamic text, and strict account-session invalidation. Do not regress Profile & visibility, membership, career history, stats or navigation. Exercise iOS and Android paths with existing automated fixtures and available device/simulator checks; disclose unverified physical-device acceptance.

## Tests and evidence

Add focused unit, backend PostgreSQL and browser/native regression tests, reusing existing project conventions:

- Selection/aggregation math by stored source pick number (including Powered Cube's P1P2 start), score/trophy rules, difficulty and format filters, time windows and thresholds.
- Reroll/no-pick, duplicate revision/retry, incomplete games, ten-pick sessions being excluded, repeat source puzzles (first encounter only), merged duplicate Dailies, QA exclusions, missing observation or rating, and zero-history paths.
- Every threshold boundary: 7 vs 8 decisions to unlock, 4 vs 5 per group, 9 vs 10 per month, 79 vs 80 for progress, 39 vs 40 per side and 9 vs 10 points for observations, and the 3-observation cap.
- Private endpoint auth failures, cross-account isolation, public-profile non-disclosure, account deletion/credential retirement, logout/switch races and bounded-query behavior.
- Web ARIA keyboard/focus/tab state, Stats and Account settings preservation, error fallback and all responsive widths; native three-section navigation/back, offline/error, refresh, accessibility and account switching.
- Run the appropriate offline fast test suite and all required PR checks. Do not claim tests or provider/device validations that did not run. Record the exact test commands, check status, known limitations and final diffs in the PR description.

## Working procedure and finish line

1. Read the recorded audit and rules; confirm them with fixtures. Report, rather than change, anything the code contradicts.
2. Implement the backend aggregation + auth/gateway contracts, web three-tab UI, and native My Pack One Insights UI. Deliver the full Option B, not only the pick chart.
3. Add documentation, fixture coverage and regression tests; run checks and fix failures.
4. Create **one GitHub feature pull request linked to #1150** with all layers. Summarize the implemented pages, counting rules, thresholds, source paths, changed files, tested platforms and release impact.
5. **Do not** rewrite historic scores, puzzles, Daily schedules or ranking authority; modify provider credentials; post secrets/private logs to public GitHub; or enable reminder delivery. **Do not merge or run the production backend/gateway release without the owner's go-ahead.**
6. **After merge and a passing backend/gateway release, build new mobile binaries** (owner-approved October 11) through the existing guarded workflows, as for iOS 1.1/100733 and Android 100740 ([runbook](mobile-release-runbook.md)): a new iOS 1.1 build to TestFlight (do not submit to App Review or touch the App Store version; if 1.1 is already in review, upload only and report), and a new Android AAB uploaded and promoted unchanged to the existing `production-access` closed-test track (no tester, group, country or Production change). Then update CURRENT-STATE.md, the exact-build inventory and #575 with the new build numbers.
7. Return the PR link, exact implemented scope, verification results, the new build numbers once built, and any remaining physical-device acceptance steps. Do not call a partial UI or mock data "complete."

When implementation choices are not explicitly fixed, use the simplest existing production pattern that meets the spec. Ask for a decision only if a genuine blocking product tradeoff remains. Otherwise implement, validate and deliver a reviewable PR.

---

This is a **prompt for future implementation**, not evidence of implementation or production deployment.
