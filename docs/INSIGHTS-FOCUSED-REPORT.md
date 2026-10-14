# Player-focused Insights in My Pack One

**Status:** Implementation candidate on `feat/insights-player-review-20261014`. This is a product hierarchy update to the earlier DNA-first report; it does not change stored scores, game difficulty, puzzle inclusion, or DNA qualification. Real-account and physical-device acceptance are separate release decisions.

## What players see

The Insights tab stays inside **My Pack One** on web and native, in this order:

1. **Your picks** heading, **Format** and time filters. **Mixed sets** is a separate format, *not* the union of Latest Set, Powered Cube and other modes. The existing filter defaults and newest-environment auto-selection remain.
2. **Picks to review**, the main feature. **Picks to revisit** opens by default when non-trophy, lower-scoring examples qualify; otherwise **High-scoring picks** opens. If neither category has an example, a neutral empty state appears. The first item is a featured comparison, followed by up to two supporting cards. Each shows both named cards (art when approved/available), the original score, a readable set name, the *source draft* P1P position, date and one factual explanation. The review action is **Review pick**.
3. **Your scores over time**, using original 40-pick history groups. A compatible last-40-versus-previous-40 comparison is descriptive, not proof of improved skill. Partial groups display the actual count. Version changes remain visible, and window/milestone/month details are optional.
4. **Your pick patterns**, smaller and sourced from **Across formats · All available history**, independent of Format and time filters. Show only genuinely qualified traits. No developing placeholders or promises that a fixed number of extra picks guarantees a trait. Conditional creature/rarity counts and qualification evidence are available only on request.
5. Collapsed **More stats**: scores by source pick position, model-support closeness, format averages and **How this works**.

This page answers "which picks should I review and what did the trophy drafter pick?" before discussing analytical traits.

## What the player can inspect

The owner-only GET decision endpoint returns the original chosen/trophy cards, **Trophy drafter’s earlier picks**, the full pack and saved alternative scores. The earlier-pick pool is the source trophy drafter's pool, not the player's own drafted deck. This review is read-only: no gameplay/replay, rescore, progress changes or writes. The detail also retains verified trophy draft metadata, when present.

Review explanations do not make strategy claims about signals, curve, card roles, synergies or player mistakes. When the saved model ranking identifies a more supported card, the response includes that card's identity and whether it is **also** the trophy pick. Missing rankings, card metadata, approved art or older API fields yield simpler factual text; they never trigger invented analysis.

**100 means you matched the trophy pick. Other picks earn up to 95 based on the model.** This is the existing model-support partial-credit scale, not an objective verdict on a Magic choice. A **hard** label measures how close the two leading *model-support values* were; it is not a human difficulty measure and does not justify a headline about player weakness.

## Defensible comparisons

Headline comparisons are limited to recent-versus-previous scores in one compatible scoring/selection/corpus revision, or to **source P1P positions** within an individual compatible revision. The existing requirements of 40 picks per group and a gap of at least 10 points still apply. Different card pools and raw difficulty groups may be summarized in **More stats**, but are not promoted into a player diagnosis, skill claim or training recommendation.

A displayed finding requires a saved example from an actual compared group. An example illustrates membership; it cannot establish why the score gap occurred. If no defensible comparison has an example, the page simply introduces review picks.

## History and compatibility boundaries

Only the first included answer to each puzzle counts. The backend uses locked first-encounter observations from up to **1,000 recent, owner-scoped, eligible eight-pick sessions**, excluding QA, with at most two pages of bounded highlights. The exact counting and version rules remain behind optional details. DNA uses this bounded all-format history even when the visible review and score history are filtered. Conditional type/rarity denominators count only packs where both categories had competitive saved support, sufficient card data, and a compatible version cohort; they are not overall selection rates or proof of preference.

The API keeps the existing `highlights.best`, `highlights.misses`, `journey`, `drafting_dna` and `card_choices` fields, first-eligible decision route and owner protections. Legacy native clients can ignore added evidence fields; updated web/native clients render a simple fallback when an older server omits a section. Web clears private UI on owner/session/filter refresh; native invalidates stale requests on identity transitions. All art continues through the audited Scryfall HTTPS allowlist.

## Verification and release boundary

Use **synthetic accounts** for public Playwright and native screenshot fixtures. Cover empty/no highlights, one-category-only highlights, sparse/no qualified traits, missing art/set metadata, incompatible score versions, older responses, filter and account races, pagination, modal close/focus return, desktop, 390px and 320px widths, and native enlarged text.

**Fixture verification** is not signed-in real-account acceptance. Emulator/simulator capture is not physical-device acceptance. Report actual passing/failing commands and available CI artifacts in the PR; never present screenshots from mock data as real player history.

Until the relevant CI and acceptance results are known, opening the PR is not proof of a safe release. Preserve the existing guarded web/backend deploy and signed native release process.
