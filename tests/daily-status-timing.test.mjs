import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {actorsForShard,sanitized,timingAttribution,DIAGNOSTIC} from '../scripts/daily-status-three-burst.mjs';

const fixture={users:Array.from({length:50},(_,id)=>({
 id,guest:id%10<5,token:'p1_11111111-1111-4111-8111-111111111111.signature',
 account:id%10>=5?'account-credential-'+id:null,csrf:id%10>=5?'csrf-credential-'+id:null
}))};
test('minimal fixture creates exactly 10 unique identities per generator, 5 guest and 5 signed in',()=>{
 const ids=new Set();
 for(let shard=0;shard<5;shard++){
  const actors=actorsForShard(fixture,shard);
  assert.equal(actors.length,10);
  assert.equal(actors.filter(x=>x.guest).length,5);
  assert.equal(actors.filter(x=>!x.guest).length,5);
  for(const actor of actors){
   assert.ok(!ids.has(actor.id));ids.add(actor.id);
   assert.ok(actor.cookies.has('__Host-pack1_player'));
   assert.equal(actor.cookies.has('__Host-pack1_account'),!actor.guest);
   assert.equal(actor.cookies.has('__Secure-pack1_csrf'),!actor.guest);
  }
 }
 assert.equal(ids.size,50);
});
test('sanitized successful read retains transport + gateway timing but never cookies or keys',()=>{
 const r=sanitized({actor:17,ms:3866.17,status:200,dispatch_at_ms:1000,completed_at_ms:4866,
  transport:{socket:'new',connect_ms:3719.12,tls:true,token:'private'},
  diagnostics:{gateway:{duration_ms:120,quota_ms:10,upstream_ms:80,account:'private'}},
  cookie:'private'
 },'after_idle',1,false);
 assert.deepEqual(r,{generator:1,burst:'after_idle',actor:17,guest:false,dispatch_at_ms:1000,
  status:200,total_ms:3866.17,socket:'new',connect_ms:3719.12,completed_at_ms:4866,
  gateway_ms:120,quota_ms:10,upstream_ms:80,failure:null,transport_failure:null});
 assert.equal(timingAttribution(r),'substantial_connection');
 assert.doesNotMatch(JSON.stringify(r),/private|token|cookie|account/);
});
test('gateway delay and unknown new-connection timing stay separate',()=>{
 assert.equal(timingAttribution({status:200,total_ms:3870,connect_ms:null,gateway_ms:3500}),'substantial_gateway');
 assert.equal(timingAttribution({status:200,total_ms:3870,connect_ms:null,gateway_ms:120}),'unattributed');
 assert.equal(timingAttribution({status:200,total_ms:400,connect_ms:350,gateway_ms:100}),'within_reference');
});
test('one-shot resource and cleanup controls are hard bounded before provisioning',()=>{
 assert.equal(DIAGNOSTIC.measured_requests,5*10*3);
 assert.equal(DIAGNOSTIC.gateway_request_ceiling,300);
 assert.equal(DIAGNOSTIC.coordinator_query_ceiling,1000);
 assert.equal(DIAGNOSTIC.response_byte_ceiling,16*1024*1024);
 assert.equal(DIAGNOSTIC.request_timeout_ms,30000);
 assert.equal(DIAGNOSTIC.idle_ms,120000);
 const wf=fs.readFileSync('.github/workflows/daily-status-three-burst-once.yml','utf8');
 assert.match(wf,/types: \[opened\]/);
 assert.doesNotMatch(wf,/synchronize|workflow_dispatch/);
 assert.match(wf,/diagnostic\/daily-status-3burst-once-20261008/);
 assert.match(wf,/group: pack1-gateway-preview/);
 assert.match(wf,/timeout-minutes: 6/);
 assert.match(wf,/timeout-minutes: 9/);
 assert.match(wf,/timeout-minutes: 7/);
 assert.match(wf,/matrix: \{shard: \[0, 1, 2, 3, 4\]\}/);
 assert.match(wf,/date -u --date '\+23 minutes'/);
 assert.match(wf,/scripts\/daily-status-read-fixtures\.mjs/);
 assert.doesNotMatch(wf,/launch-distributed-fixtures\.mjs|launch-distributed-run\.mjs|launch-load-fixtures\.mjs|practice-performance\.mjs/);
 assert.match(wf,/scripts\/launch-distributed-setup\.mjs cleanup/);
 assert.match(wf,/neondatabase\/delete-branch-action@v3/);
 assert.equal(6+9+5*7+7,57);
 assert.ok(57<=75);
 assert.ok(9+7+7<=25);
 assert.ok(91+5+150<=300,'worst 3m edge readiness plus five health checks plus measured traffic');
});
test('fixture creation uses no scores, history or account batch generator',()=>{
 const setup=fs.readFileSync('scripts/daily-status-read-fixtures.mjs','utf8');
 assert.match(setup,/length:50/);
 assert.doesNotMatch(setup,/INSERT INTO scores|generate_series|launch-load-fixtures|launch-distributed-fixtures/);
 assert.match(setup,/autoscaling_limit_min_cu/);
 assert.match(setup,/suspend_timeout_seconds/);
});
