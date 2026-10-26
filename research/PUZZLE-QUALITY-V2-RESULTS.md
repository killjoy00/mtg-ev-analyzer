# Select for strong, defensible competing options

Historical v2 comparison. The subsequent five-candidate, additional-set
[v3 model selection](PUZZLE-QUALITY-V3-RESULTS.md) selects a GIH-led adaptive
blend in place of adjusted strength alone. This report remains the v2 record.

V2 is an offline candidate that ranks the weaker strength of the historical
pick and its best credible alternative. Both must pass the existing contextual
support and colour-fit checks. Predicted disagreement is no longer the quality
score; learned Pack One choice probabilities are optional warning diagnostics.
There is no UAT system, recruitment, manual rating prerequisite, or production
scoring/selection change.

## What changed

- Require an independently supported historical pick and at least one valuable,
  contextually supported competitor. A bomb cannot rescue a weak historical
  target or weak alternatives.
- Rank the pair's weaker C strength; break ties with the pair's weaker contextual
  support. A third option provides no automatic ranking bonus.
- Keep observed choices, predicted choices, future deck membership, and source
  wins outside inference. Sidecar warnings cannot affect eligibility or ranking.
- Interpret ordinary colour/colour hybrid mana as alternative payment choices.
  Prior lands no longer make every subsequent pool's spell-colour evidence
  unknown. Missing fixing is disclosed; candidate lands and other unvalidated
  payment requirements remain review cases.
- Preserve v1 unchanged as a comparator and expose a ranking-only ablation.
- Require a matching strength hash, explicitly excluded puzzle source, supported
  corpus/model version, and an explicit removals snapshot in the inference CLI.

## Evidence and decision

The fixed comparison used the same six-set inventory and independent strength
tables as v1. Later-game corroboration used a disjoint chronological assessment
partition, excluded all experiment source drafts, and reconstructed the original
strength-fitting source hashes at all three budgets. Every selected v1/v2 pair
had sufficient later evidence under the frozen assessment rules.

At the full fitting budget, v2 selected more candidates. In equal-size,
set/pick-matched portfolios, the mean weaker-card later GIH strength was higher,
and more pairs had both cards above the later set average. The ranking-only
ablation also had a positive point difference. These support the revised
strength objective; they do not measure interestingness, causal pick value, or
player enjoyment.

Early evidence is the limiting result. The 500-draft matched comparison showed
essentially no improvement, and the 2,000-draft comparison had a negative point
difference. Their conditional intervals included zero. More qualified inventory
at those budgets is not evidence of better quality. Do not choose thresholds,
a fallback model, or a release rule after inspecting these results.

**Decision: retain v2 as the revised offline candidate; do not activate it in
production from this study.** The next substantive requirement is independent
validation of sparse-data strength reliability and its fallback/abstention rule.
The current 100-game floor is not a per-card uncertainty estimate. Budget tests
use mature contextual-support snapshots and are not complete launch-day replays.
The assessment archives have been used previously, so this is a retrospective,
source-separated comparison rather than a fresh unseen-set deployment test.

The private report contains exact portfolio sizes, matched contrasts, source
counts, per-set evidence, every added/removed puzzle, and response diagnostics.
The bootstrap intervals condition on fixed card estimates and do not account
for shared-card correlations, card-estimation uncertainty, or selecting from
multiple experimental budgets. They are descriptive, not a definitive winner
test. GIH remains an observational association.

## Reproduction

Install `research/card-strength-requirements.txt`. Keep authorized v1 inputs
under `raw-data/puzzle-quality-v1/` and the frozen v1 artifacts under
`artifacts/puzzle-quality-v1/`. The evidence phase additionally needs the original
official game archives and verified prepared caches from the strength benchmark.

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python scripts/puzzle_quality_compare.py freeze
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python scripts/puzzle_quality_compare.py evidence
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python scripts/puzzle_quality_compare.py assess
```

Freeze serializes all portfolios before later outcomes or response diagnostics
are assessed. Evidence and assessment verify code, protocol, source, and output
hashes. V2 writes to `artifacts/puzzle-quality-v2/`; v1 results are not overwritten.
The private reproducibility package contains the resulting later-game tables,
so assessment can be reproduced without redistributing raw game archives.

Pure inference requires only Python's standard library and no choice-model file:

```sh
python scripts/puzzle_quality_v2.py \
  --contexts raw-data/puzzle-quality-v1/inventory-fra.json \
  --strength artifacts/puzzle-quality-v1/strength-all.json \
  --selector artifacts/puzzle-quality-v2/selector-all.json \
  --removals raw-data/puzzle-quality-v1/removals.json \
  --out artifacts/puzzle-quality-v2/inference-smoke.json
```

Source exclusions are an evidence-scope guard, not an identity predictor. A new
source requires independently fitted strength evidence with that source excluded
and a new matching selector artifact. No response history is required. Traditional
and Cube are outside the validated strength scope.

## Verification

18 new tests plus the 14 v1 selection tests and 9 strength benchmark tests pass.
They cover weak packs, obvious bombs, weak historical targets, context mismatch,
third-option invariance, independence from observed/future/predicted choices,
hybrid and unknown costs, source exclusions, removals, matched quotas, and
source diversity. Real-data pure inference exactly reproduces the frozen FRA
inventory output. Every v1 card diagnostic, eligibility result, and score is
unchanged across all three evidence budgets.
