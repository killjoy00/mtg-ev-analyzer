import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile('appearance.js','utf8');
function setup({stored=null,dark=false,blocked=false}={}){
  const dataset={},meta={content:''},callbacks={},mediaEvents={},docEvents={};
  const media={matches:dark,addEventListener:(name,cb)=>mediaEvents[name]=cb};
  const storage={getItem(){if(blocked)throw Error('blocked');return stored;},setItem(_key,value){if(blocked)throw Error('blocked');stored=value;}};
  const document={documentElement:{dataset},querySelector:()=>meta,querySelectorAll:()=>[],readyState:'loading',addEventListener:(name,cb)=>docEvents[name]=cb};
  const window={matchMedia:()=>media,addEventListener:(name,cb)=>callbacks[name]=cb};
  vm.runInNewContext(source,{document,window,localStorage:storage});
  return {dataset,meta,system(value){media.matches=value;mediaEvents.change();},external(value){stored=value;callbacks.storage({key:'packone-appearance-v1'});}};
}
test('system appearance is applied before DOM ready and tracks changes',()=>{
  const app=setup({dark:true});assert.equal(app.dataset.theme,'dark');assert.equal(app.dataset.appearance,'system');
  assert.equal(app.meta.content,'#10171f');app.system(false);assert.equal(app.dataset.theme,'light');assert.equal(app.meta.content,'#f7f8fa');
});
test('explicit choice wins over system; cross-tab reset follows system',()=>{
  const app=setup({stored:'light',dark:true});assert.equal(app.dataset.theme,'light');
  app.system(false);app.system(true);assert.equal(app.dataset.theme,'light');
  app.external('dark');assert.equal(app.dataset.theme,'dark');app.external(null);
  assert.equal(app.dataset.appearance,'system');app.system(false);assert.equal(app.dataset.theme,'light');
});
test('invalid values and blocked storage safely fall back to system',()=>{
  assert.equal(setup({stored:'invalid',dark:true}).dataset.theme,'dark');
  assert.equal(setup({blocked:true,dark:true}).dataset.appearance,'system');
});

test('dark theme palette has AA contrast for its text and state pairs',async()=>{
  const css=await readFile('visual-c.css','utf8');
  const palette=css.match(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/)[1];
  const vars=Object.fromEntries([...palette.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map(m=>[m[1],m[2]]));
  function luminance(hex){
    const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
  }
  for(const [foreground,background] of [
    ['--ink','--page'],['--ink','--surface'],['--muted','--surface'],['--faint','--surface-soft'],
    ['--blue','--blue-soft'],['--green-dark','--surface-soft'],['--gold','--gold-soft'],
    ['--red','--red-soft'],['--theme-match','--theme-match-soft'],['#ffffff','--theme-brand-fill'],['#ffffff','--theme-brand-hover']
  ]){
    const a=luminance(vars[foreground]||foreground),b=luminance(vars[background]||background);
    const ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    assert.ok(ratio>=4.5,foreground+' on '+background+' has contrast '+ratio.toFixed(2));
  }
});
test('public page and guide templates initialize appearance before shared CSS',async()=>{
  for(const path of ['index.html','practice/index.html','learn/index.html','sets/msh/guide/index.html','about/index.html','reset-password/index.html','scripts/build-set-guides.mjs']){
    const html=await readFile(path,'utf8');
    assert.ok(html.includes('/appearance.js?v=1'),path);
    assert.ok(html.indexOf('/appearance.js?v=1')<html.indexOf('visual-c.css?v=16'),path);
  }
});
