import test from 'node:test';
import assert from 'node:assert/strict';
import {
 HEALTH_EVIDENCE_HOURS,
 EXPIRY_WARNING_HOURS,
 loadHealthEvidenceRows,
 classifyHealthEvidence,
 summarizeHealthEvidence,
 healthEvidenceMarkdown
} from '../scripts/corpus-health-freshness.mjs';

const now=Date.parse('2026-09-26T00:00:00Z');
const iso=hoursAgo=>new Date(now-hoursAgo*60*60*1000).toISOString();
const row=(id,{hoursAgo=1,current=true,ready=true,active=true,lifecycle='Approved',environment='Live',checked=true}={})=>({
 source_snapshot_id:String(id).padStart(64,'a'),
 set_id:'set-'+id,
 schema_version:'premier-modern-skill-buckets-v1',
 lifecycle_status:lifecycle,
 environment_status:environment,
 active,
 checked_at:checked?iso(hoursAgo):null,
 ready:checked?ready:null,
 evidence_current:checked&&current
});
const classify=rows=>classifyHealthEvidence(rows,{now});

test('evidence window matches the seven-day activation gate',()=>{
 assert.equal(HEALTH_EVIDENCE_HOURS,168);
 assert.equal(EXPIRY_WARNING_HOURS,48);
});

test('a Live snapshot with old evidence is informational and needs no scan',()=>{
 const [item]=classify([row(1,{hoursAgo:24*40,current:false})]);
 assert.equal(item.state,'live-informational');
 assert.equal(item.last_result,'passed');
 assert.equal(item.next_step,null);
 assert.equal(item.expires_at,null);
});

test('a Live snapshot stays informational even if its lifecycle still reads Candidate',()=>{
 const [item]=classify([row(1,{lifecycle:'Candidate',current:false,hoursAgo:24*30})]);
 assert.equal(item.state,'live-informational');
});

test('a waiting Candidate is ready, then expiring, then needs one exact check',()=>{
 const candidate={active:false,lifecycle:'Candidate'};
 assert.equal(classify([row(1,{...candidate,hoursAgo:24})])[0].state,'ready');
 const expiring=classify([row(1,{...candidate,hoursAgo:168-10})])[0];
 assert.equal(expiring.state,'expiring');
 assert.equal(expiring.hours_left,10);
 assert.match(expiring.next_step,/Corpus snapshot health check/);
 const stale=classify([row(1,{...candidate,hoursAgo:24*9,current:false})])[0];
 assert.equal(stale.state,'check-before-action');
 assert.match(stale.next_step,new RegExp('snapshot_id='+stale.source_snapshot_id));
});

test('first publication and reactivation are the pending actions for active snapshots',()=>{
 assert.equal(classify([row(1,{environment:'Candidate',current:false,hoursAgo:24*9})])[0].state,'check-before-action');
 assert.equal(classify([row(2,{environment:'Paused',current:false,hoursAgo:24*9})])[0].state,'check-before-action');
 assert.equal(classify([row(3,{environment:'Paused',hoursAgo:12})])[0].state,'ready');
});

test('a failed latest check is blocked and never-checked evidence needs a check',()=>{
 const blocked=classify([row(1,{active:false,lifecycle:'Candidate',ready:false})])[0];
 assert.equal(blocked.state,'blocked');
 assert.equal(blocked.last_result,'failed');
 const never=classify([row(2,{active:false,lifecycle:'Candidate',checked:false})])[0];
 assert.equal(never.state,'check-before-action');
 assert.equal(never.last_result,'never checked');
});

test('summary and markdown report pending work and never schedule payload scans',()=>{
 const items=classify([
  row(1,{hoursAgo:24*20,current:false}),
  row(2,{hoursAgo:24*3}),
  row(3,{active:false,lifecycle:'Candidate',hoursAgo:24*9,current:false}),
  row(4,{active:false,lifecycle:'Candidate',hoursAgo:160})
 ]);
 const summary=summarizeHealthEvidence(items);
 assert.equal(summary.scheduled_payload_scans,0);
 assert.equal(summary.snapshots,4);
 assert.equal(summary.live_informational,2);
 assert.equal(summary.oldest_live_verification,iso(24*20));
 assert.equal(summary.check_before_action,1);
 assert.equal(summary.expiring,1);
 const markdown=healthEvidenceMarkdown(summary,items);
 assert.match(markdown,/## Corpus health evidence/);
 assert.match(markdown,/set-3/);
 assert.doesNotMatch(markdown,/\| set-1 \|/);
 assert.match(healthEvidenceMarkdown(summarizeHealthEvidence([]),[]),/No Candidate or Paused snapshot is waiting on an action\./);
});

test('evidence inventory query reads metadata only, never puzzle payloads',async()=>{
 let sql,params;
 const rows=await loadHealthEvidenceRows(async(statement,values)=>{sql=statement;params=values;return {rows:[]};});
 assert.deepEqual(rows,[]);
 assert.match(sql,/s\.lifecycle_status='Candidate'/);
 assert.match(sql,/p\.active_snapshot_id=s\.source_snapshot_id AND p\.status IN \('Live','Paused','Candidate'\)/);
 assert.match(sql,/h\.checked_at>now\(\)-interval '7 days'/);
 assert.doesNotMatch(sql,/draft_run_verified_puzzles|payload|INSERT|UPDATE|DELETE/);
 assert.equal(params.length,2);
});
