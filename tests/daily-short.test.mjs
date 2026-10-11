import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pacificDay,intendedDay,validateOpeningRun,clipTailStart,videoFilename,
  shortMetadata,youtubeReceiptMarker,INTRO_SECONDS,PACK_SECONDS,OUTRO_SECONDS,
  SHORT_SECONDS,TOTAL_FRAMES,TEMPLATE_VERSION,videoFilter} from '../scripts/daily-short.mjs';
import {BRAND,VIDEO_FRAME,introHtml,outroHtml,loadBrandAssets,verifyBrandedFrame} from '../scripts/render-daily-short-brand.mjs';
import {youtubeAccessToken,checkedUploadLocation,uploadVideo,youtubeReceipt} from '../scripts/upload-daily-short.mjs';

const day='2026-10-10';
const fullRun={day,environment:'mixed',run_length:8,answers:[],complete:false,
  current:{puzzle_id:'f058bb854e7df6bbaf76258f2ba3c553',set_id:'msh',
    candidates:Array.from({length:14},(_,i)=>({id:`card-${i}`,image_url:`https://cards.scryfall.io/c${i}.jpg`}))}};

test('Pacific date changes at midnight Pacific, not at midnight UTC (DST and winter)',()=>{
  assert.equal(pacificDay(new Date('2026-10-11T05:00:00Z')),day);
  assert.equal(pacificDay(new Date('2026-10-11T07:00:00Z')),'2026-10-11');
  assert.equal(pacificDay(new Date('2026-01-11T07:59:00Z')),'2026-01-10');
  assert.equal(pacificDay(new Date('2026-01-11T08:00:00Z')),'2026-01-11');
});
test('Scheduled retries cannot record a new day using yesterday\'s trigger',()=>{
  const now=new Date('2026-10-11T17:00:00Z');
  assert.equal(intendedDay({now,event:'schedule',scheduledAt:new Date('2026-10-10T16:40:00Z')}),null);
  assert.equal(intendedDay({now,event:'schedule',scheduledAt:new Date('2026-10-11T16:40:00Z')}),'2026-10-11');
  assert.equal(intendedDay({now,event:'pull_request'}),'2026-10-11');
  assert.equal(intendedDay({now,event:'schedule'}),null);
});
test('Capture must be the unplayed main Daily with a complete first pack',()=>{
  assert.deepEqual(validateOpeningRun(fullRun,day),{day,environment:'mixed',
    puzzle_id:fullRun.current.puzzle_id,set_id:'msh',cards:14});
  for(const changed of [
    {day:'2026-10-09'},{environment:'powered-cube'},{complete:true},
    {answers:[{score:100}]},{current:{puzzle_id:'test',candidates:[]}},{run_length:10},
  ])assert.throws(()=>validateOpeningRun({...fullRun,...changed},day),/Live main Daily/);
});
test('Approved brand/pack/CTA timing is 1.5 + 6.5 + 2.0 seconds (300 frames)',()=>{
  assert.equal(INTRO_SECONDS,1.5);
  assert.equal(PACK_SECONDS,6.5);
  assert.equal(OUTRO_SECONDS,2);
  assert.equal(INTRO_SECONDS+PACK_SECONDS+OUTRO_SECONDS,SHORT_SECONDS);
  assert.equal(SHORT_SECONDS,10);
  assert.equal(TOTAL_FRAMES,300);
  assert.equal(TEMPLATE_VERSION,'branded-real-pack-v1');
  const graph=videoFilter(3.14);
  assert.match(graph,/trim=duration=1\.5/);
  assert.match(graph,/trim=start=3\.140:duration=6\.5/);
  assert.match(graph,/trim=duration=2/);
  assert.match(graph,/concat=n=3:v=1:a=0/);
  assert.throws(()=>videoFilter(-1),/start/);
  assert.equal(clipTailStart(10,6.5).toFixed(2),'3.42');
  assert.throws(()=>clipTailStart(6.5,6.5),/shorter/);
  assert.equal(videoFilename(day),'packone-daily-2026-10-10-10s.mp4');
});
test('YouTube title, description and receipt never spoil the trophy pick',()=>{
  const metadata=shortMetadata(day);
  assert.match(metadata.snippet.title,/#Shorts/);
  assert.match(metadata.snippet.description,/utm_source=youtube/);
  assert.match(metadata.snippet.description,/game=draft-run&daily=1/);
  assert.equal(metadata.status.privacyStatus,'public');
  assert.doesNotMatch(JSON.stringify(metadata),/trophy.*(pick|card)|correct.*answer/i);
  assert.equal(youtubeReceiptMarker(day),'packone-daily-youtube:2026-10-10\n');
  assert.throws(()=>videoFilename('2026-02-30'),/date/);
});
test('OAuth exchange submits refresh credentials only to the official token endpoint',async()=>{
  let requests=0;
  const token=await youtubeAccessToken({clientId:'id',clientSecret:'secret',refreshToken:'refresh',
    fetchImpl:async(url,options)=>{
      requests++;
      assert.equal(url,'https://oauth2.googleapis.com/token');
      assert.equal(options.method,'POST');
      assert.equal(options.body.get('grant_type'),'refresh_token');
      return Response.json({access_token:'realistic_fake_access_token'});
    }});
  assert.equal(requests,1);
  assert.equal(token,'realistic_fake_access_token');
});
test('YouTube upload is resumable and the destination hostname is pinned',async()=>{
  assert.throws(()=>checkedUploadLocation('https://www.googleapis.com.attacker.test/upload/youtube/v3/videos?id=1'),/untrusted/);
  assert.throws(()=>checkedUploadLocation('http://www.googleapis.com/upload/youtube/v3/videos'),/untrusted/);
  const calls=[];
  const value=await uploadVideo({accessToken:'fake',day,bytes:new Uint8Array(110000),fetchImpl:async(url,options)=>{
    calls.push({url,options});
    if(calls.length===1)return new Response(null,{status:200,
      headers:{location:'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=fake'}});
    assert.equal(options.method,'PUT');
    assert.equal(options.body.byteLength,110000);
    return Response.json({id:'1a2B3c4D5e6',status:{privacyStatus:'private'}});
  }});
  assert.equal(value.id,'1a2B3c4D5e6');
  assert.equal(value.visibility,'private');
  const metadata=JSON.parse(calls[0].options.body);
  assert.equal(metadata.status.privacyStatus,'public');
  assert.match(calls[0].url,/uploadType=resumable/);
});
test('Receipt supports posted dedupe and blocks uncertain duplicate YouTube upload',async()=>{
  // The ledger uses GitHub's existing issue #1135 and only trusts github-actions[bot].
  const workflow=readFileSync('.github/workflows/daily-youtube-short.yml','utf8');
  assert.match(workflow,/issues: write/);
  assert.match(workflow,/needs.record.outputs.recorded == 'true'/);
  assert.match(workflow,/github.ref == 'refs\/heads\/main'/);
  assert.match(workflow,/vars\.PACKONE_YOUTUBE_UPLOAD_PAUSED != 'true'/);
  assert.doesNotMatch(workflow,/vars\.PACKONE_YOUTUBE_UPLOAD_ENABLED/);
  assert.match(workflow,/inputs\.publish == true/);
  assert.match(workflow,/retention-days: 5/);
  const capture=readFileSync('scripts/record-daily-short.mjs','utf8');
  assert.match(capture,/\.run-cards \.run-card-select img/);
  assert.match(capture,/naturalWidth>100/);
  assert.doesNotMatch(capture,/\.click\(\).*run-card-select|#run-lock'\)\.click/);
  assert.match(capture,/recordVideo/);
  assert.match(capture,/renderBrandedFrames/);
  assert.match(capture,/videoFilter/);
  assert.match(capture,/template_version:TEMPLATE_VERSION/);
  assert.match(workflow,/render-daily-short-brand\.mjs/);
});
test('Canonical brand assets are the repo-owned P¹ vector and Pack One web fonts',async()=>{
  const paths=[];
  const brand=await loadBrandAssets({read:async file=>{
    paths.push(file);
    return file.endsWith('.svg')?Buffer.from('<svg fill="#1e4d7a"></svg>'):
      Buffer.alloc(25000,0);
  }});
  assert.ok(paths.some(path=>path.endsWith('mobile/assets/images/brand-mark.svg')));
  for(const ending of ['barlow-condensed-600.woff2','barlow-condensed-700.woff2',
    'source-sans-3-400.woff2','source-sans-3-700.woff2'])
    assert.ok(paths.some(path=>path.endsWith(ending)),ending);
  assert.ok(brand.logo.startsWith('data:image/svg+xml;base64,'));
  assert.equal(BRAND.blue,'#1e4d7a');
  assert.equal(BRAND.page,'#f7f8fa');
  assert.deepEqual(VIDEO_FRAME,{width:1080,height:1920});
});

test('Intro and outro are per-day browser templates with real logo, screenshot and fully visible CTA',()=>{
  const assets={logo:'data:image/svg+xml;base64,abc',display:'data:font/woff2;base64,abc',
    displayBold:'data:font/woff2;base64,abc',body:'data:font/woff2;base64,abc',
    bodyBold:'data:font/woff2;base64,abc'};
  const image='data:image/png;base64,abc';
  const intro=introHtml({assets,homeScreenshot:image,day});
  assert.match(intro,/TODAY'S/);
  assert.match(intro,/DRAFT/);
  assert.match(intro,/Eight picks\. Your call\./);
  assert.match(intro,/data-brand-mark/);
  assert.match(intro,/data-duration="1\.5"/);
  assert.match(intro,/Pack One Display/);
  assert.match(intro,/2026-10-10/);
  const outro=outroHtml({assets,packScreenshot:image,day});
  assert.match(outro,/WHAT WOULD YOU PICK\?/);
  assert.match(outro,/PLAY AT PACKONE\.PRO/);
  assert.match(outro,/data-duration="2"/);
  assert.match(outro,/Real first pack/);
  assert.match(outro,/2026-10-10/);
  assert.throws(()=>outroHtml({assets,packScreenshot:'fake',day}),/data:image/);
});

test('Layout guard rejects clipped PLAY label and missing actual logo/card image',async()=>{
  const box=(left,right,top=100,bottom=200)=>({left,right,top,bottom,x:left,y:top,width:right-left,height:bottom-top});
  const valid={day,clip:'outro',images:1,imagesReady:true,fontsReady:true,
    cta:box(35,1045),action:box(175,905),label:box(242,792),arrow:box(814,860),
    question:box(105,975),bodyScrollWidth:1080};
  assert.equal((await verifyBrandedFrame({evaluate:async()=>valid},'outro',day)).imagesReady,true);
  await assert.rejects(verifyBrandedFrame({evaluate:async()=>({...valid,label:box(20,792)})},'outro',day),/clipped/);
  await assert.rejects(verifyBrandedFrame({evaluate:async()=>({...valid,imagesReady:false})},'outro',day),/did not load/);
  await assert.rejects(verifyBrandedFrame({evaluate:async()=>({...valid,clip:'intro',images:2,logo:null})},'intro',day),/logo missing/);
});
