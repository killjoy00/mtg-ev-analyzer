import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {fingerprint,initialControl,transition,evaluateStage,timing,permittedRequest,quantiles,validatePolicy,stageFailureEvidence} from '../scripts/launch-distributed-core.mjs';
import {policy,heartbeat,coordinatorSQL} from '../scripts/launch-distributed-control.mjs';
import {inspectBin,inspectPreviewTelemetry,settlePreviewTelemetry,previewTelemetryFailure,queryPreviewEvents} from '../scripts/launch-distributed-telemetry.mjs';
import {parseStartDiagnostics,requestClient} from '../scripts/launch-distributed-player.mjs';
import {transportFailureEvidence,undiciTransportObserver} from '../scripts/launch-distributed-transport.mjs';
import {inspectPreflightEvents,preflightTelemetry} from '../scripts/launch-distributed-setup.mjs';
import {waitForPreviewReadiness} from '../scripts/edge-control.mjs';
const start=1_000_000,scope={sha:'a'.repeat(40),branch:'br-capacity-fixture',run_id:'123',attempt:'2',policy_hash:fingerprint(policy)};
const msg=(shard,extra={})=>({scope,shard,nonce:`00000000-0000-4000-8000-${String(shard).padStart(12,'0')}`,network:String(shard+1).repeat(64),ready:0,ack:null,done:null,...extra});
const formed=()=>{let s=initialControl(scope,start,policy);for(let i=0;i<5;i++)s=transition(s,msg(i),start+100,policy);return s;};
const released=()=>{let s=formed();for(let i=0;i<5;i++)s=transition(s,msg(i,{ack:0}),start+200,policy);return s;};

