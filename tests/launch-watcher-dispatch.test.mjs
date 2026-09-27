import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LAUNCH_WATCHER_DISPATCH_MAX_ATTEMPTS,
  LAUNCH_WATCHER_DISPATCH_STATE_KEY,
  parseLaunchWatcherDispatchState,
  reconcileLaunchWatcherDispatch,
} from '../worker/launch-watcher-dispatch.mjs';

const ENV={PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:'github_pat_fixture_abcdefghijklmnopqrstuvwxyz'};
const STALE={
  ok:false,reason:'coverage_stale',covered_through:'2026-09-27T13:00:00.000Z',
  age_minutes:40,max_age_minutes:30,
};
const FRESH={ok:true,reason:'fresh',covered_through:'2026-09-27T13:45:00.000Z',age_minutes:5,max_age_minutes:30};

function memoryState(initial=null) {
  let value=initial===null?null:JSON.stringify(initial);
  const query=async(sql,params)=>{
    if(sql.startsWith('SELECT value FROM settings')) {
      assert.equal(params[0],LAUNCH_WATCHER_DISPATCH_STATE_KEY);
      return {rows:value===null?[]:[{value}]};
    }
    if(sql.startsWith('INSERT INTO settings')) {
      assert.equal(params[0],LAUNCH_WATCHER_DISPATCH_STATE_KEY);
      if(value!==null)return {rows:[]};
      value=params[1];
      return {rows:[{value}]};
    }
    if(sql.startsWith('UPDATE settings SET value=')) {
      assert.equal(params[0],LAUNCH_WATCHER_DISPATCH_STATE_KEY);
      if(value!==params[1])return {rows:[]};
      value=params[2];
      return {rows:[{value}]};
    }
    throw Error('Unexpected query: '+sql);
  };
  return {query,state:()=>parseLaunchWatcherDispatchState(value)};
}

test('missed initial invocation dispatches one authenticated root launch workflow',async()=>{
  const store=memoryState(),requests=[];
  const result=await reconcileLaunchWatcherDispatch({
    query:store.query,freshness:STALE,now:Date.parse('2026-09-27T13:40:00Z'),env:ENV,
    fetcher:async(url,options)=>{requests.push({url,options});return new Response(null,{status:204});},
  });
  assert.equal(result.action,'dispatched');
  assert.equal(result.attempts,1);
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'https://api.github.com/repos/killjoy00/mtg-ev-analyzer/actions/workflows/launch-alert.yml/dispatches');
  assert.equal(requests[0].options.headers.authorization,'Bearer '+ENV.PACK1_LAUNCH_WATCHER_GITHUB_TOKEN);
  assert.deepEqual(JSON.parse(requests[0].options.body),{ref:'main',inputs:{continuation_depth:'0'}});
  assert.equal(store.state().status,'dispatched');
});

test('multiple delayed scheduler ticks are bounded and progress suppresses duplicate roots',async()=>{
  const store=memoryState();let calls=0;
  const fetcher=async()=>{calls++;return new Response(null,{status:204});};
  await reconcileLaunchWatcherDispatch({
    query:store.query,freshness:STALE,now:Date.parse('2026-09-27T13:40:00Z'),env:ENV,fetcher,
  });
  const ten=await reconcileLaunchWatcherDispatch({
    query:store.query,freshness:{...STALE,age_minutes:50},now:Date.parse('2026-09-27T13:50:00Z'),env:ENV,fetcher,
  });
  const progress=await reconcileLaunchWatcherDispatch({
    query:store.query,
    freshness:{...STALE,covered_through:'2026-09-27T13:20:00.000Z',age_minutes:40},
    now:Date.parse('2026-09-27T14:00:00Z'),env:ENV,fetcher,
  });
  const afterProgress=await reconcileLaunchWatcherDispatch({
    query:store.query,
    freshness:{...STALE,covered_through:'2026-09-27T13:20:00.000Z',age_minutes:50},
    now:Date.parse('2026-09-27T14:10:00Z'),env:ENV,fetcher,
  });
  assert.equal(ten.action,'cooldown');
  assert.equal(progress.action,'progress');
  assert.equal(afterProgress.action,'cooldown');
  assert.equal(calls,1);
});

test('concurrent watchdog invocations claim at most one dispatch',async()=>{
  const store=memoryState();let calls=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const fetcher=async()=>{calls++;await gate;return new Response(null,{status:204});};
  const first=reconcileLaunchWatcherDispatch({
    query:store.query,freshness:STALE,now:Date.parse('2026-09-27T13:40:00Z'),env:ENV,fetcher,
  });
  await new Promise(resolve=>setTimeout(resolve,0));
  const second=await reconcileLaunchWatcherDispatch({
    query:store.query,freshness:STALE,now:Date.parse('2026-09-27T13:40:01Z'),env:ENV,fetcher,
  });
  release();
  const primary=await first;
  assert.equal(primary.action,'dispatched');
  assert.equal(second.action,'in_flight');
  assert.equal(calls,1);
});

