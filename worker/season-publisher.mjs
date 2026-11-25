// Extend the existing owner-paired Patreon endpoint with separate stable
// season receipts. No additional bearer, DB login, or provider credentials.
import {createHash} from 'node:crypto';
import {fetchSeasonColorGuide} from './season-outcome-source.mjs';
import {gameDateKey} from '../game-date.mjs';
import {collectSeasonResults,collectMidseasonGuide,readSeasonResultsDue,midseasonDue,guideGameOutcomes} from '../scripts/pack-one-season-editorial.mjs';
import {validDay,addDays,assertNamedPublicationTime} from '../scripts/pack-one-weekly-data.mjs';
import {validSeasonKey,uniquePlacements,validPublication,WEEKLY_HASH,validateSeasonPrepared} from '../weekly-patreon-contract.mjs';

const one=async(q,s,a=[])=>(await q(s,a)).rows[0]||null;
const object=v=>typeof v==='string'?JSON.parse(v):v;
const yes=v=>v===true||v==='t'||v==='true';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{weeklySafe:true,status});};
const hash=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
export const seasonEvidenceHash=({key,milestone,title,body,article})=>hash(canonical({key,milestone,title,body,article}));
const fields=(v,allowed)=>{if(!v||Object.keys(v).some(k=>!allowed.includes(k)))fail('season-invalid-request');};
const id=v=>typeof v==='string'&&/^[a-z0-9-]{1,120}$/.test(v);
const current=q=>one(q,'SELECT id,set_id,set_name,start_date::text,end_date::text FROM draft_run_seasons WHERE end_date IS NULL');
const config=q=>one(q,'SELECT results_enabled_from::text FROM patreon_season_config WHERE singleton');
const ready=async q=>yes((await one(q,"SELECT to_regclass('public.patreon_season_config') IS NOT NULL AND to_regclass('public.patreon_season_runs') IS NOT NULL AS ready"))?.ready);
const receipt=(q,key)=>one(q,'SELECT post_key,kind,season_id,milestone::text,evidence_sha256,title,body,state,image_sha256,image_width,image_height,snapshot_ticket_sha256,admitted_at,public_url,published_at FROM patreon_season_runs WHERE post_key=$1',[validSeasonKey(key)]);
const draft=(q,seasonId)=>one(q,'SELECT season_id,milestone::text,plan_revision,evidence_sha256,title,body,article,state,approved_at FROM patreon_midseason_drafts WHERE season_id=$1',[seasonId]);
const planRow=(q,seasonId)=>one(q,'SELECT season_id,next_set_id,next_start::text,reviewed_on::text,snapshot,revision,color_count,source_attempted_at FROM patreon_midseason_plans WHERE season_id=$1',[seasonId]);
const planValue=p=>({seasonId:p.season_id,nextSetId:p.next_set_id,nextStart:p.next_start,reviewedOn:p.reviewed_on,colorCount:Number(p.color_count||2)});
const pending=r=>r&&['handoff','queued','review'].includes(r.state)&&r.admitted_at;
const postReceipt=r=>({post_key:r.post_key,title:r.title,body:r.body,state:r.state,width:Number(r.image_width),height:Number(r.image_height)});
const planDuration=(start,end)=>(Date.parse(end+'T12:00:00Z')-Date.parse(start+'T12:00:00Z'))/86400000;
function reviewedPlan(current,body,today){
 if(!current||body.seasonId!==current.id||!id(body.nextSetId)||body.nextSetId===current.set_id)fail('season-plan-invalid');
 let next;
 try{next=validDay(body.nextStart);}catch{fail('season-plan-invalid');}
 const days=planDuration(current.start_date,next);
 if(days<14||days>180||today>addDays(current.start_date,Math.ceil(days/2)))fail('season-plan-invalid');
 if(![2,3].includes(body.colorCount??2))fail('season-plan-invalid');
 return {seasonId:current.id,nextSetId:body.nextSetId,nextStart:next,reviewedOn:today,colorCount:body.colorCount??2};
}

