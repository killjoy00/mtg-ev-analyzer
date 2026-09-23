import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {neonTriggerInvocationHeader,verifyNeonScheduleTrigger,zonedDateTime} from '../worker/neon-trigger.mjs';
import {NEON_PROJECT_ID,PRODUCTION_BRANCH,NEON_SCHEDULERS,reconcileNeonSchedulers} from '../scripts/reconcile-neon-schedulers.mjs';

function triggerRequest(invocationId='trigger-invocation') {
  return new Request('https://origin.test/internal',{
    method:'POST',
    headers:{'content-type':'application/json','x-neon-trigger-invocation-id':invocationId},
  });
}

function triggerBody({invocationId='trigger-invocation',name='pack1-daily-primary',scheduledAt='2041-06-15T07:07:00Z'}={}) {
  return {
    version:1,
    invocation_id:invocationId,
    trigger:{type:'schedule',id:'trigger-11111111-1111-4111-8111-111111111111',name},
    data:{scheduled_at:scheduledAt},
  };
}

test('Neon schedule trigger identity requires the edge-attested header and exact envelope',()=>{
  const request=triggerRequest();
  assert.equal(neonTriggerInvocationHeader(request),'trigger-invocation');
  const parsed=verifyNeonScheduleTrigger(request,triggerBody(),{names:new Set(['pack1-daily-primary'])});
  assert.equal(parsed.name,'pack1-daily-primary');
  assert.equal(parsed.scheduledAt,'2041-06-15T07:07:00Z');
  assert.equal(verifyNeonScheduleTrigger(new Request('https://origin.test/internal',{method:'POST'}),triggerBody()),null);
  assert.throws(
    ()=>verifyNeonScheduleTrigger(triggerRequest('different'),triggerBody(),{names:new Set(['pack1-daily-primary'])}),
    error=>error?.status===403,
  );
  assert.throws(
    ()=>verifyNeonScheduleTrigger(request,triggerBody({name:'unexpected'}),{names:new Set(['pack1-daily-primary'])}),
    error=>error?.status===403,
  );
});

test('paired UTC Daily trigger hours resolve exactly once at Pacific midnight across DST',()=>{
  assert.deepEqual(zonedDateTime('2041-06-15T07:07:00Z','America/Los_Angeles'),{date:'2041-06-15',hour:0,minute:7});
  assert.deepEqual(zonedDateTime('2041-06-15T08:07:00Z','America/Los_Angeles'),{date:'2041-06-15',hour:1,minute:7});
  assert.deepEqual(zonedDateTime('2041-01-15T08:07:00Z','America/Los_Angeles'),{date:'2041-01-15',hour:0,minute:7});
  assert.deepEqual(zonedDateTime('2041-01-15T07:07:00Z','America/Los_Angeles'),{date:'2041-01-14',hour:23,minute:7});
});

test('production scheduler definitions are narrow, UTC and point only at reviewed internal routes',()=>{
  assert.equal(NEON_PROJECT_ID,'patient-shadow-91417882');
  assert.equal(PRODUCTION_BRANCH,'br-orange-feather-ayps8kep');
  assert.deepEqual(NEON_SCHEDULERS.map(row=>({
    name:row.name,
    slug:row.function_slug,
    path:row.function_path,
    cron:row.schedule.cron,
  })),[
    {name:'pack1-daily-primary',slug:'draftrunapi',path:'/internal/daily-generation',cron:'7 7,8 * * *'},
    {name:'pack1-daily-retry',slug:'draftrunapi',path:'/internal/daily-generation',cron:'37 7,8 * * *'},
    {name:'pack1-account-deletion-maintenance',slug:'pack1growth',path:'/internal/account-deletion-maintenance',cron:'9,19,29,39,49,59 * * * *'},
  ]);
});

test('scheduler reconciliation updates known triggers, creates missing ones, and preserves unrelated triggers',async()=>{
  const calls=[];
  const existing={
    type:'schedule',
    trigger_id:'trigger-existing',
    function_slug:'draftrunapi',
    name:'pack1-daily-primary',
    function_path:'/old',
    schedule:{cron:'0 0 * * *'},
    enabled:false,
    inherited:false,
  };
  const fetcher=async(url,options={})=>{
    calls.push({url:String(url),method:options.method||'GET',body:options.body?JSON.parse(options.body):null});
    if((options.method||'GET')==='GET')return Response.json({triggers:[existing,{name:'unrelated-trigger',type:'schedule'}]});
    const body=JSON.parse(options.body);
    const trigger={...body,trigger_id:body.name==='pack1-daily-primary'?'trigger-existing':'trigger-'+body.name,inherited:false,next_run_at:'2041-01-01T00:00:00Z'};
    return Response.json({trigger},{status:(options.method||'GET')==='POST'?201:200});
  };
  const result=await reconcileNeonSchedulers({enabled:true,apiKey:'napi_'+'x'.repeat(40),fetcher});
  assert.equal(result.enabled,true);
  assert.equal(result.results.length,3);
  assert.equal(calls.filter(call=>call.method==='PATCH').length,1);
  assert.equal(calls.filter(call=>call.method==='POST').length,2);
  assert.equal(calls.some(call=>JSON.stringify(call.body||{}).includes('unrelated-trigger')),false);
});

test('scheduler release is manual-only and verifies exact production function revision before enable',()=>{
  const flow=fs.readFileSync('.github/workflows/neon-scheduler-release.yml','utf8');
  assert.match(flow,/workflow_dispatch:/);
  assert.doesNotMatch(flow,/^\s*schedule:/m);
  assert.match(flow,/NEON_API_KEY/);
  assert.match(flow,/RELEASE_COMMIT/);
  assert.match(flow,/git rev-parse origin\/main/);
  assert.match(flow,/br-orange-feather-ayps8kep-draftrunapi/);
  assert.match(flow,/br-orange-feather-ayps8kep-pack1growth/);
  assert.match(flow,/release_commit/);
  assert.match(flow,/reconcile-neon-schedulers\.mjs "\$ACTION"/);
});
