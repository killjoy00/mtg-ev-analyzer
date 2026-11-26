// Dedicated, private host ONLY. Use the existing local PostyBirb session;
// Patreon OAuth is read-only. Never run this from a public CI runner.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {assertPrivateRuntime,publicLocator,WEEKLY_TOKEN,WEEKLY_PATH,recapTitle,recapBody} from '../weekly-patreon-contract.mjs';
import {createHash} from 'node:crypto';
import {captureSeasonEditorial} from './pack-one-season-render.mjs';
import {captureLabEditorial} from './pack-one-lab-render.mjs';
import {validateLabPrepared} from '../lab-patreon-contract.mjs';
import {validateSeasonPrepared} from '../weekly-patreon-contract.mjs';
import {captureWeeklyRecap} from './pack-one-weekly-render.mjs';
import {findPublishedPatreonPost} from '../patreon-post-read.mjs';

const ADAPTER=fileURLToPath(new URL('./patreon-desktop/weekly_private_bridge.py',import.meta.url));
export async function callLocalBridge(action,post,{env=process.env,spawnImpl=spawn}={}){
 assertPrivateRuntime(env);
 if(!['check','stage','queue','pick-tick'].includes(action))throw Error('weekly-bridge-action');
 const data=['check','pick-tick'].includes(action)?{action}:{action,title:post.title,body:post.body,image_sha256:post.image_sha256,...(action==='stage'?{image_b64:post.image.toString('base64')}:{id:post.id,image_size:post.image_size})};
 const executable=env.PACKONE_WEEKLY_BRIDGE_EXE;
 const python=executable||env.PACKONE_WEEKLY_PYTHON||'python';
 // Do not pass database or Patreon secrets to the Python child. It uses only
 // the existing loopback PostyBirb auth and the private-runtime flags.
 const childEnv=Object.fromEntries(Object.entries(env).filter(([k])=>['PATH','Path','SYSTEMROOT','SystemRoot','WINDIR','APPDATA','LOCALAPPDATA','USERPROFILE','HOME','TEMP','TMP','PATHEXT','PYTHONUTF8','PACKONE_WEEKLY_PRIVATE_RUNTIME','PACKONE_WEEKLY_PUBLICATION_ENABLED','PACKONE_WEEKLY_NOTICE_VERIFIED'].includes(k)));
 childEnv.PYTHONUTF8='1';
 return new Promise((resolve,reject)=>{
  const p=spawnImpl(python,executable?[]:[ADAPTER],{env:childEnv,windowsHide:true,stdio:['pipe','pipe','ignore']});
  let output='',settled=false;
  const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const timer=setTimeout(()=>{p.kill();done(Error('weekly-bridge-timeout'));},120000);
  p.stdout.on('data',chunk=>{output+=chunk;if(output.length>4096){p.kill();done(Error('weekly-bridge-response'));}});
  p.on('error',()=>done(Error('weekly-bridge-unavailable')));
  p.stdin.on('error',()=>done(Error('weekly-bridge-unavailable')));
  p.on('close',code=>{
   if(code!==0)return done(Error('weekly-bridge-failed'));
   try{
    const value=JSON.parse(output);
    if(action==='check'&&value?.connected!==true||action==='stage'&&!/^[A-Za-z0-9_-]+$/.test(value?.id||'')||action==='queue'&&value?.queued!==true||action==='pick-tick'&&!['outside-window','waiting-feed','public-confirmed','queued-awaiting-verification','review-required','failed-closed'].includes(value?.status))throw Error();
    done(null,value);
   }catch{done(Error('weekly-bridge-response'));}
  });
  p.stdin.end(JSON.stringify(data));
 });
}
// The supported API supplies the publication timestamp, but does not prove
// public visibility or body/image presentation. Check the exact post again.
export async function readWeeklyPost(title,{token,fetchImpl=fetch,find=findPublishedPatreonPost}={}){
 const found=await find({title,token,fetchImpl,includePublishedAt:true});
 if(!found)return null;
 if(!/^\d+$/.test(String(found.id))||!publicLocator(found.url)||found.title!==title||!Number.isFinite(Date.parse(found.publishedAt)))throw Error('weekly-patreon-invalid');
 return {title,url:found.url,publishedAt:found.publishedAt};
}
export async function verifyWeeklyPublic({title,body,url,width,height},{chromiumImpl}={}){
 if(!publicLocator(url)||!Number.isFinite(width)||!Number.isFinite(height))throw Error('weekly-patreon-invalid');
 const chromium=chromiumImpl||(await import('playwright')).chromium;
 const browser=await chromium.launch({headless:true});
 try{
  // No creator cookies, no Browserless credentials or challenge bypass.
  const page=await browser.newPage({viewport:{width:960,height:1000}});
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.getByRole('heading',{name:title,exact:true}).waitFor({state:'visible',timeout:20000});
  const more=page.getByRole('button',{name:/^Read more$/i});
  if(await more.count()===1&&await more.isVisible())await more.click();
  await page.waitForFunction(({body,ratio})=>{
   const normalize=s=>String(s).replace(/\s+/g,' ').trim();
   const text=normalize(document.body.innerText);
   const blocks=body.split('\n').filter(Boolean);
   // Provider HTML may turn a link into an anchor; require its visible text
   // or exact href, not arbitrary surrounding page metadata.
   const links=[...document.querySelectorAll('a[href]')].map(a=>a.href);
   return blocks.every(line=>{
    const match=line.match(/^(.*?): (https:\/\/\S+)$/);
    return match?text.includes(normalize(match[1]))&&links.includes(match[2]):text.includes(normalize(line));
   })&&[...document.images].some(img=>img.complete&&img.naturalWidth>=600&&img.naturalHeight>=600&&Math.abs(img.naturalWidth/img.naturalHeight-ratio)<=Math.max(.015,ratio*.04));
  },{body,ratio:width/height},{timeout:20000});
  const actual=new URL(page.url());
  const match=actual.pathname.match(/^\/(?:[^/]+\/)?posts\/(?:[^/]+-)?(\d+)\/?$/);
  if(actual.origin!=='https://www.patreon.com'||!match||'https://www.patreon.com/posts/'+match[1]!==url)throw Error('weekly-public-url');
  return true;
 }catch{throw Error('weekly-public-readback-failed');}
 finally{await browser.close();}
}
// A single revocable Pack One pairing code, not a database or Patreon token.
// The server alone constructs the snapshot and verifies/adopts receipts.
export function createWeeklyApi({env=process.env,fetchImpl=fetch}={}){
 assertPrivateRuntime(env);
 const token=env.PACKONE_WEEKLY_PAIRING_CODE;
 if(!WEEKLY_TOKEN.test(token||''))throw Error('weekly-pairing-required');
 const endpoint='https://api.packone.pro/growth'+WEEKLY_PATH;
 return async(action,params={})=>{
  const response=await fetchImpl(endpoint,{method:'POST',headers:{
   authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json'
  },body:JSON.stringify({action,...params}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(110000)});
  if(!response.ok)throw Error('weekly-api-unavailable');
  const length=Number(response.headers.get('content-length')||0);
  if(length>1_000_000)throw Error('weekly-api-response-too-large');
  const data=await response.text();
  if(data.length>1_000_000)throw Error('weekly-api-response-too-large');
  const parsed=JSON.parse(data);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('weekly-api-response-invalid');
  return parsed;
 };
}
async function runPairedTick({call,bridge,capture,verify,season=false,lab=false}){
 const request=(action,params={})=>call(lab?'lab-'+action:season?'season-'+action:action,params);
 const identity=run=>lab?{week:run.week}:season?{post_key:run.post_key}:{week_end:run.week_end};
 const history=await request('status');
 if((season||lab)&&history.status==='schema-unavailable')return {status:'schema-unavailable'};
 if(!Array.isArray(history.pending)||history.pending.length>20)throw Error('weekly-api-response-invalid');
 let reconciliation=null;
 for(const run of history.pending){
  try{
   const {found}=await request('find',identity(run));
   if(!found){reconciliation||='queued-awaiting-verification';continue;}
   if(await verify({title:run.title,body:run.body,url:found.url,width:run.width,height:run.height})!==true)
    throw Error('weekly-public-readback-invalid');
   const result=await request('finish',{...identity(run),url:found.url,publishedAt:found.publishedAt,visualVerified:true});
   if(!['verified','already-verified'].includes(result.status))throw Error('weekly-public-readback-invalid');
   reconciliation||='already-verified';
  }catch{
   // A pending handoff is never submitted again, even if readback fails.
   reconciliation='review-required';
  }
 }
 const prepared=await request('prepare');
 if(prepared.status!=='prepared'){
  if(!['outside-window','already-verified','receipt-exists','unexpected-public-post',...(season?['schema-unavailable','guide-draft-awaiting-approval','guide-evidence-unavailable']:lab?['schema-unavailable','lab-disabled','lab-awaiting-approval']:[])].includes(prepared.status))throw Error('weekly-api-response-invalid');
  return {status:(prepared.status==='outside-window'||lab&&['lab-disabled','lab-awaiting-approval','receipt-exists','already-verified'].includes(prepared.status))&&reconciliation?reconciliation:prepared.status};
 }
 if(lab)validateLabPrepared(prepared);
 else if(season)validateSeasonPrepared(prepared);
 else if(prepared.title!==recapTitle(prepared.week_end)||prepared.body!==recapBody(prepared.week_end)||
    prepared.article?.end!==prepared.week_end||typeof prepared.ticket!=='string')throw Error('weekly-api-response-invalid');
 const media=await capture(lab?prepared.artwork:prepared.article,{jpeg:true});
 if(!Buffer.isBuffer(media.jpeg)||media.jpeg.length<5000||media.jpeg.length>12_000_000||
    media.jpeg[0]!==255||media.jpeg[1]!==216||media.jpeg[2]!==255||
    !Number.isInteger(media.width)||media.width<100||media.width>4000||!Number.isInteger(media.height)||media.height<100||media.height>30000)
  throw Error('weekly-media-invalid');
 const params={ticket:prepared.ticket,image_sha256:createHash('sha256').update(media.jpeg).digest('hex')};
 const claim=await request('claim',{...params,width:media.width,height:media.height});
 if(claim.status!=='claimed'){
  if(!['receipt-exists','unexpected-public-post'].includes(claim.status))throw Error('weekly-api-response-invalid');
  return {status:claim.status};
 }
 const post={title:prepared.title,body:prepared.body,image_sha256:params.image_sha256};
 try{
  const staged=await bridge('stage',{...post,image:media.jpeg});
  if(!/^[A-Za-z0-9_-]+$/.test(staged?.id||''))throw Error('weekly-draft-invalid');
  const admission=await request('admit',params);
  if(admission.status!=='admitted')throw Error('weekly-admission-refused');
  // Exactly one external handoff. A missing response is ambiguous; the
  // server's receipt blocks a second attempt on every device and restart.
  await bridge('queue',{...post,id:staged.id,image_size:media.jpeg.length});
  await request('queued',params);
  return {status:'queued-awaiting-verification'};
 }catch{
  await request('review',params).catch(()=>{});
  return {status:'review-required'};
 }
}
export function runPairedWeeklyTick({call,bridge,capture=captureWeeklyRecap,verify=verifyWeeklyPublic}){
 return runPairedTick({call,bridge,capture,verify});
}
export function runPairedSeasonTick({call,bridge,capture=captureSeasonEditorial,verify=verifyWeeklyPublic}){
 return runPairedTick({call,bridge,capture,verify,season:true});
}
export function runPairedLabTick({call,bridge,capture=captureLabEditorial,verify=verifyWeeklyPublic}){
 return runPairedTick({call,bridge,capture,verify,lab:true});
}
export async function privateMain({env=process.env,once=false,check=false}={}){
 const call=createWeeklyApi({env});
 const bridge=(action,post)=>callLocalBridge(action,post,{env});
 if(check){
  const result=await call('check');
  if(result.status!=='connections-verified')throw Error('weekly-api-unavailable');
  await bridge('check',{});
  console.log('pack-one-weekly:connections-verified');
  return;
 }
 do{
  try{
   const result=await runPairedWeeklyTick({call,bridge});
   console.log('pack-one-weekly:'+result.status);
  }catch{console.error('pack-one-weekly:failed-closed');if(once)process.exitCode=1;}
  if(!once)await sleep(60_000);
 }while(!once);
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 privateMain({once:process.argv.includes('--once'),check:process.argv.includes('--check-config')}).catch(()=>{console.error('pack-one-weekly:configuration-unavailable');process.exitCode=1;});
}
