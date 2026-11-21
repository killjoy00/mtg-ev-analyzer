import test from 'node:test';
import assert from 'node:assert/strict';
import {effectiveCardMetadata,cardDisplayName,TRK_STARDATES_DISPLAY_NAMES} from '../card-metadata.mjs';
import {publicDraftRunPuzzle,publicDraftRunAnswer,gradeDraftRunPick} from '../draft-run.mjs';

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
 assert.equal(Object.keys(TRK_STARDATES_DISPLAY_NAMES).length,27,'all 27 alternate-name SDS titles');
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
 assert.equal(publicPuzzle.candidates.find(c=>c.id==='sds-11').image_url,base.image_url,'SDS art not replaced');
 assert.equal(publicPuzzle.candidates.find(c=>c.id==='other').name,'Khan, Despot by Design','distinct TRK card');
 assert.equal(publicPuzzle.prior_picks[0].name,'Khan, Engineered Evil');
 assert.equal(publicPuzzle.candidates.find(c=>c.id==='sds-11').id,'sds-11','canonical selection ID stable');
 assert.equal(publicPuzzle.candidates.some(c=>Object.hasOwn(c,'model_probability')),false,'no model leakage');
 assert.deepEqual(puzzle,original,'canonical puzzle is never mutated');
 assert.deepEqual(gradeDraftRunPick(puzzle,'sds-11'),grade,'score unchanged');

 const answer={puzzle,selectedId:'sds-11',selectedName:'Sheoldred, the Apocalypse',
   historicalId:'sds-11',historicalName:'Sheoldred, the Apocalypse',
   consensusName:'Sheoldred, the Apocalypse',
   ranking:[{id:'sds-11',name:'Sheoldred, the Apocalypse',support:0.7,score:100}]};
 const beforeAnswer=structuredClone(answer),publicAnswer=publicDraftRunAnswer(answer);
 assert.equal(publicAnswer.historicalName,'Khan, Engineered Evil');
 assert.equal(publicAnswer.selectedName,'Khan, Engineered Evil');
 assert.equal(publicAnswer.consensusName,'Khan, Engineered Evil');
 assert.equal(publicAnswer.ranking[0].name,'Khan, Engineered Evil');
 assert.equal(publicAnswer.puzzle.candidates[0].name,'Khan, Engineered Evil');
 assert.deepEqual(answer,beforeAnswer,'stored grading evidence stays original');

 const otherSet=publicDraftRunPuzzle({...puzzle,set_id:'dmu'});
 assert.equal(otherSet.candidates.find(c=>c.id==='sds-11').name,'Sheoldred, the Apocalypse');
});
