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
test('all three complete reveals account practice or account creation',()=>{
 const p={daily_history:[row('mixed'),row('powered-cube'),row('latest')],player:{claimed:true},capabilities:['account']};
 const freeHtml=dailyHomeMarkup(p,day);
 assert.match(freeHtml,/Start Another Draft Run/);
 assert.match(freeHtml,/Become Elite/);
 assert.match(freeHtml,/Elite adds unlimited Powered Cube and custom-set drafts/);
 p.player.claimed=false;const guestHtml=dailyHomeMarkup(p,day);
 assert.match(guestHtml,/Create a free account/);
 assert.doesNotMatch(guestHtml,/Start Another Draft Run/);
 assert.doesNotMatch(guestHtml,/Elite adds unlimited Powered Cube and custom-set drafts/);
});
test('home runtime isolates historical code and lazily loads profiles',()=>{
 const source=fs.readFileSync('bootstrap.mjs','utf8');
 const home=fs.readFileSync('daily-home.mjs','utf8');
 assert.doesNotMatch(source,/import\(['"]\.\/(app\.js|social\.mjs|home-today\.mjs|cube-home\.mjs|home-product\.mjs)/);
 assert.match(source,/historical-share\.mjs/);
 assert.match(source,/daily-home\.mjs/);
 assert.match(source,/renderMyProfile\(\)/,'Account navigation keeps the combined career/account surface');
 assert.match(home,/beginEliteUpgrade\(\{source:'home'\}\)/,'Elite CTA uses the Patreon handoff flow');
});

test('Daily home differentiates free and Elite practice',()=>{
 const p={player:{claimed:true},capabilities:['account'],daily_history:[]};
 const freeHtml=dailyHomeMarkup(p,day);
 assert.match(freeHtml,/Elite practice/);
 assert.match(freeHtml,/Draft beyond the Dailies/);
 assert.match(freeHtml,/Become Elite/);
 assert.doesNotMatch(freeHtml,/Choose your sets/);
 assert.doesNotMatch(freeHtml,/Powered Cube Practice/);

 p.capabilities.push('custom_corpus','unlimited_cube_practice');
 const eliteHtml=dailyHomeMarkup(p,day);
 assert.match(eliteHtml,/Choose your sets/);
 assert.match(eliteHtml,/favorite sets/);
 assert.doesNotMatch(eliteHtml,/favourite/);
 assert.doesNotMatch(eliteHtml,/Become Elite/);

 const guestWithCapability=dailyHomeMarkup({player:{claimed:false},capabilities:['custom_corpus','unlimited_cube_practice'],daily_history:[]},day);
 assert.doesNotMatch(guestWithCapability,/Choose your sets/);
 assert.doesNotMatch(guestWithCapability,/Build a random run/);

 p.daily_history=['mixed','powered-cube','latest'].map(row);
 const completedEliteHtml=dailyHomeMarkup(p,day);
 assert.match(completedEliteHtml,/Powered Cube Practice/);
 assert.doesNotMatch(completedEliteHtml,/Elite adds unlimited Powered Cube and custom-set drafts/);
});

test('Method has no secondary link directory',()=>{
 const html=fs.readFileSync('methodology/index.html','utf8');assert.equal((html.match(/class="method-directory"/g)||[]).length,0);
});
