-- Issue #859: audited admin username changes and persistent admin deletion attribution.

ALTER TABLE public_identity_moderation_actions
  ADD COLUMN IF NOT EXISTS target_auth_user_id uuid,
  ADD COLUMN IF NOT EXISTS previous_display_name text,
  ADD COLUMN IF NOT EXISTS new_display_name text;

UPDATE public_identity_moderation_actions action
SET target_auth_user_id=link.auth_user_id
FROM account_links link
WHERE action.target_auth_user_id IS NULL
  AND action.target_player_id=link.player_id;

ALTER TABLE public_identity_moderation_actions
  ALTER COLUMN reason DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS public_identity_moderation_actions_action_check,
  DROP CONSTRAINT IF EXISTS public_identity_moderation_actions_reason_check,
  DROP CONSTRAINT IF EXISTS public_identity_moderation_action_ck,
  DROP CONSTRAINT IF EXISTS public_identity_moderation_reason_ck,
  DROP CONSTRAINT IF EXISTS public_identity_moderation_names_ck;

ALTER TABLE public_identity_moderation_actions
  ADD CONSTRAINT public_identity_moderation_action_ck
    CHECK(action IN ('hide','restore','rename')),
  ADD CONSTRAINT public_identity_moderation_reason_ck CHECK(
    (action IN ('hide','restore') AND reason IS NOT NULL AND char_length(reason) BETWEEN 1 AND 500)
    OR
    (action='rename' AND (reason IS NULL OR char_length(reason) BETWEEN 1 AND 200))
  ),
  ADD CONSTRAINT public_identity_moderation_names_ck CHECK(
    (previous_display_name IS NULL OR char_length(previous_display_name) BETWEEN 2 AND 24)
    AND (new_display_name IS NULL OR char_length(new_display_name) BETWEEN 2 AND 24)
  );

CREATE INDEX IF NOT EXISTS public_identity_moderation_auth_target_idx
  ON public_identity_moderation_actions(target_auth_user_id,created_at DESC);

ALTER TABLE account_deletion_operations
  ADD COLUMN IF NOT EXISTS initiation_source text NOT NULL DEFAULT 'self_service',
  ADD COLUMN IF NOT EXISTS initiated_by_admin_auth_user_id uuid,
  ADD COLUMN IF NOT EXISTS deletion_reason text,
  ADD COLUMN IF NOT EXISTS target_was_admin boolean NOT NULL DEFAULT false;

ALTER TABLE account_deletion_operations
  DROP CONSTRAINT IF EXISTS account_deletion_operations_initiation_source_check,
  DROP CONSTRAINT IF EXISTS account_deletion_operation_source_ck,
  DROP CONSTRAINT IF EXISTS account_deletion_operation_reason_ck,
  DROP CONSTRAINT IF EXISTS account_deletion_operation_actor_ck;

