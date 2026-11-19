-- Explicit, audited owner approval for a single Beat the Creator challenge
-- sourced from an otherwise private, linked Pack One account. This does not
-- turn on the account's public profile or override identity moderation.
ALTER TABLE creator_challenges
  ADD COLUMN IF NOT EXISTS private_profile_consent_attested boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN creator_challenges.private_profile_consent_attested IS
  'An authorized admin confirmed the private-profile creator approved public display of this one challenge. Created audit records identify the admin.';
