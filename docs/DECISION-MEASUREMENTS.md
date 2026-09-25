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

Filters cover UTC date range (up to one year), environment, run type, set,
difficulty band, real pick number and selection version. Groups show difficulty,
pick depth, game position, set, model disagreement and the combined scoring /
difficulty / selection versions. Version groups avoid hiding scoring changes
inside one apparent trend. CSV exports contain the aggregate group rows.

QA runs set `qa:true` at creation. Existing test-name conventions are recognized
server-side and persisted on new sessions; the reporting view also recognizes
legacy QA names. Clients can opt a run out of research, never opt into admin
access. No personal identifiers or emails appear in report responses or exports.

## Launch acquisition and Daily habit reporting

The launch measurement layer is additive to the decision-quality report. The
browser records best-effort `acquisition_touch` events; it does not enforce one
acquisition event per browser identity. It accepts only
sanitized `utm_source`, `utm_campaign`, and optional `utm_medium` values;
when there is no UTM source it may use the external referrer hostname. The
`utm_*` parameters are removed from the address bar after capture. A Daily
result-share arrival keeps its existing `ref=result_share` behavior and is
attributed as `result_share`.

The admin report derives first-touch attribution from the earliest acquisition
event associated with the merged player identity. If product activity predates
the start of acquisition tracking, the source is `pre_tracking`. A player first
seen after tracking began but with no captured source is `direct`. A missing
campaign is displayed as `(none)`.

### Daily habit definitions

Habit reporting uses completed `draft_run_sessions` as the authority, not
browser events. One habit day is one or more completed Mixed, Powered Cube, or
Latest Set Dailies on the stored Pacific Daily date; completing multiple Dailies
on one date still counts as one day.

Linked accounts collapse to one person after identity merges. Guests remain one
browser/player identity. All habit metrics exclude `measurement_qa` sessions,
QA-pattern display names, and players linked to `pack1_admins`.

The **Daily habit cohorts** table is grouped by first touch and campaign and
shows:

- **First-Daily people:** people whose first real Daily falls in the selected
  date range.
- **Next-day return:** a completed Daily on the next Pacific date.
- **7-day return:** a completed Daily within the seven-day follow-up window.
- **3-in-7:** at least three distinct completed Daily dates in the first
  seven-day window.
- **Ever 3-in-7:** lifetime observed status as of report generation. Unlike the
  fixed-window rates, this can increase later.

Next-day, 7-day, and 3-in-7 rates use only cohorts whose full observation window
has closed. The UI shows returned/reached people, mature denominator, and
immature cohort count beside each rate; do not treat immature cohorts as
non-returners.

The **3-in-7 daily health** table is a calendar series. For each date it counts
people with at least three distinct completed Daily dates in the trailing seven
Pacific dates. Use it as a product-health trend, not as a cohort conversion
rate.

### Owner workflow

1. Open `/admin/` and sign in with an account present in `pack1_admins`.
2. Set **From** and **Through** to the first-Daily cohort window you want to
   inspect, then select **Refresh**.
3. Read **Daily habit cohorts** by **First touch** and **Campaign**. The
   environment, run-type, set, difficulty, pick, and selection-version filters
   do not change these habit metrics.
4. Compare the mature denominators before comparing rates. A large immature
   count means the newest cohorts have not had enough time to qualify.
5. Use **3-in-7 daily health** for the rolling count of people currently showing
   repeat-Daily behavior.
6. Use **Daily result-share funnel** separately for the share-link loop. That
   funnel keeps its existing definition and is not reattributed by the new
   first-touch logic.

For campaign links, the Admin **Campaign Links / Link Builder** at
`/admin/?area=campaign-links` is the preferred construction surface. It uses the
same acquisition-value validation as runtime capture, previews a tracked UTM URL,
previews an intended static `/go/<slug>/` vanity URL, and produces the exact
`campaign-links.json` entry. The tracked UTM URL can be used immediately without a slug; the
vanity URL requires a valid slug and is not live until its entry and generated
page are committed and deployed through the normal site PR. See
[Campaign Links owner guide](CAMPAIGN-LINKS-OWNER-GUIDE.md).

Normal Pack One URLs still use `utm_source` and `utm_campaign`;
`utm_medium` is optional. Do not put names, emails, account IDs, or other
personal data in those values. Example:

`https://packone.pro/?utm_source=reddit&utm_campaign=launch-week&utm_medium=social`

### Player-facing Daily cue

The Daily status response now includes `daily_streak`, calculated from
consecutive distinct completed Daily dates ending today for the current player
identity. It works for guests as well as linked accounts. After a Daily result,
and on the Daily home once all three Dailies are complete, the browser shows
`New Dailies in …`; when the current streak is at least two days it appends
`· N-day streak`. The reset countdown follows the next Pacific Daily boundary,
including 23- and 25-hour daylight-saving transitions. Practice results do not
show this Daily cue.

The acquisition/habit addition does not require a database migration. It does
require the updated production Functions for the habit-report query and
`daily_streak` response; a Pages-only release is therefore only a partial
launch of these features.

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

For the original decision-observation feature, apply the additive migration in production before deploying the updated API, then deploy the frontend. The later launch acquisition/habit addition in PR #505 has no new migration; promote its exact reviewed `main` commit through development and production Functions, then verify the production admin habit tables and Daily streak response. Verify public report requests return 401 and ordinary
accounts return 403. Generate the owner's random setup code outside Git and
insert only its hash and expiry into `pack1_admin_invites`. Share it privately.

The initial reports are expected to be sparse. They establish collection and
review; they do not recalibrate difficulty or change the trophy-only, 100-point
rules. Schedule report-driven tuning only after enough real-player observations.
