import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inflateSync} from 'node:zlib';
import vm from 'node:vm';
import {dailyHomeMarkup} from '../daily-home.mjs';
import {MOBILE_STORE_URLS} from '../worker/mobile-version.mjs';
const day='2026-09-18';
const row=set_id=>({date:day,mode:'draft_run',set_id,score:91});

test('homepage social metadata has no escaped-newline pollution',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.equal(html.includes('\\n'),false,'Homepage HTML must not contain literal \\n escape text');
});
test('homepage metadata uses a shallow branded preview with a compact Twitter icon',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/<title>Pack One: Free Daily MTG Draft Practice Game<\/title>/);
 assert.match(html,/Free daily MTG draft practice: make eight picks from real Magic: The Gathering trophy drafts/);
 assert.match(html,/property="og:image" content="https:\/\/packone\.pro\/social-preview-v6\.png"/);
 assert.match(html,/property="og:image:width" content="1200"/);
 assert.match(html,/property="og:image:height" content="240"/);
 assert.match(html,/name="twitter:image" content="https:\/\/packone\.pro\/pack-one-icon-v1\.png"/);
 assert.match(html,/rel="apple-touch-icon"[^>]*href="https:\/\/packone\.pro\/pack-one-icon-v1\.png"/);
 assert.match(html,/name="twitter:card" content="summary"/);
});
test('both older Daily share bridges keep working with a date-neutral large preview',()=>{
 for(const route of ['/share/daily/','/share/daily/v2/']){
  const html=fs.readFileSync(route.slice(1)+'index.html','utf8');
  assert.match(html,/property="og:title" content="Pack One: Eight Picks from Real Trophy Drafts"/);
  assert.match(html,/property="og:image" content="https:\/\/packone\.pro\/share-daily-v1\.png"/);
  assert.match(html,/property="og:image:height" content="630"/);
  assert.match(html,/name="twitter:card" content="summary_large_image"/);
  assert.doesNotMatch(html,/beat today’s score/,'an old link may open a different Daily');
  assert.ok(html.includes('property="og:url" content="https://packone.pro'+route+'"'));
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  for(const environment of ['mixed','powered-cube','latest','untrusted-set']){
   let redirected;
   vm.runInNewContext(script,{URL,URLSearchParams,location:{origin:'https://packone.pro',search:'?environment='+environment+'&ref=result_share',replace(value){redirected=new URL(value,'https://packone.pro');}}});
   assert.equal(redirected.pathname,'/');
   assert.equal(redirected.searchParams.get('game'),'draft-run');
   assert.equal(redirected.searchParams.get('daily'),'1');
   assert.equal(redirected.searchParams.get('ref'),'result_share');
   assert.equal(redirected.searchParams.get('set'),['powered-cube','latest'].includes(environment)?environment:null);
  }
 }
});
test('per-mode Daily share pages open the recipient\'s own Daily and carry the sharer\'s date',()=>{
 for(const [mode,label] of [['mixed','Draft Run'],['latest','Latest Set'],['powered-cube','Powered Cube']]){
  const route='/share/daily/'+mode+'/';
  const html=fs.readFileSync(route.slice(1)+'index.html','utf8');
  assert.match(html,new RegExp('property="og:title" content="Pack One '+label+' Daily"'));
  assert.match(html,/Play today’s Daily free, no account needed/);
  assert.match(html,/property="og:image" content="https:\/\/packone\.pro\/share-daily-v1\.png"/);
  assert.ok(html.includes('property="og:url" content="https://packone.pro'+route+'"'));
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  for(const [search,day] of [['?ref=result_share&d=2026-10-27','2026-10-27'],['?ref=result_share&d=<script>',null],['?ref=result_share',null]]){
   let redirected;
   vm.runInNewContext(script,{URL,URLSearchParams,location:{origin:'https://packone.pro',search,replace(value){redirected=new URL(value,'https://packone.pro');}}});
   assert.equal(redirected.pathname,'/');
   assert.equal(redirected.searchParams.get('daily'),'1');
   assert.equal(redirected.searchParams.get('ref'),'result_share');
   assert.equal(redirected.searchParams.get('set'),mode==='mixed'?null:mode);
   assert.equal(redirected.searchParams.get('d'),day);
   assert.equal(redirected.searchParams.has('challenge')||redirected.searchParams.has('shared'),false,
    'a Daily share never becomes a replay of revealed decisions');
  }
 }
});
test('short Daily share links mark the visit as a result share and carry only the sharer\'s date',()=>{
 for(const [route,mode,label] of [['/d/','mixed','Draft Run'],['/d/c/','powered-cube','Powered Cube'],['/d/l/','latest','Latest Set']]){
  const html=fs.readFileSync(route.slice(1)+'index.html','utf8');
  assert.match(html,new RegExp('property="og:title" content="Pack One '+label+' Daily"'));
  assert.match(html,/Play today’s Daily free, no account needed/);
  assert.match(html,/property="og:image" content="https:\/\/packone\.pro\/share-daily-v1\.png"/);
  assert.match(html,/name="robots" content="noindex,nofollow"/);
  assert.ok(html.includes('property="og:url" content="https://packone.pro'+route+'"'));
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  for(const [search,day] of [['?d=2026-10-27','2026-10-27'],['?d=<script>',null],['',null],['?d=2026-10-27&ref=other&set=powered-cube','2026-10-27']]){
   let redirected;
   vm.runInNewContext(script,{URL,URLSearchParams,location:{origin:'https://packone.pro',search,replace(value){redirected=new URL(value,'https://packone.pro');}}});
   assert.equal(redirected.pathname,'/');
   assert.equal(redirected.searchParams.get('game'),'draft-run');
   assert.equal(redirected.searchParams.get('daily'),'1');
   assert.equal(redirected.searchParams.get('ref'),'result_share','the short path alone attributes the visit');
   assert.equal(redirected.searchParams.get('set'),mode==='mixed'?null:mode,'the path, not the query, picks the mode');
   assert.equal(redirected.searchParams.get('d'),day);
   assert.equal(redirected.searchParams.has('challenge')||redirected.searchParams.has('shared'),false,
    'a Daily share never becomes a replay of revealed decisions');
  }
 }
});
test('share assets are complete PNGs with genuinely shallow banner dimensions',()=>{
 for(const [file,width,height] of [['social-preview-v6.png',1200,240],['pack-one-icon-v1.png',1024,1024],['share-daily-v1.png',1200,630]]){
  const png=fs.readFileSync(file);
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16),width);
  assert.equal(png.readUInt32BE(20),height);
  let offset=8,ended=false;const compressed=[];
  while(offset+12<=png.length){
   const length=png.readUInt32BE(offset);const type=png.subarray(offset+4,offset+8).toString();
   assert.ok(offset+12+length<=png.length,'PNG chunk must be complete');
   if(type==='IDAT')compressed.push(png.subarray(offset+8,offset+8+length));
   offset+=12+length;
   if(type==='IEND'){ended=true;break;}
  }
  assert.equal(ended,true,'PNG must have an IEND chunk');
  assert.equal(offset,png.length,'PNG must have no trailing bytes');
  assert.ok(inflateSync(Buffer.concat(compressed)).length>width*height,'image data must decompress');
 }
});
test('Daily hero tagline and second-line invitation match website and mobile',()=>{
 const html=dailyHomeMarkup(null,day);
 assert.ok(html.includes("<h1>Eight picks. What would you take?</h1>"),'web hero heading');
 assert.ok(html.includes("These picks come from real trophy drafts.<br>Make your pick. See what the trophy drafter chose."),'web invitation starts on a new line');
 const native=fs.readFileSync('mobile/src/screens/index.tsx','utf8');
 assert.ok(native.includes("<Text style={styles.title}>Eight picks. What would you take?</Text>"),'native hero heading');
 assert.ok(native.includes("These picks come from real trophy drafts.{'\\n'}Make your pick. See what the trophy drafter chose."),'native invitation starts on a new line');
 assert.ok(!html.includes('and how your pick scored.'),'web hero should not mention scoring');
 assert.ok(!native.includes('and how your pick scored.'),'native hero should not mention scoring');
});

