# Launch a new Pack One set

Open one issue per set and record the evidence there. The agent runs the checks. The owner approves releases or communications when required.

1. **Prepare.** Confirm the Arena date and Scryfall identity and release date. Register the set name, review unusual printings and faces, and draft any guide. Import starts when 17Lands publishes both PremierDraft archives. [17Lands datasets](https://www.17lands.com/public_datasets)
2. **Validate in development.** [Corpus Operations](../.github/workflows/corpus-operations.yml) runs Mondays at 07:23 UTC or by dispatch on reviewed main. Record the set, both source URLs and hashes, development run ID, and exact snapshot. Require passing [health gates](../corpus-quality.mjs) and a successful test pick for that snapshot. An empty discovery can also finish green.
3. **Stage in production.** Dispatch Corpus Operations with target `production` and that development `validated_run_id`. Confirm both Candidates match on snapshot, source hashes and model. Revalidate development if the artifact expired or ingestion inputs changed. [Operations and recovery](CORPUS-OPERATIONS.md)
4. **Prepare the puzzles.** Build [trophy decks and coverage](../corpus/trophy-decks/README.md) first, then [card strength](../corpus/card-strength/README.md) from the same game archive. Release the inputs and [score this set](../.github/workflows/score-puzzle-selection.yml) in development and production at the same commit. Verify deck coverage, strength hash, eligible picks and [served titles, art and faces](CARD-IMAGE-MAINTENANCE.md). The scoring workflow emits an **advisory selection coverage report** for the new set. Record percentages and expected fallbacks; missing optional selection features are a **quality warning**, not a new activation gate. Existing corpus health, identity and serving safety checks still apply.
5. **Activate.** Require passing health under seven days old. Activate development, wait for serving readiness and run the [exact-snapshot smoke](../.github/workflows/corpus-activation-smoke.yml). Test Custom Practice and reroll. Check which rules and fallbacks selected Latest and Mixed picks against the [Daily policy](LATEST-DAILY-SELECTION.md). Repeat in production after both current Pacific-date Dailies are pinned and before the next midnight. Once the newest set works on its own in production Custom Practice, publish “Now includes [latest set name].” under **Practice → Choose your sets** and verify the [live page](https://packone.pro/practice/) on phone and desktop.
6. **Verify the first public day.** For the newest regular set, confirm eight Latest picks, at least two Mixed picks and a season starting on that Latest date. The existing scheduled activation smoke also [reports the outgoing season](season-rating.md#automatic-rollover-report) with all three board counts, automatically and without publishing player names. Record its dates and counts in the issue. A separate named [private snapshot](season-rating.md#optional-private-standings-capture) is optional and does not block launch. Check the actual selected Latest/Mixed rules (including any fallback), a public result/share and a prior pinned game. Publish any [approved guide](SET-GUIDES.md) or announcement, and record the first-day monitoring handoff before closing.

## Read-only owner launch check

On **Admin → Sets & Data**, the **New-set launch check** defaults to the
most recently registered draft set in `data/set-display-names.json` (Star Trek,
`trk`, for the upcoming launch). You can choose another set. The panel reads
source/import state, the current quality check, Live serving readiness and all
three existing fixed Daily schedules for the current **Pacific calendar date**.

- **Source data** is only marked imported if corpus records confirm it. A
  discovered archive alone is not a passing production import.
- **Quality** comes from the existing verified corpus health report; this
  panel cannot waive or rerun any promotion gate.
- **Live serving** requires Live status, a nonempty current serving inventory
  and verified current serving readiness.
- **Latest Set Daily** must have eight resolvable pinned decisions from the
  target set; **Regular Daily** must have eight resolvable decisions, at least
  two from that set. **Powered Cube Daily** must have eight resolvable pinned
  decisions of its own and does not need target-set cards.

A set activated after today's Pacific 00:07 Daily generation will correctly
say **Other set pinned** until the next schedule. Nothing attempts to rewrite
today's games or prompt an owner to review candidate puzzles. This is
operational status, **not** proof that the outside 17Lands archive, artwork,
store listing, Reddit post or announcement is publicly available. The existing
workflow and release evidence in this issue remain authoritative.

If quality or identity checks fail, hold the launch. Changed archives get a new snapshot. If activation succeeded but serving readiness failed, retry readiness. Use Live → Paused to stop new starts while preserving pinned games.
