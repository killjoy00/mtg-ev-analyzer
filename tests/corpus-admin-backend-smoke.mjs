import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {CORPUS_GATE_VERSION} from '../corpus-quality.mjs';
if(!process.argv.includes('--dev-fixtures'))throw Error('Isolated development branch required.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {query}=await import('../worker/growth-function.js');
const {default:api}=await import('../worker/draft-run-function.mjs');
const user=crypto.randomUUID(),token=crypto.randomUUID();
async function call(path,body,status=200,auth=token){const r=await api.fetch(new Request('https://packone.pro/v1/admin/corpus'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(auth?{'x-pack1-auth-session':auth}:{})},body:body?JSON.stringify(body):undefined}));const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;}
const original=(await query("SELECT status FROM draft_run_environment_policy WHERE set_id='hob'")).rows[0].status;
let check;
try {
 await call('',null,401,null);
 await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,false)',[user,'QA corpus admin',`${user}@example.invalid`]);
 await query('INSERT INTO neon_auth.session(token,"userId","expiresAt","updatedAt") VALUES($1,$2::uuid,now()+interval \'1 hour\',now())',[token,user]);
 await call('',null,403);
 await query('INSERT INTO pack1_admins(auth_user_id) VALUES($1::uuid)',[user]);
 const report=await call('');assert.ok(report.sets.some(s=>s.set_id==='hob'));assert.equal(report.corpus_version,DRAFT_RUN_CORPUS_VERSION);
 const change=(oldStatus,status)=>call('/hob/status',{oldStatus,status,corpusVersion:DRAFT_RUN_CORPUS_VERSION,reason:'QA lifecycle'});
 await change('Live','Paused');
 await call('/hob/status',{oldStatus:'Live',status:'Paused',corpusVersion:DRAFT_RUN_CORPUS_VERSION},409);
 await call('/hob/status',{oldStatus:'Paused',status:'Live',corpusVersion:DRAFT_RUN_CORPUS_VERSION},409);
 check=(await query(`INSERT INTO corpus_health_checks(set_id,corpus_version,manifest_hash,gate_version,ready,report) SELECT set_id,corpus_version,md5(manifest::text),$2,true,'{"fixture":true}' FROM corpus_set_versions WHERE set_id='hob' AND corpus_version=$1 RETURNING id`,[DRAFT_RUN_CORPUS_VERSION,CORPUS_GATE_VERSION])).rows[0].id;
 await change('Paused','Live');
 const audit=(await query('SELECT old_status,new_status,reason FROM corpus_status_events WHERE auth_user_id=$1::uuid ORDER BY id',[user])).rows;
 assert.deepEqual(audit.map(x=>[x.old_status,x.new_status]),[['Live','Paused'],['Paused','Live']]);
 // Staging another version must not erase the version currently serving.
 const manifest=(await query("SELECT corpus_version,manifest FROM draft_run_verified_sets WHERE set_id='hob'")).rows[0];
 await query("UPDATE draft_run_verified_sets SET corpus_version='qa-future-manifest' WHERE set_id='hob'");
 assert.equal((await query("SELECT count(*) n FROM corpus_set_versions WHERE set_id='hob' AND corpus_version=$1",[DRAFT_RUN_CORPUS_VERSION])).rows[0].n,'1');
 await query("UPDATE draft_run_verified_sets SET corpus_version=$1 WHERE set_id='hob'",[manifest.corpus_version]);
 console.log('PASS: Corpus admin authentication, state races, quality gate, atomic audit and version retention.');
} finally {
 await query("UPDATE draft_run_environment_policy SET status=$1 WHERE set_id='hob'",[original]);
 if(check)await query('DELETE FROM corpus_health_checks WHERE id=$1::bigint',[check]);
 await query("DELETE FROM corpus_set_versions WHERE corpus_version='qa-future-manifest'");
 await query('DELETE FROM corpus_status_events WHERE auth_user_id=$1::uuid',[user]);
 await query('DELETE FROM pack1_admins WHERE auth_user_id=$1::uuid',[user]);
 await query('DELETE FROM neon_auth.session WHERE token=$1',[token]);
 await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid',[user]);
}
