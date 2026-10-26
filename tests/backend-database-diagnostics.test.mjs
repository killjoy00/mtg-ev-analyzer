import test from 'node:test';
import assert from 'node:assert/strict';
import {inspect} from 'node:util';
import {observedRoute,observedDatabaseCall} from '../worker/backend-diagnostics.mjs';
import {query} from '../worker/growth-function.js';
import {isUsernameConflict} from '../worker/username.mjs';
import {reminderDatabaseReason} from '../worker/daily-reminders.mjs';
import {gateway} from '../edge/gateway.mjs';
import {TRACE_HEADER} from '../edge/private-diagnostics.mjs';

const trace='a'.repeat(32),otherTrace='b'.repeat(32);
const request=(id=trace,path='/v1/player/session')=>new Request('https://fixture.invalid'+path,{headers:{[TRACE_HEADER]:id,cookie:'private-cookie'}});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(run) {
 const oldLog=console.log,oldFetch=globalThis.fetch,oldDatabase=process.env.DATABASE_URL,rows=[];
 console.log=line=>rows.push(JSON.parse(line));
 process.env.DATABASE_URL='postgres://fixture:private-password@ep-fixture.example.invalid/fixture';
 try{return await run(rows);}finally{
   console.log=oldLog;globalThis.fetch=oldFetch;
   if(oldDatabase===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldDatabase;
 }
}
const sqlResult=()=>Response.json({fields:[{name:'value'}],rows:[['fixture']],rowCount:1});

test('actual query distinguishes waiting for response headers from waiting for its body',async()=>fixture(async rows=>{
 const headers=deferred(),body=deferred();let calls=0;
 globalThis.fetch=async()=>{calls++;await headers.promise;return {status:200,ok:true,json:()=>body.promise};};
 const pending=observedRoute(request(),'growth',async()=>{
   assert.deepEqual(await query('SELECT private_value WHERE account=$1',['private-account']),{rows:[{value:'fixture'}],rowCount:1});
   return new Response(null,{status:201});
 });
 await turn();assert.equal(calls,1);
 assert.equal(rows.at(-1).event,'backend_database_start');assert.equal(rows.at(-1).phase,'fetch');
 headers.resolve();await turn();
 assert.equal(rows.at(-1).event,'backend_database_headers');assert.equal(rows.at(-1).phase,'body');
 assert.equal(rows.some(r=>r.event==='backend_database'),false);
 body.resolve({fields:[{name:'value'}],rows:[['fixture']],rowCount:1});
 assert.equal((await pending).headers.get(TRACE_HEADER),trace);
 const metric=rows.find(r=>r.event==='backend_database');
 assert.equal(metric.ok,true);assert.equal(metric.phase,'complete');assert.equal(metric.http_status,200);
 for(const key of ['response_headers_ms','response_body_ms','duration_ms'])assert.ok(Number.isFinite(metric[key]));
 assert.equal(rows.at(-1).database_calls,1);assert.equal(rows.at(-1).database_completed,1);
 assert.doesNotMatch(JSON.stringify(rows),/private_|private-|postgres:|SELECT|account=|cookie|example\.invalid/);
}));

test('a committed insert with a lost SQL response is observed once and never retried',async()=>fixture(async rows=>{
 let commits=0;
 const error=Object.assign(new Error('private connection details'),{code:'ECONNRESET'});
 globalThis.fetch=async()=>{commits++;throw error;};
 await assert.rejects(observedRoute(request(),'growth',async()=>{
   await query('INSERT INTO players VALUES ($1)',['private-identity']);return new Response(null,{status:201});
 }),actual=>actual===error);
 assert.equal(commits,1);
 const metric=rows.find(r=>r.event==='backend_database');
 assert.equal(metric.phase,'fetch');assert.equal(metric.ok,false);assert.equal(metric.http_status,null);
 assert.equal(metric.failure_code,'ECONNRESET');assert.equal(rows.at(-1).failure_code,'ECONNRESET');
 assert.doesNotMatch(JSON.stringify(rows),/private connection|private-identity|INSERT/);
}));

test('SQL HTTP failure stays separate from an upstream 520 and preserves rollback-only retries',async()=>fixture(async rows=>{
 let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('private provider text',{status:520});};
 await assert.rejects(observedRoute(request(),'growth',()=>query('UPDATE private_table SET value=$1',['private-value'])));
 assert.equal(calls,1);
 assert.equal(rows.find(r=>r.event==='backend_database').http_status,520);
 assert.equal(rows.find(r=>r.event==='backend_database').phase,'body');
 assert.equal(rows.at(-1).status,500);
 assert.doesNotMatch(JSON.stringify(rows),/private provider text|private_table|private-value/);

 rows.length=0;calls=0;
 globalThis.fetch=async()=>++calls===1?Response.json({code:'40001',message:'private conflict'},{status:400}):sqlResult();
 await observedRoute(request(),'growth',async()=>{await query('UPDATE fixture SET value=$1',['unchanged']);return new Response(null,{status:201});});
 assert.equal(calls,2);
 assert.deepEqual(rows.filter(r=>r.event==='backend_database').map(r=>[r.sequence,r.ok,r.failure_code??null]),[[1,false,'40001'],[2,true,null]]);
 assert.equal(rows.at(-1).database_calls,2);
}));

