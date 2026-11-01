import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {evaluate,usage,parseBillingPeriodUsage,parseGatewayEvent,queryEvents,routeAlert,run,inspectGatewayCoverage} from '../scripts/launch-alert.mjs';
import {renderCoverageState} from '../launch-monitoring.mjs';
import {nextIncidentState,parseIncidentState,renderIncidentState,persistentLatencyConditions} from '../scripts/launch-incident-state.mjs';
import {productionSampleRate,confirmedAuthLimit} from '../launch-alert-policy.mjs';
import {consumePlayerLimit} from '../worker/request-limits.mjs';

const event=(extra={})=>({id:crypto.randomUUID(),route:'draft_pick',status:200,sample_rate:.1,duration_ms:100,quota_ms:5,tail_sampling_version:1,release:'a'.repeat(40),...extra});
const project={id:'patient-shadow-91417882',org_id:'org-fixture',compute_time_seconds:201*3600,data_transfer_bytes:200_000_000_000,consumption_period_start:'2026-01-01T00:00:00Z',consumption_period_end:'2026-02-01T00:00:00Z'};
const now=Date.parse('2026-01-10T12:00:00Z');
const limit=event({route:'account',status:429,sample_rate:1,upstream_status:429,upstream_calls:1,quota_scope:null,rate_limit_class:'player_auth'});
const row=e=>({$metadata:{id:e.id},source:{event:'gateway_request',...e}});

test('rare slow events are fully retained and fast-success weights stay truthful',()=>{
  assert.equal(productionSampleRate(200,{duration_ms:5000,quota_ms:1000}),.1);
  assert.equal(productionSampleRate(200,{duration_ms:5001}),1);
  assert.equal(productionSampleRate(200,{quota_ms:1001}),1);
  assert.equal(productionSampleRate(401),1);
  const s=evaluate([event(),event({sample_rate:1,duration_ms:6000}),event({status:503,sample_rate:1})],{});
  assert.equal(s.estimated_requests,12);assert.equal(s.slow_samples,1);
  assert.equal(s.latency_sampling,'complete_tail');
  assert.equal(evaluate([event({tail_sampling_version:0})],{}).latency_sampling,'legacy_or_mixed');
});

test('parser keeps finite failure evidence and rejects inconsistent complete-tail records',async()=>{
  const parsed=parseGatewayEvent(row(event({status:503,sample_rate:1,upstream_calls:0,quota_attempts:2,quota_overloaded:true,quota_remote:true,error:'gateway_failure',cookie:'secret'})));
  assert.equal(parsed.quota_overloaded,true);assert.equal(parsed.upstream_calls,0);assert.equal(parsed.cookie,undefined);
  assert.equal(parseGatewayEvent(row(event({duration_ms:6000}))),null);
  await assert.rejects(queryEvents(async()=>Response.json({result:{events:{events:[row(event({duration_ms:6000}))]},statistics:{abr_level:1}}}),'token','a'.repeat(32),0,1),/schema/);
  const s=evaluate([parsed],{});assert.ok(s.diagnostic_categories.includes('quota_or_gateway'));
  assert.ok(s.diagnostic_categories.includes('quota_overloaded'));
});

test('authentication warnings require origin evidence; network and unknown limits remain alerts',()=>{
  const parsed=parseGatewayEvent(row(limit));assert.equal(parsed.rate_limit_class,'player_auth');
  const auth=evaluate(Array(10).fill(parsed),{});
  assert.deepEqual(auth.alerts,['authentication_429']);assert.equal(auth.severities.authentication_429,'warning');
  for(const changed of [{upstream_calls:0},{upstream_status:503},{quota_scope:'request'},{route:'draft_pick'},{rate_limit_class:'caller-string'}]) {
    const e=parseGatewayEvent(row({...limit,...changed}));assert.equal(e.rate_limit_class,null);
    assert.ok(evaluate(Array(10).fill(e),{}).alerts.includes('network_or_application_429'));
  }
  const mixed=evaluate([...Array(10).fill(parsed),...Array(10).fill({...parsed,rate_limit_class:null})],{});
  assert.ok(mixed.alerts.includes('authentication_429'));assert.ok(mixed.alerts.includes('network_or_application_429'));
});

