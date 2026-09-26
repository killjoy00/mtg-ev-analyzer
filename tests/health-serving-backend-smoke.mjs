// Execute only through the isolated database gate, never against production.
// /health must fail for a Live environment with nothing to serve, and must not
// fail for a Candidate catalog set that is intentionally non-serving.
import fs from 'node:fs';
import assert from 'node:assert/strict';
if(!process.argv.includes('--dev-fixtures'))throw Error('An isolated development branch is required.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {query}=await import('../worker/growth-function.js');
const {default:api}=await import('../worker/draft-run-function.mjs');
const {DRAFT_RUN_CORPUS_VERSION}=await import('../draft-run.mjs');
const {DRAFT_RUN_SELECTION_VERSION}=await import('../draft-run-policy.mjs');
const health=async()=>{const r=await api.fetch(new Request('https://packone.pro/health'));return {status:r.status,body:await r.json()};};
const statuses=async ids=>new Map((await query('SELECT set_id,status FROM draft_run_environment_policy WHERE set_id=ANY($1::text[])',
 [`{${ids.map(id=>`"${id}"`).join(',')}}`])).rows.map(r=>[r.set_id,r.status]));

const before=await health();
assert.equal(before.body.ok,before.status===200,'ok and HTTP status must agree');
const live=(await query(`SELECT p.set_id FROM draft_run_environment_policy p JOIN corpus_set_versions v ON v.set_id=p.set_id
 WHERE v.corpus_version=$1 AND p.status='Live'`,[DRAFT_RUN_CORPUS_VERSION])).rows.map(r=>r.set_id);
assert.equal(before.body.live_sets,live.length);
const reported=await statuses([...before.body.missing_sets,...before.body.non_serving_sets]);
for(const id of before.body.missing_sets)assert.equal(reported.get(id),'Live',`${id}: only a Live environment can be missing`);
for(const id of before.body.non_serving_sets)assert.notEqual(reported.get(id),'Live',`${id}: a Live environment is never reported as non-serving`);
assert.deepEqual(before.body.missing_sets,[],'Every Live environment in the cloned corpus serves');

// A Live environment with nothing to serve is a real serving hole.
const qa='qa-health-'+crypto.randomUUID().slice(0,8);
try {
 await query('INSERT INTO draft_run_verified_sets(set_id,corpus_version,manifest) VALUES($1,$2,$3::jsonb)',[qa,DRAFT_RUN_CORPUS_VERSION,JSON.stringify({discovered:true,regular_run:false})]);
 await query(`INSERT INTO draft_run_environment_policy(set_id,regular_run,maximum_pick,daily_weight,selection_version,status,set_name,source_event_type)
  VALUES($1,false,8,1,$2,'Live','QA empty environment','PremierDraft')`,[qa,DRAFT_RUN_SELECTION_VERSION]);
 const hole=await health();
 assert.equal(hole.status,503);
 assert.equal(hole.body.ok,false);
 assert.deepEqual(hole.body.missing_sets,[qa]);
 assert.equal(hole.body.live_sets,live.length+1);
} finally {
 await query('DELETE FROM draft_run_environment_policy WHERE set_id=$1',[qa]);
 await query('DELETE FROM corpus_set_versions WHERE set_id=$1',[qa]);
 await query('DELETE FROM draft_run_verified_sets WHERE set_id=$1',[qa]);
}
const after=await health();
assert.equal(after.status,before.status);
console.log(JSON.stringify({smoke:'health_serving',status:before.status,live_sets:before.body.live_sets,non_serving_sets:before.body.non_serving_sets}));
