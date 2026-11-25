// Authenticated through the existing paired publisher, never a public feed.
import {createHash} from 'node:crypto';
import {articleHash,centralDate} from './lab-editorial.mjs';
import {labWeek,labPost,labPresentationHash,validateLabPrepared} from '../lab-patreon-contract.mjs';
import {publicLocator,WEEKLY_HASH} from '../weekly-patreon-contract.mjs';
const one=async(q,s,a=[])=>(await q(s,a)).rows[0]||null;
const yes=v=>v===true||v==='t'||v==='true';
const fail=(code,status=409)=>{throw Object.assign(Error(code),{weeklySafe:true,status});};
const hash=v=>createHash('sha256').update(v).digest('hex');
const fields=(b,a)=>{if(!b||Object.keys(b).some(k=>!a.includes(k)))fail('lab-invalid-request',400);};
const receipt=(q,w)=>one(q,'SELECT week_key::text AS week,revision,article_hash,presentation_sha256,title,body,state,image_sha256,image_width,image_height,snapshot_ticket_sha256,admitted_at,public_url,published_at FROM patreon_lab_runs WHERE week_key=$1::date',[labWeek(w)]);
const pending=r=>r&&['handoff','queued','review'].includes(r.state)&&r.admitted_at;
const ready=async q=>yes((await one(q,"SELECT to_regclass('public.pack1_lab_issues') IS NOT NULL AND to_regclass('public.patreon_lab_runs') IS NOT NULL AS ready"))?.ready);
const approvalWhere="i.state='approved' AND i.approved_hash=i.article_hash AND i.approved_at<=$2::timestamptz AND i.publish_at<=$2::timestamptz AND EXISTS(SELECT 1 FROM pack1_admins a WHERE a.auth_user_id=i.approved_by AND a.role='owner')";
async function approved(q,week,now){
 const row=await one(q,'SELECT i.revision,i.article_hash,i.article FROM pack1_lab_issues i WHERE i.week_key=$1::date AND '+approvalWhere,[labWeek(week),now.toISOString()]);
 if(!row)return null;
 const a=typeof row.article==='string'?JSON.parse(row.article):row.article;
 if(articleHash(a)!==row.article_hash||!WEEKLY_HASH.test(row.article_hash||''))fail('lab-approval-changed');
 const revision=Number(row.revision);
 if(!Number.isSafeInteger(revision)||revision<1)fail('lab-approval-changed');
 const post=labPost(a);
 return {revision,article_hash:row.article_hash,post,presentation_sha256:labPresentationHash(post)};
}
function publicReadback(found,r,now){
 const url=publicLocator(found?.url),at=Date.parse(found?.publishedAt),admitted=Date.parse(r.admitted_at);
 if(!url||found.title!==r.title||!Number.isFinite(at)||!Number.isFinite(admitted)||at<admitted||at>now.getTime())fail('lab-publication-unverified');
 return {url,publishedAt:new Date(at).toISOString()};
}
export async function labDeviceAction(body,{query,clock=()=>new Date(),find,tokenHash,seal,open,metadata,enabled=false}){
 if(!await ready(query))return {status:'schema-unavailable',pending:[]};
 const now=clock(),week=centralDate(now).week;
 const ticket=()=>{
  const d=open(body.ticket,{tokenHash,now,expectedVersion:3});
  labWeek(d.week);
  if(d.kind!=='lab'||!Number.isSafeInteger(d.revision)||d.revision<1||!WEEKLY_HASH.test(d.article_hash||'')||!WEEKLY_HASH.test(d.presentation_sha256||'')||d.placements.length!==0)fail('lab-invalid-snapshot');
  return d;
 };
 const due=async d=>{
  if(!enabled||d.week!==week)fail('lab-publication-disabled');
  const a=await approved(query,week,now);
  if(!a||a.revision!==d.revision||a.article_hash!==d.article_hash||a.presentation_sha256!==d.presentation_sha256)fail('lab-approval-changed');
  return a;
 };
 const bound=async d=>{
  const r=await receipt(query,d.week);
  if(!r||Number(r.revision)!==d.revision||r.article_hash!==d.article_hash||r.presentation_sha256!==d.presentation_sha256||r.snapshot_ticket_sha256!==hash(body.ticket)||r.image_sha256!==body.image_sha256)fail('lab-claim-mismatch');
  return r;
 };
 switch(body.action){
  case 'lab-status': {
   fields(body,['action']);
   const rows=(await query("SELECT week_key::text AS week,title,body,state,image_width,image_height FROM patreon_lab_runs WHERE state IN ('handoff','queued','review') AND admitted_at IS NOT NULL ORDER BY claimed_at LIMIT 20")).rows;
   return {status:'available',pending:rows.map(r=>({week:r.week,title:r.title,body:r.body,state:r.state,width:Number(r.image_width),height:Number(r.image_height)}))};
  }
  case 'lab-prepare': {
   fields(body,['action']);
   if(!enabled)return {status:'lab-disabled'};
   const old=await receipt(query,week);
   if(old)return {status:old.state==='verified'?'already-verified':'receipt-exists'};
   const a=await approved(query,week,now);
   if(!a)return {status:'lab-awaiting-approval'};
   if(await find(a.post.title))return {status:'unexpected-public-post'};
   const d={version:3,kind:'lab',tokenHash,expires:now.getTime()+20*60*1000,placements:[],week,revision:a.revision,article_hash:a.article_hash,presentation_sha256:a.presentation_sha256};
   return validateLabPrepared({status:'prepared',week,revision:a.revision,article_hash:a.article_hash,presentation_sha256:a.presentation_sha256,...a.post,ticket:seal(d)});
  }
  case 'lab-claim': {
   fields(body,['action','ticket','image_sha256','width','height']);
   const d=ticket(),a=await due(d),image=metadata(body);
   if(await receipt(query,week))return {status:'receipt-exists'};
   if(await find(a.post.title))return {status:'unexpected-public-post'};
   const r=await one(query,"INSERT INTO patreon_lab_runs(week_key,revision,article_hash,presentation_sha256,title,body,state,image_sha256,image_width,image_height,snapshot_ticket_sha256) SELECT i.week_key,i.revision,i.article_hash,$5,$6,$7,'claimed',$8,$9,$10,$11 FROM pack1_lab_issues i WHERE i.week_key=$1::date AND "+approvalWhere+" AND i.revision=$3 AND i.article_hash=$4 ON CONFLICT DO NOTHING RETURNING week_key",[week,now.toISOString(),d.revision,d.article_hash,d.presentation_sha256,a.post.title,a.post.body,image.hash,image.width,image.height,hash(body.ticket)]);
   return {status:r?'claimed':'receipt-exists'};
  }
  case 'lab-admit': {
   fields(body,['action','ticket','image_sha256']);
   const d=ticket(),a=await due(d),r=await bound(d);
   if(r.state!=='claimed'||r.title!==a.post.title||r.body!==a.post.body)fail('lab-claim-mismatch');
   if(await find(r.title))return {status:'unexpected-public-post'};
   const saved=await one(query,"UPDATE patreon_lab_runs r SET state='handoff',admitted_at=clock_timestamp() FROM pack1_lab_issues i WHERE r.week_key=$1::date AND i.week_key=r.week_key AND "+approvalWhere+" AND i.revision=$3 AND i.article_hash=$4 AND r.revision=i.revision AND r.article_hash=i.article_hash AND r.presentation_sha256=$5 AND r.snapshot_ticket_sha256=$6 AND r.image_sha256=$7 AND r.state='claimed' RETURNING r.week_key",[week,now.toISOString(),d.revision,d.article_hash,d.presentation_sha256,hash(body.ticket),body.image_sha256]);
   return {status:saved?'admitted':'identity-changed'};
  }
  case 'lab-queued':
  case 'lab-review': {
   fields(body,['action','ticket','image_sha256']);
   const d=ticket();await bound(d);
   const queued=body.action==='lab-queued';
   await query(queued?"UPDATE patreon_lab_runs SET state='queued' WHERE week_key=$1::date AND state='handoff' AND snapshot_ticket_sha256=$2":"UPDATE patreon_lab_runs SET state='review' WHERE week_key=$1::date AND state<>'verified' AND snapshot_ticket_sha256=$2",[d.week,hash(body.ticket)]);
   return {status:queued?'queued-awaiting-verification':'review-required'};
  }
  case 'lab-find': {
   fields(body,['action','week']);
   const r=await receipt(query,body.week);
   if(!pending(r))fail('lab-receipt-not-pending');
   const found=await find(r.title);
   return {found:found?{title:r.title,...publicReadback(found,r,clock())}:null};
  }
  case 'lab-finish': {
   fields(body,['action','week','url','publishedAt','visualVerified']);
   const r=await receipt(query,body.week);
   if(r?.state==='verified'){
    if(r.public_url===body.url&&new Date(r.published_at).toISOString()===body.publishedAt&&body.visualVerified===true)return {status:'already-verified'};
    fail('lab-publication-unverified');
   }
   if(!pending(r)||body.visualVerified!==true)fail('lab-publication-unverified');
   const found=publicReadback(await find(r.title),r,clock());
   if(found.url!==body.url||found.publishedAt!==body.publishedAt)fail('lab-publication-unverified');
   const done=await one(query,"UPDATE patreon_lab_runs SET state='verified',public_url=$2,published_at=$3::timestamptz,verified_at=clock_timestamp() WHERE week_key=$1::date AND state IN ('handoff','queued','review') AND admitted_at<=$3::timestamptz RETURNING week_key",[r.week,found.url,found.publishedAt]);
   if(!done)fail('lab-publication-unverified');
   return {status:'verified'};
  }
  default:fail('lab-invalid-request',400);
 }
}
