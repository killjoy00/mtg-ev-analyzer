import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PROD_AUTH_BASE,
  endpointIdForAuthBase,
  verifyProductionAuthBinding,
  webhookProductionAuthBase,
} from '../scripts/production-auth-binding-guard.mjs';
import {AUTH_WEBHOOK_CONFIGS} from '../scripts/auth-webhook-control.mjs';
import {QA_AUTH_BASE as HARDENING_QA_AUTH_BASE} from '../scripts/auth-localhost-hardening.mjs';

test('production Auth binding guard pins the serving endpoint and webhook base',async()=>{
  assert.equal(endpointIdForAuthBase(PROD_AUTH_BASE),'ep-young-hall-ayl0754j');
  assert.equal(webhookProductionAuthBase(),PROD_AUTH_BASE);
  assert.equal(AUTH_WEBHOOK_CONFIGS.production.authBase,PROD_AUTH_BASE);

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
    webhookConfigs:{production:{authBase:PROD_AUTH_BASE}},
  });
  assert.equal(result.endpoint_id,'ep-young-hall-ayl0754j');
  assert.equal(calls.length,2);
  assert.ok(calls.every(call=>call.method==='GET'));
});

test('production Auth binding guard fails closed on control-plane drift',async()=>{
  const goodWebhook={production:{authBase:PROD_AUTH_BASE}};
  await assert.rejects(()=>verifyProductionAuthBinding({
    key:'n'.repeat(32),
    webhookConfigs:goodWebhook,
    fetcher:async url=>{
      if(String(url).endsWith('/auth'))return Response.json({base_url:'https://ep-wrong.neonauth.example/pack1/auth'});
      return Response.json({endpoint:{id:'ep-young-hall-ayl0754j',branch_id:'br-orange-feather-ayps8kep'}});
    },
  }),/base_url/);

  await assert.rejects(()=>verifyProductionAuthBinding({
    key:'n'.repeat(32),
    webhookConfigs:goodWebhook,
    fetcher:async url=>{
      if(String(url).endsWith('/auth'))return Response.json({base_url:PROD_AUTH_BASE});
      return Response.json({endpoint:{id:'ep-young-hall-ayl0754j',branch_id:'br-dark-sound-ayxhwq1u'}});
    },
  }),/not attached/);

  await assert.rejects(()=>verifyProductionAuthBinding({
    key:'n'.repeat(32),
    webhookConfigs:{production:{authBase:'https://wrong.example'}},
    fetcher:async url=>{
      if(String(url).endsWith('/auth'))return Response.json({base_url:PROD_AUTH_BASE});
      return Response.json({endpoint:{id:'ep-young-hall-ayl0754j',branch_id:'br-orange-feather-ayps8kep'}});
    },
  }),/pack1-authhook/);
});


test('production Auth host has one importable source of truth',()=>{
  const importable=[
    '../scripts/auth-localhost-hardening.mjs',
    '../scripts/auth-webhook-production-smoke.mjs',
    '../scripts/auth-webhook-control.mjs',
    '../tests/edge-production-live-smoke.mjs',
    '../tests/first-party-auth.test.mjs',
    '../tests/first-party-config.test.mjs',
  ];
  const prodLiteral=/https:\/\/ep-[a-z0-9-]+\.neonauth\.[^'"\s]+\/pack1\/auth/g;
  for(const relative of importable){
    const source=fs.readFileSync(new URL(relative,import.meta.url),'utf8');
    const literals=[...source.matchAll(prodLiteral)].map(match=>match[0]);
    if(relative.includes('auth-localhost-hardening'))assert.deepEqual(literals,[HARDENING_QA_AUTH_BASE]);
    else assert.deepEqual(literals,[],relative+' must import the production Auth base');
    assert.match(source,/account-config\.mjs/,relative+' must import account-config');
  }

  const accountConfig=fs.readFileSync(new URL('../worker/account-config.mjs',import.meta.url),'utf8');
  assert.deepEqual([...accountConfig.matchAll(prodLiteral)].map(match=>match[0]),[PROD_AUTH_BASE]);

  const classicConfig=fs.readFileSync(new URL('../leaderboard-config.js',import.meta.url),'utf8');
  assert.deepEqual([...classicConfig.matchAll(prodLiteral)].map(match=>match[0]),[PROD_AUTH_BASE]);
});


const scheduledWorkflow=fs.readFileSync(new URL('../.github/workflows/production-auth-binding-guard.yml',import.meta.url),'utf8');

test('hourly production Auth binding job is read-only',()=>{
  assert.match(scheduledWorkflow,/schedule:\s*\n\s*- cron: '17 \* \* \* \*'/);
  assert.match(scheduledWorkflow,/permissions:\s*\n\s*contents: read/);
  assert.match(scheduledWorkflow,/NEON_API_KEY: \$\{\{ secrets\.NEON_API_KEY \}\}/);
  assert.match(scheduledWorkflow,/run: node scripts\/production-auth-binding-guard\.mjs/);
  assert.equal((scheduledWorkflow.match(/\brun:/g)||[]).length,1,'scheduled guard has exactly one executable shell command');
  assert.doesNotMatch(scheduledWorkflow,/\b(?:contents|actions|issues|pull-requests): write\b/);
  assert.doesNotMatch(scheduledWorkflow,/slack|webhook|notify|notification|create.issue/i);
});
