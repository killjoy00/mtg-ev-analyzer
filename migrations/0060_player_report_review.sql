-- Add a private, persistent admin review queue without changing player reports.
-- All previously collected reports enter the open queue.
ALTER TABLE draft_run_decision_reports
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS review_note text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='draft_run_decision_reports_review_status_ck'
    AND conrelid='draft_run_decision_reports'::regclass) THEN
    ALTER TABLE draft_run_decision_reports
      ADD CONSTRAINT draft_run_decision_reports_review_status_ck
      CHECK(review_status IN ('open','reviewed','dismissed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='draft_run_decision_reports_review_note_ck'
    AND conrelid='draft_run_decision_reports'::regclass) THEN
    ALTER TABLE draft_run_decision_reports
      ADD CONSTRAINT draft_run_decision_reports_review_note_ck
      CHECK(review_note IS NULL OR char_length(review_note)<=500);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS draft_run_decision_reports_review_queue_idx
  ON draft_run_decision_reports(review_status,created_at DESC,id DESC);