test('database errors do not copy response bodies or internal metadata into exception logs',async()=>fixture(async()=>{
 let calls=0;
 for(const metadata of [{constraint:'players_username_uq'},{constraint_name:'players_username_uq'},{message:'duplicate key value violates unique constraint "players_username_uq"'}]) {
   globalThis.fetch=async()=>{calls++;return Response.json({code:'23505',...metadata,detail:'private SQL parameters and response body'},{status:400});};
   await assert.rejects(query('INSERT INTO fixture VALUES ($1)',['private-value']),error=>{
     assert.equal(error.message,'Database query failed (400).');
     assert.equal(error.pgCode,'23505');assert.equal(error.pgConstraint,'players_username_uq');
     assert.equal(isUsernameConflict(error),true,'constraint extraction must preserve the existing friendly conflict');
     assert.doesNotMatch(inspect(error),/private SQL|response body|23505|players_username_uq/);
     assert.equal(JSON.stringify(error),'{}');
     return true;
   });
 }
 assert.equal(calls,3);
 globalThis.fetch=async()=>Response.json({code:'private arbitrary code',constraint:'private arbitrary constraint'},{status:520});
 await assert.rejects(query('SELECT fixture'),error=>{
   assert.equal(error.pgCode,null);assert.doesNotMatch(inspect(error),/private arbitrary/);return true;
 });
}));

test('fixed SQL guard reasons and reminder domain codes survive without dynamic database text',async()=>fixture(async()=>{
 const cases=[
   ['Pick removal history is append-only',/append-only/],
   ['Latest Set Daily on 2026-09-03 references unvalidated regular set private-fixture-set.',/unvalidated regular set/],
   ...['REMINDER_INVALID_SCHEDULE','REMINDER_EMAIL_UNVERIFIED','REMINDER_EMAIL_SUPPRESSED','REMINDER_DEVICE_REQUIRED',
     'ACCOUNT_DELETING','SESSION_EXPIRED','DEVICE_PROOF_REQUIRED','DEVICE_VERSION_CHANGED','DEVICE_STILL_ATTACHED','DEVICE_LIMIT'].map(code=>[code,new RegExp(code)]),
 ];
 for(const [message,expected] of cases) {
   globalThis.fetch=async()=>Response.json({code:'P0001',message,detail:'private database detail'},{status:400});
   await assert.rejects(query('SELECT fixture'),error=>{
     assert.equal(error.pgCode,'P0001');assert.match(error.message,expected);
     assert.doesNotMatch(inspect(error),/private database detail|private-fixture-set|2026-09-03/);
     return true;
   });
 }
 assert.equal(reminderDatabaseReason('REMINDER_EMAIL_UNVERIFIED: private details'),null);
}));

test('a reset or abort while reading a successful SQL response body never replays its mutation',async()=>fixture(async rows=>{
 for(const error of [Object.assign(Error('private body reset'),{code:'ECONNRESET'}),new DOMException('private body abort','AbortError')]) {
   rows.length=0;let commits=0;
   globalThis.fetch=async()=>{commits++;return {status:200,ok:true,json:async()=>{throw error;}};};
   await assert.rejects(observedRoute(request(),'growth',()=>query('INSERT INTO fixture VALUES ($1)',['synthetic'])),actual=>actual===error);
   assert.equal(commits,1);
   const metric=rows.find(r=>r.event==='backend_database');
   assert.equal(metric.phase,'body');assert.equal(metric.http_status,200);assert.equal(metric.ok,false);
   assert.equal(metric.failure_code,error.code==='ECONNRESET'?'ECONNRESET':'abort');
   assert.doesNotMatch(JSON.stringify(rows),/private body|INSERT/);
 }
}));

