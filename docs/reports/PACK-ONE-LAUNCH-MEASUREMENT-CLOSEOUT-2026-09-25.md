# Pack One launch measurement closeout — 2026-09-25

## Outcome

The Pack One launch-measurement release is implemented, merged, deployed and accepted in production.

PR #505, **Pack One launch attribution, habit metrics, cues, and previews**, merged as exact application revision:

`572f36638a780f73a41a548eb07e3101ea2efed5`

GitHub Pages serves the browser-side release, and development and production Neon Functions now serve that same reviewed application revision. Launch attribution capture, Daily habit reporting, the session-derived Daily streak, reset cue and Privacy disclosure are live. PR #505 initially shipped malformed literal `\\n` text in the homepage social metadata; PR #515 subsequently corrected that regression and the fixed homepage was redeployed before this closeout was finalized.

No schema migration was introduced by PR #505. During promotion, the release verifier correctly found a previously reviewed mobile schema prerequisite that had not yet been promoted: `0038_mobile_practice_idempotency.sql`. That prerequisite was applied and verified in development and production before the exact #505 application revision was deployed.

## What shipped

### Acquisition attribution

The browser records best-effort `acquisition_touch` events. It does not enforce one acquisition event per browser identity. First-touch reporting is created server-side by selecting the earliest qualifying acquisition event associated with the player identity.

It accepts sanitized:

- `utm_source`;
- `utm_campaign`;
- optional `utm_medium`.

Each acquisition value is converted to a string, trimmed, lowercased, and then accepted only if it matches `/^[a-z0-9][a-z0-9_-]{0,39}$/`, so valid values are 1–40 characters inclusive. Malformed manually constructed UTM values such as `launch week`, `r/magictcg`, or a 41-character value are rejected/dropped after normalization.

If no UTM source is present, an external referrer hostname may be used as the source. Attribution parameters are removed from the address bar after capture.

The existing Daily result-share path remains intact. A marked `ref=result_share` arrival is still measured by the established share funnel and is attributed as `result_share`.

First-touch reporting uses the earliest acquisition event associated with the merged player identity. Existing product activity that predates acquisition tracking is labeled `pre_tracking`; post-launch activity with no captured source is labeled `direct`.

### Daily habit cohorts

The owner report now derives habit metrics from completed `draft_run_sessions`, not from best-effort browser events.

A habit day is a distinct stored Pacific Daily date with at least one completed Mixed, Powered Cube or Latest Set Daily. Completing multiple Dailies on one date still counts as one habit day.

The report adds:

- **First-Daily people** — people whose first real Daily falls in the selected cohort window;
- **Next-day return** — completed a Daily on the next Pacific date;
- **7-day return** — completed a Daily during the seven-day follow-up window;
- **3-in-7** — completed Dailies on at least three distinct dates in the first seven-day window;
- **Ever 3-in-7** — lifetime observed status as of report generation;
- **3-in-7 daily health** — rolling count of people with at least three distinct Daily dates in the trailing seven Pacific dates.

Linked accounts collapse to one person after identity merges. Guests remain browser/player identities. Measurement QA sessions, QA-pattern display names and admin-linked players are excluded.

Fixed-window rates use only cohorts whose full observation period has closed. The UI shows numerator, mature denominator and immature cohort count so recent users are not incorrectly counted as non-returners.

### Player-facing Daily habit cue

The Daily status response now includes `daily_streak`, derived from consecutive completed Daily dates for the current player identity. It works for guests and linked accounts.

After a Daily result, and on the Daily home after all three Dailies are complete, the browser shows:

`New Dailies in …`

When the current streak is at least two days, it appends:

`· N-day streak`

The countdown follows the next Pacific Daily boundary and is covered for both 23-hour and 25-hour daylight-saving transitions. Practice results do not show the Daily cue.

### Social previews and privacy

PR #505 added evergreen Pack One launch copy, a large Twitter/X card, and first-party Open Graph images. It also initially shipped literal `\\n` characters around the homepage social metadata, which could move metadata out of the parsed `<head>` and render stray text.

PR #515 fixed that regression and merged as `2b6640e81624e3715158833a9abef545ff4420f6`. Its PR gates passed test **36144018422** and E2E **36144018028**; the E2E asserts that `og:image`, `twitter:card`, and `canonical` remain inside the parsed `<head>`. GitHub Pages then deployed that exact merge in run **36144465725**, and post-deploy production smoke **36144467337** successfully fetched the live Pack One homepage. The final deployed source no longer contains the literal-`\\n` pollution.

The Privacy page now discloses campaign attribution and external referrer-host collection.

### CI coverage

The backend gate now runs `tests/measurement-report-math.mjs` as part of PR CI.

Coverage includes:

- UTM sanitization, capture and URL cleanup;
- external-referrer fallback;
- unchanged result-share behavior;
- first-touch retention semantics;
- `direct` and `pre_tracking`;
- QA/admin exclusions;
- merged-account identity behavior vs guests;
- same-date multi-Daily de-duplication;
- mature vs immature cohorts;
- 3-in-7 calculations and rolling health;
- Daily-only streak/reset cue;
- 25-hour Pacific DST fall-back behavior.

