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
