import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pacificClock,dailyCopy,blueskyLinkFacets,discordWebhookList,dailyImageUrl,
  postDaily,blueskyPublish,
} from '../scripts/post-daily-social.mjs';

const summer=new Date('2026-07-10T15:10:00Z');
const winter=new Date('2026-01-10T16:10:00Z');
const webhook='https://discord.com/api/webhooks/123456789/token_ABC-def';

test('Pacific product day controls daylight and standard scheduled posts',()=>{
  assert.deepEqual(pacificClock(summer),{day:'2026-07-10',hour:8});
  assert.deepEqual(pacificClock(winter),{day:'2026-01-10',hour:8});
  assert.deepEqual(pacificClock(new Date('2026-07-10T16:10:00Z')),
    {day:'2026-07-10',hour:9});
  assert.deepEqual(pacificClock(new Date('2026-01-10T15:10:00Z')),
    {day:'2026-01-10',hour:7});
});

test('Daily copy is within Bluesky limit and facet has UTF-8 byte offsets',()=>{
  const {text,url}=dailyCopy('2026-10-10');
  assert.match(text,/Pack One Daily/);
  assert.match(text,/Powered Cube and Latest Set/);
  assert.match(text,/https:\/\/packone.pro\/\?game=draft-run&daily=1/);
  assert.ok([...text].length<=300);
  const facet=blueskyLinkFacets(text,url)[0];
  assert.equal(text.indexOf(url)>0,true);
  assert.equal(facet.index.byteStart,Buffer.byteLength(text.slice(0,text.indexOf(url))));
  assert.equal(facet.index.byteEnd-facet.index.byteStart,Buffer.byteLength(url));
});

test('Discord webhook list denies untrusted endpoints',()=>{
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

test('Manual run is offline dry-run with no network',async()=>{
  const result=await postDaily({now:summer,env:{DISCORD_WEBHOOK_URLS:webhook},
    fetchImpl:()=>{throw Error('Dry run accessed network.');}});
  assert.equal(result.dry_run,true);
  assert.equal(result.discord_servers,1);
  assert.match(result.text,/Daily/);
});

test('Only first scheduled 8 AM Pacific run posts',async()=>{
  const env={GITHUB_EVENT_NAME:'schedule',GITHUB_REF:'refs/heads/main',
    GITHUB_RUN_ATTEMPT:'1',DISCORD_WEBHOOK_URLS:webhook};
  const forbidden=()=>{throw Error('Off-hours scheduled traffic.');};
  assert.equal((await postDaily({now:new Date('2026-07-10T16:10:00Z'),
    env,fetchImpl:forbidden})).skipped,true);
  assert.equal((await postDaily({now:summer,
    env:{...env,GITHUB_RUN_ATTEMPT:'2'},fetchImpl:forbidden})).skipped,true);
  assert.equal((await postDaily({now:summer,
    env:{...env,GITHUB_REF:'refs/heads/unreviewed'},fetchImpl:forbidden})).skipped,true);
});

test('Publish sends one Bluesky record and one no-mention Discord message',async()=>{
  const requests=[];
  const fetchImpl=async(url,options)=>{
    requests.push({url:String(url),options});
    if(String(url).endsWith('com.atproto.server.createSession'))
      return Response.json({did:'did:plc:abc',accessJwt:'sensitive_jwt'});
    if(String(url).endsWith('com.atproto.repo.createRecord'))
      return Response.json({uri:'at://did:plc:abc/app.bsky.feed.post/packone-daily-2026-07-10'});
    if(String(url).startsWith('https://discord.com/api/webhooks/'))return Response.json({id:'123'});
    throw Error('Unexpected request destination.');
  };
  const result=await postDaily({now:summer,fetchImpl,env:{
    GITHUB_EVENT_NAME:'schedule',GITHUB_REF:'refs/heads/main',
    BLUESKY_HANDLE:'packone.bsky.social',BLUESKY_APP_PASSWORD:'test_app_password',
    DISCORD_WEBHOOK_URLS:webhook,
  }});
  assert.equal(result.posted,2);
  assert.equal(requests.length,3);
  // Channels publish concurrently; never assume their request order.
  const recordCall=requests.find(r=>r.url.endsWith('com.atproto.repo.createRecord'));
  const discordCall=requests.find(r=>r.url.startsWith('https://discord.com/api/webhooks/'));
  assert.ok(recordCall);
  assert.ok(discordCall);
  const record=JSON.parse(recordCall.options.body);
  assert.equal(record.rkey,'packone-daily-2026-07-10');
  assert.equal(record.record.$type,'app.bsky.feed.post');
  assert.equal(record.record.facets[0].features[0].uri,dailyCopy('2026-07-10').url);
  const discord=JSON.parse(discordCall.options.body);
  assert.deepEqual(discord.allowed_mentions,{parse:[]});
  assert.equal(discord.content,dailyCopy('2026-07-10').text);
  assert.equal(discordCall.url.endsWith('?wait=true'),true);
});

test('A duplicate Bluesky record is already-posted',async()=>{
  const result=await blueskyPublish(async(url)=>{
    if(String(url).includes('createSession'))return Response.json({
      did:'did:plc:abc',accessJwt:'jwt'});
    return new Response('',{status:409});
  },{handle:'x.bsky.social',password:'secret',day:'2026-10-10',
    ...dailyCopy('2026-10-10'),image:null});
  assert.equal(result,'already-posted');
});

test('Missing optional image does not prevent text-only post',async()=>{
  const calls=[];
  const res=await postDaily({now:summer,env:{
    GITHUB_EVENT_NAME:'schedule',GITHUB_REF:'refs/heads/main',
    DISCORD_WEBHOOK_URLS:webhook,
    DAILY_IMAGE_URL_TEMPLATE:'https://packone.pro/daily/{date}.png',
  },fetchImpl:async(url,options)=>{
    calls.push(String(url));
    if(String(url).endsWith('.png'))return new Response('',{status:404});
    assert.equal(JSON.parse(options.body).embeds,undefined);
    return Response.json({id:'123'});
  }});
  assert.equal(res.posted,1);
  assert.equal(res.image_included,false);
  assert.equal(calls.length,2);
});
