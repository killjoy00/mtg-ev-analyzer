# Partial credit: explicit mana context before score calibration

Status: offline diagnosis and feature foundation. No new scorer is validated or deployed.

## What needs correction

The current color term estimates affinity from the main colors of decks containing a card. That affinity is not the card's mana requirement. A colored spell can clear no 90% main-color threshold and receive the same empty-color representation as a flexible artifact. A multicolor card can lose a required color. The commitment helper also counts any color intersection, so matching one required color does not distinguish a gold card from a fully supported spell. These are representational limitations even when broad pick-prediction metrics look acceptable.

The independent pair term may offset some of this, but cannot guarantee it. Pair context at P1P5 is multiplied by 4/8. The existing color term has its own adjustment. A negative pair term and a positive color term can cancel, preserving a strong base tendency for a card that requires an unsupported color change.

The 0–95 award is relative to the model leader. It is not confidence, win probability, or measured decision quality. Every monotone replacement of the ratio curve preserves the ordering, including a mistaken ordering. Softening the curve cannot correct the underlying context error.

## Work added

`scripts/trace_partial_credit.py` reconstructs one current v5 Premier decision from checksum-pinned official archives, excluding its source fold. It verifies the candidate set, prior pool, historical choice and every persisted rounded support before producing an explanation. The report separates base pick tendency, per-pair evidence, applied pair shift, color shift, inferred affinity and points. It fails if its decomposition no longer matches the production predictor. Detailed reports stay local under ignored `artifacts/`; do not publish customer feedback or stored play activity.

`scripts/rules_mana_context.py` provides independent research inputs from explicit card metadata: required colors and pips, each required color's representation in prior picks, newly required colors, which mana a land can produce, and a separate basic-landcycling mode with its activation cost. It does not assign points, fix a player's lane, or claim that a draft pool is a mana base. In particular, a generic landcycling mode does not make the creature itself freely castable.

Unknown metadata stays unknown. Hybrid/Phyrexian costs, alternative costs, multi-face cards, Adventures and Rooms are not approximated as ordinary colorless spells. These need explicit mode support before a complete scorer can use this feature family. Missing rules text cannot establish that a card provides no fixing. Mana requirements are available from card metadata without Pack One player responses or target-set game outcomes.

## Next scorer experiment

Keep the trophy-match rule of 100. Evaluate the alternative-ranking model and the points calibration separately:

1. Replace inferred mana requirements with verified metadata, retaining inferred deck affinity as a separately named feature. Rebuild any commitment statistics on the fitting partition using the new representation; do not swap color labels into old fitted tables and call that a validated model.
2. Model each required color, pip intensity, available fixing and alternate useful modes. Include the strength of existing commitments, synergy and opportunity cost. Remaining open at P1P3, splashing one color, and abandoning a black pool for a red-white card must be distinguishable. Avoid a blanket off-color penalty.
3. Compare current v5, an explicit-mana challenger, and an explicit-mana-plus-fixing challenger. Freeze features and selection rules before opening new assessment evidence. The completed outcome screen in PR #1429 remains spent development evidence and did not establish improved winning decisions.
4. Assemble a source-distinct benchmark balanced between reported failure patterns and representative decisions, including legitimate pivots and strong splashes as counterexamples. Independent reviewers see the pack and prior picks, but not model scores, reports, the historical choice or the eventual result. Record defensible alternatives, materially weaker alternatives, and uncertainty instead of forcing one correct label. Complaints are diagnostic inputs, not ground truth or a representative error rate.
5. Assess pairwise ordering against review judgments, severe high-credit errors, under-crediting defensible alternatives, abstention/metadata coverage, and results by pick and set. Agreement with observed picks is a secondary check, not the optimization target. Outcome prediction can corroborate information content but cannot establish the causal value of unchosen cards.
6. Only after ranking improves, calibrate partial credit against held-out contextual judgments, permitting multiple good alternatives. Any numeric score bands or uncertainty-based caps must be fitted/validated, not invented to make one complaint disappear. Measure whether 90–95-point alternatives are actually judged defensible.

No production release is supported yet. Promotion needs a separately versioned model/corpus and scoring profile if the award mapping changes, immutable historical results, parity checks across clients/backend, and the normal release gates. Fresh Dailies may adopt a promoted version; existing runs keep their recorded evidence and scores.

## Reproduce a diagnosis

The command reads local files only and never queries or mutates production. Source identity and hashes must come from the decision's retained snapshot. `expected.json` is the stored decision payload; keep it out of git.

```sh
python scripts/trace_partial_credit.py \
  --set SET_ID \
  --draft-data raw-data/context/draft.csv.gz \
  --game-data raw-data/context/games.csv.gz \
  --draft-sha256 DRAFT_SHA256 --game-sha256 GAME_SHA256 \
  --source-draft-hash SOURCE_HASH --pick-number 5 \
  --expected-puzzle artifacts/context/expected.json \
  --output artifacts/context/trace.json
python -m unittest discover -s tests -p test_trace_partial_credit.py -v
python -m unittest discover -s tests -p test_rules_mana_context.py -v
```

Public data attribution: [17Lands datasets](https://www.17lands.com/public_datasets), CC BY 4.0. Explicit card rules and metadata should be pinned from [Scryfall](https://scryfall.com/docs/api) with canonical card/face identities.
