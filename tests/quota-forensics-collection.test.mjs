import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {collectQuotaEventRows,forensicWindows,incidentReplayWindow,recentIncidentWindows,publishQuotaForensics,runQuotaForensics,quotaForensicsFailureCode} from '../scripts/quota-stage-forensics.mjs';
import {privateQuotaStore} from '../scripts/private-quota-forensics.mjs';
import {collectVerifiedTelemetry} from '../scripts/verified-observability.mjs';

const now=Date.parse('2026-10-29T19:00:00Z'),account='a'.repeat(32),token='private-token-'.repeat(3);
const event=id=>({$metadata:{id},source:{event:'quota_handler'}});
const page=(events,level=1)=>Response.json({success:true,result:{events:{events},statistics:{abr_level:level}}});
const options={token,accountId:account,from:now-10*60000,to:now-6*60000,event:'quota_handler',service:'pack1-gateway'};
test('coarse short pages are discarded and recovered with verified smaller partitions',async()=>{
  let calls=0;
  const result=await collectQuotaEventRows({...options,fetcher:async(url,request)=>{
    const q=JSON.parse(request.body);calls++;
    if(q.timeframe.to-q.timeframe.from>2*60000)return page([event('coarse-only')],10);
    return page([event('shared'),event(q.timeframe.from===options.from?'left':'right')]);
  }});
  assert.equal(calls,3);assert.equal(result.requests,3);assert.equal(result.coverage.length,2);
  assert.deepEqual(result.rows.map(x=>x.$metadata.id),['shared','left','right']);
  assert.equal(result.coverage[0].to,result.coverage[1].from);
  assert.equal(result.coverage[0].from,options.from);assert.equal(result.coverage[1].to,options.to);
});
test('a coarse later page discards earlier rows before partition recovery',async()=>{
  const full=Array.from({length:2000},(_,i)=>event('discard-'+i));
  const result=await collectQuotaEventRows({...options,fetcher:async(url,request)=>{
    const q=JSON.parse(request.body);
    if(q.timeframe.to-q.timeframe.from>2*60000)return q.offset?page([],10):page(full);
    return page([event('verified-'+q.timeframe.from)]);
  }});
  assert.equal(result.requests,4);assert.equal(result.rows.length,2);
  assert.ok(result.rows.every(x=>x.$metadata.id.startsWith('verified-')));
});
test('missing, malformed, and unresolved sampling evidence cannot imply completeness',async()=>{
  for(const level of [null,'1',0,-1])await assert.rejects(collectQuotaEventRows({...options,fetcher:async()=>page([],level)}),/sampling coverage unavailable/);
  await assert.rejects(collectQuotaEventRows({...options,to:options.from+60000,fetcher:async()=>page([],10)}),/sampling remains unresolved/);
  let calls=0;
  await assert.rejects(collectQuotaEventRows({...options,maxRequests:1,fetcher:async()=>{calls++;return page([],10);}}),/budget exceeded/);
  assert.equal(calls,1);
});
test('pagination detects a non-adjacent cursor cycle before exhausting the request budget',async()=>{
  let calls=0;
  await assert.rejects(collectQuotaEventRows({...options,fetcher:async()=>{
    const id=['a','b','a'][calls++];return page(Array.from({length:2000},()=>event(id)));
  }}),/pagination stalled/);
  assert.equal(calls,3);
});
test('concurrent records sharing provider ID and timestamp retain distinct traces and attempts',async()=>{
  const record=(trace,attempt=1,concurrency=1)=>({$metadata:{id:'shared-provider-id'},timestamp:now,
    source:{event:'quota_handler_start',trace,attempt,concurrency}});
  const first=record('ab'.repeat(16)),second=record('cd'.repeat(16),1,2),retry=record('ab'.repeat(16),2);
  const result=await collectQuotaEventRows({...options,event:'quota_handler_start',fetcher:async()=>page([first,first,second,retry])});
  assert.equal(result.rows.length,3);assert.deepEqual(result.rows,[first,second,retry]);
  const offsets=[];
  const paginated=await collectVerifiedTelemetry({from:options.from,to:options.to,pageSize:2,fetchPage:async({offset})=>{
    offsets.push(offset);
    const next={...retry,$metadata:{id:'next-provider-id'}};
    return {level:1,events:offset===null?[first,second]:offset==='shared-provider-id'?[second,next]:[]};
  }});
  assert.equal(paginated.rows.length,3);assert.deepEqual(offsets,[null,'shared-provider-id','next-provider-id']);
  await assert.rejects(collectQuotaEventRows({...options,event:'quota_handler_start',fetcher:async()=>page([first,record('ab'.repeat(16),1,99)])}),/Conflicting telemetry event identity/);
});
test('expired default history is explicit and never prevents a current settled collection',async()=>{
  const windows=forensicWindows(now);
  assert.equal(windows[0].status,'skipped');assert.equal(windows[0].reason,'outside_configured_retention');
  const queries=[];
  const report=await runQuotaForensics({now,env:{CLOUDFLARE_EDGE_TOKEN:token},fetcher:async(url,request)=>{
    if(url.includes('/zones?'))return Response.json({success:true,result:[{name:'packone.pro',status:'active',account:{id:account}}]});
    queries.push(JSON.parse(request.body));return page([]);
  }});
  assert.equal(queries.length,3);assert.equal(report.windows[1].status,'collected');
  assert.equal(report.windows[1].slow_request_stages.slow_retained,0);
  assert.equal(report.windows[1].slow_request_stages.gateway_records,0);
  assert.ok(queries.every(q=>q.timeframe.from===now-35*60000&&q.timeframe.to===now-5*60000));
});
test('explicit windows must be complete, canonical, settled and within bounds',()=>{
  const good={PACK1_QUOTA_FORENSICS_FROM:'2026-10-29T18:30:00Z',PACK1_QUOTA_FORENSICS_TO:'2026-10-29T18:55:00Z'};
  assert.equal(forensicWindows(now,good)[0].name,'requested');
  for(const changes of [{PACK1_QUOTA_FORENSICS_TO:undefined},{PACK1_QUOTA_FORENSICS_FROM:'2026-02-30T18:30:00Z'},
    {PACK1_QUOTA_FORENSICS_FROM:'2026-10-25T18:30:00Z'},{PACK1_QUOTA_FORENSICS_TO:'2026-10-29T19:00:00Z'},
    {PACK1_QUOTA_FORENSICS_FROM:'2026-10-29T17:00:00Z'},{PACK1_QUOTA_FORENSICS_FROM:'2026-10-29T18:30:00-05:00'}])
    assert.throws(()=>forensicWindows(now,{...good,...changes}),/bounded retention or settlement/);
});