test('preview readiness cannot pass on one good response followed by a stale response',async()=>{
 let now=0,index=0;
 const responses=[{status:200,release:scope.sha},{status:403,release:null}];
 const result=await waitForPreviewReadiness({commit:scope.sha,required:2,interval_ms:1,deadline_ms:2,
   clock:()=>now,sleep:async ms=>{now+=ms;},probe:async()=>responses[Math.min(index++,responses.length-1)]});
 assert.equal(result.ready,false);assert.equal(result.attempts,2);assert.equal(result.consecutive,0);
});
test('committed policy is bounded and cannot silently claim 100 or launch 500 players',()=>{
 assert.equal(validatePolicy(policy),policy);
 assert.deepEqual(policy.stages,[{players:25,hold_seconds:120},{players:50,hold_seconds:600}]);assert.equal(policy.supported_launch_target,50);assert.equal(policy.proposed_target,50);
 assert.throws(()=>validatePolicy({...policy,stages:[...policy.stages,{players:100,hold_seconds:600}],proposed_target:100}));
 assert.throws(()=>validatePolicy({...policy,stages:[policy.stages[0],{players:50,hold_seconds:180}]}),'final stage keeps the 600 s sustained hold');
 const nat=JSON.parse(fs.readFileSync(new URL('../scripts/launch-load-policy.json',import.meta.url),'utf8'));
 assert.deepEqual(nat.nat_stages,[25,50]);assert.equal('distributed_stages' in nat,false);
 assert.deepEqual(policy.route_budgets_ms.start,{p95:3000,p99:8000});
 for(const patch of [{supported_launch_target:25},{supported_launch_target:100},{generators:20},{maximum_compute_cu:9},{maximum_error_fraction:.01},{maximum_branch_lifetime_minutes:120},{telemetry_preflight_requests:101}])assert.throws(()=>validatePolicy({...policy,...patch}));
 assert.throws(()=>validatePolicy({...policy,stages:[...policy.stages,{players:500,hold_seconds:600}]}));
 assert.throws(()=>initialControl({...scope,branch:'br-orange-feather-ayps8kep'},start,policy));
});
test('a late fifth runner cannot miss a pre-scheduled start: no start exists until all are ready',()=>{
 let s=initialControl(scope,start,policy);
 for(let i=0;i<4;i++)s=transition(s,msg(i),start+100,policy);
 assert.equal(s.phase,'forming');assert.equal(s.start_at,undefined);
 for(let i=0;i<4;i++)s=transition(s,msg(i),start+240000,policy);
 assert.equal(s.start_at,undefined);
 s=transition(s,msg(4),start+240100,policy);assert.equal(s.phase,'armed');assert.equal(s.start_at,start+270100);
 for(let i=0;i<4;i++)s=transition(s,msg(i,{ack:0}),start+240200,policy);
 assert.equal(s.phase,'armed');s=transition(s,msg(4,{ack:0}),start+240300,policy);assert.equal(s.phase,'released');
});
test('missing, duplicated, changed and spoof-free network evidence fail closed',()=>{
 let s=initialControl(scope,start,policy);s=transition(s,msg(0),start+100,policy);
 assert.equal(transition(s,msg(1,{network:msg(0).network}),start+200,policy).failure.reason,'duplicate_real_egress');
 assert.equal(transition(s,msg(1,{network:null}),start+200,policy).failure.reason,'missing_real_egress');
 assert.equal(transition(s,msg(0,{network:'f'.repeat(64)}),start+200,policy).failure.reason,'egress_changed');
 assert.equal(transition(s,msg(0,{nonce:'11111111-1111-4111-8111-111111111111'}),start+200,policy).failure.reason,'duplicate_generator');
 assert.equal(transition(s,msg(1,{scope:{...scope,attempt:'1'}}),start+200,policy).failure.reason,'scope_mismatch');
 assert.equal(transition(s,msg(1),start+481000,policy).failure.reason,'incomplete_cohort');
});
test('lost heartbeat cannot be erased by the late runner refreshing itself',()=>{
 let s=released();
 for(let i=1;i<5;i++)s=transition(s,msg(i,{ack:0}),start+19000,policy);
 assert.equal(transition(s,msg(0,{ack:0}),start+21000,policy).failure.reason,'lost_heartbeat');
});
test('all start acknowledgements are required, and stage failure cannot escalate',()=>{
 const s=formed();
 let waiting=s;for(let i=0;i<5;i++)waiting=transition(waiting,msg(i,{ack:i<4?0:null}),start+19000,policy);
 assert.equal(transition(waiting,msg(0,{ack:0}),s.start_at-policy.ack_margin_seconds*1000,policy).failure.reason,'missing_start_ack');
 const aborted=transition(released(),msg(0,{failure:{category:'application',reason:'http_503'}}),start+300,policy);
 assert.equal(aborted.phase,'aborted');assert.equal(aborted.stage,0);
 assert.deepEqual(transition(aborted,msg(0,{decision:{stage:0,passed:true}}),start+400,policy),aborted);
});
test('positive application, telemetry and usage decisions are all required between stages',()=>{
 let s=released();
 for(let i=0;i<5;i++)s=transition(s,msg(i,{ack:0,done:0}),start+300,policy);
 assert.equal(s.phase,'checking');
 assert.equal(transition(s,msg(0,{done:0,decision:{stage:0,passed:true,telemetry_passed:false,usage_passed:true}}),start+400,policy).phase,'aborted');
 s=transition(s,msg(0,{done:0,decision:{stage:0,passed:true,telemetry_passed:true,usage_passed:true}}),start+400,policy);
 assert.equal(s.stage,1);assert.equal(s.phase,'forming');assert.equal(s.start_at,undefined);
 assert.equal(transition(s,msg(0,{ready:1}),start+500,policy).phase,'forming');
});
test('CAS heartbeat handles simultaneous actual asynchronous contenders without losing registrations',async()=>{
 let state=initialControl(scope,start,policy),revision=0,misses=0;
 const sql=async(query,params=[])=>{
   if(query.startsWith('SELECT')){const snapshot={revision:String(revision),state:JSON.stringify(state),now_ms:String(start+100)};await new Promise(r=>setTimeout(r,2));return [snapshot];}
   if(Number(params[1])!==revision){misses++;return [];}
   state=JSON.parse(params[0]);revision++;return [{revision:String(revision)}];
 };
 await Promise.all(Array.from({length:5},(_,i)=>heartbeat(sql,msg(i))));
 assert.equal(Object.keys(state.cohort).length,5);assert.equal(state.phase,'armed');assert.ok(misses>0);
});
test('SQL transport binds the verified database connection and rejects application SQL',async()=>{
 const connection='postgresql://fixture:private@ep-test.us-east-2.aws.neon.tech/pack1';let calls=0;
 const sql=coordinatorSQL(connection,{fetcher:async(url,options)=>{
   calls++;assert.equal(url,'https://api.us-east-2.aws.neon.tech/sql');assert.equal(options.headers['Neon-Connection-String'],connection);assert.equal(options.redirect,'error');
   return Response.json({fields:[{name:'revision'}],rows:[['3']]});
 }});
 assert.deepEqual(await sql('SELECT revision FROM pack1_load_control_v2'),[{revision:'3'}]);
 await assert.rejects(()=>sql('DELETE FROM players'));assert.equal(calls,1);
});
function completeReports() {
 const windows=timing(start,policy.stages[0],policy),reports=[];
 for(let shard=0;shard<5;shard++) {
  const r={scope,stage:0,shard,start_at:start,network:msg(shard).network,start_lateness_ms:0,started:5,initial_completed:5,correctness_failures:0,failures:[],arrival_delay_ms:[0,0,0,0,0],actors:[],requests:[],daily:{mixed:['a'.repeat(64)],'powered-cube':['b'.repeat(64)],latest:['c'.repeat(64)]},recovery_started_at:windows.recovery,recovery_ended_at:windows.end};
  r.actors=Array.from({length:5},(_,i)=>({id:shard*5+i,guest:false,hold_runs:1,hold_reads:2,hold_entered_at:windows.hold,hold_exited_at:windows.drain}));
  for(const [route,count] of Object.entries(policy.minimum_route_samples))for(let i=0;i<Math.ceil(count/5);i++)r.requests.push({route,phase:'initial',at:start+1,status:200,ms:50,bytes:10});
  for(const route of ['pick','reroll','read'])r.requests.push({route,phase:'hold',at:windows.hold+1,status:200,ms:50,bytes:10});
  r.requests.push({route:'read',phase:'recovery',at:windows.recovery+1,status:200,ms:50,bytes:10});reports.push(r);
 }
 return reports;
}
const evaluate=reports=>evaluateStage(reports,{scope,stage:0,start_at:start,networks:Object.fromEntries(reports.map(r=>[r.shard,r.network]))},policy);
test('complete route, actor, sustained hold, recovery and cross-generator Daily evidence passes',()=>{
 const result=evaluate(completeReports());assert.equal(result.passed,true);assert.equal(result.target,25);assert.equal(result.distinct_real_egress,5);assert.equal(result.correctness_failures,0);assert.equal(result.routes.pick.p99_ms,50);
});
test('three-second draft-start p95 is accepted but anything slower still fails',()=>{
 const atBudget=completeReports();for(const report of atBudget)for(const request of report.requests)if(request.route==='start')request.ms=3000;
 assert.equal(evaluate(atBudget).passed,true);
 const tooSlow=completeReports();for(const report of tooSlow)for(const request of report.requests)if(request.route==='start')request.ms=3001;
 const result=evaluate(tooSlow);assert.equal(result.passed,false);assert.ok(result.reasons.some(r=>r.reason==='route_latency_start'||r.reason==='initial_latency_start'));
});
for(const [name,mutate] of [
 ['absent runner',r=>r.pop()],['duplicate runner',r=>r[1].shard=0],['missing route',r=>r.forEach(x=>x.requests=x.requests.filter(y=>y.route!=='reroll'))],
 ['incorrect Daily',r=>r[1].daily.mixed=['f'.repeat(64)]],['incomplete hold',r=>r[1].actors[0].hold_runs=0],['absent recovery',r=>delete r[1].recovery_ended_at],
 ['missing hold writes',r=>r.forEach(x=>x.requests=x.requests.filter(y=>y.phase!=='hold'))],['late arrival',r=>r[2].arrival_delay_ms[0]=2000],
 ['missing clock',r=>delete r[0].start_lateness_ms],['wrong attempt',r=>r[0].scope={...scope,attempt:'1'}],['duplicate actors',r=>r[1].actors[0].id=0],
 ['application 503',r=>r[0].requests[0].status=503],['unintended 429',r=>r[0].requests[0].status=429],['failed correctness',r=>r[0].correctness_failures=1],
 ['latency failure',r=>r.forEach(x=>x.requests.filter(y=>y.route==='start').forEach(y=>y.ms=9000))],
])test('capacity evaluator rejects '+name,()=>{const reports=completeReports();mutate(reports);assert.equal(evaluate(reports).passed,false);});
test('missing samples are unknown, never zero-millisecond latency',()=>{assert.deepEqual(quantiles([]),{samples:0,p50_ms:null,p95_ms:null,p99_ms:null,max_ms:null});});
test('request routing never permits production, provider, email or arbitrary mutations',()=>{
 for(const path of ['https://api.packone.pro/draft/v1/runs','https://packone.pro/draft/v1/runs','/growth/v1/auth/send-email','/growth/v1/patreon/connect','/billing','/draft/v1/admin'])assert.throws(()=>permittedRequest(path,{}));
 assert.equal(permittedRequest('/draft/v1/daily-status').hostname,'api-preview.packone.pro');
 assert.throws(()=>permittedRequest('/draft/v1/daily-status',{}));
});
test('request ceiling reserves exactly the machine-declared telemetry preflight budget',async()=>{
 const budget={gateway_requests:Math.floor((policy.maximum_requests-policy.telemetry_preflight_requests)/policy.generators),response_bytes:0};
 const client=requestClient({fixture:{preview:'a'.repeat(64)},policy,budget,now:()=>start,signal:new AbortController().signal,fetcher:async()=>Response.json({ok:true})});
 await assert.rejects(()=>client(null,'read','/draft/v1/daily-status'),/request_ceiling/);
});
test('client really preserves cookies, CSRF and idempotency without forwarding-header spoofing or retries',async()=>{
 const budget={gateway_requests:0,response_bytes:0},actor={cookies:new Map([['__Host-pack1_player','fixture']]),csrf:'csrf'},requests=[];
 const client=requestClient({fixture:{preview:'a'.repeat(64)},policy,budget,now:()=>start,signal:new AbortController().signal,fetcher:async(url,options)=>{
  requests.push(options);return Response.json({ok:true},{headers:{'set-cookie':'__Host-pack1_player=updated; Secure; HttpOnly'}});
 }});
 await client(actor,'start','/draft/v1/runs',{environment:'mixed'});
 assert.equal(actor.cookies.get('__Host-pack1_player'),'updated');assert.equal(requests[0].headers['x-pack1-csrf'],'csrf');assert.match(requests[0].headers['x-idempotency-key'],/^[a-f0-9-]{36}$/);
 for(const key of Object.keys(requests[0].headers))assert.doesNotMatch(key,/forwarded|connecting-ip|real-ip/);
 let failures=0;const broken=requestClient({fixture:{preview:'a'.repeat(64)},policy,budget,now:()=>start,signal:new AbortController().signal,fetcher:async()=>{failures++;return Response.json({error:'busy'},{status:503});}});
 await assert.rejects(()=>broken(actor,'start','/draft/v1/runs',{environment:'mixed'}),/http_503/);assert.equal(failures,1);
});

