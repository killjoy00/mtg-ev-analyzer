// Morning Pack One distribution. Node 22+, built-in fetch only.
// Never print session tokens, app passwords, or Discord webhook URLs.
import {fileURLToPath} from 'node:url';

const SITE='https://packone.pro';
const DAILY_URL=SITE+'/?game=draft-run&daily=1';
const PACIFIC='America/Los_Angeles';
const MAX_IMAGE_BYTES=1_000_000;

export function pacificClock(now=new Date()) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:PACIFIC,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',hourCycle:'h23',
  }).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return {day:[parts.year,parts.month,parts.day].join('-'),hour:Number(parts.hour)};
}

export function dailyCopy(day) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Invalid Pacific Daily date.');
  const title=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'})
    .format(new Date(day+'T12:00:00Z'));
  const text='Pack One Daily · '+title+'\n\n'+
    'Three new MTG draft challenges: Draft Run, Powered Cube and Latest Set. '+
    'Make your picks, then compare with the trophy drafter.\n\n'+DAILY_URL;
  if([...text].length>300)throw Error('Bluesky Daily copy exceeds 300 characters.');
  return {text,url:DAILY_URL};
}

export function blueskyLinkFacets(text,url) {
  const index=text.indexOf(url);
  if(index<0)throw Error('Daily link is missing from the post.');
  return [{
    index:{
      byteStart:Buffer.byteLength(text.slice(0,index),'utf8'),
      byteEnd:Buffer.byteLength(text.slice(0,index+url.length),'utf8'),
    },
    features:[{$type:'app.bsky.richtext.facet#link',uri:url}],
  }];
}

export function discordWebhookList(value='') {
  const entries=String(value||'').split(/[\n,]+/).map(s=>s.trim()).filter(Boolean);
  const unique=new Set();
  for(const candidate of entries) {
    let url;
    try {url=new URL(candidate);}catch{throw Error('Invalid Discord webhook URL.');}
    if(url.protocol!=='https:'||url.hostname!=='discord.com'||url.port||url.username||url.password||
       url.search||url.hash||!/^\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+$/.test(url.pathname))
      throw Error('Invalid Discord webhook URL.');
    unique.add(url.toString());
  }
  return [...unique];
}

export function dailyImageUrl(template,day) {
  if(!template)return null;
  if(!template.includes('{date}'))throw Error('Daily image URL must contain {date}.');
  let url;
  try {url=new URL(template.replaceAll('{date}',day));}catch{throw Error('Invalid Daily image URL.');}
  // A marketing image should never be able to reach arbitrary/internal hosts.
  if(url.protocol!=='https:'||url.hostname!=='packone.pro'||url.username||url.password||
     url.port||url.search||url.hash)throw Error('Daily image must be on https://packone.pro.');
  return url.toString();
}

async function responseJson(fetchImpl,url,options,label) {
  const response=await fetchImpl(url,{...options,signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw Error(label+' returned HTTP '+response.status+'.');
  return response.json();
}

async function maybeDailyImage(fetchImpl,url) {
  if(!url)return null;
  try {
    const response=await fetchImpl(url,{signal:AbortSignal.timeout(15_000),redirect:'error'});
    if(!response.ok)return null; // Image #3 may not have been published yet.
    const type=(response.headers.get('content-type')||'').split(';')[0].trim();
    if(!['image/png','image/jpeg','image/webp'].includes(type))return null;
    if(Number(response.headers.get('content-length')||0)>MAX_IMAGE_BYTES)return null;
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(!bytes.length||bytes.byteLength>MAX_IMAGE_BYTES)return null;
    return {url,bytes,type};
  } catch {return null;} // Text-only posting must always remain possible.
}

export async function blueskyPublish(fetchImpl,{handle,password,day,text,url,image}) {
  const session=await responseJson(fetchImpl,'https://bsky.social/xrpc/com.atproto.server.createSession',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({identifier:handle,password}),
  },'Bluesky login');
  if(!session?.accessJwt||!session.did)throw Error('Bluesky login returned no session.');
  const auth={'authorization':'Bearer '+session.accessJwt};
  let embed;
  if(image) {
    const blob=await responseJson(fetchImpl,'https://bsky.social/xrpc/com.atproto.repo.uploadBlob',{
      method:'POST',headers:{...auth,'content-type':image.type},body:image.bytes,
    },'Bluesky image upload');
    if(!blob?.blob)throw Error('Bluesky upload returned no blob.');
    embed={$type:'app.bsky.embed.images',images:[{alt:'Pack One Daily draft challenge',image:blob.blob}]};
  }
  const record={
    $type:'app.bsky.feed.post',
    text,
    createdAt:new Date().toISOString(),
    facets:blueskyLinkFacets(text,url),
    ...(embed?{embed}:{}),
  };
  // Deterministic record key prevents a rerun from duplicating a Bluesky post.
  const response=await fetchImpl('https://bsky.social/xrpc/com.atproto.repo.createRecord',{
    method:'POST',
    headers:{...auth,'content-type':'application/json'},
    body:JSON.stringify({repo:session.did,collection:'app.bsky.feed.post',
      rkey:'packone-daily-'+day,record}),
    signal:AbortSignal.timeout(15_000),
  });
  if(response.status===409)return 'already-posted';
  if(!response.ok)throw Error('Bluesky publish returned HTTP '+response.status+'.');
  return 'posted';
}

export async function discordPublish(fetchImpl,webhook,{text,image}) {
  const url=new URL(webhook);
  url.searchParams.set('wait','true');
  const response=await fetchImpl(url.toString(),{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      content:text,
      allowed_mentions:{parse:[]},
      ...(image?{embeds:[{image:{url:image.url}}]}:{}),
    }),
    signal:AbortSignal.timeout(15_000),
  });
  if(!response.ok)throw Error('Discord publish returned HTTP '+response.status+'.');
  return 'posted';
}

