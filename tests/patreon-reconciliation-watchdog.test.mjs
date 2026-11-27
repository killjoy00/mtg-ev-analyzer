import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inspectPatreonFreshness,reconcilePatreonWatchdog,PATREON_RECONCILIATION_TRIGGER,PATREON_DISPATCH_KEY,PATREON_ALERT_KEY} from '../worker/patreon-reconciliation-watchdog.mjs';

const env={PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:'github_pat_'+'x'.repeat(32),PACK1_ACCOUNT_DELETE_RESEND_API_KEY:'re_fixture'};
const start=Date.parse('2026-11-27T19:05:00Z');
function harness(counts={linked:'11',due:'11',stale:'0'}) {
  const settings=new Map(),calls=[];
  const query=async(sql,params=[])=>{
    if(sql.includes('FROM provider_accounts'))return {rows:[counts]};
    const [key,a,b]=params;
    if(sql.startsWith('SELECT value'))return {rows:settings.has(key)?[{value:settings.get(key)}]:[]};
    if(sql.startsWith('INSERT INTO settings')) {
      if(settings.has(key))return {rows:[]};
      settings.set(key,a);return {rows:[{value:a}]};
    }
    if(sql.startsWith('UPDATE settings')) {
      if(settings.get(key)!==a)return {rows:[]};
      settings.set(key,b);return {rows:[{value:b}]};
    }
    throw Error('Unexpected query');
  };
  const run=(now=start,options={})=>reconcilePatreonWatchdog({
    trigger:{name:PATREON_RECONCILIATION_TRIGGER,scheduledAt:new Date(now).toISOString()},now,query,env,
    fetcher:async(url,opts)=>{calls.push({url,opts});return new Response(null,{status:url.includes('github.com')?204:200});},
    ...options,
  });
  return {counts,settings,calls,query,run};
}

test('no linked accounts or entirely fresh accounts never dispatch',async()=>{
  for(const linked of ['0','11']){
    const h=harness({linked,due:'0',stale:'0'});
    assert.deepEqual(await h.run(),{linked:Number(linked),due:0,stale:0,action:'not_due',notification:'healthy',ok:true});
    assert.equal(h.calls.length,0);
  }
});

test('overdue/pending state dispatches only the authoritative sync; repeated calls are bounded and actual snapshot controls retry',async()=>{
  const h=harness();
  assert.equal((await h.run()).action,'dispatched');
  assert.equal(h.calls[0].url,'https://api.github.com/repos/killjoy00/mtg-ev-analyzer/actions/workflows/patreon-reconcile.yml/dispatches');
  assert.deepEqual(JSON.parse(h.calls[0].opts.body),{ref:'main',inputs:{mode:'sync'}});
  assert.equal(h.settings.get(PATREON_DISPATCH_KEY),new Date(start).toISOString());
  assert.equal((await h.run(start+15*60000)).action,'cooldown');
  assert.equal((await h.run(start+30*60000)).action,'dispatched');
  h.counts.due='0';
  assert.equal((await h.run(start+60*60000)).action,'not_due');
  assert.equal(h.calls.length,2);
});

test('stale episode alerts once, resets on recovery and distinguishes a dispatch from fresh data',async()=>{
  const h=harness({linked:'11',due:'11',stale:'6'});
  const first=await h.run();
  assert.equal(first.ok,false);
  assert.equal(first.notification,'alerted');
  assert.equal(first.action,'dispatched');
  assert.match(h.settings.get(PATREON_ALERT_KEY),/^sent:/);
  const emails=()=>h.calls.filter(x=>x.url==='https://api.resend.com/emails');
  assert.equal(emails().length,1);
  assert.match(emails()[0].opts.headers['Idempotency-Key'],/^pack1-patreon-stale-/);
  assert.equal((await h.run(start+30*60000)).notification,'deduplicated');
  h.counts.due='0';h.counts.stale='0';
  assert.equal((await h.run(start+60*60000)).ok,true);
  assert.equal(h.settings.get(PATREON_ALERT_KEY),'fresh');
  h.counts.due='2';h.counts.stale='1';
  assert.equal((await h.run(start+180*60000)).notification,'alerted');
  assert.equal(emails().length,2);
  assert.notEqual(emails()[0].opts.headers['Idempotency-Key'],emails()[1].opts.headers['Idempotency-Key']);
});

test('failed dispatch does not suppress the alert; failed notification is retryable with same idempotency key',async()=>{
  const h=harness({linked:'11',due:'11',stale:'6'}),keys=[];
  const fetcher=async(url,opts)=>{
    if(url.includes('github.com'))return new Response(null,{status:503});
    keys.push(opts.headers['Idempotency-Key']);
    return new Response(null,{status:keys.length===1?503:200});
  };
  assert.deepEqual(await h.run(start,{fetcher}),{linked:11,due:11,stale:6,action:'failed',notification:'failed',ok:false});
  assert.equal((await h.run(start+15*60000,{fetcher})).notification,'alerted');
  assert.equal(keys[0],keys[1]);
});

test('concurrent due checks cannot claim two dispatches',async()=>{
  const h=harness();
  const results=await Promise.all([h.run(),h.run()]);
  assert.equal(results.filter(x=>x.action==='dispatched').length,1);
  assert.equal(h.calls.length,1);
});

test('untrusted trigger, delayed invocation, missing credential and invalid counts fail closed',async()=>{
  const h=harness();
  await assert.rejects(h.run(start,{trigger:{name:'wrong',scheduledAt:new Date(start).toISOString()}}),e=>e.status===403);
  assert.equal((await h.run(start,{trigger:{name:PATREON_RECONCILIATION_TRIGGER,scheduledAt:new Date(start-60*60000).toISOString()}})).action,'skipped');
  assert.equal((await h.run(start,{env:{}})).ok,false);
  assert.equal(h.calls.length,0);
  await assert.rejects(inspectPatreonFreshness(harness({linked:'1',due:'0',stale:'1'}).query),/Inconsistent/);
});

test('production route requires the edge-attested named trigger',()=>{
  const source=fs.readFileSync('worker/growth-function.js','utf8');
  assert.match(source,/verifyNeonScheduleTrigger\(request,body,\{names:PATREON_RECONCILIATION_TRIGGER_NAMES\}\)/);
  assert.match(source,/\/internal\/patreon-reconciliation/);
  assert.match(source,/reconcilePatreonWatchdog\(\{trigger,query\}\)/);
});