const fakeTransportObserver=state=>({begin:()=>({bound:false,body_present:true,headers_sent:false,body_sent:false,socket:'unknown',connect_ms:null,tls:null,...state}),end(){}});
async function capturedTransportFailure({error,state={},aborted=false}) {
 const budget={gateway_requests:0,response_bytes:0},report={requests:[]},controller=new AbortController(),actor={id:17,cookies:new Map(),csrf:null};if(aborted)controller.abort();
 let calls=0;const fetcher=async()=>{calls++;throw error;};
 const client=requestClient({fixture:{preview:'a'.repeat(64)},policy,budget,now:()=>start,signal:controller.signal,fetcher,
   transportObserver:fakeTransportObserver(state),request_timeout_ms:5});
 let caught=null;
 try {await client(actor,'pick','/draft/v1/runs/11111111-1111-4111-8111-111111111111/pick',{revision:1,round:0,puzzleId:'p',cardId:'c'},{report});}
 catch(error){caught=error;}
 assert.ok(caught);assert.equal(calls,1,'transport failure must never retry a mutation');
 assert.equal(report.requests[0].actor,17);assert.equal(report.requests[0].actor_request,1);
 return {record:report.requests[0],caught};
}
test('transport diagnostics retain reset evidence on a reused socket without changing failure acceptance',async()=>{
 const cause=Object.assign(Error('other side closed'),{name:'SocketError',code:'UND_ERR_SOCKET'});
 const {record,caught}=await capturedTransportFailure({error:Object.assign(new TypeError('fetch failed'),{cause}),
   state:{bound:true,headers_sent:true,body_sent:true,socket:'reused',tls:true}});
 assert.equal(caught.message,'fetch failed');assert.equal(caught.category,'application');
 assert.equal(record.transport.label,'post_send');assert.equal(record.transport.role,'unclassified');
 assert.equal(record.transport.error_name,'TypeError');assert.equal(record.transport.cause_code,'UND_ERR_SOCKET');assert.equal(record.transport.cause_name,'SocketError');
 assert.equal(record.transport.message,'fetch failed');assert.equal(record.transport.cause_message,'other side closed');
 assert.equal(record.transport.headers_sent,true);assert.equal(record.transport.body_present,true);assert.equal(record.transport.body_sent,true);
 assert.equal(record.transport.socket,'reused');assert.equal(record.transport.connect_ms,null);assert.equal(record.transport.tls,true);assert.equal(record.transport.tls_ms,null);
 assert.ok(record.transport.elapsed_ms>=0);assert.equal(record.status,0);
});
test('transport diagnostics retain connect timeout and TLS causes as proven pre-send failures',async()=>{
 for(const [code,name] of [['UND_ERR_CONNECT_TIMEOUT','ConnectTimeoutError'],['ERR_TLS_CERT_ALTNAME_INVALID','Error']]) {
   const cause=Object.assign(Error('connect failed to 192.0.2.44 token_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789'),{name,code});
   const {record,caught}=await capturedTransportFailure({error:Object.assign(new TypeError('fetch failed'),{cause}),state:{bound:true}});
   assert.equal(caught.message,'fetch failed');assert.equal(caught.category,'application');assert.equal(record.transport.label,'pre_send');
   assert.equal(record.transport.headers_sent,false);assert.equal(record.transport.body_sent,false);assert.equal(record.transport.socket,'unknown');
   assert.equal(record.transport.cause_code,code);assert.equal(record.transport.cause_name,name);assert.equal(record.transport.message,'fetch failed');
   assert.match(record.transport.cause_message,/\[ip\].*\[redacted\]/);assert.doesNotMatch(record.transport.cause_message,/192\.0\.2\.44|ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789/);
 }
});
test('unbound diagnostics never overclaim a proven pre-send failure',async()=>{
 const {record}=await capturedTransportFailure({error:new TypeError('fetch failed')});
 assert.equal(record.transport.label,'unknown');assert.equal(record.transport.headers_sent,false);assert.equal(record.transport.socket,'unknown');
});
test('AbortSignal timeout is distinct from cohort abort fallout',async()=>{
 const timeout=await capturedTransportFailure({error:new DOMException('The operation was aborted due to timeout','TimeoutError'),
   state:{bound:true,headers_sent:true,body_sent:true,socket:'new',connect_ms:11.23,tls:true}});
 assert.equal(timeout.record.transport.label,'post_send');assert.equal(timeout.record.transport.error_name,'TimeoutError');
 assert.equal(timeout.record.transport.socket,'new');assert.equal(timeout.record.transport.connect_ms,11.23);assert.equal(timeout.caught.message,'The operation was aborted due to timeout');assert.equal(timeout.caught.category,'application');
 const fallout=await capturedTransportFailure({error:new DOMException('This operation was aborted','AbortError'),
   state:{bound:true,headers_sent:true,body_sent:true,socket:'reused',tls:true},aborted:true});
 assert.equal(fallout.record.transport.label,'abort_fallout');assert.equal(fallout.record.transport.error_name,'AbortError');
 assert.equal(fallout.caught.message,'This operation was aborted');assert.equal(fallout.caught.category,'application');
});