// Only the already-reviewed, checked-in guide snapshot on Pack One is fetched
// by default. An owner can register a newly reviewed source snapshot via Admin.
// No raw 17Lands player/game files, arbitrary URLs, redirects or scraping.
export async function loadReviewedGuide(setId,{fetchImpl=fetch}={}){
 if(!id(setId))return null;
 try{
  const r=await fetchImpl('https://packone.pro/sets/guides/data/'+setId+'.json',{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!r.ok||Number(r.headers.get('content-length')||0)>150000)return null;
  const s=await r.text();if(s.length>150000)return null;
  return JSON.parse(s);
 }catch{return null;}
}
function checkedDraft(d){
 if(!d)return null;
 const a=object(d.article),key='pack-one-season:guide:'+d.season_id;
 const actual=seasonEvidenceHash({key,milestone:d.milestone,title:d.title,body:d.body,article:a});
 if(actual!==d.evidence_sha256||a?.kind!=='midseason-guide')fail('season-draft-invalid',409);
 validateSeasonPrepared({post_key:key,title:d.title,body:d.body,article:a,ticket:'fixture-validation',evidence_sha256:actual});
 return {...d,article:a,key};
}
export async function seasonAdminAction(body,{query,clock=()=>new Date()}){
 if(!await ready(query))return {status:'schema-unavailable'};
 const now=clock(),today=gameDateKey(now),s=await current(query);
 switch(body.action){
  case 'season-admin-status': {
   fields(body,['action']);
   const cfg=await config(query),p=s?await planRow(query,s.id):null,d=s?checkedDraft(await draft(query,s.id)):null;
   const latest=(await query('SELECT post_key,kind,season_id,state,last_status,public_url FROM patreon_season_runs ORDER BY claimed_at DESC LIMIT 5')).rows;
   return {status:'available',resultsEnabledFrom:cfg?.results_enabled_from||null,current:s,
    plan:p?{...planValue(p),hasSnapshot:!!p.snapshot,sourceAttempted:!!p.source_attempted_at}:null,draft:d?{seasonId:d.season_id,hash:d.evidence_sha256,title:d.title,body:d.body,article:d.article,state:d.state}:null,latest};
  }
  case 'season-admin-results': {
   fields(body,['action','enabled','templateAndTriggerVerified']);
   if(typeof body.enabled!=='boolean'||body.enabled&&body.templateAndTriggerVerified!==true)fail('season-verification-required');
   if(body.enabled)await query("UPDATE patreon_season_config SET results_enabled_from=coalesce(results_enabled_from,(clock_timestamp() AT TIME ZONE 'America/Los_Angeles')::date) WHERE singleton");
   else await query('UPDATE patreon_season_config SET results_enabled_from=NULL WHERE singleton');
   return {status:body.enabled?'results-enabled':'results-disabled'};
  }
  case 'season-admin-plan': {
   fields(body,['action','seasonId','nextSetId','nextStart','colorCount']);
   const p=reviewedPlan(s,body,today),revision=hash(canonical(p));
   const saved=await one(query,"INSERT INTO patreon_midseason_plans(season_id,next_set_id,next_start,reviewed_on,revision,color_count) VALUES($1,$2,$3::date,$4::date,$5,$6) ON CONFLICT(season_id) DO UPDATE SET next_set_id=excluded.next_set_id,next_start=excluded.next_start,reviewed_on=excluded.reviewed_on,revision=excluded.revision,color_count=excluded.color_count,snapshot=NULL WHERE NOT EXISTS(SELECT 1 FROM patreon_midseason_drafts d WHERE d.season_id=excluded.season_id) RETURNING season_id",[p.seasonId,p.nextSetId,p.nextStart,p.reviewedOn,revision,p.colorCount]);
   if(!saved)fail('season-plan-frozen',409);
   return {status:'plan-saved'};
  }
  case 'season-admin-snapshot': {
   fields(body,['action','seasonId','snapshot']);
   if(!s||s.id!==body.seasonId||!body.snapshot||typeof body.snapshot!=='object')fail('season-snapshot-invalid');
   const p=await planRow(query,s.id);
   if(!p)fail('season-plan-required');
   const midpoint=addDays(s.start_date,Math.ceil(planDuration(s.start_date,p.next_start)/2));
   const gate={setId:s.set_id,start:s.start_date,end:addDays(midpoint,-1),milestone:midpoint};
   if(body.snapshot.sourceStatus||!guideGameOutcomes(body.snapshot,gate)||body.snapshot.results.colorCount!==Number(p.color_count||2)||String(body.snapshot.reviewedAt).slice(0,10)>today||String(body.snapshot.results.retrievedAt).slice(0,10)>today)fail('season-snapshot-invalid');
   // Retain only the validated aggregate fields; arbitrary owner input is not
   // included in the draft or leaked via the paired API.
   const {id:setId,reviewedAt,results}=body.snapshot;
   const snapshot={id:setId,reviewedAt,results:{format:results.format,userGroup:results.userGroup,period:results.period,splashes:results.splashes,colorCount:results.colorCount,retrievedAt:results.retrievedAt,sourceUrl:results.sourceUrl,rows:results.rows.map(x=>({colors:x.colors,wins:x.wins,games:x.games})),baseline:{wins:results.baseline.wins,games:results.baseline.games}}};
   const revision=hash(canonical({plan:planValue(p),snapshot}));
   const saved=await one(query,'UPDATE patreon_midseason_plans SET snapshot=$2::jsonb,revision=$3 WHERE season_id=$1 AND revision=$4 AND NOT EXISTS(SELECT 1 FROM patreon_midseason_drafts WHERE season_id=$1) RETURNING season_id',[s.id,JSON.stringify(snapshot),revision,p.revision]);
   if(!saved)fail('season-plan-frozen',409);
   return {status:'snapshot-saved'};
  }
  case 'season-admin-approve':
  case 'season-admin-reject': {
   fields(body,['action','seasonId','hash']);
   if(!s||s.id!==body.seasonId||!WEEKLY_HASH.test(body.hash||''))fail('season-draft-invalid');
   const d=checkedDraft(await draft(query,s.id));
   if(!d||d.state!=='draft'||d.evidence_sha256!==body.hash)fail('season-draft-changed',409);
   const approve=body.action==='season-admin-approve';
   const saved=await one(query,"UPDATE patreon_midseason_drafts d SET state=$3,approved_at=CASE WHEN $3='approved' THEN clock_timestamp() ELSE NULL END WHERE d.season_id=$1 AND d.evidence_sha256=$2 AND d.state='draft' AND EXISTS(SELECT 1 FROM draft_run_seasons s JOIN patreon_midseason_plans p ON p.season_id=s.id WHERE s.id=d.season_id AND s.end_date IS NULL AND p.revision=d.plan_revision) RETURNING d.season_id",[s.id,body.hash,approve?'approved':'rejected']);
   if(!saved)fail('season-draft-changed',409);
   return {status:approve?'guide-approved':'guide-rejected'};
  }
  default:fail('season-invalid-request');
 }
}
async function getApprovedOrDraft({query,now,loadGuide,collectGuide,fetchColorGuide}){
 const s=await current(query);
 if(!s)return {status:'outside-window'};
 const p=await planRow(query,s.id);
 if(!p)return {status:'outside-window'};
 const d=checkedDraft(await draft(query,s.id));
 if(d){
  if(d.plan_revision!==p.revision||d.state==='rejected')return {status:'outside-window'};
  if(d.state==='draft')return {status:'guide-draft-awaiting-approval'};
  return {snapshot:{key:d.key,title:d.title,body:d.body,article:d.article,placements:[],
   gate:{seasonId:s.id,kind:'midseason-guide',milestone:d.milestone},evidence:d.evidence_sha256}};
 }
 const plan=planValue(p),gate=midseasonDue(s,plan,now,{enabledFrom:p.reviewed_on});
 if(!gate)return {status:'outside-window'};
 let guide=p.snapshot?object(p.snapshot):null;
 // Prefer an already reviewed, sufficiently recent snapshot. If absent,
 // attempt the public aggregate endpoint once, across all paired devices.
 if(!guideGameOutcomes(guide,gate)){
  if(p.source_attempted_at)return {status:'guide-evidence-unavailable'};
  const claim=await one(query,"UPDATE patreon_midseason_plans SET source_attempted_at=clock_timestamp() WHERE season_id=$1 AND revision=$2 AND source_attempted_at IS NULL RETURNING season_id",[s.id,p.revision]);
  if(!claim)return {status:'guide-evidence-unavailable'};
  guide=await loadGuide(s.set_id);
  if(!guideGameOutcomes(guide,gate)||guide.results.colorCount!==plan.colorCount)guide=await fetchColorGuide(gate,{colorCount:plan.colorCount});
 }
 if(!guideGameOutcomes(guide,gate))return {status:'guide-evidence-unavailable'};
 // An automated snapshot is frozen together with the decision evidence. It
 // can never publish until the owner approves the exact draft hash.
 const snapshot=await collectGuide(query,{now,plan,enabledFrom:p.reviewed_on,guide});
 if(!snapshot)return {status:'guide-evidence-unavailable'};
 const evidence=seasonEvidenceHash({...snapshot,milestone:gate.milestone});
 await query("INSERT INTO patreon_midseason_drafts(season_id,milestone,plan_revision,evidence_sha256,title,body,article) SELECT $1,$2::date,$3,$4,$5,$6,$7::jsonb FROM patreon_midseason_plans p JOIN draft_run_seasons s ON s.id=p.season_id WHERE p.season_id=$1 AND p.revision=$3 AND s.end_date IS NULL ON CONFLICT(season_id) DO NOTHING",[s.id,gate.milestone,p.revision,evidence,snapshot.title,snapshot.body,JSON.stringify(snapshot.article)]);
 return {status:'guide-draft-awaiting-approval'};
}
export async function seasonDeviceAction(body,{query,clock=()=>new Date(),find,tokenHash,seal,open,metadata,collectResults=collectSeasonResults,collectGuide=collectMidseasonGuide,loadGuide=loadReviewedGuide,fetchColorGuide=fetchSeasonColorGuide}){
 if(!await ready(query))return {status:'schema-unavailable',pending:[]};
 const now=clock();
 const ticket=()=>{
  const d=open(body.ticket,{tokenHash,now,expectedVersion:2});
  validSeasonKey(d.postKey);
  if(!id(d.seasonId)||!['season-results','midseason-guide'].includes(d.kind)||!WEEKLY_HASH.test(d.evidence||'')||!d.title||!d.body||d.placements.length>2000)fail('invalid-snapshot',409);
  return d;
 };
 const bound=async d=>{
  const r=await receipt(query,d.postKey);
  if(!r||r.snapshot_ticket_sha256!==hash(body.ticket)||r.image_sha256!==body.image_sha256||r.evidence_sha256!==d.evidence)fail('claim-mismatch',409);
  return r;
 };
 switch(body.action){
  case 'season-status': {
   fields(body,['action']);
   const rows=(await query("SELECT post_key,title,body,state,image_width,image_height FROM patreon_season_runs WHERE state IN ('handoff','queued','review') AND admitted_at IS NOT NULL ORDER BY claimed_at LIMIT 20")).rows;
   return {status:'available',pending:rows.map(postReceipt)};
  }
  case 'season-prepare': {
   fields(body,['action']);
   const cfg=await config(query);
   let snapshot=null;
   const gate=cfg?.results_enabled_from?await readSeasonResultsDue(query,now,{enabledFrom:cfg.results_enabled_from}):null;
   if(gate&&!await receipt(query,gate.key)){
    await assertNamedPublicationTime(query,now);
    snapshot=await collectResults(query,{now,enabledFrom:cfg.results_enabled_from});
   }
   if(!snapshot){
    const result=await getApprovedOrDraft({query,now,loadGuide,collectGuide,fetchColorGuide});
    if(!result.snapshot)return result;
    snapshot=result.snapshot;
   }
   const existing=await receipt(query,snapshot.key);
   if(existing)return {status:existing.state==='verified'?'already-verified':'receipt-exists'};
   await assertNamedPublicationTime(query,now);
   if(await find(snapshot.title))return {status:'unexpected-public-post'};
   const evidence=snapshot.evidence||seasonEvidenceHash({...snapshot,milestone:snapshot.gate.milestone});
   const placements=uniquePlacements(snapshot.placements);
   const d={version:2,tokenHash,expires:now.getTime()+20*60*1000,postKey:snapshot.key,seasonId:snapshot.gate.seasonId,kind:snapshot.gate.kind,milestone:snapshot.gate.milestone,evidence,title:snapshot.title,body:snapshot.body,placements};
   return validateSeasonPrepared({status:'prepared',post_key:snapshot.key,title:d.title,body:d.body,article:snapshot.article,evidence_sha256:evidence,ticket:seal(d)});
  }
  case 'season-claim': {
   fields(body,['action','ticket','image_sha256','width','height']);
   const d=ticket(),image=metadata(body);
   await assertNamedPublicationTime(query,now);
   if(await receipt(query,d.postKey))return {status:'receipt-exists'};
   if(await find(d.title))return {status:'unexpected-public-post'};
   const r=await one(query,"INSERT INTO patreon_season_runs(post_key,kind,season_id,milestone,evidence_sha256,title,body,state,image_sha256,image_width,image_height,snapshot_ticket_sha256) VALUES($1,$2,$3,$4::date,$5,$6,$7,'claimed',$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING post_key",[d.postKey,d.kind,d.seasonId,d.milestone,d.evidence,d.title,d.body,image.hash,image.width,image.height,hash(body.ticket)]);
   return {status:r?'claimed':'receipt-exists'};
  }
  case 'season-admit': {
   fields(body,['action','ticket','image_sha256']);
   const d=ticket(),r=await bound(d);
   if(r.state!=='claimed')fail('claim-mismatch',409);
   if(await find(r.title))return {status:'unexpected-public-post'};
   const result=await one(query,'SELECT pack1_patreon_season_admit($1,$2::jsonb) ok',[d.postKey,JSON.stringify(d.placements)]);
   return {status:yes(result?.ok)?'admitted':'identity-changed'};
  }
  case 'season-queued':
  case 'season-review': {
   fields(body,['action','ticket','image_sha256']);
   const d=ticket();await bound(d);
   if(body.action==='season-queued')await query("UPDATE patreon_season_runs SET state='queued',last_status='queued' WHERE post_key=$1 AND state='handoff' AND snapshot_ticket_sha256=$2",[d.postKey,hash(body.ticket)]);
   else await query("UPDATE patreon_season_runs SET state='review',last_status='review-required' WHERE post_key=$1 AND state<>'verified' AND snapshot_ticket_sha256=$2",[d.postKey,hash(body.ticket)]);
   return {status:body.action==='season-queued'?'queued-awaiting-verification':'review-required'};
  }
  case 'season-find': {
   fields(body,['action','post_key']);
   const r=await receipt(query,body.post_key);
   if(!pending(r))fail('receipt-not-pending',409);
   const found=await find(r.title);
   return {found:found?{title:r.title,...validPublication(found,r,clock())}:null};
  }
  case 'season-finish': {
   fields(body,['action','post_key','url','publishedAt','visualVerified']);
   const r=await receipt(query,body.post_key);
   if(r?.state==='verified')return {status:'already-verified'};
   if(!pending(r)||body.visualVerified!==true)fail('receipt-not-verified',409);
   const found=validPublication(await find(r.title),r,clock());
   if(found.url!==body.url||found.publishedAt!==body.publishedAt)fail('receipt-not-verified',409);
   const done=await one(query,'SELECT pack1_patreon_season_finish($1,$2,$3::timestamptz) ok',[r.post_key,found.url,found.publishedAt]);
   if(!yes(done?.ok))fail('receipt-not-verified',409);
   return {status:'verified'};
  }
  default:fail('season-invalid-request');
 }
}
