// Only run against an isolated development branch; no production reports used.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
if(!process.argv.includes('--dev-fixtures'))throw Error('Use an isolated branch and --dev-fixtures.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {query}=await import('../worker/growth-function.js');
const {reportedPickContext}=await import('../worker/report-pick-removal.mjs');
const {loadPuzzleMetadata,servingRevisionMatches}=await import('../worker/draft-run-selection.mjs');
const {DRAFT_RUN_CORPUS_VERSION,DRAFT_RUN_SCORING_VERSION}=await import('../draft-run.mjs');
const {DRAFT_RUN_DIFFICULTY_VERSION}=await import('../draft-run-difficulty.mjs');
const {SERVING_POLICY_VERSION}=await import('../serving-quality.mjs');
const actor=randomUUID(),report=randomUUID(),alias='qa-removal-'+randomUUID();
const p=(await query(`SELECT p.* FROM draft_run_verified_puzzles p JOIN draft_run_serving_inventory i USING(puzzle_id)
 WHERE p.set_id='fra' AND p.pick_number=5 AND NOT EXISTS(SELECT 1 FROM draft_run_pick_removal_members m WHERE m.puzzle_id=p.puzzle_id) AND i.snapshot_id=(SELECT max(id) FROM draft_run_serving_snapshots WHERE corpus_version=$1) LIMIT 1`,[DRAFT_RUN_CORPUS_VERSION])).rows[0];
assert.ok(p,'Fixture requires one serving FRA pick');
const original=typeof p.payload==='string'?JSON.parse(p.payload):p.payload;
// Change source and corpus identities, scoring support and image while keeping
// the exact question intact. These are aliases of the same playable decision.
const copy={...original,puzzle_id:alias,source_draft_hash:randomUUID().replaceAll('-',''),corpus_version:'qa-removal-version',
 candidates:original.candidates.map(c=>({...c,image_url:'https://cards.scryfall.io/changed.jpg',model_probability:1/original.candidates.length}))};
const insertCopy=()=>query(`INSERT INTO draft_run_verified_puzzles SELECT (jsonb_populate_record(NULL::draft_run_verified_puzzles,
 to_jsonb(p)||jsonb_build_object('puzzle_id',$2::text,'source_draft_hash',$3::text,'corpus_version',$4::text,'source_snapshot_id',NULL,'payload',$5::jsonb))).*
 FROM draft_run_verified_puzzles p WHERE puzzle_id=$1`,[p.puzzle_id,alias,copy.source_draft_hash,copy.corpus_version,JSON.stringify(copy)]);
await query(`INSERT INTO draft_run_decision_reports(id,puzzle_id,set_id,pick_number,round_number,selected_card_id,selected_card_name,reason,environment,corpus_version,scoring_version,client_platform)
 VALUES($1::uuid,$2,$3,$4::smallint,1,$5,$6,'uninteresting','mixed',$7,$8,'web')`,
 [report,p.puzzle_id,p.set_id,p.pick_number,original.candidates[0].id,original.candidates[0].name,p.corpus_version,DRAFT_RUN_SCORING_VERSION]);
const act=(removed,revision,reason='Synthetic moderation verification')=>query('SELECT pack1_moderate_reported_pick($1::uuid,$2::boolean,$3::int,$4,$5::uuid) result',[report,removed,revision,reason,actor]);
const context=()=>reportedPickContext(query,report);
const historicalDigest=async()=> (await query("SELECT md5(coalesce(string_agg(to_jsonb(s)::text,'' ORDER BY s.day,s.environment),'')) schedules FROM draft_run_schedules s")).rows[0].schedules;
const historicalBefore=await historicalDigest();
const before=(await context());assert.equal(before.moderation.revision,0);
await assert.rejects(()=>act(true,0,''),e=>e.pgCode==='22023');
const revisionBefore=(await query('SELECT revision FROM draft_run_serving_revision WHERE singleton')).rows[0].revision;
const parallel=await Promise.allSettled([act(true,0),act(true,0)]);
assert.equal(parallel.filter(x=>x.status==='fulfilled').length,1,'Only one competing moderation action commits');
assert.equal(parallel.filter(x=>x.status==='rejected')[0].reason.pgCode,'40001');
const removed=await context();assert.equal(removed.moderation.removed,true);assert.equal(removed.moderation.revision,1);
assert.equal(removed.moderation.history.length,1);assert.equal(removed.moderation.history[0].report_id,report);
assert.equal(await servingRevisionMatches(query,revisionBefore),false,'Removal invalidates an old inventory');
assert.ok((await loadPuzzleMetadata(query,p.corpus_version,[p.puzzle_id]))[0],'Archived exact pick remains readable');
await insertCopy();
assert.equal((await query('SELECT decision_key FROM draft_run_pick_removal_members WHERE puzzle_id=$1',[alias])).rows[0].decision_key,
 (await query('SELECT decision_key FROM draft_run_pick_removal_members WHERE puzzle_id=$1',[p.puzzle_id])).rows[0].decision_key,'Future import cannot reintroduce identical question');
const cache=await query('SELECT pack1_build_serving_snapshot($1,$2,$3) snapshot',[DRAFT_RUN_CORPUS_VERSION,DRAFT_RUN_DIFFICULTY_VERSION,SERVING_POLICY_VERSION]);
const snapshot=JSON.parse(cache.rows[0].snapshot);assert.ok(snapshot.id);
assert.equal((await query('SELECT count(*) n FROM draft_run_serving_inventory WHERE snapshot_id=$1::bigint AND puzzle_id=$2',[snapshot.id,p.puzzle_id])).rows[0].n,'0','Removed pick is absent from new inventory');
assert.equal(await historicalDigest(),historicalBefore,'Fixed schedules are byte-for-byte unchanged');
await assert.rejects(()=>query('UPDATE draft_run_pick_removal_events SET reason=$1 WHERE report_id=$2::uuid',['overwrite',report]),/append-only/);
await act(false,1,'Synthetic restoration verification');
const restored=await context();assert.equal(restored.moderation.removed,false);assert.equal(restored.moderation.revision,2);assert.equal(restored.moderation.history.length,2);
const rebuilt=JSON.parse((await query('SELECT pack1_build_serving_snapshot($1,$2,$3) snapshot',[DRAFT_RUN_CORPUS_VERSION,DRAFT_RUN_DIFFICULTY_VERSION,SERVING_POLICY_VERSION])).rows[0].snapshot);
assert.equal((await query('SELECT count(*) n FROM draft_run_serving_inventory WHERE snapshot_id=$1::bigint AND puzzle_id=$2',[rebuilt.id,p.puzzle_id])).rows[0].n,'1','Eligible restored pick returns');
await assert.rejects(()=>act(true,1),e=>e.pgCode==='40001');
await query('DELETE FROM draft_run_verified_puzzles WHERE puzzle_id=$1',[alias]);
console.log('Report-linked pick removal: competing actions, import aliases, archived reads, inventory exclusion, restoration and append-only history verified.');
