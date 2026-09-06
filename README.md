# Draft Study

`mtg-ev-analyzer` is now a Limited replay-study trainer built around real historical 17Lands draft decisions.

The learner follows a **historical draft path**. At each pick they see the real pack and the historical drafter's pool entering that pick, make their own selection, then reveal:

- the historical pick,
- the offline strong-player consensus pick,
- the modeled choice likelihood of every candidate,
- the learner's model rank and likelihood gap.

The historical drafter is a reference point, not the definition of correctness.

## Product rules

- Replay study, **not** a counterfactual simulator.
- High 17Lands win rate is the primary definition of player strength.
- Strong-player consensus is the primary grading signal.
- Historical-pick agreement is tracked separately.
- No LLM or model API calls at runtime.
- No live 17Lands API dependency; production data comes from public draft dumps after release.
- Premier Draft first.

## Architecture

The live application deliberately remains static:

- `index.html` / `styles.css` / `app.js`: replay UI.
- `scoring.mjs`: browser-independent grading and summary logic.
- `data/<set>/manifest.json`: set/cohort/model metadata and replay shard index.
- `data/<set>/shards/*.json`: compact precomputed historical replays.
- `scripts/build_replays.py`: streaming 17Lands CSV -> pool-conditioned consensus -> replay shards.
- `scripts/fetch_card_metadata.py`: optional offline card/image enrichment.
- `scripts/validate_dataset.py`: generated-data integrity checks.
- `.github/workflows/build-replay-data.yml`: reproducible public-dump ingestion.
- `tests/`: Node and Python tests.

The browser picks one small replay shard and loads only that shard before starting a session. Raw 17Lands archives are never committed or sent to the client.

## Current production dataset

The repository currently contains MSH Premier Draft replay data generated from the 17Lands public draft-data dump dated 2026-07-26.

The generated manifest records:

- 181,803 experienced drafts with a parseable win-rate bucket and an experience-bucket lower bound of at least 100 games;
- a 0.60 win-rate-bucket midpoint cutoff for the selected top-15% cohort;
- 5,000 strong-player drafts used for the capped training sample;
- 210,000 strong-player pick examples in that training sample;
- 300 replay drafts;
- 42 decisions per replay (12,600 replay decisions total);
- 30 shards of 10 replays each; and
- a 5-fold draft-level holdout model.

The 5,000-draft value is a performance cap on the training sample, not the total number of drafts that meet the strong-player cohort definition.

## Running locally

The app uses `fetch`, so serve it over HTTP rather than opening `index.html` directly:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Tests

There are no third-party test dependencies.

```bash
npm test
```

The suite checks browser JavaScript syntax, grading behavior, cohort parsing, pool-conditioned model behavior, holdout subtraction, sharding/catalog generation, card metadata extraction, and generated dataset validation.

## Building replay data from a 17Lands draft dump

Download a public `draft_data` CSV/CSV.gz from 17Lands and keep it outside git, for example under `raw-data/`.

Optionally fetch static card display metadata first:

```bash
python scripts/fetch_card_metadata.py \
  --set MSH \
  --output generated/msh-cards.json
```

Then build the replay set:

```bash
python scripts/build_replays.py \
  --input raw-data/draft_data_public.MSH.PremierDraft.csv.gz \
  --output-dir data/msh \
  --catalog data/catalog.json \
  --expansion MSH \
  --format PremierDraft \
  --source-date 2026-07-26 \
  --minimum-games 100 \
  --top-fraction 0.15 \
  --max-training-drafts 5000 \
  --max-output-drafts 300 \
  --minimum-picks 30 \
  --folds 5 \
  --shard-size 10 \
  --card-metadata generated/msh-cards.json
```

Validate before publishing:

```bash
python scripts/validate_dataset.py data/msh/manifest.json --minimum-replays 100
```

### Cohort selection

The builder reads each draft's 17Lands win-rate and experience buckets. It requires the lower bound of the experience bucket to meet `--minimum-games`, then computes the set-specific win-rate-bucket midpoint cutoff needed to retain the top `--top-fraction` of those experienced drafts.

The cutoff is derived from the actual set population rather than hard-coded. The defaults are starting assumptions, not gospel.

### Consensus model v2

The model is intentionally interpretable and offline. It combines:

1. hierarchical strong-player card pick tendency at the same pack/pick position, with pack-level and global backoff; and
2. shrinkage-adjusted **card/pool co-pick lift**, so the same card can receive a different modeled likelihood depending on what the historical drafter has already selected.

Candidate tendencies are normalized within the current pack to form modeled strong-player choice likelihoods. These values are **not claimed to be calibrated win probabilities**.

Every replay is graded out of fold by `draft_id`. Counts from the replay's entire holdout fold are subtracted from the model before that replay is scored, so a historical draft never contributes to its own consensus probabilities.

### Sharding

`build_replays.py` writes a manifest plus small replay shards. A set can therefore contain hundreds of drafts without requiring a phone to download the entire corpus before the first decision.

### Card art

Card metadata and image URLs are enriched during the offline build. The study app makes no Scryfall API requests. If metadata enrichment is unavailable, the replay remains usable with card-name placeholders.

## Automated MSH build

`.github/workflows/build-replay-data.yml` reproduces the current MSH dataset from the official public Premier Draft dump. It:

1. runs the test suite,
2. downloads the public archive,
3. fetches static card metadata,
4. trains/generates the replay shards,
5. validates the output,
6. stores the generated data as a workflow artifact, and
7. commits only the compact `data/msh/` output and catalog back to the build branch.

The raw archive and intermediate files remain outside git.

## Data source and attribution

Production replay files are derived from 17Lands public datasets. Preserve 17Lands attribution in the deployed product and review the current 17Lands usage guidelines whenever ingestion changes.
