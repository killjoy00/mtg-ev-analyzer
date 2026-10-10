# Documentation map

Start with [CURRENT-STATE](CURRENT-STATE.md) for verified deployment boundaries, [CHARTER](CHARTER.md) for the product, and the [Pack One brand and marketing asset guide](../assets/brand/README.md) for identity, fonts, colors, logos, and distribution artwork.

**Current mobile release reference (October 10):** [iOS 1.1 exact-build feature and release inventory](mobile-ios-1.1-testflight-inventory-2026-10-10.md) distinguishes what is in signed iOS 1.1 TestFlight build 100733, what's blocked by pending backend fixes, and what's **not** an App Store release. Pair it with [#575](https://github.com/killjoy00/mtg-ev-analyzer/issues/575), the [mobile runbook](mobile-release-runbook.md), [store submission packet](mobile-store-submission.md), and [native parity inventory](mobile-parity-inventory.md).

- [Corpus/selection](DATA-MANAGEMENT.md), [Corpus Operations](CORPUS-OPERATIONS.md), [card-image maintenance](CARD-IMAGE-MAINTENANCE.md), [Traditional admission/publication](TRADITIONAL-PUZZLE-ADMISSION.md)
- [Scoring](SCORING-AND-DIFFICULTY.md), [decision measurements, launch attribution, and Daily habit cohorts](DECISION-MEASUREMENTS.md), [launch measurement owner guide](LAUNCH-MEASUREMENT-OWNER-GUIDE.md), [campaign links owner guide](CAMPAIGN-LINKS-OWNER-GUIDE.md)
- [17Lands policy](17LANDS-DATA-REVIEW-2026-09-18.md)
- [Rebuild audit](REBUILD-2026-09-18.md), [rebuild release/runbook](REBUILD-RELEASE.md), [Traditional results](../results/rebuild-2026-09-18/TRADITIONAL-RESULTS.md), [scoring results](../results/rebuild-2026-09-18/SCORING-RESULTS.md), [Daily distribution](../results/rebuild-2026-09-18/DAILY-DISTRIBUTION.md)
- [Design system](DESIGN-SYSTEM.md), [canonical brand and marketing assets](../assets/brand/README.md)
- [Admin/Owner operations](ADMIN-OWNER-OPERATIONS.md), [one-time Owner bootstrap/recovery boundary](ADMIN-OWNER-BOOTSTRAP.md), [backend operations](BACKEND-RELIABILITY.md), [request integrity](REQUEST-INTEGRITY.md), [CI and merging](CI-AND-MERGING.md), [remaining work](ROADMAP.md)

Dated earlier reviews are historical evidence. Superseded core documents are retained in [the archive](archive/pre-rebuild-2026-09-18/). Earlier reproduction notes do not authorize restoring retired products or old selection/sharing rules.

## September 19 closeout reports

- [Handoff closeout audit](reports/HANDOFF-CLOSEOUT-2026-09-19.md): completed requirements, live release evidence and open acceptance boundaries.
- [Model and scoring report](reports/MODEL-AND-SCORING-2026-09-19.md): formulas, training, validation, measured results and the production fold-reference finding in issue #164.


## September 21 Traditional v4 release

- [Traditional v4 production release closeout](reports/TRADITIONAL-V4-RELEASE-2026-09-21.md): leakage-corrected v8/v4 revalidation, exact component identities, stage/publish run IDs, production serving state, blocked/deferred sets, preservation checks, and the required development-publication prerequisite.


## September 23 Pacific Daily and Neon scheduler release

- [Pacific Daily and Neon scheduler rollout closeout](reports/PACIFIC-DAILY-NEON-SCHEDULER-CLOSEOUT-2026-09-23.md): migration/deploy chain, production scheduler activation, five idle-confirmed startup measurements, and final operating boundary.
- [Neon scheduled maintenance](NEON-SCHEDULERS.md): active trigger definitions, identity boundary, recovery workflow, activation and rollback.


## September 27 launch-monitoring reliability hardening

- [Launch-monitoring reliability closeout](reports/LAUNCH-MONITORING-RELIABILITY-CLOSEOUT-2026-09-27.md): delayed GitHub schedule root diagnosis, independent Neon watchdog design, protected credential boundary, CI/release chain, and production recovery evidence.
- [Launch operations](LAUNCH-OPERATIONS.md): current coverage-watermark, continuation, Neon stale-detection, authenticated recovery-dispatch, operator alerting, thresholds and incident runbook.
- [Neon scheduled maintenance](NEON-SCHEDULERS.md): production trigger definitions and the production-only launch-recovery credential boundary.


## September 25 launch measurement release

- [Pack One launch measurement closeout](reports/PACK-ONE-LAUNCH-MEASUREMENT-CLOSEOUT-2026-09-25.md): acquisition attribution, habit metrics, Daily streak/reset cue, CI coverage, schema-prerequisite catch, and exact development/production release evidence.
- [Launch measurement owner guide](LAUNCH-MEASUREMENT-OWNER-GUIDE.md): how to build tracked campaign links, read mature Daily cohorts, use 3-in-7 health, interpret source labels, and operate the new measurement tools.
- [Campaign links owner guide](CAMPAIGN-LINKS-OWNER-GUIDE.md): how to build tracked URLs, publish static `/go/<slug>/` routes, validate naming, retire links safely, and troubleshoot the Admin Link Builder.
- [Campaign links release closeout](reports/CAMPAIGN-LINKS-CLOSEOUT-2026-09-25.md): PR #518 scope, exact deployment evidence, static-route architecture, and final production boundary.
