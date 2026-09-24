// Read-only prerequisite check; never silently apply migrations during deployment.
import assert from 'node:assert/strict';
import {query} from '../worker/growth-function.js';
import {verifyServingStatistics} from '../worker/serving-statistics.mjs';
const result=await query(`SELECT
  (SELECT count(*)=2 FROM pg_constraint WHERE conname IN ('draft_run_sessions_environment_check','draft_run_schedules_environment_check') AND pg_get_constraintdef(oid) LIKE '%latest%') latest_daily,
  (SELECT count(*)=2 FROM information_schema.columns WHERE table_name IN ('draft_run_sessions','draft_run_schedules') AND column_name='serving_policy_version') serving_policy,
  to_regclass('draft_run_rating_serving_lookup_idx') IS NOT NULL serving_quality_lookup,
  EXISTS(SELECT 1 FROM pg_constraint WHERE conname='draft_run_source_evidence_required' AND pg_get_constraintdef(oid) LIKE '%traditional-premier-v3-phase2-v1%') traditional_phase2_components,
  EXISTS(SELECT 1 FROM pg_constraint WHERE conname='draft_run_source_evidence_required' AND pg_get_constraintdef(oid) LIKE '%traditional-premier-v4-phase2-v1%' AND pg_get_constraintdef(oid) LIKE '%traditional-cube-p2p7-v4-v1%' AND pg_get_constraintdef(oid) LIKE '%strong-player-colour-stage-v4%') traditional_v4_components,
  EXISTS(SELECT 1 FROM pg_constraint WHERE conname='corpus_components_version_model_check' AND pg_get_constraintdef(oid) LIKE '%traditional-premier-v4-phase2-v1%' AND pg_get_constraintdef(oid) LIKE '%elite-trophy-colour-stage-v8%') traditional_v4_component_identity,
  to_regclass('corpus_source_exclusions') IS NOT NULL source_eligibility,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='corpus_status_events' AND column_name='admin_identity') corpus_admin_identity,
  to_regclass('corpus_components') IS NOT NULL source_components,
  to_regclass('draft_run_source_measurements') IS NOT NULL source_measurements,
  to_regclass('corpus_set_versions') IS NOT NULL corpus_versions,
  to_regclass('corpus_health_checks') IS NOT NULL corpus_health,
  to_regclass('corpus_trophy_trajectories') IS NOT NULL corpus_provenance,
  to_regclass('corpus_sources') IS NOT NULL corpus_sources,
  to_regclass('player_request_limits') IS NOT NULL limits,
  to_regclass('entitlement_grants') IS NOT NULL capabilities,
  to_regclass('account_sessions') IS NOT NULL account_sessions,
  to_regclass('account_recovery_rate_limits') IS NOT NULL account_recovery_rate_limits,
  to_regclass('account_credential_rate_limits') IS NOT NULL account_credential_rate_limits,
  to_regclass('account_deletion_operations') IS NOT NULL account_deletion_operations,
  to_regclass('account_deletion_verifications') IS NOT NULL account_deletion_verifications,
  to_regclass('mobile_oauth_handoffs') IS NOT NULL mobile_oauth_handoffs,
  EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='mobile_oauth_handoffs_expiry_idx') mobile_oauth_handoffs_expiry_index,
  (SELECT count(*)=4 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='account_deletion_verifications'
      AND column_name IN ('auth_user_id','code_hmac','created_at','expires_at')) account_deletion_verification_columns,
  EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='account_deletion_verifications'::regclass AND contype='p') account_deletion_verification_primary_key,
  EXISTS(SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='account_deletion_verifications_expiry_idx') account_deletion_verification_expiry_index,
  to_regprocedure('pack1_identity_attachment_allowed(uuid)') IS NOT NULL account_deletion_identity_guard,
  to_regprocedure('pack1_begin_account_deletion(uuid,uuid)') IS NOT NULL account_deletion_begin_function,
  EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='account_deletion_player_tombstone_uq') account_deletion_player_tombstone,
  to_regprocedure('pack1_username_key(text)') IS NOT NULL username_key_function,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='username_owned') username_ownership,
  EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='players_username_uq') unique_usernames,
  (SELECT pg_get_functiondef('merge_pack1_player(uuid,uuid)'::regprocedure) LIKE '%username_owned%') username_safe_merge,
  EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='account_deletion_operations'::regclass AND pg_get_constraintdef(oid) LIKE '%operator_review%') account_deletion_states,
  EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='account_credential_rate_limits'::regclass AND pg_get_constraintdef(oid) LIKE '%account_delete_init%') account_deletion_limits,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='account_sessions' AND column_name='csrf_hash') account_session_csrf,
  to_regclass('provider_accounts') IS NOT NULL provider_accounts,
  to_regclass('provider_oauth_states') IS NOT NULL provider_oauth_states,
  to_regclass('provider_webhook_receipts') IS NOT NULL provider_webhook_receipts,
  to_regclass('corpus_status_events') IS NOT NULL corpus_lifecycle,
  EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='draft_run_account_daily_unique') account_daily,
  to_regclass('draft_run_seasons') IS NOT NULL draft_run_seasons,
  EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='draft_run_seasons_current_uq') single_current_season,
  to_regclass('draft_run_season_reconciliation_state') IS NOT NULL season_reconcile_state,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='draft_run_season_reconciliation_state' AND column_name='last_reconciled_day') season_reconcile_watermark,
  to_regprocedure('pack1_reconcile_draft_run_seasons()') IS NOT NULL season_reconcile,
  position('last_reconciled_day' in pg_get_functiondef('pack1_reconcile_draft_run_seasons()'::regprocedure))>0 season_reconcile_incremental,
  (SELECT count(*)=3 FROM pg_indexes WHERE indexname IN ('draft_run_serving_window_idx','draft_run_serving_source_idx','draft_run_rating_band_idx')) indexes,
  (SELECT count(*)=3 FROM information_schema.columns WHERE table_schema='public' AND
    ((table_name='draft_run_sessions' AND column_name IN ('result_persisted_at','daily_featured_sets')) OR (table_name='draft_run_schedules' AND column_name='daily_featured_sets'))) columns,
  (SELECT count(*)=2 FROM pg_constraint WHERE conname IN ('draft_run_sessions_puzzle_ids_check','draft_run_schedules_puzzle_ids_check')
    AND pg_get_constraintdef(oid) ~ '\\m8\\M' AND pg_get_constraintdef(oid) ~ '\\m10\\M') lengths,
  position('jsonb_array_length(s.puzzle_ids)' in pg_get_viewdef('draft_run_measurements'::regclass))>0 measurements,
  position('America/Los_Angeles' in pg_get_viewdef('analytics_retention_cohorts'::regclass))>0 retention_cohorts_pacific,
  position('America/Los_Angeles' in pg_get_viewdef('analytics_daily_next_day_retention'::regclass))>0 daily_retention_pacific,
  position('America/New_York' in pg_get_viewdef('analytics_retention_cohorts'::regclass))=0 retention_cohorts_not_eastern,
  position('America/New_York' in pg_get_viewdef('analytics_daily_next_day_retention'::regclass))=0 daily_retention_not_eastern`);
// Worker SQL references `username_owned` and `pack1_username_key` on the
// session and profile paths, so 0033 has to land before the code that reads it.
for(const [name,value] of Object.entries(result.rows[0]))assert.equal(value,'t',`Missing release schema prerequisite: ${name}; apply the reviewed pending migrations through 0038 first.`);
await verifyServingStatistics(query);
console.log('Neon schema and serving-statistics prerequisites verified.');
