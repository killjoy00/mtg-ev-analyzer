// Historical, read-only recap rendering. Private buffers only: no files,
// artifacts, console output, or live-game mutations. The capture recreates
// the production pack/leaderboard components from the approved snapshot.
import {readFile} from 'node:fs/promises';
import {sortPackByRarity} from '../replay-data.mjs';
import {imageUrl,formatPercent} from './featured-pick.mjs';
import {FORMATS,validDay} from './pack-one-weekly-data.mjs';

const ROOT=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,ROOT));
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const FORMAT_NAMES=Object.freeze({mixed:'Draft Run','powered-cube':'Powered Cube',latest:'Latest Set'});
export const STORE_LINKS=Object.freeze({
 ios:'https://apps.apple.com/app/id6814318676',
 android:'https://play.google.com/store/apps/details?id=pro.packone.app',
 web:'https://packone.pro/'
});
const dataUri=(type,bytes)=>'data:'+type+';base64,'+Buffer.from(bytes).toString('base64');
const n=value=>{if(!Number.isFinite(Number(value)))throw Error('weekly-invalid-score');return Number(value).toFixed(1);};
const label=environment=>{if(!FORMAT_NAMES[environment])throw Error('weekly-invalid-format');return FORMAT_NAMES[environment];};
const d=(value,options={month:'short',day:'numeric'})=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',...options}).format(new Date(validDay(value)+'T12:00:00Z'));
const dayRange=(start,end)=>d(start)+'–'+(start.slice(0,7)===end.slice(0,7)?String(Number(end.slice(8,10))):d(end))+', '+end.slice(0,4);

