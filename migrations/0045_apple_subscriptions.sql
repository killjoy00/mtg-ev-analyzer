-- Apple App Store subscriptions are a distinct entitlement source. The account UUID is also
-- the StoreKit appAccountToken, so a subscription chain can never migrate between accounts.
CREATE TABLE IF NOT EXISTS apple_subscription_entitlements (
  original_transaction_id text PRIMARY KEY CHECK(length(original_transaction_id) BETWEEN 1 AND 128),
  auth_user_id uuid NOT NULL,
  app_account_token uuid NOT NULL,
  product_id text NOT NULL CHECK(product_id='pro.packone.app.elite.monthly'),
  environment text NOT NULL CHECK(environment IN ('Production','Sandbox')),
  status text NOT NULL CHECK(status IN ('active','grace_period','billing_retry','expired','revoked','unknown')),
  expires_at timestamptz,
  auto_renew_enabled boolean,
  last_transaction_id text NOT NULL CHECK(length(last_transaction_id) BETWEEN 1 AND 128),
  last_event_signed_at timestamptz NOT NULL,
  last_notification_uuid uuid,
  last_reconciled_at timestamptz,
  reconcile_attempted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(app_account_token=auth_user_id)
);
CREATE INDEX IF NOT EXISTS apple_subscription_account_idx ON apple_subscription_entitlements(auth_user_id,status,expires_at DESC);
CREATE INDEX IF NOT EXISTS apple_subscription_reconcile_idx ON apple_subscription_entitlements(last_reconciled_at NULLS FIRST,updated_at);
CREATE TABLE IF NOT EXISTS apple_subscription_notifications (
  notification_uuid uuid PRIMARY KEY,
  notification_type text NOT NULL CHECK(length(notification_type) BETWEEN 1 AND 80),
  notification_subtype text,
  environment text CHECK(environment IN ('Production','Sandbox')),
  original_transaction_id text,
  signed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  outcome text NOT NULL CHECK(length(outcome) BETWEEN 1 AND 80)
);
CREATE INDEX IF NOT EXISTS apple_subscription_notification_chain_idx ON apple_subscription_notifications(original_transaction_id,received_at DESC) WHERE original_transaction_id IS NOT NULL;

CREATE OR REPLACE FUNCTION pack1_apply_apple_subscription_state(
 p_auth_user_id uuid,p_app_account_token uuid,p_original_transaction_id text,p_product_id text,p_environment text,
 p_status text,p_expires_at timestamptz,p_auto_renew_enabled boolean,p_last_transaction_id text,p_event_signed_at timestamptz,
 p_notification_uuid uuid DEFAULT NULL)
RETURNS TABLE(applied boolean,account_matches boolean)
LANGUAGE plpgsql AS $$
DECLARE existing apple_subscription_entitlements%ROWTYPE; grant_active boolean;
BEGIN
 IF p_auth_user_id IS NULL OR p_app_account_token IS NULL OR p_auth_user_id<>p_app_account_token THEN RETURN QUERY SELECT false,false; RETURN; END IF;
 SELECT * INTO existing FROM apple_subscription_entitlements WHERE original_transaction_id=p_original_transaction_id FOR UPDATE;
 IF FOUND AND (existing.auth_user_id<>p_auth_user_id OR existing.app_account_token<>p_app_account_token) THEN RETURN QUERY SELECT false,false; RETURN; END IF;
 IF NOT pack1_identity_attachment_allowed(p_auth_user_id) THEN RETURN QUERY SELECT false,true; RETURN; END IF;
 IF FOUND AND existing.last_event_signed_at>p_event_signed_at THEN RETURN QUERY SELECT false,true; RETURN; END IF;
 INSERT INTO apple_subscription_entitlements(original_transaction_id,auth_user_id,app_account_token,product_id,environment,status,expires_at,auto_renew_enabled,last_transaction_id,last_event_signed_at,last_notification_uuid,updated_at)
 VALUES(p_original_transaction_id,p_auth_user_id,p_app_account_token,p_product_id,p_environment,p_status,p_expires_at,p_auto_renew_enabled,p_last_transaction_id,p_event_signed_at,p_notification_uuid,now())
 ON CONFLICT(original_transaction_id) DO UPDATE SET product_id=excluded.product_id,environment=excluded.environment,status=excluded.status,expires_at=excluded.expires_at,auto_renew_enabled=excluded.auto_renew_enabled,last_transaction_id=excluded.last_transaction_id,last_event_signed_at=excluded.last_event_signed_at,last_notification_uuid=COALESCE(excluded.last_notification_uuid,apple_subscription_entitlements.last_notification_uuid),updated_at=now();
 grant_active=p_status IN ('active','grace_period') AND p_expires_at IS NOT NULL AND p_expires_at>now();
 IF grant_active THEN
   INSERT INTO entitlement_grants(auth_user_id,capability,provider,provider_reference,expires_at,revoked_at)
   SELECT p_auth_user_id,capability,'apple-app-store',p_original_transaction_id,p_expires_at,NULL FROM (VALUES ('unlimited_cube_practice'),('custom_corpus')) AS capabilities(capability)
   ON CONFLICT(auth_user_id,capability,provider,provider_reference) DO UPDATE SET expires_at=excluded.expires_at,revoked_at=NULL;
 ELSE
   UPDATE entitlement_grants SET revoked_at=COALESCE(revoked_at,now()) WHERE auth_user_id=p_auth_user_id AND provider='apple-app-store' AND provider_reference=p_original_transaction_id AND revoked_at IS NULL;
 END IF;
 RETURN QUERY SELECT true,true;
END $$;
