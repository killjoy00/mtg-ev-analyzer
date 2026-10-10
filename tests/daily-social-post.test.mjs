import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  pacificClock,dailyCopy,blueskyLinkFacets,blueskyDailyRkey,discordWebhookList,discordWebhookEntries,dailyImageUrl,
  postDaily,blueskyPublish,discordPublish,
} from '../scripts/post-daily-social.mjs';

const summer=new Date('2026-07-10T15:10:00Z');
const winter=new Date('2026-01-10T16:10:00Z');
const webhook='https://discord.com/api/webhooks/123456789/token_ABC-def';
const liveEnv={GITHUB_EVENT_NAME:'schedule',GITHUB_REF:'refs/heads/main',DISCORD_WEBHOOK_URLS:webhook};
function memoryLedger() {
  const claims=new Map();
  let id=0;
  return {
    claims,
    async claim(day,key) {
      const name=day+':'+key,existing=claims.get(name);
      if(existing?.posted)return {alreadyPosted:true};
      if(existing?.failed) {existing.failed=false;return {id:existing.id,alreadyPosted:false};}
      if(existing)throw Error('An earlier Discord delivery is unconfirmed.');
      const next={id:++id,posted:false};
      claims.set(name,next);
      return {id:next.id,alreadyPosted:false};
    },
    async markPosted(day,key,claim) {
      const entry=claims.get(day+':'+key);
      assert.equal(entry?.id,claim.id);
      entry.posted=true;
    },
    async markFailed(day,key,claim) {
      const entry=claims.get(day+':'+key);
      assert.equal(entry?.id,claim.id);
      entry.failed=true;
    },
  };
}

test('Pacific clock handles daylight and standard time',()=>{
  assert.deepEqual(pacificClock(summer),{day:'2026-07-10',hour:8});
  assert.deepEqual(pacificClock(winter),{day:'2026-01-10',hour:8});
  assert.deepEqual(pacificClock(new Date('2026-01-10T15:10:00Z')),{day:'2026-01-10',hour:7});
  assert.deepEqual(pacificClock(new Date('2026-07-10T16:10:00Z')),{day:'2026-07-10',hour:9});
});

test('Daily copy includes separate campaign attribution and UTF-8 facets',()=>{
  const blue=dailyCopy('2026-10-10','bluesky');
  const discord=dailyCopy('2026-10-10','discord');
  for(const {text,url} of [blue,discord]) {
    assert.match(text,/Powered Cube and Latest Set/);
    assert.match(url,/https:\/\/packone\.pro\/\?game=draft-run&daily=1/);
    assert.match(url,/utm_medium=social/);
    assert.match(text,/Pack One Daily/);
    assert.ok([...text].length<=300);
    const facet=blueskyLinkFacets(text,url)[0];
    assert.equal(facet.index.byteStart,Buffer.byteLength(text.slice(0,text.indexOf(url))));
    assert.equal(facet.index.byteEnd-facet.index.byteStart,Buffer.byteLength(url));
  }
  assert.match(blue.url,/utm_source=bluesky/);
  assert.match(discord.url,/utm_source=discord/);
  assert.notEqual(blue.url,discord.url);
});

test('Bluesky date key is a stable valid timestamp identifier, not a custom literal',()=>{
  const rkey=blueskyDailyRkey('2026-10-10');
  assert.match(rkey,/^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/);
  assert.equal(rkey.length,13);
  assert.equal(blueskyDailyRkey('2026-10-10'),rkey);
  assert.ok(blueskyDailyRkey('2026-10-11')>rkey);
  assert.throws(()=>blueskyDailyRkey('nonsense'),/date/);
});

