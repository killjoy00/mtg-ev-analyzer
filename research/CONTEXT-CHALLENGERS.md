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
