-- One reusable counter per player/scope, rather than one row per request or
-- time bucket. Existing identity deletion cascades to its counters.
CREATE TABLE IF NOT EXISTS player_request_limits (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  scope text NOT NULL,
  used integer NOT NULL CHECK(used>0),
  resets_at timestamptz NOT NULL,
  PRIMARY KEY(player_id,scope)
);
