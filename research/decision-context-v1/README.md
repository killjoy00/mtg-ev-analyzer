# Decision context v1: first executed results

**Decision: do not advance this challenger.** The frozen information screen did not demonstrate an overall improvement. Live v5 scoring and the trophy answer rule are unchanged. This is completed offline development work for #1427, not a production model release.

## What was built

- A deterministic 240-puzzle diagnostic sample across BLB, DSK, NEO, EOE and WOE, with 240 independent source drafts, separate blinded content and provenance keys, and representative versus targeted strata.
- An outcome screen on 42,431 complete, linked Premier draft histories across BLB, DSK and WOE. Each contributes exactly one P1P4–P1P8 decision.
- Three fixed Ridge models, train-only card-strength evidence, chronological purging, and metadata-only unseen-set diagnostics. Twelve focused contracts cover the data and feature boundaries.

## What the code audit established

The v5 grader uses stage-specific card choice tendencies, an averaged lift over candidate/pool-card pairs, and a color-commitment term. It already uses all qualified training drafts. It does not explicitly read rules text, curve, card roles, whole-pool synergy thresholds, or previously seen unselected packs. This identifies representational limits; it does not prove an error in any particular recommendation.

All 1,343 distinct card records across the five checked-in review samples lack oracle text. The new research separately pins public Scryfall snapshots. Lexical removal, fixing and synergy tags are limited proxies, not a complete Magic rules interpretation.

The representative sample has 49/120 v5-versus-historical disagreements; the targeted sample has 42/120. These are disagreements, **not mistake rates**. The representative sample is balanced by set and pick, not weighted like the production Daily. No human ratings have been collected and no puzzle-interest improvement is claimed.

## Frozen observed-action outcome comparison

The cleaned sample contains 25,445 fitting drafts, 8,460 validation drafts and 8,526 later-development drafts. Both held partitions remain historical development evidence, not newly untouched confirmation. Lower mean squared error (MSE, event-wins squared) is better.

| Model | Inputs | Later-development MSE |
|---|---|---:|
| B | Card strength and candidate metadata | 4.773228 |
| P | B plus aggregate pool composition | 4.773675 |
| C | P plus explicit candidate/pool interactions | 4.766534 |

Primary C minus P: **-0.007141 MSE**, paired 95% interval **[-0.014631, +0.000567]**. The roughly 0.15% lower average squared error is not statistically established. The interval includes zero, so the predeclared pass flag is false. No model family, threshold or feature was selected after viewing this result.

C versus P was inconclusive on the earlier validation partition as well. Duskmourn has a favorable later-development per-set interval; Bloomburrow and Wilds of Eldraine do not. Those slices are exploratory and are not independent confirmations.

All three models overpredict later event wins by about 0.19–0.20 wins on average. This calibration bias and player-skill confounding further limit use as a recommendation engine.

The approximate 80%-power detectable C-versus-P change is 0.010402 MSE. This is prediction-error resolution. It is **not** power to detect a gain in wins from changing a recommendation.

## Transfer with zero target-set evidence

Each transfer model trains only on the other two sets, without card identities or target-set aggregates. All GIH evidence is withheld from both source and target feature rows for this metadata-only diagnostic. No consistent improvement emerges. For Duskmourn, C is worse than the simple B baseline (MSE difference +0.0530; exploratory 95% interval +0.0097 to +0.0993). This does not support a cold-start recommendation claim. The retrospective design can train on sets released after the target; it is not a calendar-time release simulation.

## Data quality and metadata limitations

| Set | Complete linked drafts after purging | Selected choices without usable rules text, later partition |
|---|---:|---:|
| BLB | 14,267 | 2/2,868 (0.1%) |
| DSK | 14,290 | 295/2,872 (10.3%) |
| WOE | 13,874 | 650/2,786 (23.3%) |

Complex cards are explicitly flagged. Front/back, Adventure and Room text is not silently collapsed into a normal single-cost spell. Some bonus-sheet cards lack metadata. The resulting missingness is especially substantial for WOE and is a concrete limitation of this first representation. It is not established as the cause of the null result.

The source audit rejected two WOE drafts with conflicting pick-level outcome records. All sets exclude incomplete prefixes, unavailable target picks and incomplete linked game histories; completed fitting/validation drafts crossing the next time boundary are purged. NEO was replaced with WOE before fitting because the NEO game archive lacks game timestamps needed for that boundary check. Exact counts and hashes are in outcome-report.json.

## What this establishes, and the next useful test

This experiment measures whether additional features predict the outcomes of actions people actually took. It does not measure the value of unchosen cards, compare a learned policy against deployed v5, demonstrate causal improvement, or validate a new 0–100 score. Better outcome prediction alone would not do those things even if the screen had passed.

The next concrete representation task is to correctly model multi-part cards and draft bonus sheets, validate role extraction against the frozen diagnostic set, and predeclare a new test using fresh evaluation evidence. Do not tune this version against its spent later-development partition or restart the closed R-LCB search. A claim of improved winning decisions still needs a separately powered policy-evaluation design, preferably prospective randomized advice.

## Reproduce

```sh
python -m pip install -r research/card-strength-requirements.txt
python -m unittest discover -s tests -p test_decision_context.py -v
python scripts/decision_context_audit.py
python scripts/decision_context_experiment.py download
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python scripts/decision_context_experiment.py run
```

The downloader checks the existing official archive hashes and restores the pinned public metadata snapshots. Row-level data stays in ignored directories; the report is written to artifacts/decision-context-v1/report.json. Three source archives contain about 375,000 eligible completed drafts before the fixed 15,000-per-set sample; the headline 42,431 refers only to the analyzed cleaned sample.

Files: audit.json; review-blind.json.gz; review-key.json.gz; outcome-report.json; metadata/*.json.gz. Protocol: ../DECISION-CONTEXT-V1.md.

Attribution: [17Lands public datasets](https://www.17lands.com/public_datasets), CC BY 4.0; [Scryfall API](https://scryfall.com/docs/api) card metadata.
