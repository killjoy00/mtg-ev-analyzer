-- Make non-Daily Draft Run creation safely retryable for mobile clients.
ALTER TABLE draft_run_sessions
  ADD COLUMN IF NOT EXISTS start_idempotency_hash text;

ALTER TABLE draft_run_sessions
  ADD COLUMN IF NOT EXISTS start_request_hash text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='draft_run_practice_start_idempotency_shape'
      AND conrelid='draft_run_sessions'::regclass
  ) THEN
    ALTER TABLE draft_run_sessions
      ADD CONSTRAINT draft_run_practice_start_idempotency_shape
      CHECK(
        (start_idempotency_hash IS NULL AND start_request_hash IS NULL)
        OR (
          day IS NULL
          AND start_idempotency_hash ~ '^[a-f0-9]{64}$'
          AND start_request_hash ~ '^[a-f0-9]{64}$'
        )
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS draft_run_practice_start_idempotency_idx
  ON draft_run_sessions(player_id,start_idempotency_hash)
  WHERE start_idempotency_hash IS NOT NULL;
