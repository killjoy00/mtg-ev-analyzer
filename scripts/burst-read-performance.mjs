import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {selectCachedDatabaseRun} from '../worker/draft-run-selection.mjs';
import {draftRunLeaderboardRows} from '../worker/draft-run-season.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {gameDateKey} from '../game-date.mjs';

const PROJECT='patient-shadow-91417882';
const PRODUCTION='br-orange-feather-ayps8kep';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const pct=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]??null;};
const summarize=values=>({n:values.length,p50_ms:pct(values,.5),p95_ms:pct(values,.95),p99_ms:pct(values,.99),max_ms:values.length?Math.max(...values):null});

function dbQuery(connection) {
  const url=new URL(connection),parts=url.hostname.split('.');parts[0]='api';
  const endpoint='https://'+parts.join('.')+'/sql';
  return async(sql,params=[])=>{
    const response=await fetch(endpoint,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),
      headers:{'content-type':'application/json','Neon-Connection-String':connection,'Neon-Raw-Text-Output':'true','Neon-Array-Mode':'true'},
      body:JSON.stringify({query:sql,params:params.map(value=>value==null?null:String(value))}),
    });
    if(!response.ok)throw Object.assign(Error('SQL request failed'),{status:response.status});
    const data=await response.json(),names=(data.fields||[]).map(field=>field.name);
    return {rows:(data.rows||[]).map(row=>Object.fromEntries(row.map((value,i)=>[names[i],value])))};
  };
}

async function control(key,route,options={}) {
  const response=await fetch('https://console.neon.tech/api/v2/projects/'+PROJECT+route,{
    ...options,redirect:'error',signal:AbortSignal.timeout(30000),
    headers:{authorization:'Bearer '+key,'content-type':'application/json',...(options.headers||{})},
  });
  if(!response.ok)throw Error('Neon control request failed '+response.status);
  return response.json();
}

async function endpointFor(key,branch) {
  const [b,e]=await Promise.all([control(key,'/branches/'+branch),control(key,'/branches/'+branch+'/endpoints')]);
  assert.equal(b.branch.id,branch);assert.equal(b.branch.parent_id,PRODUCTION);
  const created=Date.parse(b.branch.created_at),expires=Date.parse(b.branch.expires_at);
  assert.ok(Number.isFinite(created)&&Number.isFinite(expires)&&expires-created<=75*60000+1000,'branch lifetime exceeds 75 minutes');
  const endpoint=(e.endpoints||[]).find(x=>x.branch_id===branch&&x.type==='read_write');
  assert.ok(endpoint);assert.ok(Number(endpoint.autoscaling_limit_max_cu)<=8);assert.equal(Number(endpoint.suspend_timeout_seconds??endpoint.suspend_timeout),300);
  return endpoint;
}

async function setMinCu(key,branch,minCu) {
  const endpoint=await endpointFor(key,branch);
  await control(key,'/endpoints/'+endpoint.id,{method:'PATCH',body:JSON.stringify({endpoint:{autoscaling_limit_min_cu:minCu,autoscaling_limit_max_cu:8,suspend_timeout_seconds:300}})});
  for(let i=0;i<20;i++) {
    await sleep(1000);
    const current=await endpointFor(key,branch);
    if(Number(current.autoscaling_limit_min_cu)===minCu)return current;
  }
  throw Error('Compute minimum did not converge.');
}

const historySql=`SELECT day::text date,environment set_id,'draft_run' mode,score,id run_id
  FROM draft_run_sessions WHERE player_id=$1::uuid AND day=$2::date
    AND jsonb_array_length(answers)=jsonb_array_length(puzzle_ids)`;
const rankingSql=`SELECT a.auth_user_id,a.player_id,p.display_name,p.username_owned,p.public_identity_terms_version,p.public_identity_terms_accepted_at,p.public_identity_hidden_at
  FROM players p LEFT JOIN account_links a ON a.player_id=p.id WHERE p.id=$1::uuid LIMIT 1`;
const streakSql=`WITH completed_days AS (
    SELECT DISTINCT day FROM draft_run_sessions
    WHERE player_id=$1::uuid AND day IS NOT NULL AND day<=$2::date
      AND jsonb_array_length(answers)=jsonb_array_length(puzzle_ids)
  ), ordered AS (
    SELECT day,(row_number() OVER(ORDER BY day DESC)-1)::int day_offset FROM completed_days
  ) SELECT count(*)::int streak FROM ordered WHERE day=$2::date-day_offset`;
const capsSql=`SELECT DISTINCT capability FROM entitlement_grants WHERE auth_user_id=$1::uuid
  AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())`;
