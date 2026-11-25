// Durable, read-only aggregate social plans are frozen before either platform
// is allowed to publish. GitHub bot receipts bind each slot to a source puzzle
// and content hash. Full plans stay in workflow cache/artifacts; the public
// ledger never contains the vote tally, player details, or credentials.
import {createHash} from 'node:crypto';
import {checkedFeatureDay,previousPacificDay,pacificDay,featuredBlueskyRkey} from './featured-pick.mjs';
import {debateQuestionRkey,debateFacets,debateLink,REVEAL_DELAY_HOURS,graphemes,assertDebatable} from './featured-debate.mjs';
import {EDITORIAL_VERSION,editorialPlan,fetchOracleMetadata} from './social-editorial.mjs';
import {selectSocialDecision} from './social-motion-selection.mjs';
import {createGithubReceiptLedger,discordReceiptKey,createFormatMarkers,FORMAT_MARKERS} from './daily-social-ledger.mjs';
import {blueskySession,getPost,uploadImage,publishPost,publicPostCounts} from './bluesky-records.mjs';
import {featuredYoutubeMetadata,FEATURED_YOUTUBE_RECEIPT} from './publish-featured-pick.mjs';
import {youtubeAccessToken,uploadVideo} from './upload-daily-short.mjs';
import {assertFeaturedMorning,featureDbRows} from './generate-featured-pick.mjs';
import {assertCurrentLivePublisher} from './post-daily-social.mjs';
import {readFile,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const REPO='killjoy00/mtg-ev-analyzer';
export const MOTION_CACHE='artifacts/social-motion-cache';
export const MOTION_OUT='artifacts/social-motion-daily';
export const MOTION_START_DAY='2026-11-26';
const HISTORY_DAYS=30;
const keyPrefix='packone-motion-plan-v1:';
const dayAgo=(day,n)=>new Date(Date.parse(checkedFeatureDay(day)+'T12:00:00Z')-n*86400000).toISOString().slice(0,10);
const hash=x=>createHash('sha256').update(x).digest('hex');
export const motionHash=data=>hash(JSON.stringify(data));
export const motionEnabled=(env,day)=>env.SOCIAL_MOTION_ACTIVE==='true'&&day>=MOTION_START_DAY;
export const motionRevealDays=(now=new Date())=>Array.from({length:3},(_,n)=>dayAgo(pacificDay(now),n));
export const anchorDay=day=>dayAgo(day,1);
export function motionRkey(day,reveal=false){
 // Independent question/reply keys; old pending replies keep their old keys.
 let n=(BigInt(Date.parse(checkedFeatureDay(day)+'T'+(reveal?'15:26:00':'15:24:00')+'Z'))*1000n<<10n)|49n;
 let s='',a='234567abcdefghijklmnopqrstuvwxyz';
 for(let i=0;i<13;i++){s=a[Number(n&31n)]+s;n>>=5n;}
 if(n!==0n)throw Error('Invalid motion post key');
 return s;
}
export function verifyFrozen(data,day){
 checkedFeatureDay(day);
 const {feature:f,plan:p,oracle}=data||{};
 if(!f||!p||!oracle||data.publication_day!==day||f.publication_day!==day||
    f.day>=day||f.day<dayAgo(day,7)||p.version!==EDITORIAL_VERSION||
    p.day!==f.day||p.puzzle_id!==f.puzzle_id||f.model_alignment<.20||
    !Number.isFinite(f.model_alignment)||p.coverage?.total!==f.tier)
  throw Error('Invalid frozen motion plan');
 assertDebatable(f);
 if(JSON.stringify(p)!==JSON.stringify(editorialPlan(f,oracle)))
  throw Error('Frozen motion editorial plan does not match evidence');
 return data;
}
export function receiptRecord(data){
 const f=data.feature;
 return {day:data.publication_day,source_day:f.day,puzzle_id:f.puzzle_id,digest:motionHash(data)};
}
export function parseMotionReceipt(comment){
 if(comment?.user?.login!=='github-actions[bot]'||typeof comment.body!=='string'||!comment.body.startsWith(keyPrefix))return null;
 const line=comment.body.split('\n')[0];
 const m=line.match(/^packone-motion-plan-v1:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2}):([a-zA-Z0-9_-]{1,160}):([a-f0-9]{64})$/);
 if(!m)throw Error('Malformed trusted motion reservation');
 checkedFeatureDay(m[1]);checkedFeatureDay(m[2]);
 if(m[2]>=m[1]||m[2]<dayAgo(m[1],7))throw Error('Invalid motion reservation source');
 return {day:m[1],source_day:m[2],puzzle_id:m[3],digest:m[4]};
}
export function motionLedger({token,repo=REPO,fetcher=fetch}){
 if(repo!==REPO||!token)throw Error('Motion receipt ledger unavailable');
 const root='https://api.github.com/repos/'+repo+'/issues/1135/comments';
 async function api(url,body){
  const r=await fetcher(url,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('Motion ledger HTTP '+r.status);
  return r.json();
 }
 return {
  async list(day){
   const rows=[];
   for(let page=1;page<=20;page++){
    const batch=await api(root+'?since='+encodeURIComponent(dayAgo(day,HISTORY_DAYS)+'T00:00:00Z')+'&per_page=100&page='+page);
    if(!Array.isArray(batch))throw Error('Invalid motion ledger page');
    for(const c of batch){const item=parseMotionReceipt(c);if(item)rows.push(item);}
    if(batch.length<100){
     const map=new Map();
     for(const x of rows){
      const prior=map.get(x.day);
      if(prior&&JSON.stringify(prior)!==JSON.stringify(x))throw Error('Conflicting motion reservations');
      map.set(x.day,x);
     }
     return [...map.values()];
    }
   }
   throw Error('Motion ledger pagination safety limit');
  },
  async reserve(data){
   const wanted=receiptRecord(data),rows=await this.list(wanted.day);
   const found=rows.find(x=>x.day===wanted.day);
   if(found){
    if(JSON.stringify(found)!==JSON.stringify(wanted))throw Error('Motion slot already reserved for a different decision');
    return found;
   }
   if(rows.some(x=>x.puzzle_id===wanted.puzzle_id))throw Error('Motion puzzle has already been reserved');
   const c=await api(root,{body:keyPrefix+[wanted.day,wanted.source_day,wanted.puzzle_id,wanted.digest].join(':')+'\nNon-secret closed-Daily identity and frozen plan hash; no voting results.'});
   if(!Number.isSafeInteger(c?.id))throw Error('Motion reservation not acknowledged');
   return wanted;
  }
 };
}
export async function readFrozen(day,{read=readFile,dir=MOTION_CACHE}={}){
 let raw;
 try{raw=await read(dir+'/'+day+'/plan.json','utf8');}
 catch(e){if(e.code==='ENOENT')return null;throw e;}
 return verifyFrozen(JSON.parse(raw),day);
}
const assertReservation=(data,reservation)=>{
 if(!reservation||JSON.stringify(receiptRecord(data))!==JSON.stringify(reservation))throw Error('Motion frozen plan differs from durable reservation');
};
const result=(f,p)=>({feature:f,plan:p,publication_day:f.publication_day});
export async function prepareMotion({env=process.env,now=new Date(),fetcher=fetch,read=readFile,rowsFor=featureDbRows,ledger=null}={}){
 const day=pacificDay(now);
 if(!motionEnabled(env,day))return {selected:false,reason:'motion not enabled'};
 if(env.GITHUB_EVENT_NAME!=='schedule'&&env.MANUAL_LIVE!=='true')throw Error('Motion preparation is live-scheduler only');
 const gate=await assertFeaturedMorning({env,now,fetcher});
 if(!gate.eligible)return {selected:false,reason:gate.reason};
 ledger??=motionLedger({token:env.GITHUB_TOKEN,fetcher});
 const reservations=await ledger.list(day);
 const existing=reservations.find(x=>x.day===day);
 const frozen=await readFrozen(day,{read});
 if(frozen){
  if(existing)assertReservation(frozen,existing);
  if(reservations.some(x=>x.day!==day&&x.puzzle_id===frozen.feature.puzzle_id))throw Error('Cached motion puzzle already used');
  return {selected:true,cached:true,data:frozen};
 }
 if(existing)throw Error('Reserved motion plan cache missing; refuse to select a different draft');
 const usedPuzzleIds=new Set(reservations.map(x=>x.puzzle_id));
 // At cutover never backfill a source date from the old format. After the
 // first new slot, only consider unused closed days since that slot.
 const first=reservations.filter(x=>x.day<day).map(x=>x.source_day).sort()[0]||gate.day;
 let f=null;
 for(let age=1;age<=7&&!f;age++){
  const sourceDay=dayAgo(day,age);
  if(sourceDay<first)break;
  const rows=await rowsFor(sourceDay,{apiKey:env.NEON_API_KEY,fetcher});
  f=selectSocialDecision([{day:sourceDay,rows}],{publicationDay:day,usedPuzzleIds});
 }
 if(!f)return {selected:false,reason:'no unused qualifying closed Daily'};
 const oracle=await fetchOracleMetadata(f.choices,{fetcher});
 // Retain only matching exact card facts, not the API's unrelated metadata.
 const minimal=Object.fromEntries(Object.entries(oracle).map(([id,c])=>[id,{id:c.id,name:c.name,mana_cost:c.mana_cost,oracle_text:c.oracle_text,
  ...(Array.isArray(c.card_faces)?{card_faces:c.card_faces.map(v=>({name:v.name,mana_cost:v.mana_cost,oracle_text:v.oracle_text}))}:{})}]));
 const p=editorialPlan(f,minimal);
 const data=verifyFrozen({...result(f,p),oracle:minimal},day);
 return {selected:true,cached:false,data};
}
export function verifyMotionMedia(data,manifest,{day}={}){
 verifyFrozen(data,day);
 if(manifest.day!==data.feature.day||manifest.puzzle_id!==data.feature.puzzle_id||manifest.template!==data.plan.version||
    manifest.seconds!==(data.feature.tier===3?34:30)||manifest.width!==1080||manifest.height!==1920||
    manifest.frames_per_second!==30||manifest.real_card_art!==true||manifest.choices!==data.feature.tier||
    manifest.question_image?.width!==1200||manifest.question_image?.height!==1500||manifest.question_image?.shows_results!==false||
    manifest.question_image?.bytes>1_000_000||manifest.audio?.narration!==false||manifest.audio?.original!==true)
  throw Error('Motion media manifest failed provenance checks');
 return true;
}
export async function postMotionQuestion(fetcher,session,data,image){
 const day=data.publication_day,anchor=anchorDay(day);
 if(await getPost(fetcher,session,featuredBlueskyRkey(anchor))||await getPost(fetcher,session,debateQuestionRkey(anchor)))
  return {status:'skipped',reason:'legacy question already occupies this day'};
 const p=data.plan;
 return publishPost(fetcher,session,{rkey:motionRkey(day),record:{text:p.morning,facets:debateFacets(p.morning),langs:['en']},
  prepare:async()=>({embed:{$type:'app.bsky.embed.images',images:[{alt:p.alt,image:await uploadImage(fetcher,session,{bytes:image,type:'image/jpeg'}),aspectRatio:{width:1200,height:1500}}]}})});
}
export async function revealMotionQuestion(fetcher,session,data,{now=new Date()}={}){
 const day=data.publication_day,p=data.plan;
 const q=await getPost(fetcher,session,motionRkey(day));
 if(!q)return {status:'skipped',reason:'no question'};
 if(q.value?.text!==p.morning)throw Error('Motion question does not match frozen decision');
 const asked=Date.parse(q.value?.createdAt);
 if(!Number.isFinite(asked))throw Error('Motion question lacks a valid timestamp');
 if(now.getTime()-asked<REVEAL_DELAY_HOURS*3600000)return {status:'skipped',reason:'too soon'};
 const ref={uri:q.uri,cid:q.cid};
 return publishPost(fetcher,session,{rkey:motionRkey(day,true),record:{text:p.reply,facets:debateFacets(p.reply,{url:debateLink('bluesky')}),langs:['en'],reply:{root:ref,parent:ref}}});
}
async function checkLive(env,now,fetcher){
 if(env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_REPOSITORY!==REPO||
    !(env.GITHUB_EVENT_NAME==='schedule'||env.MANUAL_LIVE==='true'))throw Error('Motion posting requires current main and a live trigger');
 if(env.SOURCE_PACIFIC_DAY&&env.SOURCE_PACIFIC_DAY!==pacificDay(now))throw Error('Stale motion dispatch');
 await assertCurrentLivePublisher({env,fetchImpl:fetcher});
}
export async function publishMotion({env=process.env,now=new Date(),fetcher=fetch,read=readFile}={}){
 const day=pacificDay(now);
 if(!motionEnabled(env,day))return {skipped:true,reason:'disabled'};
 await checkLive(env,now,fetcher);
 const data=await readFrozen(day,{read});
 if(!data)throw Error('Frozen motion cache missing');
 const manifest=JSON.parse(await read(MOTION_OUT+'/render.json','utf8'));
 verifyMotionMedia(data,manifest,{day});
 const image=new Uint8Array(await read(MOTION_OUT+'/bluesky.jpg')),video=new Uint8Array(await read(MOTION_OUT+'/short.mp4'));
 const renderedPlan=JSON.parse(await read(MOTION_OUT+'/editorial.json','utf8'));
 if(image.length!==manifest.question_image.bytes||video.length<100000||motionHash(renderedPlan)!==motionHash(data.plan))
  throw Error('Rendered motion artifacts do not match the frozen plan');
 const ledger=motionLedger({token:env.GITHUB_TOKEN,fetcher});
 await ledger.reserve(data);
 const markers=createFormatMarkers({token:env.GITHUB_TOKEN,repo:REPO,fetchImpl:fetcher});
 const receipts=createGithubReceiptLedger({token:env.GITHUB_TOKEN,repo:REPO,issueNumber:1135,fetchImpl:fetcher});
 const done=[],errors=[];
 const redact=e=>String(e.message||'failed').replace(/https?:\/\/\S+/g,'[redacted]');
 const handle=env.BLUESKY_HANDLE,password=env.BLUESKY_APP_PASSWORD;
 if(handle&&password){
  try{
   const session=await blueskySession(fetcher,{handle,password});
   const q=await postMotionQuestion(fetcher,session,data,image);
   done.push({channel:'bluesky',status:q.status});
   // Retirement of the generic post is handled only after a successful reply.
  }catch(e){errors.push('Bluesky: '+redact(e));}
 }else if(handle||password)errors.push('Incomplete Bluesky configuration');
 const secrets=[env.PACKONE_YOUTUBE_CLIENT_ID,env.PACKONE_YOUTUBE_CLIENT_SECRET,env.PACKONE_YOUTUBE_REFRESH_TOKEN];
 if(secrets.every(Boolean)&&env.YOUTUBE_PAUSED!=='true'&&env.FEATURED_YOUTUBE_PAUSED!=='true'){
  try{
   const token=await youtubeAccessToken({clientId:secrets[0],clientSecret:secrets[1],refreshToken:secrets[2],fetchImpl:fetcher});
   // Share the old format's receipt key so cutover cannot upload twice.
   const slot=anchorDay(day),key=discordReceiptKey(FEATURED_YOUTUBE_RECEIPT);
   const claim=await receipts.claim(slot,key);
   if(claim.alreadyPosted)done.push({channel:'youtube',status:'already-posted'});
   else{
    let posted;
    const metadata=featuredYoutubeMetadata(data.feature);
    metadata.snippet.title=data.plan.youtube.title;
    metadata.snippet.description=data.plan.youtube.description+'\n\nPack One is unofficial Fan Content permitted under the Wizards Fan Content Policy and is not approved or endorsed by Wizards.';
    try{posted=await uploadVideo({accessToken:token,day:slot,bytes:video,fetchImpl:fetcher,metadata});}
    catch(e){if(e.refused)await receipts.markFailed(slot,key,claim).catch(()=>{});throw e;}
    await receipts.markPosted(slot,key,claim);
    done.push({channel:'youtube',status:'posted',visibility:posted.visibility,video_id:posted.id});
    if(posted.visibility==='public')await markers.record(FORMAT_MARKERS.youtubeDebate,slot);
    else errors.push('YouTube did not verify public visibility');
   }
  }catch(e){errors.push('YouTube: '+redact(e));}
 }else if(secrets.some(Boolean)&&!secrets.every(Boolean))errors.push('Incomplete YouTube configuration');
 if(errors.length)throw Error('Motion publication incomplete: '+errors.join(' | '));
 return {day,source_day:data.feature.day,puzzle_id:data.feature.puzzle_id,channels:done};
}
export async function revealMotion({env=process.env,now=new Date(),fetcher=fetch,read=readFile}={}){
 await checkLive(env,now,fetcher);
 const day=pacificDay(now),handle=env.BLUESKY_HANDLE,password=env.BLUESKY_APP_PASSWORD;
 if(!handle&&!password)return {skipped:true,reason:'no Bluesky credentials'};
 if(!handle||!password)throw Error('Incomplete Bluesky configuration');
 const ledger=motionLedger({token:env.GITHUB_TOKEN,fetcher});
 const reserved=await ledger.list(day);
 const session=await blueskySession(fetcher,{handle,password});
 const markers=createFormatMarkers({token:env.GITHUB_TOKEN,repo:REPO,fetchImpl:fetcher});
 const outcomes=[],errors=[];
 for(const d of motionRevealDays(now)){
  const reservation=reserved.find(x=>x.day===d);
  if(!reservation)continue;
  try{
   const q=await getPost(fetcher,session,motionRkey(d));
   if(!q)continue;
   const data=await readFrozen(d,{read});
   if(!data)throw Error('Question exists but frozen plan missing');
   assertReservation(data,reservation);
   const r=await revealMotionQuestion(fetcher,session,data,{now});
   outcomes.push({day:d,status:r.status});
   if(['posted','already-posted'].includes(r.status))await markers.record(FORMAT_MARKERS.blueskyDebate,anchorDay(d));
  }catch(e){errors.push(d+': '+String(e.message||'failed').replace(/https?:\/\/\S+/g,'[redacted]'));}
 }
 if(errors.length)throw Error('Motion reveals incomplete: '+errors.join(' | '));
 return {day,outcomes};
}
async function cli(){
 const mode=process.argv[2],day=pacificDay();
 if(mode==='prepare'){
  const r=await prepareMotion();
  if(r.selected){
   await mkdir(MOTION_CACHE+'/'+day,{recursive:true});
   await writeFile(MOTION_CACHE+'/'+day+'/plan.json',JSON.stringify(r.data,null,2)+'\n');
  }
  if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'selected='+r.selected+'\ncached='+Boolean(r.cached)+'\n');
  return {selected:r.selected,cached:Boolean(r.cached),source_day:r.data?.feature?.day,reason:r.reason};
 }
 if(mode==='render'){
  const data=await readFrozen(day);
  if(!data)throw Error('No frozen plan to render');
  const {renderMotionAssets}=await import('./render-social-motion-review.mjs');
  return renderMotionAssets(data.feature,data.plan,MOTION_OUT);
 }
 if(mode==='publish')return publishMotion();
 if(mode==='reveal')return revealMotion();
 throw Error('Unknown motion publisher mode');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
 cli().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1;});
