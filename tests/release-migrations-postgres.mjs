// Runs only against the guarded, disposable local PostgreSQL fixture.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import assert from 'node:assert/strict';
import {fixturePool} from './support/postgres-fixture.mjs';
import {verifyLabQueue} from './support/lab-postgres-contract.mjs';
import {applyReleaseMigrations as applyReleaseMigrationsCore,runNontransactionalPsql} from '../scripts/apply-release-migrations.mjs';
import {verifyBaselineSchema} from '../scripts/migration-schema.mjs';
// Mirror the production guarded migration executor: concurrent indexes must
// be built by a separate psql session outside the ledger transaction. This
// runs only against fixturePool's guarded local disposable PostgreSQL URL.
const applyReleaseMigrations=(client,options={})=>applyReleaseMigrationsCore(client,{
  runNontransactional:file=>runNontransactionalPsql(file,{databaseUrl:process.env.PACK1_TEST_DATABASE_URL}),
  ...options,
});
const pool=fixturePool(),client=await pool.connect();
const baseline=JSON.parse(fs.readFileSync('migrations/baseline.json'));
const manifest=JSON.parse(fs.readFileSync('migrations/manifest.json'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'migration-ledger-'));
fs.cpSync('migrations',root+'/migrations',{recursive:true});
const q=(...a)=>client.query(...a);
const state=async()=>JSON.stringify((await q(`SELECT revision,
 (SELECT count(*) FROM draft_run_readiness_jobs) jobs,
 (SELECT count(*) FROM draft_run_serving_snapshots) snapshots,
 (SELECT md5(coalesce(string_agg(to_jsonb(s)::text,'' ORDER BY s.id),'')) FROM draft_run_sessions s) runs,
 (SELECT md5(coalesce(string_agg(to_jsonb(s)::text,'' ORDER BY s.day,s.environment),'')) FROM draft_run_schedules s) dailies,
 (SELECT md5(coalesce(string_agg(to_jsonb(s)::text,'' ORDER BY s.id),'')) FROM game_results s) scores,
 (SELECT md5(coalesce(string_agg(to_jsonb(s)::text,'' ORDER BY s.id),'')) FROM draft_run_shares s) shares
 FROM draft_run_serving_revision`)).rows);
