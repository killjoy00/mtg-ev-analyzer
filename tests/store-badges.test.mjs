import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {storePlatform,applyStoreBadges} from '../store-badges.mjs';
import {MOBILE_STORE_URLS} from '../worker/mobile-version.mjs';

test('platform-aware badges detect common phones but keep desktop and unknown devices neutral',()=>{
  assert.equal(storePlatform({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',platform:'iPhone'}),'ios');
  assert.equal(storePlatform({userAgent:'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'}),'ios');
  assert.equal(storePlatform({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X)',platform:'MacIntel',maxTouchPoints:5}),'ios','iPadOS desktop-class user agent');
  assert.equal(storePlatform({userAgent:'Mozilla/5.0 (Linux; Android 16; Pixel 9)'}),'android');
  assert.equal(storePlatform({userAgent:'',userAgentData:{platform:'Android'}}),'android','Android Client Hints');
  assert.equal(storePlatform({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X)',platform:'MacIntel',maxTouchPoints:0}),'both','desktop Mac');
  assert.equal(storePlatform({userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}),'both');
  assert.equal(storePlatform({userAgent:''}),'both','unknown/browser without UA');
});

const makeGroup=()=>{
  const copy={textContent:'Also on iPhone and Android'};
  const badges=['ios','android'].map(os=>({hidden:false,getAttribute(key){return key==='data-store-badge'?os:null;},os}));
  return {copy,badges,querySelector(sel){return sel==='[data-store-label]'?copy:null;},querySelectorAll(sel){return sel==='[data-store-badge]'?badges:[];}};
};
test('store badges filter only the mismatched platform and reapply safely after rerender',()=>{
  for(const [navigator,expected,copy] of [
    [{userAgent:'iPhone'},[false,true],'Also on iPhone and iPad'],
    [{userAgent:'Android'},[true,false],'Also on Android'],
    [{userAgent:'Windows NT 10.0'},[false,false],'Also on iPhone and Android']
  ]){
    const group=makeGroup(),root={querySelectorAll:()=>[group]};
    applyStoreBadges(root,navigator);
    assert.deepEqual(group.badges.map(badge=>badge.hidden),expected);
    assert.equal(group.copy.textContent,copy);
    applyStoreBadges(root,{userAgent:'Windows NT 10.0'});
    assert.deepEqual(group.badges.map(badge=>badge.hidden),[false,false],'unknown devices restore both links');
  }
  assert.doesNotThrow(()=>applyStoreBadges(null,{userAgent:'Android'}));
});

test('About and How to Play use compact store links in the right reading position',async()=>{
  const about=await readFile('about/index.html','utf8');
  const how=await readFile('how-it-works/index.html','utf8');
  for(const [file,html] of [['about',about],['how',how]]){
    assert.equal((html.match(/data-store-links/g)||[]).length,1,file);
    assert.doesNotMatch(html,/data-store-label|Also on iPhone and Android/,'no extra text line');
    for(const [os,url] of [['ios',MOBILE_STORE_URLS.ios],['android',MOBILE_STORE_URLS.android]]){
      assert.ok(html.includes('data-store-badge="'+os+'" href="'+url+'"'),file+' '+os+' direct listing');
    }
    assert.match(html,/src="\/store-badges\.mjs\?v=1"/);
    assert.match(html,/href="\/editorial\.css\?v=15"/);
  }
  assert.ok(how.indexOf('data-store-links')>how.indexOf('class="quick-start-action"'));
  assert.ok(how.indexOf('data-store-links')<how.indexOf('data-ad-slot="article-top"'));
  assert.ok(about.indexOf('data-store-links')>about.indexOf('How I built Pack One'));
  assert.ok(about.indexOf('data-store-links')<about.indexOf('class="article-return"'));
  const editorial=await readFile('editorial.css','utf8');
  const home=await readFile('daily-home.css','utf8');
  assert.match(editorial,/\.editorial-store-badges a\[hidden\]\s*\{\s*display:none\s*!important/);
  assert.match(home,/\.daily-home-store-badges a\[hidden\]\s*\{\s*display:none\s*!important/);
  assert.match(editorial,/\.editorial-store-badges\s*\{[^}]*justify-content:space-evenly/);
  assert.match(editorial,/\.editorial-store-badges\s*\{[^}]*flex-wrap:nowrap/);
  assert.match(editorial,/\.editorial-store-badges\s*\{[^}]*gap:24px/);
  assert.match(editorial,/\.editorial-store-badges img\s*\{[^}]*height:52px/);
  assert.match(editorial,/\.editorial-store-badges img\.google-play-badge\s*\{[^}]*height:72px/);
  assert.match(editorial,/@media\(max-width:400px\)/,'narrow desktop fallback is defined');
  assert.doesNotMatch(editorial,/\.editorial-store-links\s*\{[^}]*border-top/,'no extra dividers');
  assert.doesNotMatch(editorial,/\.editorial-store-links\s*\{[^}]*flex-direction:column/,'one-row design even on small screens');
});
