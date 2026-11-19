// Deterministic 9:16 Pack One bookends. These are true browser renders of the
// canonical repo-owned P¹ SVG and Pack One fonts, NOT generated imagery.
// The background and outro card grid are screenshots captured from the live
// Daily in this same job; no prior date's card art or generated replacements.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkedDay,INTRO_SECONDS,OUTRO_SECONDS} from './daily-short.mjs';

export const VIDEO_FRAME={width:1080,height:1920};
export const BRAND={
  page:'#f7f8fa',surface:'#fff',blue:'#1e4d7a',blueDark:'#15395b',ink:'#101820',
  muted:'#5f6770',rule:'#d5dbe1',
};
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const BRAND_MARK='mobile/assets/images/brand-mark.svg';
const BRAND_FONTS=Object.freeze({
  display:'assets/fonts/barlow-condensed-600.woff2',
  displayBold:'assets/fonts/barlow-condensed-700.woff2',
  body:'assets/fonts/source-sans-3-400.woff2',
  bodyBold:'assets/fonts/source-sans-3-700.woff2',
});

function dataUri(buffer,mime) {return `data:${mime};base64,${buffer.toString('base64')}`;}
export async function loadBrandAssets({read=readFile}={}) {
  const [mark,...fonts]=await Promise.all([BRAND_MARK,...Object.values(BRAND_FONTS)]
    .map(file=>read(path.join(ROOT,file))));
  // The brand guide explicitly prohibits the typographic P¹ approximation.
  assert.match(mark.toString('utf8'),/<svg\b/);
  assert.match(mark.toString('utf8'),/1e4d7a/i);
  for(const bytes of fonts)assert.ok(bytes.length>20_000,'Pack One branded font asset is missing.');
  return {
    logo:dataUri(mark,'image/svg+xml'),
    display:dataUri(fonts[0],'font/woff2'),
    displayBold:dataUri(fonts[1],'font/woff2'),
    body:dataUri(fonts[2],'font/woff2'),
    bodyBold:dataUri(fonts[3],'font/woff2'),
  };
}

const styles=assets=>`<style>
@font-face{font-family:'Pack One Display';font-style:normal;font-weight:600;src:url('${assets.display}') format('woff2')}
@font-face{font-family:'Pack One Display';font-style:normal;font-weight:700;src:url('${assets.displayBold}') format('woff2')}
@font-face{font-family:'Pack One Body';font-style:normal;font-weight:400;src:url('${assets.body}') format('woff2')}
@font-face{font-family:'Pack One Body';font-style:normal;font-weight:700;src:url('${assets.bodyBold}') format('woff2')}
*{box-sizing:border-box}
html,body{margin:0;padding:0;width:1080px;height:1920px;overflow:hidden;background:${BRAND.page};color:${BRAND.ink}}
body{position:relative;font-family:'Pack One Body',sans-serif}
.brand{display:flex;align-items:center;justify-content:center;gap:22px}
.brand img{width:78px;height:78px;display:block}
.brand span{font-family:'Pack One Display',sans-serif;font-weight:600;font-size:74px;letter-spacing:.015em;line-height:1;color:${BRAND.ink}}
</style>`;

export function introHtml({assets,homeScreenshot,day}) {
  checkedDay(day);
  assert.ok(homeScreenshot.startsWith('data:image/png;base64,'));
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8">${styles(assets)}<style>
.backdrop{position:absolute;inset:-50px;width:1180px;height:2020px;object-fit:cover;filter:blur(20px);opacity:.31}
.veil{position:absolute;inset:0;background:rgba(247,248,250,.69)}
.brand{position:absolute;z-index:1;top:160px;left:0;right:0}
.hairline{position:absolute;z-index:1;top:302px;left:130px;right:130px;border-top:2px solid ${BRAND.rule}}
.title{position:absolute;z-index:1;top:430px;left:40px;right:40px;text-align:center;font-family:'Pack One Display',sans-serif;font-weight:700;font-size:250px;line-height:.87;letter-spacing:.005em;color:${BRAND.ink}}
.title>div{white-space:nowrap}
.submark{position:absolute;z-index:1;top:965px;left:0;right:0;text-align:center;font-weight:700;font-size:61px;letter-spacing:.23em;color:${BRAND.blue}}
.tagline{position:absolute;z-index:1;top:1320px;left:0;right:0;text-align:center;font-size:64px;color:${BRAND.muted}}
.bottom-rule{position:absolute;z-index:1;bottom:195px;left:190px;right:190px;border-top:3px solid ${BRAND.blue}}
</style></head><body data-clip="intro" data-duration="${INTRO_SECONDS}" data-day="${day}">
<img class="backdrop" src="${homeScreenshot}" alt=""><div class="veil"></div>
<div class="brand" aria-label="Pack One"><img data-brand-mark src="${assets.logo}" alt="P¹"><span>Pack One</span></div>
<div class="hairline"></div><div class="title"><div>TODAY'S</div><div>DRAFT</div></div>
<div class="submark">PACK ONE</div><div class="tagline">Eight picks. Your call.</div><div class="bottom-rule"></div>
</body></html>`;
}

export function outroHtml({assets,packScreenshot,day}) {
  checkedDay(day);
  assert.ok(packScreenshot.startsWith('data:image/png;base64,'));
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8">${styles(assets)}<style>
.pack{position:absolute;inset:0;width:1080px;height:1920px;object-fit:cover}
.cta{position:absolute;left:35px;right:35px;top:1310px;height:425px;border-radius:34px;background:rgba(21,57,91,.90);color:#fff;padding:74px 65px 55px;display:flex;flex-direction:column;align-items:center}
.question{font-family:'Pack One Display',sans-serif;font-weight:700;font-size:104px;line-height:1;white-space:nowrap;text-align:center;letter-spacing:.005em}
.rule{width:580px;border-top:3px solid rgba(255,255,255,.75);margin:32px auto 32px}
.action{display:flex;align-items:center;justify-content:center;gap:22px;white-space:nowrap;width:760px;max-width:100%;height:106px;flex:none;background:#fff;color:${BRAND.blue};border-radius:20px;padding:0 38px;font-family:'Pack One Body',sans-serif;font-weight:700;font-size:53px;letter-spacing:.01em}
.action .arrow{font-family:'Pack One Body',sans-serif;font-weight:700;font-size:66px;line-height:1}
</style></head><body data-clip="outro" data-duration="${OUTRO_SECONDS}" data-day="${day}">
<img class="pack" src="${packScreenshot}" alt="Real first pack of the day's Daily Draft Run">
<div class="cta"><div class="question">WHAT WOULD YOU PICK?</div><div class="rule"></div>
<div class="action"><span class="action-label">PLAY AT PACKONE.PRO</span><span class="arrow" aria-hidden="true">→</span></div></div>
</body></html>`;
}

