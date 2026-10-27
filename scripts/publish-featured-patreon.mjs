// Publish Pack One's rendered featured pick through Patreon's creator UI.
// Patreon has no supported post-writing API. This uses normal UI controls only;
// never bypasses login challenges, accesses undocumented endpoints, or logs browser state.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {PATREON_POLICY} from '../patreon-policy.mjs';
import {featureCopies,previousPacificDay,pacificDay} from './featured-pick.mjs';
import {assertCurrentLivePublisher} from './post-daily-social.mjs';
import {createGithubReceiptLedger,discordReceiptKey} from './daily-social-ledger.mjs';

const DIR='artifacts/featured-pick';
const POST_API='https://www.patreon.com/api/oauth2/v2/';
const LEDGER_CHANNEL=discordReceiptKey('featured-patreon-public-v1');
const POST_TITLE_SUFFIX=' | Pack One Daily ';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const PATREON_BROWSERLESS_PROFILE='packone-patreon';

export function makePatreonPost({feature:f,copy,render,cover}) {
 if(!f||!/^20\d\d-\d\d-\d\d$/.test(f.day||'')||
    ![2,3].includes(f.tier)||!Array.isArray(f.choices)||
    f.choices.length!==f.tier||!f.choices.some(c=>c.id===f.trophy?.id)||
    JSON.stringify(featureCopies(f))!==JSON.stringify(copy)||
    render?.day!==f.day||render?.puzzle_id!==f.puzzle_id||
    render?.real_card_art!==true||render?.poster_ready!==true||
    !Buffer.isBuffer(cover)||cover.length<5000||
    cover[0]!==0xff||cover[1]!==0xd8||cover[2]!==0xff)
  throw Error('invalid-featured-artifact');
 const title=copy.title+POST_TITLE_SUFFIX+f.day;
 if(title.length>150||!copy.patreon.startsWith('# '+copy.title+'\n\n'))
  throw Error('invalid-patreon-copy');
 // Patreon uses a rich-text editor, not a Markdown parser. Paste readable text.
 const body=copy.patreon.slice(('# '+copy.title+'\n\n').length)
  .replace(/\*\*/g,'').replace(/^- /gm,'• ').trim();
 if(!body.includes(f.day)||!body.includes(f.trophy.name)||
    !body.includes('https://packone.pro/'))
  throw Error('missing-patreon-provenance');
 return {day:f.day,title,body,cover,public:true};
}

