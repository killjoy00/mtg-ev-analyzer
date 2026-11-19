import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LAUNCH_WATCHER_CADENCE_STATE_KEY,
  reconcileLaunchWatcherCadence,
} from '../worker/launch-watcher-dispatch.mjs';

const ENV={PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:'github_pat_fixture_abcdefghijklmnopqrstuvwxyz'};
const fresh=age=>({ok:true,reason:'fresh',covered_through:'2026-10-01T05:00:00.000Z',age_minutes:age,max_age_minutes:30});
const STALE={ok:false,reason:'coverage_stale',covered_through:'2026-10-01T05:00:00.000Z',age_minutes:34,max_age_minutes:30};
const T0=Date.parse('2026-10-01T05:24:00Z');

function memoryState({contend=false}={}) {
  let value=null;
  const query=async(sql,params)=>{
    assert.equal(params[0],LAUNCH_WATCHER_CADENCE_STATE_KEY);
    if(sql.startsWith('SELECT value FROM settings'))return {rows:value===null?[]:[{value}]};
    if(contend)return {rows:[]};
    if(sql.startsWith('INSERT INTO settings')){if(value!==null)return {rows:[]};value=params[1];return {rows:[{value}]};}
    if(sql.startsWith('UPDATE settings SET value=')){if(value!==params[1])return {rows:[]};value=params[2];return {rows:[{value}]};}
    throw Error('Unexpected query: '+sql);
  };
  return {query,value:()=>value};
}

function recorder(status=204) {
  const requests=[];
  const fetcher=async(url,init)=>{requests.push({url:String(url),init});return new Response(null,{status});};
  return {requests,fetcher};
}

test('fresh coverage is advanced ahead of time once it is due, at most once per interval',async()=>{
  const store=memoryState(),{requests,fetcher}=recorder();
  assert.deepEqual(await reconcileLaunchWatcherCadence({query:store.query,freshness:fresh(14),now:T0,env:ENV,fetcher}),{action:'not_due'});
  assert.equal(requests.length,0);

  assert.deepEqual(await reconcileLaunchWatcherCadence({query:store.query,freshness:fresh(24),now:T0,env:ENV,fetcher}),{action:'dispatched'});
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'https://api.github.com/repos/killjoy00/mtg-ev-analyzer/actions/workflows/launch-alert.yml/dispatches');
  assert.equal(requests[0].init.method,'POST');
  assert.deepEqual(JSON.parse(requests[0].init.body),{ref:'main',inputs:{continuation_depth:'0'}});
  assert.equal(JSON.parse(store.value()).last_dispatch_at,new Date(T0).toISOString());

  assert.deepEqual(await reconcileLaunchWatcherCadence({query:store.query,freshness:fresh(29),now:T0+10*60*1000,env:ENV,fetcher}),{action:'cooldown'});
  assert.equal(requests.length,1);
  assert.deepEqual(await reconcileLaunchWatcherCadence({query:store.query,freshness:fresh(24),now:T0+15*60*1000,env:ENV,fetcher}),{action:'dispatched'});
  assert.equal(requests.length,2);
});

test('stale coverage, missing credentials and contention never dispatch from the cadence path',async()=>{
  const {requests,fetcher}=recorder();
  assert.deepEqual(await reconcileLaunchWatcherCadence({query:memoryState().query,freshness:STALE,now:T0,env:ENV,fetcher}),{action:'not_fresh'});
  assert.deepEqual(await reconcileLaunchWatcherCadence({query:memoryState().query,freshness:fresh(24),now:T0,env:{},fetcher}),{action:'unconfigured'});
  assert.deepEqual(await reconcileLaunchWatcherCadence({query:memoryState({contend:true}).query,freshness:fresh(24),now:T0,env:ENV,fetcher}),{action:'contended'});
  assert.equal(requests.length,0);
});

test('a rejected cadence dispatch is reported and still starts the cooldown',async()=>{
  const store=memoryState(),{requests,fetcher}=recorder(500);
  assert.deepEqual(await reconcileLaunchWatcherCadence({query:store.query,freshness:fresh(24),now:T0,env:ENV,fetcher}),{action:'failed',reason:'dispatch_http_500'});
  assert.deepEqual(await reconcileLaunchWatcherCadence({query:store.query,freshness:fresh(26),now:T0+5*60*1000,env:ENV,fetcher}),{action:'cooldown'});
  assert.equal(requests.length,1);
});

test('the maintenance signal runs the cadence only on fresh coverage and never changes its response',()=>{
  const source=fs.readFileSync(new URL('../worker/growth-function.js',import.meta.url),'utf8');
  const start=source.indexOf('async function launchWatcherSignal(');
  const signal=source.slice(start,source.indexOf('\nasync function handleDeletionMaintenance(',start));
  const freshBlock=signal.slice(signal.indexOf('if(freshness.ok) {'),signal.indexOf("event:'launch_watcher_stale'"));
  assert.match(freshBlock,/cadence=await reconcileLaunchWatcherCadence\(\{query,freshness,now:scheduledAt\}\);/);
  assert.match(freshBlock,/event:'launch_watcher_cadence_dispatch'[\s\S]*?\n    return response;\n  \}/);
  assert.equal(signal.split('reconcileLaunchWatcherCadence(').length-1,1,'cadence is called from exactly one place');
});
