import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {editorialPlan,manaFacts,printId,verifiedOracle,optionFacts,fetchOracleMetadata} from '../scripts/social-editorial.mjs';
import {motionScenes,motionGraphic} from '../scripts/render-social-motion-review.mjs';
import {buildMotionSoundtrack} from '../scripts/social-motion-soundtrack.mjs';
import {selectSocialDecision,socialCandidate} from '../scripts/social-motion-selection.mjs';
import {graphemes} from '../scripts/featured-debate.mjs';
const {examples}=JSON.parse(readFileSync(new URL('./fixtures/social-debate-seven-real.json',import.meta.url)));
const f=examples[0],id=printId(f.choices[0]);
test('seven distinct real closed-day fixtures cover two and three choices and P1P1/later decisions',()=>{
 assert.equal(examples.length,7);
 assert.equal(new Set(examples.map(x=>x.puzzle_id)).size,7);
 assert.ok(examples.every(x=>x.day<'2026-11-25'&&x.players>=50));
 assert.ok(examples.some(x=>x.pick_number===1)&&examples.some(x=>x.pick_number>1));
 assert.deepEqual([...new Set(examples.map(x=>x.tier))].sort(),[2,3]);
 for(const x of examples){
  const p=editorialPlan(x),again=editorialPlan(x);
  assert.deepEqual(p,again);
  assert.equal(p.options.length,x.tier);
  assert.ok(p.morning.includes('Results later today.')&&p.morning.includes('#MTGDraft'));
  assert.ok(graphemes(p.morning)<=300&&graphemes(p.reply)<=300);
  assert.doesNotMatch(p.morning,/\d+%|trophy drafter took|trophy drafter picked/i);
  assert.match(p.reply,/Pack One players/);
  assert.match(p.reply,/packone\.pro/);
  assert.ok(p.options.every(o=>o.metadata==='printed-metadata-only'&&!o.evidence.length));
  assert.equal(p.coverage.verified,0);
  assert.ok(p.alt.includes('No results shown.'));
  const scenes=motionScenes(x,p,'logo');
  assert.equal(scenes.reduce((n,s)=>n+s.seconds,0),x.tier===3?34:30);
  assert.equal(scenes.filter(s=>s.kind==='option').length,x.tier);
  assert.ok(scenes.some(s=>s.kind==='results'&&s.animate>1));
  assert.ok(scenes.filter(s=>s.kind==='hook'||s.kind==='option'||s.kind==='choose'||s.kind==='countdown').every(s=>!/THE TROPHY DRAFTER PICKED|THE COMMUNITY PICKED/.test(s.body)));
  assert.doesNotMatch(motionGraphic(x,p,'logo'),/THE TROPHY DRAFTER PICKED|THE COMMUNITY PICKED/);
  for(const c of x.prior_picks)assert.ok(p.alt.includes(c.name));
 }
});
test('reject missing vote totals, zero choices, and misrepresented percentages',()=>{
 const c=structuredClone(f);c.choices[0].pct+=1;
 assert.throws(()=>editorialPlan(c),/denominator/);
 const d=structuredClone(f);d.other_votes++;
 assert.throws(()=>editorialPlan(d),/denominator/);
 const e=structuredClone(f);e.choices[0].votes=0;
 assert.throws(()=>editorialPlan(e),/editorial inputs/);
});
test('mana analysis distinguishes fixed pips, hybrid alternatives and variable costs',()=>{
 assert.deepEqual(manaFacts('{3}{B}{B}').fixed,['B','B']);
 assert.equal(manaFacts('{3}{B}{B}').value,5);
 assert.deepEqual(manaFacts('{1}{U/R}').possible,['U','R']);
 assert.deepEqual(manaFacts('{1}{U/R}').fixed,[]);
 assert.equal(manaFacts('{X}{G}').value,null);
 assert.equal(manaFacts('{B/P}').exotic,true);
 assert.equal(manaFacts('5B').valid,false);
});
test('verified oracle only uses matching printing, name and printed cost',()=>{
 const c=f.choices[0],byId={[id]:{id,name:c.name,mana_cost:c.mana_cost,oracle_text:'When this enters, destroy target creature.'}};
 assert.equal(verifiedOracle(c,byId).source,'scryfall-exact-printing');
 const a=optionFacts(c,byId);
 assert.equal(a.role,'Creature removal');
 assert.equal(a.metadata,'verified-rules');
 assert.match(a.evidence[0].evidence,/destroy target creature/);
 assert.equal(verifiedOracle(c,{[id]:{...byId[id],name:'Wrong card'}}),null);
 assert.equal(verifiedOracle(c,{[id]:{...byId[id],mana_cost:'{U}'}}),null);
 assert.equal(verifiedOracle(c,{[id]:{...byId[id],id:'wrong'}}),null);
 const quoted={[id]:{...byId[id],oracle_text:'This creature has "Destroy target creature."'}};
 assert.equal(optionFacts(c,quoted).evidence.length,0);
});
test('metadata lookup uses exact printing IDs and explicit fallback on failure',async()=>{
 let requested;
 const c=f.choices[0];
 const mock=async(url,init)=>{assert.equal(url,'https://api.scryfall.com/cards/collection');requested=JSON.parse(init.body);return {ok:true,json:async()=>({data:[{id,name:c.name,oracle_text:'Draw a card.'}]})};};
 const result=await fetchOracleMetadata([c,c],{fetcher:mock});
 assert.deepEqual(requested.identifiers,[{id}]);
 assert.equal(result[id].name,c.name);
 assert.deepEqual(await fetchOracleMetadata([c],{fetcher:async()=>({ok:false})}),{});
});
test('quiet original soundtrack conforms to scene length and loudness bounds',()=>{
 for(const length of [30,34]){
  const a=buildMotionSoundtrack(length,[{kind:'results',at:length-12},{kind:'trophy',at:length-7}]);
  assert.equal(a.wav.toString('ascii',0,4),'RIFF');
  assert.equal(a.wav.length,44+length*32000*2);
  assert.ok(a.stats.rms_dbfs<=-18&&a.stats.rms_dbfs>=-35);
  assert.ok(a.stats.peak_dbfs<=-8);
  assert.equal(a.stats.narration,false);
 }
});
// Reconstruct a synthetic full candidate row to test the daily selector;
// this test data is not a real editorial example or publishable draft.
const cards=examples[0].choices.map((c,i)=>({...c,model_probability:[.5,.3,.2][i]}));
const row={environment:'latest',puzzle_id:'test-puzzle',set_id:'fra',round:1,pick_number:1,
 payload:{candidates:cards,prior_picks:[],historical_pick_id:cards[1].id},votes:Object.fromEntries(cards.map((c,i)=>[c.id,[40,35,25][i]]))};
