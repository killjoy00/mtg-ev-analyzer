-- Durable decision-quality feedback from the post-pick reveal.
-- The server derives decision/version metadata from the committed run; clients
-- only supply the reason, optional short comment, and client version/build.
CREATE TABLE IF NOT EXISTS draft_run_decision_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES draft_run_sessions(id) ON DELETE SET NULL,
  player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  puzzle_id text NOT NULL,
  set_id text NOT NULL,
  pick_number smallint NOT NULL CHECK (pick_number BETWEEN 1 AND 12),
  round_number smallint NOT NULL CHECK (round_number BETWEEN 1 AND 16),
  selected_card_id text NOT NULL,
  selected_card_name text NOT NULL,
  recommended_card_id text,
  recommended_card_name text,
  recommended_card_score smallint CHECK (recommended_card_score BETWEEN 0 AND 100),
  reason text NOT NULL CHECK (reason IN (
    'draft_context',
    'card_or_image',
    'score_recommendation',
    'broken',
    'other'
  )),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 500),
  environment text NOT NULL,
  daily_date date,
  corpus_version text NOT NULL,
  model_version text,
  scoring_version text NOT NULL,
  difficulty_version text,
  selection_version text,
  serving_policy_version text,
  backend_release text,
  client_platform text NOT NULL CHECK (client_platform IN ('web','ios','android','unknown')),
  client_version text CHECK (client_version IS NULL OR char_length(client_version) <= 64),
  client_build text CHECK (client_build IS NULL OR char_length(client_build) <= 64),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS draft_run_decision_reports_puzzle_idx
  ON draft_run_decision_reports(puzzle_id,created_at DESC);
CREATE INDEX IF NOT EXISTS draft_run_decision_reports_reason_idx
  ON draft_run_decision_reports(reason,created_at DESC);
CREATE INDEX IF NOT EXISTS draft_run_decision_reports_model_idx
  ON draft_run_decision_reports(corpus_version,model_version,created_at DESC);
CREATE INDEX IF NOT EXISTS draft_run_decision_reports_client_idx
  ON draft_run_decision_reports(client_platform,client_version,created_at DESC);
CREATE INDEX IF NOT EXISTS draft_run_decision_reports_created_idx
  ON draft_run_decision_reports(created_at DESC);

CREATE OR REPLACE VIEW draft_run_decision_report_summary AS
SELECT
  puzzle_id,
  set_id,
  pick_number,
  count(*)::int AS report_count,
  count(DISTINCT player_id)::int AS independent_reporters,
  count(*) FILTER (WHERE reason='draft_context')::int AS draft_context_reports,
  count(*) FILTER (WHERE reason='card_or_image')::int AS card_or_image_reports,
  count(*) FILTER (WHERE reason='score_recommendation')::int AS score_recommendation_reports,
  count(*) FILTER (WHERE reason='broken')::int AS broken_reports,
  count(*) FILTER (WHERE reason='other')::int AS other_reports,
  max(created_at) AS latest_report_at
FROM draft_run_decision_reports
GROUP BY puzzle_id,set_id,pick_number;