async function listenLoopback(server) {
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return server.address().port;
}
async function closeLoopback(server) {
 server.closeAllConnections?.();
 if(server.listening)await new Promise(resolve=>server.close(resolve));
}
function loopbackFixture() {
 const socketIds=new WeakMap(),socketUses=new WeakMap(),requests=[];let nextSocketId=1;
 const server=http.createServer((request,response)=>{
   const socket=request.socket,id=socketIds.get(socket)||nextSocketId++;
   socketIds.set(socket,id);const use=(socketUses.get(socket)||0)+1;socketUses.set(socket,use);
   const label=use===1?'new':'reused',row={method:request.method,path:request.url,socket:id,use,label};requests.push(row);request.resume();
   if(request.url==='/reset'&&label==='reused'){socket.resetAndDestroy();return;}
   if(request.url==='/destroy'&&label==='reused'){socket.destroy();return;}
   const finish=()=>{if(response.destroyed)return;response.setHeader('x-test-socket-id',String(id));response.setHeader('x-test-socket-label',label);response.end('ok');};
   if(request.url==='/concurrent')setTimeout(finish,25);else finish();
 });
 server.keepAliveTimeout=10000;server.headersTimeout=12000;server.on('clientError',()=>{});
 return {server,requests};
}
async function observedLoopbackFetch(url,options={}) {
 const method=options.method||'GET',bodyPresent=options.body!==undefined,state=undiciTransportObserver.begin({url:new URL(url),method,bodyPresent});
 try {
   const response=await fetch(url,options),serverLabel=response.headers.get('x-test-socket-label'),socketId=response.headers.get('x-test-socket-id');
   await response.text();assert.ok(['new','reused'].includes(serverLabel));assert.equal(state.socket,serverLabel);
   return {state,serverLabel,socketId};
 } finally {undiciTransportObserver.end(state);}
}
async function observedLoopbackFailure(url,options={}) {
 const method=options.method||'GET',bodyPresent=options.body!==undefined,state=undiciTransportObserver.begin({url:new URL(url),method,bodyPresent}),started=performance.now();
 try {await fetch(url,options);return null;}
 catch(error){return {state,error,evidence:transportFailureEvidence(error,state,{elapsedMs:performance.now()-started})};}
 finally {undiciTransportObserver.end(state);}
}

