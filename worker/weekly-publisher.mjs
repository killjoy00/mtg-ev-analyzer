// Owner-paired private recap API. The desktop gets only the presentation
// snapshot, an encrypted short-lived receipt ticket and public post metadata.
// Account IDs, privacy preferences, database credentials and Patreon read
// credentials stay server-side. No public feed or client-selected SQL.
import {createHash,createHmac,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {collectWeeklyRecap,weeklyDue,assertNamedPublicationTime} from '../scripts/pack-one-weekly-data.mjs';
import {findPublishedPatreonPost} from '../patreon-post-read.mjs';
import {WEEKLY_PATH,ADMIN_WEEKLY_PATH,WEEKLY_TOKEN,WEEKLY_HASH,validWeekEnd,recapTitle,recapBody,uniquePlacements,validPublication} from '../weekly-patreon-contract.mjs';

const one=async(q,sql,args=[])=>(await q(sql,args)).rows[0]||null;
const yes=value=>value===true||value==='t'||value==='true';
const digest=value=>createHash('sha256').update(value).digest('hex');
const error=(code,status=400)=>Object.assign(Error(code),{weeklySafe:true,status});
const safe=(code,status)=>{throw error(code,status);};
const TTL=20*60*1000;
const MAX_TICKET=90000;
const AAD=Buffer.from('packone-weekly-snapshot-v1');
const key=env=>{
 const value=String(env.PACK1_RATE_LIMIT_SECRET||'');
 if(value.length<32)safe('publisher-unavailable',503);
 return createHmac('sha256',value).update(AAD).digest();
};
function configured(env){return String(env.PACKONE_WEEKLY_PATREON_READ_TOKEN||'').length>=20&&String(env.PACK1_RATE_LIMIT_SECRET||'').length>=32;}
export function sealSnapshot(data,env){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(env),iv);
 cipher.setAAD(AAD);
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);
 const token=Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
 if(token.length>MAX_TICKET)safe('snapshot-too-large',409);
 return token;
}
export function openSnapshot(token,env,{tokenHash,now=new Date()}){
 if(typeof token!=='string'||token.length>MAX_TICKET||!/^[A-Za-z0-9_-]{40,}$/.test(token))safe('invalid-snapshot',409);
 try{
  const raw=Buffer.from(token,'base64url');
  const decipher=createDecipheriv('aes-256-gcm',key(env),raw.subarray(0,12));
  decipher.setAAD(AAD);decipher.setAuthTag(raw.subarray(12,28));
  const data=JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString('utf8'));
  if(data.version!==1||data.tokenHash!==tokenHash||!Number.isFinite(data.expires)||data.expires<=now.getTime()||!Array.isArray(data.placements))throw Error();
  validWeekEnd(data.end);
  // Ticket integrity authenticates exact server-generated names and placement IDs.
  if(data.placements.length>2000)throw Error();
  return data;
 }catch{safe('invalid-snapshot',409);}
}
const fields=(value,allowed)=>{
 if(!value||Object.keys(value).some(k=>!allowed.includes(k)))safe('invalid-request',400);
};
const rowFor=(q,end)=>one(q,'SELECT week_end::text,title,state,image_sha256,image_width,image_height,admitted_at,public_url,published_at,snapshot_ticket_sha256 FROM patreon_weekly_runs WHERE week_end=$1::date',[validWeekEnd(end)]);
const pending=run=>run&&['handoff','queued','review'].includes(run.state)&&run.admitted_at;
const publicReceipt=run=>({week_end:run.week_end,title:run.title,state:run.state,body:recapBody(run.week_end),width:Number(run.image_width),height:Number(run.image_height)});
async function assertOwner(query,authAdmin,request,mutation){
 const auth=await authAdmin(request,{mutation});
 if(!auth?.user_id||!await one(query,"SELECT 1 FROM pack1_admins WHERE auth_user_id=$1::uuid AND role='owner'",[auth.user_id]))safe('owner-required',403);
 return auth.user_id;
}
async function pairAdmin(request,{query,authAdmin,readJson,env,find}){
 const owner=await assertOwner(query,authAdmin,request,request.method!=='GET');
 if(request.method==='GET'){
  const pairing=await one(query,'SELECT paired_at FROM patreon_weekly_publisher_pairing WHERE singleton');
  const latest=await one(query,'SELECT week_end::text,state,last_status,public_url FROM patreon_weekly_runs ORDER BY week_end DESC LIMIT 1');
  return {configured:configured(env),paired:!!pairing,pairedAt:pairing?.paired_at||null,latest};
 }
 if(request.method!=='POST')safe('not-found',404);
 const body=await readJson(request);
 fields(body,['action','noticeConfirmed']);
 if(body.action==='revoke'){
  await query('DELETE FROM patreon_weekly_publisher_pairing WHERE singleton');
  return {paired:false};
 }
 if(body.action!=='pair'||body.noticeConfirmed!==true)safe('notice-confirmation-required',400);
 if(!configured(env))safe('publisher-unavailable',503);
 await find('Pack One Weekly configuration check (no publication)');
 const token='p1w_'+randomBytes(32).toString('base64url');
 await query("INSERT INTO patreon_weekly_publisher_pairing(singleton,owner_auth_id,token_sha256,notice_confirmed_at) VALUES(true,$1::uuid,$2,clock_timestamp()) ON CONFLICT(singleton) DO UPDATE SET owner_auth_id=excluded.owner_auth_id,token_sha256=excluded.token_sha256,paired_at=clock_timestamp(),notice_confirmed_at=excluded.notice_confirmed_at",[owner,digest(token)]);
 // Returned once to the authenticated owner; never stored in cleartext.
 return {paired:true,pairingCode:token};
}
async function authenticate(request,query){
 // No browser cookies or player token are accepted as a publisher identity.
 const raw=request.headers.get('authorization')||'';
 if(request.headers.has('origin')||request.headers.has('cookie')||!raw.startsWith('Bearer ')||!WEEKLY_TOKEN.test(raw.slice(7)))safe('pairing-required',401);
 const tokenHash=digest(raw.slice(7));
 const pair=await one(query,"SELECT 1 FROM patreon_weekly_publisher_pairing p JOIN pack1_admins a ON a.auth_user_id=p.owner_auth_id AND a.role='owner' WHERE p.singleton AND p.token_sha256=$1 AND p.notice_confirmed_at IS NOT NULL",[tokenHash]);
 if(!pair)safe('pairing-required',401);
 return tokenHash;
}
function due(now){
 const gate=weeklyDue(now);
 if(!gate)safe('outside-window',409);
 return gate;
}
function metadata(body){
 const width=body.width,height=body.height;
 if(!WEEKLY_HASH.test(body.image_sha256||'')||!Number.isInteger(width)||width<100||width>4000||!Number.isInteger(height)||height<100||height>30000)safe('invalid-image',400);
 return {width,height,hash:body.image_sha256};
}
async function device(request,{query,readJson,env,find,clock,collect}){
 if(request.method!=='POST')safe('not-found',404);
 const tokenHash=await authenticate(request,query);
 if(!configured(env))safe('publisher-unavailable',503);
 const body=await readJson(request);
 const now=clock();
 switch(body.action){
  case 'check':
   fields(body,['action']);
   await query('SELECT week_end,state FROM patreon_weekly_runs LIMIT 0');
   await find('Pack One Weekly configuration check (no publication)');
   return {status:'connections-verified'};
  case 'status': {
   fields(body,['action']);
   const rows=(await query("SELECT week_end::text,title,state,image_width,image_height,admitted_at FROM patreon_weekly_runs WHERE state IN ('handoff','queued','review') AND admitted_at IS NOT NULL ORDER BY week_end LIMIT 20")).rows;
   return {pending:rows.map(publicReceipt)};
  }
  case 'prepare': {
   fields(body,['action']);
   const gate=weeklyDue(now);
   if(!gate)return {status:'outside-window'};
   const existing=await rowFor(query,gate.end);
   if(existing)return {status:existing.state==='verified'?'already-verified':'receipt-exists'};
   await assertNamedPublicationTime(query,now);
   const title=recapTitle(gate.end);
   if(await find(title))return {status:'unexpected-public-post'};
   const snapshot=await collect(query,gate,{now});
   const placements=uniquePlacements(snapshot.placements);
   const ticket=sealSnapshot({version:1,tokenHash,end:gate.end,expires:now.getTime()+TTL,placements},env);
   return {status:'prepared',week_end:gate.end,title,body:recapBody(gate.end),article:snapshot.article,ticket};
  }
  case 'claim': {
   fields(body,['action','ticket','image_sha256','width','height']);
   const data=openSnapshot(body.ticket,env,{tokenHash,now}),gate=due(now),image=metadata(body);
   if(gate.end!==data.end)safe('outside-window',409);
   await assertNamedPublicationTime(query,now);
   if(await rowFor(query,data.end))return {status:'receipt-exists'};
   if(await find(recapTitle(data.end)))return {status:'unexpected-public-post'};
   const row=await one(query,"INSERT INTO patreon_weekly_runs(week_end,title,state,image_sha256,image_width,image_height,snapshot_ticket_sha256) VALUES($1::date,$2,'claimed',$3,$4,$5,$6) ON CONFLICT(week_end) DO NOTHING RETURNING week_end::text",[data.end,recapTitle(data.end),image.hash,image.width,image.height,digest(body.ticket)]);
   return {status:row?'claimed':'receipt-exists'};
  }
  case 'admit': {
   fields(body,['action','ticket','image_sha256']);
   const data=openSnapshot(body.ticket,env,{tokenHash,now}),gate=due(now),run=await rowFor(query,data.end);
   if(gate.end!==data.end||!run||run.state!=='claimed'||run.snapshot_ticket_sha256!==digest(body.ticket)||run.image_sha256!==body.image_sha256)safe('claim-mismatch',409);
   if(await find(run.title))return {status:'unexpected-public-post'};
   const result=await one(query,'SELECT pack1_patreon_weekly_admit($1::date,$2::jsonb) ok',[data.end,JSON.stringify(data.placements)]);
   return {status:yes(result?.ok)?'admitted':'identity-changed'};
  }
  case 'queued':
  case 'review': {
   fields(body,['action','ticket','image_sha256']);
   const data=openSnapshot(body.ticket,env,{tokenHash,now});
   const run=await rowFor(query,data.end);
   if(!run||run.snapshot_ticket_sha256!==digest(body.ticket)||run.image_sha256!==body.image_sha256)safe('claim-mismatch',409);
   if(body.action==='queued')await query("UPDATE patreon_weekly_runs SET state='queued',last_status='queued' WHERE week_end=$1::date AND state='handoff' AND snapshot_ticket_sha256=$2",[data.end,digest(body.ticket)]);
   else await query("UPDATE patreon_weekly_runs SET state='review',last_status='review-required' WHERE week_end=$1::date AND state<>'verified' AND snapshot_ticket_sha256=$2",[data.end,digest(body.ticket)]);
   return {status:body.action==='queued'?'queued-awaiting-verification':'review-required'};
  }
  case 'find': {
   fields(body,['action','week_end']);
   const run=await rowFor(query,body.week_end);
   if(!pending(run))safe('receipt-not-pending',409);
   const found=await find(run.title);
   return {found:found?{title:run.title,...validPublication(found,run,clock())}:null};
  }
  case 'finish': {
   fields(body,['action','week_end','url','publishedAt','visualVerified']);
   const run=await rowFor(query,body.week_end);
   if(run?.state==='verified')return {status:'already-verified'};
   if(!pending(run)||body.visualVerified!==true)safe('receipt-not-verified',409);
   // The provider's supported API, not the local caller, supplies canonical
   // URL and timestamp. The paired local Chromium verifies public appearance.
   const found=validPublication(await find(run.title),run,clock());
   if(found.url!==body.url||found.publishedAt!==body.publishedAt)safe('receipt-not-verified',409);
   const done=await one(query,'SELECT pack1_patreon_weekly_finish($1::date,$2,$3::timestamptz) ok',[run.week_end,found.url,found.publishedAt]);
   if(!yes(done?.ok))safe('receipt-not-verified',409);
   return {status:'verified'};
  }
  default:safe('invalid-request',400);
 }
}
export async function weeklyPublisherRoute(request,{query,json,readJson,authAdmin,env=process.env,clock=()=>new Date(),collect=collectWeeklyRecap,find=title=>findPublishedPatreonPost({title,token:env.PACKONE_WEEKLY_PATREON_READ_TOKEN,includePublishedAt:true})}){
 const path=new URL(request.url).pathname;
 try{
  const deps={query,readJson,authAdmin,env,clock,collect,find};
  if(path===ADMIN_WEEKLY_PATH)return json(await pairAdmin(request,deps));
  if(path===WEEKLY_PATH)return json(await device(request,deps));
  return json({error:'not-found'},404);
 }catch(e){
  // Never emit or log exception bodies, token strings, ticket contents,
  // provider payloads, player names or SQL parameters.
  const status=e?.weeklySafe?e.status:[401,403,413,415].includes(e?.status)?e.status:503;
  return json({error:e?.weeklySafe?e.message:'weekly-publisher-unavailable'},status);
 }
}
