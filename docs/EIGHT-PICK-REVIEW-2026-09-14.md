> Historical review. Current authority: [CURRENT-STATE](CURRENT-STATE.md) and [CHARTER](CHARTER.md). Superseded product behavior below is not a current requirement.

# Eight-pick follow-up review

Updated September 14, 2026. This follows the [initial detailed review](PRODUCT-REVIEW-2026-09-14.md). Trophy choices remain worth 100 and all existing game modes remain available.

Historical release record. The [September 15 serving/release follow-up](SERVING-REVIEW-2026-09-15.md) supersedes its deployment and remaining-work status; the measurements below describe the earlier release.

## Review of the intervening implementation

The intervening merged change was [PR 87](https://github.com/killjoy00/mtg-ev-analyzer/pull/87), a manual Neon deployment workflow and function manifest. At the start of this review, the live Neon project confirmed migrations 0012/0013 and production deployments `draftrunapi` 15, `pack1growth` 6 and `pack1api` 9. Health reported 920,629 eligible decisions across 33 environments, zero unrated decisions and no missing sets. Valid unauthenticated analytics submissions returned 401. The old report's pending-deployment claim was stale and has been corrected.

The workflow was useful but its original checks only identified a family of code, not an exact revision. It installed floating tooling versions and allowed development/production to deploy different main revisions. The follow-up pins tools, embeds a reviewed Git SHA in every bundle, verifies schema prerequisites, checks all three deployed revisions and tests both complete practice flows before promotion. A successful start alone does not validate grading, completion or old challenge compatibility. A full corpus health request took 15.64 seconds during inspection; it is no longer called merely to warm the homepage.

## Implemented changes

- New expansion Draft Run and Powered Cube practice/Daily schedules use eight independent decisions. Top 3 and Full Pack keep their existing contracts.
- Expansion Daily includes the three latest released eligible sets, using checked-in release dates verified against [Scryfall](https://api.scryfall.com/sets). As of September 14 these are The Hobbit (HOB, August 14), Marvel Super Heroes (MSH, June 26) and Secrets of Strixhaven (SOS, April 24). Missing mandatory coverage fails explicitly rather than substituting older sets.
- Five remaining slots weight the next three releases at 4, the next six at 2 and older sets at 1, while preferring distinct sets. Ordinary practice retains uniform eligible-set selection; Cube stays isolated.
- Difficulty targets one easy, five medium and two hard decisions. The final three contain no easy slot. The final regular round still reaches P1P8–10; Cube reaches P1P9–11.
- Required Daily sets are stored with the schedule and cannot be removed by a set reroll. Pack rerolls remain usable there; the different-set token stays available for other rounds.
- Migration 0014 permits both eight- and ten-pick sessions/schedules and corrects measurement completion/abandonment to use stored length. Completion, scoring, progress, result review, shares and friend invitations use that same length.
- Existing Daily schedules, reserved runs, old scores and exact friend packs are preserved. New entrants to an existing ten-pick Daily keep its original seed and version. Both September 14 Dailies already had answered attempts, so neither is rewritten.
- Homepage, public rules/scoring/privacy/methodology references, README and current product contracts describe the new behavior. Historical reports are labeled and linked forward.

## Verification and release

Local syntax, 119 JavaScript tests and 72 Python tests pass. Hydrated GitHub CI passed all 122 JavaScript tests, all 72 Python tests, dataset audits and all three deployment-bundle checks. New tests cover 100 deterministic Daily selections, release-date cutoffs, required-set shortages, historical weighting and eight/ten-pick scoring. The backend gate additionally exercises database/reference parity, guaranteed-set reroll protection, eight-pick completion/measurements and historical challenges on a disposable Neon branch. Browser gates cover both new flows and a historical ten-pick run.

[PR 88](https://github.com/killjoy00/mtg-ev-analyzer/pull/88) passed all three gates and merged as `ba82d0b95b1c90ef89b039eb98191e9164c136a3`. The backend gate passed exact eight/ten-pick selector parity, both complete game flows, account merge, request integrity, guaranteed-set protection, scoring, measurements and friend compatibility. The browser gate passed both new eight-pick flows and a historical ten-pick run. Migration 0014 is applied on development and production. [PR 89](https://github.com/killjoy00/mtg-ev-analyzer/pull/89) passed the same gates and merged as `76e9dca1c21f2122c051246476fdbc8c49aaf5ca`. The compatible Pages frontend was confirmed live before activating the eight-pick backend. A pre-eight-pick implementation is not a safe rollback target once eight-pick sessions exist. One isolated practice creation took 13.424 seconds while a reserved Daily resume took 0.146 seconds; those different paths are not comparable cold/warm samples and do not establish a production latency target.

## Deployment evidence

All three functions embed reviewed commit `76e9dca1c21f2122c051246476fdbc8c49aaf5ca`. The same prebuilt ZIP content was deployed in development and production through Neon. Migration 0014 is applied on both. No source data or historical schedule was rewritten.

| Function | Development deployment | Production deployment |
|---|---:|---:|
| `draftrunapi` | 18 | 16 |
| `pack1growth` | 4 | 7 |
| `pack1api` | 3 | 10 |

The isolated candidate and the merged development build each passed 34 HTTP checks: all three release markers, full corpus coverage, rejection of anonymous analytics, both complete eight-pick practice flows, pack rerolls, final-answer retries, correct averages and exact stored friend challenges. Production passed the same 34 HTTP checks. SQL confirms four private QA practice sessions: two completed runs, two unfinished friend starts, exactly two persisted career results and zero ranked sessions. Existing Daily schedules stayed untouched. The [release evidence and timings](audits/eight-pick-release-2026-09-14.json) retain the verification details.

Both September 14 production Daily schedules remain `first-pack-v2` with ten picks because answered attempts already existed. New practice runs use eight immediately; newly generated Dailies use eight, beginning September 15 at midnight Eastern. Historical friend links keep the sender's length.

| Acceptance environment | New mixed practice | Mixed friend | New Cube practice | Cube friend |
|---|---:|---:|---:|---:|
| Isolated | 17.49s | 6.99s | 7.32s | 6.92s |
| Development | 19.11s | 5.72s | 6.40s | 5.44s |
| Production | 20.52s | 6.35s | 7.53s | 6.09s |

These are one-pass request times from the review environment, including client/proxy transit, function work and database work. They are not controlled cold/warm comparisons or a representative load test. Mixed creation remains the slow path; the bounded selector still scans eligibility groups. Do not claim sub-second starts or a proven retention improvement.

The manual GitHub release workflow was reviewed and its bundle/schema components passed CI. This promotion used Neon's API; the revised manual workflow was not separately dispatched.

## Remaining work

- Validate native iPhone sharing, card legibility and authentication on real devices.
- Trusted ingress/session-creation quotas and a first-party cookie/revocation design remain separate infrastructure work; per-player database quotas do not stop unlimited guest identities.
- Use non-QA first-attempt observations for difficulty, timing and retention decisions. The production inspection found 243 observed decisions from 21 non-QA player IDs; these are not verified unique humans and do not establish retention or support robust threshold calibration. The previous report's hypotheses remain unproven.
- Refresh release dates, display names and eligible corpus coverage when adding a set. The guarantee uses registered released sets, not automatic discovery of unpublished data.
- Investigate uneven new mixed-run start latency and perform representative load tests before claiming a latency target. The database selector is bounded, but it still performs corpus-wide group counts.
- Choose-your-sets practice and verified competition policy remain explicitly unimplemented. Existing modes and trophy scoring are fixed.
- **Completed September 15:** the temporary Neon branch `review-eight-picks-20260914` (`br-old-base-aybckkbe`) was deleted after user confirmation, and its absence was verified. No restorable copy of its disposable QA data was retained. Production data and this report's saved evidence were unaffected. CI branches use their existing automatic cleanup.