test('real global fetch transport diagnostics match loopback socket ground truth',async t=>{
 t.diagnostic('runtime Node '+process.versions.node+' / undici '+(process.versions.undici||'unknown'));
 const dead=http.createServer(),deadPort=await listenLoopback(dead);await closeLoopback(dead);
 const refused=await observedLoopbackFailure('http://127.0.0.1:'+deadPort+'/refused');
 assert.ok(refused);assert.equal(refused.evidence.label,'pre_send');assert.equal(refused.evidence.cause_code,'ECONNREFUSED');assert.equal(refused.evidence.headers_sent,false);
 assert.match(refused.evidence.cause_message,/\[ip\]/);assert.doesNotMatch(refused.evidence.cause_message,/127\.0\.0\.1/);

 const fixture=loopbackFixture(),port=await listenLoopback(fixture.server),origin='http://127.0.0.1:'+port;t.after(()=>closeLoopback(fixture.server));
 const sequential=[await observedLoopbackFetch(origin+'/sequential'),await observedLoopbackFetch(origin+'/sequential')];
 t.diagnostic('sequential socket labels observer/server: '+sequential.map(r=>r.state.socket+'/'+r.serverLabel+'#'+r.socketId).join(', '));

 // Warm reusable connections, then compare six identical concurrent requests
 // against the server's per-socket request count. This exercises the FIFO
 // method+origin+path request:create binding under real concurrency.
 await Promise.all([observedLoopbackFetch(origin+'/warm-a'),observedLoopbackFetch(origin+'/warm-b')]);
 const concurrent=await Promise.all(Array.from({length:6},()=>observedLoopbackFetch(origin+'/concurrent')));
 for(const row of concurrent)assert.equal(row.state.socket,row.serverLabel);
 t.diagnostic('six concurrent identical GETs observer/server: '+concurrent.map(r=>r.state.socket+'/'+r.serverLabel+'#'+r.socketId).join(', '));

 const failOnReused=async(path,code,messagePattern)=>{
   for(let attempt=0;attempt<8;attempt++) {
     await observedLoopbackFetch(origin+'/warm-failure');
     const before=fixture.requests.length,result=await observedLoopbackFailure(origin+path,{method:'POST',body:'payload'}),serverRow=fixture.requests.slice(before).find(r=>r.path===path);
     if(!result){assert.equal(serverRow?.label,'new');continue;}
     assert.ok(serverRow,'server must have received the failing POST');assert.equal(serverRow.label,'reused');assert.equal(result.state.socket,'reused');
     assert.equal(result.evidence.label,'post_send');assert.equal(result.evidence.headers_sent,true);assert.equal(result.evidence.cause_code,code);
     assert.match(result.evidence.cause_message,messagePattern);return result;
   }
   assert.fail('did not place '+path+' on a reused loopback socket');
 };
 const reset=await failOnReused('/reset','ECONNRESET',/reset/i);assert.equal(reset.evidence.socket,'reused');
 const destroyed=await failOnReused('/destroy','UND_ERR_SOCKET',/other side closed/i);assert.equal(destroyed.evidence.socket,'reused');
});

test('draft PRs cannot provision preview resources and ready-for-review can trigger the scoped workflow',()=>{
 const workflow=fs.readFileSync(new URL('../.github/workflows/launch-distributed.yml',import.meta.url),'utf8');
 assert.match(workflow,/require_performance: \$\{\{ steps\.scope\.outputs\.require_performance \}\}/);
 assert.match(workflow,/REQUIRE_PERFORMANCE: \$\{\{ needs\.scope\.outputs\.require_performance \}\}/);
 assert.match(workflow,/node scripts\/require-ci-source.mjs/);
 const sourceGate=fs.readFileSync('scripts/require-ci-source.mjs','utf8');
 assert.match(sourceGate,/requirePerformance\?\['test','browser','baseline'\]:\['test','browser'\]/);
 assert.match(workflow,/pull_request:\n\s+types: \[opened, synchronize, reopened, ready_for_review\]/);
 assert.match(workflow,/github\.event\.pull_request\.draft == false/);
 const preview=fs.readFileSync('.github/workflows/launch-distributed-preview.yml','utf8');
 const artifactLines=preview.split('\n').filter(line=>/name: (?:isolated-encrypted-fixtures|distributed-capacity-)|pattern: distributed-capacity-/.test(line));
 assert.ok(artifactLines.length>=6);for(const line of artifactLines)assert.match(line,/github\.run_attempt/);
});

