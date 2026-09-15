# Model evaluation harness

`scripts/eval_model.py` measures the consensus model offline. It never reads or
writes the served corpus, the database, or any published artifact.

Before this existed nothing in the repository computed log loss, accuracy, or
calibration, so no proposed model change could be checked. The strategy
separation numbers in the baseline audit measure the *scoring formula* on a
frozen corpus; they say nothing about model quality.

## Two tracks, kept apart

Prediction and grading answer different questions and, as the results below
show, can move in opposite directions.

* **Prediction** — how well does the model predict a strong player's next pick?
  Log loss, Brier score, top-1 accuracy, rank, MRR, and two calibration
  diagnostics, broken out by set, rarity, pick, pool size and Cube.
* **Grading** — what the `95 x selected/leader` formula would do. Reported as
  support-ratio statistics beside the prediction metrics, never mixed into them.
  Agreement with one historical pick is evidence about the model, not a measure
  of how much worse an alternative choice is.

The harness covers the first track. Deciding whether a defensible alternative
gets fair credit needs a blind expert review of alternatives, which no automated
metric substitutes for.

## Running it

```bash
# once per set: archive -> compact cache of the whole eligible cohort
python3 scripts/eval_model.py extract \
  --archive draft_data_public.BLB.PremierDraft.csv.gz --set-id blb --cache cache/blb.json

# compare variants and training caps on identical held-out drafts
python3 scripts/eval_model.py evaluate cache/*.json \
  --variants v2,v3-stage-matched --caps 5000,all --json-out report.json
```

Drafts split 60/15/25 train/validation/test by a hash of `draft_id`, so no
draft contributes to both training and scoring. The cache is deliberately
uncapped: the training cap is applied afterwards as a prefix of the same hash
order production uses, which makes `cap 5000` a strict subset of `cap 10000` and
the comparison properly nested.

Differences between variants carry a **cluster bootstrap over drafts**. Picks
from one draft are not independent, so resampling picks would make every
interval look far tighter than it is.

`v2` reproduces `strong-player-pool-context-v2` exactly; a unit test asserts it
against the production `OutOfFoldModel`.

## Extraction reproduces production

Cohort sizes match the published manifests exactly, which is the check that the
harness is measuring the real model and not an approximation of it.

| set | experienced | eligible | eligible share | production cap | discarded |
|---|---|---|---|---|---|
| blb | 97,418 | 16,463 | 16.9% | 5,000 | 69.6% |
| sos | 70,209 | 15,477 | 22.0% | 5,000 | 67.7% |
| msh | 40,480 | 9,728 | 24.0% | 5,000 | 48.6% |
| powered-cube | 31,574 | 5,438 | 17.2% | 5,000 | 8.1% |
| tmt | 15,510 | 3,126 | 20.2% | none — cap never binds | 0% |

The eligible share is 16.9-24.0%, never the 15% `--top-fraction` requests.
17Lands publishes win rate in buckets, so many drafts tie at the cutoff value
and `rate >= cutoff` admits all of them. Eligible population cannot be estimated
as `experienced x 0.15`; it has to be counted.

## What the first run found

Five sets, test split, ~521k held-out decisions. Every difference below is
separated from zero by its bootstrap interval unless stated.

### 1. The normalised probabilities are badly under-confident

The largest and cheapest finding. Across every bin, the card the model ranks
first is taken far more often than the share it is given (`tmt`, test split;
the other four sets have the same shape):

| top-pick probability claimed | actually taken |
|---|---|
| 0.25 | 0.47 |
| 0.34 | 0.62 |
| 0.44 | 0.72 |
| 0.75 | 0.96 |

Confidence ECE is 0.19-0.24 on all five sets. Raising every tendency to a fixed
power before normalising corrects it. Fit on validation, confirmed on test:

| | Daily-weighted served slice |
|---|---|
| v2 | log loss 1.4165, top-1 0.5492, ECE 0.19-0.24 |
| v2 with exponent 2.0 | log loss **1.2649**, top-1 **0.5492**, ECE 0.026-0.067 |

**-10.7% log loss at exactly zero accuracy cost** — a monotone transform cannot
reorder anything. The optimum sits at 2.0-2.25 on all five sets including Cube.

This is not free for the product. The displayed score is `95 x selected/leader`,
and the exponent applies to that ratio too. Decisions where a trophy player's
own pick scores below a fifth of the leader go from 2.1-3.5% to 9.5-13.9% — an
unusually harsh change to partial credit.

**The current generosity of partial credit is an artifact of the model being
under-confident, not a design decision.** Fixing the calibration without
revisiting the scoring formula would silently make the game much harder. The two
have to be decided together.

### 2. Pool context earns its place, but its lift is confounded by draft stage

`pair_seen`/`pair_picked` are keyed by `(card, pool_card)` with no pack or pick,
while `base_tendency` is specific to `(card, pack, pick)`. The lift subtracts one
from the other, so a difference caused by *when* a pair tends to be observed is
read as an effect of the pool. Pair observations require the pool card to
already be in the pool, so they are drawn from systematically later picks than
the card's own base rate — the confound has a consistent direction, not a random
one.