test('Discord webhook and optional image URLs reject untrusted hosts',()=>{
  assert.deepEqual(discordWebhookList(webhook+'\n'+webhook),[webhook]);
  for(const value of [
    'http://discord.com/api/webhooks/123/abc',
    'https://discord.com.evil.test/api/webhooks/123/abc',
    'https://discord.com@evil.test/api/webhooks/123/abc',
    'https://discord.com/api/webhooks/123/abc?wait=true',
    'https://discord.com/api/webhooks/123/abc/extra',
    'https://localhost/api/webhooks/123/abc',
  ])assert.throws(()=>discordWebhookList(value),/Invalid Discord webhook URL/);
  assert.equal(dailyImageUrl('https://packone.pro/daily/{date}.png','2026-10-10'),
    'https://packone.pro/daily/2026-10-10.png');
  assert.throws(()=>dailyImageUrl('https://evil.test/{date}.png','2026-10-10'),/packone.pro/);
});

test('Manual preview is offline, with no network access or GitHub receipt writes',async()=>{
  const result=await postDaily({now:summer,env:{DISCORD_WEBHOOK_URLS:webhook},
    fetchImpl:()=>{throw Error('Dry run accessed the network.');}});
  assert.equal(result.dry_run,true);
  assert.equal(result.discord_servers,1);
});

test('Live posts reject unreviewed refs; preview remains available',async()=>{
  const forbidden=()=>{throw Error('Unexpected network access');};
  await assert.rejects(postDaily({now:summer,env:{
    ...liveEnv,GITHUB_REF:'refs/heads/unreviewed'},fetchImpl:forbidden,ledger:memoryLedger()}),/main branch/);
  await assert.rejects(postDaily({now:summer,env:{
    ...liveEnv,GITHUB_EVENT_NAME:'workflow_dispatch',MANUAL_LIVE:'true',
    GITHUB_REF:'refs/heads/unreviewed'},fetchImpl:forbidden,ledger:memoryLedger()}),/main branch/);
  const preview=await postDaily({now:summer,env:{
    ...liveEnv,GITHUB_EVENT_NAME:'workflow_dispatch',MANUAL_LIVE:'false',
    GITHUB_REF:'refs/heads/unreviewed'},fetchImpl:forbidden});
  assert.equal(preview.dry_run,true);
});

test('Redundant winter 7 AM cron skips; delayed 8 AM run and retry are eligible',async()=>{
  const forbidden=()=>{throw Error('Off-hours scheduled traffic');};
  const early=await postDaily({now:new Date('2026-01-10T15:10:00Z'),env:liveEnv,fetchImpl:forbidden});
  assert.equal(early.skipped,true);
  const elapsed=await postDaily({now:new Date('2026-07-10T18:10:00Z'),
    scheduledAt:summer,env:{...liveEnv,GITHUB_RUN_ATTEMPT:'2'},
    ledger:memoryLedger(),fetchImpl:async()=>Response.json({id:'posted'})});
  assert.equal(elapsed.posted,1,'late/retried scheduled run publishes the eligible Daily');
  assert.equal(pacificClock(new Date('2026-07-11T01:10:00Z')).day,'2026-07-10',
    'a run delayed into UTC tomorrow still belongs to the same Pacific day');
  const expired=await postDaily({now:new Date('2026-07-11T16:10:00Z'),
    scheduledAt:summer,env:liveEnv,fetchImpl:forbidden});
  assert.equal(expired.skipped,true,'never publish a stale Daily after next reset');
});