test('runner retains bounded preview timings beside unsampled client duration',async()=>{
 const headers=new Headers({
   'x-pack1-gateway-timing':JSON.stringify({duration_ms:130,quota_ms:20,upstream_ms:90,secret:'discard'}),
   'x-pack1-start-timing':JSON.stringify({v:1,total_ms:75,phases:{selection:60,private:88},selector:{candidate:{count:8,sum_ms:55,max_ms:20},other:{count:999,sum_ms:1,max_ms:1}}}),
 });
 assert.deepEqual(parseStartDiagnostics(headers),{gateway:{duration_ms:130,quota_ms:20,upstream_ms:90},origin:{
   total_ms:75,phases:{selection:60},selector:{candidate:{count:8,sum_ms:55,max_ms:20}},
 }});
 const budget={gateway_requests:0,response_bytes:0},report={requests:[]};
 const client=requestClient({fixture:{preview:'a'.repeat(64)},policy,budget,now:()=>start,signal:new AbortController().signal,
   fetcher:async()=>Response.json({ok:true},{headers})});
 await client(null,'start','/draft/v1/runs',{environment:'mixed'},{report});
 assert.equal(report.requests.length,1);assert.equal(report.requests[0].diagnostics.origin.phases.selection,60);
 assert.ok(report.requests[0].ms>=0);
 assert.equal(parseStartDiagnostics(new Headers({'x-pack1-start-timing':'not json'})),null);
 const reroll=new Headers({'x-pack1-gateway-timing':headers.get('x-pack1-gateway-timing'),
   'x-pack1-reroll-timing':JSON.stringify({v:1,total_ms:120,phases:{session:30,selection:80,private:200},selector:{metadata:{count:1,sum_ms:10,max_ms:10},reroll:{count:1,sum_ms:75,max_ms:75}}})});
 assert.deepEqual(parseStartDiagnostics(reroll,'reroll'),{gateway:{duration_ms:130,quota_ms:20,upstream_ms:90},origin:{total_ms:120,phases:{session:30,selection:80},selector:{metadata:{count:1,sum_ms:10,max_ms:10},reroll:{count:1,sum_ms:75,max_ms:75}}}});
 const view=new Headers({'x-pack1-view-timing':JSON.stringify({v:1,total_ms:80,phases:{player:20,body:1,observation:59,private:42},selector:{other:{count:1,sum_ms:40,max_ms:40}}})});
 assert.deepEqual(parseStartDiagnostics(view,'view'),{origin:{total_ms:80,phases:{player:20,body:1,observation:59},selector:{}}});
});
const event=(extra={})=>({id:'event',release:scope.sha,status:200,duration_ms:50,quota_ms:5,upstream_ms:40,...extra});
test('telemetry bins keep ambient preview boundary rejects distinct from cohort and system failures',()=>{
 const clean=inspectBin([event()],{sha:scope.sha,requests:25,from:0,to:60},policy);assert.equal(clean.passed,true);assert.deepEqual(clean.status_counts,{'200':1});
 const ambient=inspectBin([event(),event({id:'ambient',status:403,route:'other'})],{sha:scope.sha,requests:25,from:0,to:60},policy);
 assert.equal(ambient.passed,true);assert.equal(ambient.boundary_rejections,1);assert.equal(ambient.route_status_counts['other:403'],1);
 for(const events of [[],[event({release:'b'.repeat(40)})],[event({status:503})],[event({status:429})]])assert.equal(inspectBin(events,{sha:scope.sha,requests:25,from:0,to:60},policy).passed,false);
});
test('preview log query uses bounded cursor pages, the real retained-event parser and exact service filtering',async()=>{
 const row=id=>({$metadata:{id},source:{event:'gateway_request',release:scope.sha,status:200,duration_ms:10,sample_rate:1,route:'draft_pick'}});
 const first=Array.from({length:2000},(_,i)=>row('retained-'+i)),calls=[];
 const fetcher=async(url,options)=>{
  const body=JSON.parse(options.body);calls.push(body);
  assert.equal(url,'https://api.cloudflare.com/client/v4/accounts/account/workers/observability/telemetry/query');
  assert.equal(body.limit,2000);assert.equal(body.view,'events');assert.equal(body.parameters.filters[0].value,'pack1-gateway-preview');
  assert.equal(body.parameters.filters[1].value,'gateway_request');
  return Response.json({success:true,result:{events:{events:calls.length===1?first:[row('retained-1999'),row('retained-2000')]}}});
 };
 const result=await queryPreviewEvents(fetcher,'token','account',0,60000);
 assert.equal(calls.length,2);assert.equal(calls[0].offset,undefined);assert.equal(calls[1].offset,'retained-1999');assert.equal(calls[1].offsetDirection,'next');
 assert.equal(result.length,2001);assert.equal(new Set(result.map(e=>e.id)).size,2001);
});
test('inaccessible, stuck-cursor and schema-invalid retained preview telemetry cannot produce a pass',async()=>{
 await assert.rejects(()=>queryPreviewEvents(async()=>Response.json({}, {status:403}),'t','a',0,500),/preview_telemetry_http_403/);
 await assert.rejects(()=>queryPreviewEvents(async()=>Response.json({result:{}}),'t','a',0,500),/invalid_preview_log_schema/);
 await assert.rejects(()=>queryPreviewEvents(async()=>Response.json({success:true,result:{events:{events:[{source:{}}]}}}),'t','a',0,500),/invalid_retained_preview_event/);
 const row=id=>({$metadata:{id},source:{event:'gateway_request',release:scope.sha,status:200,duration_ms:10,sample_rate:1,route:'draft_pick'}});
 const stuck=Array.from({length:2000},(_,i)=>row('stuck-'+i));
 await assert.rejects(()=>queryPreviewEvents(async()=>Response.json({success:true,result:{events:{events:stuck}}}),'t','a',0,500),/invalid_preview_log_cursor/);
});
test('telemetry artifact exposes only bounded failure codes',()=>{
 assert.equal(previewTelemetryFailure(Error('preview_telemetry_http_429')),'preview_telemetry_http_429');
 assert.equal(previewTelemetryFailure(Error('invalid_preview_log_schema')),'invalid_preview_log_schema');
 assert.equal(previewTelemetryFailure(Error('credential secret text')),'preview_telemetry_unclassified');
});
test('telemetry preflight requires exact health evidence but tolerates ambient boundary rejects',()=>{
 const health=event({route:'health'}),ambient=event({id:'ambient',status:403,route:'other'});
 const accepted=inspectPreflightEvents([health,ambient],scope.sha);
 assert.equal(accepted.passed,true);assert.equal(accepted.matching_events,1);assert.equal(accepted.boundary_rejections,1);assert.equal(accepted.system_errors,0);
 for(const bad of [event({id:'old',route:'health',release:'b'.repeat(40)}),event({id:'quota',route:'health',status:429}),event({id:'server',route:'health',status:503})])assert.equal(inspectPreflightEvents([health,bad],scope.sha).passed,false);
 assert.equal(inspectPreflightEvents([ambient],scope.sha).passed,false,'ambient traffic alone is not positive instrumentation evidence');
});
test('preview telemetry preflight waits beyond initial settlement but still fails at the declared timeout',async()=>{
 const saved={sha:process.env.GITHUB_SHA,key:process.env.PREVIEW_ACCESS_KEY,token:process.env.CLOUDFLARE_EDGE_TOKEN};
 process.env.GITHUB_SHA=scope.sha;process.env.PREVIEW_ACCESS_KEY='b'.repeat(64);process.env.CLOUDFLARE_EDGE_TOKEN='token';
 const row={$metadata:{id:'preflight-retained'},source:{event:'gateway_request',release:scope.sha,status:200,duration_ms:10,sample_rate:.1,route:'health'}};
 const run=async(delayed)=>{
  let now=0,queries=0,health=0;
  const fetcher=async(url,options)=>{
   if(url.includes('/zones?'))return Response.json({success:true,result:[{account:{id:'a'.repeat(32)}}]});
   if(url.includes('/telemetry/query')){queries++;const rows=delayed&&queries>=4?[row]:[];return Response.json({success:true,result:{events:{events:rows}}});}
   if(url.startsWith('https://api-preview.packone.pro/')){health++;return Response.json({release_commit:scope.sha});}
   throw Error('unexpected_preflight_url');
  };
  const report=await preflightTelemetry({fetcher,clock:()=>now,sleep:async ms=>{now+=ms;}});
  return {report,health};
 };
 try {
  const delayed=await run(true);assert.equal(delayed.report.passed,true);assert.equal(delayed.health,policy.telemetry_preflight_requests);assert.equal(delayed.report.checks.length,3);
  const absent=await run(false);assert.equal(absent.report.passed,false);assert.equal(absent.report.reason,'positive_preview_telemetry_missing');assert.equal(absent.report.checks.at(-1).retained_events,0);
 } finally {
  if(saved.sha===undefined)delete process.env.GITHUB_SHA;else process.env.GITHUB_SHA=saved.sha;
  if(saved.key===undefined)delete process.env.PREVIEW_ACCESS_KEY;else process.env.PREVIEW_ACCESS_KEY=saved.key;
  if(saved.token===undefined)delete process.env.CLOUDFLARE_EDGE_TOKEN;else process.env.CLOUDFLARE_EDGE_TOKEN=saved.token;
 }
});
test('complete preview inspection rejects a missing active minute, not just an empty full-run result',async()=>{
 const to=120000,requests=[{at:1},{at:60001}],row={$metadata:{id:'retained'},source:{event:'gateway_request',release:scope.sha,status:200,duration_ms:10,sample_rate:.1,route:'draft_pick'}};
 const report=await inspectPreviewTelemetry({reports:[{requests}],sha:scope.sha,from:0,to,policy,account:'a',token:'t',clock:()=>to+120000,fetcher:async(url,options)=>Response.json({result:{events:{events:JSON.parse(options.body).timeframe.from===0?[row]:[]}}})});
 assert.equal(report.passed,false);assert.equal(report.bins[0].passed,true);assert.equal(report.bins[1].passed,false);
});
test('stage telemetry rereads the same fixed windows until delayed retained coverage appears',async()=>{
 const to=120000,requests=[{at:1},{at:60001}],frames=[];let now=to+policy.telemetry_settlement_seconds*1000,tailQueries=0;
 const row=id=>({$metadata:{id},source:{event:'gateway_request',release:scope.sha,status:200,duration_ms:10,sample_rate:1,route:'draft_pick'}});
 const fetcher=async(url,options)=>{
  const timeframe=JSON.parse(options.body).timeframe;frames.push(timeframe);
  if(timeframe.from===0)return Response.json({result:{events:{events:[row('first-bin')]}}});
  tailQueries++;return Response.json({result:{events:{events:tailQueries>=2?[row('delayed-tail')]:[]}}});
 };
 const report=await settlePreviewTelemetry({reports:[{requests}],sha:scope.sha,from:0,to,policy,account:'a',token:'t',clock:()=>now,sleep:async ms=>{now+=ms;},fetcher});
 assert.equal(report.passed,true);assert.equal(report.checks.length,2);assert.equal(report.checks[0].missing_or_sparse_bins.length,1);
 assert.deepEqual(report.checks[0].missing_or_sparse_bins[0],{from:60000,to:120000,client_requests:1,retained_events:0,required_events:1});
 assert.equal(report.checks[1].missing_or_sparse_bins.length,0);assert.equal(tailQueries,2);
 assert.deepEqual(frames,[{from:0,to:60000},{from:60000,to:120000},{from:0,to:60000},{from:60000,to:120000}]);
 assert.equal(report.settlement_seconds,policy.telemetry_settlement_seconds);assert.equal(report.timeout_seconds,policy.telemetry_timeout_seconds);
});
test('stage telemetry preserves coverage requirements through the hard timeout and never polls hard failures',async()=>{
 const to=120000,requests=[{at:1},{at:60001}],row=(id,status=200)=>({$metadata:{id},source:{event:'gateway_request',release:scope.sha,status,duration_ms:10,sample_rate:1,route:'draft_pick'}});
 let now=to+policy.telemetry_settlement_seconds*1000,sleeps=0;
 const absent=await settlePreviewTelemetry({reports:[{requests}],sha:scope.sha,from:0,to,policy,account:'a',token:'t',clock:()=>now,sleep:async ms=>{sleeps++;now+=ms;},
  fetcher:async(url,options)=>Response.json({result:{events:{events:JSON.parse(options.body).timeframe.from===0?[row('first-bin')]:[]}}})});
 assert.equal(absent.passed,false);assert.equal(now,to+policy.telemetry_timeout_seconds*1000);assert.ok(sleeps>0);
 assert.equal(absent.checks.at(-1).missing_or_sparse_bins[0].required_events,1);
 let hardSleeps=0,hardNow=to+policy.telemetry_settlement_seconds*1000;
 const hard=await settlePreviewTelemetry({reports:[{requests}],sha:scope.sha,from:0,to,policy,account:'a',token:'t',clock:()=>hardNow,sleep:async ms=>{hardSleeps++;hardNow+=ms;},
  fetcher:async(url,options)=>Response.json({result:{events:{events:JSON.parse(options.body).timeframe.from===0?[row('first-bin')]:[row('system-error',503)]}}})});
 assert.equal(hard.passed,false);assert.equal(hardSleeps,0);assert.ok(hard.bins[1].failures.includes('retained_system_error'));
});

