import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {seasonAdminAction,seasonDeviceAction,seasonEvidenceHash} from '../worker/season-publisher.mjs';
import {fetchSeasonColorGuide,parseSeasonColorRows,seasonColorSource} from '../worker/season-outcome-source.mjs';
import {guideGameOutcomes,CLOSED_SEASON_SQL} from '../scripts/pack-one-season-editorial.mjs';
import {sealSnapshot,openSnapshot,weeklyPublisherRoute} from '../worker/weekly-publisher.mjs';
import {runPairedSeasonTick} from '../scripts/pack-one-weekly-private-runner.mjs';
import {validateSeasonPrepared,seasonCaption} from '../weekly-patreon-contract.mjs';
import {seasonGuideReviewMarkup} from '../admin/patreon-season-review.mjs';
import {seasonArticle,guideArticle,fixtureSnapshot,milestone} from './fixtures/pack-one-season-articles.mjs';

const env={PACK1_RATE_LIMIT_SECRET:'fixture-secret-for-unit-tests-0000000',PACKONE_WEEKLY_PATREON_READ_TOKEN:'fixture-read-token'};
const tokenHash='a'.repeat(64),imageHash='b'.repeat(64),pubUrl='https://www.patreon.com/posts/987654';
const close=new Date('2026-12-31T18:01:00Z'),midpoint=new Date('2026-12-16T18:01:00Z');
const guideGate={setId:'fixture',start:'2026-12-01',end:'2026-12-15',milestone:'2026-12-16'};
const closed={id:'fixture',set_id:'fixture',set_name:'Fixture Set',start_date:seasonArticle.start,end_date:seasonArticle.end,successor_id:'next',successor_start:milestone};
const open={id:'fixture',set_id:'fixture',set_name:'Fixture Set',start_date:guideArticle.start,end_date:null};
const raw=guideArticle.outcomes.rows.map(r=>({is_summary:false,short_name:r.colors,color_name:'Fixture ('+r.colors+')',wins:r.wins,games:r.games}));
raw.push({is_summary:true,color_name:'Two-color',wins:11100,games:20000});
test('bounded dated source must contain exact non-splash rows and matching summary, no fabricated win counts',async()=>{
 const parsed=parseSeasonColorRows(raw,guideGate);
 assert.ok(parsed);assert.equal(parsed.results.baseline.wins,11100);
 assert.equal(guideGameOutcomes(parsed,guideGate).period,'DATE_RANGE');
 assert.equal(parseSeasonColorRows(raw.slice(0,-1),guideGate),null);
 assert.equal(parseSeasonColorRows([...raw,{...raw[0],short_name:'UW',color_name:'Duplicate (UW)'}],guideGate),null);
 assert.equal(parseSeasonColorRows(raw.map((r,i)=>i===0?{...r,wins:undefined}:r),guideGate),null);
 assert.equal(parseSeasonColorRows(raw.map((r,i)=>i===10?{...r,wins:1}:r),guideGate),null);
 let requests=0;
 const found=await fetchSeasonColorGuide(guideGate,{fetchImpl:async(url,options)=>{requests++;assert.equal(url,seasonColorSource(guideGate));assert.equal(options.redirect,'error');return new Response(JSON.stringify(raw));}});
 assert.equal(requests,1);assert.deepEqual(found,parsed);
 assert.equal(await fetchSeasonColorGuide(guideGate,{fetchImpl:async()=>new Response('',{status:429})}),null);
 assert.throws(()=>seasonCaption('midseason-guide','Fixture Set','2026-12-01','2026-12-14',parsed.results.sourceUrl),/season-invalid-source/);
});
function fixture({now=close,resultsEnabled=true,withPlan=false,allowAdmission=true}={}){
 let time=now,plan=withPlan?{season_id:'fixture',next_set_id:'next',next_start:'2026-12-31',reviewed_on:'2026-12-01',revision:'c'.repeat(64),color_count:2,snapshot:null,source_attempted_at:null}:null,draft=null,run=null,found=null,sourceCalls=0;
 const q=async(sql,args=[])=>{
  if(sql.includes('to_regclass'))return {rows:[{ready:true}]};
  if(sql===CLOSED_SEASON_SQL)return {rows:time.toISOString().slice(0,10)===milestone?[closed]:[]};
  if(sql.includes('FROM results_launch'))return {rows:[{active:'t',first_publication_at:'2026-11-30T15:33:00Z',launch_at:'2026-11-23T15:33:00Z'}]};
  if(sql.includes('SELECT results_enabled_from'))return {rows:[{results_enabled_from:resultsEnabled?'2026-12-01':null}]};
  if(sql.includes('FROM draft_run_seasons WHERE end_date IS NULL'))return {rows:[open]};
  if(sql.includes('SELECT season_id,next_set_id'))return {rows:plan?[plan]:[]};
  if(sql.includes('SELECT season_id,milestone'))return {rows:draft?[draft]:[]};
  if(sql.includes('SELECT post_key,kind,season_id,milestone'))return {rows:run&&run.post_key===args[0]?[run]:[]};
  if(sql.includes('SELECT post_key,title,body,state'))return {rows:run&&run.admitted_at&&run.state!=='verified'?[run]:[]};
  if(sql.includes('SELECT post_key,kind,season_id,state'))return {rows:run?[run]:[]};
  if(sql.startsWith('UPDATE patreon_midseason_plans SET source_attempted_at')){if(!plan||plan.source_attempted_at)return {rows:[]};plan.source_attempted_at=time.toISOString();return {rows:[{season_id:'fixture'}]};}
  if(sql.startsWith('UPDATE patreon_midseason_plans SET snapshot=')){if(!plan||plan.snapshot)return {rows:[]};plan.snapshot=args[2];return {rows:[{season_id:'fixture'}]};}
  if(sql.startsWith('INSERT INTO patreon_midseason_drafts')){if(!draft)draft={season_id:args[0],milestone:args[1],plan_revision:args[2],evidence_sha256:args[3],title:args[4],body:args[5],article:args[6],state:'draft',approved_at:null};return {rows:[]};}
  if(sql.startsWith('UPDATE patreon_midseason_drafts d SET')){if(!draft||draft.state!=='draft'||draft.evidence_sha256!==args[1])return {rows:[]};draft.state=args[2];draft.approved_at=time.toISOString();return {rows:[{season_id:'fixture'}]};}
  if(sql.startsWith('INSERT INTO patreon_season_runs')){if(run)return {rows:[]};run={post_key:args[0],kind:args[1],season_id:args[2],milestone:args[3],evidence_sha256:args[4],title:args[5],body:args[6],state:'claimed',image_sha256:args[7],image_width:args[8],image_height:args[9],snapshot_ticket_sha256:args[10],admitted_at:null};return {rows:[{post_key:run.post_key}]};}
  if(sql.includes('SELECT pack1_patreon_season_admit')){if(!allowAdmission||!run||run.state!=='claimed')return {rows:[{ok:false}]};if(run.kind==='midseason-guide')assert.deepEqual(JSON.parse(args[1]),[]);run.state='handoff';run.admitted_at=time.toISOString();return {rows:[{ok:true}]};}
  if(sql.startsWith("UPDATE patreon_season_runs SET state='queued'")){if(run.state==='handoff')run.state='queued';return {rows:[]};}
  if(sql.startsWith("UPDATE patreon_season_runs SET state='review'")){if(run.state!=='verified')run.state='review';return {rows:[]};}
  if(sql.includes('SELECT pack1_patreon_season_finish')){assert.equal(args[1],pubUrl);run.state='verified';return {rows:[{ok:true}]};}
  throw Error('unexpected fixture SQL: '+sql);
 };
 const clock=()=>time,find=async()=>found;
 const args={query:q,clock,find,tokenHash,seal:d=>sealSnapshot(d,env),open:(t,o)=>openSnapshot(t,env,o),metadata:b=>({hash:b.image_sha256,width:b.width,height:b.height}),collectResults:async()=>fixtureSnapshot(seasonArticle),collectGuide:async()=>fixtureSnapshot(guideArticle),loadGuide:async()=>null,fetchColorGuide:async()=>{sourceCalls++;return parseSeasonColorRows(raw,guideGate);}};
 return {device:(action,p={})=>seasonDeviceAction({action:'season-'+action,...p},args),admin:(action,p={})=>seasonAdminAction({action:'season-admin-'+action,...p},{query:q,clock}),run:()=>run,draft:()=>draft,sourceCalls:()=>sourceCalls,advance:t=>{time=t;},found:()=>{found={title:run.title,url:pubUrl,publishedAt:time.toISOString()};},q};
}
test('season results claim binds image and evidence, keeps placements encrypted, permits only one handoff and requires verified public readback',async()=>{
 const f=fixture();const prepared=await f.device('prepare');
 assert.equal(validateSeasonPrepared(prepared),prepared);assert.equal(prepared.post_key,'pack-one-season:results:fixture');assert.ok(!JSON.stringify(prepared).includes('11111111-1111-4111-8111-111111111111'));
 assert.throws(()=>openSnapshot(prepared.ticket,env,{tokenHash,now:close}),/invalid-snapshot/);
 const ticket=openSnapshot(prepared.ticket,env,{tokenHash,now:close,expectedVersion:2});assert.equal(ticket.evidence,prepared.evidence_sha256);
 assert.deepEqual(ticket.placements,[{auth_id:'11111111-1111-4111-8111-111111111111',name:'Sample Player A'}]);
 assert.throws(()=>validateSeasonPrepared({...prepared,body:'altered'}),/season-invalid-prepared/);
 const params={ticket:prepared.ticket,image_sha256:imageHash,width:960,height:3000};
 assert.equal((await f.device('claim',params)).status,'claimed');
 assert.equal((await f.device('claim',params)).status,'receipt-exists');
 await assert.rejects(()=>f.device('admit',{ticket:params.ticket,image_sha256:'c'.repeat(64)}),/claim-mismatch/);
 assert.equal((await f.device('admit',{ticket:params.ticket,image_sha256:imageHash})).status,'admitted');
 await assert.rejects(()=>f.device('admit',{ticket:params.ticket,image_sha256:imageHash}),/claim-mismatch/);
 await f.device('queued',{ticket:params.ticket,image_sha256:imageHash});
 assert.equal((await f.device('status')).pending.length,1);
 await assert.rejects(()=>f.device('finish',{post_key:prepared.post_key,url:pubUrl,publishedAt:close.toISOString(),visualVerified:false}),/receipt-not-verified/);
 f.found();const read=(await f.device('find',{post_key:prepared.post_key})).found;
 assert.equal((await f.device('finish',{post_key:prepared.post_key,url:read.url,publishedAt:read.publishedAt,visualVerified:true})).status,'verified');
 assert.equal((await f.device('prepare')).status,'outside-window');
});
test('midseason creates one immutable private draft, requires exact owner hash and can queue only after approval',async()=>{
 const f=fixture({now:midpoint,resultsEnabled:false,withPlan:true});
 assert.equal((await f.device('prepare')).status,'guide-draft-awaiting-approval');
 assert.equal(f.sourceCalls(),1);assert.equal((await f.device('prepare')).status,'guide-draft-awaiting-approval');assert.equal(f.sourceCalls(),1);
 const status=await f.admin('status');assert.equal(status.draft.state,'draft');
 assert.match(seasonGuideReviewMarkup(status.draft),/Exact caption/);
 await assert.rejects(()=>f.admin('approve',{seasonId:'fixture',hash:'f'.repeat(64)}),/season-draft-changed/);
 assert.equal((await f.admin('approve',{seasonId:'fixture',hash:status.draft.hash})).status,'guide-approved');
 f.advance(new Date('2026-12-17T18:01:00Z'));
 const prepared=await f.device('prepare');assert.equal(prepared.evidence_sha256,status.draft.hash);
 assert.equal(prepared.post_key,'pack-one-season:guide:fixture');
 const ticket=openSnapshot(prepared.ticket,env,{tokenHash,now:new Date('2026-12-17T18:01:00Z'),expectedVersion:2});assert.deepEqual(ticket.placements,[]);
 f.draft().article=JSON.stringify({...guideArticle,seasonName:'Tampered'});
 await assert.rejects(()=>f.device('prepare'),/season-draft-invalid/);
});
test('private desktop queues only after admission; an ambiguous handoff is never retried',async()=>{
 const f=fixture(),actions=[];
 const call=(action,params)=>f.device(action.replace(/^season-/,''),params);
 const jpeg=Buffer.alloc(6000,1);jpeg[0]=255;jpeg[1]=216;jpeg[2]=255;
 const tick=()=>runPairedSeasonTick({call,bridge:async(action)=>{actions.push(action);if(action==='stage')return {id:'fixture-draft'};throw Error('ambiguous');},capture:async()=>({jpeg,width:960,height:3000}),verify:async()=>true});
 assert.equal((await tick()).status,'review-required');
 await tick();assert.deepEqual(actions,['stage','queue']);
});
