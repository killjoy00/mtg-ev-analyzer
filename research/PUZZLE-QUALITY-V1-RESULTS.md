# Puzzle quality v1: implementation and decision

The offline selector now separates strength, colour commitment, predicted
debate, and historical-target defensibility. Its inference module has no
response-store or database dependency. The training/evaluation harness is a
separate optional scientific program; no application imports either module.

## What the experiment established

The frozen newest-set comparison passed its primary contrast: the C-strength
plus fit model improved held-out choice log loss relative to temperature-only
calibration, with a paired source-draft interval excluding zero. The improvement
was approximately 4.2%, a prediction-loss reduction, not a win-rate or enjoyment
increase. All responses from the assessment set were excluded from training.

The ablations matter. Colour commitment explains most of the gain. The fit-only
variant was slightly better on the budget-averaged score, while C+fit led in
the full-strength-data condition. Strength-only did not improve prediction over
calibration. Do not interpret stronger cards as necessarily more popular picks.
Keep C strength as an independent quality check and keep choice prediction as
a separate output; do not change the historical target or grader.

The experimental gates found reviewable candidates, but did not fill the
predeclared inventory quotas. Missing/ambiguous cost metadata and the demand
for two supported, above-average alternatives account for substantial abstention.
Thresholds were not relaxed to improve the reported yield. Their effect on
enjoyment or fairness is not established. Among well-observed assessment puzzles,
the eligible subset is too small to claim that selection improved debate quality.

## What is implemented

- `scripts/puzzle_quality.py`: standard-library-only features, portable JSON
  inference, per-card and per-puzzle reason codes, and portfolio selection.
- `scripts/puzzle_quality_experiment.py`: independent strength refits, strict
  response/context joins, held-out-set fitting, development cross-validation,
  frozen predictions, and source-draft uncertainty.
- Frozen hypotheses and constants in `PUZZLE-QUALITY-V1.md` and
  `puzzle-quality-v1.json`.
- Dedicated CI for the new inference/evaluation contracts and existing strength
  benchmark contracts. Synthetic tests contain no production observations.

All response and inventory source drafts were excluded before taking each
strength-fitting budget. Fitting-source hashes were independently verified.
The input source-exclusion digest prevents reuse when experiment contexts change.
Recorded Traditional responses were excluded before fitting because the strength
benchmark only validated PremierDraft. Inference rejects an explicitly different
event type; absent event metadata retains the verified corpus's legacy Premier
default. Unsupported event types need their own evidence before use.

## Running the private experiment

Install `research/card-strength-requirements.txt`. The strength phase requires
the frozen official archives and prepared arrays from `card_strength_benchmark.py`.
The private results package already contains the resulting independent strength
tables, so its choice evaluation can be reproduced without another strength fit.

Place the authorized input snapshot under `raw-data/puzzle-quality-v1/`:

- `contexts.json`: puzzle ID, set, source hash, pick number, corpus/model versions,
  historical target, candidates, and prior picks. Candidate fields are ID, name,
  mana cost, type line, and model probability.
- `responses.json`: aggregate first-encounter choice counts with cohort, format,
  source, and version metadata. Only these rows supply learning targets.
- `inventory-SET.json`: deterministic inventory sample, using the same context
  schema and excluding administrative removals at extraction.
- `removals.json`: snapshot of currently removed puzzle IDs; applied to all
  context records. An empty snapshot must be an explicit empty array.

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python scripts/puzzle_quality_experiment.py strengths
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python scripts/puzzle_quality_experiment.py evaluate --final-test
python scripts/puzzle_quality.py \
  --contexts raw-data/puzzle-quality-v1/inventory-fra.json \
  --strength artifacts/puzzle-quality-v1/strength-all.json \
  --model artifacts/puzzle-quality-v1/model-all.json \
  --out artifacts/puzzle-quality-v1/scored-new-puzzles.json
```

Omit `--final-test` to freeze choice models and predictions without reporting
assessment outcomes. The inference command does not accept a response file;
attaching observed counts or changing puzzle identities cannot change card
features or predicted probabilities. Source identity is used only for portfolio
diversity. The strength file must match the model artifact's recorded hash.

The default portable artifact preserves the preregistered C+fit candidate. All
ablation coefficients are also retained in private `models.json`; no blend,
budget switch, or quality threshold was selected after opening the assessment.
Independent strength tables, models, input/protocol/code hashes, per-puzzle
scores, and detailed assessment are kept private, outside this public repository.

## Decision and next validation

This is ready for offline review and a future serving-adapter experiment, not
automatic Daily activation. The choice model transfers to a set with no Pack One
training responses; it still relies on that set's 17Lands strength evidence and
existing consensus supports. The retrospective response snapshot had been
examined in earlier research, so an independent future-set assessment is still
needed before a deployment claim.

The next improvement should enrich context evidence for fixing, lands, flexible
costs and archetypes, then freeze a new threshold/coverage comparison. Do not
equate an unknown colour requirement with a weak card. Preserve removed-puzzle
exclusions, source diversity, and explicit shortfalls. Keep the original v1
assessment fixed; future changes need new validation data rather than tuning
against these results. Production scoring, Daily selection and leaderboards
remain unchanged.
