import test from 'node:test';
import assert from 'node:assert/strict';
import {PROJECT,SCOPE,projectSnapshot,compareSnapshots,historyWindow,collectEvidence} from '../scripts/neon-egress-evidence.mjs';
const project={id:PROJECT,org_id:'org-fixture',data_transfer_bytes:87990387341,consumption_period_start:'2026-09-08T14:17:51Z',consumption_period_end:'2026-10-01T00:00:00Z'};
const snapshot=(at='2026-09-26T12:00:00Z',value=87990387341)=>projectSnapshot({...project,data_transfer_bytes:value},at);
test('provider metric, complete project scope, billing period and collection time are explicit',()=>{
 const s=snapshot();assert.equal(s.metric,'data_transfer_bytes');assert.equal(s.scope,SCOPE);assert.equal(s.unit,'bytes');assert.equal(s.billing_period_end,'2026-10-01T00:00:00.000Z');assert.equal(s.provider_measurement_at,null);
 assert.throws(()=>projectSnapshot({...project,id:'other'},s.observed_at));
 for(const value of [null,-1,NaN,Infinity,'0',1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>projectSnapshot({...project,data_transfer_bytes:value},s.observed_at));
});
test('a same-period measured difference reports its exact interval, not a daily tally or a recovery claim',()=>{
 const delta=compareSnapshots(snapshot(),snapshot('2026-09-26T18:00:00Z',87990387341+6000));
 assert.equal(delta.delta_bytes,6000);assert.equal(delta.interval_seconds,21600);assert.equal(delta.reported_bytes_per_hour,1000);assert.equal(delta.actual_usage_verified,false);
 const unchanged=compareSnapshots(snapshot(),snapshot('2026-09-26T18:00:00Z'));
 assert.equal(unchanged.delta_bytes,0);assert.equal(unchanged.actual_usage_verified,false);
});
test('billing reset, scope/metric changes, missing identity, backwards time and revisions are not negative or zero usage',()=>{
 const before=snapshot(),later=snapshot('2026-09-26T18:00:00Z');
 const variants=[{...later,billing_period_start:'2026-10-01T00:00:00.000Z',billing_period_end:'2026-11-01T00:00:00.000Z',value:10},{...later,metric:'public_network_transfer_bytes'},{...later,scope:'production'},{...later,project_id:'other'},{...later,billing_period_end:null},{...later,observed_at:before.observed_at},{...later,value:1},{...later,observed_at:'2026-10-02T00:00:00Z'}];
 for(const after of variants){const delta=compareSnapshots(before,after);assert.equal(delta.status,'not_comparable');assert.equal(delta.delta_bytes,null);}
 assert.equal(compareSnapshots(null,later).reason,'no_previous_observation');
});
test('post-fix history starts at the next full UTC hour and excludes recent unsettled hours',()=>{
 const w=historyWindow(Date.parse('2026-09-26T18:42:00Z'),{since:'2026-09-25T19:42:23Z'});
 assert.equal(w.from,'2026-09-25T20:00:00.000Z');assert.equal(w.to,'2026-09-26T16:00:00.000Z');assert.equal(w.settlement_verified,false);
 assert.throws(()=>historyWindow(Date.parse('2026-09-26T18:00:00Z'),{since:'2026-09-26T18:00:00Z'}));
});
test('unavailable histories are explicit and metadata collection never issues SQL or a mutation',async()=>{
 const calls=[];const fetcher=async(url,options)=>{calls.push({url,options});return url.includes('/projects/'+PROJECT)?Response.json({project}):new Response('{}',{status:403});};
 const report=await collectEvidence({fetcher,key:'fixture',now:Date.parse('2026-09-26T18:00:00Z'),clock:()=> '2026-09-26T18:00:00Z',previous:snapshot(),since:'2026-09-25T19:42:23Z'});
 assert.equal(calls.length,3);assert.equal(report.comparison.delta_bytes,0);assert.equal(report.project_history.status,'unavailable');assert.equal(report.branch_history.http_status,403);
 for(const {url,options} of calls){assert.equal(options.method,undefined);assert.equal(options.body,undefined);assert.equal(new URL(url).host,'console.neon.tech');assert.ok(!url.includes('/sql'));}
 assert.equal(new URL(calls[2].url).searchParams.get('limit'),'100');
});
test('empty history or a paginated branch response is retained as incomplete evidence, not summed to zero',async()=>{
 const fetcher=async url=>Response.json(url.includes('/projects/'+PROJECT)?{project}:url.includes('/v2/branches')?{branches:[],pagination:{cursor:'more'}}:{projects:[]});
 const report=await collectEvidence({fetcher,key:'fixture',now:Date.parse('2026-09-26T18:00:00Z'),clock:()=> '2026-09-26T18:00:00Z'});
 assert.equal(report.project_history.status,'returned_requires_coverage_validation');assert.deepEqual(report.project_history.data,{projects:[]});assert.equal(report.branch_history.data.pagination.cursor,'more');assert.equal(report.project_history.delta_bytes,undefined);
});
test('authentication, transport and provider errors fail visibly rather than becoming healthy history',async()=>{
 for(const status of [401,429,500])await assert.rejects(collectEvidence({key:'fixture',fetcher:async url=>url.includes('/projects/'+PROJECT)?Response.json({project}):new Response('{}',{status}),now:Date.parse('2026-09-26T18:00:00Z'),clock:()=> '2026-09-26T18:00:00Z'}),new RegExp('HTTP '+status));
});
