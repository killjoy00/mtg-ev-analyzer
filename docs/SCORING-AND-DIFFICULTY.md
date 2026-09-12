# Draft Run scoring and difficulty

## Coverage verified on 2026-09-12

Import run [34563202962](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/34563202962) completed archive validation, development loading/gameplay, and production loading/gameplay. Production has 1,024,873 verified decisions from 95,730 trophy drafts across 32 expansion environments and Powered Cube; 1,003,025 decisions pass the interesting-decision filter, including 11,091 Cube decisions. Every serving set's count matches its completed import manifest.

The complete official Premier archive inventory was scanned, independently of the replay sample. The 33 serving archives' ETags and byte sizes still matched their import manifests during this review. This is complete processing of available public archives, not every draft ever played or every recent 17Lands draft. Of 95,748 quality-qualified trophies, 18 have no renderable decisions because of unresolved images (15 Cube, two TMT, one HBG). Those drafts remain explicitly excluded. Partial-prefix exclusions can also remove later decisions from an included draft.

## Partial credit: trophy-consensus-v2 (retained)

The product owner's settled rule is that the actual trophy pick earns 100. The other candidates receive:

`round(95 * selected_support / maximum_support_in_this_pack)`

| Choice | Points |
| --- | ---: |
| Actual trophy choice | 100 |
| Alternative with 100% of the leading support | 95 |
| Alternative with 90% of the leading support | 86 |
| Alternative with 80% of the leading support | 76 |
| Alternative with 50% of the leading support | 48 |
| Alternative with 20% of the leading support | 19 |
| Alternative with zero support | 0 |

The final result is the rounded arithmetic mean of ten integer pick scores. Every decision has equal weight. No depth penalty, square-root curve, or difficulty bonus applies. Near ties receive similar credit; card rank alone does not determine credit. When the trophy choice differs from the model leader, the leader still receives 95.

Support comes from `strong-player-pool-context-v2`: hierarchical card selection tendencies by pack/pick position, with shrinkage-adjusted co-pick context from the actual earlier pool. Training uses the broader elite cohort, not only trophy runs; the training limit is independent of trophy eligibility. Five-fold exclusion by draft ID prevents a source draft's own picks from training its grader. These are comparative model supports, not calibrated probabilities that a card is correct or estimates of win-rate loss.

The review retained the linear formula because it separates weak and uninformed choices without the inflation of the earlier square-root/0.75-power curves. A reproducible production SYSTEM sample (seed 17, 0.5% of blocks) contained 4,786 mixed decisions: uniform random selection averaged 42.61 and model-leader selection 97.74. The 49 Cube decisions in that sample averaged 48.63 and 97.35 respectively; that Cube sample is too small for a robust calibration conclusion. The baseline-corpus tests also verify strategy separation over complete balanced games. These strategy checks are not a substitute for player feedback on fairness.

Per-answer fields include `score`, `historicalMatch`, `consensusRank`, `selectedSupport`, `consensusSupport`, `supportRatio`, and `consensusCap`. Supports and card rankings are revealed only after locking the pick.

## Difficulty: support-ratio-v1

`rating = round(100 * runner_up_support / leading_support)`

| Rating | Band | Interpretation |
| --- | --- | --- |
| 0–49 | easy | One leading option has substantially more model support |
| 50–79 | medium | A meaningful alternative challenges the leader |
| 80–100 | hard | The leading options are closely matched |

Higher means more ambiguity. This scale is independent of the absolute support scale and of which card the trophy drafter selected. It estimates decision difficulty; it is not a measured human solve rate. Equal leading support is 100 difficulty, even when both choices earn excellent credit. Choosing a well-supported alternative and guessing the exact trophy choice are distinct outcomes.

Normalized support entropy (spread across the whole pack), top support gap, candidate count, pick number, and prior-pool size remain secondary reroll matching dimensions. They are not hidden bonuses or penalties in the pick score.

`target_support_ratio = trophy_choice_support / leading_support` is stored separately. A ratio below 0.20 sets `modelTargetDisagreement` in the locked answer. It identifies an unusual historical choice or a possible model blind spot, not proof that the trophy drafter was wrong. It does not turn the puzzle into a hard puzzle, remove it from eligibility, or change its score. The answer screen explains this disagreement. Do not expose target disagreement before answering.

## Ten-question composition and rerolls

New schedules and ordinary practice runs target **one easy, six medium, three hard**. Selection policy `first-pack-v2` puts the easy slot in the first six rounds and two of the hard slots in the final four. Each segment is deterministically shuffled. If an easy slot has no eligible puzzle, it becomes medium. Medium/hard shortages fail explicitly rather than silently creating an all-hard or easy-heavy game. Existing pick-depth windows, distinct source drafts, and preference for distinct expansion environments still apply. Practice selects uniformly among eligible sets; the Daily uses the modest recency weights documented in DATA-MANAGEMENT.md. A large archive does not dominate.

For each reroll:

- Preserve the difficulty band.
- Stay within 10 rating points of both the current puzzle and the original puzzle in that round. Two rerolls cannot drift repeatedly toward an easier choice.
- Preserve the round's pick window and stay within one pick of the current puzzle.
- Require the existing weighted shape distance to be at most 0.16: 35% pick-depth distance, 15% candidate-count distance, 25% top-gap difference, 15% entropy difference, and 10% prior-pool-size distance.
- Exclude every source draft already seen in the run. Set rerolls change expansion; pack rerolls retain it. Cube receives two pack rerolls and no set reroll.
- If no comparable replacement exists, return an error without spending the token.

This enforces at most one easy slot in the completed run, including replacements. Existing daily schedules, sessions, and friend packs retain their stored IDs and legacy reroll rules; their composition is not retrospectively changed. Newly generated schedules use the new policy. Legacy exceptions are versioned rather than silently rewritten.

## Storage, API, and rollout

`draft_run_puzzle_ratings` stores `puzzle_id`, `difficulty_version`, integer `rating`, `top_two_ratio`, `target_support_ratio`, and generated `band`. Its primary key is `(puzzle_id,difficulty_version)`. Ratings are derived beside the immutable puzzle payload. Migration 0008 installs an insertion trigger so future imports automatically receive ratings; `scripts/backfill_draft_run_ratings.mjs` fills existing rows resumably in bounded batches.

Sessions store `difficulty_version` and ten `difficulty_anchors`; daily schedules store `difficulty_version`. Unanswered puzzle API responses expose only `difficulty: {version,rating,band}` in addition to the existing public card data. They do not expose candidate supports, target-support ratio, source identity, or the answer.

Deploy sequence: apply migration on development, complete the rating backfill, check SQL/JavaScript rating parity and coverage, and test real gameplay. Then apply/backfill production before deploying the same backend code. The frontend tolerates older responses without a difficulty field. Rollback may restore the prior backend and frontend while leaving additive rating tables and columns in place.

Next calibration should use first-attempt human results: trophy-match rate, mean earned score, response time, reroll rate, and completion by difficulty band, pick depth, and environment. Separate QA/guest test sessions and model-target disagreement. Any future threshold or formula change gets a new version; historical scores are not silently rewritten.

Current source caps, set roles, retirement controls and the full per-set audit are documented in [DATA-MANAGEMENT.md](DATA-MANAGEMENT.md).
