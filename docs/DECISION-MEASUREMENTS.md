# Decision quality reporting

The owner console lives at `/admin/`. Its API is authenticated separately from
anonymous player sessions: a live Neon account session must belong to
`pack1_admins`. A 256-bit private setup code can grant the initial owner access.
Only its SHA-256 hash is stored. Invitations expire after seven days and can be
claimed by one account; a retry by that same existing admin is safe. Codes and
account tokens must never be committed or sent in query strings. Revoking the
admin row immediately revokes report access, including through an old invitation.

## Collection

`draft_run_decision_observations` records a browser-visible decision keyed by
session and revision. A reroll closes that exposure and creates a new revision;
the replacement is counted only when rendered. Feedback and hidden tabs do not
start the next decision's timer. View calls are idempotent. Pick/reroll outcomes
are saved in the same database statement as the optimistic game update, so
retries and competing tabs cannot duplicate outcomes or detach them from scores.

Older clients can continue playing. Their outcome rows have `observed=false`
and are excluded from the primary report. Historical response times are never
fabricated. A browser view is evidence the page rendered a decision, not proof
that a human read every card or that every image finished loading.
View delivery is best-effort: locking a pick waits at most 1.5 seconds for its
view request, then proceeds. If the outcome wins that race, it remains explicitly
unobserved rather than being counted as a timed exposure.

The client reports foreground milliseconds, bounded to 30 minutes and checked
against server elapsed time with a five-second allowance. Reloads or multiple
view IDs for the same exposure make timing unavailable. Missing timing is null,
never zero. Client timing is descriptive and cannot affect game scores.

## Acquisition attribution

The browser records one best-effort `acquisition_touch` event on arrival through
the existing `/v1/events` path. `utm_source`, `utm_campaign`, and optional
`utm_medium` are trimmed, lowercased, and accepted only when they match
`^[a-z0-9][a-z0-9_-]{0,39}# Decision quality reporting

The owner console lives at `/admin/`. Its API is authenticated separately from
anonymous player sessions: a live Neon account session must belong to
`pack1_admins`. A 256-bit private setup code can grant the initial owner access.
Only its SHA-256 hash is stored. Invitations expire after seven days and can be
claimed by one account; a retry by that same existing admin is safe. Codes and
account tokens must never be committed or sent in query strings. Revoking the
admin row immediately revokes report access, including through an old invitation.

## Collection

`draft_run_decision_observations` records a browser-visible decision keyed by
session and revision. A reroll closes that exposure and creates a new revision;
the replacement is counted only when rendered. Feedback and hidden tabs do not
start the next decision's timer. View calls are idempotent. Pick/reroll outcomes
are saved in the same database statement as the optimistic game update, so
retries and competing tabs cannot duplicate outcomes or detach them from scores.

Older clients can continue playing. Their outcome rows have `observed=false`
and are excluded from the primary report. Historical response times are never
fabricated. A browser view is evidence the page rendered a decision, not proof
that a human read every card or that every image finished loading.
View delivery is best-effort: locking a pick waits at most 1.5 seconds for its
view request, then proceeds. If the outcome wins that race, it remains explicitly
unobserved rather than being counted as a timed exposure.

. Invalid values are dropped rather than normalized
into a different tag. Captured UTM parameters are removed from the address bar
with `history.replaceState`, so copying the current URL does not spread a
creator's campaign tag.

When there is no valid `utm_source`, Pack One records only the external
`document.referrer` hostname as a fallback, never its path or query. A marked
Daily result share keeps its existing `ref=result_share` behavior and counts as
source `result_share`; the sharer's own acquisition source is not copied into
the share URL.

First-touch attribution is derived in the admin query from the earliest
`acquisition_touch` for the canonical player. Later tagged visits never replace
an earlier direct touch or an earlier campaign. Existing players whose product
activity predates acquisition tracking are labeled `pre_tracking`; post-launch
players with no captured source are `direct`. Client events are unauthenticated
and can be forged or lost on immediate exit, so attribution is directional
product analytics rather than billing or security evidence.

## Report definitions

- **Primary cohort:** viewed decisions from non-QA sessions, first recorded
  encounter per player and puzzle. Prior answers in older sessions also exclude
  repeat encounters. Anonymous devices cannot be identified as the same human;
  account linking follows the canonical session owner.
- **Trophy-match rate:** trophy matches / answered primary decisions.
- **Average partial credit:** mean score of non-trophy answers only. Four score
  bins (0–24, 25–49, 50–74, 75–95) are also recorded in each report group.
- **Decision time:** median and 90th percentile foreground seconds among answers
  with valid timing; always show the timed sample size.
- **Rerolls:** set/pack reroll outcomes / viewed primary decisions. Open decisions
  remain in the denominator, so very recent cohorts are still developing.
- **Likely abandonment:** a viewed open decision in an unfinished run with no
  session or view activity for 24 hours. A return removes this classification.
  The denominator displayed is exposures at least 24 hours old. This is an
  inactivity estimate, not a permanent assertion about player intent.
- **Completion:** completed / observed runs represented in the primary cohort.
- **Review queue:** at least five primary answers per decision, ordered by
  model/target disagreement then sample size, up to 30 decisions. Details expose
  cards, previous picks, actual player choice counts and average awarded credit
  only to admins. Fewer than 30 answers is explicitly marked as early evidence.
  Model disagreement means the trophy card has less than 20% of the strongest
  candidate's model support, matching the existing scoring explanation flag.

The owner console also shows the Daily result-share funnel: marked share-link
arrivals, unique arriving browser identities, new Daily runs whose authoritative
`daily_started` event carries `source=result_share`, and completions matched by
run ID. Start conversion is starts / arrivals; completion conversion is completed
attributed starts / attributed starts. Arrivals are best-effort client analytics,
while starts and completions are server-written. The funnel follows the selected
date range and environment only; the decision-specific run type, set, difficulty,
pick and selection-version filters do not apply.

## Daily habit and return metrics

Launch habit metrics use completed `draft_run_sessions`, not browser analytics
events and not the ranked `scores` table. A Daily completion is any completed
Mixed, Powered Cube, or Latest Set session whose `day` is non-null. The stored
Pacific Daily `day` is authoritative even when completion crosses midnight;
multiple Dailies on one date count as one Daily day.

Every launch metric applies the same exclusion rule: sessions with
`measurement_qa`, players matching the established QA display-name pattern, and
players linked to an account in `pack1_admins` are excluded. A linked account is
one person across merged player/browser identities where the data allows it.
Guests remain one person per browser/player identity; the admin UI states this
limitation.

For each person, **first real Daily** is the earliest included Daily completion
date. The cohort metrics are:

- **Next-day return:** completed any Daily on first day + 1.
- **7-day return:** completed any Daily from first day + 1 through first day + 7.
- **3-in-7:** completed Dailies on at least three distinct dates from first day
  through first day + 6. This is the launch KPI.
- **Ever 3-in-7:** whether the person has ever reached three distinct Daily dates
  inside any seven-day window observed so far.
- **Daily health:** for each Pacific date D, people with at least three distinct
  Daily completion dates from D-6 through D.

Rate denominators include only cohorts whose entire measurement window has
closed. Immature cohorts are shown separately rather than counted as failures.
Every rate is displayed with its raw numerator and mature denominator. Cohort
rows are broken out by first-touch source and campaign, including `direct`,
`result_share`, and `pre_tracking`.

The legacy `analytics_daily_next_day_retention` view remains in place for
compatibility but is superseded. It reads ranked scores, excludes guests, and is
not the Pack One launch retention KPI.

Filters cover UTC date range (up to one year), environment, run type, set,
difficulty band, real pick number and selection version. Groups show difficulty,
pick depth, game position, set, model disagreement and the combined scoring /
difficulty / selection versions. Version groups avoid hiding scoring changes
inside one apparent trend. CSV exports contain the aggregate group rows.

QA runs set `qa:true` at creation. Existing test-name conventions are recognized
server-side and persisted on new sessions; the reporting view also recognizes
legacy QA names. Clients can opt a run out of research, never opt into admin
access. No personal identifiers or emails appear in report responses or exports.

## Owner usage

Use campaign links in the form:

`https://packone.pro/?utm_source=<source>&utm_campaign=<campaign>`

