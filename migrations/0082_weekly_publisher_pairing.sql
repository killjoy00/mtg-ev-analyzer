-- Private, revocable pairing for the single Pack One creator publisher.
-- Existing database receipts remain the only authority for actual submission.
CREATE TABLE IF NOT EXISTS patreon_weekly_publisher_pairing (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 owner_auth_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
 token_sha256 text NOT NULL CHECK(token_sha256 ~ '^[a-f0-9]{64}$'),
 paired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 notice_confirmed_at timestamptz NOT NULL
);
REVOKE ALL ON patreon_weekly_publisher_pairing FROM PUBLIC;
ALTER TABLE patreon_weekly_runs ADD COLUMN IF NOT EXISTS snapshot_ticket_sha256 text
 CHECK(snapshot_ticket_sha256 IS NULL OR snapshot_ticket_sha256 ~ '^[a-f0-9]{64}$');
