import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {buildReviewSet,serialize,assessPuzzle,proposedTop,parseCsv,strengthPercentile,REVIEWS,LATEST_REVIEW,OUTPUT_DIR,RULE} from '../scripts/build-puzzle-review-set.mjs';
import {summarizeReview,ratedCount} from '../admin/puzzle-review-results.mjs';
import {cardScores,loadState,emptyState,storageKey,resultsExport,REVIEW_VERSION} from '../admin/puzzle-review.mjs';
import {adminArea,overviewMarkup,ADMIN_AREAS} from '../admin/overview.mjs';
import {sanitizeAdminDestination} from '../admin/admin-return.mjs';

const read=name=>fs.readFileSync(`${OUTPUT_DIR}/${name}`,'utf8');
const names=JSON.parse(fs.readFileSync('data/set-display-names.json','utf8')).names;

const versions=Object.keys(REVIEWS);
const files=version=>({set:JSON.parse(read(`${version}-set.json`)),key:JSON.parse(read(`${version}-key.json`))});
const corpusSources=new Map();
for(const id of new Set(versions.flatMap(v=>REVIEWS[v].sets)))
  for(const p of JSON.parse(gunzipSync(fs.readFileSync(`corpus/draft-run/${id}.json.gz`))))corpusSources.set(p.puzzle_id,p.source_draft_hash);
const sourcesOf=key=>Object.values(key.items).map(item=>corpusSources.get(item.puzzle_id));

test('every checked-in review set and key regenerates exactly from checked-in inputs',()=>{
  for(const version of versions) {
    const {set,key}=buildReviewSet(version,{setNames:names});
    assert.equal(read(`${version}-set.json`),serialize(set),version);
    assert.equal(read(`${version}-key.json`),serialize(key),version);
  }
  assert.equal(REVIEW_VERSION,LATEST_REVIEW,'the admin page serves the latest review');
});

test('every pair matches set and pick, uses distinct source drafts, and arms meet their rules',()=>{
  for(const version of versions) {
    const {set,key}=files(version),rule=REVIEWS[version].rule;
    assert.equal(set.items.length,2*key.pairs.length+(key.probes?.length||0),version);
    assert.equal(key.pairs.length,REVIEWS[version].pairPicks.length,version);
    const byId=new Map(set.items.map(item=>[item.item_id,item]));
    for(const pair of key.pairs) {
      for(const arm of ['current','proposed']) {
        const item=byId.get(pair[arm]),meta=key.items[pair[arm]];
        assert.equal(item.set_id,pair.set_id);
        assert.equal(item.pick_number,pair.pick_number);
        assert.equal(meta.arm,arm);
        assert.notEqual(meta.band,'easy','Both arms are contested decisions');
      }
      const proposed=key.items[pair.proposed];
      assert.equal(proposed.meets_proposed_rule,true);
      assert.ok(proposed.credible.length>=2);
      if(pair.pick_number>=rule.deck_gate_from_pick)assert.equal(proposed.trophy_in_main_deck,true);
      if(rule.no_land_answer_from_pick&&pair.pick_number>=rule.no_land_answer_from_pick)assert.equal(proposed.trophy_is_land,false,version+' '+pair.pair_id);
      if(rule.require_band)assert.equal(proposed.band,rule.require_band,version+' '+pair.pair_id);
      const currentRule=REVIEWS[version].currentRule;
      if(currentRule&&pair.pick_number>=currentRule.no_land_answer_from_pick)assert.equal(key.items[pair.current].trophy_is_land,false,version+' '+pair.pair_id);
    }
    const sources=sourcesOf(key);
    assert.ok(sources.every(Boolean));
    assert.equal(new Set(sources).size,sources.length,'No source draft appears twice in '+version);
  }
});

test('v2 reuses no v1 source draft and its land probes are late land answers over a strong card',()=>{
  const v1=new Set(sourcesOf(files('puzzle-review-v1').key)),{set,key}=files('puzzle-review-v2');
  assert.ok(sourcesOf(key).every(source=>!v1.has(source)));
  const probe=REVIEWS['puzzle-review-v2'].landProbe;
  assert.equal(key.probes.length,probe.count);
  assert.equal(set.pairs,10);
  assert.equal(set.probes,4);
  const byId=new Map(set.items.map(item=>[item.item_id,item]));
  for(const row of key.probes) {
    const item=byId.get(row.item),meta=key.items[row.item];
    const trophy=item.candidates.find(c=>c.id===item.historical_pick_id);
    assert.match(trophy.type_line,/\bLand\b/);
    assert.ok(item.pick_number>=probe.from_pick&&item.pick_number<=probe.to_pick);
    assert.equal(meta.arm,'land-probe');
    assert.equal(meta.trophy_in_main_deck,true);
    assert.ok(meta.passed_over.length>=1);
    for(const card of meta.passed_over)assert.ok(card.gih_points>=meta.power_threshold_gih_points&&card.support_ratio>=RULE.credible_support_ratio);
  }
});

