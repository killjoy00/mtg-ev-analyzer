// Real paced requests through the unchanged private gateway. No provider calls,
// fabricated network headers, mutation retries or between-stage quota reset.
import assert from 'node:assert/strict';
import {seededRandom} from '../gameplay.mjs';
import {transportFailureEvidence,undiciTransportObserver} from './launch-distributed-transport.mjs';
import {permittedRequest,quantiles,timing,fingerprint} from './launch-distributed-core.mjs';
export const wait=async(ms,signal)=>{
  if(signal?.aborted)throw Error('cohort_aborted');
  if(ms<=0)return;
  await new Promise((resolve,reject)=>{
    const done=()=>{signal?.removeEventListener('abort',abort);resolve();};
    const timer=setTimeout(done,ms),abort=()=>{clearTimeout(timer);reject(Error('cohort_aborted'));};
    signal?.addEventListener('abort',abort,{once:true});
  });
};
// Treat response diagnostics as untrusted input and retain only fixed numeric
// fields. They are evidence alongside, not a replacement for, client timings.
export function parseStartDiagnostics(headers,route='start') {
  const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=30000?value:null;
  const bounded=(input,keys)=>Object.fromEntries(keys.map(key=>[key,number(input?.[key])]).filter(([,value])=>value!==null));
  let gateway,origin;
  try {gateway=JSON.parse(headers.get('x-pack1-gateway-timing')||'null');}catch{}
  try {origin=JSON.parse(headers.get(route==='reroll'?'x-pack1-reroll-timing':'x-pack1-start-timing')||'null');}catch{}
  const result={};
  if(gateway)result.gateway=bounded(gateway,['duration_ms','quota_ms','upstream_ms']);
  if(origin?.v===1) {
    const phases=bounded(origin.phases,route==='reroll'?['player','body','session','metadata','selection','update','response']:
      ['player','body','identity','capability','idempotency','quota','selection','session_insert','analytics_insert','response','first_puzzle']);
    const selector={};
    for(const key of route==='reroll'?['metadata','reroll','other']:['snapshot','candidate','revision','other']) {
      const values=bounded(origin.selector?.[key],['count','sum_ms','max_ms']);
      if(Object.keys(values).length===3&&Number.isInteger(values.count)&&values.count<=20)selector[key]=values;
    }
    if(number(origin.total_ms)!==null)result.origin={total_ms:origin.total_ms,phases,selector};
  }
  return Object.keys(result).length?result:null;
}
const requestEndpoint=path=>{
  const bare=path.split('?')[0];
  if(bare==='/draft/v1/daily-status')return 'daily_status';
  if(bare==='/draft/v1/practice-sets')return 'practice_sets';
  if(bare==='/draft/v1/leaderboard')return 'leaderboard';
  if(bare==='/growth/v1/account/link-browser')return 'account_link_browser';
  if(bare==='/growth/v1/profile/me')return 'profile_me';
  if(/^\/draft\/v1\/runs\/[^/]+\/share$/.test(bare))return 'run_share';
  return null;
};
export function requestClient({fixture,policy,budget,now,signal,fetcher=fetch,transportObserver=undiciTransportObserver,request_timeout_ms=30000}) {
  return async(actor,route,path,body,{report=null,windows=null}={})=>{
    const url=permittedRequest(path,body);
    if(++budget.gateway_requests>Math.floor((policy.maximum_requests-policy.telemetry_preflight_requests)/policy.generators))throw Object.assign(Error('request_ceiling'),{category:'cost'});
    const at=now(),record={route,at,status:0,ms:0,bytes:0,phase:!windows||at<windows.hold?'initial':at<windows.drain?'hold':at<windows.recovery?'drain':'recovery'};
    const endpoint=requestEndpoint(path);if(endpoint)record.endpoint=endpoint;
    const request_index=report?report.requests.length:null;
    if(report){record.index=request_index;report.requests.push(record);}
    const headers={'x-pack1-preview-key':fixture.preview,origin:'https://packone.pro','content-type':'application/json'};
    if(actor?.cookies.size)headers.cookie=[...actor.cookies].map(([k,v])=>k+'='+v).join('; ');
    if(actor?.csrf)headers['x-pack1-csrf']=actor.csrf;
    if(path==='/draft/v1/runs'&&!body.daily)headers['x-idempotency-key']=crypto.randomUUID();
    const method=body===undefined?'GET':'POST',transport=transportObserver.begin({url,method,bodyPresent:body!==undefined});
    const start=performance.now();
    try {
      const r=await fetcher(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(request_timeout_ms)])});
      record.status=r.status;const text=await r.text();record.bytes=Buffer.byteLength(text);budget.response_bytes+=record.bytes;
      const diagnostics=parseStartDiagnostics(r.headers,route);if(diagnostics)record.diagnostics=diagnostics;
      if(record.bytes>2*1024**2||budget.response_bytes>Math.floor(policy.maximum_response_bytes/policy.generators))throw Object.assign(Error('response_byte_ceiling'),{category:'cost'});
      const data=JSON.parse(text);
      if(r.status===429){record.scopes=data.scopes||[];record.retry_after=Number(r.headers.get('retry-after'));}
      if(!r.ok)throw Object.assign(Error('http_'+r.status),{category:'application'});
      if(actor)for(const value of (r.headers.getSetCookie?.()||[r.headers.get('set-cookie')||'']).flatMap(s=>s.split(/,\s*(?=__(?:Host|Secure)-pack1_)/))) {
        const [pair]=value.split(';'),eq=pair.indexOf('=');if(eq>0)actor.cookies.set(pair.slice(0,eq),pair.slice(eq+1));
      }
      return {data,network:r.headers.get('x-pack1-preview-network')};
    } catch(error) {
      if(record.status===0) {
        const evidence=transportFailureEvidence(error,transport,{cohortAborted:signal.aborted,elapsedMs:performance.now()-start});record.transport=evidence;
        const reason=evidence.label==='abort_fallout'?'cohort_aborted':`transport_${evidence.label}`;
        throw Object.assign(Error(reason),{category:evidence.label==='abort_fallout'?'generator':'application',request_index,transport:evidence});
      }
      throw error;
    } finally {
      record.ms=Math.round((performance.now()-start)*100)/100;transportObserver.end(transport);
    }
  };
}
export async function runPlayerStage({fixture,policy,scope,stage,shard,start_at,network,now,signal,client,onFailure}) {
  const spec=policy.stages[stage],population=spec.players/policy.generators,windows=timing(start_at,spec,policy),offset=[0,25,75][stage];
  const report={schema:2,scope,stage,shard,start_at,network,started:0,initial_completed:0,correctness_failures:0,failures:[],root_failure:null,arrival_delay_ms:[],actors:[],requests:[],daily:{},windows};
  const call=async(actor,route,path,body)=>{
    try {
      const result=(await client(actor,route,path,body,{report,windows})).data;
      // Conservative live abort: a sufficiently populated per-runner route
      // window must also fit the predeclared budgets, not just the final merge.
      const rows=report.requests.filter(r=>r.route===route&&r.ms>0).slice(-200),limit=policy.route_budgets_ms[route];
      if(rows.length>=policy.minimum_rolling_route_samples) {
        const q=quantiles(rows.map(r=>r.ms));
        if(q.p95_ms>limit.p95||q.p99_ms>limit.p99)throw Object.assign(Error('rolling_route_latency'),{category:'application'});
      }
      return result;
    } catch(e) {e.category||='application';throw e;}
  };
  const until=async at=>{while(now()<at)await wait(Math.min(1000,at-now()),signal);};
  const fail=e=>{
    const category=e.code==='ERR_ASSERTION'?'correctness':e.category||'generator';
    if(category==='correctness')report.correctness_failures++;
    const reason=/^[a-z0-9_]{1,80}$/.test(e.message)?e.message:category==='correctness'?'assertion_failed':'request_or_generator_failure';
    const failure={category,reason};if(Number.isInteger(e.request_index))failure.request_index=e.request_index;if(e.transport?.label)failure.transport=e.transport.label;
    if(!report.failure_category)report.failure_category=category;if(!report.root_failure&&reason!=='cohort_aborted')report.root_failure={...failure};report.failures.push(failure);onFailure({category,reason});
  };
  const actors=Array.from({length:population},(_,i)=>{
    const id=shard*population+i,user=fixture.users[offset+id],guest=id%10<5;
    assert.ok(user,'missing_fixture_actor');
    const actor={id,guest,user,cookies:new Map(),csrf:null,random:seededRandom(`distributed-v2:${stage}:${id}`),evidence:{id,guest,hold_runs:0,hold_reads:0}};
    actor.attach=()=>{actor.cookies.set('__Host-pack1_account',user.account);actor.cookies.set('__Secure-pack1_csrf',user.csrf);actor.csrf=user.csrf;};
    if(!guest){actor.cookies.set('__Host-pack1_player',user.token);actor.attach();}
    report.actors.push(actor.evidence);return actor;
  });
  const board=async(actor,environment='mixed')=>call(actor,'read','/draft/v1/leaderboard?environment='+environment+'&period='+['daily','week','season','all'][actor.id%4]);
  const practiceBody=(actor,iteration)=>{
    const mode=(actor.id+iteration)%4;
    return mode===0?{environment:'mixed'}:mode===1?{environment:'powered-cube'}:{environment:'mixed',setIds:fixture.sets.slice(0,mode===2?1:3)};
  };
  const play=async(actor,body)=>{
    if(body.setIds)await call(actor,'read','/draft/v1/practice-sets');
    let run=await call(actor,'start','/draft/v1/runs',body);
    assert.equal(run.run_length,8);assert.equal(Boolean(run.day),!!body.daily);
    if(body.daily) {
      assert.equal(run.leaderboard_eligible,!actor.guest);
    } else run=await call(actor,'reroll',`/draft/v1/runs/${run.id}/reroll`,{revision:run.revision,round:0,puzzleId:run.current.puzzle_id,type:'pack'});
    const trajectory=[];
    for(let round=0;round<8;round++) {
      const viewId=crypto.randomUUID(),puzzle=run.current.puzzle_id;trajectory.push(puzzle);
      await call(actor,'view',`/draft/v1/runs/${run.id}/view`,{revision:run.revision,puzzleId:puzzle,viewId});
      const think=policy.think_time_ms[0]+Math.floor(actor.random()*(policy.think_time_ms[1]-policy.think_time_ms[0]));await wait(think,signal);
      run=await call(actor,'pick',`/draft/v1/runs/${run.id}/pick`,{revision:run.revision,round,puzzleId:puzzle,cardId:run.current.candidates[0].id,viewId,activeMs:think});
      assert.equal(run.complete,round===7);
    }
    if(body.daily)(report.daily[body.environment]||=[]).push(fingerprint(trajectory));
    assert.equal(run.score,Math.round(run.answers.reduce((sum,a)=>sum+a.score,0)/8));
    const share=await call(actor,'read',`/draft/v1/runs/${run.id}/share`,{});
    if(body.daily){assert.equal(share.daily,true);assert.equal(new URL(share.url,'https://packone.pro').searchParams.get('daily'),'1');}
    else assert.match(share.id,/^[a-f0-9]{24}$/);
    await board(actor,body.environment);return run;
  };
  try {
    await until(start_at);report.start_lateness_ms=Math.max(0,now()-start_at);
    if(report.start_lateness_ms>policy.maximum_start_lateness_ms)throw Error('late_generator_start');
    await Promise.all(actors.map(async actor=>{
      try {
        const scheduled=start_at+Math.floor(actor.random()*policy.ramp_seconds*1000);await until(scheduled);
        report.arrival_delay_ms.push(Math.max(0,now()-scheduled));report.started++;
        await call(actor,'session','/growth/v1/player/session',{displayName:'Load visitor'});
        await call(actor,'read','/draft/v1/daily-status');
        const body=actor.id%10>=8?practiceBody(actor,0):{daily:true,environment:['mixed','powered-cube','latest'][actor.id%3]};
        const run=await play(actor,body);
        if(actor.id%10===0) {
          actor.attach();await call(actor,'read','/growth/v1/account/link-browser',{validateDailyRunId:run.id});
          assert.equal((await call(actor,'read','/draft/v1/daily-status')).ranking_identity.eligible,true);
          await call(actor,'read','/growth/v1/profile/me');
        }
        report.initial_completed++;
        if(now()>windows.hold)throw Error('initial_workload_overran_hold');
        await until(windows.hold);actor.evidence.hold_entered_at=now();
        let iteration=0;
        while(now()<windows.drain) {
          await call(actor,'read','/draft/v1/daily-status');actor.evidence.hold_reads++;
          if(actor.guest) {await board(actor);await until(Math.min(windows.drain,now()+policy.guest_read_interval_ms));}
          else {await play(actor,practiceBody(actor,++iteration));actor.evidence.hold_runs++;}
        }
        actor.evidence.hold_exited_at=now();
        if(now()>windows.recovery)throw Error('mutation_drain_overran_recovery');
      } catch(e){fail(e);}
    }));
    if(report.failures.length)throw Error('stage_aborted');
    await until(windows.recovery);report.recovery_started_at=now();
    while(now()<windows.end) {
      await call(actors[0],'read','/draft/v1/daily-status');await board(actors[0]);
      await until(Math.min(windows.end,now()+policy.recovery_read_interval_ms));
    }
    report.recovery_ended_at=now();
  } catch(e){if(!report.failures.length)fail(e);}
  report.finished_at=now();return report;
}
