# Frozen-context scoring validation

Freeze `strong-player-colour-stage-v3` as the context-model implementation for this experiment. The canonical predictor and its `v3-colour-and-pair` evaluation implementation must continue to agree in the existing parity tests. Input/model hashes accompany every measurement. Changing predictor code invalidates measurements and requires a rerun.

Recompute predictions from the six pinned September 16 draft/game archives: TMT, HOB, BLB, MSH, SOS and Powered Cube. Archive byte counts/checksums must match `results/scoring-2026-09-16/downloads.json`; an updated remote object must cause a visible failure. Source-draft train/validation partitions, the 5,000 training-draft cap, independent color-fit training provenance and experienced control cohort remain unchanged.

Re-run calibration, curve selection and assessment on their disjoint validation partitions. This is a reproducibility/development check against the final predictor, **not a new untouched temporal holdout**. The model was already studied on these archives. Report that limitation prominently.

The model is frozen: only its 0–95 partial-credit curve may be selected, with raw support-ratio powers {0.5, 0.75, 1, 1.25, 1.5}. The incumbent is this same final model at power 1. Old-model predictions remain diagnostic comparisons and cannot win curve selection. A candidate must improve paired eight-pick cohort separation with a 95% interval above zero and increase no measured set's strong-choice below-25 rate by more than one percentage point. Freeze the chosen curve before assessment; a failed assessment retains power 1. No fallback selection after viewing assessment.

Use exact first-eight serving windows (regular 1–8, Cube 2–9), current model difficulty bands, eight distinct sources per simulated run, and the 2-newest/4-previous-three/2-decay Daily selection helper. Evaluation set availability is restricted to the measured sets, so optional probabilities are renormalized within that smaller corpus. This is not a full-corpus production Daily replay. Run 2,000 paired runs per environment/partition and 200 source-draft bootstrap replicates with 500 runs each.

Probability calibration uses its own held-out partition and has no authority to alter awarded points. Curve powers apply to raw relative support. Displayed calibrated probabilities and relative displayed support are separate quantities.

**An exact historical trophy match always earns 100. Every non-historical choice is capped at 95, including a model-preferred alternative.** The underlying-quality cohort benchmark omits this override because its observed choices are diagnostic labels, not Pack One players replaying trophy targets. Runtime and corpus validation separately enforce the trophy override. No historical score/session/result is recalculated by this research.

No model or scoring promotion occurs merely because the workflow completes. Report observed results, retained/selected curve and material limitations before the reviewed backend release.