test('a lost backend response can coexist with a completed database operation and no gateway acknowledgement',async()=>fixture(async rows=>{
 let commits=0,upstream=0;
 globalThis.fetch=async()=>{commits++;return sqlResult();};
 const env={MODE:'production',NEON_BRANCH_ID:'br-orange-feather-ayps8kep',QUOTA_KEY:'1'.repeat(64),NETWORK_QUOTA:{idFromName:id=>id,get:()=>({fetch:async()=>new Response(null,{status:204})})}};
 const response=await gateway(new Request('https://api.packone.pro/growth/v1/player/session',{method:'POST',body:'{}',headers:{'content-type':'application/json','cf-connecting-ip':'192.0.2.1'}}),env,async(url,options)=>{
   upstream++;
   const backend=await observedRoute(new Request(url,{headers:options.headers}),'growth',async()=>{
     await query('INSERT INTO fixture VALUES ($1)',['synthetic']);return new Response(null,{status:201});
   });
   assert.equal(backend.status,201);
   return new Response('Synthetic lost backend response',{status:520});
 });
 assert.equal(response.status,520);assert.equal(commits,1);assert.equal(upstream,1);
 assert.equal(rows.find(r=>r.event==='backend_database').ok,true);
 assert.equal(rows.find(r=>r.event==='backend_request').status,201);
 const metric=rows.find(r=>r.event==='gateway_request');
 assert.equal(metric.upstream_calls,1);assert.equal(metric.upstream_backend_ack,false);
 assert.doesNotMatch(JSON.stringify(rows),/Synthetic lost|192\.0\.2|INSERT/);
}));

test('database detail is bounded, private and isolated between concurrent requests',async()=>fixture(async rows=>{
 const first=deferred(),second=deferred();
 const run=(id,gate)=>observedRoute(request(id),'growth',async()=>{
   await gate.promise;
   for(let n=0;n<20;n++)await observedDatabaseCall(async headers=>{headers(200);return 'private row';});
   return new Response(null,{status:201});
 });
 const a=run(trace,first),b=run(otherTrace,second);second.resolve();await b;first.resolve();await a;
 for(const id of [trace,otherTrace]) {
   const own=rows.filter(r=>r.trace===id),end=own.at(-1);
   assert.equal(own.filter(r=>r.event==='backend_database_start').length,12);
   assert.equal(own.filter(r=>r.event==='backend_database_headers').length,12);
   assert.equal(own.filter(r=>r.event==='backend_database').length,12);
   assert.equal(end.database_calls,20);assert.equal(end.database_completed,20);assert.equal(end.database_details_omitted,8);
   assert.deepEqual(own.filter(r=>r.event==='backend_database').map(r=>r.sequence),Array.from({length:12},(_,i)=>i+1));
 }
 assert.doesNotMatch(JSON.stringify(rows),/private row|private-cookie/);
}));

test('untraced and non-target routes do not collect database details; late background work stays silent',async()=>fixture(async rows=>{
 const operation=()=>observedDatabaseCall(async headers=>{headers(200);return true;});
 await operation();assert.equal(rows.length,0);
 await observedRoute(request('invalid'),'growth',async()=>{await operation();return new Response();});assert.equal(rows.length,0);
 await observedRoute(request(trace,'/health'),'draft',async()=>{await operation();return new Response();});
 assert.equal(rows.length,2);assert.equal(rows.at(-1).database_calls,undefined);
 const gate=deferred();let background;
 await observedRoute(request(),'growth',async()=>{
   background=gate.promise.then(operation);return new Response(null,{status:201});
 });
 const count=rows.length;gate.resolve();await background;assert.equal(rows.length,count);
}));

test('a database diagnostic logging failure does not fail or repeat the operation',async()=>fixture(async()=>{
 const old=console.log;let calls=0;
 await observedRoute(request(),'growth',async()=>{
   console.log=()=>{throw Error('Synthetic log failure');};
   try{assert.equal(await observedDatabaseCall(async headers=>{calls++;headers(200);return 1;}),1);}finally{console.log=old;}
   return new Response(null,{status:201});
 });
 assert.equal(calls,1);
}));