test('Bluesky uses a valid TID, external link card and one Discord no-mention post',async()=>{
  const requests=[];
  const fetchImpl=async(url,options)=>{
    const dest=String(url);
    requests.push({url:dest,options});
    if(dest.endsWith('com.atproto.server.createSession'))
      return Response.json({did:'did:plc:abc',accessJwt:'sensitive_jwt'});
    if(dest.includes('com.atproto.repo.getRecord'))
      return Response.json({error:'RecordNotFound'},{status:400});
    if(dest.endsWith('com.atproto.repo.createRecord'))
      return Response.json({uri:'at://did:plc:abc/app.bsky.feed.post/'+blueskyDailyRkey('2026-07-10')});
    if(dest.startsWith('https://discord.com/api/webhooks/'))
      return Response.json({id:'123'});
    throw Error('Unexpected API endpoint.');
  };
  const result=await postDaily({now:summer,fetchImpl,ledger:memoryLedger(),env:{
    ...liveEnv,BLUESKY_HANDLE:'packone.bsky.social',BLUESKY_APP_PASSWORD:'test_app_password',
  }});
  assert.equal(result.posted,2);
  assert.equal(requests.length,4);
  const recordCall=requests.find(r=>r.url.endsWith('com.atproto.repo.createRecord'));
  assert.ok(recordCall);
  const record=JSON.parse(recordCall.options.body);
  assert.equal(record.rkey,blueskyDailyRkey('2026-07-10'));
  assert.equal(record.record.$type,'app.bsky.feed.post');
  assert.equal(record.record.facets[0].features[0].uri,dailyCopy('2026-07-10','bluesky').url);
  assert.equal(record.record.embed.$type,'app.bsky.embed.external');
  const discordCall=requests.find(r=>r.url.startsWith('https://discord.com/api/webhooks/'));
  const discord=JSON.parse(discordCall.options.body);
  assert.deepEqual(discord.allowed_mentions,{parse:[]});
  assert.equal(discord.content,dailyCopy('2026-07-10','discord').text);
  assert.equal(discordCall.url.endsWith('?wait=true'),true);
});

test('Bluesky retry checks the existing record before posting a second time',async()=>{
  const copy=dailyCopy('2026-10-10');
  let posts=0;
  const result=await blueskyPublish(async(url)=>{
    if(String(url).includes('createSession'))
      return Response.json({did:'did:plc:abc',accessJwt:'jwt'});
    if(String(url).includes('getRecord'))
      return Response.json({value:{text:copy.text,
        facets:blueskyLinkFacets(copy.text,copy.url)}});
    posts++;
    return Response.json({uri:'unexpected'});
  },{handle:'x.bsky.social',password:'secret',day:'2026-10-10',
    ...copy,image:null});
  assert.equal(result,'already-posted');
  assert.equal(posts,0);
});

test('Bluesky does not silently accept arbitrary HTTP 400 errors as duplicates',async()=>{
  let reads=0;
  await assert.rejects(blueskyPublish(async(url)=>{
    if(String(url).includes('createSession'))
      return Response.json({did:'did:plc:abc',accessJwt:'jwt'});
    if(String(url).includes('getRecord')) {
      reads++;
      return Response.json({error:'RecordNotFound'},{status:400});
    }
    return Response.json({error:'InvalidRecord'},{status:400});
  },{handle:'x.bsky.social',password:'secret',day:'2026-10-10',
    ...dailyCopy('2026-10-10'),image:null}),/HTTP 400/);
  assert.equal(reads,2,'retry re-reads record before interpreting 400');
});

test('Discord retries HTTP 429 using retry-after and then succeeds',async()=>{
  let attempts=0;
  const sleeps=[];
  const result=await discordPublish(async()=>{
    attempts++;
    if(attempts===1)return new Response(null,{status:429,headers:{'retry-after':'0.05'}});
    return Response.json({id:'ok'});
  },webhook,{text:'Daily',image:null},{sleep:ms=>{sleeps.push(ms);}});
  assert.equal(result,'posted');
  assert.equal(attempts,2);
  assert.deepEqual(sleeps,[1000]);
});

test('Discord receipts prevent same-day duplicates on the later cron and a retry',async()=>{
  const ledger=memoryLedger();
  let publishes=0;
  const opts={env:{...liveEnv,GITHUB_RUN_ATTEMPT:'2'},ledger,
    fetchImpl:async()=>{publishes++;return Response.json({id:'ok'});}};
  const first=await postDaily({now:summer,...opts});
  const second=await postDaily({now:new Date('2026-07-10T16:10:00Z'),...opts});
  assert.equal(first.posted,1);
  assert.equal(second.posted,0);
  assert.equal(second.already_posted,1);
  assert.equal(publishes,1,'Discord never receives a duplicate');
});

