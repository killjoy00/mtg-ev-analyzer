-- Extend the native OAuth bridge for destructive reauthentication.
ALTER TABLE mobile_oauth_handoffs
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'signin'
    CHECK(purpose IN ('signin','delete'));

ALTER TABLE mobile_oauth_handoffs
  ADD COLUMN IF NOT EXISTS expected_auth_user_id uuid
    REFERENCES neon_auth."user"(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='mobile_oauth_handoffs_delete_expected'
      AND conrelid='mobile_oauth_handoffs'::regclass
  ) THEN
    ALTER TABLE mobile_oauth_handoffs
      ADD CONSTRAINT mobile_oauth_handoffs_delete_expected
      CHECK(purpose<>'delete' OR expected_auth_user_id IS NOT NULL);
  END IF;
END $$;