test('approved editorial copy is consistent across web and native app',()=>{
 const expected={
  'practice/index.html':'<h1>Want another eight picks?</h1>',
  'learn/index.html':'<h1>How Pack One works.</h1>',
  'methodology/index.html':'Play today&rsquo;s Daily',
  'scoring/index.html':'<h2>What if the model disagrees?</h2>',
  'sets/index.html':'<h1>Which sets are available?</h1>',
  'mobile/src/screens/index.tsx':'<Text style={styles.utilityTitle}>Want another eight picks?</Text>',
  'mobile/src/screens/practice.tsx':'<Text style={[styles.title, tablet && styles.tabletTitle]}>Want another eight picks?</Text>',
  'mobile/src/screens/learn.tsx':'<Text style={styles.title}>How Pack One works.</Text>',
  'mobile/app/scoring.tsx':"title: 'What if the model disagrees?'",
  'mobile/app/sets.tsx':'<Text style={styles.title}>Which sets are available?</Text>',
  'mobile/app/set-archive.tsx':'TRY A PRACTICE RUN',
 };
 for(const [path,phrase] of Object.entries(expected)){
  assert.ok(fs.readFileSync(path,'utf8').includes(phrase),path+' missing approved copy');
 }
 const learn=fs.readFileSync('learn/index.html','utf8');
 assert.ok(learn.includes('Compare your picks with the trophy drafter.'));
 const about=fs.readFileSync('about/index.html','utf8');
 const nativeAbout=fs.readFileSync('mobile/src/nativeEditorial.ts','utf8');
 for(const copy of [about,nativeAbout]){
  assert.ok(copy.includes("I'm not a programmer, and I built Pack One with a lot of help from AI tools."));
  assert.ok(copy.includes("I'm responsible when something doesn't work."));
  assert.ok(!copy.includes('But the vision and decisions are mine.'));
 }
 const completed=dailyHomeMarkup({daily_history:['mixed','powered-cube','latest'].map(row),player:{claimed:true},capabilities:['account']},day);
 assert.ok(completed.includes('<h2>Want another eight picks?</h2>'));
});


