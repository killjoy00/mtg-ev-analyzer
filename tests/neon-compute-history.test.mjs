import test from 'node:test';
import assert from 'node:assert/strict';
import {PROJECT,historyWindow,fetchHistory,normalizeHistory,reconcileHistory,collectComputeHistory} from '../scripts/neon-compute-history.mjs';
const now=Date.parse('2026-10-23T16:00:00Z');
const window=historyWindow({from:'2026-10-21T00:00:00Z',to:'2026-10-22T00:00:00Z',granularity:'daily',now});
const row=(value,branch)=>({project_id:PROJECT,...(branch?{branch_id:branch}:{}),periods:[{period_id:'billing-one',period_start:'2026-10-01T00:00:00Z',period_end:'2026-11-01T00:00:00Z',period_plan:'launch',consumption:[{timeframe_start:window.from,timeframe_end:window.to,metrics:[{metric_name:'compute_unit_seconds',value}]}]}]});
test('hourly retention, alignment and future bounds are validated without silently shrinking windows',()=>{
 assert.throws(()=>historyWindow({...window,granularity:'hourly',from:'2026-10-01T00:00:00Z',now}));
 assert.throws(()=>historyWindow({...window,from:'2026-10-21T00:01:00Z',now}));
 assert.throws(()=>historyWindow({...window,to:'2026-10-24T00:00:00Z',now}));
});
test('all pages request compute metrics, reject repeated cursors, and never write provider state',async()=>{
 let calls=0;const fetcher=async(url,options)=>{assert.equal(options.method,'GET');const p=new URL(url).searchParams;assert.equal(p.get('metrics'),'compute_unit_seconds');assert.equal(p.get('project_ids'),PROJECT);calls++;return Response.json({branches:[row(3600,'br-'+calls)],pagination:calls===1?{cursor:'next'}:{}});};
 const rows=await fetchHistory('branches',{key:'fixture',org:'fixture-org',window,fetcher});assert.equal(rows.length,2);
 await assert.rejects(fetchHistory('branches',{key:'fixture',org:'fixture-org',window,fetcher:async()=>Response.json({branches:[],pagination:{cursor:'again'}})}),/Repeated/);
});
test('duplicate frames deduplicate exactly and conflicting, overlapping or missing metrics never become zero',()=>{
 const a=row(3600);assert.equal(normalizeHistory([a,a],'projects',window).frames.length,1);
 assert.throws(()=>normalizeHistory([a,row(7200)],'projects',window),/Conflicting/);
 const missing=row(1);missing.periods[0].consumption[0].metrics=[];assert.ok(normalizeHistory([missing],'projects',window).problems.length);
 const overlap=row(3600);overlap.periods[0].period_id='other-period';assert.throws(()=>normalizeHistory([a,overlap],'projects',window),/Overlapping/);
 const boundary=row(1);boundary.periods[0].period_end=window.from;assert.throws(()=>normalizeHistory([boundary],'projects',window),/outside/);
});
test('unattributed difference is not CI; deleted ownership requires exact retained evidence',()=>{
 const project=normalizeHistory([row(10800)],'projects',window),branches=normalizeHistory([row(3600,'br-deleted')],'branches',window);
 const result=reconcileHistory(project,branches,window);
 assert.equal(result.unattributed_difference_cu_hours,2);assert.equal(result.branches[0].owner,'unattributed');assert.equal(result.settlement_verified,false);
 const owned=reconcileHistory(project,branches,window,[{branch_id:'br-deleted',project_id:PROJECT,owner:'CI',evidence_type:'deletion_receipt',evidence_ref:'private-receipt'}]);
 assert.equal(owned.branches[0].owner,'CI');assert.equal(owned.branches[0].deleted,true);
 const mismatched=normalizeHistory([row(3600,'br-a')],'branches',window);mismatched.frames[0].from='2026-10-21T12:00:00.000Z';
 assert.equal(reconcileHistory(project,mismatched,window).unattributed_difference_cu_hours,null);
});
test('history access denial is explicit and exposes no invented attribution',async()=>{
 const fetcher=async url=>String(url).includes('/projects/'+PROJECT)?Response.json({project:{id:PROJECT,org_id:'fixture'}}):Response.json({}, {status:403});
 const result=await collectComputeHistory({key:'fixture',window,now,fetcher});
 assert.equal(result.reconciliation.project_reported_cu_hours,null);assert.equal(result.reconciliation.comparable,false);
 assert.equal(result.branches.problems[0].http_status,403);
});

test('mismatched plans and branch totals larger than project totals are not reconciled',()=>{
 const project=normalizeHistory([row(3600)],'projects',window);
 const branches=normalizeHistory([row(7200,'br-a')],'branches',window);
 assert.equal(reconcileHistory(project,branches,window).unattributed_difference_cu_hours,null);
 branches.frames[0].compute_unit_seconds=100;
 branches.frames[0].period_plan='different-plan';
 assert.equal(reconcileHistory(project,branches,window).comparable,false);
});
