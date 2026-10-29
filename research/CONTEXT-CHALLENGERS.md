# Color-context challengers: preregistered secondary check

Status: preregistered before any challenger was scored. Results are appended below the rule and must not change anything above it. This is the pick-prediction check from step 3 of the [partial-credit experiment plan](PARTIAL-CREDIT-CONTEXT.md). It is secondary evidence: it cannot show that a challenger grades decisions better, and it cannot authorize a release.

## Question

The [context audit](CONTEXT-MODEL-AUDIT.md) found that inferred affinity drops printed colors because splash colors are ignored, and that fixing lands are flexible or partly colored. Does replacing the representation, and refitting the color statistics, change how well the v5 arithmetic predicts strong players' served-slice picks?

## Frozen challengers

All four use the same card counts, pair expectations and `v3-colour-and-pair` arithmetic (the v5 harness variant, temperature 1.0, uncapped training split). Only the card color sets change. Each challenger's commitment, stage and marginal tables are refitted on the train split from its own colors; no color label is swapped into an old table.

| Challenger | Card colors |
| --- | --- |
| `v5` | Production inference: deck `main_colors`, 90% share, at least 30 decks, otherwise unknown. |
| `splash` | The same inference with each game's main plus splash colors. |
| `explicit` | Printed cast colors for spells with complete metadata; lands with complete metadata are flexible. Anything else keeps the `v5` value. |
| `explicit-fixing` | As `explicit`, except lands with complete metadata take the colors of the mana they produce. A land with unknown produced mana keeps the `v5` value. |

Commitment still counts any shared color, and pips, alternative costs and landcycling are not modeled. These are representation swaps inside the existing feature, not the full contextual model in step 2 of the plan.

## Data and split

- 17Lands Premier draft and game archives for each set, retrieved 2026-10-29. Their checksums are recorded in each result file.
- Card metadata: `research/data/<set>-rules-context-2026-10-29.json.gz`, built by `scripts/build_rules_context_metadata.py`.
- Development set: FRA. Its affinity details were inspected during the audit, so it does not count toward the decision.
- Confirmation sets, by a fixed rule: the five most recent `expansion` sets in `corpus/draft-run/catalog.json` by `source_date`. These are HOB, MSH, SOS, ECL and TMT.
- Cohort: `eval_model.py extract` defaults (at least 100 games, top 15% win-rate bucket). Training uses the whole harness train split. Scoring uses the harness validation split. The test split is not read, so it stays unspent for a future release decision.
- Scope: the served slice only, Pack 1 picks 1–11.

## Metrics and decision rule

Per set, each challenger is compared with `v5` on identical decisions. Intervals are 95% paired cluster bootstraps over drafts (2,000 draws, the harness seed).

- Primary: served-slice log loss difference.
- Guardrail: top-1 accuracy difference.
- Reported, not used in the rule: Brier difference, how often the model leader changes, and the mean absolute change in model-only points across candidates.

A challenger **improves the secondary check** if its log loss interval lies entirely below zero on at least 4 of the 5 confirmation sets, and its top-1 interval lies entirely below zero on none of them. It **worsens** it if its log loss interval lies entirely above zero on 2 or more confirmation sets. Otherwise the result is **inconclusive**. FRA is reported separately and does not count.

Whatever the outcome, promotion still needs the blind contextual benchmark in steps 4–6 of the plan, a separately versioned model and scoring profile, and the normal release gates.

## Reproduce

```sh
python scripts/eval_model.py extract --archive raw-data/SET/draft.csv.gz --set-id SET --cache raw-data/SET/cache.json
python scripts/compare_context_challengers.py --cache raw-data/SET/cache.json \
  --games raw-data/SET/games.csv.gz --games-sha256 GAME_SHA256 \
  --metadata research/data/SET-rules-context-2026-10-29.json.gz --metadata-sha256 METADATA_SHA256 \
  --output artifacts/context/SET-challengers.json
```