const revision=async()=>BigInt((await q('SELECT revision FROM draft_run_serving_revision')).rows[0].revision);
try {
 // Retain a legacy stored replay of a completed fixture run, so preservation
 // cannot pass vacuously against an empty shares table.
 await q(`INSERT INTO draft_run_shares(id,session_id,display_name,score,puzzle_ids)
   SELECT 'dddddddddddddddddddddddd',id,'Fixture replay',score,puzzle_ids
   FROM draft_run_sessions WHERE score IS NOT NULL ORDER BY id LIMIT 1
   ON CONFLICT(session_id) DO NOTHING`);
 const histories=(await q(`SELECT
   EXISTS(SELECT 1 FROM draft_run_sessions) runs,
   EXISTS(SELECT 1 FROM draft_run_schedules) dailies,
   EXISTS(SELECT 1 FROM game_results) scores,
   EXISTS(SELECT 1 FROM draft_run_shares) replays`)).rows[0];
 assert.ok(Object.values(histories).every(Boolean),'All preserved history fixtures must be populated');
 // prepare-test-database applies the complete current manifest before this
 // suite. Recreate the frozen production baseline for the first-ledger test:
 // 0074's known new trigger must be absent until the release runner installs it.
 // Prove the real baseline verifier rejects it before changing the fixture.
 await assert.rejects(verifyBaselineSchema(q,baseline.schema),/Unreviewed baseline triggers:.*pack1_results_on_deletion/);
 await q('DROP TRIGGER pack1_results_on_deletion ON account_deletion_operations');
 await q('DROP TRIGGER pack1_patreon_weekly_on_deletion ON account_deletion_operations');
 await q('DROP TRIGGER pack1_patreon_season_on_deletion ON account_deletion_operations');
 // Recreate the original baseline, then prove 0085 restores this new trigger.
 await q('DROP TRIGGER pack1_lab_task_immutable ON pack1_lab_task_jobs');
 const before=await state();
 const first=await applyReleaseMigrations(client,{baseline});
 // Every release migration after the frozen baseline executes once.
 const afterBaseline=manifest.release_paths['secure-auth-release'].migrations.filter(m=>!Object.hasOwn(baseline.migrations,m));
 assert.deepEqual(afterBaseline,['0067_restore_serving_invalidation.sql','0068_puzzle_selection_features.sql','0069_v6_colour_components.sql','0070_v6_bridge_baseline_membership.sql','0071_habits_completed_covering_index.sql','0072_admin_trends_completed_covering_index.sql','0073_habits_acquisition_first_touch_idx.sql','0074_results_privacy_controls.sql','0075_results_privacy_launch.sql','0076_results_email_delivery.sql','0077_clear_easy_features.sql','0078_separate_news_email_consent.sql','0079_results_news_audience_guard.sql','0080_public_standings_eligibility.sql','0081_private_patreon_weekly_receipts.sql','0082_weekly_publisher_pairing.sql','0083_private_patreon_season_receipts.sql','0084_automatic_midseason_schedule.sql','0085_pack_one_lab.sql']);
 assert.equal(first.applied,afterBaseline.length);
 assert.equal((await q("SELECT count(*)::int n FROM pg_trigger WHERE tgname='pack1_lab_task_immutable' AND tgrelid='public.pack1_lab_task_jobs'::regclass AND tgenabled='O'")).rows[0].n,1,'Reviewed release restores the Lab task immutability guard');
 assert.equal((await q("SELECT count(*)::int n FROM pg_trigger WHERE tgname='pack1_results_on_deletion' AND tgenabled='O'")).rows[0].n,1,'Reviewed release restores the deletion publication-removal guard');
 assert.equal((await q("SELECT count(*)::int n FROM pg_trigger WHERE tgname='pack1_patreon_weekly_on_deletion' AND tgenabled='O'")).rows[0].n,1,'Reviewed release restores pending Patreon deletion capture');
 assert.equal((await q("SELECT count(*)::int n FROM pg_trigger WHERE tgname='pack1_patreon_season_on_deletion' AND tgenabled='O'")).rows[0].n,1,'Reviewed release restores season pending deletion capture');
 assert.deepEqual(await applyReleaseMigrations(client,{baseline}),{applied:0,skipped:manifest.release_paths['secure-auth-release'].migrations.length});
 assert.equal(await state(),before,'Actual release plan must preserve serving/readiness and historical results');
 await verifyLabQueue(client);
 assert.equal(await state(),before,'Lab contract rolls back all fixture changes');
 // Two independent sessions are serialized by the ledger advisory lock.
 const other=await pool.connect();
 try {const result=await Promise.all([applyReleaseMigrations(client,{baseline}),applyReleaseMigrations(other,{baseline})]);assert.ok(result.every(r=>r.applied===0));}finally{other.release();}
 // The baseline rejects obsolete/unknown triggers before recording application.
 await q('BEGIN');
 await q('DROP TRIGGER pack1_results_on_deletion ON account_deletion_operations');
 await q("CREATE TRIGGER obsolete_replay AFTER UPDATE ON draft_run_environment_policy FOR EACH STATEMENT EXECUTE FUNCTION pack1_invalidate_serving_inputs()");
 await assert.rejects(verifyBaselineSchema(q,baseline.schema),/Unreviewed baseline triggers:.*obsolete_replay/);
 await q('ROLLBACK');
 const victim=(await q('SELECT p.* FROM draft_run_verified_puzzles p JOIN draft_run_serving_inventory i USING(puzzle_id) ORDER BY p.puzzle_id LIMIT 1')).rows[0];
 assert.ok(victim);
 const invalidates=async(action)=>{await q('BEGIN');try{const old=await revision();await action();assert.ok(await revision()>old);}finally{await q('ROLLBACK');}};
 await invalidates(()=>q("UPDATE draft_run_environment_policy SET status='Paused' WHERE set_id=$1",[victim.set_id]));
 await invalidates(()=>q("INSERT INTO corpus_source_exclusions(set_id,corpus_version,source_draft_hash,reason,evidence) VALUES($1,$2,$3,'fixture','{}')",[victim.set_id,victim.corpus_version,victim.source_draft_hash]));
 await invalidates(()=>q("UPDATE draft_run_verified_puzzles SET interesting=false WHERE puzzle_id=$1",[victim.puzzle_id]));
 await invalidates(()=>q("UPDATE draft_run_puzzle_ratings SET rating=CASE WHEN rating=100 THEN 99 ELSE rating+1 END WHERE puzzle_id=$1",[victim.puzzle_id]));
 // A transaction deliberately coalesces multiple input edits into one bump.
 // Prepare the paused fixture in a separate committed transaction, then test a
 // genuine activation. All mutations are confined to this disposable database.
 await q("UPDATE draft_run_environment_policy SET status='Paused' WHERE set_id=$1",[victim.set_id]);
 try {await invalidates(()=>q("UPDATE draft_run_environment_policy SET status='Live' WHERE set_id=$1",[victim.set_id]));}
 finally {await q("UPDATE draft_run_environment_policy SET status='Live' WHERE set_id=$1",[victim.set_id]);}
 await invalidates(async()=>{
   const p=victim.payload;
   const report=(await q(`INSERT INTO draft_run_decision_reports(puzzle_id,set_id,pick_number,round_number,selected_card_id,selected_card_name,reason,environment,corpus_version,scoring_version,client_platform)
    VALUES($1,$2,$3,1,$4,$5,'uninteresting','mixed',$6,'fixture','web') RETURNING id`,[victim.puzzle_id,victim.set_id,victim.pick_number,p.candidates[0].id,p.candidates[0].name,victim.corpus_version])).rows[0].id;
   await q("SELECT pack1_moderate_reported_pick($1,true,0,'fixture','22222222-2222-4222-8222-222222222222')",[report]);
   const removed=await revision();
   await q("SELECT pack1_moderate_reported_pick($1,false,1,'fixture','22222222-2222-4222-8222-222222222222')",[report]);
   assert.equal(await revision(),removed,'Removal and restoration in one transaction coalesce');
 });
 const add=(name,sql)=>{fs.writeFileSync(root+'/migrations/'+name,sql);return {...manifest,ordered:[...manifest.ordered,name],release_paths:{'secure-auth-release':{migrations:[...manifest.release_paths['secure-auth-release'].migrations,name]}}};};
 const failed='9998_fixture_failure.sql',failedManifest=add(failed,'CREATE TABLE fixture_rollback(id int); SELECT 1/0;');
 await assert.rejects(applyReleaseMigrations(client,{root,baseline,manifest:failedManifest}));
 assert.equal((await q("SELECT to_regclass('fixture_rollback') table_name")).rows[0].table_name,null);
 assert.equal((await q('SELECT name FROM pack1_applied_migrations WHERE name=$1',[failed])).rows.length,0);
 const escape='9997_fixture_transaction_escape.sql';
 const escapePlan=add(escape,'CREATE TABLE fixture_early_commit(id int); COMMIT; -- would split a naive wrapper\nSELECT 1/0;');
 await assert.rejects(applyReleaseMigrations(client,{root,baseline,manifest:escapePlan}));
 assert.equal((await q("SELECT to_regclass('fixture_early_commit') name")).rows[0].name,null,'Transaction control cannot escape DDL/ledger atomicity');
 const include='9996_fixture_include.sql',includePlan=add(include,'\\ir ../unhashed.sql');
 await assert.rejects(applyReleaseMigrations(client,{root,baseline,manifest:includePlan,runNontransactional:()=>{throw Error('Must not execute');}}),/psql meta-commands/);
 const nontransaction='9999_fixture_concurrent.sql',concurrent=add(nontransaction,'CREATE INDEX CONCURRENTLY fixture_index ON players(id);');
 let attempts=0;await assert.rejects(applyReleaseMigrations(client,{root,baseline,manifest:concurrent,runNontransactional:()=>{attempts++;throw Error('interrupted build');}}));
 await assert.rejects(applyReleaseMigrations(client,{root,baseline,manifest:concurrent,runNontransactional:()=>{attempts++;}}),/Incomplete migration/);assert.equal(attempts,1);
 await q('DELETE FROM pack1_applied_migrations WHERE name=$1',[nontransaction]);
 fs.appendFileSync(root+'/migrations/'+Object.keys(baseline.migrations)[0],'\n-- changed');
 await assert.rejects(applyReleaseMigrations(client,{root,baseline}),/Immutable migration changed/);
 const history=s=>JSON.parse(s).map(({revision,jobs,snapshots,...saved})=>saved);
 assert.deepEqual(history(await state()),history(before),'Real input edits preserve all saved history');
 console.log('PASS: real release-plan idempotence, baseline drift, concurrent runners, rollback, failed concurrent build, historical preservation and source/removal/rating/activation invalidation.');
} finally {await q('ROLLBACK').catch(()=>{});client.release();await pool.end();fs.rmSync(root,{recursive:true,force:true});}
