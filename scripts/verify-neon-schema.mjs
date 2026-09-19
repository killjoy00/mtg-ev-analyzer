// Read-only prerequisite check; never silently apply migrations during deployment.
import assert from 'node:assert/strict';
import {query} from '../worker/growth-function.js';
import {verifyServingStatistics} from '../worker/serving-statistics.mjs';
const result=await query(`SELECT
  (SELECT count(*)=2 FROM information_schema.columns WHERE table_name IN ('draft_run_sessions','draft_run_schedules') AND column_name='serving_policy_version') serving_policy,
  to_regclass('draft_run_rating_serving_lookup_idx') IS NOT NULL serving_quality_lookup,
  EXISTS(SELECT 1 FROM pg_constraint WHERE conname='draft_run_source_evidence_required' AND pg_get_constraintdef(oid) LIKE '%traditional-premier-v3-phase2-v1%') traditional_phase2_components,
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
  to_regclass('provider_accounts') IS NOT NULL provider_accounts,
  to_regclass('provider_oauth_states') IS NOT NULL provider_oauth_states,
  to_regclass('provider_webhook_receipts') IS NOT NULL provider_webhook_receipts,
  to_regclass('corpus_status_events') IS NOT NULL corpus_lifecycle,
  EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='draft_run_account_daily_unique') account_daily,
  (SELECT count(*)=3 FROM pg_indexes WHERE indexname IN ('draft_run_serving_window_idx','draft_run_serving_source_idx','draft_run_rating_band_idx')) indexes,
  (SELECT count(*)=3 FROM information_schema.columns WHERE table_schema='public' AND
    ((table_name='draft_run_sessions' AND column_name IN ('result_persisted_at','daily_featured_sets')) OR (table_name='draft_run_schedules' AND column_name='daily_featured_sets'))) columns,
  (SELECT count(*)=2 FROM pg_constraint WHERE conname IN ('draft_run_sessions_puzzle_ids_check','draft_run_schedules_puzzle_ids_check')
    AND pg_get_constraintdef(oid) ~ '\\m8\\M' AND pg_get_constraintdef(oid) ~ '\\m10\\M') lengths,
  position('jsonb_array_length(s.puzzle_ids)' in pg_get_viewdef('draft_run_measurements'::regclass))>0 measurements`);
for(const [name,value] of Object.entries(result.rows[0]))assert.equal(value,'t',`Missing release schema prerequisite: ${name}; apply the reviewed pending migrations through 0026 first.`);
await verifyServingStatistics(query);
console.log('Neon schema and serving-statistics prerequisites verified.');
