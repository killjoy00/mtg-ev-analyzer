import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dailyHomeMarkup} from '../daily-home.mjs';
const day='2026-09-18';
const row=set_id=>({date:day,mode:'draft_run',set_id,score:91});
test('two direct Dailies dominate before completion, without practice or checklist',()=>{
 const html=dailyHomeMarkup(null,day);
 assert.equal((html.match(/>Play now</g)||[]).length,2);
 assert.doesNotMatch(html,/progressbar|Daily board|More modes|Full Pack|Top 3|Keep drafting/);
});
test('either unfinished Daily precedes the compact result',()=>{
 for(const done of ['mixed','powered-cube']){
  const html=dailyHomeMarkup({daily_history:[row(done)]},day);
  assert.ok(html.indexOf('is-unplayed')<html.indexOf('is-complete'));
  assert.equal((html.match(/>Play now</g)||[]).length,1);
  assert.match(html,/View result/);assert.doesNotMatch(html,/Keep drafting/);
 }
});
test('both complete reveals account practice or account creation',()=>{
 const p={daily_history:[row('mixed'),row('powered-cube')],player:{claimed:true}};
 assert.match(dailyHomeMarkup(p,day),/Start Another Draft Run/);
 p.player.claimed=false;assert.match(dailyHomeMarkup(p,day),/Create a free account/);
 assert.doesNotMatch(dailyHomeMarkup(p,day),/Start Another Draft Run/);
});
test('home runtime isolates historical code and lazily loads profiles',()=>{
 const source=fs.readFileSync('bootstrap.mjs','utf8');
 assert.doesNotMatch(source,/import\(['"]\.\/(app\.js|social\.mjs|home-today\.mjs|cube-home\.mjs|home-product\.mjs)/);
 assert.match(source,/historical-share\.mjs/);
 assert.match(source,/daily-home\.mjs/);
});
