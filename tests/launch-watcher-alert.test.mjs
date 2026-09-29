import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAUNCH_WATCHER_ALERT_GRACE_MS,LAUNCH_WATCHER_ALERT_STATE_KEY,
  parseLaunchWatcherAlertState,reconcileLaunchWatcherAlert,
} from '../worker/launch-watcher-alert.mjs';

const ENV={PACK1_ACCOUNT_DELETE_RESEND_API_KEY:'re_fixture'};
const STALE={
  ok:false,reason:'coverage_stale',covered_through:'2026-09-26T10:00:00.000Z',
  age_minutes:40,max_age_minutes:30,
};
const FRESH={
  ok:true,reason:'fresh',covered_through:'2026-09-26T10:45:00.000Z',
  age_minutes:5,max_age_minutes:30,
};

function memoryState(initial=null) {
  let value=initial===null?null:JSON.stringify(initial);
  const query=async(sql,params)=>{
    if(sql.startsWith('SELECT value FROM settings')) {
      assert.equal(params[0],LAUNCH_WATCHER_ALERT_STATE_KEY);
      return {rows:value===null?[]:[{value}]};
    }
    if(sql.startsWith('INSERT INTO settings')) {
      assert.equal(params[0],LAUNCH_WATCHER_ALERT_STATE_KEY);
      value=params[1];
      return {rows:[{value}]};
    }
    throw Error('Unexpected query: '+sql);
  };
  return {query,state:()=>parseLaunchWatcherAlertState(value)};
}

test('routine stale episode stays silent while automatic recovery is in its grace period',async()=>{
  const store=memoryState(),requests=[];
  const fetcher=async(url,options)=>{requests.push({url,options});return new Response('{}',{status:200});};
  const first=await reconcileLaunchWatcherAlert({
    query:store.query,freshness:STALE,now:Date.parse('2026-09-26T10:40:00Z'),env:ENV,fetcher,
  });
  const second=await reconcileLaunchWatcherAlert({
    query:store.query,freshness:{...STALE,age_minutes:50},now:Date.parse('2026-09-26T10:50:00Z'),env:ENV,fetcher,
  });
  const recovered=await reconcileLaunchWatcherAlert({
    query:store.query,freshness:FRESH,now:Date.parse('2026-09-26T11:00:00Z'),env:ENV,fetcher,
  });
  assert.equal(first.action,'grace');
  assert.equal(second.action,'grace');
  assert.equal(recovered.action,'recovered_silently');
  assert.equal(requests.length,0);
  assert.equal(store.state().status,'fresh');
});

test('stale coverage alerts once after the automatic recovery grace period expires',async()=>{
  const store=memoryState(),requests=[];
  const fetcher=async(url,options)=>{requests.push({url,options});return new Response('{}',{status:200});};
  const started=Date.parse('2026-09-26T10:40:00Z');
  const first=await reconcileLaunchWatcherAlert({
    query:store.query,freshness:STALE,now:started,env:ENV,fetcher,
  });
  const before=await reconcileLaunchWatcherAlert({
    query:store.query,freshness:{...STALE,age_minutes:69},
    now:started+LAUNCH_WATCHER_ALERT_GRACE_MS-60_000,env:ENV,fetcher,
  });
  const alerted=await reconcileLaunchWatcherAlert({
    query:store.query,freshness:{...STALE,age_minutes:70},
    now:started+LAUNCH_WATCHER_ALERT_GRACE_MS,env:ENV,fetcher,
  });
  const duplicate=await reconcileLaunchWatcherAlert({
    query:store.query,freshness:{...STALE,age_minutes:80},
    now:started+LAUNCH_WATCHER_ALERT_GRACE_MS+10*60_000,env:ENV,fetcher,
  });
  assert.equal(first.action,'grace');
  assert.equal(before.action,'grace');
  assert.equal(alerted.action,'alerted');
  assert.equal(duplicate.action,'deduplicated');
  assert.equal(requests.length,1);
  assert.equal(JSON.parse(requests[0].options.body).subject,'[Pack One] Launch coverage stale');
  assert.match(requests[0].options.headers['Idempotency-Key'],/^pack1-launch-stale-[a-f0-9]{24}$/);
  assert.equal(store.state().status,'stale');
});

test('recovery dispatcher failure bypasses grace and alerts immediately',async()=>{
  const store=memoryState(),requests=[];
  const result=await reconcileLaunchWatcherAlert({
    query:store.query,freshness:STALE,now:Date.parse('2026-09-26T10:40:00Z'),env:ENV,urgent:true,
    fetcher:async(url,options)=>{requests.push(JSON.parse(options.body));return new Response('{}',{status:200});},
  });
  assert.equal(result.action,'alerted');
  assert.equal(requests.length,1);
  assert.equal(requests[0].subject,'[Pack One] Launch coverage stale');
});

test('service-principal email cannot redirect the established operator destination',async()=>{
  const store=memoryState(),requests=[];
  await reconcileLaunchWatcherAlert({
    query:store.query,freshness:STALE,now:Date.parse('2026-09-26T10:40:00Z'),urgent:true,
    env:{PACK1_ACCOUNT_DELETE_RESEND_API_KEY:'re_fixture',PACK1_DELETION_ADMIN_EMAIL:'service@example.test'},
    fetcher:async(url,options)=>{requests.push(JSON.parse(options.body));return new Response('{}',{status:200});},
  });
  assert.deepEqual(requests[0].to,['admin@packone.pro']);
});

test('failed stale delivery stays pending and retries with the same idempotency key',async()=>{
  const store=memoryState(),keys=[];let attempt=0;
  const fetcher=async(url,options)=>{
    keys.push(options.headers['Idempotency-Key']);
    attempt++;
    return new Response('{}',{status:attempt===1?503:200});
  };
  await assert.rejects(()=>reconcileLaunchWatcherAlert({
    query:store.query,freshness:STALE,now:Date.parse('2026-09-26T10:40:00Z'),env:ENV,fetcher,urgent:true,
  }),/operator email failed/);
  assert.equal(store.state().status,'stale_pending');
  const retry=await reconcileLaunchWatcherAlert({
    query:store.query,freshness:{...STALE,age_minutes:50},now:Date.parse('2026-09-26T10:50:00Z'),env:ENV,fetcher,
  });
  assert.equal(retry.action,'alerted');
  assert.equal(store.state().status,'stale');
  assert.equal(keys.length,2);
  assert.equal(keys[0],keys[1]);
});

test('recovery after an escalated stale alert is silent and returns to healthy dedupe state',async()=>{
  const store=memoryState(),messages=[];
  const fetcher=async(url,options)=>{
    messages.push({headers:options.headers,body:JSON.parse(options.body)});
    return new Response('{}',{status:200});
  };
  await reconcileLaunchWatcherAlert({
    query:store.query,freshness:STALE,now:Date.parse('2026-09-26T10:40:00Z'),env:ENV,fetcher,urgent:true,
  });
  const recovered=await reconcileLaunchWatcherAlert({
    query:store.query,freshness:FRESH,now:Date.parse('2026-09-26T10:50:00Z'),env:ENV,fetcher,
  });
  const healthy=await reconcileLaunchWatcherAlert({
    query:store.query,freshness:{...FRESH,age_minutes:10},now:Date.parse('2026-09-26T11:00:00Z'),env:ENV,fetcher,
  });
  assert.equal(recovered.action,'recovered_silently');
  assert.equal(healthy.action,'healthy');
  assert.equal(messages.length,1);
  assert.equal(messages[0].body.subject,'[Pack One] Launch coverage stale');
  assert.equal(store.state().status,'fresh');
});