Public data attribution: [17Lands datasets](https://www.17lands.com/public_datasets), CC BY 4.0; card metadata from the [Scryfall API](https://scryfall.com/docs/api).

## Results (2026-10-29)

Scored after the preregistration commit `a870585`, with no change to the challengers, sets, metrics or rule. All six runs passed the check that the deck scan reproduces the harness color table. Full aggregates, archive checksums and cache identities: [context-challengers-2026-10-29.json](data/context-challengers-2026-10-29.json).

**Verdict: all three challengers improve the secondary check.** `explicit` and `explicit-fixing` lower served-slice log loss with intervals below zero on 5 of 5 confirmation sets. `splash` does so on 4 of 5; its TMT interval spans zero. No challenger's top-1 interval lies below zero on any set.

Served-slice log loss change against `v5` (negative is better), with 95% cluster-bootstrap intervals:

| Set | Decisions | `v5` log loss | `splash` | `explicit` | `explicit-fixing` |
| --- | ---: | ---: | --- | --- | --- |
| HOB | 6,952 | 1.1935 | -0.0126 [-0.0159, -0.0095] | -0.0099 [-0.0134, -0.0064] | -0.0152 [-0.0188, -0.0114] |
| MSH | 16,280 | 1.2225 | -0.0292 [-0.0322, -0.0261] | -0.0201 [-0.0226, -0.0174] | -0.0187 [-0.0216, -0.0157] |
| SOS | 24,651 | 1.2403 | -0.0239 [-0.0270, -0.0211] | -0.0071 [-0.0090, -0.0052] | -0.0172 [-0.0197, -0.0148] |
| ECL | 17,120 | 1.2415 | -0.0120 [-0.0146, -0.0094] | -0.0061 [-0.0081, -0.0040] | -0.0064 [-0.0085, -0.0044] |
| TMT | 4,570 | 1.2168 | -0.0035 [-0.0108, 0.0036] | -0.0069 [-0.0114, -0.0023] | -0.0168 [-0.0218, -0.0120] |
| FRA (development) | 7,524 | 1.3190 | -0.0329 [-0.0370, -0.0288] | -0.0244 [-0.0280, -0.0208] | -0.0279 [-0.0321, -0.0237] |

Top-1 change in percentage points, and how far model-only points move on the same packs:

| Set | `splash` top-1 | `explicit` top-1 | `explicit-fixing` top-1 | Leader changes | Mean absolute point change |
| --- | --- | --- | --- | --- | --- |
| HOB | +0.4 [+0.0, +0.9] | +0.7 [+0.3, +1.2] | +0.4 [-0.1, +0.8] | 4.8–5.5% | 1.4–1.7 |
| MSH | +1.2 [+0.8, +1.6] | +1.1 [+0.7, +1.4] | +0.6 [+0.2, +1.0] | 7.3–10.4% | 2.3–3.2 |
| SOS | +1.4 [+1.0, +1.8] | +0.4 [+0.1, +0.7] | +1.0 [+0.7, +1.4] | 7.9–14.5% | 2.1–3.9 |
| ECL | +0.9 [+0.5, +1.3] | +0.7 [+0.4, +1.0] | +0.6 [+0.3, +0.8] | 5.4–10.8% | 1.8–3.6 |
| TMT | +0.0 [-0.9, +1.0] | -0.1 [-0.7, +0.5] | +0.4 [-0.2, +1.1] | 6.3–14.9% | 2.0–5.0 |
| FRA (development) | +1.3 [+0.6, +1.9] | +1.4 [+0.8, +1.9] | +1.2 [+0.5, +1.8] | 8.8–11.2% | 2.9–3.5 |

The last two columns give the range across the three challengers. Point change is the mean absolute change in the model-only award (0–95) across every candidate in every served pack.

### Interpretation

- Where separated from zero, the gains are 0.5–2.4% of `v5` log loss on the confirmation sets (0.006–0.029 nats). For scale, stage matching moved log loss by 0.005–0.071 nats and calibration by 10.7% in [model evaluation](../docs/MODEL-EVALUATION.md). These gains are smaller but consistent across sets.
- Every challenger changes the model's leader on about 5–15% of served decisions and moves points by 1.4–5.0 on average. Adopting one is a scoring change that needs a new model version and scoring profile, not a silent fix.
- `explicit` gives more cards a color judgment than `v5` (for example 191 against 169 in HOB), because printed colors do not need 30 observed decks. Part of its gain may come from that coverage rather than from correcting wrong colors; this run does not separate the two.
- No contrast between challengers was preregistered, so this does not choose among them. As point estimates only: `splash` was largest on MSH, SOS, ECL and FRA but not separated from zero on TMT, and it colors lands; `explicit-fixing` was largest on HOB and TMT and exceeded `explicit` on every set except MSH, though only by 0.0004 on ECL.

### What this does not show

- Pick prediction measures agreement with strong players' picks, not whether a challenger grades alternatives better. That still needs the blind contextual benchmark in steps 4–6 of the [plan](PARTIAL-CREDIT-CONTEXT.md).
- The harness trains on its 60% split; production fits each fold on the other 80% of the cohort. Production magnitudes may differ.
- Commitment still counts any shared color, and pips, alternative costs and landcycling are not modeled. These are representation swaps, not the full contextual model.
- The test split remains unread and available for a frozen promotion decision.
