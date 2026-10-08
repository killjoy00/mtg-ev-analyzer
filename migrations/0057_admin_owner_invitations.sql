-- Owner privileges are explicitly bound to a verified existing Auth user by a
-- separate operator transaction; this migration never guesses or seeds an owner.
ALTER TABLE pack1_admins ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin';
ALTER TABLE pack1_admins DROP CONSTRAINT IF EXISTS pack1_admin_role_check;
ALTER TABLE pack1_admins ADD CONSTRAINT pack1_admin_role_check
  CHECK (role IN ('owner','admin'));
CREATE UNIQUE INDEX IF NOT EXISTS pack1_admin_one_owner
  ON pack1_admins ((role)) WHERE role='owner';

CREATE TABLE IF NOT EXISTS pack1_admin_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  recipient_email text NOT NULL CHECK (
    recipient_email=lower(btrim(recipient_email))
    AND char_length(recipient_email) BETWEEN 3 AND 254
    AND recipient_email LIKE '%@%'
  ),
  issued_by uuid NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_by uuid,
  accepted_at timestamptz,
  revoked_by uuid,
  revoked_at timestamptz,
  CHECK ((accepted_by IS NULL)=(accepted_at IS NULL)),
  CHECK ((revoked_by IS NULL)=(revoked_at IS NULL)),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS pack1_admin_invites_one_pending
  ON pack1_admin_invitations(recipient_email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS pack1_admin_invites_issued_idx
  ON pack1_admin_invitations(issued_at DESC,id);

CREATE TABLE IF NOT EXISTS pack1_admin_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN (
    'invite_issued','invite_revoked','invite_accepted','admin_revoked'
  )),
  actor_auth_user_id uuid NOT NULL,
  target_auth_user_id uuid,
  invitation_id uuid,
  recipient_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pack1_admin_audit_latest_idx ON pack1_admin_audit(created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS pack1_admin_action_limits (
  actor_auth_user_id uuid NOT NULL,
  action text NOT NULL CHECK (action='issue_invite'),
  attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 20),
  resets_at timestamptz NOT NULL,
  PRIMARY KEY (actor_auth_user_id,action)
);

-- All mutations are single transactional database functions. The owner check
-- happens on each call; the browser/API never determines permissions.
CREATE OR REPLACE FUNCTION pack1_issue_admin_invitation(
  p_actor uuid,p_email text,p_hash text,p_ttl_seconds integer DEFAULT 259200
) RETURNS TABLE(result text, invitation_id uuid, expiration timestamptz)
LANGUAGE plpgsql VOLATILE AS $pack1$
DECLARE
  normalized text:=lower(btrim(coalesce(p_email,'')));
  issued pack1_admin_invitations%ROWTYPE;
  permitted integer;
BEGIN
  IF p_actor IS NULL OR p_hash !~ '^[a-f0-9]{64}$'
     OR p_ttl_seconds NOT BETWEEN 300 AND 604800
     OR char_length(normalized) NOT BETWEEN 3 AND 254
     OR normalized !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RETURN QUERY SELECT 'invalid'::text,NULL::uuid,NULL::timestamptz; RETURN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pack1_admins WHERE auth_user_id=p_actor AND role='owner') THEN
    RETURN QUERY SELECT 'forbidden'::text,NULL::uuid,NULL::timestamptz; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pack1-admin-invite:'||normalized,0));
  -- Locking the owner row protects against concurrent membership revocation.
  PERFORM 1 FROM pack1_admins WHERE auth_user_id=p_actor AND role='owner' FOR SHARE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'forbidden'::text,NULL::uuid,NULL::timestamptz; RETURN;
  END IF;
  IF EXISTS(
    SELECT 1 FROM neon_auth."user" u JOIN pack1_admins a ON a.auth_user_id=u.id
    WHERE lower(btrim(u.email))=normalized
  ) THEN
    RETURN QUERY SELECT 'already_admin'::text,NULL::uuid,NULL::timestamptz; RETURN;
  END IF;
  INSERT INTO pack1_admin_action_limits(actor_auth_user_id,action,attempts,resets_at)
    VALUES(p_actor,'issue_invite',1,now()+interval '1 hour')
    ON CONFLICT(actor_auth_user_id,action) DO UPDATE
      SET attempts=CASE WHEN pack1_admin_action_limits.resets_at<=now() THEN 1 ELSE pack1_admin_action_limits.attempts+1 END,
          resets_at=CASE WHEN pack1_admin_action_limits.resets_at<=now() THEN now()+interval '1 hour' ELSE pack1_admin_action_limits.resets_at END
      WHERE pack1_admin_action_limits.resets_at<=now() OR pack1_admin_action_limits.attempts<20
      RETURNING attempts INTO permitted;
  IF permitted IS NULL THEN
    RETURN QUERY SELECT 'rate_limited'::text,NULL::uuid,NULL::timestamptz; RETURN;
  END IF;
  UPDATE pack1_admin_invitations SET revoked_at=now(),revoked_by=p_actor
    WHERE recipient_email=normalized AND accepted_at IS NULL AND revoked_at IS NULL;
  INSERT INTO pack1_admin_invitations(token_hash,recipient_email,issued_by,expires_at)
    VALUES(p_hash,normalized,p_actor,now()+make_interval(secs=>p_ttl_seconds))
    RETURNING * INTO issued;
  INSERT INTO pack1_admin_audit(event_type,actor_auth_user_id,invitation_id,recipient_email)
    VALUES('invite_issued',p_actor,issued.id,normalized);
  RETURN QUERY SELECT 'issued'::text,issued.id,issued.expires_at;
