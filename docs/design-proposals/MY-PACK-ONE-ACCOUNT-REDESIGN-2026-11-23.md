# My Pack One: design review

Revised November 23, 2026 after source-code and cross-PR review. This is a proposal, not an implementation.

[Open the interactive design preview](./my-pack-one-review-preview.html). It contains fictional data and cannot change an account. It is a browser-based visual aid, **not** an iOS/Android build or proof that native controls work.

## What I'm recommending

The feature set is useful; the pages need a clearer hierarchy. Keep the light Pack One scorecard design rather than starting over.

- **Stats:** Keep career totals, the current season and recent games close to the top. Show achievements, older runs, Daily finishes, sets played and shared challenges without making everything visible at once.
- **Insights:** Start with a saved pick worth revisiting. Follow with the evidence-backed patterns in your picks and then scores over time. Put detailed comparisons in an optional section.
- **Settings:** A short account overview and one ordered list of destinations. Edit fields and email choices on the relevant detail screens, rather than in the overview.

All three surfaces should share content, labels and data rules. Web and native need their own navigation and input patterns, not a pixel-for-pixel port.

## Insights layout

1. **Picks to review.** Show one saved pick with the selected and trophy cards, the set, original draft-pick position, the originally awarded score and a short explanation. A full **Review pick** action opens the existing read-only saved decision. Other examples are compact rows. The top pick is an example worth inspecting, not a diagnosis of the player.
2. **Your pick patterns.** This is already the live web heading; keep it. Lead with a qualified pattern only when the server supplies qualifying evidence. Put supporting counts and examples under **Why this fits**. Avoid presenting a descriptive pattern as a measured skill or psychological type. If the backend supplies no qualified pattern, don't invent one.
3. **Your scores over time.** Use dated 40-pick groups, show their pick counts and original scores and mark any scoring/card-pool version boundary. Prefer dated score rows or a horizontal group timeline to an unlabeled four-bar mini-chart. Include one visible caveat: "A higher average doesn't necessarily mean you're drafting better. You're seeing different picks each time." Do not place a second skill disclaimer above it.
4. **More breakdowns.** Keep original draft pick, the spread between top supported choices, set/format averages and methodology reachable without taking over the page. Explain that "hard" is a model-gap classification, not a measured player difficulty. Preserve eligibility counts and distinct filtered-versus-recent-across-formats scopes.

Put the format/time controls with the sections they filter. On a narrow phone, the default top-pick view uses compact card thumbnails and names so the first screen is about choosing a saved pick to inspect, not scrolling past two full-height cards. The detailed saved-pack view still shows the full images and prior picks.

The current Insights data and scoring rules stay unchanged. On desktop, give each main Insights card the full content width rather than leaving an unused right column. On Stats, retain the two-column relationship between Current season and Recent games; give the sets card the full row so it never sits beside an empty column. No rescore, new model, changed qualification threshold, or private-player data exposure is proposed.

## Settings layout

Signed-in identity at top: name, email, membership status and **Sign out**. No redundant "SIGNED IN" badge.

Then one list, in this order:

