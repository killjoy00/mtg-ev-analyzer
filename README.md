# Pack 1

Pack One is a Limited draft game built from historical 17Lands Premier Draft decisions. Its primary game is **Draft Run**: eight independent choices from verified trophy drafts, two one-use rerolls, and contextual partial credit. Play the Eastern-time Daily or unlimited practice, then send the same eight packs to a friend. Powered Cube has its own trophy-only eight-decision Daily and practice flow with two pack rerolls.

Live site: [packone.pro](https://packone.pro). Start with the [current state and deployment status](docs/CURRENT-STATE.md) and the [latest review / completed and remaining work](docs/SERVING-REVIEW-2026-09-15.md). The [initial product review](docs/PRODUCT-REVIEW-2026-09-14.md) remains available as history.

## Product rules

- Historical replay study, **not** a counterfactual draft simulator.
- High 17Lands win rate is the primary definition of player strength.
- The product owner’s settled design is to match the trophy drafter. **All three modes** award 100 for that pick and up to 95 from relative contextual support for alternatives — `round(95 * selected_support / leading_support)`. Draft Run and Full Pack apply it per decision; Top 3 applies the same support ratio through its membership and ordering weights. There is no separate curve for any mode, and a test grades one pack through both implementations to keep it that way.
- Historical drafter picks are shown separately from consensus.
- No model/LLM API is used for runtime scoring.
- Raw 17Lands archives are never committed or shipped to the browser.
- Daily is ranked; ordinary Top 3 and Full Pack games are unlimited.
- Accounts are optional. Guest-first play remains the default.

## Game modes

Three modes, and only three. Every one of them grades **Pack 1 only** — nothing in the product plays pack 2 or 3. Shards carry all 42 picks because the model needs the earlier pool to condition on, not because any mode shows them.

| Mode | What you play | Decisions | Card data comes from |
| --- | --- | --- | --- |
| **Draft Run** | eight independent picks sampled across sets, or Powered Cube | 8 | Neon (`draft_run_verified_puzzles`) |
| **Full Pack** | every decision in one seat's Pack 1 | 10 | R2 shards via `data.packone.pro` |
| **Top 3** | P1P1 only — rank your three best starts | 1 | R2 shards via `data.packone.pro` |

Draft Run draws from the full verified trophy corpus in the database. Full Pack and Top 3 read a replay shard for the selected set. Both populations are trophy drafts; they are built by different pipelines (`scripts/import_all_trophies.py` and `scripts/build_replays.py`), so a model change has to be rolled out to both before every mode agrees.

### Draft Run

`?game=draft-run` starts unlimited practice; add `&daily=1` for the ranked Daily. Round one is P1P1, round two is P1P2 with the original drafter’s earlier choice, and later rounds sample pick buckets. Each question uses a separate successful draft. See [the game contract](docs/CHARTER.md) and [launch review](docs/LAUNCH_REVIEW.md).

### Other Daily Challenges

One deterministic replay per set/mode/day, with the game day resetting at midnight Eastern. The first attempt is ranked and submitted to the global leaderboard. Consecutive days cannot select the same replay when a set has multiple replays.

### Top 3

Pack 1, pick 1 only. Rank the three cards you would most want to start a draft with. The result compares membership and ordering against the model's top three. Ordinary games receive deterministic seed URLs so friends can play the exact same opening pack.

### Full Pack

Play every decision in Pack 1 of a historical draft seat — ten picks, and only Pack 1. Your hypothetical selections do not alter the later historical packs. Later support reconditions on the cards you chose; replay-bound wheels receive feedback without ranked score weight. The final score summarizes the per-pick model-support scores, weighted by `log2(candidate_count)` so a forced last pick carries no weight.

## Production data

The legacy replay catalog is generated from eligible 17Lands Premier Draft public datasets. Each imported set targets 300 historical replays, a manifest, compact replay shards, and a separate counterfactual path model under `data/<set>/`. Published replay shards are served from `data.packone.pro` through R2; the browser loads only the shard required for the selected replay. Local shard files are hydrated for full CI validation.

The queued replay importer works through missing public sets in small validated batches. `data/catalog.json` registers replay environments. Draft Run/Cube use a separate verified trophy corpus in Neon; its full population is not limited to the replay sample. The checked-in `corpus/draft-run` files are a frozen baseline, while validated full imports expand the database. See [data management](docs/DATA-MANAGEMENT.md) and [full trophy importing](docs/ALL_TROPHY_IMPORT.md) for eligibility, counts and actual release controls.

The consensus model is `strong-player-pool-context-v2`: hierarchical strong-player pick tendencies plus shrinkage-adjusted candidate/pool co-pick lift. Replays are scored out-of-fold by draft ID. Model probabilities are comparative choice support, not calibrated win probabilities.

## Architecture

### Static game frontend

GitHub Pages serves the application, catalogs and compact model metadata; large replay shards are served separately through R2:

- `app.js` / `scoring.mjs`: core game and grading UI.
- `product.mjs` / `flow-fixes.mjs`: seeded-game and dedicated-result flows.
- `social.mjs`: challenge sharing, community picks, result cards.
- `growth.mjs` / `retention.mjs`: analytics, My Stats, optional account surfaces, local/remote result sync.
- `data/catalog.json`: production set catalog.
- `data/<set>/manifest.json` + R2 `data/<set>/shards/`: precomputed replay data.
- `draft-run-product.mjs` / `draft-run-feedback.mjs`: primary game UI and locked consensus comparison.
- `game-date.mjs` / `html.mjs`: shared Eastern game dates and HTML escaping.

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

`draftrunapi` is the server authority for the trophy-only corpus, eight-round sessions, deterministic Daily schedules, rerolls, grading, stored friend challenges, and Draft Run leaderboards. It writes a completed run once to career history and records its environment contributions separately.

### Optional accounts

Neon Auth (managed Better Auth) supplies email/password accounts. The first signed-in device claims the existing anonymous Pack 1 player ID. Later devices can sign in and receive a Pack 1 token for that same player, preserving leaderboard identity and synced stats.

The game never requires login. Auth session tokens are stored first-party by Pack 1 and validated server-side against Neon Auth; the flow does not depend on third-party cookies.

Here, first-party storage means browser localStorage on the Pack One origin, not HttpOnly cookies. Session expiry/revocation and a first-party cookie route remain [account-hardening work](docs/REQUEST-INTEGRITY.md).

### Analytics

`analytics_events` stores an event name, sanitized gameplay properties, Pack 1 player ID when available, and timestamp. Existing rows may be anonymous; the merged growth API requires a signed guest/player token for new client submissions and rejects server-owned milestone names. That protection requires backend deployment. Email/password data is not written to product analytics.

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

Three distribution test files skip locally without private replay shards. Same-repository CI hydrates R2 and sets `REQUIRE_REPLAY_SHARDS=1`; do not report a local pass as coverage of those files. Relevant backend PRs also run SQL integration suites on an expiring isolated Neon branch. Neither a Git merge nor that isolated database gate deploys production functions.

`.github/workflows/e2e.yml` runs a mobile-width Chromium product matrix covering production sets, deterministic seeded friend challenges, hidden-before-reveal friend comparison, Daily Top 3, a complete Full Pack run, dedicated result screens, My Stats, and optional Account UI.

It also covers Draft Run/Cube packs, locked consensus feedback, the phone dock and Today refresh/rollover. The standalone audit `node scripts/review-draft-run-baseline.mjs` recomputes frozen-corpus card scores; its puzzle-weighted summary is not a current production run benchmark.

## Importing sets

`.github/workflows/build-more-sets.yml` is the automatic backlog importer. On a normal run it:

1. consumes the explicit newest-first queue in `data/import-queue.json` (Scryfall discovery is a fallback when the queue is unavailable);
2. checks public Premier Draft archive availability for the queued or manually selected sets;
3. imports up to three available missing sets;
4. derives each 17Lands source date from the archive metadata;
5. stages each set outside `data/`, builds replay shards plus the path model, and validates both;
6. publishes only fully validated set directories/catalog changes; and
7. makes one serialized Git commit with push/rebase retries.

The workflow runs daily, and also runs when importer/model code lands on `main`, so a historical backlog fills itself without hand-editing YAML. A failed set does not contaminate the catalog or discard other successful sets from the same batch. Raw 17Lands CSV archives are temporary and never committed.

This schedule applies to the **legacy replay backlog**. The full-trophy workflow `import-all-trophies.yml` and legacy skill backfill `backfill-legacy-sets.yml` are manually dispatched. Editing those importers does not trigger their full rebuilds. Preserve source freshness; a completed snapshot does not make future archive checks unnecessary.

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