test('paced harness executes eight picks, repeated practice/rerolls and recovery against a stateful application fixture',async()=>{
 const {runPlayerStage}=await import('../scripts/launch-distributed-player.mjs');
 const mini={...policy,ramp_seconds:0,initial_seconds:2,stages:[{players:25,hold_seconds:.2}],drain_seconds:.5,recovery_seconds:.05,think_time_ms:[1,2],guest_read_interval_ms:5,recovery_read_interval_ms:5,minimum_rolling_route_samples:10000};
 const users=Array.from({length:100},(_,i)=>({token:'player'+i,account:'account'+i,csrf:'csrf'+i}));
 const fixture={users,sets:['a','b','c'],preview:'a'.repeat(64)},budget={gateway_requests:0,response_bytes:0},runs=new Map(),calls=[],controller=new AbortController();
 let pickCount=0,rerolls=0;const render=run=>({...run,current:{puzzle_id:(run.day?run.environment:run.id)+'-'+run.round,candidates:[{id:'card'}]},run_length:8,complete:run.round===8,score:run.round===8?80:undefined});
 const client=requestClient({fixture,policy:mini,budget,now:Date.now,signal:controller.signal,fetcher:async(url,options)=>{
  const pathname=new URL(url).pathname,body=options.body?JSON.parse(options.body):null;calls.push({pathname,body});
  if(pathname==='/growth/v1/player/session')return Response.json({ok:true});
  if(pathname==='/draft/v1/daily-status')return Response.json({ranking_identity:{eligible:true}});
  if(pathname==='/draft/v1/practice-sets'||pathname==='/growth/v1/profile/me'||pathname==='/draft/v1/leaderboard')return Response.json({rows:[]});
  if(pathname==='/draft/v1/runs') {
   const run={id:crypto.randomUUID(),revision:0,round:0,day:body.daily?'2026-09-26':null,environment:body.environment,leaderboard_eligible:true,answers:[]};runs.set(run.id,run);return Response.json(render(run),{status:201});
  }
  const match=pathname.match(/^\/draft\/v1\/runs\/([^/]+)\/(view|pick|reroll|share)$/);assert.ok(match,'no other mutation is allowed');
  const run=runs.get(match[1]);assert.ok(run);
  if(match[2]==='view'){assert.equal(body.revision,run.revision);run.view=body.viewId;return Response.json({ok:true});}
  if(match[2]==='reroll'){assert.equal(run.day,null);assert.equal(body.revision,run.revision);run.revision++;rerolls++;return Response.json(render(run));}
  if(match[2]==='pick') {
   assert.equal(body.viewId,run.view);assert.equal(body.revision,run.revision);assert.equal(body.round,run.round);assert.equal(body.puzzleId,render(run).current.puzzle_id);
   run.answers.push({score:80});run.round++;run.revision++;pickCount++;return Response.json(render(run));
  }
  assert.equal(run.round,8);return Response.json(run.day?{daily:true,url:'/draft/?daily=1'}:{id:'a'.repeat(24)});
 }});
 const failures=[],report=await runPlayerStage({fixture,policy:mini,scope,stage:0,shard:1,start_at:Date.now()+10,network:msg(1).network,now:Date.now,signal:controller.signal,client,onFailure:f=>{failures.push(f);controller.abort();}});
 assert.deepEqual(failures,[]);assert.equal(report.initial_completed,5);assert.ok(report.actors.every(a=>a.hold_runs>0));
 assert.ok(pickCount>=80);assert.ok(rerolls>=7);assert.ok(report.requests.some(r=>r.phase==='recovery'));assert.ok(report.requests.some(r=>r.phase==='hold'&&r.route==='pick'));
 assert.equal(report.correctness_failures,0);assert.ok(report.recovery_ended_at>=report.windows.end);
 assert.equal(calls.filter(c=>c.pathname==='/growth/v1/player/session').length,5,'no identity creation during hold');
});