test('Daily-home copy follows website markup across native cards and states', () => {
 const native=fs.readFileSync('mobile/src/screens/index.tsx','utf8');
 const modes=fs.readFileSync('mobile/src/api/draftRun.ts','utf8');
 const guest=dailyHomeMarkup(null,day);
 const signed=dailyHomeMarkup({player:{claimed:true},capabilities:['account'],daily_history:[]},day);

 // An obsolete eyebrow and a native-only section heading should not reappear.
 assert.doesNotMatch(guest, /The daily draft/i);
 assert.doesNotMatch(native, /THE DAILY DRAFT|PLAY TODAY/);
 assert.ok(!guest.includes('<p class="eyebrow">'));

 const rows=[...signed.matchAll(/data-environment="([^"]+)"[\s\S]*?<p class="daily-home-label">([^<]+)<\/p><h2>([^<]+)<\/h2><p>([^<]+)<\/p>/g)];
 assert.equal(rows.length,3,'website should be authoritative for three Daily cards');
 for(const [,environment,label,title,description] of rows){
  const key=environment.includes('-')?`'${environment}'`:`${environment}`;
  assert.ok(native.includes(`${key}: '${title}'`),`native home title must match website: ${environment}`);
  assert.ok(native.includes(`${key}: '${label.toUpperCase()}'`),`native card label must match website: ${environment}`);
  assert.ok(modes.includes(`description: '${description}'`),`native Daily description must match website: ${environment}`);
 }
 for(const phrase of [
  'Eight picks. What would you take?', 'Make your pick. See what the trophy drafter chose.',
  'Start here', 'Free · No account required', 'Play now', 'View result',
  'Want another eight picks?', 'DAILIES COMPLETE',
  'Keep playing regular Draft Runs, or any sets with Pack One Elite.',
  'A free account adds unlimited regular Draft Runs.',
  'Create a free account', 'Go to Practice',
  'Couldn’t load your Daily progress. Play now will still pick up where you left off.',
  'Pick a display name that isn’t taken, or your Daily scores won’t show on the leaderboard.',
  'Change display name',
 ]) assert.ok(native.includes(phrase === 'Start here' ? 'START HERE' : phrase),`native copy missing website phrase: ${phrase}`);
 assert.ok(guest.includes('Free · No account required'));
 assert.ok(guest.includes('Start here'));
 const completedGuest=dailyHomeMarkup({daily_history:['mixed','powered-cube','latest'].map(row),player:{claimed:false}},day);
 assert.ok(completedGuest.includes('A free account adds unlimited regular Draft Runs.'));
 assert.ok(completedGuest.includes('Create a free account'));
 assert.ok(signed.includes('A mix of sets'));
});

