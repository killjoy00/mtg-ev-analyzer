import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID,createHash,createHmac} from 'node:crypto';
import {verifyTarget} from './practice-performance.mjs';
import {ensureDailySchedule} from '../worker/draft-run-daily.mjs';
import {loadServingSnapshot,loadCachedCustomSetMetadata} from '../worker/draft-run-selection.mjs';
import {draftRunLeaderboardRows,currentSeasonForPlayer} from '../worker/draft-run-season.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {gameDateKey} from '../game-date.mjs';

async function main() {

const branch=process.env.PREVIEW_BRANCH,connection=process.env.DATABASE_URL,key=process.env.NEON_API_KEY;
const control=async suffix=>{
  const r=await fetch('https://console.neon.tech/api/v2/projects/patient-shadow-91417882/branches/'+branch+suffix,{
    headers:{authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(30000),
  });
  if(!r.ok)throw Error('Cannot verify isolated load target.');return r.json();
};
const [b,e]=await Promise.all([control(''),control('/endpoints')]);
const endpoint=verifyTarget({branch,connection,branchRecord:b.branch,endpoints:e.endpoints||[]});
if(Number(endpoint.autoscaling_limit_max_cu)>8)throw Error('Load branch exceeds compute budget.');
if(process.env.PREVIEW_CREATED!=='true')throw Error('Fresh disposable branch required.');
const {query}=await import('../worker/growth-function.js');
const tag=randomBytes(4).toString('hex'),digest=x=>createHash('sha256').update(x).digest('hex');
const secret=(await query("SELECT value FROM settings WHERE key='player_secret'")).rows[0].value;
// Fixture identities and tokens never leave the runner. No auth, email, billing
// or provider APIs are invoked. All data disappears with the isolated branch.
const users=Array.from({length:1000},(_,i)=>{
  const player=randomUUID(),auth=randomUUID(),account=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
  return {player,auth,account,csrf,account_hash:digest(account),csrf_hash:digest(csrf),name:'Load'+tag+'x'+i,
    token:'p1_'+player+'.'+createHmac('sha256',secret).update(player).digest('base64url')};
});
const data=JSON.stringify(users.map(({account,csrf,token,...stored})=>stored));
await query(`INSERT INTO neon_auth."user"(id,name,email,"emailVerified")
  SELECT (u->>'auth')::uuid,u->>'name',(u->>'auth')||'@example.invalid',true FROM jsonb_array_elements($1::jsonb) u`,[data]);
await query(`INSERT INTO players(id,display_name,username_owned,profile_public)
  SELECT (u->>'player')::uuid,u->>'name',true,true FROM jsonb_array_elements($1::jsonb) u`,[data]);
await query(`INSERT INTO account_links(auth_user_id,player_id)
  SELECT (u->>'auth')::uuid,(u->>'player')::uuid FROM jsonb_array_elements($1::jsonb) u`,[data]);
await query(`INSERT INTO account_sessions(session_hash,auth_user_id,csrf_hash,expires_at)
  SELECT u->>'account_hash',(u->>'auth')::uuid,u->>'csrf_hash',now()+interval '2 hours' FROM jsonb_array_elements($1::jsonb) u`,[data]);
await query(`INSERT INTO entitlement_grants(auth_user_id,capability,provider,provider_reference)
  SELECT (u->>'auth')::uuid,c,'isolated-load',$2 FROM jsonb_array_elements($1::jsonb) u
  CROSS JOIN unnest(ARRAY['unlimited_cube_practice','custom_corpus']) c`,[data,tag]);
const today=gameDateKey();
await query(`INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,selections_json,details_json)
  SELECT (u->>'player')::uuid,$2::date-d,environment,'draft_run',(50+d%45)::smallint,'B','[]'::jsonb,'{"isolated_load":true}'::jsonb
  FROM jsonb_array_elements($1::jsonb) u CROSS JOIN generate_series(1,30) d
  CROSS JOIN unnest(ARRAY['mixed','powered-cube','latest']) environment`,[data,today]);
await query('ANALYZE scores');await query('ANALYZE players');await query('ANALYZE account_links');
for(const environment of ['mixed','powered-cube','latest'])await ensureDailySchedule(query,today,environment);
await loadServingSnapshot(query,DRAFT_RUN_CORPUS_VERSION);
const sets=await loadCachedCustomSetMetadata(query,DRAFT_RUN_CORPUS_VERSION,today);
const artifact='artifacts/launch-load';fs.mkdirSync(artifact,{recursive:true});
const records=[];
const measured=async(sql,params)=>{
  const started=performance.now(),result=await query(sql,params),ms=performance.now()-started;
  if(/WITH results AS/.test(sql)) {
    const plan=await query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,params);
    records.push({ms,rows:result.rows.length,plan:JSON.parse(plan.rows[0]['QUERY PLAN'])});
  }
  return result;
};
for(const days of [0,6,29,3650])await draftRunLeaderboardRows(measured,{start:new Date(Date.parse(today+'T12:00:00Z')-days*86400000).toISOString().slice(0,10),end:today,environment:'mixed'});
await currentSeasonForPlayer(measured,users[0].player,{today});
fs.writeFileSync(path.join(artifact,'fixture-report.json'),JSON.stringify({branch,code_sha:process.env.GITHUB_SHA,users:users.length,synthetic_score_rows:users.length*30*3,compute:endpoint.autoscaling_limit_max_cu,standings:records},null,2));
fs.writeFileSync(process.env.LOAD_FIXTURE_FILE,JSON.stringify({branch,sha:process.env.GITHUB_SHA,users,sets:sets.slice(0,3).map(s=>s.set_id)}),{mode:0o600});
console.log('Prepared isolated accounts, entitlements, 90000 score rows, Dailies and serving cache; no provider calls.');

}
main().catch(error=>{console.error(JSON.stringify({error:'Isolated load setup or acceptance failed',code:error.pgCode||error.code||'unknown'}));process.exitCode=1;});