const replayNow=Date.parse('2026-11-14T19:00:00Z');
const makeIncident=(number,condition,last,checked='2026-11-14T18:25:00.000Z',changes={})=>({
  number,state:'open',body:'Public category incident\n\n<!-- pack1-launch-incident-v1\n'+JSON.stringify({
    version:1,condition,status:'recovered',episodes:43,last_seen:last,checked_through:checked,...changes,
  })+'\n-->',
});
const lastSlow='2026-11-13T22:05:00.000Z',lastQuota='2026-11-12T22:20:00.000Z';
test('incident replay admits only canonical, settled, retained fixed issue windows',()=>{
  const slow=incidentReplayWindow(makeIncident(1272,'slow_requests',lastSlow),1272,'slow_requests',replayNow);
  assert.deepEqual(slow,{name:'slow_requests_last_breach',
    from:Date.parse('2026-11-13T21:45:00Z'),to:Date.parse('2026-11-13T22:10:00Z'),status:'collect'});
  const quota=incidentReplayWindow(makeIncident(1273,'slow_quota',lastQuota),1273,'slow_quota',replayNow);
  assert.equal(quota.status,'collect');assert.equal(quota.to-quota.from,25*60000);
  const expired=incidentReplayWindow(makeIncident(1272,'slow_requests','2026-11-09T22:05:00.000Z'),1272,'slow_requests',replayNow);
  assert.equal(expired.status,'skipped');assert.equal(expired.reason,'outside_configured_retention');
  const unsettled=incidentReplayWindow(makeIncident(1272,'slow_requests','2026-11-14T18:59:00.000Z',
    '2026-11-14T18:59:00.000Z'),1272,'slow_requests',replayNow);
  assert.equal(unsettled.status,'skipped');assert.equal(unsettled.reason,'not_settled');
});
test('issue body is untrusted: malformed, spoofed and future alert windows fail closed',()=>{
  const good=makeIncident(1272,'slow_requests',lastSlow);
  assert.deepEqual(incidentReplayWindow({...good,state:'closed'},1272,'slow_requests',replayNow),
    {name:'slow_requests_last_breach',status:'skipped',reason:'incident_closed'});
  const rejects=[
    {...good,number:1273},{...good,state:'invalid'},
    {...good,body:'No machine marker'},
    makeIncident(1272,'slow_requests',lastSlow,undefined,{condition:'slow_quota'}),
    makeIncident(1272,'slow_requests',lastSlow,undefined,{version:2}),
    makeIncident(1272,'slow_requests','2026-11-16T22:05:00.000Z'),
    makeIncident(1272,'slow_requests','2026-11-13T22:05:00-06:00'),
    makeIncident(1272,'slow_requests',lastSlow,'2026-11-13T21:00:00.000Z'),
    makeIncident(1272,'slow_requests',lastSlow,'2026-11-15T22:05:00.000Z'),
    makeIncident(1272,'slow_requests',lastSlow,undefined,{status:'unknown'}),
  ];
  for(const item of rejects)assert.throws(()=>incidentReplayWindow(item,1272,'slow_requests',replayNow));
});
test('protected read-only replay uses fixed issue IDs and no speculative retention queries',async()=>{
  const env={GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'killjoy00/mtg-ev-analyzer',
    GITHUB_TOKEN:token,CLOUDFLARE_EDGE_TOKEN:token,PACK1_READ_RECENT_ALERTS:'1'};
  const issues=[
    makeIncident(1272,'slow_requests',lastSlow),
    makeIncident(1273,'slow_quota',lastQuota),
  ];
  const calls=[],queries=[];
  const report=await runQuotaForensics({env,now:replayNow,fetcher:async(url,request)=>{
    if(url.includes('/issues/')) {
      calls.push({url,method:request.method,auth:request.headers.authorization,redirect:request.redirect});
      assert.equal(request.method,'GET');assert.equal(request.redirect,'error');
      return Response.json(issues[calls.length-1]);
    }
    if(url.includes('/zones?'))return Response.json({success:true,result:[{name:'packone.pro',status:'active',account:{id:account}}]});
    queries.push(JSON.parse(request.body));return page([]);
  }});
  assert.deepEqual(calls.map(c=>c.url),[
    'https://api.github.com/repos/killjoy00/mtg-ev-analyzer/issues/1272',
    'https://api.github.com/repos/killjoy00/mtg-ev-analyzer/issues/1273',
  ]);
  assert.ok(calls.every(c=>c.auth==='Bearer '+token&&c.redirect==='error'));
  assert.deepEqual(report.windows.map(w=>[w.window,w.status]),[
    ['historical_5xx_2026_10_26','skipped'],['current_recent','collected'],
    ['slow_requests_last_breach','collected'],['slow_quota_last_breach','collected'],
  ]);
  assert.equal(queries.length,9,'one bounded query per event type per collected window');
  assert.deepEqual(queries.slice(3,6).map(x=>x.timeframe.from),Array(3).fill(Date.parse('2026-11-13T21:45:00Z')));
  assert.deepEqual(queries.slice(6,9).map(x=>x.timeframe.to),Array(3).fill(Date.parse('2026-11-12T22:25:00Z')));
  assert.doesNotMatch(JSON.stringify(report),/Bearer|private-token|Public category incident|issues\/1272/);
  let called=0;
  await assert.rejects(recentIncidentWindows({env:{...env,GITHUB_TOKEN:''},now:replayNow,fetcher:async()=>{called++;}}),
    /Trusted incident read access unavailable/);
  assert.equal(called,0);
  const explicit={...env,PACK1_QUOTA_FORENSICS_FROM:'2026-11-14T18:00:00Z',PACK1_QUOTA_FORENSICS_TO:'2026-11-14T18:25:00Z'};
  assert.deepEqual(await recentIncidentWindows({env:explicit,now:replayNow,fetcher:async()=>{called++;}}),[]);
  assert.equal(called,0);
});
test('incident lookup errors are never silently replaced by a healthy current window',async()=>{
  const env={GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'killjoy00/mtg-ev-analyzer',
    GITHUB_TOKEN:token,CLOUDFLARE_EDGE_TOKEN:token,PACK1_READ_RECENT_ALERTS:'1'};
  let calls=0;
  await assert.rejects(runQuotaForensics({env,now:replayNow,fetcher:async()=>{calls++;return new Response('access details',{status:403});}}),
    /Read-only incident lookup unavailable/);
  assert.equal(calls,1);
});

