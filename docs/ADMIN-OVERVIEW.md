# Admin home and drill-down navigation

`/admin/` is the Overview, not a separate tab. After the existing account,
admin-access, and API-version checks, it shows read-only summaries and links
to dedicated pages. Each page has an **Overview** back link outside its content,
so filters, dialogs, and refreshes cannot remove that navigation. Ordinary links
preserve native browser history and direct bookmarks.

| Area | URL |
| --- | --- |
| Insights / decision quality | `/admin/?area=insights` |
| Creator Challenges | `/admin/?area=creator-challenges` |
| Feedback & Moderation | `/admin/?area=reports` |
| Users | `/admin/?area=users` |
| Campaign Links | `/admin/?area=campaign-links` |
| Operations / corpus | `/admin/?area=corpus` |
| Puzzle Review (blinded selection test, [details](PUZZLE-REVIEW.md)) | `/admin/?area=puzzle-review` |
| Settings / administrator access | `/admin/?area=team` (Owner only) |

Existing named URLs retain their tools; the former root decision-quality report
is available under Insights. Creator Challenges and Campaign Links have distinct
entry pages but reuse the existing publishing implementation and safety gates.

## Summary semantics

- Activity and sharing use today's Pacific date and existing measurement definitions.
  **Observed players** means distinct player identities with a browser-observed,
  current-corpus first encounter with a draft decision on that date. It can include
  players who have not completed a run; it is not a site-wide visitor count.
- **Users → Signed out vs signed in** counts distinct current-corpus players with
  *completed runs*, excluding QA and admin players. Linked accounts are merged,
  guests remain per browser, Daily runs use their assigned Daily date, and practice
  uses run creation time. The two metrics cannot be subtracted to estimate abandonment.
- Account totals and 30-day counts retain the Users report's definitions.
- Users account-directory column headers sort the **entire filtered account list**, not only the displayed 100-account page. Sorting resets pagination and reverses when the same column is selected again.
- Return rates aggregate mature cohort denominators, not averages of percentages.
- Corpus readiness is healthy only when both current and verified. Live-set metadata
  does not prove or change the contents of an already-fixed Daily.
- Failed summary reads show unavailable, never zero. Authentication failures clear
  the dashboard. Stale responses cannot restore it after sign-out or refresh.
- The Overview does not publish, retry operations, mutate users, or fetch Team data.

No new backend routes, database changes, or release-protection changes are needed.

## Validation

`node --test tests/admin-overview.test.mjs tests/admin-entry.test.mjs`

The existing `tests/admin-e2e.mjs` imports `admin-overview-e2e.mjs`. It checks the
home, deep links, browser history, mobile/desktop widths, owner-only Settings,
partial failures, refresh, expired access, and sign-out during delayed reads.
The existing account, publication, and invitation acceptance tests remain enabled.
All browser fixtures and screenshots use synthetic data only.