test('dispatch failure retries on the next independent interval and can recover',async()=>{
  const store=memoryState();let calls=0;
  const fetcher=async()=>{
    calls++;
    return calls===1?new Response('{}',{status:503}):new Response(null,{status:204});
  };
  const failed=await reconcileLaunchWatcherDispatch({
    query:store.query,freshness:STALE,now:Date.parse('2026-09-27T13:40:00Z'),env:ENV,fetcher,
  });
  const retry=await reconcileLaunchWatcherDispatch({
    query:store.query,freshness:{...STALE,age_minutes:50},now:Date.parse('2026-09-27T13:50:00Z'),env:ENV,fetcher,
  });
  const recovered=await reconcileLaunchWatcherDispatch({
    query:store.query,freshness:FRESH,now:Date.parse('2026-09-27T14:00:00Z'),env:ENV,fetcher,
  });
  assert.equal(failed.action,'failed');
  assert.equal(failed.reason,'dispatch_http_503');
  assert.equal(retry.action,'dispatched');
  assert.equal(retry.attempts,2);
  assert.equal(recovered.action,'recovered');
  assert.equal(store.state().status,'fresh');
  assert.equal(calls,2);
});

test('accepted dispatch with no coverage progress retries only after the no-progress guard',async()=>{
  const store=memoryState();let calls=0;
  const fetcher=async()=>{calls++;return new Response(null,{status:204});};
  await reconcileLaunchWatcherDispatch({
    query:store.query,freshness:STALE,now:Date.parse('2026-09-27T13:40:00Z'),env:ENV,fetcher,
  });
  const early=await reconcileLaunchWatcherDispatch({
    query:store.query,freshness:STALE,now:Date.parse('2026-09-27T13:50:00Z'),env:ENV,fetcher,
  });
  const retry=await reconcileLaunchWatcherDispatch({
    query:store.query,freshness:STALE,now:Date.parse('2026-09-27T14:00:00Z'),env:ENV,fetcher,
  });
  assert.equal(early.action,'cooldown');
  assert.equal(retry.action,'dispatched');
  assert.equal(calls,2);
});

test('independent recovery is capped at three roots per stale episode',async()=>{
  const store=memoryState();let calls=0;
  const fetcher=async()=>{calls++;return new Response('{}',{status:503});};
  let result;
  for(let i=0;i<LAUNCH_WATCHER_DISPATCH_MAX_ATTEMPTS;i++) {
    result=await reconcileLaunchWatcherDispatch({
      query:store.query,freshness:STALE,now:Date.parse('2026-09-27T13:40:00Z')+i*10*60*1000,env:ENV,fetcher,
    });
    assert.equal(result.action,'failed');
  }
  const exhausted=await reconcileLaunchWatcherDispatch({
    query:store.query,freshness:STALE,now:Date.parse('2026-09-27T14:10:00Z'),env:ENV,fetcher,
  });
  assert.equal(exhausted.action,'exhausted');
  assert.equal(exhausted.attempts,LAUNCH_WATCHER_DISPATCH_MAX_ATTEMPTS);
  assert.equal(calls,LAUNCH_WATCHER_DISPATCH_MAX_ATTEMPTS);
});


test('release control keeps the watchdog credential production-only and verifies both environments',()=>{
  const flow=fs.readFileSync('.github/workflows/secure-auth-release.yml','utf8');
  const devStart=flow.indexOf('Deploy exact revision to development');
  const prodStart=flow.indexOf('Deploy the development-tested revision to production');
  const prodEnd=flow.indexOf('Deploy dedicated production recovery webhook Worker',prodStart);
  assert.ok(devStart>=0&&prodStart>devStart&&prodEnd>prodStart);
  const dev=flow.slice(devStart,prodStart);
  const prod=flow.slice(prodStart,prodEnd);
  assert.doesNotMatch(dev,/PACK1_LAUNCH_WATCHER_GITHUB_TOKEN/);
  assert.match(prod,/secrets\.PACK1_LAUNCH_WATCHER_GITHUB_TOKEN/);
  assert.match(prod,/--env "PACK1_LAUNCH_WATCHER_GITHUB_TOKEN=\$PACK1_LAUNCH_WATCHER_GITHUB_TOKEN"/);
  assert.match(flow,/fine-grained GitHub token for this repository with Actions write access/);
  assert.match(flow,/--expect-launch-recovery=false/);
  assert.match(flow,/--expect-launch-recovery=true/);
});
