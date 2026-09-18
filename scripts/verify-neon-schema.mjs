// Read-only prerequisite check; never silently apply migrations during deployment.
import assert from 'node:assert/strict';
import {query} from '../worker/growth-function.js';
import {verifyServingStatistics} from '../worker/serving-statistics.mjs';
const result=await query(`SELECT
  to_regclass('player_request_limits') IS NOT NULL limits,
  to_regclass('entitlement_grants') IS NOT NULL capabilities,
  to_regclass('corpus_status_events') IS NOT NULL corpus_lifecycle,
  EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='draft_run_account_daily_unique') account_daily,
  (SELECT count(*)=3 FROM pg_indexes WHERE indexname IN ('draft_run_serving_window_idx','draft_run_serving_source_idx','draft_run_rating_band_idx')) indexes,
  (SELECT count(*)=3 FROM information_schema.columns WHERE table_schema='public' AND
    ((table_name='draft_run_sessions' AND column_name IN ('result_persisted_at','daily_featured_sets')) OR (table_name='draft_run_schedules' AND column_name='daily_featured_sets'))) columns,
  (SELECT count(*)=2 FROM pg_constraint WHERE conname IN ('draft_run_sessions_puzzle_ids_check','draft_run_schedules_puzzle_ids_check')
    AND pg_get_constraintdef(oid) ~ '\\m8\\M' AND pg_get_constraintdef(oid) ~ '\\m10\\M') lengths,
  position('jsonb_array_length(s.puzzle_ids)' in pg_get_viewdef('draft_run_measurements'::regclass))>0 measurements`);
for(const [name,value] of Object.entries(result.rows[0]))assert.equal(value,'t',`Missing release schema prerequisite: ${name}; apply the reviewed pending migrations through 0018 first.`);
await verifyServingStatistics(query);
console.log('Neon schema and serving-statistics prerequisites verified.');
