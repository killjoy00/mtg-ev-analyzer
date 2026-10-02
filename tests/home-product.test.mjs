import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dailyHomeMarkup} from '../daily-home.mjs';
const day='2026-09-18';
const row=set_id=>({date:day,mode:'draft_run',set_id,score:91});

test('homepage social metadata has no escaped-newline pollution',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.equal(html.includes('\\n'),false,'Homepage HTML must not contain literal \\n escape text');
});
test('homepage metadata names MTG and uses a complete 1200x630 social preview',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/<title>Pack One: Daily MTG Draft Decisions<\/title>/);
 assert.match(html,/Magic: The Gathering draft decisions every day/);
 assert.match(html,/property="og:image" content="https:\/\/packone\.pro\/social-preview-v2\.png"/);
 assert.match(html,/property="og:image:width" content="1200"/);
 assert.match(html,/property="og:image:height" content="630"/);
 const png=fs.readFileSync('social-preview-v2.png');
 assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.equal(png.readUInt32BE(16),1200);
 assert.equal(png.readUInt32BE(20),630);
 let offset=8,sawIend=false;
 while(offset<png.length){
  assert.ok(offset+12<=png.length,'PNG chunk header/CRC must be complete');
  const length=png.readUInt32BE(offset);
  const type=png.subarray(offset+4,offset+8).toString('ascii');
  const next=offset+12+length;
  assert.ok(next<=png.length,'PNG '+type+' chunk must not be truncated');
  offset=next;
  if(type==='IEND'){sawIend=true;break;}
 }
 assert.equal(sawIend,true,'PNG must end with IEND');
 assert.equal(offset,png.length,'PNG must not contain trailing bytes after IEND');
});
test('Daily descriptions reinforce trophy-draft provenance',()=>{
 const html=dailyHomeMarkup(null,day);
 assert.match(html,/Eight decisions from real trophy drafts\./);
 assert.match(html,/Eight decisions from Powered Cube trophy drafts\./);
 assert.match(html,/Eight decisions from trophy drafts in the latest set\./);
 assert.doesNotMatch(html,/Magic’s most powerful cards|Only the latest set/);
});