`v3-stage-matched` anchors the lift on the base rate expected over exactly the
observations behind each pair count. Results:

| | tmt | msh | powered-cube | sos | blb |
|---|---|---|---|---|---|
| removing context (log loss) | +0.028 | -0.016 | +0.084 | +0.047 | +0.044 |
| removing context (top-1) | -0.105 | -0.055 | -0.088 | -0.104 | -0.086 |
| stage-matched (log loss) | -0.066 | -0.071 | -0.005 | -0.063 | -0.042 |
| stage-matched (top-1) | -0.037 | -0.021 | -0.033 | -0.029 | -0.029 |

Context is worth keeping: removing it costs 5.5-10.5 points of top-1 accuracy on
every set. Stage matching improves log loss on all five and cuts confidence ECE
by about 30%, but costs 2.1-3.7 points of top-1 every time. That trade is
consistent enough to be real and not obviously worth taking; the grading track
should decide it.

### 3. Coverage scaling does not earn its place

Scaling the context term by the share of the pool carrying usable pair evidence
was expected to help, because one barely-qualifying pair can otherwise speak for
an eight-card pool. Measured on both baselines it is a small, consistent
**loss** on all five sets (+0.0005 to +0.0063 log loss). The single-sparse-pair
case is real — the unit test reproduces it — but it is rare enough that damping
every pool to defend against it costs more than it saves.

### 4. Raising the training cap helps, modestly

| set | 2,500 | 5,000 | uncapped | 5,000 -> uncapped |
|---|---|---|---|---|
| blb | 1.3531 | 1.3388 | 1.3307 (9,855) | -0.0081, +0.6pp top-1 |
| sos | 1.3332 | 1.3092 | 1.2967 (9,322) | -0.0125, +0.9pp top-1 |
| msh | 1.3301 | 1.3114 | 1.3089 (5,795) | -0.0026, +0.2pp top-1 |

Consistent, separated, monotone — more data is better — but doubling the
training set buys 0.6-0.9% log loss, against 10.7% for one exponent. Returns are
clearly diminishing: halving to 2,500 costs about twice what doubling gains.

The mechanism explains the size. Distinct observed pairs barely move (blb:
72,549 at cap 5,000 vs 72,982 uncapped, +0.6%). At 5,000 drafts nearly every
possible pair has already been seen at least once; more data densifies existing
pairs rather than reaching new ones.

The harness can only train on its own 60% split, so it measures 5,000 -> ~9,900,
not 5,000 -> 16,463. Extrapolating the diminishing shape, the full-cohort gain is
likely around 1% log loss. That is an extrapolation, not a measurement.

Four sets never reach the cap at all (`tmt` 3,126, `hbg` 3,048, `ktk` 2,548,
`hob` 2,341), and two of them carry the highest Daily weights — `hob` is the
newest set at weight 6 and `tmt` is weight 4. Raising the cap does nothing for
them. Weighted by Daily exposure the cap binds on about 81% of set exposure.

### 5. Rarity

Pooled over all five sets:

| rarity | n | log loss | top-1 |
|---|---|---|---|
| common | 292,591 | 1.2644 | 0.5569 |
| uncommon | 143,947 | 1.4273 | 0.5550 |
| rare | 64,957 | 1.3785 | 0.6146 |
| mythic | 14,581 | 1.4750 | 0.5391 |

There is no clean rarity gradient. Mythics have the worst log loss, but rares
have the best top-1 accuracy and uncommons are nearly as poorly predicted as
mythics. The claim that the model's weakness concentrates in rares and mythics
is not supported as stated.

## Changing the model is not just a code change

Published puzzles keep the probabilities they were first scored with.
`import_all_trophies.py` reuses any puzzle whose id already exists and raises if
it cannot re-verify every one of them; `load_all_trophies.mjs` only ever inserts
additional rows and pins `corpus_version`. So a changed model — including a
changed training cap — reaches new decisions only, leaving old ones scored by
the old model under one `model_version`.

`TRAINING_DRAFT_CAP` is now a named constant with a `--training-cap` flag, and
`build_set` refuses a non-default cap for any set that already has published
puzzles rather than producing a silently mixed corpus. Actually re-scoring
requires a corpus version bump and a regeneration path, which does not exist yet.

## Suggested order

1. Decide calibration and the scoring formula together. The exponent is one
   number with a large, reproducible prediction gain and a large grading side
   effect; neither should be chosen without the other.
2. Stand up the grading-fairness track — blind review of alternatives,
   concentrating on severe disagreements, sparse cards and colour pivots. Every
   remaining question is a trade between log loss and partial credit, and
   nothing here can settle those alone.
3. Stage-matched context, if the grading track accepts the accuracy trade.
4. Raise the cap. Real but small, and it needs the regeneration path first.
5. Skip coverage scaling. Tested on five sets, it does not pay.

Colour/archetype context is untested here and remains a hypothesis.
