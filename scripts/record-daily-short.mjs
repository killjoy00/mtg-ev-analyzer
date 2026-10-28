// Record the actual packone.pro site and actual fully decoded card art.
// Never click a pick, lock it, or render a trophy reveal. No synthetic card images.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {SITE_URL,DAILY_URL,INTRO_SECONDS,PACK_SECONDS,OUTRO_SECONDS,SHORT_SECONDS,
  TEMPLATE_VERSION,TOTAL_FRAMES,videoFilter,intendedDay,validateOpeningRun,clipTailStart,videoFilename} from './daily-short.mjs';
import {renderBrandedFrames} from './render-daily-short-brand.mjs';

const execFileAsync=promisify(execFile);
const FRAME={width:540,height:960}; // Native 9:16 phone viewport, three real card columns.
const ARTIFACT_DIR='artifacts/daily-short';
export const QA_PLAYER_NAME='QA Daily Short';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// The opening pack is round 1: the current step in the run header.
const currentRound=page=>page.locator('.run-heading .run-steps [aria-current="step"]').getAttribute('aria-label');

async function imagesReady(page,count) {
  await page.locator('.run-cards .run-card-select img').first().waitFor({state:'visible',timeout:45_000});
  await page.waitForFunction(n=>{
    const images=[...document.querySelectorAll('.run-cards .run-card-select img')];
    for(const img of images)img.loading='eager';
    return images.length===n && images.every(img=>img.complete&&img.naturalWidth>100&&img.naturalHeight>100);
  },count,{timeout:50_000});
  await page.evaluate(async()=>{
    await Promise.all([...document.querySelectorAll('.run-cards .run-card-select img')].map(img=>img.decode()));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
  assert.equal(await page.locator('.run-cards .run-card-select img').count(),count);
  assert.equal(await page.locator('.run-card-fallback').count(),0,'Missing actual card art is a hard failure.');
  assert.equal(await page.locator('.run-feedback').count(),0,'Never show the trophy reveal.');
  assert.equal(await page.locator('#run-lock').isDisabled(),true,'Never make a draft choice.');
}
async function homepageReady(page,day) {
  await page.goto(SITE_URL,{waitUntil:'domcontentloaded',timeout:45_000});
  const date=page.locator('.daily-home-heading time[datetime]');
  await date.waitFor({state:'visible',timeout:45_000});
  assert.equal(await date.getAttribute('datetime'),day,'Homepage is showing a different Pacific Daily.');
  await page.locator('.daily-home-game[data-environment="mixed"] a').waitFor({state:'visible'});
}
async function startGuestDaily(page,day) {
  await homepageReady(page,day);
  const response=page.waitForResponse(r=>{
    try{return new URL(r.url()).pathname.endsWith('/v1/runs')&&r.request().method()==='POST';}
    catch{return false;}
  },{timeout:45_000});
  await page.locator('.daily-home-game[data-environment="mixed"] a').click();
  const reply=await response;
  if(!reply.ok())throw Error(`Live Daily start returned HTTP ${reply.status()}.`);
  const state=await reply.json();
  const manifest=validateOpeningRun(state,day);
  await imagesReady(page,manifest.cards);
  assert.equal(await currentRound(page),'Round 1');
  return manifest;
}
async function recordHome(context,day,output) {
  const page=await context.newPage();
  const file=path.join(output,'homepage.png');
  try {
    await homepageReady(page,day);
    await page.screenshot({path:file});
  } finally {await page.close();}
  return file;
}
async function recordPack(context,day,count,output) {
  const page=await context.newPage();
  const video=page.video();
  try {
    await page.goto(DAILY_URL,{waitUntil:'domcontentloaded',timeout:45_000});
    await imagesReady(page,count);
    const heading=await page.locator('.run-heading').innerText();
    assert.ok(heading.includes(day)&&await currentRound(page)==='Round 1','Recorded view is not the opening Daily pack.');
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:path.join(output,'first-pack.png')});
    const started=Date.now();
    await sleep(1_500);
    await page.evaluate(async()=>{
      const grid=document.querySelector('.run-cards');
      if(!grid)throw Error('Missing card grid.');
      const bottom=grid.getBoundingClientRect().bottom+window.scrollY;
      const from=window.scrollY;
      const target=Math.max(from,bottom-window.innerHeight+120);
      const duration=4_800;
      const begin=performance.now();
      await new Promise(resolve=>{
        function tick(now) {
          const progress=Math.min(1,(now-begin)/duration);
          // Browser-native scrolling reveals the real, unchanged card grid.
          window.scrollTo(0,from+(target-from)*progress);
          if(progress<1)requestAnimationFrame(tick);else resolve();
        }
        requestAnimationFrame(tick);
      });
    });
    await sleep(Math.max(0,7_400-(Date.now()-started)));
    await page.screenshot({path:path.join(output,'first-pack-bottom.png')});
    assert.equal(await page.locator('.run-feedback').count(),0);
    assert.equal(await page.locator('#run-lock').isDisabled(),true);
  } finally {await page.close();}
  return video.path();
}
async function duration(file) {
  const {stdout}=await execFileAsync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file]);
  return Number(stdout.trim());
}
async function compose(intro,pack,outro,out) {
  const packTime=await duration(pack);
  const packStart=clipTailStart(packTime,PACK_SECONDS);
  const args=['-hide_banner','-loglevel','error','-y',
    '-loop','1','-framerate','30','-i',intro,'-i',pack,
    '-loop','1','-framerate','30','-i',outro,
    '-filter_complex',videoFilter(packStart),'-map','[out]',
    '-frames:v',String(TOTAL_FRAMES),'-an','-c:v','libx264',
    '-preset','fast','-crf','21','-movflags','+faststart',out];
  await execFileAsync('ffmpeg',args,{timeout:120_000});
  const finalDuration=await duration(out);
  if(Math.abs(finalDuration-SHORT_SECONDS)>0.07)
    throw Error(`Rendered branded MP4 is not 10 seconds (${finalDuration}s).`);
  const {stdout}=await execFileAsync('ffprobe',['-v','error','-select_streams','v:0',
    '-count_frames','-show_entries','stream=width,height,nb_read_frames',
    '-of','default=noprint_wrappers=1',out]);
  if(!/width=1080\b/.test(stdout)||!/height=1920\b/.test(stdout)||
     !new RegExp(`nb_read_frames=${TOTAL_FRAMES}\\b`).test(stdout))
    throw Error(`Branded MP4 failed resolution / frame-count check: ${stdout.trim()}`);
}
async function scheduledOriginalTime() {
  const {GITHUB_REPOSITORY:repo,GITHUB_RUN_ID:runId,GITHUB_TOKEN:token}=process.env;
  if(repo!=='killjoy00/mtg-ev-analyzer'||!/^[0-9]+$/.test(runId||'')||!token)
    throw Error('Scheduled Daily recording provenance is missing.');
  const response=await fetch(`https://api.github.com/repos/${repo}/actions/runs/${runId}`,{
    headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15_000),
  });
  if(!response.ok)throw Error(`Cannot verify scheduled Daily timestamp (HTTP ${response.status}).`);
  const data=await response.json();
  if(data.event!=='schedule'||Number.isNaN(Date.parse(data.created_at)))
    throw Error('Scheduled run metadata is invalid.');
  return new Date(data.created_at);
}
async function writeOutput(recorded,day='') {
  if(process.env.GITHUB_OUTPUT)
    await writeFile(process.env.GITHUB_OUTPUT,`recorded=${recorded}\nday=${day}\n`,{flag:'a'});
}
export async function recordDaily() {
  const event=process.env.GITHUB_EVENT_NAME||'workflow_dispatch';
  const day=intendedDay({event,scheduledAt:event==='schedule'?await scheduledOriginalTime():null});
  if(!day) {console.log('Skipping a scheduled run from a previous Pacific Daily.');await writeOutput(false);return;}
  if(event==='schedule' && process.env.GITHUB_REF!=='refs/heads/main')
    throw Error('Scheduled Daily recordings must use main.');
  const temp=await mkdtemp(path.join(tmpdir(),'packone-real-short-'));
  await mkdir(ARTIFACT_DIR,{recursive:true});
  let browser=null,context=null;
  try {
    browser=await chromium.launch({headless:true});
    context=await browser.newContext({viewport:FRAME,deviceScaleFactor:1,locale:'en-US',
      timezoneId:'America/Los_Angeles',colorScheme:'light',recordVideo:{dir:temp,size:FRAME}});
    // A "QA" guest name marks this automated Daily as QA traffic, so admin
    // metrics, measurements and leaderboards exclude it like other prod checks.
    await context.addInitScript(name=>{try{localStorage.setItem('pack1-player-name-v1',name);}catch{}},QA_PLAYER_NAME);
    // Warm the original site, guest session and every real card asset before recording.
    const warm=await context.newPage();
    let manifest;
    try {manifest=await startGuestDaily(warm,day);} finally {await warm.close();}
    const home=await recordHome(context,day,ARTIFACT_DIR);
    const pack=await recordPack(context,day,manifest.cards,ARTIFACT_DIR);
    await context.close();context=null;
    const stills=await renderBrandedFrames(browser,{output:ARTIFACT_DIR,day,
      homePath:home,packPath:path.join(ARTIFACT_DIR,'first-pack.png')});
    const file=path.join(ARTIFACT_DIR,videoFilename(day));
    await compose(stills.intro,pack,stills.outro,file);
    await writeFile(path.join(ARTIFACT_DIR,'capture.json'),JSON.stringify({...manifest,
      captured_at:new Date().toISOString(),duration_seconds:SHORT_SECONDS,
      template_version:TEMPLATE_VERSION,intro_seconds:INTRO_SECONDS,pack_seconds:PACK_SECONDS,
      outro_seconds:OUTRO_SECONDS,frames:TOTAL_FRAMES,
      source:DAILY_URL,real_browser_capture:true,spoiler_free:true},null,2)+'\n');
    await writeOutput(true,day);
    console.log(JSON.stringify({recorded:true,day,puzzle_id:manifest.puzzle_id,cards:manifest.cards,
      output:file,duration_seconds:SHORT_SECONDS,template_version:TEMPLATE_VERSION,real_card_images:true}));
  } finally {
    if(context)await context.close().catch(()=>{});
    if(browser)await browser.close().catch(()=>{});
    await rm(temp,{recursive:true,force:true});
  }
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  recordDaily().catch(error=>{console.error(`Daily screen recording failed: ${error.message}`);process.exitCode=1;});
}