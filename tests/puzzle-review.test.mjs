import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {buildReviewSet,serialize,assessPuzzle,proposedTop,parseCsv,REVIEW_SETS,OUTPUT_DIR,RULE} from '../scripts/build-puzzle-review-set.mjs';
import {summarizeReview,ratedCount} from '../admin/puzzle-review-results.mjs';
import {cardScores,loadState,emptyState,storageKey} from '../admin/puzzle-review.mjs';
import {adminArea,overviewMarkup,ADMIN_AREAS} from '../admin/overview.mjs';
import {sanitizeAdminDestination} from '../admin/admin-return.mjs';

const read=name=>fs.readFileSync(`${OUTPUT_DIR}/${name}`,'utf8');
const names=JSON.parse(fs.readFileSync('data/set-display-names.json','utf8')).names;

test('checked-in review set and key regenerate exactly from checked-in inputs',()=>{
  const {set,key}=buildReviewSet({setNames:names});
  assert.equal(read('puzzle-review-v1-set.json'),serialize(set));
  assert.equal(read('puzzle-review-v1-key.json'),serialize(key));
});

test('every pair matches set and pick, uses distinct source drafts, and arms meet their rules',()=>{
  const set=JSON.parse(read('puzzle-review-v1-set.json')),key=JSON.parse(read('puzzle-review-v1-key.json'));
  assert.equal(set.items.length,24);
  assert.equal(key.pairs.length,12);
  const sources=new Map();
  for(const id of REVIEW_SETS)for(const p of JSON.parse(gunzipSync(fs.readFileSync(`corpus/draft-run/${id}.json.gz`))))sources.set(p.puzzle_id,p.source_draft_hash);
  const byId=new Map(set.items.map(item=>[item.item_id,item]));
  const used=new Set();
  for(const pair of key.pairs) {
    for(const arm of ['current','proposed']) {
      const item=byId.get(pair[arm]),meta=key.items[pair[arm]];
      assert.equal(item.set_id,pair.set_id);
      assert.equal(item.pick_number,pair.pick_number);
      assert.equal(meta.arm,arm);
      assert.notEqual(meta.band,'easy','Both arms are contested decisions');
      const source=sources.get(meta.puzzle_id);
      assert.ok(source&&!used.has(source),'No source draft appears twice');
      used.add(source);
    }
    const proposed=key.items[pair.proposed];
    assert.equal(proposed.meets_proposed_rule,true);
    assert.ok(proposed.credible.length>=2);
    if(pair.pick_number>=RULE.deck_gate_from_pick)assert.equal(proposed.trophy_in_main_deck,true);
  }
});

test('the blinded set carries no arm, pair, or selection evidence',()=>{
  const text=read('puzzle-review-v1-set.json'),set=JSON.parse(text);
  for(const item of set.items)assert.deepEqual(Object.keys(item).sort(),['candidates','historical_pick_id','item_id','pick_number','prior_picks','set_id','set_name']);
  for(const word of ['"arm"','pair_id','proposed','current','stakes','gih','puzzle_id','main_deck','band'])assert.ok(!text.includes(word),word);
});

const card=(name,p,cost='{1}{W}')=>({id:name,name,mana_cost:cost,model_probability:p});
const puzzle=pick=>({puzzle_id:'x',source_draft_hash:'s',pick_number:pick,historical_pick_id:'B',prior_picks:[{name:'Prior',mana_cost:'{W}'}],
  candidates:[card('A',.4),card('B',.35,'{1}{G}'),card('C',.13),card('D',.12)]});

test('proposed rule: deck gate starts at pick 4, stakes use the strongest credible card',()=>{
  const strength=new Map([['A',1.5],['B',4.2],['C',9]]);
  const out=new Map(),inMain=new Map([['B',1]]);
  for(const pick of [3,4]) {
    const missed=assessPuzzle(puzzle(pick),{strength,mainDeck:out});
    assert.equal(missed.proposed_valid,pick<4,`pick ${pick}`);
    assert.equal(assessPuzzle(puzzle(pick),{strength,mainDeck:inMain}).proposed_valid,true);
  }
  const a=assessPuzzle(puzzle(5),{strength,mainDeck:inMain});
  assert.equal(a.band,'hard');
  assert.equal(a.stakes,4.2,'C is below 35% of the leader, so it is not credible');
  assert.deepEqual(a.credible.map(c=>c.name),['A','B']);
  assert.equal(a.kind,'power-vs-fit');
});

