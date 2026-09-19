import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dailyHomeMarkup} from '../daily-home.mjs';
const day='2026-09-18';
const row=set_id=>({date:day,mode:'draft_run',set_id,score:91});
test('three direct Dailies dominate before completion, without practice or checklist',()=>{
 const html=dailyHomeMarkup(null,day);
 assert.equal((html.match(/>Play now</g)||[]).length,3);
 assert.match(html,/September 18’s Daily Runs/);assert.doesNotMatch(html,/100 = you matched/);
 assert.doesNotMatch(html,/progressbar|Daily board|More modes|Full Pack|Top 3|Keep drafting/);
});
test('either unfinished Daily precedes the compact result',()=>{
 for(const done of ['mixed','powered-cube']){
  const html=dailyHomeMarkup({daily_history:[row(done)]},day);
  assert.ok(html.indexOf('is-unplayed')<html.indexOf('is-complete'));
  assert.equal((html.match(/>Play now</g)||[]).length,2);
  assert.match(html,/View result/);assert.doesNotMatch(html,/Keep drafting/);
 }
});
test('both complete reveals account practice or account creation',()=>{
 const p={daily_history:[row('mixed'),row('powered-cube'),row('latest')],player:{claimed:true}};
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

test('Elite set picker stays discoverable before any Daily completion',()=>{
 const p={player:{claimed:true},capabilities:['account'],daily_history:[]};
 assert.match(dailyHomeMarkup(p,day),/Elite practice/);
 assert.match(dailyHomeMarkup(p,day),/Choose your sets/);
 assert.doesNotMatch(dailyHomeMarkup(p,day),/Powered Cube Practice/);
 p.daily_history=['mixed','powered-cube','latest'].map(row);
 p.capabilities.push('unlimited_cube_practice');
 assert.match(dailyHomeMarkup(p,day),/Powered Cube Practice/);
});

test('Method has no secondary link directory',()=>{
 const html=fs.readFileSync('methodology/index.html','utf8');assert.equal((html.match(/class="method-directory"/g)||[]).length,0);
});