test('only the actual mobile auth limiter can attach the finite internal classification',async()=>{
  await assert.rejects(consumePlayerLimit(async()=>({rows:[]}),'fixture','mobile-account-auth',{limit:12,seconds:600}),e=>e.status===429&&e.rateLimitScope==='mobile-account-auth'&&e.retryAfter===600);
  assert.equal(confirmedAuthLimit('/growth/v1/mobile/account/signin','POST',429,'player_auth'),true);
  for(const [path,method,status,value] of [
    ['/growth/v1/mobile/account/session','GET',429,'player_auth'],
    ['/growth/v1/mobile/profile/me','GET',429,'player_auth'],
    ['/growth/v1/mobile/account/signin','POST',503,'player_auth'],
    ['/growth/v1/mobile/account/signin','POST',429,'unknown'],
  ])assert.equal(confirmedAuthLimit(path,method,status,value),false);
});

test('three slow actual requests are warnings without weakening 5xx detection',()=>{
  const s=evaluate(Array(3).fill(event({duration_ms:6000,sample_rate:1})),{});
  assert.ok(s.alerts.includes('slow_requests'));assert.equal(s.severities.slow_requests,'warning');
  const errors=evaluate([...Array(10).fill(event()),...Array(5).fill(event({status:503,sample_rate:1}))],{});
  assert.equal(errors.severities.gateway_5xx,'alert');
});

test('persistence escalation requires a full half-hour of consecutive bad endpoints',()=>{
  const target=Date.parse('2026-01-10T12:00:00Z'),history={};
  for(let i=0;i<3;i++)history[new Date(target-i*300000).toISOString()]=['slow_quota_gameplay'];
  assert.deepEqual(persistentLatencyConditions(history,target),[]);
  for(let i=0;i<=6;i++)history[new Date(target-i*300000).toISOString()]=['slow_quota_gameplay'];
  assert.deepEqual(persistentLatencyConditions(history,target),['slow_quota']);
  delete history[new Date(target-4*300000).toISOString()];
  assert.deepEqual(persistentLatencyConditions(history,target),[]);
});
test('admin-only latency cannot become a persistent gameplay incident',()=>{
  const slow=Array.from({length:3},()=>event({route:'other',sample_rate:1,duration_ms:6000,quota_ms:1200}));
  const s=evaluate(slow,{});assert.ok(s.alerts.includes('slow_requests'));assert.deepEqual(s.persistent_candidates,[]);
  assert.deepEqual(evaluate(slow.map(e=>({...e,route:'draft_pick'})),{}).persistent_candidates,['slow_requests_gameplay','slow_quota_gameplay']);
});
test('coverage collection escalates sustained gameplay latency but not isolated overlapping windows',async()=>{
  const base={version:1,coverage_floor:'2026-01-10T09:00:00Z',covered_through:'2026-01-10T11:35:00Z',alerted_windows:{},updated_at:null};
  const events=Array.from({length:3},()=>event({sample_rate:1,duration_ms:6000}));
  const sustained=await inspectGatewayCoverage({state:base,now,loadWindow:async()=>events});
  assert.ok(sustained.persistent.includes('slow_requests'));
  const isolated=await inspectGatewayCoverage({state:base,now,loadWindow:async(_from,to)=>to>=now-20*60000?events:[]});
  assert.deepEqual(isolated.persistent,[]);
});