END;$pack1$;

CREATE OR REPLACE FUNCTION pack1_accept_admin_invitation(
  p_auth_user_id uuid,p_hash text
) RETURNS text
LANGUAGE plpgsql VOLATILE AS $pack1$
DECLARE
  invitation pack1_admin_invitations%ROWTYPE;
  verified_email text;
BEGIN
  IF p_auth_user_id IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN RETURN 'invalid'; END IF;
  -- Serialize with account deletion and fresh-snapshot account attachment.
  IF NOT pack1_identity_attachment_allowed(p_auth_user_id) THEN RETURN 'account_deleting'; END IF;
  SELECT lower(btrim(u.email)) INTO verified_email
    FROM neon_auth."user" u WHERE u.id=p_auth_user_id AND u."emailVerified"=true;
  IF verified_email IS NULL THEN RETURN 'not_verified'; END IF;
  SELECT * INTO invitation FROM pack1_admin_invitations
    WHERE token_hash=p_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF invitation.accepted_by=p_auth_user_id AND
     EXISTS(SELECT 1 FROM pack1_admins WHERE auth_user_id=p_auth_user_id) THEN
    RETURN 'accepted';
  END IF;
  IF invitation.accepted_at IS NOT NULL OR invitation.revoked_at IS NOT NULL
     OR invitation.expires_at<=now() THEN RETURN 'invalid'; END IF;
  IF invitation.recipient_email<>verified_email THEN RETURN 'wrong_account'; END IF;
  IF EXISTS(SELECT 1 FROM pack1_admins WHERE auth_user_id=p_auth_user_id) THEN RETURN 'already_admin'; END IF;
  INSERT INTO pack1_admins(auth_user_id,role) VALUES(p_auth_user_id,'admin');
  UPDATE pack1_admin_invitations SET accepted_at=now(),accepted_by=p_auth_user_id
    WHERE id=invitation.id;
  INSERT INTO pack1_admin_audit(event_type,actor_auth_user_id,target_auth_user_id,invitation_id,recipient_email)
    VALUES('invite_accepted',p_auth_user_id,p_auth_user_id,invitation.id,verified_email);
  RETURN 'accepted';
END;$pack1$;

CREATE OR REPLACE FUNCTION pack1_revoke_admin_invitation(p_actor uuid,p_invitation uuid)
RETURNS text LANGUAGE plpgsql VOLATILE AS $pack1$
DECLARE
  invitation pack1_admin_invitations%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pack1_admins WHERE auth_user_id=p_actor AND role='owner')
    THEN RETURN 'forbidden'; END IF;
  SELECT * INTO invitation FROM pack1_admin_invitations WHERE id=p_invitation FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF invitation.accepted_at IS NOT NULL THEN RETURN 'already_accepted'; END IF;
  IF invitation.revoked_at IS NOT NULL THEN RETURN 'revoked'; END IF;
  PERFORM 1 FROM pack1_admins WHERE auth_user_id=p_actor AND role='owner' FOR SHARE;
  IF NOT FOUND THEN RETURN 'forbidden'; END IF;
  UPDATE pack1_admin_invitations SET revoked_at=now(),revoked_by=p_actor WHERE id=p_invitation;
  INSERT INTO pack1_admin_audit(event_type,actor_auth_user_id,invitation_id,recipient_email)
    VALUES('invite_revoked',p_actor,p_invitation,invitation.recipient_email);
  RETURN 'revoked';
END;$pack1$;

CREATE OR REPLACE FUNCTION pack1_revoke_admin_member(p_actor uuid,p_target uuid)
RETURNS text LANGUAGE plpgsql VOLATILE AS $pack1$
DECLARE
  target_role text;
  target_email text;
BEGIN
  IF p_actor IS NULL OR p_target IS NULL OR p_actor=p_target THEN RETURN 'forbidden'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pack1_admins WHERE auth_user_id=p_actor AND role='owner')
    THEN RETURN 'forbidden'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_target::text,0));
  SELECT role INTO target_role FROM pack1_admins WHERE auth_user_id=p_target FOR UPDATE;
  IF target_role IS NULL THEN RETURN 'not_found'; END IF;
  IF target_role='owner' THEN RETURN 'owner_protected'; END IF;
  PERFORM 1 FROM pack1_admins WHERE auth_user_id=p_actor AND role='owner' FOR SHARE;
  IF NOT FOUND THEN RETURN 'forbidden'; END IF;
  SELECT lower(btrim(email)) INTO target_email FROM neon_auth."user" WHERE id=p_target;
  UPDATE pack1_admin_invitations SET revoked_at=now(),revoked_by=p_actor
    WHERE recipient_email=target_email AND accepted_at IS NULL AND revoked_at IS NULL;
  DELETE FROM pack1_admins WHERE auth_user_id=p_target AND role='admin';
  INSERT INTO pack1_admin_audit(event_type,actor_auth_user_id,target_auth_user_id,recipient_email)
    VALUES('admin_revoked',p_actor,p_target,target_email);
  RETURN 'revoked';
END;$pack1$;

-- The legacy 0011 invitation table is unused, retained as inert historical data.
-- Do not resurrect its unbound claim path.
