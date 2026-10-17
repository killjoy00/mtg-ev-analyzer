# Decision-quality reports

The reveal-only **Report this decision** action writes to `draft_run_decision_reports`.
The Draft Run service derives the decision, selected card, model-strongest card,
environment, Daily date, corpus/scoring/model versions, release commit and
Pack One player ID from the committed run. Clients provide only the selected
reason, an optional comment (maximum 500 characters), and client version/build
metadata where the platform exposes it.

The record intentionally does not contain email addresses, credentials, auth
tokens, network addresses, or other contact data. `player_id` follows Pack
One's existing internal player identity and is set to null if that player row is
deleted, while the decision-quality report remains useful in aggregate.

## Operator review

Open [Pack One Admin → Player reports](https://packone.pro/admin/?area=reports) using an authenticated admin account. The **Draft decisions** inbox shows every player report (including prior submissions), the stated reason and comment, actual and model-recommended cards, set/pick, client platform, versions, and report counts for the same decision. The **Open** filter is the default; broken reports are highlighted and counted separately. Reviewers can mark reports **Reviewed**, **Dismissed**, or **Reopened**, with optional private notes. Review status and reviewer attribution persist in `draft_run_decision_reports` through additive migration `0060_player_report_review.sql`; reports are never deleted by these actions. Admin navigation also shows the current open count. Existing reports start in the Open queue.

The same private inbox has a **Player profiles** tab for public-identity reports. Its Dismiss and Reopen controls do not change the reported player's public identity. The **Hide public identity** action requires a reason and calls the existing audited moderation handler; it does not create an untracked direct database mutation. Ordinary players and non-admin accounts cannot load this page or its API. This is not an email alert service: urgent reports are flagged inside the admin view.

The fastest answer to “Which decisions are receiving multiple reports, and
why?” is the summary view:

```sql
SELECT *
FROM draft_run_decision_report_summary
WHERE independent_reporters >= 2
ORDER BY independent_reporters DESC, report_count DESC, latest_report_at DESC;
```

For version-specific triage:

```sql
SELECT
  puzzle_id,
  reason,
  corpus_version,
  model_version,
  scoring_version,
  client_platform,
  client_version,
  count(*) AS reports,
  count(DISTINCT player_id) AS independent_reporters,
  max(created_at) AS latest_report_at
FROM draft_run_decision_reports
GROUP BY
  puzzle_id, reason, corpus_version, model_version, scoring_version,
  client_platform, client_version
ORDER BY reports DESC, latest_report_at DESC;
```

For a single decision, inspect the raw rows ordered by `created_at DESC`.
The table has indexes for puzzle, reason, model/corpus version, client version,
and date-oriented review.

This channel is only for reveal decision quality. It is not public-profile
moderation, support/contact, crash telemetry, or feature-request intake.