test('three direct Dailies dominate before completion, without practice or checklist',()=>{
 const html=dailyHomeMarkup(null,day);
 assert.equal((html.match(/>Play now</g)||[]).length,3);
 assert.match(html,/September 18’s Daily Runs/);assert.doesNotMatch(html,/100 = you matched/);
 assert.doesNotMatch(html,/progressbar|Daily board|More modes|Full Pack|Top 3|Keep drafting/);
});
test('fresh guests get a larger Start here label instead of the generic first-row label',()=>{
 const guest=dailyHomeMarkup(null,day);
 assert.match(guest,/daily-home-start">Start here<\/span>/);
 assert.doesNotMatch(guest,/The daily challenge/);
 const signed=dailyHomeMarkup({player:{claimed:true},capabilities:['account'],daily_history:[]},day);
 assert.doesNotMatch(signed,/daily-home-start">Start here<\/span>/);
 assert.match(signed,/The daily challenge/);
 assert.match(guest,/Free · No account required/);
});

test('checking state is neutral instead of pretending the player is a guest',()=>{
 const html=dailyHomeMarkup(null,day,'checking');
 assert.match(html,/data-home-state="checking"/);
 assert.match(html,/data-completed="pending"/);
 assert.equal((html.match(/is-pending/g)||[]).length,3);
 assert.doesNotMatch(html,/is-unplayed|is-complete|Start here|Free · No account required|Create a free account|Dailies complete/);
 assert.match(html,/The daily challenge/);
});

test('failed Daily hydration stays unknown and offers a retry',()=>{
 const html=dailyHomeMarkup(null,day,'unavailable');
 assert.match(html,/data-home-state="unavailable"/);
 assert.equal((html.match(/is-pending/g)||[]).length,3);
 assert.match(html,/Daily progress is temporarily unavailable/);
 assert.match(html,/data-home-retry/);
 assert.doesNotMatch(html,/Start here|Free · No account required|Create a free account/);
});

test('Daily card order stays stable as completion data hydrates',()=>{
 for(const done of ['mixed','powered-cube','latest']){
  const html=dailyHomeMarkup({daily_history:[row(done)]},day);
  assert.ok(html.indexOf('Daily Draft Run')<html.indexOf('Daily Powered Cube'));
  assert.ok(html.indexOf('Daily Powered Cube')<html.indexOf('Daily Latest Set'));
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
 assert.match(html,/Choose a different display name\. That one is already taken/);
 assert.match(html,/Daily results will not appear on the leaderboard/);
 assert.match(html,/data-home-username/);
 const owned=dailyHomeMarkup({...profile,ranking_identity:{eligible:true,reason:null}},day);
 assert.doesNotMatch(owned,/data-home-username|Display name needs attention|Choose a different display name/);
});

test('home runtime isolates historical code and lazily loads profiles',()=>{
 const source=fs.readFileSync('bootstrap.mjs','utf8');
 const home=fs.readFileSync('daily-home.mjs','utf8');
 assert.doesNotMatch(source,/import\(['"]\.\/(app\.js|social\.mjs|home-today\.mjs|cube-home\.mjs|home-product\.mjs)/);
 assert.match(source,/historical-share\.mjs/);
 assert.match(source,/daily-home\.mjs/);
 assert.match(source,/renderDailyHome\(null,'checking'\)/,'Homepage must render an explicit neutral hydration state');
 assert.match(source,/refreshAccountSession\(\)/,'Account-change refreshes must revalidate the session instead of reading stale cached state');
 assert.match(source,/renderAccount\(\{source:'nav'\}\)/,'Account navigation routes guests to sign in and members to My Pack One');
 assert.doesNotMatch(home,/await identityReady;\s*const profile = await loadDailyStatus/,'Daily status must not wait serially behind the account read');
 assert.doesNotMatch(home,/data-home-elite|beginEliteUpgrade/,'Daily home must not duplicate Elite upsells now that Practice is a dedicated hub');
});

test('signed-in Daily home stays Daily-first until completion',()=>{
 const profiles=[
  {player:{claimed:true},capabilities:['account'],daily_history:[]},
  {player:{claimed:true},capabilities:['account','custom_corpus','unlimited_cube_practice'],daily_history:[]},
  {player:{claimed:true},capabilities:['account'],membership:{connected:true},daily_history:[row('mixed')]},
 ];
 for(const profile of profiles){
  const html=dailyHomeMarkup(profile,day);
  assert.doesNotMatch(html,/Free practice|Practice a Draft Run|Elite practice|Become Elite|Upgrade to Elite|Choose your sets|data-home-elite/);
  assert.doesNotMatch(html,/href="\/practice\/"/,'Practice handoff waits until all three Dailies are complete');
 }
 const completed={player:{claimed:true},capabilities:['account','custom_corpus','unlimited_cube_practice'],daily_history:['mixed','powered-cube','latest'].map(row)};
 const completedHtml=dailyHomeMarkup(completed,day);
 assert.match(completedHtml,/href="\/practice\/"[^>]*>Go to Practice<\/a>/);
 assert.doesNotMatch(completedHtml,/Free practice|Practice a Draft Run|Elite practice|Become Elite|Upgrade to Elite|Choose your sets/);
});

test('Method has no secondary link directory',()=>{
 const html=fs.readFileSync('methodology/index.html','utf8');assert.equal((html.match(/class="method-directory"/g)||[]).length,0);
});

// Guests should see the free-account rung after completing all three Dailies,
// while paid Practice options stay off the Daily home entirely.
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

test('membership level does not change the unfinished Daily home',()=>{
 const base={player:{claimed:true},capabilities:['account','unlimited_regular_practice'],daily_history:[]};
 for(const profile of [
  base,
  {...base,membership:{connected:true}},
  {...base,capabilities:[...base.capabilities,'custom_corpus','unlimited_cube_practice'],membership:{connected:true}},
 ]){
  const html=dailyHomeMarkup(profile,day);
  assert.doesNotMatch(html,/Free practice|Elite practice|Become Elite|Upgrade to Elite|Choose your sets|Practice a Draft Run/);
 }
});