function storageFixture({publicAccess=false,domains=[],ambiguous=false,mismatch=false}={}){
  const calls=[];let saved;
  return {calls,fetcher:async(url,request)=>{
    calls.push({url,method:request.method});
    assert.equal(request.redirect,'error');assert.equal(request.headers.authorization,'Bearer '+token);
    if(url.endsWith('/domains/managed'))return Response.json({success:true,result:{enabled:publicAccess}});
    if(url.endsWith('/domains/custom'))return Response.json({success:true,result:{domains}});
    if(request.method==='PUT'){saved=request.body;if(ambiguous)throw Error('lost acknowledgement');return new Response(null,{status:200});}
    return new Response(mismatch?'{}':saved,{status:200});
  }};
}
const context={runId:'12345',attempt:'1',sha:'a'.repeat(40),now};
test('private retention verifies both privacy controls and committed upload without mutation retry',async()=>{
  const f=storageFixture({ambiguous:true});await privateQuotaStore({token,fetcher:f.fetcher}).save({private:'diagnostic'},context);
  assert.equal(f.calls.filter(x=>x.method==='PUT').length,1);
  assert.ok(f.calls[0].url.endsWith('/domains/managed'));assert.ok(f.calls[1].url.endsWith('/domains/custom'));
  assert.ok(f.calls.at(-1).url.endsWith('/investigations/2026-10-29/quota-stage-12345-1.json'));
});
test('public destinations and mismatched readback are rejected without public fallbacks',async()=>{
  for(const setup of [{publicAccess:true},{domains:[{domain:'public.example'}]}]){
    const f=storageFixture(setup);await assert.rejects(privateQuotaStore({token,fetcher:f.fetcher}).save({},context),/not verified/);
    assert.equal(f.calls.filter(x=>x.method==='PUT').length,0);
  }
  const f=storageFixture({mismatch:true});await assert.rejects(privateQuotaStore({token,fetcher:f.fetcher}).save({},context),/readback failed/);
  assert.equal(f.calls.filter(x=>x.method==='PUT').length,1);
});
test('publication requires trusted main context and private credentials before querying telemetry',async()=>{
  let calls=0;const fetcher=async()=>{calls++;throw Error('must not call');};
  await assert.rejects(publishQuotaForensics({fetcher,env:{},now}),error=>quotaForensicsFailureCode(error)==='trusted_context');
  await assert.rejects(publishQuotaForensics({fetcher,env:{GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'killjoy00/mtg-ev-analyzer',GITHUB_RUN_ID:'12345',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'a'.repeat(40)},now}),error=>quotaForensicsFailureCode(error)==='private_storage_access');
  assert.equal(calls,0);
  const workflow=fs.readFileSync('.github/workflows/quota-stage-forensics.yml','utf8');
  assert.match(workflow,/CLOUDFLARE_PRIVATE_REPORT_TOKEN/);assert.doesNotMatch(workflow,/upload-artifact|schedule:/);
  assert.match(workflow,/  issues: read/);assert.match(workflow,/GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow,/PACK1_READ_RECENT_ALERTS: '1'/);
  assert.match(workflow,/diagnosis:[\s\S]*environment: pack-one-mobile-release/);
  const source=fs.readFileSync('scripts/quota-stage-forensics.mjs','utf8');
  assert.doesNotMatch(source,/console\.log\([^\n]*JSON\.stringify/);
});
const trustedEnv={GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'killjoy00/mtg-ev-analyzer',GITHUB_RUN_ID:'12345',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'a'.repeat(40),CLOUDFLARE_EDGE_TOKEN:token,CLOUDFLARE_PRIVATE_REPORT_TOKEN:token};
test('publisher completes collection, private write and readback in trusted context',async()=>{
  const storage=storageFixture();let queries=0;
  await publishQuotaForensics({now,env:trustedEnv,fetcher:async(url,options)=>{
    if(url.includes('/zones?'))return Response.json({success:true,result:[{name:'packone.pro',status:'active',account:{id:account}}]});
    if(url.includes('/observability/')){queries++;return page([]);}
    return storage.fetcher(url,options);
  }});
  assert.equal(queries,3);assert.equal(storage.calls.filter(x=>x.method==='PUT').length,1);
  assert.equal(storage.calls.filter(x=>x.url.endsWith('/domains/managed')).length,2);
});
test('public failure categories retain stages and HTTP status but never arbitrary messages or codes',async()=>{
  for(const value of [undefined,{message:'private provider payload'},{forensicCode:'storage_http_403 private data'},{forensicCode:'telemetry_http_999'},{forensicCode:123}])
    assert.equal(quotaForensicsFailureCode(value),'collection_unavailable');
  assert.equal(quotaForensicsFailureCode({forensicCode:'storage_http_403'}),'storage_http_403');
  for(const [stage,fetcher] of [
    ['storage_http_403',async()=>new Response('private provider payload',{status:403})],
    ['telemetry_http_400',async url=>url.endsWith('/domains/managed')?Response.json({success:true,result:{enabled:false}}):url.endsWith('/domains/custom')?Response.json({success:true,result:{domains:[]}}):new Response('private provider payload',{status:400})],
  ])await assert.rejects(publishQuotaForensics({now,env:trustedEnv,fetcher}),error=>quotaForensicsFailureCode(error)===stage&&!error.message.includes('private provider payload'));
});
