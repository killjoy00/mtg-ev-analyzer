import test from 'node:test';
import assert from 'node:assert/strict';
import {effectiveCardMetadata,cardDisplayName,displayCardPrinting,matchesStardatesPrinting} from '../card-metadata.mjs';
import {publicDraftRunPuzzle,publicDraftRunAnswer,storedDraftRunPuzzle,gradeDraftRunPick} from '../draft-run.mjs';

import printings from '../corpus/stardates-printings.json' with {type:'json'};
import {publicTrophyDeck} from '../worker/trophy-decks.mjs';
import {publicLockedDecision} from '../worker/draft-run-insights-extras.mjs';
import {normaliseInsightsRows} from '../worker/draft-run-insights.mjs';

test('all thirty reviewed printings bind both title forms to one single-faced SDS image',()=>{
 assert.deepEqual(printings.map(row=>Number(row.collector_number)),Array.from({length:30},(_,i)=>i+1));
 assert.equal(printings.filter(row=>row.name!==row.printed_name).length,27);
 assert.equal(new Set(printings.map(row=>row.image_url)).size,30);
 for(const row of printings) {
   for(const name of new Set([row.name,row.printed_name])) {
     const original={id:'stable',name,image_url:'https://cards.scryfall.io/original.jpg',display_faces:[{name}]};
     const shown=displayCardPrinting(original,'trk');
     assert.deepEqual(shown,{id:'stable',name:row.printed_name,image_url:row.image_url});
     assert.equal(matchesStardatesPrinting({...shown,name,image_url:row.image_url.split('?')[0]},'trk'),true);
     assert.equal(matchesStardatesPrinting(original,'trk'),false);
     assert.equal(matchesStardatesPrinting({...shown,display_faces:[{name}]},'trk'),false);
     assert.equal(matchesStardatesPrinting({...shown,name:'Unrelated'},'trk'),false);
     assert.equal(displayCardPrinting(original,'dmu'),original);
   }
 }
});

test('legacy metadata repair reaches pack and pool without mutating frozen evidence',()=>{
 const card={id:'deduce',name:'Deduce',type_line:'',rarity:'common',model_probability:.1,image_url:'https://example.com/original.jpg'};
 const p={id:'legacy',set_id:'mkm',pick_number:2,historical_pick_id:'deduce',prior_picks:[card],candidates:[card,{id:'other',name:'Other',model_probability:.9}]};
 const before=structuredClone(p),score=gradeDraftRunPick(p,'deduce');
 const visible=publicDraftRunPuzzle(p);
 assert.equal(visible.candidates.find(c=>c.id==='deduce').type_line,'Instant');
 assert.equal(visible.prior_picks[0].type_line,'Instant');
 assert.equal(visible.candidates.find(c=>c.id==='deduce').image_url,card.image_url);
 assert.deepEqual(p,before);
 assert.deepEqual(gradeDraftRunPick(p,'deduce'),score);
 assert.equal(score.score,100);
 assert.equal('model_probability' in visible.candidates[0],false);
});

test('metadata repair preserves authoritative complete cards and leaves unknown identities alone',()=>{
 const complete={name:'Deduce',type_line:'Existing type',rarity:'rare',mana_cost:'{X}'};
 assert.equal(effectiveCardMetadata(complete),complete);
 const unknown={name:'Unlisted card',type_line:''};
 assert.equal(effectiveCardMetadata(unknown),unknown);
 const missing={name:'Fynn, the Fangbearer',rarity:'special'};
 assert.equal(effectiveCardMetadata(missing).rarity,'special');
 assert.equal(effectiveCardMetadata(missing).type_line,'Legendary Creature — Human Warrior');
 const archived={name:'Fynn, the Fangbearer',id:'fynn-the-fangbearer',image_url:'https://example.com/fynn.jpg'};
 assert.equal(effectiveCardMetadata(archived).rarity,'uncommon');
 assert.equal(effectiveCardMetadata(archived).mana_cost,'{1}{G}');
 assert.equal('rarity' in archived,false);
});