function report(end,alerts=[],overrides={}) {
  return {at:new Date(Date.parse(end)+60000).toISOString(),alerts,severities:Object.fromEntries(alerts.map(c=>[c,'warning'])),
    windows:[{to:end,alerts}],coverage:{target:end,through:end,state_persisted:true,pending_windows:0,failed_window:null,unrecoverable:false},...overrides};
}
test('incidents distinguish a live breach, recovery and a new episode',()=>{
  const start=report('2026-01-10T12:00:00Z',['slow_quota']);
  const first=nextIncidentState(null,'slow_quota',start);assert.equal(first.status,'active');
  const recovering=nextIncidentState(first,'slow_quota',report('2026-01-10T12:15:00Z'));assert.equal(recovering.status,'recovering');
  const recovered=nextIncidentState(recovering,'slow_quota',report('2026-01-10T12:30:00Z'));assert.equal(recovered.status,'recovered');
  const again=nextIncidentState(recovered,'slow_quota',report('2026-01-10T12:45:00Z',['slow_quota']));
  assert.equal(again.status,'active');assert.equal(again.episodes,2);assert.equal(again.first_seen,first.first_seen);
  assert.deepEqual(parseIncidentState(renderIncidentState(again)),again);
});

test('late historical breaches do not masquerade as a new live episode',()=>{
  const first=nextIncidentState(null,'gateway_5xx',report('2026-01-10T12:00:00Z',['gateway_5xx']));
  const recovered=nextIncidentState(first,'gateway_5xx',report('2026-01-10T12:30:00Z'));
  const late=report('2026-01-10T12:45:00Z',[],{windows:[{to:'2026-01-10T12:05:00Z',alerts:['gateway_5xx']},{to:'2026-01-10T12:45:00Z',alerts:[]}]});
  const next=nextIncidentState(recovered,'gateway_5xx',late);
  assert.equal(next.status,'recovered');assert.equal(next.episodes,1);
});

test('missing or incomplete coverage cannot declare a category recovered',()=>{
  const first=nextIncidentState(null,'gateway_5xx',report('2026-01-10T12:00:00Z',['gateway_5xx']));
  for(const patch of [{state_persisted:false},{pending_windows:1},{unrecoverable:true},{failed_window:{to:'bad'}}]) {
    const next=report('2026-01-10T13:00:00Z');Object.assign(next.coverage,patch);
    assert.equal(nextIncidentState(first,'gateway_5xx',next).status,'unknown');
  }
});
test('a probe incident records recurrence only after an explicitly successful recovery',()=>{
  const first=nextIncidentState(null,'gateway_probe_failed',report('2026-01-10T12:00:00Z',['gateway_probe_failed'],{probe:{ok:false}}));
  const recovered=nextIncidentState(first,'gateway_probe_failed',report('2026-01-10T12:10:00Z',[],{probe:{ok:true}}));
  assert.equal(recovered.status,'recovered');
  const again=nextIncidentState(recovered,'gateway_probe_failed',report('2026-01-10T12:20:00Z',['gateway_probe_failed'],{probe:{ok:false}}));
  assert.equal(again.episodes,2);assert.equal(again.status,'active');
});