test('proposed pool keeps the top quarter by stakes, at least three',()=>{
  const rows=Array.from({length:10},(_,i)=>({puzzle_id:String(i),stakes:i}));
  assert.deepEqual(proposedTop(rows).map(r=>r.stakes),[9,8,7]);
  assert.deepEqual(proposedTop(Array.from({length:20},(_,i)=>({puzzle_id:String(i),stakes:i}))).map(r=>r.stakes),[19,18,17,16,15]);
  assert.equal(proposedTop([{puzzle_id:'a',stakes:1}]).length,1);
});

test('csv parsing keeps quoted card names with commas',()=>{
  assert.deepEqual(parseCsv('name,A_gih\n"Bilbo, Burglar",0.01\nPlain,-0.02\n'),[{name:'Bilbo, Burglar',A_gih:'0.01'},{name:'Plain',A_gih:'-0.02'}]);
});

const key={pairs:[1,2,3,4].map(i=>({pair_id:'p'+i,set_id:'hob',pick_number:i,current:'c'+i,proposed:'q'+i}))};
const rate=(current,proposed)=>Object.fromEntries([...current.map((r,i)=>['c'+(i+1),{rating:r}]),...proposed.map((r,i)=>['q'+(i+1),{rating:r}])]);

test('review summary applies the fixed pass criteria',()=>{
  const pass=summarizeReview(key,rate(['dull','broken','dull','fine'],['interesting','fine','dull','fine']));
  assert.equal(pass.complete,true);
  assert.deepEqual(pass.criteria.fewer_bad,{proposed:1,current:3,pass:true});
  assert.deepEqual(pass.wins,{proposed:2,current:0,ties:2});
  assert.equal(pass.pass,true);
  const exactlyHalf=summarizeReview(key,rate(['dull','dull','fine','fine'],['dull','interesting','interesting','interesting']));
  assert.equal(exactlyHalf.criteria.fewer_bad.pass,true,'1 is at most half of 2');
  const tooManyBad=summarizeReview(key,rate(['dull','dull','fine','fine'],['dull','dull','interesting','interesting']));
  assert.deepEqual(tooManyBad.criteria.fewer_bad,{proposed:2,current:2,pass:false});
  assert.equal(tooManyBad.criteria.losses.pass,true);
  assert.equal(tooManyBad.pass,false);
  const losses=summarizeReview(key,rate(['interesting','interesting','dull','dull'],['fine','fine','fine','fine']));
  assert.deepEqual(losses.criteria.losses,{losses:2,allowed:1,pass:false});
  const clean=summarizeReview(key,rate(['fine','fine','fine','fine'],['fine','fine','fine','fine']));
  assert.equal(clean.baseline_clean,true);
  assert.equal(summarizeReview(key,rate(['fine'],['fine'])).complete,false);
  assert.equal(ratedCount([{item_id:'c1'},{item_id:'c2'}],{c1:{rating:'fine'},c2:{note:'x'}}),1);
});

test('player-facing scores and saved progress',()=>{
  const item={historical_pick_id:'B',candidates:[card('A',.5),card('B',.25),card('C',0)]};
  assert.deepEqual(cardScores(item),{A:95,B:100,C:0});
  assert.deepEqual(loadState({getItem:()=>'not json'},'k'),emptyState());
  assert.deepEqual(loadState({getItem:()=>{throw Error('blocked');}},'k'),emptyState());
  assert.equal(loadState({getItem:()=>JSON.stringify({ratings:{a:{rating:'fine'}},index:3})},'k').ratings.a.rating,'fine');
  assert.notEqual(storageKey('one'),storageKey('two'));
});

test('puzzle review is a registered admin area with a return destination and overview card',()=>{
  assert.equal(ADMIN_AREAS['puzzle-review'],'Puzzle Review');
  assert.equal(adminArea('?area=puzzle-review'),'puzzle-review');
  assert.equal(sanitizeAdminDestination('/admin/?area=puzzle-review'),'/admin/?area=puzzle-review');
  assert.ok(overviewMarkup({}).includes('?area=puzzle-review'));
});