const membershipSql=`SELECT 1 FROM provider_accounts WHERE auth_user_id=$1::uuid AND provider='patreon' LIMIT 1`;
const collapsedSql=`WITH history AS (
    SELECT day::text date,environment set_id,'draft_run' mode,score,id run_id
    FROM draft_run_sessions WHERE player_id=$1::uuid AND day=$2::date
      AND jsonb_array_length(answers)=jsonb_array_length(puzzle_ids)
  ), completed_days AS (
    SELECT DISTINCT day FROM draft_run_sessions
    WHERE player_id=$1::uuid AND day IS NOT NULL AND day<=$2::date
      AND jsonb_array_length(answers)=jsonb_array_length(puzzle_ids)
  ), ordered AS (
    SELECT day,(row_number() OVER(ORDER BY day DESC)-1)::int day_offset FROM completed_days
  )
  SELECT COALESCE((SELECT jsonb_agg(to_jsonb(h)) FROM history h),'[]'::jsonb) daily_history,
    (SELECT count(*)::int FROM ordered WHERE day=$2::date-day_offset) streak,
    COALESCE((SELECT jsonb_agg(DISTINCT capability ORDER BY capability) FROM entitlement_grants
      WHERE $3::uuid IS NOT NULL AND auth_user_id=$3::uuid
        AND capability IN ('custom_corpus','unlimited_cube_practice')
        AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())),'[]'::jsonb) paid_capabilities,
    EXISTS(SELECT 1 FROM provider_accounts WHERE $3::uuid IS NOT NULL
      AND auth_user_id=$3::uuid AND provider='patreon') membership_connected`;

function task(family,fn){return async()=>{const start=performance.now();await fn();return {family,ms:Math.round((performance.now()-start)*100)/100};};}

async function runBurst({query,users,day,variant}) {
  const tasks=[];
  for(let i=0;i<50;i++) {
    const user=users[i],signed=i<25;
    if(variant==='current') {
      tasks.push(task('daily_history',()=>query(historySql,[user.player,day])));
      tasks.push(task('daily_ranking',()=>query(rankingSql,[user.player])));
      tasks.push(task('daily_streak',()=>query(streakSql,[user.player,day])));
      if(signed) {
        tasks.push(task('daily_capabilities',()=>query(capsSql,[user.auth])));
        tasks.push(task('daily_membership',()=>query(membershipSql,[user.auth])));
      }
    } else {
      tasks.push(task('daily_collapsed',()=>query(collapsedSql,[user.player,day,signed?user.auth:null])));
      tasks.push(task('daily_ranking',()=>query(rankingSql,[user.player])));
    }
  }
  for(let i=0;i<10;i++)tasks.push(task('leaderboard',()=>draftRunLeaderboardRows(query,{start:'2000-01-01',end:day,environment:'mixed',limit:100})));
  for(let i=0;i<20;i++)tasks.push(task('practice_selector',async()=>{await sleep(1000);await selectCachedDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,'burst-read-stall:'+variant+':'+i,'mixed',{day});}));
  const started=performance.now(),results=await Promise.all(tasks.map(fn=>fn())),wall=Math.round((performance.now()-started)*100)/100;
  const families={};
  for(const family of new Set(results.map(r=>r.family)))families[family]=summarize(results.filter(r=>r.family===family).map(r=>r.ms));
  return {variant,wall_ms:wall,requests:results.length,families};
}

async function main(){
  const branch=process.env.PACK1_BURST_BRANCH,connection=process.env.DATABASE_URL,key=process.env.NEON_API_KEY;
  if(!branch||!connection||!key)throw Error('Missing benchmark target.');
  const fixtures=JSON.parse(fs.readFileSync(process.env.LOAD_FIXTURE_FILE,'utf8'));
  assert.ok(fixtures.users.length>=50);
  const query=dbQuery(connection),day=gameDateKey(),report={schema_version:1,branch,day,conditions:[],ok:false};
  await endpointFor(key,branch);
  await query('SELECT 1');
  for(const minCu of [0.25,1]) {
    await setMinCu(key,branch,minCu);
    await query('SELECT 1');
    const order=minCu===0.25?['current','collapsed']:['collapsed','current'];
    for(const variant of order)report.conditions.push({min_cu:minCu,...await runBurst({query,users:fixtures.users,day,variant})});
  }
  report.ok=true;
  const root='artifacts/practice-performance';fs.mkdirSync(root,{recursive:true});
  fs.writeFileSync(path.join(root,'burst-read-stall.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
