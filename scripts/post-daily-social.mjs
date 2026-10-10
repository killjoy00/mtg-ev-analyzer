// Morning Pack One distribution. Node 22+, built-in fetch only.
// Never print session tokens, app passwords, or Discord webhook URLs.
import {fileURLToPath} from 'node:url';
import {createGithubReceiptLedger,discordReceiptKey} from './daily-social-ledger.mjs';

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

export function dailyCopy(day,channel='bluesky') {
  if(!['bluesky','discord'].includes(channel))throw Error('Invalid social channel.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Invalid Pacific Daily date.');
  const title=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'})
    .format(new Date(day+'T12:00:00Z'));
  // One stable campaign so launch reports group every Daily post together.
  const url=DAILY_URL+'&utm_source='+channel+'&utm_medium=social&utm_campaign=daily_post';
  const text='Pack One Daily · '+title+'\n\n'+
    'Three new MTG draft challenges: Draft Run, Powered Cube and Latest Set. '+
    'Make your picks, then compare with the trophy drafter.\n\n'+url;
  if([...text].length>300)throw Error('Bluesky Daily copy exceeds 300 characters.');
  return {text,url};
}

// app.bsky.feed.post has a tid record-key Lexicon. Use one valid, stable,
// day-derived 13-character TID so retries cannot create a second Bluesky post.
export function blueskyDailyRkey(day) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Invalid Daily TID date.');
  const stamp=Date.parse(day+'T15:10:00Z');
  if(!Number.isFinite(stamp))throw Error('Invalid Daily TID date.');
  let value=(BigInt(stamp)*1000n<<10n)|49n;
  const alphabet='234567abcdefghijklmnopqrstuvwxyz';
  let tid='';
  for(let i=0;i<13;i++) {
    tid=alphabet[Number(value&31n)]+tid;
    value>>=5n;
  }
  if(value!==0n||!/^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/.test(tid))
    throw Error('Daily TID is invalid.');
  return tid;
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

function validDiscordWebhook(candidate) {
  let url;
  try {url=new URL(candidate);}catch{return null;}
  if(url.protocol!=='https:'||url.hostname!=='discord.com'||url.port||url.username||url.password||
     url.search||url.hash||!/^\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+$/.test(url.pathname))
    return null;
  return url.toString();
}

// One badly pasted entry must not silence Bluesky and every other server.
// Invalid entries are reported by position only, never by value.
export function discordWebhookEntries(value='') {
  const entries=String(value||'').split(/[\n,]+/).map(s=>s.trim()).filter(Boolean);
  const unique=new Set(),invalid=[];
  entries.forEach((candidate,index)=>{
    const url=validDiscordWebhook(candidate);
    if(url)unique.add(url);else invalid.push(index+1);
  });
  return {webhooks:[...unique],invalid};
}

export function discordWebhookList(value='') {
  const {webhooks,invalid}=discordWebhookEntries(value);
  if(invalid.length)throw Error('Invalid Discord webhook URL.');
  return webhooks;
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
  let embed={$type:'app.bsky.embed.external',external:{uri:url,title:'Pack One Daily',
    description:'Three daily Magic: The Gathering draft challenges.'}};
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
  const rkey=blueskyDailyRkey(day);
  const getUrl=new URL('https://bsky.social/xrpc/com.atproto.repo.getRecord');
  getUrl.searchParams.set('repo',session.did);
  getUrl.searchParams.set('collection','app.bsky.feed.post');
  getUrl.searchParams.set('rkey',rkey);
  async function alreadyPosted() {
    const existing=await fetchImpl(getUrl.toString(),{headers:auth,signal:AbortSignal.timeout(15_000)});
    if(existing.status===404)return false;
    if(existing.status===400) {
      const data=await existing.json().catch(()=>({}));
      if(data.error==='RecordNotFound')return false;
    }
    if(!existing.ok)throw Error('Bluesky record lookup returned HTTP '+existing.status+'.');
    const found=await existing.json();
    if(found.value?.text!==text||
       found.value?.facets?.[0]?.features?.[0]?.uri!==url)
      throw Error('The deterministic Bluesky Daily record key is occupied by a different post.');
    return true;
  }
  if(await alreadyPosted())return 'already-posted';
  const response=await fetchImpl('https://bsky.social/xrpc/com.atproto.repo.createRecord',{
    method:'POST',
    headers:{...auth,'content-type':'application/json'},
    body:JSON.stringify({repo:session.did,collection:'app.bsky.feed.post',rkey,record}),
    signal:AbortSignal.timeout(15_000),
  });
  // ATProto PDS returns HTTP 400 for an existing rkey, not necessarily 409.
  // Never treat an arbitrary 400 as proof of a duplicate: re-read exact content.
  if(response.status===400||response.status===409) {
    if(await alreadyPosted())return 'already-posted';
  }
  if(!response.ok)throw Error('Bluesky publish returned HTTP '+response.status+'.');
  return 'posted';
}

export async function discordPublish(fetchImpl,webhook,{text,image},{
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
}={}) {
  const url=new URL(webhook);
  url.searchParams.set('wait','true');
  for(let attempt=0;attempt<3;attempt++) {
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
    if(response.status===429&&attempt<2) {
      const seconds=Number(response.headers.get('retry-after'));
      const waitMs=Number.isFinite(seconds)&&seconds>=0
        ? Math.min(30000,Math.max(1000,seconds*1000)) : 1500;
      await sleep(waitMs);
      continue;
    }
    if(!response.ok)
      throw Object.assign(Error('Discord publish returned HTTP '+response.status+'.'),{status:response.status});
    return 'posted';
  }
  throw Error('Discord publish retry budget exhausted.');
}