export async function postDaily({env=process.env,now=new Date(),fetchImpl=fetch}={}) {
  const {day,hour}=pacificClock(now);
  const event=env.GITHUB_EVENT_NAME||'workflow_dispatch';
  const live=event==='schedule'||env.MANUAL_LIVE==='true';
  if(event==='schedule'&&(hour!==8||Number(env.GITHUB_RUN_ATTEMPT||'1')!==1))
    return {day,skipped:true,reason:'outside first scheduled Pacific 8 AM window'};
  if(event==='schedule'&&env.GITHUB_REF!=='refs/heads/main')
    return {day,skipped:true,reason:'not the published main branch'};
  const text=dailyCopy(day);
  const handle=String(env.BLUESKY_HANDLE||'').trim();
  const password=String(env.BLUESKY_APP_PASSWORD||'');
  if(Boolean(handle)!==Boolean(password))throw Error('Bluesky credentials are incomplete.');
  const webhooks=discordWebhookList(env.DISCORD_WEBHOOK_URLS||'');
  const imageUrl=dailyImageUrl(env.DAILY_IMAGE_URL_TEMPLATE||'',day);
  if(!live)return {day,dry_run:true,bluesky:Boolean(handle),discord_servers:webhooks.length,
    image_requested:Boolean(imageUrl),text:text.text};
  if(!handle&&!webhooks.length)throw Error('Configure a Bluesky account or Discord webhooks before enabling live posting.');
  const image=await maybeDailyImage(fetchImpl,imageUrl);
  const jobs=[];
  if(handle)jobs.push({label:'Bluesky',run:()=>blueskyPublish(fetchImpl,
    {handle,password,day,text:text.text,url:text.url,image})});
  for(const [index,webhook] of webhooks.entries())
    jobs.push({label:'Discord server '+(index+1),run:()=>discordPublish(fetchImpl,webhook,
      {text:text.text,image})});
  const results=await Promise.allSettled(jobs.map(job=>job.run()));
  // Network clients sometimes include full URLs in thrown error messages.
  // Only emit a channel label and an optional numeric HTTP status.
  const failed=results.flatMap((r,i)=>{
    if(r.status!=='rejected')return [];
    const status=String(r.reason?.message||'').match(/HTTP ([0-9]{3})/);
    return [jobs[i].label+' failed'+(status?' (HTTP '+status[1]+')':'')];
  });
  if(failed.length)throw Error('Daily publish incomplete: '+failed.join(' | '));
  return {day,posted:results.filter(r=>r.status==='fulfilled'&&r.value==='posted').length,
    already_posted:results.filter(r=>r.status==='fulfilled'&&r.value==='already-posted').length,
    channels:jobs.length,image_included:Boolean(image)};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
  try {
    const result=await postDaily();
    // Do not print the (secret-bearing) environment, webhook addresses, or JWTs.
    console.log(JSON.stringify(result));
  } catch(error) {
    console.error(error instanceof Error?error.message:'Daily publish failed.');
    process.exitCode=1;
  }
}
