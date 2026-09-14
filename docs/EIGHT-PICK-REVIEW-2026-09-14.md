# Eight-pick follow-up review

Updated September 14, 2026. This follows the [initial detailed review](PRODUCT-REVIEW-2026-09-14.md). Trophy choices remain worth 100 and all existing game modes remain available.

## Review of the intervening implementation

The intervening merged change was [PR 87](https://github.com/killjoy00/mtg-ev-analyzer/pull/87), a manual Neon deployment workflow and function manifest. The live Neon project confirms migrations 0012/0013 and production deployments `draftrunapi` 15, `pack1growth` 6 and `pack1api` 9. Health reports 920,629 eligible decisions across 33 environments, zero unrated decisions and no missing sets. Valid unauthenticated analytics submissions return 401. The old report's pending-deployment claim was stale and has been corrected.

The workflow is useful but its original checks only identify a family of code, not an exact revision. It also installs floating tooling versions and allows development/production to deploy different main revisions. Those release controls need strengthening. A successful start alone does not validate grading, completion or old challenge compatibility. A full corpus health request took 15.64 seconds during inspection; it is no longer called merely to warm the homepage.

## Implemented changes

- New expansion Draft Run and Powered Cube practice/Daily schedules use eight independent decisions. Top 3 and Full Pack keep their existing contracts.
- Expansion Daily includes the three latest released eligible sets, using checked-in release dates verified against [Scryfall](https://api.scryfall.com/sets). As of September 14 these are HOB, MSH and SOS. Missing mandatory coverage fails explicitly rather than substituting older sets.
- Five remaining slots weight the next three releases at 4, the next six at 2 and older sets at 1, while preferring distinct sets. Ordinary practice retains uniform eligible-set selection; Cube stays isolated.
- Difficulty targets one easy, five medium and two hard decisions. The final three contain no easy slot. The final regular round still reaches P1P8–10; Cube reaches P1P9–11.
- Required Daily sets are stored with the schedule and cannot be removed by a set reroll. Pack rerolls remain usable there; the different-set token stays available for other rounds.
- Migration 0014 permits both eight- and ten-pick sessions/schedules and corrects measurement completion/abandonment to use stored length. Completion, scoring, progress, result review, shares and friend invitations use that same length.
- Existing Daily schedules, reserved runs, old scores and exact friend packs are preserved. New entrants to an existing ten-pick Daily keep its original seed and version. Both September 14 Dailies already had answered attempts, so neither is rewritten.
- Homepage, public rules/scoring/privacy/methodology references, README and current product contracts describe the new behavior. Historical reports are labeled and linked forward.

## Verification and release

Local syntax, 119 JavaScript tests and 72 Python tests pass. Three distribution-dependent JavaScript files are checked in hydrated GitHub CI. New tests cover 100 deterministic Daily selections, release-date cutoffs, required-set shortages, historical weighting and eight/ten-pick scoring. The backend gate additionally exercises database/reference parity, guaranteed-set reroll protection, eight-pick completion/measurements and historical challenges on a disposable Neon branch. Browser gates cover both new flows and a historical ten-pick run.

Promotion and final CI/deployment evidence will be recorded after gates pass. Apply migration 0014, deploy the compatible frontend, then activate the new backend. A pre-eight-pick implementation is not a safe rollback target once eight-pick sessions exist.

## Remaining work

- Verify the staged release and exact deployed revisions; update this report with the result.
- Validate native iPhone sharing, card legibility and authentication on real devices.
- Trusted ingress/session-creation quotas and a first-party cookie/revocation design remain separate infrastructure work; per-player database quotas do not stop unlimited guest identities.
- Use non-QA first-attempt observations for difficulty, timing and retention decisions. The previous report's retention hypotheses are not established by a code review.
- Refresh release dates, display names and eligible corpus coverage when adding a set. The guarantee uses registered released sets, not automatic discovery of unpublished data.
- Choose-your-sets practice, verified competition policy and production load testing remain explicitly unimplemented. Existing modes and trophy scoring are fixed.
