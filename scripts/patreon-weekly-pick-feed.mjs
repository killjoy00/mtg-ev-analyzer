// Public aggregate feed ONLY. Named recap data must never enter this feed.
// The same immutable Wednesday post record and title are reused on Thursday.
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {weeklyDue,addDays,pickOfWeek,validDay} from './pack-one-weekly-data.mjs';
import {featureDbRows} from './generate-featured-pick.mjs';
import {featureCopies,imageUrl,formatPercent} from './featured-pick.mjs';
import {assertCurrentLivePublisher} from './post-daily-social.mjs';
import {findPublishedPatreonPost} from './publish-featured-patreon.mjs';
import {githubJson,writeDesktopFeed,sha256} from './patreon-desktop-feed.mjs';
import {PATREON_POLICY} from '../patreon-policy.mjs';

const ESC=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BASE='packone-patreon-feed';
export function weeklyPickTitle(end){return 'Pack One Pick of the Week — '+validDay(end);}
export function weeklyPickGate(now=new Date()) {
 const due=weeklyDue(now,'pick');
 if(!due)return null;
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'2-digit',hourCycle:'h23'}).format(now));
 if(hour<9)return null;
 return {...due,publication_day:addDays(due.end,3)};
}
export function makeWeeklyPickFeed({feature,cover,gate}) {
 if(!gate||!feature||feature.day<gate.start||feature.day>gate.end||!Array.isArray(feature.choices)||
  ![2,3].includes(feature.tier)||feature.choices.length!==feature.tier||!feature.choices.some(c=>c.id===feature.trophy?.id)||
  !Array.isArray(feature.prior_picks)||feature.prior_picks.length!==feature.pick_number-1||
  [...feature.choices,...feature.prior_picks].some(c=>!imageUrl(c.image_url))||
  !Buffer.isBuffer(cover)||cover.length<5000||cover[0]!==255||cover[1]!==216||cover[2]!==255)
  throw Error('weekly-pick-invalid');
 const {label}=featureCopies(feature);
 const title=weeklyPickTitle(gate.end);
 const body=label+' · P1P'+feature.pick_number+' · '+feature.day+'\n\n'+
  (feature.prior_picks.length?'Prior picks: '+feature.prior_picks.map(c=>c.name).join(', ')+'.\n\n':'')+
  'Here’s what '+feature.players+' Pack One players picked:\n\n'+
  feature.choices.map(c=>formatPercent(c.pct)+'% chose '+c.name+' ('+c.votes+' players)').join('\n')+
  (feature.other_votes?'\n'+feature.other_votes+' chose other cards.':'')+
  '\n\nThe original trophy drafter took '+feature.trophy.name+'.\n\nWhat would you take, and why?\n\nPlay today’s Daily: https://packone.pro/';
 return {version:2,kind:'pick-of-week',publication_day:gate.publication_day,week_start:gate.start,week_end:gate.end,feature_day:feature.day,
  campaign_id:PATREON_POLICY.campaignId,title,body,public:true,image_path:gate.publication_day+'/featured-cover.jpg',image_sha256:sha256(cover)};
}
export function checkFrozenWeeklyPick(feed,gate) {
 if(!feed||feed.version!==2||feed.kind!=='pick-of-week'||feed.publication_day!==gate.publication_day||
    feed.week_start!==gate.start||feed.week_end!==gate.end||feed.feature_day<gate.start||feed.feature_day>gate.end||
    feed.campaign_id!==PATREON_POLICY.campaignId||feed.title!==weeklyPickTitle(gate.end)||feed.public!==true||
    typeof feed.body!=='string'||!feed.body.includes(feed.feature_day)||!feed.body.includes('https://packone.pro/')||
    feed.image_path!==gate.publication_day+'/featured-cover.jpg'||!/^[a-f0-9]{64}$/.test(feed.image_sha256||''))
  throw Error('weekly-pick-frozen-invalid');
 validDay(feed.feature_day);
 return feed;
}
export async function refreshWeeklyPick(feed,gate,{token,now=new Date(),find=findPublishedPatreonPost,fetchImpl=fetch}={}) {
 checkFrozenWeeklyPick(feed,gate);
 const found=await find({title:feed.title,token,fetchImpl});
 if(feed.verified_public_url&&found?.url!==feed.verified_public_url)throw Error('weekly-pick-public-receipt-missing');
 return {...feed,checked_at:now.toISOString(),read_check:'ok',verified_public_url:found?.url||null};
}
export async function coverFor(feature,{chromiumImpl}={}) {
 const root=new URL('../',import.meta.url);
 const [logo,heading,body]=await Promise.all(['mobile/assets/images/brand-mark.svg','assets/fonts/barlow-condensed-700.woff2','assets/fonts/source-sans-3-700.woff2'].map(path=>readFile(new URL(path,root))));
 const uri=(type,x)=>'data:'+type+';base64,'+x.toString('base64');
 const cards=feature.choices.map(c=>'<div class="card'+(c.id===feature.trophy.id?' trophy':'')+'"><img src="'+ESC(imageUrl(c.image_url))+'" alt="'+ESC(c.name)+'"><strong>'+ESC(formatPercent(c.pct))+'%</strong><span>'+ESC(c.name)+'</span>'+(c.id===feature.trophy.id?'<small>Trophy pick</small>':'')+'</div>').join('');
 const priors=feature.prior_picks.length?'<div class="context"><h2>Prior picks</h2><div class="pool">'+feature.prior_picks.map(c=>'<figure><img src="'+ESC(imageUrl(c.image_url))+'" alt="'+ESC(c.name)+'"></figure>').join('')+'</div></div>':'';
 const css='@font-face{font-family:Barlow;src:url('+uri('font/woff2',heading)+');font-weight:700}@font-face{font-family:Source;src:url('+uri('font/woff2',body)+');font-weight:700}*{box-sizing:border-box}body{margin:0;background:#f7f8fa;color:#101820;font:700 19px Source,sans-serif}.cover{padding:34px 40px;width:1200px;min-height:630px}.brand{display:flex;align-items:center;gap:12px;font:700 30px Barlow;color:#1e4d7a}.brand img{width:46px;height:46px}h1{font:700 58px/1.05 Barlow;margin:13px 0 6px;color:#1e4d7a}.sub{font-size:24px;margin:0 0 22px}.cards{display:flex;gap:22px;align-items:start}.card{min-width:0;flex:1;background:white;padding:12px;border:1px solid #d5dbe1;display:flex;flex-direction:column;align-items:center;text-align:center}.card.trophy{background:#e5edf4;border:3px solid #1e4d7a;padding:10px}.card img{width:160px;max-width:100%;aspect-ratio:5/7;object-fit:contain}.card strong{font:700 44px Barlow;color:#1e4d7a}.card span{overflow-wrap:anywhere}.card small{color:#1e4d7a}.context h2{font:700 24px Barlow;margin:16px 0 8px}.pool{display:flex;gap:9px;flex-wrap:wrap}.pool figure{width:66px;margin:0}.pool img{width:100%;display:block}';
 const html='<!doctype html><html><head><meta charset="utf-8"><style>'+css+'</style></head><body><main class="cover"><div class="brand"><img src="'+uri('image/svg+xml',logo)+'" alt="">Pack One</div><h1>Pick of the Week</h1><p class="sub">'+ESC(featureCopies(feature).label)+' · P1P'+feature.pick_number+' · '+feature.players+' Pack One players</p><div class="cards">'+cards+'</div>'+priors+'</main></body></html>';
 const chromium=chromiumImpl||(await import('playwright')).chromium;
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:900},deviceScaleFactor:1});
  await page.route('**/*',route=>route.request().resourceType()==='image'&&imageUrl(route.request().url())?route.continue():route.abort());
  await page.setContent(html,{waitUntil:'load',timeout:45000});
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
  const valid=await page.evaluate(()=>[...document.images].every(i=>i.naturalWidth>0)&&document.fonts.check('700 24px Barlow')&&document.fonts.check('700 19px Source'));
  if(!valid)throw Error('weekly-pick-cover-assets');
  // Finish the screenshot before finally closes the browser.
  return await page.locator('.cover').screenshot({type:'jpeg',quality:85,animations:'disabled',timeout:20000});
 }finally{await browser.close();}
}
export async function runWeeklyPickFeed({env=process.env,now=new Date(),fetchImpl=fetch,readRows=featureDbRows,render=coverFor,find=findPublishedPatreonPost,write=writeDesktopFeed,read=githubJson,attest=assertCurrentLivePublisher}={}) {
 const gate=weeklyPickGate(now);
 if(!gate)return {status:'outside-window'};
 if(!['schedule','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME))throw Error('weekly-pick-event');
 await attest({env:{...env,MANUAL_LIVE:'true'},fetchImpl});
 const token=env.PATREON_CREATOR_ACCESS_TOKEN;
 const filename='contents/'+gate.publication_day+'/post.json?ref='+BASE;
 const stored=await read(filename,{token:env.GITHUB_TOKEN,fetchImpl});
 let feed,cover;
 if(stored){
  feed=checkFrozenWeeklyPick(JSON.parse(Buffer.from(stored.content,'base64').toString()),gate);
 }else{
  // Fetch all seven completed game dates; no named player rows are returned.
  const rows=[];
  for(let i=0;i<7;i++){
   const day=addDays(gate.start,i);
   rows.push(...(await readRows(day,{apiKey:env.NEON_API_KEY,fetcher:fetchImpl})).map(r=>({...r,day})));
  }
  const feature=pickOfWeek(rows);
  if(!feature)return {status:'no-qualified-pick'};
  cover=await render(feature);
  feed=makeWeeklyPickFeed({feature,cover,gate});
 }
 const updated=await refreshWeeklyPick(feed,gate,{token,now,find,fetchImpl});
 await write({feed:updated,cover,token:env.GITHUB_TOKEN,fetchImpl});
 return {status:updated.verified_public_url?'verified':'ready',week_end:gate.end,backup:gate.backup};
}
// Fixed diagnostic codes only. Never print raw database, provider, or browser errors.
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 runWeeklyPickFeed().then(result=>console.log('weekly-pick:'+result.status))
 .catch(()=>{console.error('weekly-pick:failed-closed');process.exitCode=1;});
}