test('TRK Stardates titles display Star Trek names while canonical IDs and scoring remain unchanged',()=>{
 assert.equal(cardDisplayName('Sheoldred, the Apocalypse','trk'),'Khan, Engineered Evil');
 assert.equal(cardDisplayName('Kenrith, the Returned King','trk'),'General Picard, Earth Warlord');
 assert.equal(cardDisplayName('Sheoldred, the Apocalypse','dmu'),'Sheoldred, the Apocalypse');
 assert.equal(cardDisplayName('Khan, Despot by Design','trk'),'Khan, Despot by Design');
 for(const name of ['Flare of Fortitude','Decree of Pain','Hull Breach'])assert.equal(cardDisplayName(name,'trk'),name);

 const base={id:'sds-11',name:'Sheoldred, the Apocalypse',type_line:'Legendary Creature',
   image_url:'https://example.com/sds-khan.jpg',rarity:'mythic',mana_cost:'{2}{B}{B}',model_probability:0.7};
 const other={id:'other',name:'Khan, Despot by Design',type_line:'Creature',
   image_url:'https://example.com/trk-khan.jpg',rarity:'rare',model_probability:0.3};
 const puzzle={puzzle_id:'trk-sds-display-only',set_id:'trk',pack_number:1,pick_number:2,
   historical_pick_id:'sds-11',candidates:[base,other],prior_picks:[{...base,id:'prior'}]};
 const original=structuredClone(puzzle);
 const grade=gradeDraftRunPick(puzzle,'sds-11'),publicPuzzle=publicDraftRunPuzzle(puzzle);
 assert.equal(publicPuzzle.candidates.find(c=>c.id==='sds-11').name,'Khan, Engineered Evil');
 const khan=printings.find(row=>row.collector_number==='11');
 assert.match(khan.image_url,/c68629ff-72b3-40a2-b578-cddb6ddb4ccf/);
 assert.equal(publicPuzzle.candidates.find(c=>c.id==='sds-11').image_url,khan.image_url);
 const stored=storedDraftRunPuzzle(puzzle);
 assert.equal(stored.candidates.find(c=>c.id==='sds-11').name,base.name);
 assert.equal(stored.prior_picks[0].image_url,base.image_url);
 assert.equal(publicPuzzle.candidates.find(c=>c.id==='other').name,'Khan, Despot by Design','distinct TRK card');
 assert.equal(publicPuzzle.prior_picks[0].name,'Khan, Engineered Evil');
 assert.equal(publicPuzzle.candidates.find(c=>c.id==='sds-11').id,'sds-11','canonical selection ID stable');
 assert.equal(publicPuzzle.candidates.some(c=>Object.hasOwn(c,'model_probability')),false,'no model leakage');
 assert.deepEqual(puzzle,original,'canonical puzzle is never mutated');
 assert.deepEqual(gradeDraftRunPick(puzzle,'sds-11'),grade,'score unchanged');

 const answer={puzzle,score:grade.score,creatorName:base.name,selectedId:'sds-11',selectedName:'Sheoldred, the Apocalypse',
   historicalId:'sds-11',historicalName:'Sheoldred, the Apocalypse',
   consensusName:'Sheoldred, the Apocalypse',
   ranking:[{id:'sds-11',name:'Sheoldred, the Apocalypse',support:0.7,score:100}]};
 const beforeAnswer=structuredClone(answer),publicAnswer=publicDraftRunAnswer(answer);
 assert.equal(publicAnswer.historicalName,'Khan, Engineered Evil');
 assert.equal(publicAnswer.selectedName,'Khan, Engineered Evil');
 assert.equal(publicAnswer.consensusName,'Khan, Engineered Evil');
 assert.equal(publicAnswer.ranking[0].name,khan.printed_name);
 assert.equal(publicAnswer.creatorName,khan.printed_name);
 const detail=publicLockedDecision(answer);
 for(const card of [detail.trophy,detail.selected,detail.prior_picks[0]]) {
   assert.equal(card.name,khan.printed_name);
   assert.equal(card.image_url,khan.image_url);
 }
 assert.equal(detail.ranking[0].name,khan.printed_name);
 const [insight]=normaliseInsightsRows([{set_id:'trk',environment:'mixed',puzzle_id:'p',pick_number:2,score:100,
   trophy_match:true,answered_at:'2026-11-15',selected_name:base.name,historical_name:base.name}]);
 assert.equal(insight.selected_name,khan.printed_name);
 assert.equal(insight.historical_name,khan.printed_name);
 const catalog={set_id:'trk',cards:[base,other]};
 const deck=publicTrophyDeck(catalog,{deck:[[0,2],[1,1]],sideboard:[[0,1]],size:3});
 assert.deepEqual(deck.deck[0],{...base,name:khan.printed_name,image_url:khan.image_url,count:2});
 assert.equal(deck.sideboard[0].image_url,khan.image_url);
 assert.equal(deck.deck[1].name,other.name);
 assert.equal(catalog.cards[0].name,base.name);
 assert.equal(publicAnswer.puzzle.candidates[0].name,'Khan, Engineered Evil');
 assert.deepEqual(answer,beforeAnswer,'stored grading evidence stays original');

 const otherSet=publicDraftRunPuzzle({...puzzle,set_id:'dmu'});
 assert.equal(otherSet.candidates.find(c=>c.id==='sds-11').name,'Sheoldred, the Apocalypse');
});
