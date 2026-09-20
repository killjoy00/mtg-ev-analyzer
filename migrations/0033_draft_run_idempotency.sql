-- Retry-safe Draft Run creation for native and other clients that opt into idempotency.
-- Existing browser practice remains compatible because the key is nullable.
ALTER TABLE draft_run_sessions
  ADD COLUMN IF NOT EXISTS idempotency_key_hash text,
  ADD COLUMN IF NOT EXISTS idempotency_fingerprint text;

CREATE UNIQUE INDEX IF NOT EXISTS draft_run_practice_idempotency_idx
  ON draft_run_sessions(player_id,idempotency_key_hash)
  WHERE day IS NULL AND idempotency_key_hash IS NOT NULL;
