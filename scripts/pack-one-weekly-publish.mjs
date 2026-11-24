// Private recap publisher orchestration. No public feed, artifacts, or data
// in stdout. The durable DB receipt is the authority for every handoff.
// Provider adapter must separate private draft preparation from submission.
import {createHash} from 'node:crypto';
import {weeklyDue,collectWeeklyRecap,assertNamedPublicationTime,validDay} from './pack-one-weekly-data.mjs';
import {captureWeeklyRecap,STORE_LINKS} from './pack-one-weekly-render.mjs';

const CUTOFF=Date.parse('2026-11-30T15:33:00Z');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const truth=value=>value===true||value==='t';
const one=async(query,sql,args=[])=> (await query(sql,args)).rows[0]||null;
export function assertPrivateRuntime(env=process.env) {
 if(env.GITHUB_ACTIONS||env.CI||env.GITHUB_RUN_ID||env.PACKONE_WEEKLY_PRIVATE_RUNTIME!=='true')
  throw Error('weekly-private-runtime-required');
 if(env.PACKONE_WEEKLY_PUBLICATION_ENABLED!=='true'||env.PACKONE_WEEKLY_NOTICE_VERIFIED!=='true')
  throw Error('weekly-publisher-disabled');
}
export function recapTitle(end){return 'Pack One Weekly | '+validDay(end);}
export function recapBody(end){
 return 'Week ending '+validDay(end)+'.\n\nPlay Pack One: '+STORE_LINKS.web+'\nDownload on the App Store: '+STORE_LINKS.ios+'\nGet it on Google Play: '+STORE_LINKS.android;
}
export function publicLocator(value){
 try{
  const u=new URL(value);
  if(u.protocol==='https:'&&u.hostname==='www.patreon.com'&&!u.port&&!u.username&&!u.password&&/^\/posts\/\d+$/.test(u.pathname)&&!u.search&&!u.hash)return u.toString();
 }catch{}
 return null;
}
export function validPublication(found,run,now=new Date()){
 const url=publicLocator(found?.url),at=Date.parse(found?.publishedAt);
 if(!url||!Number.isFinite(at)||at<CUTOFF||at>now.getTime()||at<Date.parse(run.admitted_at)||found.title!==run.title)
  throw Error('weekly-public-readback-invalid');
 return {url,publishedAt:new Date(at).toISOString()};
}
export async function getRun(query,end){
 return one(query,'SELECT week_end::text,title,state,image_sha256,image_width,image_height,admitted_at,public_url,published_at FROM patreon_weekly_runs WHERE week_end=$1::date',[end]);
}
export async function markReview(query,end,code){
 const safe=['draft-failed','admission-failed','handoff-uncertain','readback-failed','identity-changed','unexpected-public-post','queue-confirmation-lost'].includes(code)?code:'review-required';
 await query("UPDATE patreon_weekly_runs SET state='review',last_status=$2 WHERE week_end=$1::date AND state<>'verified'",[end,safe]);
}
async function finishExisting(query,run,publisher,now){
 if(run.state==='verified')return {status:'already-verified',week_end:run.week_end};
 if(!run.admitted_at)return {status:'review-required',week_end:run.week_end};
 // An uncertain queue is reconciled, never resent. A not-found response does
 // not authorize a new submission. Only independent public content/image
 // verification can turn an admitted receipt into a verified one.
 try{
  const found=await publisher.find(run.title);
  if(!found)return {status:'awaiting-publication',week_end:run.week_end};
  const verified=validPublication(found,run,now);
  if(await publisher.verify({title:run.title,body:recapBody(run.week_end),url:verified.url,width:Number(run.image_width),height:Number(run.image_height)})!==true)
   throw Error('weekly-public-readback-invalid');
  const done=await one(query,'SELECT pack1_patreon_weekly_finish($1::date,$2,$3::timestamptz) ok',[run.week_end,verified.url,verified.publishedAt]);
  if(!truth(done?.ok))throw Error('weekly-publication-record-failed');
  return {status:'verified',week_end:run.week_end};
 }catch{
  await markReview(query,run.week_end,'readback-failed');
  return {status:'review-required',week_end:run.week_end};
 }
}
export async function reconcileWeeklyRecaps(query,publisher,{now=new Date()}={}){
 const runs=(await query("SELECT week_end::text,title,state,image_sha256,image_width,image_height,admitted_at FROM patreon_weekly_runs WHERE state IN ('handoff','queued','review') AND admitted_at IS NOT NULL ORDER BY week_end LIMIT 20")).rows;
 const outcomes=[];
 for(const run of runs)outcomes.push(await finishExisting(query,run,publisher,now));
 return outcomes;
}
const assertMedia=media=>{
 if(!Buffer.isBuffer(media?.jpeg)||media.jpeg.length<5000||media.jpeg.length>12_000_000||
    media.jpeg[0]!==255||media.jpeg[1]!==216||media.jpeg[2]!==255||
    !Number.isInteger(media.width)||media.width<100||media.width>4000||
    !Number.isInteger(media.height)||media.height<100||media.height>30000)
  throw Error('weekly-media-invalid');
 return media;
};
export function uniquePlacements(rows){
 if(!Array.isArray(rows)||rows.length>2000)throw Error('weekly-placements-invalid');
 const byId=new Map();
 for(const p of rows){
  if(!/^[0-9a-f-]{36}$/i.test(p?.authId||'')||typeof p.name!=='string'||!p.name||p.name.length>100||p.name==='Anonymous player')throw Error('weekly-placements-invalid');
  if(byId.has(p.authId)&&byId.get(p.authId)!==p.name)throw Error('weekly-placements-invalid');
  byId.set(p.authId,p.name);
 }
 return [...byId].sort(([a],[b])=>a.localeCompare(b)).map(([auth_id,name])=>({auth_id,name}));
}
// All callers must run on an authenticated private host. No manual override of
// the authoritative database/clock gate exists. Reconcile on every tick,
// including after Monday, but only create a new receipt Monday at noon CT.
export async function runPrivateWeeklyRecap({query,publisher,now=new Date(),clock=()=>new Date(),env=process.env,collect=collectWeeklyRecap,capture=captureWeeklyRecap}){
 assertPrivateRuntime(env);
 const reconciled=await reconcileWeeklyRecaps(query,publisher,{now});
 const gate=weeklyDue(now);
 if(!gate)return {status:'outside-window',reconciled:reconciled.length};
 const existing=await getRun(query,gate.end);
 if(existing)return {status:existing.state==='verified'?'already-verified':'receipt-exists',week_end:gate.end};
 await assertNamedPublicationTime(query,now);
 const title=recapTitle(gate.end),body=recapBody(gate.end);
 // A preexisting exact-title post without our receipt is not adoptable.
 if(await publisher.find(title))return {status:'unexpected-public-post',week_end:gate.end};
 const snapshot=await collect(query,gate,{now});
 const placements=uniquePlacements(snapshot.placements);
 const image=assertMedia(await capture(snapshot.article,{jpeg:true}));
 const hash=digest(image.jpeg);
 // Retain only hash/dimensions and the date here; no names or rendered bytes.
 const claimed=await one(query,"INSERT INTO patreon_weekly_runs(week_end,title,state,image_sha256,image_width,image_height) VALUES($1::date,$2,'claimed',$3,$4,$5) ON CONFLICT(week_end) DO NOTHING RETURNING week_end::text",[gate.end,title,hash,image.width,image.height]);
 if(!claimed)return {status:'receipt-exists',week_end:gate.end};
 let staged;
 try{
  // Private local draft only. This call is not allowed to queue a post.
  staged=await publisher.stage({title,body,image:image.jpeg,image_sha256:hash});
  if(!staged||typeof staged.id!=='string'||!staged.id)throw Error('weekly-draft-invalid');
 }catch{
  await markReview(query,gate.end,'draft-failed');
  return {status:'review-required',week_end:gate.end};
 }
 try{
  // Re-read public destination and the clock after rendering/staging. SQL
  // admission rechecks all names with account locks and stores minimal
  // pending removal evidence BEFORE the first possible external queue call.
  if(await publisher.find(title)){
   await markReview(query,gate.end,'unexpected-public-post');
   return {status:'review-required',week_end:gate.end};
  }
  if(weeklyDue(clock())?.key!==gate.key){
   await markReview(query,gate.end,'admission-failed');
   return {status:'review-required',week_end:gate.end};
  }
  const admitted=await one(query,'SELECT pack1_patreon_weekly_admit($1::date,$2::jsonb) ok',[gate.end,JSON.stringify(placements)]);
  if(!truth(admitted?.ok)){
   await markReview(query,gate.end,'identity-changed');
   return {status:'review-required',week_end:gate.end};
  }
 }catch{
  await markReview(query,gate.end,'admission-failed');
  return {status:'review-required',week_end:gate.end};
 }
 try{
  // Exactly one queue attempt. Any timeout, crash or lost response is
  // ambiguous and cannot be automatically retried, including after restart.
  await publisher.queue({id:staged.id,title,body,image_sha256:hash,image_size:image.jpeg.length});
  await query("UPDATE patreon_weekly_runs SET state='queued',last_status='queued' WHERE week_end=$1::date AND state='handoff'",[gate.end]);
  return {status:'queued-awaiting-verification',week_end:gate.end};
 }catch{
  await markReview(query,gate.end,'handoff-uncertain');
  return {status:'review-required',week_end:gate.end};
 }
}
