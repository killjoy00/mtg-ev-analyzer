import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {selectNatPolicy} from '../scripts/launch-load-core.mjs';
import {quotaSecretUpdate} from '../scripts/edge-production-control.mjs';
import {gateway,routeFamily} from '../edge/gateway.mjs';

test('NAT defaults to 25 players and requires explicit 50-player selection without changing budgets',()=>{
  const envelope=JSON.parse(fs.readFileSync(new URL('../scripts/launch-load-policy.json',import.meta.url),'utf8'));
  const required=selectNatPolicy(envelope);
  assert.deepEqual(required.nat_stages,[25]);assert.deepEqual(selectNatPolicy(envelope,'50'),envelope);
  assert.deepEqual({...required,nat_stages:envelope.nat_stages},envelope);
  for(const target of ['', '100', 'skip', 25, null])assert.throws(()=>selectNatPolicy(envelope,target));
  assert.throws(()=>selectNatPolicy({...envelope,nat_stages:[25,50,100]},'50'));
  const workflow=fs.readFileSync(new URL('../.github/workflows/launch-load.yml',import.meta.url),'utf8');
  assert.match(workflow,/options: \['25', '50'\]/);
  assert.match(workflow,/PACK1_CAPACITY_TARGET: \$\{\{ inputs\.capacity_target \|\| '25' \}\}/);
  assert.ok(workflow.indexOf('Validate and declare NAT target')<workflow.indexOf('Create disposable production-sized branch'));
});

test('routine uploads preserve quota identity and only first install generates a secret',()=>{
  let calls=0;const generate=()=>{calls++;return 'a'.repeat(64);};
  assert.deepEqual(quotaSecretUpdate({result:{bindings:[{name:'QUOTA_KEY',type:'secret_text'}]}},generate),{});
  assert.equal(calls,0);
  assert.deepEqual(quotaSecretUpdate(null,generate),{QUOTA_KEY:'a'.repeat(64)});
  assert.equal(calls,1);
  assert.throws(()=>quotaSecretUpdate({result:{bindings:[{name:'QUOTA_KEY',type:'plain_text'}]}},generate));
});
test('telemetry classifies only fixed route families and excludes secrets, paths and network identities',async()=>{
  assert.equal(routeFamily('/draft/v1/runs/secret-id/pick'),'draft_pick');
  assert.equal(routeFamily('/growth/v1/account/reset-password'),'account');
  assert.equal(routeFamily('/unknown/secret'),'other');
  const logs=[],prior=console.log;
  console.log=value=>logs.push(value);
  try {
    const env={MODE:'production',NEON_BRANCH_ID:'br-orange-feather-ayps8kep',QUOTA_KEY:'a'.repeat(64),RELEASE_COMMIT:'b'.repeat(40),
      NETWORK_QUOTA:{idFromName:x=>x,get:()=>({fetch:async()=>Response.json({scopes:['session']},{status:429})})}};
    const result=await gateway(new Request('https://api.packone.pro/growth/v1/player/session?secret=query-value',{
      method:'POST',body:'{}',headers:{'content-type':'application/json','cf-connecting-ip':'192.0.2.9',cookie:'__Host-pack1_player=private-cookie'},
    }),env,()=>{throw Error('Must not reach origin');});
    assert.equal(result.status,429);
    const row=JSON.parse(logs[0]);
    assert.equal(row.route,'player_session');assert.equal(row.quota_scope,'session');assert.equal(row.upstream_calls,0);
    assert.doesNotMatch(logs.join(''),/192\.0\.2|private-cookie|query-value|secret=|authorization|network_id/);
    assert.ok(Number.isInteger(row.duration_ms));
  } finally {console.log=prior;}
});
