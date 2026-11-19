# Focused Insights report (review candidate)

**Status:** implementation on `feat/insights-focused-report-20261012`. This document describes the code contract, not a completed deployment or production acceptance. Existing Drafting DNA qualifications and Journey rules are unchanged; see [DRAFTING-DNA.md](DRAFTING-DNA.md) and [INSIGHTS-REDESIGN.md](INSIGHTS-REDESIGN.md).

## Product hierarchy

Within the existing authenticated My Pack One → Insights tab on web and native:

1. **Your Drafting DNA**: primary archetype (if qualified) and two small secondary positions, followed by optional factual card-choice context. The hero uses **all available first-encounter history**; changing the report's environment or time period does not change the DNA's source.
2. **Decision report**: environment and period selectors, one qualified leading finding or an explicitly neutral introduction, Best Calls / Biggest Misses, **one featured card comparison plus two compact supporting rows** by default, and optional more rows.
3. **Your Drafting Journey**: the existing bounded 40-decision chronology and factual recent/previous comparison, with milestones, timestamp detail, and Pacific calendar months behind a disclosure.
4. **Explore your data**: existing pick-by-pick, difficulty, formats, secondary observations and methodology; collapsed until requested.

Web opens the original saved pack in a native HTML dialog with focus return. The native app uses a read-only modal. Both use the existing account-scoped first-eligible-decision detail endpoint and never score, replay, replace, or write a historic pick. The report does not create a global navigation destination.

The overview is intentionally result-first: the identity is the main element, two secondary traits are short disclosure rows, and each qualified creature/rarity observation is one line (`X of N picks`). Calculations, competitive-option counters, underlying saved examples and trait thresholds remain behind optional disclosure. In native clients receiving an older API response without `highlights` or `journey`, the first observation appears independently and saved `progress`/`months` still render. A Journey with different original scoring/source cohorts displays a visible non-comparability warning and a boundary marker; a single incomplete 40-pick window never implies that scoring versions changed.

## Private API additions

`worker/draft-run-insights.mjs` continues to bound its source to up to 1,000 eligible recent eight-pick non-QA sessions, joined to locked original answer observations; the first answer to each distinct puzzle wins. Its response adds:

- `card_choices` (`choice-context-v1`), an **all-environment, all-period** card-choice summary;
- `leading_finding`, the existing strongest qualified written comparison or `null`;
- `default_environment`, the environment of the **most recent eligible** locked decision;
- additive `reason_version`, `reason_code`, `reason_text`, and bounded `reason_evidence` on each highlight (`decision-highlights-v3`), plus saved selected/trophy names as image fallbacks.

The base field types, controls, originally awarded scores, eligibility, Journey, stable DNA, private ownership rules, and two-page highlight cap remain unchanged. Older mobile clients can ignore the new optional fields; updated clients render fallback copy if older servers omit them. No public profile or aggregate API gains these fields.

### Real card-choice context (choice-context-v1)

These **descriptive** breakdowns are derived only from the original saved `puzzle.candidates` card metadata (`type_line`, `rarity`) and saved `ranking` model-support values; no fresh corpus, card metadata service, peer data, or post-hoc scoring is used.

- **Card type:** creature vs noncreature, classified from the saved type line.
- **Rarity:** rare/mythic vs common/uncommon, from saved original card rarity.
- An opportunity qualifies for a particular breakdown only when the saved pack has at least one **competitive** candidate from **both** categories and the selected card has verifiable matching saved metadata.
- For this provisional reporting rule, competitive means **at least 50% of the highest saved model support within that same pack**. This ratio measures *relative recorded model support*, **not** the chance that a player or trophy drafter would choose that card.
- Rows missing trustworthy card types, rarity, positive leader support or complete matching saved rankings are skipped for that breakdown. Model/selection/corpus version combinations are never pooled: choose the largest compatible cohort (deterministic tie breaker) for each breakdown.
- Only cohorts with **at least 20 qualifying opportunities** publish a sentence such as “You chose a creature in X of N decisions” plus up to two original saved-decision examples. Smaller or fragmented cohorts remain **developing** rather than implying a preference.
- The `availability` counters refer to *competitive card options per category*, not percentages of packs in which the category occurred; because both categories are required for a qualifying opportunity, the sample is **conditional**, not an all-picks choice rate.

