import test from 'node:test';
import assert from 'node:assert/strict';
import {effectiveCardMetadata} from '../card-metadata.mjs';
import {publicDraftRunPuzzle,gradeDraftRunPick} from '../draft-run.mjs';

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
 const complete={name:'Deduce',type_line:'Existing type',rarity:'rare'};
 assert.equal(effectiveCardMetadata(complete),complete);
 const unknown={name:'Unlisted card',type_line:''};
 assert.equal(effectiveCardMetadata(unknown),unknown);
 const missing={name:'Fynn, the Fangbearer',rarity:'special'};
 assert.equal(effectiveCardMetadata(missing).rarity,'special');
 assert.equal(effectiveCardMetadata(missing).type_line,'Legendary Creature — Human Warrior');
});