test('each later review reuses no source draft from the reviews it excludes',()=>{
  for(const version of versions)for(const earlier of REVIEWS[version].excludeReviews||[]) {
    const before=new Set(sourcesOf(files(earlier).key));
    assert.ok(sourcesOf(files(version).key).every(source=>!before.has(source)),version+' reuses '+earlier);
  }
  assert.deepEqual(files('puzzle-review-v3').set.criteria,{min_good_new_rule:8,max_losses:2});
});

test('the blinded sets carry no arm, pair, probe, or selection evidence',()=>{
  for(const version of versions) {
    const text=read(`${version}-set.json`),set=JSON.parse(text);
    for(const item of set.items)assert.deepEqual(Object.keys(item).sort(),['candidates','historical_pick_id','item_id','pick_number','prior_picks','set_id','set_name']);
    // Check field names and labels, not card text: a card can be named
    // "Prismatic Undercurrents".
    assert.deepEqual(Object.keys(set).filter(k=>!['version','pairs','probes','criteria','items'].includes(k)),[],version);
    const keys=new Set(),strings=new Set();
    const walk=value=>{if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')for(const [k,v] of Object.entries(value)){keys.add(k);walk(v);}else if(typeof value==='string')strings.add(value);};
    walk(set);
    for(const key of ['arm','pair_id','puzzle_id','stakes','stakes_gih_points','trophy_in_main_deck','band','passed_over','current','proposed'])assert.ok(!keys.has(key),version+' key '+key);
    for(const label of ['current','proposed','land-probe'])assert.ok(!strings.has(label),version+' label '+label);
    assert.ok(!/gih|main_deck|land-probe|"arm"/.test(text),version);
  }
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
  const landRule={...RULE,no_land_answer_from_pick:5};
  const landAnswer=pick=>{const p=puzzle(pick);p.candidates[1]={...p.candidates[1],type_line:'Land'};return p;};
  assert.equal(assessPuzzle(landAnswer(4),{strength,mainDeck:inMain,rule:landRule}).proposed_valid,true,'early land answers stay');
  const late=assessPuzzle(landAnswer(5),{strength,mainDeck:inMain,rule:landRule});
  assert.equal(late.proposed_valid,false);
  assert.equal(late.trophy_is_land,true);
  assert.equal(assessPuzzle(landAnswer(5),{strength,mainDeck:inMain}).proposed_valid,true,'v1 rule has no land gate');
  assert.equal(strengthPercentile(new Map(Array.from({length:10},(_,i)=>['c'+i,i])),0.8),8);
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
  const probed={...key,probes:[1,2,3,4].map(i=>({probe_id:'land-'+i,set_id:'sos',pick_number:5+i%4,item:'l'+i}))};
  const all=rate(['fine','fine','fine','fine'],['fine','fine','fine','fine']);
  assert.equal(summarizeReview(probed,all).complete,false,'probes must be rated too');
  const probeRatings=r=>({...all,...Object.fromEntries(r.map((x,i)=>['l'+(i+1),{rating:x}]))});
  assert.deepEqual((({good,needed,pass})=>({good,needed,pass}))(summarizeReview(probed,probeRatings(['interesting','fine','fine','dull'])).land_probe),{good:3,needed:3,pass:true});
  assert.equal(summarizeReview(probed,probeRatings(['interesting','fine','dull','broken'])).land_probe.pass,false);
  assert.equal(summarizeReview(key,all).land_probe,null);
  const stated={...key,criteria:{min_good_new_rule:3,max_losses:1}};
  const ok=summarizeReview(stated,rate(['interesting','dull','fine','dull'],['fine','fine','interesting','dull']));
  assert.deepEqual(ok.criteria.proposed_good,{good:3,needed:3,pass:true});
  assert.equal(ok.criteria.fewer_bad,undefined);
  assert.deepEqual(ok.criteria.losses,{losses:1,allowed:1,pass:true});
  assert.equal(ok.pass,true);
  assert.equal(summarizeReview(stated,rate(['fine','fine','fine','fine'],['fine','fine','dull','dull'])).pass,false,'2 good is below 3');
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

test('exported results keep the rater\'s rating separate from the support difficulty rating',()=>{
  const {key}=files('puzzle-review-v2');
  // resultsExport labels output with the served version; the shape is shared.
  const ratings=Object.fromEntries(Object.keys(key.items).map(id=>[id,{rating:'fine'}]));
  const out=resultsExport({ratings},summarizeReview(key,ratings),key);
  for(const pair of out.pairs)for(const arm of ['current','proposed']) {
    assert.equal(pair[arm].rating,'fine');
    assert.equal(typeof pair[arm].difficulty_rating,'number');
  }
  assert.equal(out.land_probe.length,4);
  assert.ok(out.land_probe.every(row=>row.rating==='fine'&&row.passed_over.length));
  assert.equal(out.summary.land_probe.pass,true);
});

test('puzzle review is a registered admin area with a return destination and overview card',()=>{
  assert.equal(ADMIN_AREAS['puzzle-review'],'Puzzle Review');
  assert.equal(adminArea('?area=puzzle-review'),'puzzle-review');
  assert.equal(sanitizeAdminDestination('/admin/?area=puzzle-review'),'/admin/?area=puzzle-review');
  assert.ok(overviewMarkup({}).includes('?area=puzzle-review'));
});