// Browser-side layout verification; fail before exporting if CTA clips or logo
// /font/image resources did not finish rendering.
export async function verifyBrandedFrame(page,clip,day) {
  const result=await page.evaluate(async expected=>{
    await document.fonts.ready;
    const imgs=[...document.images];
    await Promise.all(imgs.map(img=>img.decode()));
    const bounds=selector=>{
      const b=document.querySelector(selector)?.getBoundingClientRect();
      return b?{x:b.x,y:b.y,left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height}:null;
    };
    return {day:document.body.dataset.day,clip:document.body.dataset.clip,
      images:imgs.length,imagesReady:imgs.every(img=>img.complete&&img.naturalWidth>30),
      fontsReady:document.fonts.check('700 104px "Pack One Display"')&&document.fonts.check('700 53px "Pack One Body"'),
      logo:bounds('.brand img'),cta:bounds('.cta'),action:bounds('.action'),label:bounds('.action-label'),arrow:bounds('.arrow'),
      question:bounds('.question'),bodyScrollWidth:document.body.scrollWidth};
  });
  assert.equal(result.day,day);
  assert.equal(result.clip,clip);
  assert.equal(result.images,clip==='intro'?2:1,'Unexpected missing/extra brand or pack images.');
  assert.equal(result.imagesReady,true,'Branded image or card screenshot did not load.');
  assert.equal(result.fontsReady,true,'Canonical Pack One fonts did not load.');
  if(clip==='intro')assert.ok(result.logo?.width>=60,'Pack One actual P¹ logo missing from intro.');
  if(clip==='outro') {
    const {cta,action,label,question,arrow}=result;
    for(const [name,rect] of Object.entries({cta,action,label,question,arrow})) {
      assert.ok(rect&&rect.left>=20&&rect.right<=VIDEO_FRAME.width-20,`Outro ${name} is clipped at frame edge.`);
    }
    assert.ok(label.left>=action.left+18&&label.right<=action.right-18,'PLAY AT PACKONE.PRO label is clipped inside its button.');
    assert.ok(arrow.right<=action.right-16,'Outro arrow is clipped inside its button.');
    assert.ok(question.left>=cta.left+20&&question.right<=cta.right-20,'CTA question is cropped.');
  }
  return result;
}

export async function renderBrandedFrames(browser,{output,day,homePath,packPath}) {
  checkedDay(day);
  const [assets,home,pack]=await Promise.all([loadBrandAssets(),readFile(homePath),readFile(packPath)]);
  const homeUri=dataUri(home,'image/png');
  const packUri=dataUri(pack,'image/png');
  const page=await browser.newPage({viewport:VIDEO_FRAME,deviceScaleFactor:1,colorScheme:'light'});
  try {
    await page.route(/^https?:/,route=>route.abort('blockedbyclient'));
    for(const [clip,html] of [
      ['intro',introHtml({assets,homeScreenshot:homeUri,day})],
      ['outro',outroHtml({assets,packScreenshot:packUri,day})],
    ]) {
      await page.setContent(html,{waitUntil:'load'});
      await verifyBrandedFrame(page,clip,day);
      await page.screenshot({path:path.join(output,`${clip}.png`),animations:'disabled'});
    }
  } finally {await page.close();}
  return {intro:path.join(output,'intro.png'),outro:path.join(output,'outro.png')};
}
