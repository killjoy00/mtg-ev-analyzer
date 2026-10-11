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

## User-facing feature

Build the complete, responsive Insights tab, with four real analysis areas and conservative evidence-based observations:

- **Pick-depth patterns:** awarded score and sample size by verified **source pick_number**, optionally trophy-match share. Distinguish source P1P* from game round. Powered Cube can use P1P2–P1P9 rather than P1P1–P1P8; handle verified legacy numbering instead of assigning an offset.
- **Progress over time:** honest, bounded recent/earlier comparisons or rolling decision trends for comparable versions and periods; display dates, decision counts, and what qualifies for the comparison.
- **Format patterns:** Mixed, Latest Set and Powered Cube selectors and/or summaries; no unqualified cross-format skill ranking or misleading pooling.
- **Difficulty context:** show distributions/averages by historically applicable verified difficulty band; mark unknowns rather than inventing a difficulty-adjusted rating.
- **Top observations:** 2–3 optional concise, rule-based, well-supported descriptive findings (e.g. changes in averages within a valid cohort), each with denominators and context. Below-threshold or non-comparable cohorts should show "Not enough comparable decisions yet" or equivalent, not guesses.

Provide filters, empty/insufficient-data states, accessible readable charts, count/uncertainty notes, loading/error/retry handling, and a compact "How these insights are calculated" explanation. Use live account-authorized aggregates, **not mock data in production**.

## Data and backend: audit first, then build

Before writing metrics or migrations, inspect **draft_run_sessions.answers** (persisted original score and puzzle context), **draft_run_decision_observations** (revision, outcome, score, trophy_match and rendered-observation caveats), **draft_run_verified_puzzles.pick_number**, **draft_run_measurements / draft_run_source_measurements**, current account links and the existing private Growth profile routes. Read and reuse prior decision-measurement semantics where appropriate, but do **not** mistake Admin-only reports for a player authorization path.

Write down the **canonical per-pick cohort** and missing-data treatment in docs/MY-PACK-ONE-INSIGHTS.md. Verify, with fixtures:

- Pick versus reroll, retries and duplicate revisions, repeated source puzzles, measured/legacy unobserved decisions, imported history, historical eight- and ten-pick runs, QA sessions, completed/incomplete games.
- Original awarded scores, historical trophy match, source pick_number vs run index, scoring/selection/corpus/difficulty versions and missing ratings.
- Account merge/claim and ownership boundaries. Ensure joining answers to observations cannot double-count a pick; decide whether and how first encounters are counted.
- Equal/comparable time windows and minimum group samples for every conclusion. If compatibility or coverage cannot be proved, segment the cohort or omit the comparison; never silently regrade old decisions.

Implement a **private, bounded, read-only aggregate endpoint** through the existing Growth/profile service (or justify a safer equivalent), with shared stable response types for web and mobile. Resolve account/player identity **on the server** from the authenticated session. No client-chosen player ID, public profile key or unbounded history dump may authorize another person's analytics. Index/limit queries and add an additive migration only if performance evidence warrants it. Update gateway request routing/allowlists and auth tests for any new path.

The endpoint should return chart-ready grouped values with numerator/denominator/sample counts, environment/pick/band/time grouping, selected versions and data-coverage caveats. Use consistent filters across components; forbid public/guest access; prevent cross-account cache leaks and stale in-flight responses after logout, account switch or account deletion.

## Web implementation

Start with **my-pack-one.mjs**, **profile-product.mjs**, **profile.css**, **visual-c.css**, current Growth client APIs and profile/browser tests. Extend the existing two-tab control into **Stats | Insights | Account settings**; add a real third tabpanel rather than a page-wide placeholder. Preserve Stats/Account panel functionality and tab persistence during expected profile refreshes. Implement full ARIA tab/tabpanel and keyboard behavior (left/right arrows across all three, Home/End if appropriate, roving tabindex, sensible focus, hidden panel states). Ensure responsive 320/390/768/1440-width layout and readable accessible chart descriptions.

## Native implementation

Start with **mobile/src/screens/career.tsx**, **mobile/src/components/ProfileOverview.tsx**, the existing account and Profile activity routes, mobile/src/api/career.ts and **mobile/app/(tabs)/_layout.tsx**. Inside My Pack One, present the same three choices. A native Insights subroute is acceptable if it reads like a local My Pack One section and Back restores the right context. **Do not add another global bottom tab.** Reuse native typography/theme, implement loading/empty/error and pull-to-refresh or retry, screen-reader labels, touch sizing, dynamic text, and strict account-session invalidation. Do not regress Profile & visibility, membership, career history, stats or navigation. Exercise iOS and Android paths with existing automated fixtures and available device/simulator checks; disclose unverified physical-device acceptance.

## Tests and evidence

Add focused unit, backend PostgreSQL and browser/native regression tests, reusing existing project conventions:

- Selection/aggregation math by source pick number, Cube offset/legacy numbering, score/trophy rules, difficulty and format filters, version compatibility, time windows and thresholds.
- Reroll/no-pick, duplicate revision/retry, incomplete/ten-pick/legacy games, repeat source puzzles, QA exclusions, missing data, account migration and zero-history paths.
- Private endpoint auth failures, cross-account isolation, public-profile non-disclosure, account deletion/credential retirement, logout/switch races and bounded-query behavior.
- Web ARIA keyboard/focus/tab state, Stats and Account settings preservation, error fallback and all responsive widths; native three-section navigation/back, offline/error, refresh, accessibility and account switching.
- Run the appropriate offline fast test suite and all required PR checks. Do not claim tests or provider/device validations that did not run. Record the exact test commands, check status, known limitations and final diffs in the PR description.

## Working procedure and finish line

1. Audit the current data/UX contracts; report material uncertainties without guessing. Update the spec with verified cohort decisions.
2. Implement the backend aggregation + auth/gateway contracts, web three-tab UI, and native My Pack One Insights UI. Deliver the full Option B, not only the pick chart.
3. Add documentation, fixture coverage and regression tests; run checks and fix failures.
4. Create a focused **GitHub feature pull request linked to #1150**. Summarize the implemented pages, sample-size/legacy rules, source paths, changed files, tested platforms and release impact.
5. **Do not** rewrite historic scores, puzzles, Daily schedules or ranking authority; modify provider credentials; post secrets/private logs to public GitHub; enable reminder delivery; or change store-review tracks. **Do not merge, promote production backend/schema, deploy production UI, sign/upload binaries or submit to Apple/Google without separate explicit authorization.** Keep current app-store testing/approval clocks intact.
6. Return the PR link, exact implemented scope, verification results and any remaining bounded release/physical-device acceptance steps. Do not call a partial UI or mock data "complete."

When implementation choices are not explicitly fixed, use the simplest existing production pattern that meets the spec. Ask for a decision only if a genuine blocking product tradeoff remains. Otherwise implement, validate and deliver a reviewable PR.

---

This is a **prompt for future implementation**, not evidence of implementation or production deployment.
