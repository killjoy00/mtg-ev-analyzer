import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {socialDispatchEligibility,dispatchDailySocialFromNeon,DAILY_SOCIAL_TRIGGER_NAME} from '../worker/daily-social-dispatch.mjs';

const TOKEN=['github','pat','fixture','abcdefghijklmnopqrstuvwxyz'].join('_');
const summer='2026-10-19T14:10:00Z';
const winter='2026-12-19T15:10:00Z';
const trigger=(scheduledAt)=>({name:DAILY_SOCIAL_TRIGGER_NAME,scheduledAt});

test('Pacific scheduler selects 7:10 and 7:20/7:40 retry, regardless of DST',()=>{
  assert.deepEqual(socialDispatchEligibility(summer,'2026-10-19T14:10:05Z'),{eligible:true,day:'2026-10-19'});
  assert.deepEqual(socialDispatchEligibility(winter,'2026-12-19T15:10:05Z'),{eligible:true,day:'2026-12-19'});
  assert.equal(socialDispatchEligibility('2026-12-19T14:10:00Z','2026-12-19T14:10:10Z').reason,'off_window');
  assert.equal(socialDispatchEligibility('2026-10-19T15:10:00Z','2026-10-19T15:10:10Z').reason,'off_window');
  for(const minute of ['20','40']){
    assert.equal(socialDispatchEligibility('2026-10-19T14:'+minute+':00Z','2026-10-19T14:'+minute+':20Z').eligible,true);
  }
  assert.equal(socialDispatchEligibility(summer,'2026-10-20T14:15:00Z').reason,'stale');
  assert.equal(socialDispatchEligibility(summer,'2026-10-19T14:05:00Z').reason,'stale');
  assert.equal(socialDispatchEligibility(summer,'2026-10-19T17:10:00Z').reason,'stale');
});

test('Dispatch always targets the reviewed Daily social workflow and Pacific day',async()=>{
  const calls=[];
  const result=await dispatchDailySocialFromNeon({
    trigger:trigger(summer),now:'2026-10-19T14:11:00Z',
    env:{PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:TOKEN},
    fetcher:async(url,options)=>{calls.push({url,options});return new Response(null,{status:204});},
  });
  assert.deepEqual(result,{action:'dispatched',day:'2026-10-19'});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.github.com/repos/killjoy00/mtg-ev-analyzer/actions/workflows/daily-social-post.yml/dispatches');
  assert.equal(calls[0].options.headers.authorization,'Bearer '+TOKEN);
  assert.deepEqual(JSON.parse(calls[0].options.body),{ref:'main',inputs:{live:true,source_day:'2026-10-19'}});
});

test('Untrusted, stale, off-hour or missing credentials never dispatch',async()=>{
  const fetcher=()=>{throw Error('Unexpected network');};
  await assert.rejects(dispatchDailySocialFromNeon({
    trigger:{name:'other',scheduledAt:summer},now:'2026-10-19T14:10:01Z',
    env:{PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:TOKEN},fetcher,
  }),error=>error.status===403);
  assert.equal((await dispatchDailySocialFromNeon({
    trigger:trigger('2026-10-19T15:10:00Z'),now:'2026-10-19T15:10:01Z',
    env:{PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:TOKEN},fetcher,
  })).action,'skipped');
  await assert.rejects(dispatchDailySocialFromNeon({
    trigger:trigger(summer),now:'2026-10-19T14:10:01Z',env:{},fetcher,
  }),/credential/);
  await assert.rejects(dispatchDailySocialFromNeon({
    trigger:trigger(summer),now:'2026-10-19T14:10:01Z',
    env:{PACK1_LAUNCH_WATCHER_GITHUB_TOKEN:TOKEN},
    fetcher:async()=>new Response('{}',{status:503}),
  }),/HTTP 503/);
});

test('Growth endpoint and GH workflow retain narrow trust and source-day checks',()=>{
  const source=fs.readFileSync('worker/growth-function.js','utf8');
  assert.match(source,/verifyNeonScheduleTrigger\(request,body,\{names:SOCIAL_TRIGGER_NAMES\}\)/);
  assert.match(source,/\/internal\/daily-social-dispatch/);
  assert.match(source,/dispatchDailySocialFromNeon/);
  const workflow=fs.readFileSync('.github/workflows/daily-social-post.yml','utf8');
  assert.match(workflow,/source_day:/);
  assert.match(workflow,/SOURCE_PACIFIC_DAY:/);
  assert.match(workflow,/packone-social-live/);
});
