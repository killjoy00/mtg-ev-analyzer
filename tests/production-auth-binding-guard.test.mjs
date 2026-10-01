import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PROD_AUTH_BASE,
  endpointIdForAuthBase,
  verifyProductionAuthBinding,
  webhookProductionAuthBase,
} from '../scripts/production-auth-binding-guard.mjs';

test('production Auth binding guard pins the serving endpoint and webhook base',async()=>{
  assert.equal(endpointIdForAuthBase(PROD_AUTH_BASE),'ep-young-hall-ayl0754j');
  assert.equal(webhookProductionAuthBase(`const CONFIGS={production:{
    worker:'pack1-authhook',
    authBase:'${PROD_AUTH_BASE}',
  },};`),PROD_AUTH_BASE);

  const calls=[];
  const fetcher=async(url,init)=>{
    calls.push({url:String(url),method:init?.method});
    const value=String(url);
    if(value.endsWith('/auth'))return Response.json({
      auth_provider:'better_auth',
      branch_id:'br-orange-feather-ayps8kep',
      base_url:PROD_AUTH_BASE,
    });
    if(value.endsWith('/endpoints/ep-young-hall-ayl0754j'))return Response.json({endpoint:{
      id:'ep-young-hall-ayl0754j',
      branch_id:'br-orange-feather-ayps8kep',
    }});
    throw Error('unexpected URL');
  };
  const result=await verifyProductionAuthBinding({
    key:'n'.repeat(32),
    fetcher,
    webhookSource:`const CONFIGS={production:{
      worker:'pack1-authhook',
      authBase:'${PROD_AUTH_BASE}',
    },};`,
  });
  assert.equal(result.endpoint_id,'ep-young-hall-ayl0754j');
  assert.equal(calls.length,2);
  assert.ok(calls.every(call=>call.method==='GET'));
});

test('production Auth binding guard fails closed on control-plane drift',async()=>{
  const goodWebhook=`const CONFIGS={production:{
    worker:'pack1-authhook',
    authBase:'${PROD_AUTH_BASE}',
  },};`;
  await assert.rejects(()=>verifyProductionAuthBinding({
    key:'n'.repeat(32),
    webhookSource:goodWebhook,
    fetcher:async url=>{
      if(String(url).endsWith('/auth'))return Response.json({base_url:'https://ep-wrong.neonauth.example/pack1/auth'});
      return Response.json({endpoint:{id:'ep-young-hall-ayl0754j',branch_id:'br-orange-feather-ayps8kep'}});
    },
  }),/base_url/);

  await assert.rejects(()=>verifyProductionAuthBinding({
    key:'n'.repeat(32),
    webhookSource:goodWebhook,
    fetcher:async url=>{
      if(String(url).endsWith('/auth'))return Response.json({base_url:PROD_AUTH_BASE});
      return Response.json({endpoint:{id:'ep-young-hall-ayl0754j',branch_id:'br-dark-sound-ayxhwq1u'}});
    },
  }),/not attached/);

  await assert.rejects(()=>verifyProductionAuthBinding({
    key:'n'.repeat(32),
    webhookSource:"const CONFIGS={production:{authBase:'https://wrong.example'}};",
    fetcher:async url=>{
      if(String(url).endsWith('/auth'))return Response.json({base_url:PROD_AUTH_BASE});
      return Response.json({endpoint:{id:'ep-young-hall-ayl0754j',branch_id:'br-orange-feather-ayps8kep'}});
    },
  }),/pack1-authhook/);
});


const scheduledWorkflow=fs.readFileSync(new URL('../.github/workflows/production-auth-binding-guard.yml',import.meta.url),'utf8');

test('production Auth binding job is read-only and has a reliable production trigger',()=>{
  assert.match(scheduledWorkflow,/workflow_run:\s*\n\s*workflows: \['production launch telemetry and usage alert'\]\s*\n\s*types: \[completed\]/);
  assert.match(scheduledWorkflow,/schedule:\s*\n\s*- cron: '17 \* \* \* \*'/);
  assert.match(scheduledWorkflow,/github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(scheduledWorkflow,/github\.event\.workflow_run\.event != 'pull_request'/);
  assert.match(scheduledWorkflow,/permissions:\s*\n\s*contents: read/);
  assert.match(scheduledWorkflow,/NEON_API_KEY: \$\{\{ secrets\.NEON_API_KEY \}\}/);
  assert.match(scheduledWorkflow,/run: node scripts\/production-auth-binding-guard\.mjs/);
  assert.equal((scheduledWorkflow.match(/\brun:/g)||[]).length,1,'guard has exactly one executable shell command');
  assert.doesNotMatch(scheduledWorkflow,/\b(?:contents|actions|issues|pull-requests): write\b/);
  assert.doesNotMatch(scheduledWorkflow,/slack|webhook|notify|notification|create.issue/i);
});
