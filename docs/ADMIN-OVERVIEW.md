# Admin overview and reporting pages

`/admin/` is the read-only owner dashboard. It now leads with first-Daily
cohort retention, weekly player activity, and marketing attribution. Normal
operational checks are under **Site checks and technical details** and failures
appear in **Needs attention**. Existing standalone tools remain available under
**Other admin tools**. All pages have a persistent section bar and the existing
Overview back link; direct URLs and browser history are preserved.

## Page map

| Page | URL | Primary job |
| --- | --- | --- |
| Overview | `/admin/` | Return rates, weekly player trends, acquisition, issues |
| Players & Retention | `/admin/?area=players` | First-Daily cohorts, mature returns, first-touch sources, account summary |
| Marketing & Growth | `/admin/?area=growth` | Source/campaign performance, first-Daily retention, YouTube results |
| Puzzle Performance | `/admin/?area=insights` | Draft decisions, difficulty, partial credit, quality watchlist, export |
| Publishing | `/admin/?area=publishing` | Creator publishing summary and owner email controls |
| Player Feedback | `/admin/?area=reports` | Broken decisions, repeated complaints, profiles |
| Sets & Data | `/admin/?area=corpus` | Live and awaiting sets, source inventory, verification, status changes |
| Settings | `/admin/?area=team` | Owner-only administrator access and audit |
| Users | `/admin/?area=users` | Authenticated account directory, guest vs signed-in activity, account actions |
| Campaign Links | `/admin/?area=campaign-links` | Campaign report, existing links and new links |
| Creator Challenges | `/admin/?area=creator-challenges` | Existing challenges first, then creation/publishing |
| Patreon | `/admin/?area=patreon` | Owner-only connection and public-post verification history |
| Puzzle Review | `/admin/?area=puzzle-review` | Legacy blinded selector research; not a required release/owner task |

Existing deep links and mutation protections remain intact. The secondary tools
are not deleted or replaced by mock screens.

## Definitions and guardrails

- Reporting dates are Pacific game dates. A first-Daily player is counted by
  the date of their first-ever **completed** Daily across all corpus versions.
- Next-day and seven-day return rates divide **returned / mature**, aggregating
  denominators across attribution groups. They do not average percentages or
  count people whose follow-up period is still open.
- Linked accounts are combined; guests use browser/player identities. QA and
  admin players are excluded according to the existing Habits contract.
- Trend weekly players are deduplicated within each week. Observed players
  who merely saw a pick are not the same as completed-run players.
- Marketing first-touch attribution is client-observed and best effort. Its
  tracked arrivals, first tracked players and authoritative Daily sessions
  must never be treated as one exact conversion denominator.
- Campaign comparisons reuse the Habits first-Daily cohorts and seven-day
  mature denominators, not a second retention query. Always show returned / eligible.
  Fewer than 20 eligible people is labeled a small sample; those campaigns are
  not ranked by return rate. A full week must have elapsed for eligibility.
- Publishing: a successful workflow is not proof of a public post. Patreon
  reports verified publication only when the independent check succeeds.
  Email counts represent subscribed settings, not necessarily sendable mail.
- Overview never publishes, retries operations, edits users, or fetches owner
  team records. Failed reads say unavailable, not zero. Owner-only actions and
  CSRF/confirmation protections are unchanged.
- Set readiness is healthy only when current and verified. Live-set metadata
  does not replace a fixed Daily.

## Account returns after signup (#1742)

Players & Retention includes a short, read-only **After signup** section.
It counts **registered accounts only**, excluding QA, administrators and
deleting accounts. Dailies played as guests before linking are carried over.
The all-time totals separate accounts with no Daily, accounts that played on
exactly one Pacific date, and accounts that played on multiple dates.

The main question is how many people **signed up having played a Daily on or
before the signup day, but never completed another Daily on a later date**.
The seven-, fourteen- and thirty-day follow-ups use **signup day** as their
start and exclude recent accounts until the entire window has elapsed.
This deliberately differs from the first-Daily cohort above it; the two
denominators should not be mixed. No recipient or player list is exported.

The query starts from registered accounts, uses the existing completed-Daily
covering index for their linked player IDs and does not scan guest-only
history. Run representative EXPLAIN before treating response time as proven.

## Incomplete measurements — not fabricated

These need dedicated reporting or native analytics work: account creation to
first Daily; per-platform web/iOS/Android
Daily participants; app store impressions, installs, attribution and conversion;
native sharing; combined verified/deliverable news audience; and reliable
last-successful-public-post status for every automated destination.

The new pages deliberately avoid deriving those from mismatched counts.
Implement each with a documented definition and a bounded aggregation before
displaying it as a real KPI.

## Checks

`node --test tests/admin-overview.test.mjs tests/admin-subpages-ux.test.mjs`

`tests/admin-e2e.mjs` exercises new navigation, the player cohort report,
account directory, creator/campaign tools, and the retained security contracts.
Screenshots use synthetic accounts and data only.

The Players & Retention page keeps the existing all-cohort Ever 3-in-7 and rolling seven-day Daily health reports inside **More on Daily habits**. Marketing & Growth keeps the full YouTube watch-time, Short format, retention-point and subscriber report under **Full YouTube report**. Moving a report never discards a measured field.

**Campaign comparison caveat:** Habits combines linked accounts, while campaign-performance Daily sessions use each player ID's own recorded source. Linking a guest identity can make campaign rows differ. Do not divide a cohort count by Daily starts to claim a conversion rate. The linked-source fixture tests that these numbers are not silently reassigned. Growth summary totals include only the first 80 returned campaign groups and are not all-site totals.

**Feedback triage performance:** Open decision reports still prioritize broken picks and repeated independent reporters. The priority query counts reporters only for puzzle IDs in the *filtered open inbox*. Reviewed/dismissed/all-status pages first select the requested 25 reports, then count reports only on those pages' puzzle IDs. The existing `draft_run_decision_reports_puzzle_idx` supports the grouped lookups. This prevents an all-history aggregation on each chronological inbox request. A live `EXPLAIN` on representative data is still useful to monitor growth; the code and tests do not claim a measured speedup.

Marketing & Growth also retains the original Daily result-share funnel (finishers, sharers, tracked visits, attributed starts/completions, dated visits and both directional rates). It loads only if an admin expands **Sharing Daily results**, keeping the main report fast. Its Daily type filter and selected date window are passed to the original read-only measurements endpoint; no new share tracking is implied.
