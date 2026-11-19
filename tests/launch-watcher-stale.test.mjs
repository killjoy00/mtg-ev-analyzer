import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectLaunchCoverageFreshness} from '../worker/launch-watcher-stale.mjs';
import {COVERAGE_ISSUE_NUMBER,COVERAGE_ISSUE_TITLE,renderCoverageState} from '../launch-monitoring.mjs';

const issue=(through)=>({number:COVERAGE_ISSUE_NUMBER,title:COVERAGE_ISSUE_TITLE,body:renderCoverageState({version:1,coverage_floor:'2026-09-26T10:00:00.000Z',covered_through:through,alerted_windows:{},updated_at:through})});

test('independent stale check accepts a recent persisted coverage watermark',async()=>{
 const now=Date.parse('2026-09-26T12:30:00Z');
 const result=await inspectLaunchCoverageFreshness({now,fetcher:async()=>Response.json(issue('2026-09-26T12:15:00.000Z'))});
 assert.equal(result.ok,true);assert.equal(result.reason,'fresh');assert.equal(result.age_minutes,15);
});

test('independent stale check signals a watcher more than 30 minutes behind',async()=>{
 const now=Date.parse('2026-09-26T12:30:00Z');
 const result=await inspectLaunchCoverageFreshness({now,fetcher:async()=>Response.json(issue('2026-09-26T11:55:00.000Z'))});
 assert.equal(result.ok,false);assert.equal(result.reason,'coverage_stale');assert.equal(result.age_minutes,35);
});

test('independent stale check fails closed when the public state is inaccessible or uninitialized',async()=>{
 const unavailable=await inspectLaunchCoverageFreshness({fetcher:async()=>new Response('{}',{status:503})});
 assert.deepEqual(unavailable,{ok:false,reason:'coverage_state_unavailable',status:503,max_age_minutes:30});
 const blank={number:COVERAGE_ISSUE_NUMBER,title:COVERAGE_ISSUE_TITLE,body:renderCoverageState({version:1,coverage_floor:null,covered_through:null,alerted_windows:{},updated_at:null})};
 const uninitialized=await inspectLaunchCoverageFreshness({fetcher:async()=>Response.json(blank)});
 assert.equal(uninitialized.ok,false);assert.equal(uninitialized.reason,'coverage_not_initialized');
});