export async function loadWeeklyBrand() {
 const [base,game,visual,display600,display700,body400,body600,body700,logo,ios,android]=await Promise.all([
  read('pack1.css'),read('draft-run.css'),read('visual-c.css'),
  read('assets/fonts/barlow-condensed-600.woff2'),read('assets/fonts/barlow-condensed-700.woff2'),
  read('assets/fonts/source-sans-3-400.woff2'),read('assets/fonts/source-sans-3-600.woff2'),read('assets/fonts/source-sans-3-700.woff2'),
  read('mobile/assets/images/brand-mark.svg'),read('assets/store-badges/app-store-en-black.svg'),read('assets/store-badges/google-play-en.png')
 ]);
 const font=(family,weight,bytes)=>'@font-face{font-family:"'+family+'";font-weight:'+weight+';font-style:normal;src:url('+dataUri('font/woff2',bytes)+') format("woff2");}';
 return {css:[font('Barlow Condensed',600,display600),font('Barlow Condensed',700,display700),font('Source Sans 3',400,body400),font('Source Sans 3',600,body600),font('Source Sans 3',700,body700),base.toString(),game.toString(),visual.toString().replace(/^@import\s+url\([^\n]*\);\s*$/gm,'')].join('\n'),
  logo:dataUri('image/svg+xml',logo),ios:dataUri('image/svg+xml',ios),android:dataUri('image/png',android)};
}
const overrides=[
 'html,body{margin:0!important;padding:0!important;background:#f7f8fa!important;color:#101820!important;font-family:"Source Sans 3",sans-serif!important}',
 '.weekly-article{width:min(100%,790px);box-sizing:border-box;margin:0 auto;padding:24px 18px 32px;background:#f7f8fa}',
 '.weekly-header{display:flex;gap:12px;align-items:center;margin:0 0 10px}.weekly-header img{width:42px;height:42px}.weekly-header span{font:700 26px "Barlow Condensed",sans-serif;color:#1e4d7a}',
 '.weekly-article h1,.weekly-article h2,.weekly-article h3{font-family:"Barlow Condensed",sans-serif;font-weight:700;line-height:1.15;color:#101820}',
 '.weekly-article>h1{font-size:42px;margin:12px 0 4px}.weekly-article>h2{font-size:29px;margin:26px 0 12px;border-top:1px solid #d5dbe1;padding-top:16px}',
 '.weekly-date,.weekly-note{font-size:14px;color:#5f6770;margin:0 0 12px}',
 '.weekly-article .run-board{background:#fff;max-width:none!important;margin:0 0 12px!important;padding:16px;border:1px solid #d5dbe1;box-sizing:border-box}',
 '.weekly-article .run-board h3{font-size:28px;margin:3px 0 8px}.weekly-article .eyebrow{font-size:12px;color:#5f6770;text-transform:uppercase;letter-spacing:.1em;margin:0}',
 '.weekly-article .run-board nav{gap:12px;margin:5px 0}.weekly-article .run-board nav span{color:#5f6770;padding:5px 0;border-bottom:2px solid transparent}.weekly-article .run-board nav span.active{border-color:#1e4d7a;color:#15395b;font-weight:700}',
 '.weekly-article .run-board ol{margin:12px 0 0}.weekly-article .run-board li{display:grid;grid-template-columns:28px minmax(0,1fr) auto 60px;gap:10px;padding:11px 7px;border-bottom:1px solid #d5dbe1;font-size:17px}',
 '.weekly-article .run-board li:last-child{border-bottom:0}.weekly-article .run-board li.weekly-winner{background:#e5edf4;border-left:3px solid #1e4d7a;padding-left:4px;font-weight:700}',
 '.weekly-article .run-board li>b,.weekly-article .run-board li>strong{font:700 24px/1.1 "Barlow Condensed",sans-serif;color:#1e4d7a}.weekly-article .run-board li>strong{text-align:right}.weekly-article .run-board li small{font-family:"Source Sans 3",sans-serif;font-size:13px;color:#5f6770;font-weight:400}.weekly-article .run-board li>span{overflow-wrap:anywhere}',
 '.weekly-perfect{background:white;border:1px solid #d5dbe1;padding:12px 16px;display:grid;gap:10px}.weekly-perfect>div{border-bottom:1px solid #d5dbe1;padding-bottom:7px}.weekly-perfect>div:last-child{border-bottom:0;padding:0}',
 '.weekly-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));background:#edf1f5;border:1px solid #d5dbe1;padding:12px 4px;margin:10px 0}.weekly-summary>div{text-align:center;border-right:1px solid #d5dbe1}.weekly-summary>div:last-child{border:0}.weekly-summary strong{font:700 32px "Barlow Condensed",sans-serif;color:#1e4d7a;display:block}.weekly-summary small{font-size:12px;color:#5f6770}',
 '.weekly-pack{background:#fff;border:1px solid #d5dbe1;padding:16px;box-sizing:border-box}.weekly-pack h3{font-size:28px;margin:0 0 5px;color:#1e4d7a}.weekly-pack .run-pool-cards{display:flex;flex-wrap:wrap;overflow:visible;gap:7px}.weekly-pack .run-pool-cards figure{width:90px;max-width:22%;margin:0}.weekly-pack .run-pool-cards img{width:100%;display:block}.weekly-pack .run-pool-cards span{white-space:normal!important;overflow:visible!important;display:block;font-size:12px}.weekly-pack .run-cards{grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:11px 7px}.weekly-pack .run-card{min-width:0;overflow-wrap:anywhere}.weekly-pack .run-card img{width:100%;height:auto;aspect-ratio:5/7;object-fit:contain;display:block}.weekly-pack .run-card-name{font-size:12px!important}.weekly-pack .run-card.trophy-pick{border-top:3px solid #1e4d7a!important;background:#e5edf4!important}.weekly-pack .run-card-outcome{font-size:11px!important;color:#1e4d7a!important}',
 '.weekly-footer{text-align:center;border-top:1px solid #d5dbe1;padding:24px 8px 5px;margin-top:24px}.weekly-footer .weekly-web{display:block;color:#fff;background:#1e4d7a;text-decoration:none;padding:14px 16px;font:700 31px "Barlow Condensed",sans-serif;margin:0 auto 16px;max-width:440px}.weekly-footer .weekly-badges{display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:20px}.weekly-footer .weekly-badges a{display:flex;align-items:center;justify-content:center;min-width:140px;min-height:60px}.weekly-footer .weekly-badges img{display:block;object-fit:contain}.weekly-footer .weekly-badges .ios img{height:40px;width:auto}.weekly-footer .weekly-badges .android img{height:60px;width:auto}',
 '@media(max-width:600px){.weekly-article{padding:12px}.weekly-pack .run-cards{grid-template-columns:repeat(3,minmax(0,1fr))!important}.weekly-article .run-board li{font-size:17px;gap:6px;grid-template-columns:24px minmax(0,1fr) auto 48px}.weekly-article .run-board li>b,.weekly-article .run-board li>strong{font-size:21px}}'
].join('\n');