test('daily selection skips current, future, duplicate and weak model picks; falls back only seven days',()=>{
 const opts={publicationDay:'2026-11-25',usedPuzzleIds:new Set()};
 const a=selectSocialDecision([{day:'2026-11-25',rows:[row]},{day:'2026-11-24',rows:[row]}],opts);
 assert.equal(a.day,'2026-11-24');assert.equal(a.publication_day,'2026-11-25');assert.equal(a.tier,3);
 assert.equal(a.choices[0].mana_cost,cards[0].mana_cost);
 assert.equal(selectSocialDecision([{day:'2026-11-25',rows:[row]}],opts),null);
 assert.equal(selectSocialDecision([{day:'2026-11-17',rows:[row]}],opts),null);
 assert.equal(selectSocialDecision([{day:'2026-11-24',rows:[row]}],{...opts,usedPuzzleIds:new Set([row.puzzle_id])}),null);
 assert.equal(selectSocialDecision([{day:'2026-11-24',rows:[]},{day:'2026-11-23',rows:[row]}],opts).age_days,2);
 const weak=structuredClone(row);weak.payload.candidates[1].model_probability=.01;
 assert.equal(socialCandidate(weak,'2026-11-24'),null);
 assert.throws(()=>selectSocialDecision([{day:'2026-11-24',rows:[row]}],{publicationDay:'2026-11-25'}),/history/);
});
