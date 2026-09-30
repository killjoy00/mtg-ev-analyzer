-- Public identity / UGC safety for account-owned Pack One usernames and profiles.
-- Gameplay/career data stays intact when an identity is moderated or blocked.

ALTER TABLE players ADD COLUMN IF NOT EXISTS public_identity_terms_version text;
ALTER TABLE players ADD COLUMN IF NOT EXISTS public_identity_terms_accepted_at timestamptz;
ALTER TABLE players ADD COLUMN IF NOT EXISTS public_identity_hidden_at timestamptz;
ALTER TABLE players ADD COLUMN IF NOT EXISTS public_identity_hidden_reason text;

ALTER TABLE players DROP CONSTRAINT IF EXISTS players_public_identity_terms_pair_ck;
ALTER TABLE players ADD CONSTRAINT players_public_identity_terms_pair_ck CHECK (
  (public_identity_terms_version IS NULL AND public_identity_terms_accepted_at IS NULL)
  OR
  (public_identity_terms_version IS NOT NULL AND public_identity_terms_accepted_at IS NOT NULL)
);
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_public_identity_reason_ck;
ALTER TABLE players ADD CONSTRAINT players_public_identity_reason_ck CHECK (
  public_identity_hidden_reason IS NULL OR char_length(public_identity_hidden_reason) BETWEEN 1 AND 500
);

CREATE TABLE IF NOT EXISTS public_identity_reports (
  id bigserial PRIMARY KEY,
  reporter_player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  target_player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK(reason IN ('offensive_name','harassment','impersonation','spam','other')),
  details text CHECK(details IS NULL OR char_length(details) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  CHECK(reporter_player_id<>target_player_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS public_identity_reports_open_uq
  ON public_identity_reports(reporter_player_id,target_player_id) WHERE status='open';
CREATE INDEX IF NOT EXISTS public_identity_reports_target_idx
  ON public_identity_reports(target_player_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS public_identity_blocks (
  blocker_player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  target_player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(blocker_player_id,target_player_id),
  CHECK(blocker_player_id<>target_player_id)
);
CREATE INDEX IF NOT EXISTS public_identity_blocks_target_idx
  ON public_identity_blocks(target_player_id,blocker_player_id);

CREATE TABLE IF NOT EXISTS public_identity_moderation_actions (
  id bigserial PRIMARY KEY,
  target_player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  admin_auth_user_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('hide','restore')),
  reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 500),
  previous_username_owned boolean,
  previous_profile_public boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_identity_moderation_target_idx
  ON public_identity_moderation_actions(target_player_id,created_at DESC);