ALTER TABLE account_deletion_operations
  ADD CONSTRAINT account_deletion_operation_source_ck
    CHECK(initiation_source IN ('self_service','admin')),
  ADD CONSTRAINT account_deletion_operation_reason_ck
    CHECK(deletion_reason IS NULL OR char_length(deletion_reason) BETWEEN 1 AND 200),
  ADD CONSTRAINT account_deletion_operation_actor_ck CHECK(
    (initiation_source='self_service' AND initiated_by_admin_auth_user_id IS NULL)
    OR
    (initiation_source='admin' AND initiated_by_admin_auth_user_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS account_deletion_admin_actor_idx
  ON account_deletion_operations(initiated_by_admin_auth_user_id,created_at DESC)
  WHERE initiated_by_admin_auth_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION pack1_admin_rename_public_username(
  p_target_auth_user_id uuid,
  p_admin_auth_user_id uuid,
  p_display_name text,
  p_username_owned boolean,
  p_reason text DEFAULT NULL
)
RETURNS TABLE(
  result_status text,
  player_id uuid,
  previous_display_name text,
  new_display_name text,
  username_owned boolean
)
LANGUAGE plpgsql
VOLATILE
AS $pack1$
DECLARE
  target record;
BEGIN
  IF p_target_auth_user_id IS NULL OR p_admin_auth_user_id IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text,NULL::uuid,NULL::text,NULL::text,NULL::boolean;
    RETURN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pack1_admins WHERE auth_user_id=p_admin_auth_user_id) THEN
    RETURN QUERY SELECT 'forbidden'::text,NULL::uuid,NULL::text,NULL::text,NULL::boolean;
    RETURN;
  END IF;
  IF p_display_name IS NULL OR char_length(p_display_name) NOT BETWEEN 2 AND 24
     OR (p_reason IS NOT NULL AND char_length(p_reason) NOT BETWEEN 1 AND 200)
     OR ((pack1_username_key(p_display_name)='pack player') = p_username_owned) THEN
    RETURN QUERY SELECT 'invalid'::text,NULL::uuid,NULL::text,NULL::text,NULL::boolean;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_target_auth_user_id::text,0));

  IF EXISTS(SELECT 1 FROM account_deletion_operations WHERE auth_user_id=p_target_auth_user_id) THEN
    RETURN QUERY SELECT 'deleting'::text,NULL::uuid,NULL::text,NULL::text,NULL::boolean;
    RETURN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM neon_auth."user" WHERE id=p_target_auth_user_id) THEN
    RETURN QUERY SELECT 'unknown'::text,NULL::uuid,NULL::text,NULL::text,NULL::boolean;
    RETURN;
  END IF;

  SELECT p.id,p.display_name,p.username_owned,p.profile_public,p.public_identity_hidden_at
  INTO target
  FROM account_links link
  JOIN players p ON p.id=link.player_id
  WHERE link.auth_user_id=p_target_auth_user_id
  LIMIT 1
  FOR UPDATE OF p;

  IF target.id IS NULL THEN
    RETURN QUERY SELECT 'unlinked'::text,NULL::uuid,NULL::text,NULL::text,NULL::boolean;
    RETURN;
  END IF;
  IF target.public_identity_hidden_at IS NOT NULL THEN
    RETURN QUERY SELECT 'moderated'::text,target.id,target.display_name,target.display_name,target.username_owned;
    RETURN;
  END IF;
  IF NOT p_username_owned AND target.profile_public THEN
    RETURN QUERY SELECT 'public_profile_requires_username'::text,target.id,target.display_name,target.display_name,target.username_owned;
    RETURN;
  END IF;
  IF target.display_name IS NOT DISTINCT FROM p_display_name
     AND target.username_owned IS NOT DISTINCT FROM p_username_owned THEN
    RETURN QUERY SELECT 'unchanged'::text,target.id,target.display_name,target.display_name,target.username_owned;
    RETURN;
  END IF;

  UPDATE players
  SET display_name=p_display_name,
      username_owned=p_username_owned,
      updated_at=now()
  WHERE id=target.id;

  INSERT INTO public_identity_moderation_actions(
    target_player_id,target_auth_user_id,admin_auth_user_id,action,reason,
    previous_username_owned,previous_profile_public,previous_display_name,new_display_name
  ) VALUES(
    target.id,p_target_auth_user_id,p_admin_auth_user_id,'rename',p_reason,
    target.username_owned,target.profile_public,target.display_name,p_display_name
  );

  RETURN QUERY SELECT 'renamed'::text,target.id,target.display_name,p_display_name,p_username_owned;
END;
$pack1$;

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
  IF NOT EXISTS(SELECT 1 FROM pack1_admins WHERE auth_user_id=p_admin_auth_user_id) THEN
    RETURN QUERY SELECT 'forbidden'::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::text,NULL::integer,NULL::text,
      NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,NULL::timestamptz,
      NULL::text,NULL::uuid,NULL::text,NULL::boolean;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_target_auth_user_id::text,0));

  SELECT * INTO op FROM account_deletion_operations WHERE auth_user_id=p_target_auth_user_id;
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

  SELECT EXISTS(SELECT 1 FROM pack1_admins WHERE auth_user_id=p_target_auth_user_id) INTO target_admin;
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
  WHERE auth_user_id=p_target_auth_user_id AND revoked_at IS NULL;

  RETURN QUERY SELECT 'created'::text,op.operation_id,op.auth_user_id,op.player_id,op.state,op.attempts,
    op.last_error_code,op.created_at,op.updated_at,op.app_cleanup_completed_at,op.provider_deleted_at,op.completed_at,
    op.initiation_source,op.initiated_by_admin_auth_user_id,op.deletion_reason,op.target_was_admin;
END;
$pack1$;
