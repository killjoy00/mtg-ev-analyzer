# Insights evolution — Drafting DNA, Best Calls & Biggest Misses, Drafting Journey

**Decision:** Owner approved adding **Your Drafting Journey** and **Your Best Calls & Biggest Misses** alongside the already approved **Drafting DNA** (one primary archetype + two secondary traits), October 11, 2026.

**Status:** Initial backend/web/native source implementation merged via #1173; #1179 tracks code-quality follow-ups and separate signed-in acceptance. No native build is implied by source changes.

**Implementation tracking:** [Drafting DNA #1167](https://github.com/killjoy00/mtg-ev-analyzer/issues/1167), [Drafting Journey #1170](https://github.com/killjoy00/mtg-ev-analyzer/issues/1170), [Best Calls & Biggest Misses #1171](https://github.com/killjoy00/mtg-ev-analyzer/issues/1171).
**Source of existing Insights rules:** [MY-PACK-ONE-INSIGHTS.md](MY-PACK-ONE-INSIGHTS.md); DNA evidence contract: [DRAFTING-DNA.md](DRAFTING-DNA.md).

## Product objective

Make Insights **feel like a personal drafting scouting report** rather than a collection of generic averages. Players should immediately learn what distinguishes their recorded decisions, see **real cards that demonstrate it**, and understand how their decisions have evolved. Every factual statement must be traceable to their originally awarded results and verified saved pack/observation evidence.

### Approved one-page hierarchy

Inside the existing **My Pack One → Insights** authenticated local tab, on web and native:

1. **Your Drafting DNA** (hero). A visually distinct primary archetype and exactly two secondary **positions**, populated only with independently supported traits; placeholders say "Trait still developing". An expandable **Why this fits** view shows count and evidence. This identity uses *all bounded eligible history*, explicitly labeled, and does not silently change when chart filters change.
2. **Your Best Calls & Biggest Misses** (visual decisions). A pair of switchable, curated sets of real saved picks. Lead with original *card art*, your selection and the original trophy selection. Each has **Review original pack**: inspect the original saved pack and original post-pick explanation without replaying/rescoring the pick.
3. **Your Drafting Journey** (story and timeline). A progressive record of originally awarded pick scores over time, with qualified comparison windows, real milestones and readable intervals. Its filters are independent of the stable Drafting DNA identity.
4. **Explore the data** (supporting evidence). Keep pick-by-pick source positions, difficulty context, format breakdowns, methodology and rules-based observations. Absorb the existing standalone "Progress over time" card into Journey instead of duplicating the same 40/40 comparison in two places.

No additional global bottom tab, no extra My Pack One sibling tab and no reorganization of the existing Stats or Account settings sections.

### Responsive/mobile design

- **Wide web:** DNA full-width hero, then side-by-side pick cards inside the selected Best/Misses group, then full-width Journey timeline with accessible milestones; supporting evidence below.
- **390px / 320px:** DNA hero with two secondary cards stacked/wrapped; two touch-friendly Best/Misses segmented options; swipeable or vertical pick cards with card-name alternatives, and Journey timeline whose exact data is accessible via a chronological text list.
- **A11y:** headings, labelled card images, score text, keyboard-selectable cards and disclosures, focus return from detail, reduced-motion support and no color-only information. Use current Pack One fonts/colors and avoid an unrelated personality-quiz design.

These displays must work with empty history, guest users, signed-in no-data accounts, session expiry, account switch, slow network and incomplete archived evidence.

## Your Best Calls & Biggest Misses

### What qualifies as an interesting pick

The set of *eligible decisions* is the original first-encounter policy: the first locked answer for a unique puzzle in the player's bounded non-QA eight-pick v3/v4 histories, including incomplete runs. Historical scoring results are immutable. Candidate selection must use the full eligible list **before** applying any display environment/date filters, so replay/duplicates cannot distort selection.

**Best Calls** uses a deliberately varied deterministic selection of:
- **Strong alternatives:** non-trophy selections with the highest **original awarded scores**; call these strong *model-supported alternatives*, not proven superior picks.
- **Tough trophy matches:** decisions labeled hard by the verified support-ratio-v1 difficulty band where the player matched the source trophy drafter (awarded 100); retain the difficulty caveat.
- **Other high-scoring examples:** only if the above don't provide enough unique, well-supported cases. Never fill the set with six interchangeable 100-point easy trophy matches.

**Biggest Misses** consists of the lowest originally awarded first-time **non-trophy** selections where the record and model-support comparison are complete. This is a scored-game **review opportunity**, not evidence that the player's strategic choice was objectively wrong. Use the on-page title the owner selected, but contextual copy such as **"Picks worth another look"** and avoid "bad drafter", "blunder", "you should have", or invented coaching.

Cards should be **diverse and deterministic**: show a mix of set, source P1P position, answer date and reason where available; never include the same underlying decision in both Best and Misses, repeat the same puzzle or choose picks based on private unrelated users. Selection rules and tie breaks must be versioned and tested.

### Card preview and locked-pack inspection

Each visible card provides:
- Actual saved **card image** for the player's selected card (with card-name fallback), plus original trophy pick image or an accessible compact comparison when available.
- Set/environment and true *source* P1P position, locked decision date, original awarded score (/100) and factual status ("Matched trophy pick" / "Strong scored alternative" / "Low scored alternative").
- **Review original pack** opens a signed-in **read-only** detail showing the saved original pack with all card images, saved prior picks, selected card, original trophy pick, historical score, available verified source-drafter record and the existing "Why this score?" explanations/relative model support **from the locked answer**, as preserved at the original scoring version.
- Replay uses the historical saved candidates/prior picks, **not** a fresh corpus puzzle or today's scoring. If individual source evidence/image metadata is missing or a historic puzzle cannot be reconstructed safely, show a clear unavailable/reduced-detail state rather than synthesizing cards or guessing trophy losses.
- This is **retrospective review**, not a new Draft Run: never unlock a different answer, alter past selections, write another score or observation, spend a reroll or award leaderboard credit. It should not create a Daily repeat counted toward first encounters.

**Boundary with earlier roadmap:** [#1125](https://github.com/killjoy00/mtg-ev-analyzer/issues/1125) explored *playable* "My Missed Picks" as a possible learning mode. This approved scope is **read-only highlight/review**. Any re-answer-and-compare product requires separate approval, isolation from first-time stats and new design.

### Privacy/performance contract

Existing `draft_run_sessions.answers` retains `score`, `selectedId`, `historicalId`, `ranking`, `trophyDrafter` when sourced, and a `puzzle` snapshot with actual `candidates`, `prior_picks` and source pick number. The current private Insights aggregate deliberately returns **no individual decision content**, so images/replay must **not** be invented client-side from those averages.

Preferred design:
1. Add a bounded, owner-scoped **highlight shortlist** (e.g., 3–6 per category, max 10 per page, non-enumerable owner-scoped opaque selection tokens; never public/global guessable session IDs). Return only minimal metadata and approved image URLs for the small shortlist. Gate every category and set by prior first-encounter counting.
2. Add an **on-demand private detail** lookup for one chosen, already locked historical decision. Re-verify current signed-in account ownership of the underlying source session *and* that the selection is eligible and part of the approved snapshot before returning a bounded saved pack/answer. Use existing private Growth account/auth architecture and protected gateway allowlist additions if a new route is required.
3. Support web and native paths without changing existing API fields; old clients ignore the optional highlights field. For images, use verified saved asset URLs and safe link/image policies; do not send raw 1,000-session data, source telemetry or a provider's private player identity.

If the chosen implementation can safely use one bounded owner-verified detail endpoint, document the alternative; **never** return arbitrary historic answers by publicly queryable puzzle ID.

## Your Drafting Journey

### Meaningful trajectory instead of a noisy average

Visualize *recorded first-time decision scores by their actual locked-answer dates*. The default overview should show:

- An accessible chronological plot of non-overlapping **40-decision windows** (or clearly marked 40-pick rolling windows if doing so is more readable), each with start/end dates, count, average and environment/scoring cohort. Incomplete cohorts are marked rather than presented as complete.
- Clear **Earlier vs Recent** factual 40/40 comparison, reusing the current existing `progress` rules and exposing both date ranges and original awarded means. A descriptive numerical delta may be visible with 80 eligible decisions. Only use qualitative "higher/lower" prose when both sides contain 40 comparable decisions **and** the 10-point effect threshold is met; never claim proven causal skill improvement.
- **Actual milestones** under the timeline, where supported: first complete 40-decision span; best supported **comparable 40-pick stretch** inside the currently available bounded history (label which period and environment); first time an 80-decision comparison was possible; verified changes in format/difficulty coverage. A Pacific month can appear only when it has at least 10 eligible decisions.
- Period/environment controls (all available, last 90 days, last 365 days; Mixed, Latest Set, Powered Cube) and optional pick-position/difficulty drilldown. Recalculate timeline groups after the global first-encounter deduplication, consistent with existing Insights. **Never** silently use another environment's scores as a baseline.
- Gaps and method version notes for history caps, missing observations, incompatible source-pick ranges, score/corpus/selection revisions or retired source records. Do not compare differently scored cohorts as though they were one stable skill measurement.

A useful narrative might say (synthetic layout example only): "Your last two completed 40-pick windows averaged [X] and [Y]. The [date]–[date] stretch had your highest recorded average among the qualifying windows shown." Do not show an all-time best claim when only the newest 1,000 sessions are scanned.

### Data implementation

Re-use the existing private `worker/draft-run-insights.mjs` bounded owner-owned source, 1,000 recent eight-pick v3/v4 non-QA sessions / maximum 8,000 candidate decisions, normalized by earliest eligible answer to each puzzle *before* display filtering. Existing response includes per-month aggregates and latest two 40-pick windows; a **new additive grouped journey object** is needed for a longer timeline. Compute server-side bounded, versioned window aggregates and milestone eligibility; do **not** ship unbounded individual score/time points to browsers solely for client analytics.

The DNA identity should **not** change as the viewer explores Journey filters. Snapshot periods and versions should be explicit rather than blending all scoring/corpus releases into a single unqualified "you are improving" claim.

## Shared engineering and validation plan

1. **Evidence review:** document exactly which historic answer fields, images, saved rankings, timing and score versions are available; compare compatibility for Journey and which past decisions can render the full read-only review. Do not publish private player records, screenshots or customer-level metrics in the public repository.
2. **Backend aggregation:** add `drafting_dna` (#1167) and `journey` as additive private Insights fields, plus bounded highlighted-pick shortlist and on-demand owner-only locked-answer detail. Preserve guest rejection and historical game/API contracts.
3. **Web composition:** build cohesive DNA → Best/Misses → Journey → supporting charts, with complete states, safe image rendering, keyboard/ARIA and source notes. Real card art must come from preserved source data, not placeholder graphics.
4. **Native composition:** implement same feature set behind existing My Pack One local Insights route and verify iOS/Android layouts, account-switch clearing, back navigation and missing image fallbacks.
5. **Tests and release gates:** deterministic synthetic data tests (duplicates, first picks, incomplete runs, mixed versions, same-card trophy matches, lower score alternatives, missing assets, 0/80/large histories), authorization isolation/expired account, query limits, browser screenshot at 320/390/768/1440, native typecheck/tests. Follow protected exact-SHA development → production function and gateway release, plus live acceptance, separately from any native signed build/track change.

### Explicit exclusions

No fabricated Magic card images or personality labels; no source-drafter reasoning inferred as fact; no scoring recalculation or historic data rewrite; no unbounded per-pick data exfiltration; no public sharing of private highlights/DNA; no unsolicited reminder, social posting or app-store track change; no automatic promotion of production backend/gateway from a docs-only spec; no changes to unrelated [#1151](https://github.com/killjoy00/mtg-ev-analyzer/issues/1151).

## Acceptance summary

- A qualified returning account can see **one primary DNA label + up to two evidence-supported secondary labels**, actual saved best/missed cards, and a meaningful journey with sample/date context.
- A player with many decisions but no ten-point gap still sees their **valid factual history**, not a false "insufficient comparable decisions" message.
- Opening a real highlighted decision shows the **original pack, saved prior picks, player's choice and trophy choice**, with the frozen-score explanation; never a newly graded simulator.
- Zero-history and partially populated accounts see truthful placeholders; supported fields never masquerade as complete when missing.
- No private response is accessible to the wrong account or guest. Previous-account data disappears immediately on logout/switch. Web/native parity tests and existing scoring/nav regressions pass before any release.

## Code follow-up: Journey v2 and highlights v2 (#1179)

`drafting-journey-v2` preserves the original `from`/`to` UTC date
strings, and adds ISO `from_at`/`to_at` to windows and milestones
(with the existing milestone `date` unchanged). Web and native display
the viewer's local calendar dates when the ISO fields exist, and
fall back to legacy strings from older functions. Every milestone
represents only measured first-encounter history, without an
unsubstantiated improvement claim. The new difficulty-coverage
milestone is the **first complete, version-consistent 40-decision
window with at least 10 known hard-band decisions**. The count comes
from its own window, not from global hard pick totals. Journey is
already restricted to one selected environment by
`aggregateDraftRunInsights`; a milestone for *format coverage within
a Journey* is therefore inapplicable. Version boundaries and irregular
time gaps remain visible rather than interpolated.

`decision-highlights-v2` supports optional pages 1 and 2, **at
most six Best Calls and six Biggest Misses per page**. It holds the
per-request saved-pack-preview lookup to **at most 12 unique sessions**,
with a shared deduplication set across lists and pages. Pagination
is deterministic for the selected environment/time period and its
bounded first-encounter rows. Out-of-range pages fail with HTTP 400,
rather than extending the 1,000-session / 8,000-candidate budget.
New page and has-more metadata is additive; native binaries that
ignore it still see the original first six cards.

Saved images originate in `scripts/fetch_card_metadata.py` through
Scryfall's `image_uris.normal` fields, propagated through the image
refresh scripts and saved puzzle candidate snapshots. The shared
`card-image-policy.mjs` allows **HTTPS on exactly
`cards.scryfall.io`**, without credentials or custom ports. The
server, web viewer and native image component apply this same policy;
missing, malformed, downgraded or foreign-host URLs show the actual
saved card name, not invented art.

Detail eligibility uses an owner-scoped **puzzle-targeted** read
inside the identical 1,000-session CTE, rather than transferring and
normalizing the full Insights rowset on every click. The documented
eight-answer-per-eight-pick-session invariant and observation
uniqueness make the full query's 8,000 row cap non-truncating.
The eligibility query still checks QA name/session filters,
selection version, score/pick/match validity and first locked
answer order including session-ID tie-break, before the existing
separate owner-scoped saved-answer retrieval. These details never
introduce a playable retry.

The native screen imports that same policy from the repository root.
`mobile/metro.config.js` explicitly watches the parent directory so Expo
Metro can resolve the canonical module without duplicating the allowlist or
changing the native projects. A dedicated regression assertion covers the
resolver configuration; no native build or store operation is part of this
code change.
