import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAUNCH_WATCHER_ALERT_STATE_KEY,parseLaunchWatcherAlertState,reconcileLaunchWatcherAlert,
} from '../worker/launch-watcher-alert.mjs';

const ENV={
  PACK1_ACCOUNT_DELETE_RESEND_API_KEY:'re_fixture',
  PACK1_LAUNCH_ALERT_EMAIL:'ops@example.test',
};
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

test('independent stale operator alert is sent once per stale episode',async()=>{
  const store=memoryState(),requests=[];
  const fetcher=async(url,options)=>{requests.push({url,options});return new Response('{}',{status:200});};
  const first=await reconcileLaunchWatcherAlert({
    query:store.query,freshness:STALE,now:Date.parse('2026-09-26T10:40:00Z'),env:ENV,fetcher,
  });
  const second=await reconcileLaunchWatcherAlert({
    query:store.query,freshness:{...STALE,age_minutes:50},now:Date.parse('2026-09-26T10:50:00Z'),env:ENV,fetcher,
  });
  assert.equal(first.action,'alerted');
  assert.equal(second.action,'deduplicated');
  assert.equal(requests.length,1);
  assert.equal(store.state().status,'stale');
  assert.match(requests[0].options.headers['Idempotency-Key'],/^pack1-launch-stale-[a-f0-9]{24}$/);
  assert.deepEqual(JSON.parse(requests[0].options.body).to,['ops@example.test']);
});

test('service-principal email is not accepted as an implicit operator destination',async()=>{
  const store=memoryState();
  await assert.rejects(()=>reconcileLaunchWatcherAlert({
    query:store.query,freshness:STALE,now:Date.parse('2026-09-26T10:40:00Z'),
    env:{PACK1_ACCOUNT_DELETE_RESEND_API_KEY:'re_fixture',PACK1_DELETION_ADMIN_EMAIL:'service@example.test'},
    fetcher:async()=>new Response('{}',{status:200}),
  }),/operator email destination is unavailable/);
});

test('failed stale delivery stays pending and retries with the same idempotency key',async()=>{
  const store=memoryState(),keys=[];let attempt=0;
  const fetcher=async(url,options)=>{
    keys.push(options.headers['Idempotency-Key']);
    attempt++;
    return new Response('{}',{status:attempt===1?503:200});
  };
  await assert.rejects(()=>reconcileLaunchWatcherAlert({
    query:store.query,freshness:STALE,now:Date.parse('2026-09-26T10:40:00Z'),env:ENV,fetcher,
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

test('coverage recovery sends one recovery alert and returns to healthy dedupe state',async()=>{
  const store=memoryState(),messages=[];
  const fetcher=async(url,options)=>{
    messages.push({headers:options.headers,body:JSON.parse(options.body)});
    return new Response('{}',{status:200});
  };
  await reconcileLaunchWatcherAlert({
    query:store.query,freshness:STALE,now:Date.parse('2026-09-26T10:40:00Z'),env:ENV,fetcher,
  });
  const recovered=await reconcileLaunchWatcherAlert({
    query:store.query,freshness:FRESH,now:Date.parse('2026-09-26T10:50:00Z'),env:ENV,fetcher,
  });
  const healthy=await reconcileLaunchWatcherAlert({
    query:store.query,freshness:{...FRESH,age_minutes:10},now:Date.parse('2026-09-26T11:00:00Z'),env:ENV,fetcher,
  });
  assert.equal(recovered.action,'recovered');
  assert.equal(healthy.action,'healthy');
  assert.equal(messages.length,2);
  assert.equal(messages[1].body.subject,'[Pack One] Launch coverage recovered');
  assert.match(messages[1].headers['Idempotency-Key'],/^pack1-launch-recovered-[a-f0-9]{24}$/);
  assert.equal(store.state().status,'fresh');
});
