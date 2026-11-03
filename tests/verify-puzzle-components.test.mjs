import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyComponents} from '../scripts/verify-puzzle-components.mjs';
import {SQL} from '../scripts/traditional-premier-art.mjs';

const manifest={id:'fra',component_version:'traditional-premier-v5-p1p6-v1',puzzles:2};
const prepared=[{sid:'fra',manifest,health:{ready:true,puzzles:2,usable_puzzles:1}}];
const premierArt={image_url:'https://cards.scryfall.io/normal/front/a/a/premier.jpg',rarity:'common',type_line:'Instant'};
const database=(status,parentStatus,stored=manifest,traditionalArt=premierArt)=>async sql=>
 sql===SQL.premier?{rows:[{name:'Countersculpt',display:premierArt,n:40}]}
 :sql===SQL.traditional?{rows:[{name:'Countersculpt',display:traditionalArt,n:4}]}
 :sql.includes('FROM corpus_components')?{rows:[{status,manifest:stored,parent_status:parentStatus}]}
 :{rows:[{n:2,usable:1,unrated:0}]};

test('production staging accepts a development component that is staged or already published',async()=>{
 await verifyComponents(database('Candidate','Live'),prepared,'staged');
 await verifyComponents(database('Candidate','Candidate'),prepared,'staged');
 await verifyComponents(database('Live','Live'),prepared,'staged');
 for(const [status,parent] of [['Paused','Live'],['Retired','Live'],['Live','Candidate']])
  await assert.rejects(verifyComponents(database(status,parent),prepared,'staged'),/neither staged nor published/,`${status} under ${parent}`);
 // The identical reviewed artifact is still required.
 await assert.rejects(verifyComponents(database('Live','Live',{...manifest,puzzles:3}),prepared,'staged'),/immutable artifact differs/);
});

test('exact lifecycle checks are unchanged',async()=>{
 await assert.rejects(verifyComponents(database('Live','Live'),prepared,'Candidate'));
 await verifyComponents(database('Live','Live'),prepared,'eligible');
 await assert.rejects(verifyComponents(database('Candidate','Live'),prepared,'eligible'),/publication eligibility/);
});

test('a component whose art differs from Premier fails verification at every lifecycle step',async()=>{
 const research={...premierArt,image_url:'https://cards.scryfall.io/normal/front/b/b/art-series.jpg'};
 for(const [status,parent,expected] of [['Candidate','Live','Candidate'],['Candidate','Live','staged'],['Live','Live','eligible'],['Live','Live','Live']])
  await assert.rejects(verifyComponents(database(status,parent,manifest,research),prepared,expected),/4 Traditional cards show different art from Premier \(Countersculpt\).*traditional-premier-art/,expected);
 await verifyComponents(database('Live','Live'),prepared,'Live');
});
