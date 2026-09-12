// Controlled aggregate arithmetic and review-detail checks; development only.
import fs from 'node:fs';import assert from 'node:assert/strict';
if(!process.argv.includes('--dev-fixtures'))throw Error('Requires an isolated development connection and --dev-fixtures.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {query,readJson}=await import('../worker/growth-function.js');
const {handleAdmin}=await import('../worker/measurement-admin.mjs');
const user=crypto.randomUUID(),token=crypto.randomUUID(),version='math-'+crypto.randomUUID().slice(0,8);let ids=[];
try {
 await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,false)',[user,'QA report math',`qa-math-${user}@example.invalid`]);
 await query('INSERT INTO neon_auth.session(id,"userId",token,"updatedAt","expiresAt") VALUES($1::uuid,$2::uuid,$3,now(),now()+interval \'1 hour\')',[crypto.randomUUID(),user,token]);
 await query('INSERT INTO pack1_admins(auth_user_id) VALUES($1::uuid)',[user]);
 const source=(await query('SELECT * FROM draft_run_sessions WHERE selection_version=\'first-pack-v2\' ORDER BY created_at DESC LIMIT 1')).rows[0];
 const puzzleIds=JSON.parse(source.puzzle_ids),puzzle=(await query('SELECT payload FROM draft_run_verified_puzzles WHERE puzzle_id=$1',[puzzleIds[0]])).rows[0];const p=JSON.parse(puzzle.payload);
 const data=Array.from({length:5},(_,i)=>({id:crypto.randomUUID(),player:crypto.randomUUID(),score:[100,100,20,50,80][i],match:i<2,selected:i<2?p.historical_pick_id:p.candidates.find(c=>c.id!==p.historical_pick_id).id,ms:(i+1)*1000}));ids=data.map(x=>x.id);
 await query(`WITH data AS (SELECT * FROM jsonb_to_recordset($1::jsonb) d(id uuid,player uuid,score int,match boolean,selected text,ms int)),
 players_added AS (INSERT INTO players(id,display_name) SELECT player,'Report math fixture' FROM data),
 sessions_added AS (INSERT INTO draft_run_sessions(id,player_id,seed,corpus_version,scoring_version,puzzle_ids,seen_sources,environment,difficulty_version,selection_version)
 SELECT id,player,id::text,$2,$3,$4::jsonb,'[]'::jsonb,'mixed','support-ratio-v1',$5 FROM data RETURNING id)
 INSERT INTO draft_run_decision_observations(session_id,revision,round,puzzle_id,observed,outcome,answered_at,selected_id,score,trophy_match,active_ms)
 SELECT d.id,0,1,$6,true,'pick',now(),d.selected,d.score,d.match,d.ms FROM data d JOIN sessions_added s ON s.id=d.id`,[JSON.stringify(data),source.corpus_version,source.scoring_version,source.puzzle_ids,version,puzzleIds[0]]);
 const report=await handleAdmin(new Request('https://packone.pro/v1/admin/measurements?version='+version,{headers:{'x-pack1-auth-session':token}}),query,readJson);
 assert.equal(Number(report.summary.answers),5);assert.equal(Number(report.summary.trophy_match_pct),40);assert.equal(Number(report.summary.average_partial_credit),50);assert.equal(Number(report.summary.median_seconds),3);assert.equal(Number(report.summary.p90_seconds),4.6);assert.equal(report.reviews.length,1);
 const detail=await handleAdmin(new Request('https://packone.pro/v1/admin/decisions/'+puzzleIds[0]+'?version='+version,{headers:{'x-pack1-auth-session':token}}),query,readJson);
 assert.equal(detail.choices.reduce((n,r)=>n+Number(r.answers),0),5);
 const empty=await handleAdmin(new Request('https://packone.pro/v1/admin/measurements?version='+version+'&difficulty=invalid',{headers:{'x-pack1-auth-session':token}}),query,readJson).catch(e=>e.status);assert.equal(empty,400);
 console.log('PASS: five known answers yield 40% matches, 50 average partial credit, 3s median, 4.6s P90, one review decision, and five detail choices.');
} finally {
 if(ids.length)await query('UPDATE draft_run_sessions SET measurement_qa=true WHERE id=ANY($1::uuid[])',['{'+ids.join(',')+'}']);
 await query('DELETE FROM pack1_admins WHERE auth_user_id=$1::uuid',[user]);await query('DELETE FROM neon_auth.session WHERE token=$1',[token]);
}