export function leaderboardMarkup(board,{kind='week',seasonName=null,id}={}) {
 if(!FORMATS.includes(board.environment)||!Array.isArray(board.rows)||!['week','day','season'].includes(kind))throw Error('weekly-invalid-board');
 const rows=board.rows.filter(r=>Number(r.rank)>=1&&Number(r.rank)<=5);
 const nav=[['day','Today'],['week','This week'],['season','This season']].map(([key,name])=>'<span class="'+(kind===key?'active':'')+'">'+name+'</span>').join('');
 const season=kind==='season';
 return '<section class="run-board" id="'+escape(id||kind+'-'+board.environment)+'"><p class="eyebrow">Leaderboards</p><h3>'+escape(label(board.environment))+'</h3><nav class="run-board-periods" aria-label="Leaderboard period">'+nav+'</nav>'+
  (season&&seasonName?'<p class="run-board-season">'+escape(seasonName)+' season</p>':'')+
  (rows.length?'<ol>'+rows.map(r=>'<li'+(kind==='week'&&Number(r.rank)===1?' class="weekly-winner"':'')+'><b>'+escape(r.rank)+'</b><span><span class="run-board-player">'+escape(r.name)+'</span>'+
  (season?'<small class="run-board-average">Avg '+n(r.average_score)+'</small>':'')+'</span><small>'+(season?escape(r.days)+' days':'')+'</small><strong>'+
  (season?'<small>Rating</small>':'')+n(r.score)+'</strong></li>').join('')+'</ol>':'<p class="weekly-note">No eligible standings.</p>')+'</section>';
}

