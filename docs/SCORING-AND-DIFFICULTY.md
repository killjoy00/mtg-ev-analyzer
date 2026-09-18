# Scoring and difficulty

**100 = you matched the trophy drafter. Other choices receive partial credit based on how strongly the model supports them.** Model disagreement never changes that target.

An alternative receives `round(95 × selected raw model support / strongest raw model support)`, capped at 95. The [six-source frozen-model calibration](../results/rebuild-2026-09-18/SCORING-RESULTS.md) retained that linear curve for both environments. Any future curve change requires explicit versioning and evidence from the exact final model. The run result is the rounded mean of eight integer scores; historical runs retain their original denominator and recorded results.

Probability calibration and score calibration are separate. Displayed calibrated support need not have the same ratio as raw grading evidence. Do not present displayed percentages as a direct score conversion. Current v7 display sharpening remains 1.75; the scoring study's separate probability fit is not an automatic probability-calibration promotion.

`support-ratio-v1` rates ambiguity as `round(100 × runner-up support / leading support)`: easy 0–49, medium 50–79, hard 80–100. This is not measured human solve rate. Target/model disagreement is separate and explained only after locking.

New runs target one easy, five medium and two hard decisions. Easy belongs in the first five and a hard decision in the final three; unavailable easy can become medium, while medium/hard shortages fail. All questions count equally.

Unshared practice rerolls preserve band, stay within ten rating points of both original/current choices, retain source pick windows, exclude seen source drafts and satisfy existing matching distance. Regular random practice has one set and one pack reroll; Cube/custom practice has two pack rerolls. Dailies and exact shared recipients have none.

Each source draft is excluded from its own model fold. Source qualification, predictive calibration, partial-credit calibration and [human decision measurements](DECISION-MEASUREMENTS.md) are separate checks. No QA samples or model-agreement statistic establishes objective correctness.
