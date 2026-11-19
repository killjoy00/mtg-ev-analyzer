# Frozen v3 scoring validation, 2026-09-18

Decision: keep the linear raw-support curve for the frozen v3 context model in regular and Cube play. Exact trophy matches remain 100; all alternatives remain capped at 95. The report’s “retain incumbent” means the **frozen v3 linear baseline**, not reverting to the older v2 predictor.

[Protocol](SCORING-PROTOCOL.md), [complete report](scoring-report.json), [workflow](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/35350883338), revision `9876dd93ae7c914e05b149807e16c816c278f027`. Six pinned source archives, exact model implementation hashes, disjoint source-draft calibration/selection/assessment partitions within a reused development sample. This is not an untouched final temporal test.

Each environment used 2,000 simulated eight-decision runs and 200 clustered bootstrap draws (500 runs/draw). The fixed v4 composition is renormalized to the available five regular test sets plus Cube, not a replay of the full production corpus. Trophy overrides are excluded only from the underlying-quality benchmark, never from gameplay.

## Model and score are separate

On 20,297 assessment picks, raw v3 log loss improved by 0.13801 versus v2 (95% interval −0.14141 to −0.13448), top-1 improved by 2.478 percentage points (+2.053 to +2.983). That predictive gain is distinct from separation between experience cohorts in a score benchmark. The frozen v3 linear run AUC was 0.60291 regular and 0.59155 Cube; diagnostic v2 linear AUC was 0.62435 and 0.60397. This study does not claim every grade-separation metric improves with v3. Softer/harder v3 curves did not meet the predeclared rule for replacing the linear baseline.

The sampled raw-support benchmark (without trophy override) averaged 75.372 for the elite cohort in regular v3 versus 76.722 for v2, and 72.056 in Cube versus 74.268. Publishing v3 therefore changes model evidence and may change future alternative scores even though the curve stays linear. Old results and pinned Daily/shared sessions retain their old corpus/scoring identity.

## Probability calibration

The separate development fit selected exponent 1.5 for v3, versus 2.0 for v2. This is not a score exponent. Existing v7 display sharpening remains 1.75; this release does not silently promote a new probability calibration. The report’s `current_display_exponent_2` diagnostic applies exponent 2 to both models and must not be described as the actual v7 display configuration. A dedicated probability-calibration promotion requires versioned review.

## Production decision

Use the completed `strong-player-colour-stage-v3` corpus with linear 0–95 partial credit; do not reinterpret the 100-point trophy rule or retrain the existing complete corpus. Preserve historical v6 data and already-generated Dailies. Deployment follows complete manifest/signature verification and the reviewed development-to-production path.