test('issue reconciliation updates recurrence without comments or repeated healthy edits',async()=>{
  let body='',title='',writes=0;
  const fetcher=async(url,options)=>{
    if(options.method==='GET')return Response.json(body?[{number:12,title,body}]:[]);
    writes++;({body,title}=JSON.parse(options.body));return Response.json({number:12,title,body});
  };
  const env={GITHUB_REPOSITORY:'owner/repo',GITHUB_TOKEN:'fixture'};
  await routeAlert(fetcher,env,report('2026-01-10T12:00:00Z',['authentication_429']));assert.match(title,/launch warning/);
  assert.doesNotMatch(body,/estimated_requests|duration_ms|sampled_events/);
  await routeAlert(fetcher,env,report('2026-01-10T12:30:00Z'));assert.match(title,/launch recovered/);
  const count=writes;
  await routeAlert(fetcher,env,report('2026-01-10T12:35:00Z'));assert.equal(writes,count);
  await routeAlert(fetcher,env,report('2026-01-10T12:45:00Z',['authentication_429']));
  assert.equal(parseIncidentState(body).episodes,2);assert.match(title,/launch warning/);
});
test('existing legacy incident gains recovered status without erasing its original evidence',async()=>{
  const original='Legacy evidence.\\n\\n'+JSON.stringify({at:'2026-01-10T12:01:00Z',windows:[{to:'2026-01-10T12:00:00Z',alerts:['gateway_5xx']}]});
  let write;
  const fetcher=async(_url,options)=>{
    if(options.method==='GET')return Response.json([{number:12,title:'[launch alert] Production capacity needs attention (gateway_5xx)',body:original}]);
    write=JSON.parse(options.body);return Response.json({number:12});
  };
  await routeAlert(fetcher,{GITHUB_REPOSITORY:'owner/repo',GITHUB_TOKEN:'fixture'},report('2026-01-10T12:30:00Z'));
  assert.ok(write.body.startsWith(original));assert.match(write.title,/launch recovered/);
  assert.equal(parseIncidentState(write.body).last_seen,'2026-01-10T12:00:00.000Z');
});
test('a paginated issue list never opens a duplicate incident from the second page',async()=>{
  const active=nextIncidentState(null,'gateway_5xx',report('2026-01-10T12:00:00Z',['gateway_5xx']));
  let gets=0,posts=0;
  const fetcher=async(url,options)=>{
    if(options.method==='GET'){gets++;return Response.json(url.includes('page=2')?[{number:12,title:'[launch alert] Production monitoring needs attention (gateway_5xx)',body:renderIncidentState(active)}]:Array.from({length:100},(_,i)=>({number:i+100,title:'Other issue'})));}
    if(options.method==='POST')posts++;
    return Response.json({number:12});
  };
  await routeAlert(fetcher,{GITHUB_REPOSITORY:'owner/repo',GITHUB_TOKEN:'fixture'},report('2026-01-10T12:00:00Z',['gateway_5xx']));
  assert.equal(gets,2);assert.equal(posts,0);
});

test('billing counters validate identity, period, units and nonnegative observations',()=>{
  const b=parseBillingPeriodUsage(project,now);assert.equal(b.billing_period_compute_cu_hours,201);
  assert.equal(b.billing_period_egress_bytes,200_000_000_000);assert.match(b.billing_period_scope,/all-branches/);
  for(const patch of [{id:'other'},{compute_time_seconds:-1},{data_transfer_bytes:NaN},{consumption_period_end:'2026-01-02T00:00:00Z'}])assert.throws(()=>parseBillingPeriodUsage({...project,...patch},now));
});

function usageFetcher({historyStatus=200,legacyStatus=200}={}) {
  const calls=[];
  return {calls,fetcher:async(url,options)=>{
    calls.push({url,body:options.body?JSON.parse(options.body):null});
    if(url.includes('cloudflare'))return Response.json({data:{viewer:{accounts:[{workersInvocationsAdaptive:[{sum:{requests:calls.filter(x=>x.url.includes('cloudflare')).length===1?110000:96000}}]}]}}});
    if(url.endsWith('/projects/patient-shadow-91417882'))return Response.json({project});
    if(url.includes('/v2/projects?'))return historyStatus===200?Response.json({projects:[{project_id:project.id,periods:[{consumption:[{metrics:[{metric_name:'compute_unit_seconds',value:3600},{metric_name:'public_network_transfer_bytes',value:42}]}]}]}]}):Response.json({}, {status:historyStatus});
    if(url.includes('/consumption_history/projects?'))return legacyStatus===200?Response.json({projects:[{project_id:project.id,periods:[{consumption:[{compute_time_seconds:3600}]}]}]}):Response.json({}, {status:legacyStatus});
    throw Error('Unexpected request');
  }};
}