export function parsePatreonStorageState(base64) {
 if(typeof base64!=='string'||base64.length<50||base64.length>250000||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
  throw Error('patreon-session-missing-or-invalid');
 let state;
 try {state=JSON.parse(Buffer.from(base64,'base64').toString('utf8'));}
 catch {throw Error('patreon-session-missing-or-invalid');}
 if(!Array.isArray(state?.cookies)||!Array.isArray(state?.origins)||
    !state.cookies.some(c=>typeof c?.domain==='string'&&
      /(^|\.)patreon\.com$/.test(c.domain)&&typeof c.value==='string'&&c.value))
  throw Error('patreon-session-missing-or-invalid');
 return state;
}

function safePostUrl(input) {
 try {
  if(typeof input!=='string')return null;
  const url=new URL(input,'https://www.patreon.com');
  return url.origin==='https://www.patreon.com'&&
    /^\/posts\//.test(url.pathname)&&!url.username&&!url.password?url.toString():null;
 } catch {return null;}
}

// Read-only, supported API for exact-title deduplication and publish confirmation.
// A failed or incomplete search must never be interpreted as "safe to post".
export async function findPublishedPatreonPost({title,token,
 campaignId=PATREON_POLICY.campaignId,fetchImpl=fetch}) {
 if(!token||!/^\d+$/.test(String(campaignId)))throw Error('patreon-post-read-not-configured');
 const initial=new URL('campaigns/'+campaignId+'/posts',POST_API);
 initial.searchParams.set('fields[post]','title,is_public,published_at,url');
 initial.searchParams.set('page[count]','100');
 let next=initial.toString(),pages=0;
 const visited=new Set(),matches=[];
 while(next) {
  const url=new URL(next,POST_API);
  if(url.origin!=='https://www.patreon.com'||
     url.pathname!==initial.pathname||visited.has(url.toString())||++pages>10)
   throw Error('patreon-post-search-incomplete');
  visited.add(url.toString());
  const response=await fetchImpl(url.toString(),{
   headers:{authorization:'Bearer '+token,accept:'application/json',
    'user-agent':'Pack One featured publisher'},
   redirect:'error',signal:AbortSignal.timeout(25000),
  });
  if(!response.ok)throw Error('patreon-post-read-failed-'+response.status);
  const page=await response.json();
  if(!Array.isArray(page?.data))throw Error('patreon-post-read-malformed');
  for(const item of page.data) {
   if(item?.attributes?.title!==title)continue;
   const a=item.attributes;
   if(!a.published_at||a.is_public!==true||!safePostUrl(a.url)) {
    const error=Error('patreon-existing-post-not-verified-public');
    error.verificationReason=!a.published_at?'unpublished':
     a.is_public!==true?'not-public':'url-invalid';
    throw error;
   }
   matches.push({id:item.id,url:safePostUrl(a.url)});
  }
  if(matches.length>1)throw Error('patreon-duplicate-posts-detected');
  next=page.links?.next||null;
  const cursor=page.meta?.pagination?.cursors?.next;
  if(!next&&cursor) {
   const nextUrl=new URL(initial);
   nextUrl.searchParams.set('page[cursor]',cursor);
   next=nextUrl.toString();
  }
 }
 return matches[0]||null;
}

async function tryControl(page,specs,timeoutMs=1800) {
 const until=Date.now()+timeoutMs;
 do {
  for(const spec of specs) {
   const loc=spec(page);
   if(await loc.count()===1&&await loc.isVisible())return loc;
  }
  if(Date.now()>=until)break;
  await pause(250);
 } while(true);
 return null;
}
async function findControl(page,specs,label) {
 const found=await tryControl(page,specs,12000);
 if(found)return found;
 throw Error('patreon-editor-'+label+'-unavailable');
}
const role=(type,name)=>page=>page.getByRole(type,{name});
const textExact=s=>page=>page.getByText(s,{exact:true});
const css=s=>page=>page.locator(s);
async function safeStage(name,fn) {
 try {return await fn();}
 catch {throw Error('patreon-editor-'+name+'-failed');}
}

// Accessible controls are deliberately restrictive. Unknown redesigns fail closed,
// instead of clicking a nearby paid-access option or publishing empty content.
export function browserlessEndpoint(token,profile) {
 if(typeof token!=='string'||!/^[-_a-zA-Z0-9]{12,256}$/.test(token))
  throw Error('patreon-browserless-token-invalid');
 if(profile!==undefined&&(!/^[A-Za-z0-9_-]{1,64}$/.test(profile)))
  throw Error('patreon-browserless-profile-invalid');
 return 'wss://production-sfo.browserless.io?token='+encodeURIComponent(token)+
  (profile?'&profile='+encodeURIComponent(profile)+'&timeout=120000':'');
}

export async function openPatreonBrowser({state,browserlessToken,profile,chromiumImpl}) {
 if(profile&&(!browserlessToken||state))throw Error('patreon-profile-configuration-invalid');
 const chromium=chromiumImpl||(await import('playwright')).chromium;
 const browser=browserlessToken
  ? await chromium.connectOverCDP(browserlessEndpoint(browserlessToken,profile))
  : await chromium.launch({headless:true});
 try {
  // A saved Browserless profile is loaded only in the existing default context.
  // newContext() would silently discard its authenticated cookies and storage.
  const context=profile?browser.contexts()[0]:
   await browser.newContext({storageState:state,acceptDownloads:false});
  if(!context)throw Error('patreon-profile-context-unavailable');
  const page=await context.newPage();
  page.setDefaultTimeout(12000);
  return {browser,context,page};
 } catch(error) {await browser.close().catch(()=>{});throw error;}
}

export async function assertPatreonCreator(page) {
   await page.goto('https://www.patreon.com/',{waitUntil:'domcontentloaded',timeout:30000});
   if(!/(^|\.)patreon\.com$/.test(new URL(page.url()).hostname)||
      /login|auth|challenge|captcha/i.test(page.url()))
    throw Error('patreon-login-required');
   // This is the signed-in creator's own-page navigation, not an arbitrary
   // Pack One link on a public page. Unknown navigation fails closed.
   const own=await findControl(page,[role('link',/^My page$/i)],'creator-identity');
   const url=new URL(await own.getAttribute('href'),page.url());
   if(url.origin!=='https://www.patreon.com'||
      !['/c/PackOne','/PackOne'].includes(url.pathname.replace(/\/$/,'')))
    throw Error('patreon-creator-mismatch');
}

export async function publishInPatreonEditor({post,state,onSubmit=()=>{},profile,
 browserlessToken=process.env.PACKONE_BROWSERLESS_TOKEN}) {
 const {browser,context,page}=await openPatreonBrowser({state,browserlessToken,profile});
 try {
  await safeStage('open',()=>assertPatreonCreator(page));
  await safeStage('create',async()=>{
   const button=await findControl(page,[
    role('button',/^Create(?: post)?$/i),role('link',/^Create(?: post)?$/i),
   ],'create');
   await button.click();
   const postControl=await tryControl(page,[
    role('menuitem',/^Post$/i),role('link',/^Post$/i),role('button',/^Post$/i),
   ]);
   if(postControl)await postControl.click();
  });
  await safeStage('image-type',async()=>{
   const image=await findControl(page,[
    role('tab',/^Image$/i),role('button',/^Image$/i),
    textExact('Image'),
   ],'image-tab');
   await image.click();
  });
  await safeStage('image-upload',async()=>{
   const before=await page.evaluate(()=>Array.from(document.images)
    .filter(img=>img.complete&&img.naturalWidth>=320&&img.naturalHeight>=160).length);
   // File inputs are normally hidden. Playwright can set their files without
   // opening an OS dialog; do not apply isVisible() to a file input.
   const chooseFile=async()=>{
    for(const selector of ['input[type="file"][accept*="image"]','input[type="file"]']) {
     const loc=page.locator(selector);
     if(await loc.count()===1)return loc;
    }
    return null;
   };
   const imageFile={name:'featured-cover.jpg',mimeType:'image/jpeg',
    buffer:post.cover};
   const input=await chooseFile();
   if(input)await input.setInputFiles(imageFile);
   else {
    const browse=await findControl(page,[role('button',/^Browse$/i),
     role('button',/^Upload images?$/i),textExact('Browse')],'image-picker');
    // Use Playwright's documented chooser event instead of an unattended OS dialog.
    const [chooser]=await Promise.all([
     page.waitForEvent('filechooser',{timeout:12000}),browse.click(),
    ]);
    await chooser.setFiles(imageFile);
   }
   await page.waitForFunction(n=>Array.from(document.images).some(img=>
    img.complete&&img.naturalWidth>=320&&img.naturalHeight>=160)&&
    Array.from(document.images).filter(img=>
     img.complete&&img.naturalWidth>=320&&img.naturalHeight>=160).length>n,
    before,{timeout:45000});
  });
  await safeStage('title',async()=>{
   const title=await findControl(page,[role('textbox',/^Title$/i),
    page=>page.getByPlaceholder(/title/i),css('input[name="title"]'),
    css('textarea[name="title"]')],'title');
   await title.fill(post.title);
   if(await title.inputValue()!==post.title)throw Error('title-not-retained');
  });
  await safeStage('body',async()=>{
   const body=await findControl(page,[role('textbox',/^(?:Content|Description|Body|Post body)$/i),
    page=>page.getByPlaceholder(/write|description|post content/i),
    css('[contenteditable="true"][role="textbox"]'),
    css('[contenteditable="true"]')],'body');
   await body.fill(post.body);
   const entered=await body.textContent();
   if(!entered||!entered.includes(post.day)||!entered.includes('packone.pro'))
    throw Error('body-not-retained');
  });
  await safeStage('free-access',async()=>{
   const audience=await tryControl(page,[
    role('button',/^(?:Audience|Free access|Paid access)(?:.*)?$/i),
   ]);
   if(audience)await audience.click();
   const free=await tryControl(page,[
    role('radio',/^Free access$/i),role('option',/^Free access$/i),
    role('menuitemradio',/^Free access$/i),
    role('button',/^Free access$/i),textExact('Free access'),
   ]);
   if(!free)throw Error('cannot-set-free-access');
   await free.click();
   const shown=await tryControl(page,[textExact('Free access')]);
   if(!shown)throw Error('free-access-not-visible');
  });
  await safeStage('publish',async()=>{
   const publish=await findControl(page,[role('button',/^Publish(?: now)?$/i)],
    'publish');
   onSubmit(); // After this point any error may represent an already-published post.
   await publish.click();
   const dialog=page.getByRole('dialog');
   if(await dialog.count()===1&&await dialog.isVisible()) {
    const confirm=await tryControl(dialog,[
     d=>d.getByRole('button',{name:/^Publish(?: now)?$/i}),
    ]);
    if(confirm)await confirm.click();
   }
  });
  // Persist normal session-cookie rotation without exporting state to GitHub,
  // the Admin page, logs or artifacts. This never supplies login credentials.
  if(profile) {
   const cdp=await context.newCDPSession(page);
   const result=await cdp.send('Browserless.saveProfile',{name:profile});
   if(result?.ok!==true)throw Error('patreon-profile-refresh-failed');
  }
  return {submitted:true};
 } finally {await browser.close();}
}

export async function publishFeaturedPatreon({env=process.env,fetchImpl=fetch,
 read=readFile,now=new Date(),editor=publishInPatreonEditor,
 ledgerFactory=createGithubReceiptLedger,findPost=findPublishedPatreonPost,
 sleep=pause,assertLive=assertCurrentLivePublisher,
 connectionCheck=async options=>(await import('./check-patreon-publishing.mjs')).checkPatreonPublishing(options),
 verifyPublic=verifyPublicPatreonPost}={}) {
 const automatic=env.PACKONE_PATREON_AUTO_ACTIVATE==='true'&&
  env.PACKONE_PATREON_AUTOPUBLISH_ENABLED!=='false';
 if(env.PACKONE_PATREON_AUTOPUBLISH_ENABLED!=='true'&&!automatic)
  return {skipped:true,reason:'patreon-autopublish-not-activated'};
 if(env.GITHUB_REPOSITORY!=='killjoy00/mtg-ev-analyzer'||
    env.GITHUB_REF!=='refs/heads/main'||
    !['schedule','workflow_dispatch','push'].includes(env.GITHUB_EVENT_NAME))
  throw Error('patreon-live-main-only');
 if(env.SOURCE_PACIFIC_DAY&&env.SOURCE_PACIFIC_DAY!==pacificDay(now))
  return {skipped:true,reason:'stale-pacific-dispatch'};
 await assertLive({env,fetchImpl});
 if(automatic&&env.PACKONE_PATREON_AUTOPUBLISH_ENABLED!=='true') {
  try {await connectionCheck({env,fetchImpl});}
  catch(error) {
   if(error.message==='patreon-browser-profile-missing')
    return {skipped:true,reason:'patreon-waiting-for-one-time-sign-in'};
   throw error;
  }
 }

 const data=JSON.parse(await read(DIR+'/pick.json','utf8'));
 const render=JSON.parse(await read(DIR+'/render.json','utf8'));
 const cover=await read(DIR+'/featured-cover.jpg');
 const post=makePatreonPost({...data,render,cover});
 if(post.day!==previousPacificDay(now))throw Error('patreon-featured-day-stale');
 const state=env.PACKONE_PATREON_STORAGE_STATE_B64?
  parsePatreonStorageState(env.PACKONE_PATREON_STORAGE_STATE_B64):undefined;
 const profile=state?undefined:PATREON_BROWSERLESS_PROFILE;
 if(profile&&!env.PACKONE_BROWSERLESS_TOKEN)throw Error('patreon-browserless-token-missing');
 const token=env.PATREON_CREATOR_ACCESS_TOKEN;
 const find=()=>findPost({title:post.title,token,
  campaignId:PATREON_POLICY.campaignId,fetchImpl});
 let existing=await find();
 if(existing) {
  await verifyPublic({post,url:existing.url,browserlessToken:env.PACKONE_BROWSERLESS_TOKEN});
  return {alreadyPosted:true,day:post.day,url:existing.url};
 }
 const ledger=ledgerFactory({token:env.GITHUB_TOKEN,
  repo:'killjoy00/mtg-ev-analyzer',issueNumber:1135,fetchImpl});
 const claim=await ledger.claim(post.day,LEDGER_CHANNEL);
 if(claim.alreadyPosted)
  throw Error('patreon-receipt-posted-but-post-not-found');
 let possible=false;
 try {
  await editor({post,state,onSubmit:()=>{possible=true;},
   browserlessToken:env.PACKONE_BROWSERLESS_TOKEN,profile});
  for(let i=0;i<7;i++) {
   existing=await find();
   if(existing)break;
   if(i<6)await sleep(5000);
  }
  if(!existing)throw Error('patreon-publish-not-confirmed');
  await verifyPublic({post,url:existing.url,browserlessToken:env.PACKONE_BROWSERLESS_TOKEN});
  await ledger.markPosted(post.day,LEDGER_CHANNEL,claim);
  return {published:true,day:post.day,url:existing.url};
 } catch {
  // A UI failure before Publish is safe to retry. Once Publish is approached,
  // leave the receipt claimed: the provider may have accepted the request.
  if(!possible)await ledger.markFailed(post.day,LEDGER_CHANNEL,claim).catch(()=>{});
  throw Error(possible?'patreon-publication-ambiguous-reconcile-before-retry':
   'patreon-editor-failed-before-publish');
 }
}

export async function verifyPublicPatreonPost({post,url,browserlessToken,chromiumImpl}) {
 if(!safePostUrl(url))throw Error('patreon-public-url-invalid');
 // Deliberately omit the profile. A creator's signed-in view cannot prove that
 // anyone else can read the post. No screenshots/HTML are written to disk.
 const {browser,page}=await openPatreonBrowser({browserlessToken,chromiumImpl});
 try {
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.getByRole('heading',{name:post.title,exact:true}).waitFor({state:'visible',timeout:20000});
  const more=page.getByRole('button',{name:/^Read more$/i});
  if(await more.count()===1&&await more.isVisible())await more.click();
  await page.waitForFunction(({title,body})=>{
   const normalize=s=>s.replace(/\s+/g,' ').trim();
   return normalize(document.body.innerText).includes(normalize(body))&&
    document.body.innerText.includes(title)&&Array.from(document.images).some(img=>
     img.complete&&img.naturalWidth>=1000&&img.naturalHeight>=500&&
     Math.abs(img.naturalWidth/img.naturalHeight-1200/630)<.03);
  },{title:post.title,body:post.body},{timeout:20000});
  if(!safePostUrl(page.url()))throw Error('patreon-public-verification-failed');
  return true;
 } catch {throw Error('patreon-public-verification-failed');}
 finally {await browser.close();}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
 publishFeaturedPatreon().then(result=>console.log(JSON.stringify(result)))
  .catch(error=>{
   // Only our fixed status codes are printed. Never output Playwright traces,
   // cookies, account details, request headers, or source HTML in public CI.
   const code=String(error.message||'').match(/^patreon-[a-z0-9-]+$/)?.[0]||
    'patreon-publisher-failed';
   console.error(code);
   process.exitCode=1;
  });
}
