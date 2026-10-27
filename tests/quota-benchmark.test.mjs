import test from 'node:test';
import assert from 'node:assert/strict';
import probe from '../edge/quota-benchmark.mjs';
import {compareQuota,probeName,summarizeSamples} from '../scripts/quota-benchmark.mjs';

const key='a'.repeat(64);
const env={BENCHMARK_KEY:key,EXPIRES_AT:String(Date.now()+60000)};
const req=(path='/request',body={mode:'candidate',cohort:'b'.repeat(32)},token=key)=>new Request('https://fixture'+path,{method:'POST',
  headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
test('synthetic Worker refuses missing keys, expired runs and invalid requests before allocating objects',async()=>{
  for(const [request,settings,status] of [[req(),{},403],[req(),{...env,EXPIRES_AT:'0'},403],[req('/request',{},'wrong'),env,403],
    [req('/health'),env,400],[req('/request',{mode:'production',cohort:'b'.repeat(32)}),env,400],
    [req('/request',{mode:'baseline',cohort:'b'.repeat(32),secret:'injected'}),env,400]])
    assert.equal((await probe.fetch(request,settings)).status,status);
});
test('synthetic Worker can reach only its requested isolated quota namespace',async()=>{
  let calls=0;
  const namespace={idFromName:id=>id,get:(id,options)=>{assert.equal(id,'b'.repeat(32));assert.equal(options.locationHint,'enam');
    return {fetch:async request=>{calls++;assert.equal(request.url,'https://quota/request');return new Response(null,{status:204});}};}};
  assert.equal((await probe.fetch(req(),{...env,CANDIDATE_QUOTA:namespace})).status,204);assert.equal(calls,1);
});
test('probe resource names reject production identities and malformed cleanup inputs',()=>{
  assert.equal(probeName('12345','1','b'.repeat(10)),'pack1-quota-probe-12345-1-'+ 'b'.repeat(10));
  for(const args of [['production','1','a'.repeat(10)],['1','1','../../other'],['1','1000','a'.repeat(10)]])assert.throws(()=>probeName(...args));
});
test('bounded benchmark verifies reduction and both exact caps without provider access',async()=>{
  const states=new Map();let calls=0;
  const fetcher=async(url,options)=>{
    calls++;const {mode,cohort}=JSON.parse(options.body),kind=new URL(url).pathname;
    const id=mode+cohort+kind,row=states.get(id)||{used:0,writes:0};
    const cap=kind==='/request'?600:120,status=row.used>=cap?429:204;
    if(status===204){if(mode==='baseline'||row.used%8===0)row.writes++;row.used++;}states.set(id,row);
    return new Response(null,{status,headers:{'x-quota-counter-write-total':String(row.writes),'x-pack1-quota-handler-ms':mode==='baseline'?'12':'2'}});
  };
  const report=await compareQuota({url:'https://synthetic.invalid',key,fetcher});
  assert.equal(report.exact_caps_passed,true);assert.equal(report.baseline.counter_write_decisions,195);
  assert.equal(report.candidate.counter_write_decisions,27);assert.equal(report.latency_improved,true);
  assert.ok(calls<2000);assert.doesNotMatch(JSON.stringify(report),/aaaaaaaa|bbbbbbbb|authorization|workers\.dev/);
  assert.deepEqual(summarizeSamples([1,2,1001]),{samples:3,p50_ms:2,p95_ms:1001,p99_ms:1001,gt_1000ms:1});
});

test('cleanup refuses mismatched ownership before deletion and reconciles an ambiguous delete by readback',async()=>{
  const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');const path=await import('node:path');
  const {cleanupProbe}=await import('../scripts/quota-benchmark.mjs');
  const directory=mkdtempSync(path.join(tmpdir(),'quota-cleanup-'));
  const settings={GITHUB_REPOSITORY:'killjoy00/mtg-ev-analyzer',GITHUB_REF:'refs/heads/main',GITHUB_RUN_ID:'12345',GITHUB_RUN_ATTEMPT:'1',
    RUNNER_TEMP:directory,EDGE_TOOLS_DIR:directory,CLOUDFLARE_EDGE_TOKEN:'synthetic-token'};
  const nonce='b'.repeat(10),owner='12345-1-'+nonce,name=probeName('12345','1',nonce);
  writeFileSync(path.join(directory,'quota-benchmark-receipt.json'),JSON.stringify({nonce,owner,name,account:'c'.repeat(32)}));
  try {
    let deletes=0;
    await assert.rejects(cleanupProbe({env:settings,fetcher:async(url,options)=>{
      if(options.method==='DELETE')deletes++;
      return Response.json({success:true,result:{bindings:[{name:'PROBE_OWNER',text:'different-run'}]}});
    }}),/probe_ownership_unverified/);assert.equal(deletes,0);
    let gone=false;
    await cleanupProbe({env:settings,fetcher:async(url,options)=>{
      if(options.method==='DELETE'){deletes++;gone=true;throw Error('lost acknowledgement');}
      if(gone)return new Response(null,{status:404});
      return Response.json({success:true,result:{bindings:[{name:'PROBE_OWNER',text:owner}]}});
    }});assert.equal(deletes,1);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('missing timing headers and provider failures cannot masquerade as fast successful quota calls',async()=>{
  await assert.rejects(compareQuota({url:'https://synthetic.invalid',key,fetcher:async()=>new Response(null,{status:204})}),/missing_probe_evidence/);
  await assert.rejects(compareQuota({url:'https://synthetic.invalid',key,fetcher:async()=>Response.json({
    error:'synthetic_quota_exception',reason:'storage_quota',message:'private provider details',
  },{status:503})}),/probe_baseline_http_503_storage_quota/);
  await assert.rejects(compareQuota({url:'https://synthetic.invalid',key,fetcher:async()=>new Response('private provider details',{status:500})}),/probe_baseline_http_500_unclassified_response/);
});

test('Worker exception diagnostics expose only bounded failure categories',async()=>{
  const namespace={idFromName:x=>x,get:()=>({fetch:async()=>{throw Error('Daily storage quota exceeded; private provider reference');}})};
  const r=await probe.fetch(req(),{...env,CANDIDATE_QUOTA:namespace});
  assert.equal(r.status,503);const body=await r.json();assert.equal(body.reason,'storage_quota');
  assert.doesNotMatch(JSON.stringify(body),/private provider reference/);
});
