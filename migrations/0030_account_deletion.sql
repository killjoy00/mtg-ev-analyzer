-- Full Pack One account deletion for the authenticated account/player pair.
-- This is intentionally destructive user-data cleanup; corpus/model data is not
-- tied to a Pack One player and is not touched.
CREATE OR REPLACE FUNCTION delete_pack1_account(p_auth_user_id uuid,p_player_id uuid,p_email text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM account_links
    WHERE auth_user_id=p_auth_user_id AND player_id=p_player_id
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM pack1_admins WHERE auth_user_id=p_auth_user_id) THEN
    RAISE EXCEPTION 'Remove Pack One admin access before account deletion';
  END IF;

  DELETE FROM draft_run_shares
  WHERE session_id IN (SELECT id FROM draft_run_sessions WHERE player_id=p_player_id);

  DELETE FROM mobile_run_claims
  WHERE guest_player_id=p_player_id
     OR run_id IN (SELECT id FROM draft_run_sessions WHERE player_id=p_player_id);

  DELETE FROM draft_run_sessions WHERE player_id=p_player_id;
  DELETE FROM player_achievements WHERE player_id=p_player_id;
  DELETE FROM analytics_events WHERE player_id=p_player_id;
  DELETE FROM player_identity_merges
    WHERE source_player_id=p_player_id OR target_player_id=p_player_id;
  DELETE FROM entitlement_grants WHERE auth_user_id=p_auth_user_id;

  UPDATE pack1_admin_invites
  SET redeemed_by=NULL
  WHERE redeemed_by=p_auth_user_id;

  UPDATE corpus_status_events
  SET auth_user_id=NULL
  WHERE auth_user_id=p_auth_user_id;

  DELETE FROM neon_auth.verification
  WHERE identifier=p_auth_user_id::text
     OR (p_email IS NOT NULL AND identifier=p_email);

  -- Player cascades scores, game results, challenges, limits and account_links.
  DELETE FROM players WHERE id=p_player_id;

  -- Auth user cascades Better Auth accounts/sessions plus Pack One account
  -- sessions and provider-account links.
  DELETE FROM neon_auth."user" WHERE id=p_auth_user_id;
  RETURN true;
END;
$$;
