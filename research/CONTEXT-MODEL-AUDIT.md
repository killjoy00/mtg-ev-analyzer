# Context model audit

Status: offline review of frozen `strong-player-colour-stage-v5`. No live model, corpus, point formula or historical result changes. The calculation defect below is documented, not silently patched into the existing model version.

## Findings and priority

| Priority | Finding | Evidence and consequence | Treatment |
| --- | --- | --- | --- |
| High | Inferred deck affinity drops printed mana requirements | Across the five FRA training complements, 33–35 of 221 supported simple colored spells omit a required color. Of those, 18–19 receive the empty affinity that commitment treats as flexible. There are 36 distinct affected card names across folds. | Separate explicit mana requirements from inferred deck affinity; refit context statistics and validate the replacement. |
| High | Matching one color can conceal an unsupported second color | `deck_fit.commitment` uses any set intersection. A BR card in a four-black-card pool receives the same count as a B card. B, BB and BBB requirements also collapse to the same color set. | Preserve each required color and pip intensity. A pool is not a mana base, so these are features, not castability verdicts. |
| High | Fixing is missing from the color feature | When BG and RW lands both have empty inferred affinity, both receive the entire black pool as support. As prior picks, neither contributes to a black spell's color count. | Represent produced mana, conditions/costs and useful alternate modes, including landcycling. |
| Medium | Deck-inclusion labels are name-level, not copy-level | `scan_deck_observations` unions names across games; `observe_examples` labels every pick of that name positive if any copy appears. Three copies drafted and one played produces `[1, 1, 1]`. The FRA cohort contains 3,984 draft/card groups with fewer maximum observed deck copies than drafted copies. | Retain counts and model the marginal usefulness of additional copies. Do not arbitrarily label a particular copy as the unused one. |
| Medium | Zero is incorrectly treated as missing in the production color calculation | `OutOfFoldModel.fit_shift` uses `if not conditioned or not reference`; the evaluation harness uses `is None`. A valid 0.0 cell gives production shift 0, but the harness gives a clamped negative shift of about -13.8155 against a .5 reference. | Fix under a separately versioned model and add boundary parity coverage. No zero-valued pooled stage/marginal/reference cells occurred in these five FRA fits, so current FRA impact is not established. |
| Fixed here | The new research parser could accept incomplete display metadata as a complete card | Missing layout used to default to normal; `display_faces` was not checked. A stripped multi-face display record could therefore be misread. | Require an explicit normal layout, reject either face representation, and allow checksum-pinned canonical metadata in the trace CLI. Regression tests pass. |

The first four rows are demonstrated feature/target limitations, not proof that every associated recommendation is wrong. Base preference and card-pair evidence may compensate. Alternative casting costs, useful abilities, splashes and genuine pivots also matter; comparing printed costs with affinity does not adjudicate those decisions. The audit supports a contextual challenger, not a blanket off-color penalty.

## Scope and measurements

The FRA audit rebuilt all five v5 training complements from pinned official draft and game archives. The eligible cohort contains 4,677 drafts and 196,432 pick rows, using the existing minimum-games and top-player selection policy. The copy audit includes 4,640 eligible drafts with game observations. It uses the maximum observed deck count across games to avoid treating a temporary deck edit as evidence that a copy was never played.

| Holdout fold | Simple colored spells | Unknown inferred affinity | Required color omitted | Empty affinity among omissions |
| --- | ---: | ---: | ---: | ---: |
| 0 | 221 | 28 | 34 | 18 |
| 1 | 221 | 27 | 33 | 18 |
| 2 | 221 | 26 | 35 | 19 |
| 3 | 221 | 26 | 33 | 18 |
| 4 | 221 | 28 | 33 | 18 |

Each fold has 295 fit card names; 37 lack supported metadata for this narrow parser. Unknown affinity is kept distinct from empty affinity and is not counted as an omission. The 221 denominator includes unknown-affinity simple colored spells. Fold counts overlap and must not be added as distinct cards or independent observations.

The copy audit finds 26,258 repeated-card draft groups, of which 21,545 appear in a deck at least once. The 3,984 groups with fewer observed deck copies contain 9,247 picked copies and 4,338 copies above their maximum observed deck counts. These describe target granularity. They are not counts of objectively bad picks or mislabeled individual copies; game records may be incomplete and the existing target deliberately asks whether the card name ever appeared.

Full aggregate results: [FRA context audit](data/fra-context-audit.json). Detailed player reports and production decisions are not part of the committed evidence.

## Checks that passed

The [scoring contract audit](data/scoring-contract-audit.json) checked the 30 sets in the repository catalog: 20,231 puzzles and 183,738 candidate awards. Every catalog count and compressed-file checksum matched. All puzzles passed validation, rounded support sums were consistent with normalization, both current graders awarded identical points, every historical pick received 100, and all 163,507 alternative awards were integers between 0 and 95.

This covers the checked-in catalog, not database-only additions or every mobile rendering path. Legacy scoring profiles are intentionally frozen and are outside the current-formula parity check. Passing these checks establishes arithmetic consistency, not recommendation quality. In particular, 95 is the automatic model-leader cap, not 95% confidence or a measured probability of a winning decision.

Synthetic tests reproduce the zero-cell divergence, gold/pip collapse, fixing blindness and copy-label behavior. Tests that document frozen behavior are diagnostic contracts, not desired acceptance criteria for a replacement. Separate tests verify the repaired metadata handling and conservative aggregate accounting.

## Reproduce

Public sources:

- [17Lands public datasets](https://www.17lands.com/public_datasets), CC BY 4.0: FRA PremierDraft draft and game archives, pinned below. A refreshed archive may have a different hash and must not be substituted for this result.
- [Scryfall API](https://scryfall.com/docs/api): `cards/search?q=e%3Afra&unique=prints&order=set`, all pages retrieved on 2026-10-29. The committed gzip snapshot keeps the fields used by this audit and canonical face data, keyed by importer aliases. Its 306 entries were selected using the repository's `aliases` and `choose_main_printing` helpers. It does not fill in absent bonus-sheet metadata or resolve unsupported modes. This audit does not require card images.

```sh
python scripts/audit_context_representation.py \
  --set fra \
  --draft raw-data/partial-credit-context/draft.csv.gz \
  --draft-sha256 f9497000be929d3f8cef87be643dc0b010e406a966ece7d0fc05e5e8e0c4b43d \
  --game raw-data/partial-credit-context/games.csv.gz \
  --game-sha256 a350666bfd293bd14601105af0187f13353b16fa86e81307432a7b3a9a0bbfdc \
  --metadata research/data/fra-rules-context-2026-10-29.json.gz \
  --metadata-sha256 5dee48cee16adf09b5c1003c4ef9af88a4951e4c24e7f7ba47283e444b80dfd7 \
  --output artifacts/context/fra-context-audit.json
node scripts/audit_scoring_contracts.mjs > artifacts/context/scoring-contract-audit.json
python -m unittest discover -s tests -p test_context_representation_audit.py -v
```

Before a scoring release, compare a refitted explicit-mana/fixing challenger with v5 on source-distinct, blind contextual judgments. Include legitimate off-lane pivots as counterexamples. Track severe high-credit mistakes, defensible alternatives receiving too little credit, unsupported metadata and uncertainty by set and pick stage. Preserve old results under their recorded versions. See the [partial-credit experiment plan](PARTIAL-CREDIT-CONTEXT.md).
