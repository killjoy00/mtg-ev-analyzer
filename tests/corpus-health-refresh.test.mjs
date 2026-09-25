import test from 'node:test';
import assert from 'node:assert/strict';
import {
 HEALTH_GATE_HOURS,
 HEALTH_REFRESH_CADENCE_HOURS,
 HEALTH_SAFETY_HOURS,
 MAX_MANAGED_SNAPSHOTS,
 planCorpusHealthRefresh,
 loadCorpusHealthRefreshRows
} from '../scripts/plan-corpus-health-refresh.mjs';

const now=Date.parse('2026-09-25T00:00:00Z');
const iso=hoursAgo=>new Date(now-hoursAgo*60*60*1000).toISOString();
const row=(i,{hoursAgo=0,current=true,active=true}={})=>({
 source_snapshot_id:String(i).padStart(64,'a'),
 set_id:'set-'+String(i).padStart(2,'0'),
 schema_version:'modern',
 lifecycle_status:active?'Approved':'Candidate',
 active,
 checked_at:iso(hoursAgo),
 evidence_current:current,
 estimated_puzzles:1000+i
});

test('production health refresh capacity leaves one day before the seven-day gate',()=>{
 assert.equal(HEALTH_GATE_HOURS,168);
 assert.equal(HEALTH_REFRESH_CADENCE_HOURS,4);
 assert.equal(HEALTH_SAFETY_HOURS,24);
 assert.equal(MAX_MANAGED_SNAPSHOTS,36);
 assert.equal(MAX_MANAGED_SNAPSHOTS*HEALTH_REFRESH_CADENCE_HOURS,144);
});

test('fresh inventory idles until deadline pressure requires one exact snapshot',()=>{
 const fresh=planCorpusHealthRefresh(Array.from({length:20},(_,i)=>row(i)),{now});
 assert.equal(fresh.action,'idle');
 assert.equal(fresh.over_capacity,false);
 const due=planCorpusHealthRefresh(Array.from({length:20},(_,i)=>row(i,{hoursAgo:65})),{now});
 assert.equal(due.action,'refresh');
 assert.equal(due.selected.set_id,'set-00');
 assert.equal(due.over_capacity,false);
 assert.equal(due.hard_deadline_risk,false);
});

test('missing or invalid evidence is refreshed before merely aging evidence',()=>{
 const rows=[row(1,{hoursAgo:120}),row(2,{hoursAgo:1,current:false}),row(3,{hoursAgo:140})];
 const plan=planCorpusHealthRefresh(rows,{now});
 assert.equal(plan.action,'refresh');
 assert.equal(plan.selected.set_id,'set-02');
 assert.equal(plan.selected.evidence_current,false);
});

test('capacity and already-expired evidence fail loudly instead of silently aging out',()=>{
 const overloaded=planCorpusHealthRefresh(Array.from({length:37},(_,i)=>row(i)),{now});
 assert.equal(overloaded.over_capacity,true);
 assert.equal(overloaded.eligible_snapshots,37);
 const stale=planCorpusHealthRefresh([row(1,{hoursAgo:169})],{now});
 assert.equal(stale.action,'refresh');
 assert.equal(stale.hard_deadline_risk,true);
});

test('candidate snapshots are eligible even when they are not active',()=>{
 const plan=planCorpusHealthRefresh([row(1,{hoursAgo:169,active:false})],{now});
 assert.equal(plan.selected.lifecycle_status,'Candidate');
 assert.equal(plan.selected.active,false);
});


test('refresh inventory query targets active/Candidate snapshots without reading puzzle payloads',async()=>{
 let sql,params;
 const rows=await loadCorpusHealthRefreshRows(async(statement,values)=>{
  sql=statement;params=values;return {rows:[]};
 });
 assert.deepEqual(rows,[]);
 assert.match(sql,/s\.lifecycle_status='Candidate'/);
 assert.match(sql,/p\.active_snapshot_id=s\.source_snapshot_id/);
 assert.match(sql,/p\.status IN \('Live','Paused','Candidate'\)/);
 assert.doesNotMatch(sql,/draft_run_verified_puzzles|payload/);
 assert.equal(params.length,2);
});