export async function postDaily({
  env=process.env,now=new Date(),scheduledAt=now,fetchImpl=fetch,ledger=null,
}={}) {
  const event=env.GITHUB_EVENT_NAME||'workflow_dispatch';
  const triggered=pacificClock(event==='schedule'?scheduledAt:now);
  const wall=pacificClock(now);
  const {day}=triggered;
  const live=event==='schedule'||env.MANUAL_LIVE==='true';
  // In winter the 15:10 UTC trigger is 07:10 PST and skips; 16:10 posts and
  // 17:10 retries. In summer 15:10 posts and both later triggers retry.
  // Receipts and the deterministic Bluesky record deduplicate every retry.
  if(event==='schedule'&&(triggered.hour<8||triggered.day!==wall.day))
    return {day,skipped:true,reason:'before Daily reset or expired scheduled day'};
  if(live&&env.GITHUB_REF!=='refs/heads/main')
    throw Error('Live Daily posting is restricted to the reviewed main branch.');
  const blue=dailyCopy(day,'bluesky');
  const discord=dailyCopy(day,'discord');
  const handle=String(env.BLUESKY_HANDLE||'').trim();
  const password=String(env.BLUESKY_APP_PASSWORD||'');
  if(Boolean(handle)!==Boolean(password))throw Error('Bluesky credentials are incomplete.');
  const {webhooks,invalid:invalidWebhooks}=discordWebhookEntries(env.DISCORD_WEBHOOK_URLS||'');
  const imageUrl=dailyImageUrl(env.DAILY_IMAGE_URL_TEMPLATE||'',day);
  if(!live)return {day,dry_run:true,bluesky:Boolean(handle),discord_servers:webhooks.length,
    invalid_discord_entries:invalidWebhooks,image_requested:Boolean(imageUrl),text:blue.text};
  if(!handle&&!webhooks.length)throw Error('Configure a Bluesky account or Discord webhooks before enabling live posting.'+
    (invalidWebhooks.length?' Invalid Discord webhook entries: '+invalidWebhooks.join(', ')+'.':''));
  const receipts=ledger||(webhooks.length?createGithubReceiptLedger({
    token:env.GITHUB_TOKEN,repo:env.GITHUB_REPOSITORY,issueNumber:Number(env.SOCIAL_LEDGER_ISSUE),
    fetchImpl,
  }):null);
  const image=await maybeDailyImage(fetchImpl,imageUrl);
  const jobs=[];
  if(handle)jobs.push({label:'Bluesky',run:()=>blueskyPublish(fetchImpl,
    {handle,password,day,text:blue.text,url:blue.url,image})});
  for(const [index,webhook] of webhooks.entries())
    jobs.push({label:'Discord server '+(index+1),run:async()=>{
      const channel=discordReceiptKey(webhook);
      const claim=await receipts.claim(day,channel);
      if(claim.alreadyPosted)return 'already-posted';
      let result;
      try {
        result=await discordPublish(fetchImpl,webhook,{text:discord.text,image});
      } catch(error) {
        // An HTTP error response means Discord did not create the message, so
        // the next scheduled attempt may retry. Timeouts stay unconfirmed.
        if(Number.isInteger(error?.status)) {
          try {await receipts.markFailed(day,channel,claim);} catch {}
        }
        throw error;
      }
      await receipts.markPosted(day,channel,claim);
      return result;
    }});
  const results=await Promise.allSettled(jobs.map(job=>job.run()));
  // Never log tokens, webhook URLs or upstream bodies.
  const failed=results.flatMap((r,i)=>{
    if(r.status!=='rejected')return [];
    const status=String(r.reason?.message||'').match(/HTTP ([0-9]{3})/);
    return [jobs[i].label+' failed'+(status?' (HTTP '+status[1]+')':'')];
  });
  for(const line of invalidWebhooks)failed.push('Discord webhook entry '+line+' is invalid');
  if(failed.length)throw Error('Daily publish incomplete: '+failed.join(' | '));
  return {day,posted:results.filter(r=>r.status==='fulfilled'&&r.value==='posted').length,
    already_posted:results.filter(r=>r.status==='fulfilled'&&r.value==='already-posted').length,
    channels:jobs.length,image_included:Boolean(image)};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
  try {
    let scheduledAt=new Date();
    if(process.env.GITHUB_EVENT_NAME==='schedule') {
      const repo=process.env.GITHUB_REPOSITORY,runId=process.env.GITHUB_RUN_ID;
      if(!process.env.GITHUB_TOKEN||repo!=='killjoy00/mtg-ev-analyzer'||!/^\d+$/.test(runId||''))
        throw Error('Scheduled Daily run provenance is missing.');
      const result=await fetch('https://api.github.com/repos/'+repo+'/actions/runs/'+runId,{
        headers:{authorization:'Bearer '+process.env.GITHUB_TOKEN,accept:'application/vnd.github+json'},
        signal:AbortSignal.timeout(15_000),
      });
      if(!result.ok)throw Error('Cannot verify original scheduled run time (HTTP '+result.status+').');
      const run=await result.json();
      scheduledAt=new Date(run.created_at);
      if(Number.isNaN(scheduledAt.getTime())||run.event!=='schedule')
        throw Error('Invalid scheduled run timestamp.');
    }
    const result=await postDaily({scheduledAt});
    // Do not print the (secret-bearing) environment, webhook addresses, or JWTs.
    console.log(JSON.stringify(result));
  } catch(error) {
    console.error(error instanceof Error?error.message:'Daily publish failed.');
    process.exitCode=1;
  }
}