test('settlement waits for the inspection clock even when the first timer wakes early',async()=>{
 const to=60000,settledAt=to+policy.telemetry_settlement_seconds*1000;
 let now=settledAt-10,queries=0;const sleeps=[];
 const row={$metadata:{id:'retained'},source:{event:'gateway_request',release:scope.sha,status:200,duration_ms:10,sample_rate:1,route:'draft_pick'}};
 const result=await settlePreviewTelemetry({reports:[{requests:[{at:1}]}],sha:scope.sha,from:0,to,policy,account:'a',token:'t',clock:()=>now,
  sleep:async ms=>{sleeps.push(ms);now+=sleeps.length===1?ms-1:ms;},
  fetcher:async()=>{assert.ok(now>=settledAt,'never query unsettled evidence');queries++;return Response.json({result:{events:{events:[row]}}});}});
 assert.equal(result.passed,true);assert.deepEqual(sleeps,[10,1]);assert.equal(queries,1);
 assert.equal(result.checks[0].queried_at,new Date(settledAt).toISOString());
});
test('safe telemetry diagnostics distinguish settlement, timeout and transport errors',()=>{
 assert.equal(previewTelemetryFailure(Error('telemetry_not_settled')),'telemetry_not_settled');
 assert.equal(previewTelemetryFailure(new DOMException('private URL and credential','TimeoutError')),'preview_telemetry_timeout');
 assert.equal(previewTelemetryFailure(Object.assign(new TypeError('private connection'),{cause:{code:'ECONNRESET',message:'private credential'}})),'preview_telemetry_transport_econnreset');
 assert.equal(previewTelemetryFailure(Object.assign(Error('private credential'),{code:'secret_token'})),'preview_telemetry_unclassified');
});
test('stage gate logs expose aggregate causes without fixture or provider secrets',()=>{
 const s={target:25,passed:false,reasons:[{category:'telemetry',reason:'retained_preview_coverage_failed',private:'secret'}],
  scope:{preview:'secret',connection:'secret'},requests:[{cookie:'secret'}],
  telemetry:{passed:false,reason:'retained_preview_api_or_schema_unavailable',detail:'preview_telemetry_timeout',secret:'secret',
   bins:[{passed:false,from:1,to:2,client_requests:20,retained_events:0,required_events:1,failures:['missing_or_sparse_retained_telemetry'],events:[{ip:'secret'}]}]},
  usage:{passed:true,comparison:{status:'reported_counter_delta',delta_bytes:100,secret:'secret'},ceiling_bytes:1000,current:{credential:'secret'}}};
 const evidence=stageFailureEvidence(s);
 assert.equal(evidence.telemetry.detail,'preview_telemetry_timeout');assert.equal(evidence.telemetry.failed_bins[0].required_events,1);
 assert.equal(evidence.usage.delta_bytes,100);assert.equal(JSON.stringify(evidence).includes('secret'),false);
 s.telemetry.detail='credential secret';assert.equal(stageFailureEvidence(s).telemetry.detail,'unclassified');
});