1. **Profile:** name, public profile visibility, favorite set/format and showcase achievement.
2. **Membership:** real Free/Supporter/Elite status and provider-appropriate Apple/Patreon/other management.
3. **Appearance (native only):** card size using **Compact / Standard / Large**, matching [PR #1756](https://github.com/killjoy00/mtg-ev-analyzer/pull/1756). The phone's OS controls light/dark mode. Do **not** add an in-app theme selector. Do not display an empty Appearance destination on web where no corresponding control exists.
4. **Emails & reminders:** separate settings for Daily reminder, Weekly results and Pack One news. No default opt-ins, combined consent shortcuts or sign-in blockers. Each option retains its existing eligibility, suppression, save/error and unsubscribe behavior.
5. **Privacy & results:** **Exclude my name from published results** is a real independent control and must be present. It is distinct from the public profile switch.
6. **Sign-in & security:** current sign-in method and change-password route only when supported, with existing sign-out-everywhere information.
7. **About Pack One:** about/credits and legal links; it must also remain available through Learn as proposed by PR #1756.
8. **Delete account:** separate last row, visually distinct from ordinary settings, with the current verification, permanency and subscription-cancellation warnings.

On desktop, use a single chevron at the right of each destination row, not alternating \"Edit\" and \"View\" text. On iOS, use an inset grouped settings list with full-row targets, familiar chevrons, native switches on detail screens, and a back-navigation title. On Android, use flatter Material-style settings rows without chevrons: show the current value at the right only when useful (for example Free or Standard), use Android-style switches in detail views, and honor the system Back button. Keep card-size settings available to **guests and signed-in players**, as in #1756; account-only destinations should explain when sign-in is required. These are separate native design specifications, not just differences in status bars. The HTML prototype illustrates them, but native simulator/device review is required before implementation is accepted.

## Stats layout

Keep the existing career-metrics card rather than inventing new measures. Proposed high-level order: career totals, **current season**, recent scores and recent games, sets where you've scored best, then achievements and older record sections on demand.

The season section must not disappear from the redesign; show an empty/season-not-active state when necessary. Keep sharing and public-profile paths. Do not duplicate "Recent Games" and "Game history" with equally prominent sections.

## Copy audit checked against the current source

A wording proposal only counts as a replacement if the wording actually exists in the UI. These are the verified candidates:

| Current user-facing string | Location | Proposed action |
| --- | --- | --- |
| "Career Snapshot" | Web: `my-pack-one.mjs:199`; native profile: `mobile/src/components/ProfileOverview.tsx:129` | Consider **Your record** on both surfaces, subject to context. |
| "Recent Performance" | Web: `my-pack-one.mjs:200`; native profile: `mobile/src/components/ProfileOverview.tsx:162` | Consider **Recent scores** on both surfaces. |
| "Environments" (career metric, **not** a selector label) | Web: `my-pack-one.mjs:190` | Consider **Sets and formats** when it fits the metric. |
| "Career snapshot" with "Primary play, up front." | `profile-polish.mjs:29`, via conditional own-profile enhancement | Drop the generic subtitle altogether. Check whether the legacy owner-profile path remains necessary before changing the heading. |
| "Scores by source pick position" | Native: `mobile/src/screens/insights.tsx:428` | **Scores by original draft pick**. |
| "P1P positions are from the source draft, not the question number in this game. Averages need five picks." | Native: `mobile/src/screens/insights.tsx:429` | **These are pick numbers from the original drafts, not the order of questions in Pack One. We show averages once you've made at least five picks.** |
| "Model-support closeness" | Native: `mobile/src/screens/insights.tsx:431` | **How close the top choices were**, retaining the explanation at line 432. |
| "Saved alternative scores" | Read-only review: `my-pack-insights.mjs` and `mobile/src/screens/insights.tsx:238` | Consider **How the other cards scored**. |
| "These are the scores of different picks, not proof of improvement or decline in drafting skill." | Native: `mobile/src/screens/insights.tsx:345` | Match the existing clear web Journey caveat rather than introduce another. |

Already correct; not change requests:

- Web Insights already says **"Your pick patterns"** (`my-pack-insights.mjs:111,137`).
- Web Journey already says **"A higher average doesn’t necessarily mean you’re drafting better. You’re seeing different picks each time."** (`my-pack-insights.mjs:234`). Other existing web disclosures may use different caveats in different contexts; remove redundant presentation, not protections.
- Daily reminder web and native already say **"Get one email reminder a day. If you’ve already finished all three Dailies, we won’t send one."** (`daily-reminder-settings.mjs:17`; `mobile/app/account-reminders.tsx:149`).
- "Review pick" is already the live action in the Insights saved-pick review. Do not claim "Review original pack" is live text.
- The player-facing format choices already say Mixed sets, Latest Set and Powered Cube. The proposed "Set or format" wording is not a repair to a nonexistent "Environment" selector.
- "Your Drafting DNA" is an internal feature name, not a live web heading. "The Independent Thinker," "The Steady Hand" and "Trait still developing" originate from `worker/draft-run-insights-extras.mjs`. Changing those requires a deliberately scoped server/API copy decision, or an explicit client mapping contract and corresponding tests. It is not a front-end text-only swap and is **not included in this design PR**.

The `profile-polish.mjs` wording is reachable only when `ensureStrip` runs on a `.player-profile-page` containing `#profile-home` and the profile load succeeds. The current claimed-account My Pack One view uses `myPackOneMarkup` instead of that legacy profile markup, so this is not confirmed to appear on the modern Stats page. The module is installed from `bootstrap.mjs` and `growth.mjs`; verify actual visibility before editing production copy. This audit is grounded in the code. The owner-provided writing guide is outside the public repository, so external reviewers cannot inspect it there. The relevant editorial principles are stated here: get to the point, use ordinary language, say why something matters, and qualify claims without repetitive boilerplate. No private writing samples are reproduced.

## Related native PR

[PR #1756](https://github.com/killjoy00/mtg-ev-analyzer/pull/1756) is already a draft implementing phone UI polish. It establishes these choices: device-following dark mode without a theme preference, **Compact / Standard / Large** card sizes with a native account option and in-game control, and About discoverability through Learn/Account.

This design proposal defers to those choices. It does **not** ask to change, rebase, merge or ship #1756. When implementing this proposal later, use #1756's then-current merged behavior as the baseline rather than duplicating or overriding it.

## Preview rules and review limits

The design prototype should demonstrate all the visible destinations above, including Privacy & results and the existing card-size option on native. It should show a season section in Stats, use one score display per featured pick, label counts with units, and show dated score groups with version notices. Drop unnecessary subtitles. Desktop cards should not leave blank grid columns. Settings destination rows should use chevrons only on web/iOS and omit them on Android; the Delete account row should not say "View." Native filters and other navigation should resemble their platform rather than browser selects.

Because the prototype is HTML, its iOS/Android views are **conceptual layouts only**. Before implementation, review actual iOS and Android captures on small phones, tablets, larger accessibility text and both system themes; use native navigation, select/switch and card-viewer components. The native apps should not be accepted based solely on an HTML mobile width.

## Acceptance for a later implementation PR

- [ ] Stats retains current season and actual game record; empty/sparse states are clear.
- [ ] Insights prioritizes real saved decisions, shows qualified evidence accurately, and preserves score-version, sample-size and privacy rules.
- [ ] All current account settings are reachable, including results-publication exclusion; consent topics and membership cancellation are unchanged.
- [ ] Web uses browser controls, iOS and Android use their platform-native navigation and controls, with readable touch targets and accessibility checks.
- [ ] Copy changes are verified against exact current files and API fields immediately before implementation, not assumed from this historical audit.
- [ ] Cross-platform tests, account/consent/deletion checks, screen-reader testing and store-device smoke tests are included in the later implementation plan.

This draft contains only this design document and a disconnected prototype. No app code, backend, CI gates, data or deployment changes are authorized by it. Review feedback belongs here; actual implementation should be a separate PR.