export function easiestMarkup(pick) {
 const pct=Number(pick.match_pct);
 if(!Number.isFinite(pct)||pct<0||pct>100||!Array.isArray(pick.candidates)||!Array.isArray(pick.prior_picks)||!pick.candidates.some(c=>c.id===pick.trophy_id))throw Error('weekly-invalid-easiest');
 const cardImg=c=>{const src=imageUrl(c.image_url);if(!src)throw Error('weekly-invalid-card-image');return '<img src="'+escape(src)+'" alt="'+escape(c.name)+'">';};
 const pool=pick.prior_picks.length?'<section class="run-pool"><h4>Earlier picks</h4><div class="run-pool-cards">'+pick.prior_picks.map(c=>'<figure>'+cardImg(c)+'<span>'+escape(c.name)+'</span></figure>').join('')+'</div></section>':'<p class="weekly-note">First pick of the draft.</p>';
 return '<section class="weekly-pack draft-run-page" id="easiest-pick"><h3>'+escape(formatPercent(pct))+'% of you got this one right!</h3><p class="weekly-note">'+escape(d(pick.day))+' · '+escape(label(pick.environment))+' · P1P'+escape(pick.pick_number)+'</p><p><strong>Trophy drafter:</strong> '+escape(pick.trophy_name)+'</p>'+pool+'<h4>Pack</h4><div class="run-cards">'+sortPackByRarity(pick.candidates).map(c=>'<article class="run-card'+(c.id===pick.trophy_id?' trophy-pick':'')+'"><div class="run-card-select">'+cardImg(c)+'</div><span class="run-card-name">'+escape(c.name)+'</span>'+(c.id===pick.trophy_id?'<span class="run-card-outcome">Trophy pick</span>':'')+'</article>').join('')+'</div></section>';
}
const sortedBoards=boards=>FORMATS.map(environment=>boards.find(b=>b.environment===environment)).filter(Boolean);
export function weeklyArticleMarkup(article,brand) {
 if(!article||!brand?.logo||!brand?.ios||!brand?.android||!Array.isArray(article.weekly)||!Array.isArray(article.seasonBoards))throw Error('weekly-invalid-article');
 const hardest=article.hardest;
 const p=article.perfectDailies||[];
 let perfect='';
 if(p.length){
  const groups=new Map();
  for(const row of p){const key=row.day+'|'+row.environment;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row.name);}
  perfect='<h2>Perfect Dailies</h2><section class="weekly-perfect" id="perfect-dailies">'+[...groups].map(([key,names])=>{const [day,environment]=key.split('|');return '<div><span class="weekly-note">'+escape(d(day))+' · '+escape(label(environment))+'</span><br><strong>'+names.map(escape).join(', ')+'</strong> · 100</div>';}).join('')+'</section>';
 }
 const hard=hardest&&hardest.rows?.length?'<h2>Hardest Daily</h2><p><strong>'+escape(d(hardest.day,{weekday:'long',month:'short',day:'numeric'}))+' · '+escape(label(hardest.environment))+'</strong></p><div class="weekly-summary">'+[[n(hardest.mean),'Daily average'],[n(hardest.rest),'Rest of week'],[n(hardest.rows[0].score),'Top score']].map(([score,name])=>'<div><strong>'+score+'</strong><small>'+name+'</small></div>').join('')+'</div>'+leaderboardMarkup(hardest,{kind:'day',id:'hardest-daily'}):'';
 return '<main class="weekly-article"><header class="weekly-header"><img src="'+escape(brand.logo)+'" alt="Pack One"><span>Pack One</span></header><h1>Pack One Weekly</h1><p class="weekly-date">'+escape(dayRange(article.start,article.end))+'</p><h2>Last Week&#39;s Weekly Winners</h2>'+
  sortedBoards(article.weekly).map(b=>leaderboardMarkup(b)).join('')+'<p class="weekly-note">Best three Dailies. Ties through fifth place are included.</p>'+
  perfect+hard+(article.easiest?'<h2>Easiest Pick</h2>'+easiestMarkup(article.easiest):'')+
  (article.seasonBoards.length?'<h2>Season Watch</h2>'+sortedBoards(article.seasonBoards).map(b=>leaderboardMarkup(b,{kind:'season',seasonName:article.seasonName})).join(''):'')+
  '<footer class="weekly-footer" id="weekly-footer"><a class="weekly-web" href="'+STORE_LINKS.web+'">Play Pack One · packone.pro</a><div class="weekly-badges"><a class="ios" href="'+STORE_LINKS.ios+'"><img src="'+escape(brand.ios)+'" alt="Download on the App Store"></a><a class="android" href="'+STORE_LINKS.android+'"><img src="'+escape(brand.android)+'" alt="Get it on Google Play"></a></div></footer></main>';
}
export function weeklyHtml(article,brand) {
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+brand.css+'\n'+overrides+'</style></head><body>'+weeklyArticleMarkup(article,brand)+'</body></html>';
}
// Read the actual SOF dimensions without adding an image-decoder dependency.
export function jpegDimensions(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<12||bytes[0]!==255||bytes[1]!==216)throw Error('weekly-invalid-jpeg');
 for(let i=2;i+4<bytes.length;){
  if(bytes[i++]!==255)break;
  while(bytes[i]===255)i++;
  const marker=bytes[i++];
  if(marker===217||marker===218)break;
  if(marker===1||(marker>=208&&marker<=215))continue;
  const length=bytes.readUInt16BE(i);
  if(length<2||i+length>bytes.length)break;
  if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=8){
   const height=bytes.readUInt16BE(i+3),width=bytes.readUInt16BE(i+5);
   if(width&&height)return {width,height};
  }
  i+=length;
 }
 throw Error('weekly-invalid-jpeg');
}
// No screenshot saved to disk; the caller must use an authenticated private
// publisher runtime, never upload these named captures to the public repo.
export async function captureWeeklyRecap(article,{chromiumImpl,brand,jpeg=false}={}) {
 brand=brand||await loadWeeklyBrand();
 const chromium=chromiumImpl||(await import('playwright')).chromium;
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:jpeg?480:850,height:1100},deviceScaleFactor:2});
  await page.route('**/*',route=>{
   const request=route.request();
   const url=request.url();
   if(request.resourceType()==='image'&&imageUrl(url))return route.continue();
   return route.abort();
  });
  await page.setContent(weeklyHtml(article,brand),{waitUntil:'load',timeout:30000});
  // FontFaceSet.ready only waits for weights actually used in the document.
  // Explicitly load every required bundled face (including unused weights)
  // and require a real loaded face, not a successful fallback-font check.
  const verified=await page.evaluate(async()=>{
   const required=['600 18px "Barlow Condensed"','700 26px "Barlow Condensed"','400 16px "Source Sans 3"','600 16px "Source Sans 3"','700 16px "Source Sans 3"'];
   const faces=await Promise.all(required.map(async font=>{
    try{const loaded=await document.fonts.load(font,'Pack One 0123456789');return loaded.length>0&&loaded.every(face=>face.status==='loaded')&&document.fonts.check(font,'Pack One 0123456789');}
    catch{return false;}
   }));
   await document.fonts.ready;
   try{await Promise.all([...document.images].map(img=>img.decode()));}catch{return {images:false,fonts:faces.every(Boolean)};}
   return {images:[...document.images].every(img=>img.complete&&img.naturalWidth>0),fonts:faces.every(Boolean)};
  });
  if(!verified.fonts)throw Error('weekly-render-fonts-not-loaded');
  if(!verified.images)throw Error('weekly-render-images-not-loaded');
  if(jpeg){
   const fits=await page.evaluate(()=>[...document.querySelectorAll('.weekly-article,.weekly-article .run-board,.weekly-article .run-board li,.weekly-pack,.weekly-footer')].every(e=>e.scrollWidth<=e.clientWidth+2));
   if(!fits)throw Error('weekly-render-horizontal-overflow');
  }
  const panels={};
  for(const id of ['week-mixed','week-powered-cube','week-latest','perfect-dailies','hardest-daily','easiest-pick','season-mixed','season-powered-cube','season-latest','weekly-footer']){
   const locator=page.locator('#'+id);
   if(await locator.count()===1)panels[id]=await locator.screenshot({type:'png',animations:'disabled',timeout:15000});
  }
  const articleLocator=page.locator('.weekly-article');
  if(jpeg){
   // PostyBirb's verified local protocol accepts one JPEG. Retain the full
   // composite and ordinary public text links. A public readback must prove
   // the composite's geometry; never silently replace it with a cropped card.
   const box=await articleLocator.boundingBox();
   if(!box||box.width<100||box.height<100||box.height*2>30000)throw Error('weekly-render-dimensions');
   const image=await articleLocator.screenshot({type:'jpeg',quality:88,animations:'disabled',timeout:20000});
   // Use actual screenshot metadata (pixel dimensions, not CSS estimates).
   const size=jpegDimensions(image);
   if(size.width<100||size.height<100||size.height>30000)throw Error('weekly-render-dimensions');
   return {panels,jpeg:image,...size};
  }
  return {panels,full:await articleLocator.screenshot({type:'png',animations:'disabled',timeout:15000})};
 }finally{await browser.close();}
}