test('Daily descriptions reinforce trophy-draft provenance',()=>{
 const html=dailyHomeMarkup(null,day);
 assert.match(html,/Eight picks from real trophy drafts\./);
 assert.match(html,/Eight picks from Powered Cube trophy drafts\./);
 assert.match(html,/Eight picks from trophy drafts in the latest set\./);
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
 assert.match(signed,/A mix of sets/);
 assert.match(guest,/Free · No account required/);
});

test('checking state is neutral instead of pretending the player is a guest',()=>{
 const html=dailyHomeMarkup(null,day,'checking');
 assert.match(html,/data-home-state="checking"/);
 assert.match(html,/data-completed="pending"/);
 assert.equal((html.match(/is-pending/g)||[]).length,3);
 assert.doesNotMatch(html,/is-unplayed|is-complete|Start here|Free · No account required|Create a free account|Dailies complete/);
 assert.match(html,/A mix of sets/);
});

test('failed Daily hydration stays unknown and offers a retry',()=>{
 const html=dailyHomeMarkup(null,day,'unavailable');
 assert.match(html,/data-home-state="unavailable"/);
 assert.equal((html.match(/is-pending/g)||[]).length,3);
 assert.match(html,/Couldn’t load your Daily progress/);
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
 assert.match(freeHtml,/Keep playing regular Draft Runs, or any sets with Pack One Elite/);
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
 assert.match(html,/your Daily scores won’t show on the leaderboard/);
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

test('Daily reset and streak appear only after all three Dailies are complete for a signed-in account', () => {
 const entries=['mixed','powered-cube','latest'];
 const markup=(environments,claimed,state='ready')=>dailyHomeMarkup({
   player:{claimed},daily_streak:9,daily_history:environments.map(row)
 },day,state);
 const assertHidden=(html,scenario)=>{
   assert.doesNotMatch(html,/data-daily-reset|daily-home-streak|Checking streak/i,scenario);
   assert.doesNotMatch(html,/has-home-status/,scenario);
   assert.match(html,/daily-home-heading[^]*?Daily Runs/,scenario);
 };
 for(const count of [0,1,2]){
   assertHidden(markup(entries.slice(0,count),true),`signed in, ${count} finished`);
 }
 assertHidden(markup(entries,false),'guest completed all 3');
 assertHidden(markup(entries,true,'checking'),'still checking');
 assertHidden(markup(entries,true,'unavailable'),'progress unavailable');
 const complete=markup(entries,true);
 assert.match(complete,/class="daily-home has-home-status"/);
 assert.match(complete,/data-daily-reset/);
 assert.match(complete,/9-day streak/);
});

test('Leaderboards keep website-authored explanations and game names in the native app', () => {
 const web=fs.readFileSync('draft-run-product.mjs','utf8');
 const native=fs.readFileSync('mobile/src/screens/leaderboard.tsx','utf8');
 for(const text of [
   'First attempts only. Everyone gets the same packs.',
   'Season rating uses every first-attempt Daily score, with a larger deduction when you have played fewer days.',
   'You rank after your first Daily; missed days do not count as zero.',
   'Average of your best ',
   'days not played count as 0. Days played are shown alongside.',
 ]) {
   assert.ok(web.includes(text),'website missing approved board explanation: '+text);
   assert.ok(native.includes(text),'native is out of sync with web: '+text);
 }
 for(const old of ['See how the field drafted.', 'Ranked scores come from Pack One Daily runs validated to an eligible account.']) {
   assert.ok(!native.includes(old),'unapproved native-only leaderboard copy: '+old);
 }
 assert.match(native,/mixed: 'Draft Run', 'powered-cube': 'Cube', latest: 'Latest Set'/);
});


test('Daily homepage app badges link to the official platform listings without interrupting play',()=>{
 const apple='assets/store-badges/app-store-en-black.svg';
 const google='assets/store-badges/google-play-en.png';
 assert.ok(fs.existsSync(apple),'Apple first-party SVG must be present');
 assert.match(fs.readFileSync(apple,'utf8'),/<svg\b/,'Apple badge must be an SVG');
 const googlePng=fs.readFileSync(google);
 assert.equal(googlePng.subarray(0,8).toString('hex'),'89504e470d0a1a0a','Google first-party asset must be a PNG');
 assert.equal(googlePng.readUInt32BE(16),646);
 assert.equal(googlePng.readUInt32BE(20),250);
 assert.equal(fs.existsSync('assets/store-badges/google-play-en.svg'),false,'the mirrored Google SVG must not ship');
 const completeProfile={daily_history:['mixed','powered-cube','latest'].map(row),player:{claimed:true},capabilities:['account']};
 for(const [profile,state] of [[null,'ready'],[null,'checking'],[completeProfile,'ready']]) {
  const html=dailyHomeMarkup(profile,day,state);
  assert.equal((html.match(/class="daily-home-store-links"/g)||[]).length,1);
  assert.match(html,/Also on iPhone and Android/);
  assert.ok(html.indexOf('data-environment="latest"')<html.indexOf('class="daily-home-store-links"'));
  assert.ok(html.includes(`href="${MOBILE_STORE_URLS.ios}"`));
  assert.ok(html.includes(`href="${MOBILE_STORE_URLS.android}"`));
  assert.ok(html.includes(`src="/${apple}"`));
  assert.ok(html.includes(`src="/${google}"`));
  assert.match(html,/aria-label="Download Pack One on the App Store"/);
  assert.match(html,/aria-label="Get Pack One on Google Play"/);
  if(profile===completeProfile)assert.ok(html.indexOf('daily-home-practice')<html.indexOf('daily-home-store-links'));
 }
 const css=fs.readFileSync('daily-home.css','utf8');
 assert.match(css,/\.daily-home-store-links\s*\{/);
 assert.match(css,/\.daily-home-store-badges img\s*\{[^}]*height:40px/);
 assert.match(css,/\.daily-home-store-badges img\.google-play-badge\s*\{[^}]*height:60px/,'Google PNG retains its transparent margins');
 assert.match(css,/\.daily-home-store-badges\s*\{[^}]*gap:20px/,'badges need at least 10px each clear space');
 assert.match(css,/@media\(max-width:600px\)\s*\{\s*\.daily-home-store-links\s*\{[^}]*gap:10px/,'mobile label needs 10px clearance');
});
