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
test('all three complete hands signed-in players to Practice or guests to account creation',()=>{
 const p={daily_history:[row('mixed'),row('powered-cube'),row('latest')],player:{claimed:true},capabilities:['account']};
 const freeHtml=dailyHomeMarkup(p,day);
 assert.match(freeHtml,/Dailies complete/);
 assert.match(freeHtml,/Your practice options are all in one place/);
 assert.match(freeHtml,/href="\/practice\/"[^>]*>Go to Practice<\/a>/);
 assert.doesNotMatch(freeHtml,/Start Another Draft Run|Powered Cube Practice|Choose your sets|Become Elite|Upgrade to Elite/);
 p.player.claimed=false;const guestHtml=dailyHomeMarkup(p,day);
 assert.match(guestHtml,/Create a free account/);
 assert.doesNotMatch(guestHtml,/Go to Practice|Start Another Draft Run/);
 assert.doesNotMatch(guestHtml,/Elite adds unlimited Powered Cube and custom-set drafts/);
});

test('linked accounts with unresolved usernames are warned before Dailies',()=>{
 const profile={player:{claimed:true},capabilities:['account'],ranking_identity:{eligible:false,reason:'username_taken'},daily_history:[]};
 const html=dailyHomeMarkup(profile,day);
 assert.match(html,/Choose a unique username before playing a Daily/);
 assert.match(html,/Daily results will not appear on the leaderboard/);
 assert.match(html,/data-home-username/);
 const owned=dailyHomeMarkup({...profile,ranking_identity:{eligible:true,reason:null}},day);
 assert.doesNotMatch(owned,/data-home-username|Username needs attention|Choose a unique username before playing a Daily/);
});

test('home runtime isolates historical code and lazily loads profiles',()=>{
 const source=fs.readFileSync('bootstrap.mjs','utf8');
 const home=fs.readFileSync('daily-home.mjs','utf8');
 assert.doesNotMatch(source,/import\(['"]\.\/(app\.js|social\.mjs|home-today\.mjs|cube-home\.mjs|home-product\.mjs)/);
 assert.match(source,/historical-share\.mjs/);
 assert.match(source,/daily-home\.mjs/);
 assert.match(source,/renderAccount\(\{source:'nav'\}\)/,'Account navigation routes guests to sign in and members to My Pack One');
 assert.match(home,/beginEliteUpgrade\(\{source:'home'\}\)/,'Elite CTA uses the Patreon handoff flow');
});

test('Daily home differentiates free and Elite practice',()=>{
 const p={player:{claimed:true},capabilities:['account'],daily_history:[]};
 const freeHtml=dailyHomeMarkup(p,day);
 assert.match(freeHtml,/<h2 class="eyebrow">Free practice<\/h2>/);
 assert.match(freeHtml,/Practice a Draft Run/);
 assert.ok(freeHtml.indexOf('Practice a Draft Run')<freeHtml.indexOf('Elite practice'),'regular practice appears before the Elite upsell');
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
 assert.match(completedEliteHtml,/href="\/practice\/"[^>]*>Go to Practice<\/a>/);
 assert.doesNotMatch(completedEliteHtml,/Powered Cube Practice|Choose your sets|Elite practice|Elite adds unlimited Powered Cube and custom-set drafts/);
});

test('Method has no secondary link directory',()=>{
 const html=fs.readFileSync('methodology/index.html','utf8');assert.equal((html.match(/class="method-directory"/g)||[]).length,0);
});

// Guests should see the free-account rung before any paid ask. The guest
// Elite handoff still exists for an explicit premium action, but it is not
// advertised on the landing page.
test('a guest is not asked to pay on the Daily home',()=>{
 const complete=['mixed','powered-cube','latest'].map(row);
 for(const profile of [null,{player:{claimed:false},capabilities:[],daily_history:[]},
                       {player:{claimed:false},capabilities:[],daily_history:complete}]){
  const html=dailyHomeMarkup(profile,day);
  assert.doesNotMatch(html,/data-home-elite|Become Elite|Upgrade to Elite/);
 }
 const done=dailyHomeMarkup({player:{claimed:false},capabilities:[],daily_history:complete},day);
 assert.match(done,/Create a free account/);
 assert.doesNotMatch(done,/Practice a Draft Run/);
});

// A Supporter holds no paid capability, so before membership was surfaced they
// were indistinguishable from a free account and told to "become" a paying
// member. Covers a lapsed Elite for the same reason.
test('a connected member is asked to upgrade, not to become',()=>{
 const base={player:{claimed:true},capabilities:['account','unlimited_regular_practice'],daily_history:[]};

 const free=dailyHomeMarkup(base,day);
 assert.match(free,/Become Elite/);assert.doesNotMatch(free,/Upgrade to Elite/);

 const supporter=dailyHomeMarkup({...base,membership:{connected:true}},day);
 assert.match(supporter,/Upgrade to Elite/);assert.doesNotMatch(supporter,/Become Elite/);
 assert.match(supporter,/data-home-elite/,'the upgrade still uses the Patreon handoff');

 // Explicitly unconnected must read the same as absent.
 const unconnected=dailyHomeMarkup({...base,membership:{connected:false}},day);
 assert.match(unconnected,/Become Elite/);assert.doesNotMatch(unconnected,/Upgrade to Elite/);

 // Once the Dailies are done, the home hands signed-in players to the Practice hub instead of repeating paid options.
 const done={...base,membership:{connected:true},daily_history:['mixed','powered-cube','latest'].map(row)};
 const doneHtml=dailyHomeMarkup(done,day);
 assert.match(doneHtml,/href="\/practice\/"[^>]*>Go to Practice<\/a>/);
 assert.doesNotMatch(doneHtml,/Become Elite|Upgrade to Elite|Elite practice/);

 // An Elite member is never asked for either.
 const eliteHtml=dailyHomeMarkup({...base,capabilities:[...base.capabilities,'custom_corpus','unlimited_cube_practice'],membership:{connected:true}},day);
 assert.match(eliteHtml,/Choose your sets/);
 assert.doesNotMatch(eliteHtml,/Become Elite|Upgrade to Elite/);
});
