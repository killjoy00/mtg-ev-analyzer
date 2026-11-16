import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {puzzleSelectionFeatures,stakesTopPoolSize,isLandCard,isOffColour,isClearEasy,costColours,STAKES_RULE,EASY_RULE,SELECTION_FEATURE_VERSION} from '../puzzle-selection.mjs';
import {rateDraftRunPuzzle} from '../draft-run-difficulty.mjs';
import {assessPuzzle,strengthTable,isLand,RULE} from '../scripts/build-puzzle-review-set.mjs';
import {loadStrengthTable,loadMainDecks,scoreImportedPuzzles,scorePuzzleSelection} from '../scripts/score-puzzle-selection.mjs';

const card=(id,name,model_probability,type_line='Creature')=>({id,name,model_probability,type_line});
const strength=points=>({version:'gih-shrunk-400-v1',sha256:'a'.repeat(64),cards:new Map(Object.entries(points))});

test('features: credible options, stakes, deck membership and land answers',()=>{
  const puzzle={puzzle_id:'p',historical_pick_id:'b',candidates:[
    card('a','Leader',.5),card('b','Runner',.2,'Land'),card('c','Third',.18),card('d','Fourth',.176),card('e','Weak',.1)]};
  const features=puzzleSelectionFeatures(puzzle,{strength:strength({Leader:1.5,Runner:4.25,Fourth:9,Weak:20}),mainDeck:new Map([['Runner',1]])});
  // Credible: at least 35% of the leader (0.175), top three only, so Fourth
  // (0.176) is credible but cut, and Weak never counts.
  // The margin compares the trophy pick with every other rated card in the
  // pack, credible or not: Weak (20) is 15.75 points stronger than Runner.
  assert.deepEqual(features,{puzzle_id:'p',feature_version:SELECTION_FEATURE_VERSION,strength_version:'gih-shrunk-400-v1',
    strength_sha256:'a'.repeat(64),stakes_points:4.25,credible_count:3,trophy_in_main_deck:true,trophy_is_land:true,
    trophy_strength_margin:-15.75,trophy_off_colour:false});
  const bare=puzzleSelectionFeatures(puzzle,{});
  assert.equal(bare.stakes_points,null);assert.equal(bare.strength_version,null);assert.equal(bare.trophy_in_main_deck,null);
  assert.equal(bare.trophy_strength_margin,null);assert.equal(bare.trophy_off_colour,false);
  // Unrated trophy pick, or no other rated card: no margin.
  assert.equal(puzzleSelectionFeatures(puzzle,{strength:strength({Leader:1})}).trophy_strength_margin,null);
  assert.equal(puzzleSelectionFeatures(puzzle,{strength:strength({Runner:1})}).trophy_strength_margin,null);
  assert.equal(puzzleSelectionFeatures(puzzle,{strength:strength({Runner:2.5,Leader:2.5,Weak:-1})}).trophy_strength_margin,0);
  assert.equal(puzzleSelectionFeatures(puzzle,{strength:strength({}),mainDeck:new Map()}).stakes_points,null);
  assert.equal(puzzleSelectionFeatures(puzzle,{mainDeck:new Map([['Leader',2]])}).trophy_in_main_deck,false);
  assert.throws(()=>puzzleSelectionFeatures({...puzzle,historical_pick_id:'z'},{}),/no trophy pick/);
  assert.equal(isLandCard({type_line:'Artifact Land'}),true);
  assert.equal(isLandCard({type_line:'Sorcery // Land'}),true);
  assert.equal(isLandCard({type_line:'Creature — Elf'}),false);
});

test('colour fit: off-colour needs a coloured card and coloured prior picks that share nothing',()=>{
  const cost=mana_cost=>({mana_cost});
  assert.deepEqual([...costColours(cost('{2}{W/U}{G/P}{X}{C}{S}'))].sort(),['G','U','W']);
  assert.equal(costColours(cost('')).size+costColours({}).size+costColours(null).size,0);
  assert.equal(isOffColour(cost('{1}{U}'),[cost('{2}{B}'),cost('{3}{R}{R}{G}{G}')]),true);
  assert.equal(isOffColour(cost('{1}{U}'),[cost('{2}{B}'),cost('{W/U}')]),false,'a hybrid prior pick shares blue');
  assert.equal(isOffColour(cost('{1}{U}{R}'),[cost('{R}')]),false,'sharing one colour is enough');
  assert.equal(isOffColour(cost('{1}{U}'),[]),false,'a first pick has nothing to conflict with');
  assert.equal(isOffColour(cost('{1}{U}'),undefined),false);
  assert.equal(isOffColour(cost('{3}'),[cost('{R}')]),false,'a colourless card fits any pool');
  assert.equal(isOffColour(cost(''),[cost('{R}')]),false,'a land has no mana cost');
  assert.equal(isOffColour(cost('{1}{U}'),[cost('{4}'),cost('')]),false,'colourless prior picks commit to nothing');
  const puzzle={puzzle_id:'p',historical_pick_id:'a',candidates:[{...card('a','Leader',.6),mana_cost:'{1}{U}'},card('b','Runner',.2)],
    prior_picks:[{name:'First',mana_cost:'{R}'}]};
  assert.equal(puzzleSelectionFeatures(puzzle,{}).trophy_off_colour,true);
  assert.equal(puzzleSelectionFeatures({...puzzle,prior_picks:[]},{}).trophy_off_colour,false);
});

