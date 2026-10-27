import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {puzzleSelectionFeatures,stakesTopPoolSize,isLandCard,STAKES_RULE,SELECTION_FEATURE_VERSION} from '../puzzle-selection.mjs';
import {assessPuzzle,strengthTable,isLand,RULE} from '../scripts/build-puzzle-review-set.mjs';
import {loadStrengthTable,loadMainDecks,scoreImportedPuzzles} from '../scripts/score-puzzle-selection.mjs';

const card=(id,name,model_probability,type_line='Creature')=>({id,name,model_probability,type_line});
const strength=points=>({version:'gih-shrunk-400-v1',sha256:'a'.repeat(64),cards:new Map(Object.entries(points))});

test('features: credible options, stakes, deck membership and land answers',()=>{
  const puzzle={puzzle_id:'p',historical_pick_id:'b',candidates:[
    card('a','Leader',.5),card('b','Runner',.2,'Land'),card('c','Third',.18),card('d','Fourth',.176),card('e','Weak',.1)]};
  const features=puzzleSelectionFeatures(puzzle,{strength:strength({Leader:1.5,Runner:4.25,Fourth:9,Weak:20}),mainDeck:new Map([['Runner',1]])});
  // Credible: at least 35% of the leader (0.175), top three only, so Fourth
  // (0.176) is credible but cut, and Weak never counts.
  assert.deepEqual(features,{puzzle_id:'p',feature_version:SELECTION_FEATURE_VERSION,strength_version:'gih-shrunk-400-v1',
    strength_sha256:'a'.repeat(64),stakes_points:4.25,credible_count:3,trophy_in_main_deck:true,trophy_is_land:true});
  const bare=puzzleSelectionFeatures(puzzle,{});
  assert.equal(bare.stakes_points,null);assert.equal(bare.strength_version,null);assert.equal(bare.trophy_in_main_deck,null);
  assert.equal(puzzleSelectionFeatures(puzzle,{strength:strength({}),mainDeck:new Map()}).stakes_points,null);
  assert.equal(puzzleSelectionFeatures(puzzle,{mainDeck:new Map([['Leader',2]])}).trophy_in_main_deck,false);
  assert.throws(()=>puzzleSelectionFeatures({...puzzle,historical_pick_id:'z'},{}),/no trophy pick/);
  assert.equal(isLandCard({type_line:'Artifact Land'}),true);
  assert.equal(isLandCard({type_line:'Sorcery // Land'}),true);
  assert.equal(isLandCard({type_line:'Creature — Elf'}),false);
});

test('the top pool keeps a quarter, at least three',()=>{
  assert.deepEqual([0,1,2,3,4,12,13,40].map(n=>stakesTopPoolSize(n)),[0,1,2,3,3,3,4,10]);
});

test('stored features match the reviewed rule on every reviewed set',async()=>{
  // The owner review (scripts/build-puzzle-review-set.mjs) defined the rule.
  // Production must compute the same values from the same inputs.
  assert.equal(STAKES_RULE.credible_support_ratio,RULE.credible_support_ratio);
  assert.equal(STAKES_RULE.max_credible_options,RULE.max_credible_options);
  assert.equal(STAKES_RULE.deck_gate_from_pick,RULE.deck_gate_from_pick);
  assert.equal(STAKES_RULE.top_share,RULE.top_share);
  assert.equal(STAKES_RULE.min_top_pool,RULE.min_top_pool);
  let compared=0;
  for(const setId of ['hob','msh','sos','blb','ecl']) {
    const points=strengthTable(readFileSync(`research/card-strength-v1-results/strengths-${setId.toUpperCase()}.csv`,'utf8'));
    const decks=await loadMainDecks(setId);
    for(const puzzle of JSON.parse(gunzipSync(readFileSync(`corpus/draft-run/${setId}.json.gz`)))) {
      const deck=decks(puzzle.source_draft_hash);
      const reviewed=assessPuzzle(puzzle,{strength:points,mainDeck:deck||new Map()});
      const stored=puzzleSelectionFeatures(puzzle,{strength:{version:'benchmark',sha256:'0'.repeat(64),cards:points},mainDeck:deck});
      assert.equal(stored.stakes_points,reviewed.stakes,puzzle.puzzle_id);
      assert.equal(stored.credible_count,reviewed.credible.length,puzzle.puzzle_id);
      assert.equal(stored.trophy_in_main_deck??false,reviewed.trophy_in_main_deck,puzzle.puzzle_id);
      assert.equal(stored.trophy_is_land,isLand(puzzle.candidates.find(c=>c.id===puzzle.historical_pick_id)),puzzle.puzzle_id);
      compared++;
    }
  }
  assert.ok(compared>1000,`compared ${compared} puzzles`);
});

test('every set with a Premier Draft trophy archive has a valid strength table',()=>{
  const coverage=JSON.parse(readFileSync('corpus/trophy-decks/coverage.json','utf8'));
  const archives=new Map(coverage.archives.filter(a=>a.event_type==='PremierDraft').map(a=>[a.set_id,a]));
  const tables=readdirSync('corpus/card-strength').filter(f=>f.endsWith('.json')).map(f=>f.slice(0,-5)).sort();
  assert.deepEqual(tables,[...archives.keys()].sort());
  const basics=new Set(['Plains','Island','Swamp','Mountain','Forest','Wastes']);
  for(const setId of tables) {
    const raw=JSON.parse(readFileSync(`corpus/card-strength/${setId}.json`,'utf8'));
    assert.equal(raw.schema_version,1);assert.equal(raw.set_id,setId);
    assert.equal(raw.source.url,archives.get(setId).archive_url,setId);
    assert.equal(raw.source.provider,'17Lands');assert.equal(raw.source.license,'CC BY 4.0');
    assert.ok(raw.game_rows>100000&&raw.baseline_win_rate>0.4&&raw.baseline_win_rate<0.7,setId);
    const names=Object.keys(raw.cards);
    assert.deepEqual(names,[...names].sort(),setId);
    assert.ok(names.length>150&&!names.some(n=>basics.has(n)),setId);
    for(const [points,games] of Object.values(raw.cards))assert.ok(Number.isFinite(points)&&Math.abs(points)<30&&Number.isInteger(games)&&games>=0,setId);
    const table=loadStrengthTable(setId);
    assert.equal(table.version,'gih-shrunk-400-v1');assert.equal(table.cards.size,names.length);
  }
  assert.equal(loadStrengthTable('no-such-set'),null);
  assert.throws(()=>loadStrengthTable('../x'),/Invalid set id/);
});

test('import scoring skips a database without the features table',async()=>{
  const messages=[],sql=[];
  const query=async text=>{sql.push(text);return {rows:[{present:'f'}]};};
  assert.equal(await scoreImportedPuzzles(query,[{puzzle_id:'p'}],{log:m=>messages.push(m)}),0);
  assert.equal(await scoreImportedPuzzles(query,[{puzzle_id:'q'}],{log:m=>messages.push(m)}),0);
  assert.equal(sql.length,1,'the table check runs once per database adapter');
  assert.match(messages.join('\n'),/migration 0068 is not applied/);
});
