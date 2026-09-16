# Automated scoring validation

Pack One can fit and evaluate scoring from observed drafts without commissioning human grades. The target of the present model is the choice distribution of experienced, high-win-rate drafters, conditioned on the cards offered and the prior pool. That is a useful, testable target. It is not a probability that a card is the uniquely correct pick, nor an estimate of the match wins a different pick would have caused.

## Separate the predictor, displayed percentage, and points

For a model's raw support `q`, display `p = q^T / sum(q^T)`. Fit `T` on a calibration partition by log loss. Evaluate the resulting percentages on other drafts, including calibration for the second- and third-ranked candidates; an all-card average can hide errors in these important alternatives among many low-probability cards.

For non-trophy credit use the separately evaluated curve:

```
score = Math.round(95 * (q_selected / q_leader)^gamma)
      = Math.round(95 * (p_selected / p_leader)^(gamma / T))
```

Production currently corresponds to raw `gamma = 1`, displayed `T = 2`, and a displayed-ratio exponent of `0.5`. Changing display calibration need not change any points. Changing the predictor changes support ratios and therefore can change points even with the same curve. The comparison must measure those changes rather than infer them from improved top-1 accuracy.

The existing historical trophy choice still receives 100. This is a product rule, separate from model quality. Evaluating observed picks through that override would award every reference choice 100 and make the evaluation useless. The automated benchmark therefore measures underlying model credit, capped at 95, for all observed choices. It reports candidate-wide point movement separately.

## Three development partitions, then a frozen assessment

The original draft hash split remains 60% train / 15% validation / 25% test. Inside validation, a second independent stable hash assigns whole drafts to calibration, curve selection, or assessment. All picks in a draft stay together. Player identifiers are unavailable, so this does not establish generalization to unseen players.

1. Train both behavior models on the same hash-ordered training prefix. Fit the color tables using only the elite training split. Table schema 2 binds each table to the source cache, compressed picks and exact train IDs. Old, mismatched, or held-out tables must be regenerated.
2. Fit one display exponent per model on calibration-role elite drafts.
3. Select the raw scoring curve on selection-role drafts, using the rule in the committed experiment protocol.
4. Freeze that selection before calculating assessment metrics. Check the selected curve on assessment-role drafts. Do not select a different curve because it looks better there.

These are development partitions of historically used validation data. They are not newly untouched data. The original six-set Decision 1 artifact also remains historical: its documented unknown-color defect was part of the candidate actually tested. A pass for that artifact does not certify subsequent changes.

`eval_model.py awards` now fits temperatures on validation:calibration and measures awards/log loss on validation:assessment. A final-test invocation requires an explicit frozen `--calibration-in` artifact in addition to `--split test --final-test`; model, cap and input identities must match. It cannot fit a new temperature grid on test. `scoring_experiment.py report` rejects test measurements entirely.

## What the eight-pick experiment measures

Compare experienced elite drafters with an equally experienced, lower-win-rate control cohort. Both cohorts use only the requested split. Sample eight distinct source drafts per synthetic run, matching set, pick window and the incumbent model's difficulty band across cohorts. Every curve scores the same sampled choices, so comparisons are paired.

The profile generator imports the game's current pick windows, eight-pick difficulty composition, required latest Daily sets and set weights. Mixed and Powered Cube are measured separately. It uses a minimum of five available observations in each cohort per state cell, reports incomplete coverage, and refuses a result if more than 10% of runs or bootstrap replicates cannot be formed.

Primary curve metric: the probability that a sampled elite-cohort run scores higher than a sampled control-cohort run, with ties counting half (AUC). This evaluates eight-pick score ordering, where a nonlinear per-pick curve can change the ordering of totals. AUC on individual picks alone would largely be unchanged by monotone curves.

The protocol also limits how much a curve may increase very low credit for observed strong-player choices. That limit is an explicit product tolerance, not a statistical fact. Prediction metrics, severe tails, rarity/pick/pool breakdowns, candidate-wide point movement and within-set-and-skill outcome correlations are reported alongside it.

Confidence intervals resample the **source drafts**, stratified by set and cohort, and regenerate runs with the same profiles across configurations. Simulated runs are not treated as independent new observations. These intervals condition on the fitted training models; they do not measure variation from retraining the predictor or shifts to a future format. With 200 bootstrap replicates this is a development screen, not a high-precision release noninferiority study.

The simulation uses observed choices in matched state distributions, not choices by the same people facing the same packs. It does not claim to reproduce production's trophy-only puzzle selection, actual player leaderboard reliability, or causal drafting skill. This six-set sample restricts Daily scheduling to its available sets. That limitation is printed in the protocol instead of silently presenting a whole-product result.

## Reproduce the September 16 experiment

The exact archives, SHA-256 hashes, protocol, commands and report live in `results/scoring-2026-09-16/`. From the repository root:

```bash
python results/scoring-2026-09-16/run.py --workers 3
```

This downloads the pinned public 17Lands archives, checks their hashes, rebuilds caches and train-only color tables, scores validation, and produces the report. If a public object has changed, it fails rather than substitutes different data. Work files go under `generated/scoring-20260916/` and are not committed.

To rerun only scoring after preparation, or only reporting after measurement:

```bash
python results/scoring-2026-09-16/run.py --phase measure --workers 3
python results/scoring-2026-09-16/run.py --phase report
```

Matching complete measurements can be resumed; changed model code, cache, fit, archive, cap, or split forces remeasurement. Color tables use all eligible training drafts even when the behavior counts are capped at 5,000; both counts are recorded. Control extraction is capped at 6,000 drafts before split selection.

No command in this experiment deploys code, changes the published corpus, or rewrites past scores. A shipping change must carry the fitted tables and calibration as versioned build inputs and preserve reproducible grading for existing puzzles. GIH/IWD blending is outside this experiment: the evidence supplied for Decision 2 does not support adding it.

## Interpretation and next model work

Do not turn a predictive improvement into a claim that all disagreements with the model are errors. Near alternatives and specialist preferences belong in the probability distribution. Do not infer from a failed GIH/IWD blend that all future outcome modeling is useless, or that the stage confound is proven to be the unique cause of the reversal; that would need a controlled ablation on the same cohort and observations.

After the current candidate is evaluated, the next useful model experiments are hierarchical base-rate pooling and direct choice modeling with simple color/context features. Validate actual card metadata against inferred color affinity, particularly for gold cards, hybrid costs, fixing and colorless cards. Sparse or missing context should reduce confidence rather than invent support. Each experiment should preserve the same split discipline and compare points as well as predictive metrics. None requires a new manual labeling project.
