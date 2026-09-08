# Pack 1

Pack 1 is a Limited draft game built from real historical 17Lands Premier Draft decisions. Play the ranked Daily Challenge or unlimited seeded games, get a score out of 100 from an offline strong-player consensus model, then send the exact same pack to a friend.

Live site: `https://magic.planitnow.us`

## Product rules

- Historical replay study, **not** a counterfactual draft simulator.
- High 17Lands win rate is the primary definition of player strength.
- Strong-player consensus is the grading signal; it is not presented as objective truth.
- Historical drafter picks are shown separately from consensus.
- No model/LLM API is used for runtime scoring.
- Raw 17Lands archives are never committed or shipped to the browser.
- Daily is ranked; ordinary Top 3 and Full Pack games are unlimited.
- Accounts are optional. Guest-first play remains the default.

## Game modes

### Daily Challenge

One deterministic replay per set/mode/day, with the game day resetting at midnight Eastern. The first attempt is ranked and submitted to the global leaderboard. Consecutive days cannot select the same replay when a set has multiple replays.

### Top 3

Rank the three cards you would most want to start a draft with. The result compares membership and ordering against the model's top three. Ordinary games receive deterministic seed URLs so friends can play the exact same opening pack.

### Full Pack

Play every decision in Pack 1 of a historical draft seat. Your hypothetical selections do not alter the later historical packs/pool. The final score summarizes the per-pick model-support scores.

## Production data

The production catalog is generated from eligible 17Lands Premier Draft public datasets. Each imported set has 300 target historical replays, a manifest, compact replay shards, and a separate counterfactual path model under `data/<set>/`. The browser loads only the shard required for the selected replay.

The catalog-driven importer automatically works backward through missing public sets in small validated batches, so the set list is no longer maintained by hand. `data/catalog.json` is the source of truth for what is currently playable.

The consensus model is `strong-player-pool-context-v2`: hierarchical strong-player pick tendencies plus shrinkage-adjusted candidate/pool co-pick lift. Replays are scored out-of-fold by draft ID. Model probabilities are comparative choice support, not calibrated win probabilities.

## Architecture

### Static game frontend

GitHub Pages serves the application and compact replay data:

- `app.js` / `scoring.mjs`: core game and grading UI.
- `product.mjs` / `flow-fixes.mjs`: seeded-game and dedicated-result flows.
- `social.mjs`: challenge sharing, community picks, result cards.
- `growth.mjs` / `retention.mjs`: analytics, My Stats, optional account surfaces, local/remote result sync.
- `data/catalog.json`: production set catalog.
- `data/<set>/manifest.json` + `shards/`: precomputed replay data.

### Neon backend

Pack 1 uses a dedicated Neon project/database.

`pack1api` remains the isolated authority for ranked Daily scoring, leaderboards, anonymous player identity, community distributions, and stored share challenges.

`pack1growth` is a separate Neon Function for non-ranking product services:

- anonymous product analytics;
- ordinary game-result history;
- My Stats sync;
- optional account-to-player claiming;
- account-session validation/sign-out; and
- cross-device Daily streak dates.

Keeping ranking and growth endpoints separate means growth changes cannot silently alter Daily scoring semantics.

### Optional accounts

Neon Auth (managed Better Auth) supplies email/password accounts. The first signed-in device claims the existing anonymous Pack 1 player ID. Later devices can sign in and receive a Pack 1 token for that same player, preserving leaderboard identity and synced stats.

The game never requires login. Auth session tokens are stored first-party by Pack 1 and validated server-side against Neon Auth; the flow does not depend on third-party cookies.

### Analytics

`analytics_events` stores an event name, sanitized gameplay properties, optional Pack 1 player ID, and timestamp. Email/password data is not written to product analytics.

The internal Neon view `analytics_funnel_daily` summarizes:

`page_view -> game_start -> game_reveal -> share_click -> share_completed -> challenge_open -> challenge_start -> challenge_complete`

This is intended to answer the core viral-loop question: how often does a completed result become a real share, then an opened, started, and completed friend challenge? `share_completed` records `native`, `native_file`, `copy_fallback`, or `copy_link`; seeded events carry the game seed so the funnel can be tied to the exact pack. Run `analytics/viral_funnel.sql` for the daily conversion view and viral completion rate.

## My Stats

My Stats is local-first and works without an account. It tracks:

- games played;
- average and best score;
- Daily streak;
- challenge win/loss/tie record;
- performance by set;
- performance by mode; and
- recent games.

When an account is claimed, results are synced to the linked Pack 1 player identity and can be restored on another device.

## Tests

```bash
npm test
```

The unit suite covers scoring, Daily selection, cohort/model logic, sharding, dataset validation, importer discovery, and JavaScript syntax.

`.github/workflows/e2e.yml` runs a mobile-width Chromium product matrix covering production sets, deterministic seeded friend challenges, hidden-before-reveal friend comparison, Daily Top 3, a complete Full Pack run, dedicated result screens, My Stats, and optional Account UI.

## Importing sets

`.github/workflows/build-more-sets.yml` is the automatic backlog importer. On a normal run it:

1. makes one Scryfall set-catalog request and considers released sets newest-first;
2. probes the official 17Lands public S3 draft archive for missing Premier Draft datasets;
3. imports up to three available missing sets;
4. derives each 17Lands source date from the archive metadata;
5. stages each set outside `data/`, builds replay shards plus the path model, and validates both;
6. publishes only fully validated set directories/catalog changes; and
7. makes one serialized Git commit with push/rebase retries.

The workflow runs daily, and also runs when importer/model code lands on `main`, so a historical backlog fills itself without hand-editing YAML. A failed set does not contaminate the catalog or discard other successful sets from the same batch. Raw 17Lands CSV archives are temporary and never committed.

Manual discovery without building:

```bash
python scripts/import_sets.py --dry-run --limit 3
```

Manual import of particular public sets:

```bash
python scripts/import_sets.py --sets TLA,EOE
```

The older `.github/workflows/build-replay-data.yml` remains available as a one-set manual fallback while the automatic importer is established.

## Data source and attribution

Production replay files are derived from 17Lands public datasets. Preserve 17Lands attribution in the deployed product and review current 17Lands usage guidelines whenever ingestion changes. The importer uses the public downloadable archives rather than scraping 17Lands' unsupported analytics API.
