# Set refreshers

Reviewed guide content and dated 17Lands snapshots live in `sets/guides/data/`. `set-guides.mjs` renders both the in-run dialog and standalone pages. The live archive only links sets included in `GUIDE_IDS`; future catalog entries do not automatically receive an empty guide.

To publish or edit a guide:

1. Check its archetypes and format notes against the linked sources, paraphrase concisely, and update `reviewedAt`.
2. If including results, preserve the source, retrieval date, event format, user group, splash treatment, and raw wins/games. Current snapshots use Premier Draft, all users, all time, and no splashes. Three-color clan sets compare three-color decks; others compare two-color decks. The baseline sums all ten combinations in the same sample. These are color results, not independently identified archetypes. Rates below 500 games are suppressed.
3. Add the set to `GUIDE_IDS` if needed, then run `node scripts/build-set-guides.mjs`. Commit the JSON, generated page, and sitemap together.
4. Run `node --test tests/set-guides.test.mjs`. The existing set-archive and Draft Run browser suites cover links, tabs, hover, dialog focus, retry, preserved decisions, and rerolls.

Snapshots are checked in, not fetched from 17Lands during gameplay. The source endpoint is `https://www.17lands.com/color_ratings/data` with `expansion`, `event_type=PremierDraft`, `combine_splash=false`, and `time_period=ALL_TIME`. Review updates before publication; Cube results stay omitted because its card pool changes between events.
