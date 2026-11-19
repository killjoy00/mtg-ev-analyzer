-- 0058: close Admin-to-Admin account deletion bypass without changing
-- historical migration 0047, a user's self-service deletion, or Owner bootstrap.
-- Owner access is checked inside the atomic initializer before an existing
-- operation may be resumed or a new irreversible tombstone is written.

CREATE OR REPLACE FUNCTION pack1_begin_admin_account_deletion(
  p_target_auth_user_id uuid,
  p_admin_auth_user_id uuid,
  p_reason text DEFAULT NULL,
  p_acknowledge_admin boolean DEFAULT false
)
RETURNS TABLE(
  start_status text,
  operation_id uuid,
  auth_user_id uuid,
  player_id uuid,
  state text,
  attempts integer,
  last_error_code text,
  created_at timestamptz,
  updated_at timestamptz,
  app_cleanup_completed_at timestamptz,
  provider_deleted_at timestamptz,
  completed_at timestamptz,
  initiation_source text,
  initiated_by_admin_auth_user_id uuid,
  deletion_reason text,
  target_was_admin boolean
)
LANGUAGE plpgsql
VOLATILE
AS $pack1$
DECLARE
  op account_deletion_operations%ROWTYPE;
  resolved_player uuid;
  target_admin boolean;
  target_role text;
BEGIN
  IF p_target_auth_user_id IS NULL OR p_admin_auth_user_id IS NULL
     OR (p_reason IS NOT NULL AND char_length(p_reason) NOT BETWEEN 1 AND 200) THEN
    RETURN QUERY SELECT 'invalid'::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::text,NULL::integer,NULL::text,
      NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,
      NULL::text,NULL::uuid,NULL::text,NULL::boolean;
    RETURN;
  END IF;
  IF p_target_auth_user_id=p_admin_auth_user_id THEN
    RETURN QUERY SELECT 'self_delete'::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::text,NULL::integer,NULL::text,
      NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,
      NULL::text,NULL::uuid,NULL::text,NULL::boolean;
    RETURN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pack1_admins actor WHERE actor.auth_user_id=p_admin_auth_user_id) THEN
    RETURN QUERY SELECT 'forbidden'::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::text,NULL::integer,NULL::text,
      NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,
      NULL::text,NULL::uuid,NULL::text,NULL::boolean;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_target_auth_user_id::text,0));

  -- Resolve and lock the target role before looking up existing operations.
  -- A non-Owner must not initiate OR resume deletion of a current Admin.
  -- Revocation and invitation acceptance take the same identity lock.
  SELECT a.role INTO target_role FROM pack1_admins a
    WHERE a.auth_user_id=p_target_auth_user_id FOR SHARE;
  IF target_role='owner' THEN
    RETURN QUERY SELECT 'owner_protected'::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::text,NULL::integer,NULL::text,
      NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,
      NULL::text,NULL::uuid,NULL::text,NULL::boolean;
    RETURN;
  END IF;
  IF target_role='admin' THEN
    PERFORM 1 FROM pack1_admins a
      WHERE a.auth_user_id=p_admin_auth_user_id AND a.role='owner' FOR SHARE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'owner_required'::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::text,NULL::integer,NULL::text,
      NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,
      NULL::text,NULL::uuid,NULL::text,NULL::boolean;
    RETURN;
    END IF;
  END IF;

  SELECT existing.* INTO op FROM account_deletion_operations existing WHERE existing.auth_user_id=p_target_auth_user_id;
  IF FOUND THEN
    RETURN QUERY SELECT 'existing'::text,op.operation_id,op.auth_user_id,op.player_id,op.state,op.attempts,
      op.last_error_code,op.created_at,op.updated_at,op.app_cleanup_completed_at,op.provider_deleted_at,op.completed_at,
      op.initiation_source,op.initiated_by_admin_auth_user_id,op.deletion_reason,op.target_was_admin;
    RETURN;
  END IF;

  IF NOT EXISTS(SELECT 1 FROM neon_auth."user" WHERE id=p_target_auth_user_id) THEN
    RETURN QUERY SELECT 'unknown_target'::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::text,NULL::integer,NULL::text,
      NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,
      NULL::text,NULL::uuid,NULL::text,NULL::boolean;
    RETURN;
  END IF;

  target_admin:=target_role IS NOT NULL;
  IF target_admin AND NOT p_acknowledge_admin THEN
    RETURN QUERY SELECT 'admin_ack_required'::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::text,NULL::integer,NULL::text,
      NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,
      NULL::text,NULL::uuid,NULL::text,true;
    RETURN;
  END IF;

  SELECT link.player_id INTO resolved_player
  FROM account_links link
  WHERE link.auth_user_id=p_target_auth_user_id
  LIMIT 1;

  INSERT INTO account_deletion_operations(
    auth_user_id,player_id,state,initiation_source,initiated_by_admin_auth_user_id,deletion_reason,target_was_admin
  ) VALUES(
    p_target_auth_user_id,resolved_player,'pending','admin',p_admin_auth_user_id,p_reason,target_admin
  )
  RETURNING * INTO op;

  UPDATE account_sessions
  SET revoked_at=COALESCE(revoked_at,now())
  WHERE account_sessions.auth_user_id=p_target_auth_user_id AND account_sessions.revoked_at IS NULL;

  RETURN QUERY SELECT 'created'::text,op.operation_id,op.auth_user_id,op.player_id,op.state,op.attempts,
    op.last_error_code,op.created_at,op.updated_at,op.app_cleanup_completed_at,op.provider_deleted_at,op.completed_at,
    op.initiation_source,op.initiated_by_admin_auth_user_id,op.deletion_reason,op.target_was_admin;
END;
$pack1$;

-- Second-line guard for direct account_deletion_operations INSERT/UPDATE,
-- including changes to the recorded initiator after an operation was created.
-- Self-service deletion of regular Admins remains permitted; Owner deletion never is.
CREATE OR REPLACE FUNCTION pack1_admin_deletion_guard()
RETURNS trigger LANGUAGE plpgsql VOLATILE AS $pack1$
DECLARE
  target_role text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.auth_user_id::text,0));
  SELECT role INTO target_role FROM pack1_admins WHERE auth_user_id=NEW.auth_user_id FOR SHARE;
  IF target_role='owner' THEN
    RAISE EXCEPTION 'Owner account deletion requires controlled ownership transfer.'
      USING ERRCODE='23514';
  END IF;
  IF target_role='admin' AND NEW.initiation_source='admin' THEN
    PERFORM 1 FROM pack1_admins
      WHERE auth_user_id=NEW.initiated_by_admin_auth_user_id AND role='owner' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only the Owner can initiate deletion of another administrator account.'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;$pack1$;
DROP TRIGGER IF EXISTS pack1_owner_guard_on_deletions ON account_deletion_operations;
CREATE TRIGGER pack1_owner_guard_on_deletions
BEFORE INSERT OR UPDATE OF auth_user_id,initiation_source,initiated_by_admin_auth_user_id
ON account_deletion_operations
FOR EACH ROW EXECUTE FUNCTION pack1_admin_deletion_guard();