test('billing-period guards run on successful normal daily history and both fallbacks',async()=>{
  for(const config of [{},{historyStatus:403},{historyStatus:404,legacyStatus:404}]) {
    const {fetcher}=usageFetcher(config),u=await usage(fetcher,{},'fixture',now);
    const s=evaluate([],u);
    assert.ok(s.alerts.includes('neon_compute_billing_period_usage'));
    assert.ok(s.alerts.includes('neon_egress_billing_period_usage'));
    assert.equal(u.billing_period_compute_cu_hours,201);
    if(config.legacyStatus!==404)assert.equal(u.compute_cu_hours,1);
  }
});

test('Paid daily volume is report-only; Free protection uses current account-wide headroom',async()=>{
  const paid=await usage(usageFetcher().fetcher,{PACK1_WORKERS_PLAN:'paid'},'fixture',now);
  assert.equal(evaluate([],paid).alerts.includes('worker_daily_usage'),false);
  const {fetcher,calls}=usageFetcher();
  const free=await usage(fetcher,{PACK1_WORKERS_PLAN:'free'},'fixture',now);
  assert.ok(evaluate([],free).alerts.includes('worker_daily_limit_risk'));
  const queries=calls.filter(x=>x.url.includes('cloudflare'));
  assert.equal(queries.length,2);assert.doesNotMatch(queries[1].body.query,/scriptName/);
  assert.equal(queries[1].body.variables.from,'2026-01-10T00:00:00.000Z');
  const unknown=await usage(usageFetcher().fetcher,{},'fixture',now);
  const s=evaluate([],unknown);assert.equal(s.severities.worker_daily_usage,'warning');
});

test('full alert-mode collection routes confirmed auth as a warning while unknown limits still pause outreach',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pack1-launch-calibration-')),cwd=process.cwd(),log=console.log;
  process.chdir(dir);console.log=()=>{};
  try {
    for(const known of [true,false]) {
      let coverage=renderCoverageState({version:1,coverage_floor:'2026-01-10T09:00:00Z',covered_through:'2026-01-10T11:55:00Z',alerted_windows:{},updated_at:null});
      const collector=usageFetcher(),posted=[];
      const events=Array.from({length:10},()=>row({...limit,id:crypto.randomUUID(),rate_limit_class:known?'player_auth':null}));
      const fetcher=async(url,options={})=>{
        if(url.includes('/zones?'))return Response.json({result:[{name:'packone.pro',status:'active',account:{id:'a'.repeat(32)}}]});
        if(url.includes('/observability/telemetry/query'))return Response.json({result:{events:{events},statistics:{abr_level:1}}});
        if(url==='https://api.packone.pro/draft/health?quick=1')return Response.json({ok:true});
        if(url.endsWith('/issues/596')) {
          if(options.method==='PATCH')coverage=JSON.parse(options.body).body;
          return Response.json({number:596,title:'[launch watcher] Coverage state',body:coverage});
        }
        if(url.includes('api.github.com')&&url.includes('/issues?'))return Response.json([]);
        if(url.includes('api.github.com')&&url.endsWith('/issues')) {posted.push(JSON.parse(options.body));return Response.json({number:123});}
        return collector.fetcher(url,options);
      };
      const result=await run({fetcher,env:{GITHUB_REPOSITORY:'killjoy00/mtg-ev-analyzer',GITHUB_TOKEN:'fixture'},now,mode:'alert'});
      assert.equal(result.pause_outreach,!known);
      assert.equal(result.coverage.pending_windows,0);assert.equal(result.probe.ok,true);
      assert.ok(posted.some(x=>x.title.includes(known?'authentication_429':'network_or_application_429')));
      assert.ok(posted.every(x=>!x.body.includes('billing_period_compute_cu_hours')));
    }
  }finally {console.log=log;process.chdir(cwd);fs.rmSync(dir,{recursive:true,force:true});}
});
