import fs from 'node:fs';
import assert from 'node:assert/strict';
import {checkBranch} from './edge-control.mjs';
import {summarize} from './practice-performance.mjs';
import {seededRandom} from '../gameplay.mjs';
import {seal} from './launch-distributed-bundle.mjs';

async function main() {

const target=Number(process.env.LOAD_TARGET),shard=Number(process.env.LOAD_SHARD),generators=target===25?5:20;
assert.ok([25,100,500,1000].includes(target));assert.ok(Number.isInteger(shard)&&shard>=0&&shard<generators);
const population=target/generators,offset={25:0,100:25,500:125,1000:625}[target];
const scheduledStart=Number(process.env.LOAD_START_AT);assert.ok(scheduledStart>Date.now()-60000&&scheduledStart<Date.now()+300000);
const policy=JSON.parse(fs.readFileSync('scripts/launch-load-policy.json','utf8'));
const fixture=JSON.parse(fs.readFileSync(process.env.LOAD_FIXTURE_FILE,'utf8'));
checkBranch(fixture.branch);
assert.equal(fixture.branch,process.env.PREVIEW_BRANCH);
assert.equal(fixture.sha,process.env.GITHUB_SHA);
const base='https://api-preview.packone.pro',preview=process.env.PREVIEW_ACCESS_KEY;
assert.match(preview||'',/^[a-f0-9]{64}$/);
// Host and ingress identity are fixed. Never accept a production URL, spoof an
// egress header, or call a provider/auth-email/billing route from this harness.
const health=await fetch(base+'/draft/health?quick=1',{headers:{'x-pack1-preview-key':preview},redirect:'error',signal:AbortSignal.timeout(30000)});
assert.equal(health.status,200);assert.equal((await health.json()).release_commit,fixture.sha);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={schema:1,sha:fixture.sha,branch:fixture.branch,scenario:'distributed real runner egress',target,generator:shard,generators,egress:seal({network:health.headers.get('x-pack1-preview-network')}),policy,
  started_at:new Date().toISOString(),stages:[],passed:false,distributed_evidence:true};
const wholeStart=Date.now();let totalRequests=0;
const directory='artifacts/launch-load';fs.mkdirSync(directory,{recursive:true});
const save=()=>fs.writeFileSync(directory+'/distributed-'+target+'-'+shard+'.json',JSON.stringify(report,null,2));

for(const population of [target/generators]) {
  const stage={population,scheduled:population,started:0,completed:0,correctness_failures:0,failures:[],requests:[],arrival_delay_ms:[],routes:{},passed:false};
  report.stages.push(stage);const stageStart=scheduledStart,deadline=stageStart+policy.stage_deadline_seconds*1000;
  let stopped=false;
  const call=async(actor,route,path,body)=>{
    if(stopped||Date.now()>deadline||Date.now()-wholeStart>policy.maximum_test_minutes*60000||++totalRequests>policy.maximum_requests)
      throw Object.assign(Error('stage_stopped'),{coarse:'stage_stopped'});
    const started=performance.now(),headers={'x-pack1-preview-key':preview,origin:'https://packone.pro','content-type':'application/json'};
    if(actor.cookies.size)headers.cookie=[...actor.cookies].map(([k,v])=>k+'='+v).join('; ');
    if(actor.csrf)headers['x-pack1-csrf']=actor.csrf;
    if(path==='/draft/v1/runs'&&!body.daily)headers['x-idempotency-key']=crypto.randomUUID();
    const record={route,status:0,ms:0};stage.requests.push(record);
    try {
      const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(30000,deadline-Date.now())))});
      record.status=r.status;
      const data=await r.json();
      if(r.status===429){record.scopes=data.scopes||[];record.retry_after=Number(r.headers.get('retry-after'));}
      for(const value of (r.headers.getSetCookie?.()||[r.headers.get('set-cookie')||'']).flatMap(s=>s.split(/,\s*(?=__(?:Host|Secure)-pack1_)/))) {
        const [pair]=value.split(';'),eq=pair.indexOf('=');if(eq>0)actor.cookies.set(pair.slice(0,eq),pair.slice(eq+1));
      }
      if(!r.ok)throw Object.assign(Error('http_'+r.status),{coarse:'http_'+r.status});
      return data;
    } catch(error) {
      stopped=true;
      if(!error.coarse)error.coarse='network_or_timeout';
      throw error;
    } finally {record.ms=Math.round((performance.now()-started)*100)/100;}
  };
  const dailyIds=new Map();
  await Promise.all(Array.from({length:population},async(_,index)=>{
    const globalIndex=shard*population+index,random=seededRandom(`distributed:${target}:${globalIndex}`),scheduled=stageStart+Math.floor(random()*policy.ramp_seconds*1000);
    await sleep(Math.max(0,scheduled-Date.now()));
    if(stopped)return;
    stage.arrival_delay_ms.push(Date.now()-scheduled);stage.started++;
    const user=fixture.users[offset+globalIndex],guest=globalIndex%10<5,practice=globalIndex%10>=8;
    const actor={cookies:new Map(),csrf:null};
    const attach=()=>{actor.cookies.set('__Host-pack1_account',user.account);actor.cookies.set('__Secure-pack1_csrf',user.csrf);actor.csrf=user.csrf;};
    if(!guest){actor.cookies.set('__Host-pack1_player',user.token);attach();}
    try {
      await call(actor,'session','/growth/v1/player/session',{displayName:'Load visitor'});
      await call(actor,'read','/draft/v1/daily-status');
      let environment=['mixed','powered-cube','latest'][globalIndex%3],body={daily:true,environment};
      if(practice) {
        environment=globalIndex%3===1?'powered-cube':'mixed';
        body={environment,...(globalIndex%3===2?{setIds:fixture.sets}:{})};
        if(body.setIds)await call(actor,'read','/draft/v1/practice-sets');
      }
      let run=await call(actor,'start','/draft/v1/runs',body);
      assert.equal(run.run_length,8);assert.equal(Boolean(run.day),!practice);
      if(!practice) {
        const prior=dailyIds.get(environment);
        if(prior)assert.equal(run.current.puzzle_id,prior);else dailyIds.set(environment,run.current.puzzle_id);
        assert.equal(run.leaderboard_eligible,!guest);
      }
      if(practice)run=await call(actor,'reroll',`/draft/v1/runs/${run.id}/reroll`,{revision:run.revision,round:0,puzzleId:run.current.puzzle_id,type:'pack'});
      for(let round=0;round<8;round++) {
        const viewId=crypto.randomUUID();
        await call(actor,'view',`/draft/v1/runs/${run.id}/view`,{revision:run.revision,puzzleId:run.current.puzzle_id,viewId});
        const think=policy.think_time_ms[0]+Math.floor(random()*(policy.think_time_ms[1]-policy.think_time_ms[0]));
        await sleep(think);
        const payload={revision:run.revision,round,puzzleId:run.current.puzzle_id,cardId:run.current.candidates[0].id,viewId,activeMs:think};
        run=await call(actor,'pick',`/draft/v1/runs/${run.id}/pick`,payload);
        assert.equal(run.complete,round===7);
      }
      assert.equal(run.score,Math.round(run.answers.reduce((sum,a)=>sum+a.score,0)/8));
      const share=await call(actor,'read',`/draft/v1/runs/${run.id}/share`,{});assert.ok(share.id);
      await call(actor,'read','/draft/v1/leaderboard?environment='+environment+'&period='+['daily','week','season','all'][globalIndex%4]);
      if(globalIndex%10===0) {
        attach();
        await call(actor,'read','/growth/v1/account/link-browser',{validateDailyRunId:run.id});
        const status=await call(actor,'read','/draft/v1/daily-status');
        assert.equal(status.ranking_identity.eligible,true);
        await call(actor,'read','/growth/v1/profile/me');
      }
      stage.completed++;
    } catch(error) {
      if(error.code==='ERR_ASSERTION'){stage.correctness_failures++;stopped=true;}
      stage.failures.push(error.coarse||'correctness');
    }
  }));
  stage.elapsed_ms=Date.now()-stageStart;
  stage.arrival_delay=summarize(stage.arrival_delay_ms);delete stage.arrival_delay_ms;
  stage.status_counts=Object.fromEntries([...new Set(stage.requests.map(r=>r.status))].map(s=>[s,stage.requests.filter(r=>r.status===s).length]));
  for(const route of Object.keys(policy.route_budgets_ms)) {
    const rows=stage.requests.filter(r=>r.route===route),summary=summarize(rows.map(r=>r.ms));
    stage.routes[route]=summary;
  }
  stage.errors=stage.requests.filter(r=>r.status<200||r.status>=400).length;
  stage.passed=stage.completed===population&&stage.correctness_failures===0&&!stage.status_counts[429];
  save();console.log(JSON.stringify({scenario:'distributed',target,generator:shard,population,started:stage.started,completed:stage.completed,requests:stage.requests.length,passed:stage.passed,status_counts:stage.status_counts,routes:stage.routes}));
  if(!stage.passed)break;
  // Deliberately preserve quota identity/buckets between stages: no secret
  // rotation or fabricated network identities are used to manufacture a pass.
}
report.passed=report.stages.every(s=>s.passed); // Combined route budgets are enforced by the stage collector.
report.finished_at=new Date().toISOString();save();
if(!report.passed)process.exitCode=1;

}
main().catch(error=>{console.error(JSON.stringify({error:'Isolated load setup or acceptance failed',code:error.pgCode||error.code||'unknown'}));process.exitCode=1;});
