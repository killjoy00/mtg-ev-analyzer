# Traditional puzzle inventory, frozen Premier v3 model

Predeclared before this experiment runs (18 September 2026). The owner authorized a separate decision about playable Traditional trophies. The earlier combined-training equivalence gate does not decide this question.

BLB, DFT, FIN and HOB are the original four sets. Reconstruct each frozen Premier-only supplement model from its exact public draft/game archive SHA256s, training cap, qualified cohort and five source folds. Require identical six-decimal supports on **every first-eight decision in the immutable v7 supplement**. Any mismatch stops the set. Keep the current model implementation, coefficients, 1.75 display exponent, raw-support linear partial-credit curve and trophy override unchanged. Reconstructing frozen sufficient statistics is not a model change or permission to rescore historical puzzles.

All Traditional 3-0 trophies must meet the existing >=100 games / top-15%-with-0.60-floor qualification standard, carry consistent outcomes and have a complete, internally consistent first eight picks. Compare against complete Premier 7-0/7-1/7-2 trophies. All eight picks are retained, so pick position is balanced. Traditional contributes **no** training picks, decks, colour estimates, pair counts or calibration fits. Give each Traditional draft one deterministic existing Premier fold model; Premier picks exclude their own fold. Thus Traditional and Premier use the same effective training-size distribution. No smaller Traditional training population can confound this experiment.

Unlike the four-training-model experiment, every Traditional trajectory is unseen by this fixed model and may be evaluated. The previous train/validation/test partition was for choosing models, not a requirement to discard 75% of an independent puzzle-inventory audit. No thresholds or model parameters are selected using these new measurements.

Operational gates, per set and separately at P1P7–P1P8:

| Check | Limit |
|---|---|
| Independent source trajectories | >=100 in each event |
| Top-choice confidence ECE at existing display exponent | <=0.15 and Traditional increase <=0.04 |
| Trophy/model disagreement increase | 95% source-bootstrap upper bound <=10 percentage points |
| Trophy raw-support score under 25 increase | upper bound <=3 percentage points |
| Mean trophy support-only score decline | lower bound >=-8 points |
| Non-trophy alternatives under 25 increase | upper bound <=5 percentage points |
| Non-trophy alternatives at 95 change | entire interval within +/-5 percentage points |
| Difficulty-band distribution total variation | <=0.15 |
| Otherwise complete Traditional trajectories unusable due to pack/metadata/image quality | <=5% |

These are product anomaly thresholds, not proof that decision policies are identical. They catch material scoring shifts without requiring combined training to be beneficial. Score-only diagnostics temporarily omit the trophy override to measure model support; **the actual historical trophy choice always scores 100**. Alternative distributions give each puzzle equal weight and each available alternative equal weight within its puzzle; they are not predictions of player behavior. Report log loss, top-1, mean rank, confidence/per-card calibration, difficulty and support diagnostics. Bootstrap by whole source draft, 500 deterministic draws. ECE and total variation are descriptive point gates; bootstrap intervals for the other gates are marginal, not simultaneous claims.

Repeat the card/set/pick-range/colour-commitment residual analysis using this frozen Premier model. A directionally consistent >=3pp category residual with intervals excluding zero in >=3 sets blocks automatic endorsement pending investigation. Report unmatched cells, metadata coverage, sparse categories and exploratory card-level results; absence of a detected pattern is not evidence about unmeasured categories. Require at least three passing sets to support the initial expansion; only individually passing sets may be considered for publication.

The script emits immutable Traditional puzzle candidates plus per-trophy accounting, source event/outcome/skill evidence, archive/model signatures and quality reports. IDs include the Traditional event and component revision. The separate component revision does **not** change the v3 model label or overwrite v7 puzzles. Every source 3-0 trophy is accounted for, including unqualified and broken trajectories. Candidate files have no automatic serving authority. Publication must use the authenticated corpus lifecycle and preserve already-created schedules, sessions and shares. The later serving implementation must explicitly compose published components without duplicating or rebuilding Premier evidence.

Initial production monitoring must split source event for observed scores, model/trophy disagreement, difficulty, abandonment and reports. A passing offline check does not imply observed gameplay equivalence.

Implementation correction before completed four-set assessment: frozen importer b00e468 ignored loss changes when comparing source metadata. Reconstruct that exact historical training/colour-exclusion population solely to verify stored scoring parity. Apply today's stricter outcome consistency and 7-0/7-1/7-2 rule separately to playable comparison sources, exporting an explicit source audit. This does not weaken current importer eligibility. Also apply the same (unchanged) scoring gates to the production interesting-puzzle subset, including its late picks; inspecting unservable decisions alone is insufficient. No existing gate is removed or relaxed.