The thresholds are provisional UX evidence gates. They are **not validated player skill ranks, psychological archetypes, preferences, or causal explanations**. They do not change Drafting DNA qualification.

### Highlights and reasons

`decision-highlights-v3` stays deterministic and first-encounter-only, with unique decisions across Best Calls/Biggest Misses and both capped pages. Strong-scored alternatives and hard-puzzle trophy matches **compete in one pool** for featured and supporting positions. Ranking first favors actual groups from the qualified leading comparison (specific difficulty bands or source pick positions, the exact previous/recent 40, or compared formats), then weighs recency against set, reason, and source-position variety. When available, the first three visible highlights come from the compared groups. Recency decays with days since the newest eligible saved decision, so a useful recent miss need not sit behind an extreme miss from years earlier. Labels describe historical model-scored outcomes, not objectively right/wrong gameplay.

The server emits one reproducible factual reason code per highlight, such as `hard-trophy-match`, `strong-scored-alternative`, `saved-support-gap`, or `low-scored-alternative`. A support-gap reason requires a valid saved chosen/leader support comparison; otherwise it falls back to the original awarded score. No invented card win rates or invalid sample-size claims are made.

`leading_finding.compared_groups` exposes only labels and which group's recorded average is higher/lower. Internal puzzle membership for a recent/previous 40 comparison stays server-side. A preview's optional `finding_context` identifies which compared group that saved decision belongs to; a single saved card is **an illustration, not statistical proof** of the finding.

## Privacy and failure behavior

All source reads remain owner-scoped and bounded. Highlight previews still return only small saved card previews; detailed candidate cards and rankings are read only on explicit owner-authorized review. User identifiers and raw answers are not included in documentation, tests, public profiles, or logs. Web clears previously displayed private DNA before refetch, including account/session failures; native invalidates stale requests on account transitions. Card art uses the existing audited HTTPS Scryfall allowlist, with accessible name fallbacks.

## Validation and acceptance

Synthetic tests cover competitive-options logic, unknown metadata, incomplete rankings, mixed historical cohorts, reason consistency, duplicate avoidance and saved-image restrictions. Native tests cover collapsed breakdowns, historical detail access, pagination, owner change and signed-out states. Pull-request CI must still establish the final JavaScript, native lint/typecheck, browser and backend gate results.

For acceptance, review at desktop, 390px and 320px widths; check focus trapping/return, the tab switch, two-page “See more,” disclosure semantics and the read-only saved-pack exit; verify accounts with 0/7/8 eligible decisions, 19/20 competitive opportunities, long histories, mixed source versions, missing archived metadata and a session switch. **Signed-in production-data acceptance and physical-device testing remain separate release gates.**

The synthetic web browser fixture now includes at least five Best Calls, of which the **first three are visible**: one featured hard-rated example and two compact cards, all marked with their compared group. It captures `artifacts/ui-profile-insights-populated-390.png` and `artifacts/ui-profile-insights-populated-desktop.png`; these are non-production screenshots from the browser CI artifact, not verified live account images. Native screenshot acceptance uses the isolated preview-only `member-insights`,
`member-insights-sparse`, and `member-insights-versions` scenarios. Android
acceptance exercises a populated DNA overview, both decision categories, the
read-only original-pack modal and hardware-back dismissal, Journey access, a
visible non-comparability notice, and narrow 320dp/large-text sparse evidence.
iOS Simulator captures signed-in populated, sparse and version-boundary states
at the regular text size and the populated state at the enlarged accessibility
text size. A fixture-only on-layout marker guards captures against loading or
blank screens. These are **simulator/emulator tests** using synthetic saved
decisions, not physical-device or real-owner acceptance. The existing preview
artifact and release boundary remain unchanged.

## Release boundary

Open a PR against `main` for review. Do **not** merge, deploy backend functions, publish web assets, submit a mobile build or alter production accounts/records as part of this implementation.
