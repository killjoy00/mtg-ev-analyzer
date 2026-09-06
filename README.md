# Draft Study

`mtg-ev-analyzer` is being rebuilt around a Limited replay-study workflow inspired by studying real high-level drafts one decision at a time.

The learner follows a **historical draft path**. At each pick they see the real pack state and the historical drafter's pool entering that pick, make their own selection, then reveal:

- the historical pick,
- the offline strong-player consensus pick,
- the modeled likelihood of every candidate,
- the learner's rank and likelihood gap.

The historical drafter is a reference point, not the definition of correctness.

## Product rules locked for V1

- Replay study, **not** a counterfactual simulator.
- High 17Lands win rate is the primary definition of player strength.
- Strong-player consensus is the primary grading signal.
- Historical-pick agreement is tracked separately.
- No LLM or model API calls at runtime.
- No live 17Lands API dependency; production data comes from public draft dumps after release.
- Premier Draft first.

## Architecture

The app intentionally has no framework or runtime service dependency yet:

- `index.html` / `styles.css` / `app.js`: static replay UI.
- `scoring.mjs`: browser-independent grading and summary logic.
- `data/*.json`: compact precomputed replay files loaded by the browser.
- `scripts/build_replays.py`: offline 17Lands CSV -> replay JSON pipeline.
- `tests/`: Node and Python tests.

This keeps hosting cheap and makes it possible to swap in better offline models without changing the live application contract.

## Running locally

The app uses `fetch`, so serve it over HTTP rather than opening `index.html` directly:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

The checked-in MSH file is explicitly an **interface fixture**. It uses real card names but synthetic picks/probabilities and must not be interpreted as 17Lands training data.

## Tests

There are no third-party test dependencies.

```bash
npm test
```

That runs both the Node scoring tests and Python pipeline tests.

## Building replay data from a 17Lands draft dump

Download a public `draft_data` CSV/CSV.gz from 17Lands and keep it outside git (for example under `raw-data/`). Then run:

```bash
python scripts/build_replays.py \
  --input raw-data/draft_data_public.MSH.PremierDraft.csv.gz \
  --output generated/msh.json \
  --expansion MSH \
  --format PremierDraft \
  --source-date 2026-07-26 \
  --minimum-games 100 \
  --top-fraction 0.15
```

### Cohort selection

The builder reads each draft's win-rate and experience buckets, requires the experience lower bound to meet `--minimum-games`, and computes the set-specific win-rate cutoff needed to retain the top `--top-fraction` of those experienced drafts. The defaults are starting assumptions, not gospel.

### Consensus model V1

The first model is intentionally transparent. For strong-player drafts it estimates a smoothed tendency for each card to be selected when seen at the same pack/pick position (with pack-level and global backoff), then normalizes candidate tendencies within the current pack.

Every replay is graded **out of fold by `draft_id`**. A draft never contributes to the statistics used to score itself.

This is a baseline and does **not yet deeply condition on the current pool**. The browser schema already supports replacing it with a pool-conditioned model later.

## Static card art

The replay schema supports an optional `image_url` per candidate. The builder accepts `--card-metadata` pointing to a local JSON map, so art can be enriched offline without adding a runtime API dependency.

## Data source and attribution

Production replay files are intended to be derived from the 17Lands public datasets. Keep 17Lands attribution in the deployed product and review the current 17Lands usage guidelines whenever ingestion changes.