## Verification before release

Final PR #505 gates all passed:

| Gate | Run |
| --- | --- |
| Test | **36090708568** |
| Browser / E2E | **36090708576** |
| Isolated Neon backend schema/integration | **36090708642** |

After merge, the exact merge commit also passed:

| Gate | Run |
| --- | --- |
| GitHub Pages deployment | **36091056841** |
| Test | **36091057812** |
| Browser / E2E | **36091057794** |
| Production smoke against the then-current backend | **36091057833** |

The post-merge production smoke proved the browser release and existing production contract. It did not by itself deploy the new Functions code, so the explicit development-to-production backend promotion was still required.

## Release chain

| Step | Evidence |
| --- | --- |
| Feature merge | PR #505 → `572f36638a780f73a41a548eb07e3101ea2efed5` |
| Homepage social-metadata regression fix | PR #515 → `2b6640e81624e3715158833a9abef545ff4420f6`; test **36144018422**, E2E **36144018028**, Pages **36144465725**, production smoke **36144467337** |
| Initial development deploy attempt | run **36135364368** — correctly blocked on missing reviewed schema prerequisite |
| Development `0038_mobile_practice_idempotency.sql` promotion + schema verification | run **36135530668** |
| Development exact-revision deploy + acceptance | run **36135592650** |
| Production `0038_mobile_practice_idempotency.sql` promotion + schema verification | run **36135854742** |
| Production exact-revision deploy + acceptance | run **36135923047** |

The initial development deployment did not modify application runtime because schema verification failed before upload. Its failure exposed a release-baseline issue rather than a #505 product defect.

The missing prerequisite was a previously reviewed additive mobile migration. It adds practice-start idempotency hashes, their shape constraint and a unique partial index. The same migration file from the reviewed release revision was then applied first to development and later to production, with the repository schema verifier passing each time.

The prerequisite migration itself did not run through an existing reviewed migration workflow. A temporary branch workflow checked out the reviewed release commit, obtained the target Neon connection, and ran `psql` directly against the target Neon branch. The repository already contains reviewed migration patterns such as `.github/workflows/pack-one-season-hardening-migration.yml`, but that was not the mechanism used for this prerequisite.

A separate temporary branch-only push dispatcher was used to invoke the repository's existing reviewed Functions deployment workflow. It never merged to `main` and was removed after promotion. The Functions deployments ultimately ran through `.github/workflows/deploy-functions.yml`, including its exact-revision and acceptance protections.

## Production acceptance

Production deployment run **36135923047** completed successfully.

It:

- checked out exact application revision `572f36638a780f73a41a548eb07e3101ea2efed5`;
- verified production schema prerequisites;
- required the identical revision to have already passed development acceptance;
- verified the compatible published frontend before production upload;
- built and checked all Function bundles before deployment;
- deployed the checked bundles without rebuilding them during upload;
- waited for stable release markers;
- completed all three unranked Daily flows;
- checked `pack1api`, `pack1growth` and `draftrunapi` health;
- queried current-season leaderboards for Mixed, Powered Cube and Latest Set;
- completed the final acceptance step successfully.

The corresponding development release smoke passed in run **36135592650**.

## Measurement boundaries

These tools are intended to support product decisions, not manufacture precision from small samples.

- Acquisition events are browser-side and therefore best-effort; completed Daily sessions are the authority for habit outcomes.
- First-touch attribution is persistent by person/browser identity. A later campaign visit does not rewrite an earlier first touch.
- `pre_tracking` is expected for people whose product activity began before acquisition tracking.
- `direct` is expected when a post-launch person has no captured source.
- A missing campaign is displayed as `(none)`.
- Next-day, 7-day and 3-in-7 rates should be compared only with their mature denominators.
- `Ever 3-in-7` can rise after the original cohort window and is not a fixed-window conversion rate.
- `3-in-7 daily health` is a rolling health count, not a cohort conversion percentage.
- The existing Daily result-share funnel keeps its prior definition and should be read separately from first-touch attribution.
- The first launch cohorts will be sparse. No scoring, difficulty or trophy-pick rule changes are implied by this release.

## Final state

As of this closeout:

- PR #505 is merged;
- browser attribution capture and the Daily reset cue are live;
- the #505 literal-`\\n` homepage social-metadata regression was fixed by PR #515, and the corrected static metadata is deployed;
- the reviewed mobile practice-idempotency schema prerequisite is present in development and production;
- development and production Functions serve exact revision `572f36638a780f73a41a548eb07e3101ea2efed5`;
- production acceptance run **36135923047** is green;
- the admin Daily habit cohorts and `daily_streak` backend response are live in production;
- the known #505 social-metadata regression is closed by #515; no known launch-measurement release blocker remains in the final post-fix state.

For day-to-day use, see [Launch measurement owner guide](../LAUNCH-MEASUREMENT-OWNER-GUIDE.md).
