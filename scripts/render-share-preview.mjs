// Render the static link-preview image used by Daily result-share links.
// Spoiler-safe and data-free: it explains the game, not anyone's result.
// Run once after a design change and commit share-daily-v1.png.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export const SHARE_PREVIEW_FILE='share-daily-v1.png';
// Same five grades, in the same colors, as the shared emoji squares and card.
const TILES=['#2f8a4f','#2d6fd0','#e3b62e','#2f8a4f','#e07a2b','#2d6fd0','#2f8a4f','#24292e'];

export async function renderSharePreview({out=SHARE_PREVIEW_FILE}={}) {
 const font=async name=>(await readFile('assets/fonts/'+name)).toString('base64');
 const display=await font('barlow-condensed-700.woff2'),body=await font('source-sans-3-700.woff2');
 const logo=(await readFile('mobile/assets/images/brand-mark.svg')).toString('base64');
 const html='<!doctype html><html><head><meta charset="utf-8"><style>'+
  '@font-face{font-family:Barlow;src:url(data:font/woff2;base64,'+display+') format("woff2")}'+
  '@font-face{font-family:Source;src:url(data:font/woff2;base64,'+body+') format("woff2")}'+
  'html,body{margin:0;width:1200px;height:630px;background:#f7f8fa;color:#101820;font-family:Source,sans-serif}'+
  'main{position:relative;height:630px;padding:64px 72px;box-sizing:border-box;border-left:22px solid #1e4d7a}'+
  '.brand{display:flex;align-items:center;gap:18px;font:700 44px Barlow,sans-serif}.brand img{width:72px;height:72px;border-radius:12px}'+
  'h1{font:700 92px/0.98 Barlow,sans-serif;margin:40px 0 14px;text-transform:uppercase}'+
  'p{font-size:34px;line-height:1.3;margin:0;color:#3d4852}'+
  '.tiles{display:flex;gap:14px;margin-top:40px}.tiles span{width:84px;height:84px;border-radius:14px}'+
  '.foot{position:absolute;left:72px;bottom:52px;font-size:32px;color:#1e4d7a}'+
  '</style></head><body><main><div class="brand"><img src="data:image/svg+xml;base64,'+logo+'" alt="">Pack One</div>'+
  '<h1>Today’s MTG Draft Daily</h1><p>Eight real trophy-draft picks. Make yours, then compare with the trophy drafter.</p>'+
  '<div class="tiles">'+TILES.map(c=>'<span style="background:'+c+'"></span>').join('')+'</div>'+
  '<div class="foot">Free · No account needed · packone.pro</div></main></body></html>';
 const {chromium}=await import('playwright');
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1200,height:630},deviceScaleFactor:1});
  await page.setContent(html,{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:out,type:'png'});
 } finally {await browser.close();}
 return {out};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
 renderSharePreview().then(r=>console.log(JSON.stringify(r)))
  .catch(e=>{console.error(e.message);process.exitCode=1;});
}
