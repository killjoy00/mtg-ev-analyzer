# Pool-aware v7: assessment readiness and release gates

Status: historical development only. No final assessment labels opened, no candidate promoted. Research issue #1863; draft PR #1864. The fixing variants and independent-review sampling frame are running in the dedicated branch. All original v6 scoring and historical awards remain unchanged.

## 1. Freeze a candidate

Use the five completed development environments and predeclared fixing experiments. Compare against the same per-environment opportunity challenger and refitted v6 architecture. Prefer the simpler opportunity model unless new features demonstrate meaningful benefit without stage, ordinary-cohort, fixing, splash or three-color/Cube regressions. Do not choose separately optimized feature definitions after inspecting assessment data. Freeze one versioned feature recipe, per-environment coefficients, regularization, exact source and rules checksums, chronological windows, code hashes and scorer identity before scoring any independent labels. Do not freeze a coefficient file until actual fixing results have been reviewed. Cross-environment transfer and new-format fit need a separate development protocol; the current per-set fit is not a trained universal model.

## 2. Independent decision quality

The target of 500 source-distinct cases (100 per screening category) is a review frame, not proof of power. The reviewers independently rate each focal card in the complete pack and prior pool using the five ordinal quality bands. No model values, historical chosen cards, draft IDs, exact timestamps, outcomes, category or skill labels in the packet. Reviewers and adjudicator must attest to blindness and independence. Preserve exact reviewer-file checksums and sample hashes in a separate private review lock; never commit reviewer responses to this public repository. Adjudicate disagreements while model-blind and confirm actual categories; abstentions or unconfirmed screening cases do not satisfy quota. Add source-disjoint reserves using the same selection rules if needed, before scores are disclosed.

Only after the review files and candidate are locked, recreate the identical sample and derive a separate model-only score key using exact frozen archive/model identity. Neither historical selected cards nor independent judgments receive the trophy override in this comparison. Reviewers are judging underlying choice quality; the 100 trophy-match rule, 95 alternative cap and linear formula are unchanged in serving. No human labels may be synthesized or implied by automated rules screens.

Use scripts/pool_aware_quality_eval.py to verify review hashes, report ordinal agreement and paired intervals, and evaluate the preregistered primary quality thresholds:
- At least 500 independently qualified cases, 100 in each category.
- At least 25% relative reduction in questionable/poor choices receiving 90–95, and 20% relative reduction in excellent choices below 75. Report absolute rates too; both improvements require at least 20 baseline error events and a paired 95% risk-difference interval excluding zero.
- Good/excellent fixing/splash, early speculation/pivot and close-alternative guard: one-sided interpretation of upper two-sided 95% interval for increased sub-75 rate no greater than 5 percentage points, at least 50 qualified observations per guard. The margin and minimum-event count are researcher-selected conservative defaults, not user-approved deployment thresholds.
- Use assumed baseline error and discordance scenarios to calculate required conditional sample sizes before opening real reviewer labels. A total of 500 may be badly underpowered for the primary endpoints. No pass for inconclusive evidence, zero denominator, or missing categories.

The evaluation code is an offline contract, not authentication of human expertise. It returns a quality gate only; it cannot authorize release.

## 3. Truly unused final-assessment evidence

The retained original archives have already informed development and cannot be called an independent final assessment. Read only HEAD metadata for the five environments now; a changed ETag/size/date is merely a possible source of new evidence, and an unchanged pin cannot provide new rows. No archive contents or candidate labels may be opened as part of this inventory.

After freezing the candidate and protocol, acquire and checksum-pin a genuinely new public archive or prospectively held-out cohort. Prove new source-draft identity and draft time later than all sources used for prior fitting/evaluation, including any updated archive versions. Keep complete drafts together. Exclude any baseline training games occurring at or after their fit cutoff. Never use future outcomes or later pack contents as pick features. Compare frozen models on the same unseen rows, with separate strong and ordinary cohorts and source-draft clustered intervals. A new format needs separately frozen development fit or a validated cross-format transfer model; do not learn coefficients from its final-assessment rows.

Proposed final behavioral gates, to lock explicitly before assessment: no meaningful per-format raw log-loss regression (upper paired 95% bound <= +0.005), no meaningful top-1 loss (lower paired bound >= -1 pp), positive aggregate improvement, with Cube and three-color formats separately reported. Determine power and minimum sample using development variance, predeclare aggregation and missingness policy; do not weaken the criteria after seeing assessment results. If fresh Cube or other required data are unavailable, record the gap rather than replacing it with an already-used archive.

## 4. Release

No production scoring or corpus changes in this research PR. Only after independent quality evidence and genuinely unused final assessment pass may a separate reviewed rollout plan be prepared; preserve all historical accepted awards. Otherwise retain v6 or narrow the candidate and restart a new locked assessment protocol. No recurring services or new infrastructure are needed.