test('clear-Easy rule: leader, strongest card, and colour fit from P1P3',()=>{
  const clear={pick_number:3,target_support_ratio:1,trophy_strength_margin:0,trophy_off_colour:false};
  assert.equal(isClearEasy(clear),true);
  assert.equal(isClearEasy({...clear,target_support_ratio:0.99}),false,'the trophy pick must be the model leader');
  assert.equal(isClearEasy({...clear,trophy_strength_margin:-0.01}),false,'another rated card is stronger');
  assert.equal(isClearEasy({...clear,trophy_strength_margin:null}),false,'no strength evidence is not agreement');
  assert.equal(isClearEasy({...clear,trophy_off_colour:true}),false);
  assert.equal(isClearEasy({...clear,trophy_off_colour:null}),false,'a row scored before the feature existed never qualifies from P1P3');
  // One prior pick is not a colour commitment.
  assert.equal(isClearEasy({...clear,pick_number:2,trophy_off_colour:true}),true);
  assert.equal(isClearEasy({...clear,pick_number:1,trophy_off_colour:false}),true);
  assert.deepEqual(EASY_RULE,{min_trophy_support_ratio:1,min_strength_margin:0,colour_fit_from_pick:3});
});

test('owner-judged Easy puzzles: the good ones stay eligible, the bad ones do not',()=>{
  // Diagnostic examples from issue #1585, not training data: the rule was
  // validated on held-out practice answers (docs/DIFFICULTY-REVIEW-2026-11.md).
  // The three good examples must stay eligible; the "uncertain" one is
  // computed but deliberately not asserted either way.
  const examples=JSON.parse(readFileSync('tests/fixtures/easy-owner-examples.json','utf8'));
  assert.deepEqual(examples.map(e=>e.owner_judgement),['good','good','good','bad','bad','bad','bad','uncertain']);
  for(const example of examples) {
    const rating=rateDraftRunPuzzle(example.puzzle);
    assert.equal(rating.band,'easy',example.label);
    const features=puzzleSelectionFeatures(example.puzzle,{strength:loadStrengthTable(example.set_id)});
    const eligible=isClearEasy({pick_number:example.pick_number,target_support_ratio:rating.targetSupportRatio,...features});
    if(example.owner_judgement==='good')assert.equal(eligible,true,`${example.label} must stay eligible`);
    if(example.owner_judgement==='bad')assert.equal(eligible,false,`${example.label} must not be a clear Easy`);
  }
  // None of the three good examples made the trophy main deck check part of
  // the rule: two of them were cut from the final deck (issue #1585).
  assert.equal(Object.keys(EASY_RULE).some(key=>/deck/.test(key)),false);
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
  assert.match(messages.join('\n'),/migrations 0068 and 0075 are not both applied/);
});

test('completed feature backfill avoids reading the entire puzzle corpus again',async()=>{
 const sql=[];
 const query=async text=>{
   sql.push(text);
   if(text.includes('to_regclass('))return {rows:[{present:true}]};
   if(text.includes('SELECT count(*)::int n FROM draft_run_verified_puzzles'))return {rows:[{n:0}]};
   if(text.includes('pg_relation_size'))return {rows:[{blocks:0,tuples:0,pages:0}]};
   throw Error('Unexpected SQL on no-op backfill');
 };
 const normal=await scorePuzzleSelection(query,{setIds:['fra'],log:()=>{}});
 assert.deepEqual(normal.sets.map(x=>[x.set_id,x.scored,x.written]),[['fra',0,0]]);
 assert.equal(normal.remaining,0);
 assert.equal(sql.filter(s=>s.includes('pg_relation_size')).length,0,
   'already-scored data must not trigger a physical block scan');
 assert.equal(sql.filter(s=>s.includes('p.ctid>=')).length,0,
   'already-scored data must not stream puzzle payloads back to CI');
 const explicit=await scorePuzzleSelection(query,{setIds:['fra'],rescore:true,log:()=>{}});
 assert.equal(explicit.remaining,0);
 assert.ok(sql.filter(s=>s.includes('pg_relation_size')).length>=1,
   '--rescore must still enter the explicitly requested full traversal');
});