Add `&utm_medium=<medium>` only when it is useful. Keep each value to lowercase
letters/numbers plus `_` or `-`, with at most 40 characters. Creator codes do
not require a deploy. Example:

`https://packone.pro/?utm_source=reddit&utm_campaign=reality_fracture_launch&utm_medium=post`

For result sharing, use the product's Share result action; do not append campaign
parameters to result-share URLs. Recipients are attributed to
`result_share`, independently from the sharer's original source.

In `/admin/`, open the measurements area and choose the cohort date range you
want to inspect. The **Daily habit cohorts** table shows source/campaign rows with
first-Daily people, next-day return, 7-day return, 3-in-7, and ever-3-in-7. Each
rate includes its mature numerator/denominator and an immature count. The
**3-in-7 daily health** table is the operational habit line: it answers how many
people currently have three or more Daily days in the trailing seven Pacific
dates. Environment and decision-specific filters intentionally do not change
these habit metrics because the KPI spans all three Dailies.

Completed Daily results and the all-Dailies-complete home state show the local
time until the next Pacific reset. A streak appears only at two or more
consecutive Daily dates and is derived from completed Daily sessions across all
three Dailies; the profile `current_streak` field keeps its older ranked-score
meaning.

## Operations and verification

Apply `0011_decision_measurements.sql` in development, then run:

```
node tests/decision-measurements-backend-smoke.mjs /path/to/dev.connection --dev-fixtures
node tests/measurement-report-math.mjs /path/to/dev.connection --dev-fixtures
```

The integration test verifies account/admin separation, invitation claim,
idempotent views and answers, repeated encounters, reload timing, rerolls,
inactivity/resume and QA exclusions. Fixtures are marked QA and their temporary
admin access/session is removed. Unit tests cover timing and input validation;
CI's admin browser contract covers mobile layout, filters, details and CSV.
The arithmetic fixture checks a known five-answer cohort: 40% trophy matches,
50 average partial credit, 3-second median, 4.6-second P90, one review decision
and five choices in its detail report.

Apply the additive migration in production before deploying the updated API,
then deploy the frontend. Verify public report requests return 401 and ordinary
accounts return 403. Generate the owner's random setup code outside Git and
insert only its hash and expiry into `pack1_admin_invites`. Share it privately.

The initial reports are expected to be sparse. They establish collection and
review; they do not recalibrate difficulty or change the trophy-only, 100-point
rules. Schedule report-driven tuning only after enough real-player observations.
