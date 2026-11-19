import test from 'node:test';
import assert from 'node:assert/strict';
import {DRAFT_RUN_CORPUS_VERSION as parent} from '../draft-run.mjs';
import {premierArt,artDrift,checkTraditionalArt,repairTraditionalArt,traditionalComponents,CHUNKS,SQL} from '../scripts/traditional-premier-art.mjs';

const wwk={image_url:'https://cards.scryfall.io/normal/front/f/6/f6929259.jpg',rarity:'rare',type_line:'Land'};
const artSeries={image_url:'https://cards.scryfall.io/normal/front/0/0/00art.jpg',rarity:'common',type_line:'Card // Card'};
const land=extra=>({image_url:'https://cards.scryfall.io/normal/front/1/1/11land.jpg',rarity:'common',type_line:'Land',...extra});
const premier=[
 {name:'Celestial Colonnade',display:wwk,n:40},
 // Premier stores some lands with mana_cost "" and others without the key.
 {name:'Fabled Passage',display:land({mana_cost:''}),n:306},
 {name:'Fabled Passage',display:JSON.stringify(land()),n:219},
];

test('the most frequent Premier variant is chosen, ties broken deterministically',()=>{
 const art=premierArt([...premier,{name:'Tie',display:{image_url:'https://b'},n:2},{name:'Tie',display:{image_url:'https://a'},n:2}]);
 assert.deepEqual(art.get('Fabled Passage').chosen,land({mana_cost:''}));
 assert.equal(art.get('Fabled Passage').variants.size,2);
 assert.deepEqual(art.get('Tie').chosen,{image_url:'https://a'});
 // Repeated rows for one variant are summed, not treated as new variants.
 const doubled=premierArt([...premier,premier[2]]);
 assert.equal(doubled.get('Fabled Passage').variants.size,2);
 assert.deepEqual(doubled.get('Fabled Passage').chosen,land());
});

test('drift counts cards that match no Premier variant and reports names Premier lacks',()=>{
 const drift=artDrift(premier,[
  {name:'Celestial Colonnade',display:artSeries,n:38},
  {name:'Celestial Colonnade',display:{type_line:'Land',image_url:wwk.image_url,rarity:'rare'},n:2},
  {name:'Fabled Passage',display:land(),n:5},
  {name:'Fabled Passage',display:land({mana_cost:''}),n:5},
  {name:'Sword of Fire and Ice',display:{image_url:'https://x'},n:8},
 ]);
 assert.equal(drift.cards,58);
 assert.equal(drift.mismatched_cards,38);
 assert.deepEqual(drift.mismatched,[{name:'Celestial Colonnade',cards:38}]);
 assert.deepEqual(drift.unmatched,[{name:'Sword of Fire and Ice',cards:8}]);
});

test('a display_faces or rarity difference is drift, not a cosmetic variant',()=>{
 assert.equal(artDrift(premier,[{name:'Celestial Colonnade',display:{...wwk,display_faces:[{name:'x'}]},n:1}]).mismatched_cards,1);
 assert.equal(artDrift(premier,[{name:'Celestial Colonnade',display:{...wwk,rarity:'mythic'},n:1}]).mismatched_cards,1);
});

const database=(traditional,calls=[])=>async(sql,params)=>{
 calls.push({sql,params});
 if(sql===SQL.premier)return {rows:params[0]==='empty'?[]:premier};
 if(sql===SQL.traditional)return {rows:traditional};
 if(sql===SQL.repair||sql===SQL.dryRun)return {rows:[{changed:1}]};
 if(sql.includes('FROM corpus_components'))return {rows:[{set_id:'powered-cube',component_version:'traditional-cube-p2p7-v6-v1',status:'Live'}]};
 throw Error('unexpected SQL');
};

test('checks and repairs never accept the Premier parent as the target',async()=>{
 const query=database([]);
 await assert.rejects(checkTraditionalArt(query,'powered-cube',parent,parent),/never the Premier parent/);
 await assert.rejects(repairTraditionalArt(query,'powered-cube',parent,parent),/never the Premier parent/);
 await assert.rejects(checkTraditionalArt(query,'empty','traditional-x','parent'),/no Premier/);
});

test('repair writes only the component, in 16 puzzle-id chunks, with every Premier variant as acceptable',async()=>{
 const calls=[];
 const result=await repairTraditionalArt(database([],calls),'powered-cube','traditional-cube-p2p7-v6-v1',parent);
 const writes=calls.filter(c=>c.sql===SQL.repair);
 assert.equal(writes.length,CHUNKS.length);
 assert.deepEqual(writes.map(c=>c.params[3]),CHUNKS.map(c=>c+'%'));
 for(const c of writes)assert.equal(c.params[1],'traditional-cube-p2p7-v6-v1');
 const map=JSON.parse(writes[0].params[2]);
 const passage=map.find(m=>m.name==='Fabled Passage');
 assert.deepEqual(passage.display,land({mana_cost:''}));
 assert.equal(passage.variants.length,2);
 assert.deepEqual(result,{set:'powered-cube',component:'traditional-cube-p2p7-v6-v1',changed_puzzles:16});
 // The write SQL can only touch the named component's rows.
 assert.match(SQL.repair,/p\.corpus_version=\$2 AND t\.next IS DISTINCT FROM t\.payload/);
 const dry=[];
 assert.deepEqual(await repairTraditionalArt(database([],dry),'powered-cube','traditional-cube-p2p7-v6-v1','p',{dryRun:true}),
  {set:'powered-cube',component:'traditional-cube-p2p7-v6-v1',would_change_puzzles:16});
 assert.equal(dry.filter(c=>c.sql===SQL.repair).length,0);
});

test('component listing refuses named sets that have no Candidate or Live component',async()=>{
 assert.equal((await traditionalComponents(database([]),['powered-cube'],'p')).length,1);
 await assert.rejects(traditionalComponents(database([]),['powered-cube','ktk'],'p'),/ktk/);
});
