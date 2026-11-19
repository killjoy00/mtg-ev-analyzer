import test from 'node:test';
import assert from 'node:assert/strict';
import probe from '../edge/quota-benchmark.mjs';
import {reproduceQuotaTimeouts,TIMEOUT_PLAN} from '../scripts/quota-timeout-repro.mjs';
const key='a'.repeat(64),env={BENCHMARK_KEY:key,EXPIRES_AT:String(Date.now()+60000)};
const req=(route,body)=>new Request('https://test.invalid'+route,{method:'POST',
  headers:{authorization:'Bearer '+key,'content-type':'application/json'},
  body:JSON.stringify(body)});
test('synthetic-only timeout routes reject unknown cases and private data before touching a namespace',async()=>{
  const bad=[
    req('/timeout-probe',{scenario:'production',cohort:'b'.repeat(32)}),
    req('/timeout-probe',{scenario:'ack_timeout',cohort:'b'.repeat(32),service:'prod'}),
    req('/timeout-inspect',{scenario:'normal',cohort:'b'.repeat(32)}),
    req('/timeout-probe',{scenario:'normal',cohort:'not-a-hex-id'}),
  ];
  for(const r of bad)assert.equal((await probe.fetch(r,env)).status,400);
  const without=new Request('https://test.invalid/timeout-probe',{method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({scenario:'normal',cohort:'b'.repeat(32)})});
  assert.equal((await probe.fetch(without,env)).status,403);
});
test('synthetic normal call uses real quota caller and read-only inspection',async()=>{
  let charges=0,reads=0;
  const namespace={idFromName:id=>id,get:()=>({fetch:async request=>{
    if(new URL(request.url).pathname==='/inspect'){reads++;return Response.json({request_count:charges});}
    assert.equal(new URL(request.url).pathname,'/request');
    charges++;return new Response(null,{status:204,headers:{'x-pack1-quota-handler-ms':'12'}});
  }})};
  const cohort='b'.repeat(32);
  const result=await probe.fetch(req('/timeout-probe',{scenario:'normal',cohort}),{...env,BASELINE_QUOTA:namespace});
  assert.equal(result.status,200);
  const observation=await result.json();
  assert.equal(observation.outcome,'success');
  assert.equal(observation.attempts,1);
  assert.equal(observation.handler_timing_observed,true);
  const inspection=await probe.fetch(req('/timeout-inspect',{cohort}),{...env,BASELINE_QUOTA:namespace});
  assert.deepEqual(await inspection.json(),{request_count:1});
  assert.equal(charges,1);assert.equal(reads,1);
});
test('bounded collector validates debit invariants and never publishes private cohorts',async()=>{
  const seen=new Map();let count=0;
  const fetcher=async(url,options)=>{
    count++;const body=JSON.parse(options.body),path=new URL(url).pathname;
    assert.match(body.cohort,/^[a-f0-9]{32}$/);
    if(path==='/timeout-inspect')return Response.json({request_count:seen.get(body.cohort)});
    assert.equal(path,'/timeout-probe');assert(TIMEOUT_PLAN.includes(body.scenario));
    const data={scenario:body.scenario,outcome:body.scenario==='normal'?'success':
      body.scenario==='client_abort'?'abort':'timeout',
      attempts:1,elapsed_ms:body.scenario==='normal'?15:5000,
      handler_timing_observed:body.scenario==='normal'};
    seen.set(body.cohort,['normal','ack_timeout'].includes(body.scenario)?1:0);
    return Response.json(data);
  };
  const report=await reproduceQuotaTimeouts({url:'https://synthetic.invalid',key,fetcher,
    wait:async()=>{},repeats:1});
  assert.equal(report.requests,10);
  assert.equal(count,10);
  assert.equal(report.scenario_results.length,5);
  assert.equal(report.production_ready,false);
  assert(!('cohort' in report.scenario_results[0]));
  assert.doesNotMatch(JSON.stringify(report),/aaaaaaaa|Bearer|cohort|synthetic\.invalid|workers\.dev/);
});
test('quota ambiguity cannot be passed off as an uncharged timeout or a safe retry',async()=>{
  const fetcher=async(url,options)=>{
    const body=JSON.parse(options.body);
    if(new URL(url).pathname==='/timeout-inspect')
      return Response.json({request_count:body.cohort==='z'?0:2});
    return Response.json({scenario:body.scenario,
      outcome:body.scenario==='normal'?'success':'timeout',attempts:1,
      elapsed_ms:200,handler_timing_observed:body.scenario==='normal'});
  };
  await assert.rejects(reproduceQuotaTimeouts({url:'https://synthetic.invalid',key,
    fetcher,wait:async()=>{},repeats:1}),/synthetic_counter_invalid/);
});
