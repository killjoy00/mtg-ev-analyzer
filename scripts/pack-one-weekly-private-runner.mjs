// Dedicated, private host ONLY. Use the existing local PostyBirb session;
// Patreon OAuth is read-only. Never run this from a public CI runner.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {assertPrivateRuntime,runPrivateWeeklyRecap,publicLocator} from './pack-one-weekly-publish.mjs';
import {findPublishedPatreonPost} from './publish-featured-patreon.mjs';

const ADAPTER=fileURLToPath(new URL('./patreon-desktop/weekly_private_bridge.py',import.meta.url));
export async function callLocalBridge(action,post,{env=process.env,spawnImpl=spawn}={}){
 assertPrivateRuntime(env);
 if(!['check','stage','queue'].includes(action))throw Error('weekly-bridge-action');
 const data=action==='check'?{action}:{action,title:post.title,body:post.body,image_sha256:post.image_sha256,...(action==='stage'?{image_b64:post.image.toString('base64')}:{id:post.id,image_size:post.image_size})};
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
    if(action==='check'&&value?.connected!==true||action==='stage'&&!/^[A-Za-z0-9_-]+$/.test(value?.id||'')||action==='queue'&&value?.queued!==true)throw Error();
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
export function localPublisher({env=process.env,bridge=callLocalBridge,find=readWeeklyPost,verify=verifyWeeklyPublic}={}){
 assertPrivateRuntime(env);
 const token=env.PACKONE_WEEKLY_PATREON_READ_TOKEN;
 if(typeof token!=='string'||token.length<20)throw Error('weekly-read-token-missing');
 return {find:title=>find(title,{token}),stage:post=>bridge('stage',post,{env}),queue:post=>bridge('queue',post,{env}),verify:post=>verify(post)};
}
export async function privateMain({env=process.env,once=false,check=false}={}){
 assertPrivateRuntime(env);
 const database=env.PACKONE_WEEKLY_DATABASE_URL;
 let url;try{url=new URL(database);}catch{throw Error('weekly-database-unconfigured');}
 if(!['postgresql:','postgres:'].includes(url.protocol)||!url.hostname.endsWith('.neon.tech')||url.pathname!=='/pack1'||url.username!=='packone_weekly_publisher'||!['require','verify-full'].includes(url.searchParams.get('sslmode')))
  throw Error('weekly-database-role-required');
 // A specifically provisioned least-privilege runtime login is required.
 // Never copy a deployment owner credential to the desktop.
 const {default:pg}=await import('pg');
 const pool=new pg.Pool({connectionString:database,max:2,connectionTimeoutMillis:15000,query_timeout:45000});
 const query=(text,values=[])=>pool.query(text,values);
 const publisher=localPublisher({env});
 try{
  if(check){
   // Connection check does not claim a receipt, generate named output, stage,
   // or submit. The normal Monday clock and consent gates are unchanged.
   const role=(await query(`SELECT current_user='packone_weekly_publisher' AS scoped,
     has_table_privilege(current_user,'patreon_weekly_pending_names','SELECT') AS pending,
     has_column_privilege(current_user,'neon_auth."user"','email','SELECT') AS email,
     has_table_privilege(current_user,'scores','INSERT') AS score_write,
     has_function_privilege(current_user,'pack1_patreon_weekly_admit(date,jsonb)','EXECUTE') AS admit,
     has_function_privilege(current_user,'pack1_patreon_weekly_finish(date,text,timestamptz)','EXECUTE') AS finish`)).rows[0];
   if(!role?.scoped||role.pending||role.email||role.score_write||!role.admit||!role.finish)throw Error('weekly-database-role-required');
   await query('SELECT week_end,state FROM patreon_weekly_runs LIMIT 0');
   await publisher.find('Pack One Weekly configuration check (no publication)');
   await callLocalBridge('check',{}, {env});
   console.log('pack-one-weekly:connections-verified');
   return;
  }
  do{
   try{
    const result=await runPrivateWeeklyRecap({query,publisher,env});
    // Fixed status only: no names, links, media, account IDs or error bodies.
    console.log('pack-one-weekly:'+result.status);
   }catch{console.error('pack-one-weekly:failed-closed');if(once)process.exitCode=1;}
   if(!once)await sleep(60_000);
  }while(!once);
 }finally{await pool.end();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 privateMain({once:process.argv.includes('--once'),check:process.argv.includes('--check-config')}).catch(()=>{console.error('pack-one-weekly:configuration-unavailable');process.exitCode=1;});
}