test('Image 404 gracefully falls back to a text-only Discord post',async()=>{
  const calls=[];
  const res=await postDaily({now:summer,env:{
    ...liveEnv,
    DAILY_IMAGE_URL_TEMPLATE:'https://packone.pro/daily/{date}.png',
  },ledger:memoryLedger(),fetchImpl:async(url,options)=>{
    calls.push(String(url));
    if(String(url).endsWith('.png'))return new Response('',{status:404});
    assert.equal(JSON.parse(options.body).embeds,undefined);
    return Response.json({id:'123'});
  }});
  assert.equal(res.posted,1);
  assert.equal(res.image_included,false);
  assert.equal(calls.length,2);
});

test('Review workflows never publish from feature branches or cancel live dispatch',()=>{
  const yml=readFileSync('.github/workflows/daily-social-post.yml','utf8');
  assert.match(yml,/github\.ref == 'refs\/heads\/main'/);
  assert.match(yml,/issues: write/);
  assert.match(yml,/node-version: '24'/);
  assert.match(yml,/packone-social-review/);
  assert.match(yml,/packone-social-preview/);
  assert.match(yml,/packone-social-live/);
  assert.match(yml,/SOCIAL_LEDGER_ISSUE: '1135'/);
});

test('posted links use one stable daily_post campaign per channel',()=>{
  for(const channel of ['bluesky','discord']) {
    const url=new URL(dailyCopy('2026-10-10',channel).url);
    assert.equal(url.searchParams.get('utm_source'),channel);
    assert.equal(url.searchParams.get('utm_campaign'),'daily_post');
    assert.equal(url.searchParams.get('utm_medium'),'social');
  }
  assert.equal(dailyCopy('2026-10-10').url,dailyCopy('2026-10-11').url,'no per-day campaign values');
});

test('a Discord HTTP error lets the next scheduled trigger retry; a timeout does not',async()=>{
  const ledger=memoryLedger();
  let calls=0;
  const failing=async()=>{calls++;return new Response('{}',{status:500});};
  await assert.rejects(postDaily({now:summer,env:liveEnv,ledger,fetchImpl:failing}),/Discord server 1 failed \(HTTP 500\)/);
  const retried=await postDaily({now:new Date('2026-07-10T16:10:00Z'),env:liveEnv,ledger,
    fetchImpl:async()=>{calls++;return Response.json({id:'ok'});}});
  assert.equal(retried.posted,1,'the later trigger recovers a definite failure');
  assert.equal(calls,2);

  const unsure=memoryLedger();
  await assert.rejects(postDaily({now:summer,env:liveEnv,ledger:unsure,
    fetchImpl:async()=>{throw new TypeError('fetch failed');}}),/Discord server 1 failed/);
  await assert.rejects(postDaily({now:new Date('2026-07-10T16:10:00Z'),env:liveEnv,ledger:unsure,
    fetchImpl:async()=>Response.json({id:'never'})}),/Discord server 1 failed/,
    'an ambiguous delivery is never sent twice');
});

test('one invalid Discord entry is reported by position and does not block other channels',async()=>{
  const bad='https://ptb.discord.com/api/webhooks/2/secret_TOKEN';
  assert.deepEqual(discordWebhookEntries(bad+'\n'+webhook),{webhooks:[webhook],invalid:[1]});
  const posted=[];
  const error=await postDaily({now:summer,env:{...liveEnv,DISCORD_WEBHOOK_URLS:bad+'\n'+webhook},
    ledger:memoryLedger(),fetchImpl:async(url)=>{posted.push(String(url));return Response.json({id:'ok'});}})
    .then(()=>null,e=>e);
  assert.equal(posted.length,1,'the valid webhook still receives the Daily post');
  assert.match(error?.message||'',/Discord webhook entry 1 is invalid/);
  assert.doesNotMatch(error.message,/secret_TOKEN|ptb\.discord/);
});

test('winter schedule has a retry trigger after the 08:10 PST run',()=>{
  const yml=readFileSync('.github/workflows/daily-social-post.yml','utf8');
  for(const cron of ['10 15 * * *','10 16 * * *','10 17 * * *'])assert.ok(yml.includes(`cron: '${cron}'`),cron);
});
