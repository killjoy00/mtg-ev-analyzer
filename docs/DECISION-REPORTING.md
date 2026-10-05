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
