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

Filters cover UTC date range (up to one year), environment, run type, set,
difficulty band, real pick number and selection version. Groups show difficulty,
pick depth, game position, set, model disagreement and the combined scoring /
difficulty / selection versions. Version groups avoid hiding scoring changes
inside one apparent trend. CSV exports contain the aggregate group rows.

QA runs set `qa:true` at creation. Existing test-name conventions are recognized
server-side and persisted on new sessions; the reporting view also recognizes
legacy QA names. Clients can opt a run out of research, never opt into admin
access. No personal identifiers or emails appear in report responses or exports.

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
