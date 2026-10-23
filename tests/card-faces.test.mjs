import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {refreshTrophyImagePage} from '../worker/trophy-import.mjs';
import {cardDisplayFaces,cardFaceIndicator,normalizedDisplayFaces} from '../card-faces.mjs';
import {effectiveCardMetadata,publicCardDisplay} from '../card-metadata.mjs';
import {publicDraftRunPuzzle,publicDraftRunAnswer,gradeDraftRunPick} from '../draft-run.mjs';
import {publicLockedDecision} from '../worker/draft-run-insights-extras.mjs';
import registry from '../corpus/card-face-metadata.json' with {type:'json'};

const fable={id:'fable-of-the-mirror-breaker',name:'Fable of the Mirror-Breaker',image_url:'https://cards.scryfall.io/normal/front/2/4/24c0d87b-0049-4beb-b9cb-6f813b7aa7dc.jpg?older-snapshot',rarity:'rare',model_probability:.6};
const other={id:'other',name:'Other',image_url:'https://cards.scryfall.io/normal/front/test.jpg',model_probability:.4};
const puzzle={puzzle_id:'faces-fixture',set_id:'neo',pack_number:1,pick_number:2,prior_picks:[fable],candidates:[fable,other],historical_pick_id:fable.id};

test('legacy printing overlay reaches pack, pool, saved answers and Insights without changing evidence',()=>{
  const original=structuredClone(puzzle),grade=gradeDraftRunPick(puzzle,fable.id);
  const before=publicDraftRunPuzzle(puzzle);
  assert.equal(before.candidates[0].display_faces[1].name,'Reflection of Kiki-Jiki');
  assert.equal(before.prior_picks[0].display_faces.length,2);
  assert.equal(before.candidates[0].image_url,fable.image_url);
  assert.equal('model_probability' in before.candidates[0],false);
  const saved={...grade,puzzle:structuredClone(puzzle),score:83};
  const frozen=structuredClone(saved),answer=publicDraftRunAnswer(saved);
  assert.equal(answer.score,83);
  assert.equal(answer.puzzle.candidates[0].display_faces.length,2);
  const review=publicLockedDecision(saved);
  assert.equal(review.selected.display_faces[1].role,'back');
  assert.equal(review.prior_picks[0].display_faces.length,2);
  assert.equal(review.score,83);
  assert.deepEqual(saved,frozen);
  assert.deepEqual(puzzle,original);
  assert.deepEqual(gradeDraftRunPick(puzzle,fable.id),grade);
});

test('overlay matches exact printing and alias, never a lookalike name or an arbitrary image host',()=>{
  assert.equal(effectiveCardMetadata({...fable,name:'Different card'}).display_faces,undefined);
  assert.equal(effectiveCardMetadata({...fable,image_url:fable.image_url.replace('cards.scryfall.io','example.com')}).display_faces,undefined);
  const jaces=Object.entries(registry.printings).filter(([,r])=>r.names.includes("Jace, Vryn's Prodigy"));
  assert.ok(jaces.length>=2);
  for(const [id,record] of jaces) {
    const c=effectiveCardMetadata({id:'jace',name:"Jace, Vryn's Prodigy",image_url:record.display_faces[0].image_url});
    assert.ok(c.display_faces.every(f=>f.image_url.includes(id)));
  }
});

test('single-image cards remain single and invalid optional faces never cross public boundaries',()=>{
  assert.equal(cardDisplayFaces(other).length,1);
  assert.equal(cardFaceIndicator(other),'');
  const valid=effectiveCardMetadata(fable).display_faces;
  for(const invalid of [null,[],[valid[0]],[valid[0],valid[0]],valid.map(f=>({...f,image_url:'javascript:alert(1)'})),[valid[0],{...valid[1],role:'token'}]]) {
    assert.deepEqual(normalizedDisplayFaces(invalid),[]);
    assert.equal(publicCardDisplay({...other,display_faces:invalid}).display_faces,undefined);
  }
  const clean=normalizedDisplayFaces(valid.map(f=>({...f,model_probability:1,oracle_text:'must not leak',large_image_url:'https://evil.invalid/card.jpg'})));
  assert.equal(clean[0].model_probability,undefined);
  assert.equal(clean[0].large_image_url,undefined);
});

test('meld shows the combined result and names the required partner',()=>{
  const [,record]=Object.entries(registry.printings).find(([,r])=>r.names.includes('Urza, Lord Protector'));
  const card=effectiveCardMetadata({id:'urza',name:'Urza, Lord Protector',image_url:record.display_faces[0].image_url});
  assert.equal(card.display_faces[1].role,'meld_result');
  assert.equal(card.display_faces[1].name,'Urza, Planeswalker');
  assert.equal(card.display_faces[1].partner_name,'The Mightstone and Weakstone');
  assert.equal(cardFaceIndicator(card),'Meld result');
});

test('older saved printings discovered by the serving audit receive their exact reverse face',()=>{
  for(const [id,name,back] of [
    ['004524bf-b249-4dac-9c10-44d57143feb9','Growing Rites of Itlimoc','Itlimoc, Cradle of the Sun'],
    ['8ceb9356-b7b1-4b86-ace2-39bc726a9155',"Jace, Vryn's Prodigy",'Jace, Telepath Unbound'],
    ['ea164381-1e76-4cfb-ab88-70b97c6285dd','Valki, God of Lies','Tibalt, Cosmic Impostor'],
  ]) {
    const image_url=registry.printings[id].display_faces[0].image_url;
    const card=publicCardDisplay({id,name,image_url});
    assert.equal(card.image_url,image_url);
    assert.equal(card.display_faces[1].name,back);
    assert.ok(card.display_faces[1].image_url.includes(id));
  }
});

test('every generated overlay contains a complete validated pair and records exact aliases',()=>{
  assert.ok(Object.keys(registry.printings).length>300);
  for(const [id,record] of Object.entries(registry.printings)) {
    assert.match(id,/^[a-f0-9-]{36}$/);
    assert.deepEqual(normalizedDisplayFaces(record.display_faces),record.display_faces,id);
    assert.ok(record.display_faces[0].image_url.includes(id));
    assert.ok(record.names.includes(record.display_faces[0].name));
  }
});

test('image maintenance carries faces, rejects malformed pairs and remains idempotent',async()=>{
  const rows=JSON.parse(gunzipSync(fs.readFileSync('corpus/draft-run/neo.json.gz')));
  let stored=structuredClone(rows.find(p=>p.candidates.some(c=>c.name===fable.name)));
  const target=stored.candidates.find(c=>c.name===fable.name);
  const mapping=[{name:target.name,image_url:target.image_url,display_faces:effectiveCardMetadata(target).display_faces}];
  // Explicitly model legacy storage, even when the checked-in corpus has
  // already received the face-aware image refresh being tested.
  for(const card of [...stored.candidates,...stored.prior_picks])if(card.name===fable.name)delete card.display_faces;
  const frozen=structuredClone(stored);
  let writes=0;
  const query=async(sql,params)=>{
    if(sql.includes('SELECT p.puzzle_id,p.payload')) {
      assert.match(sql,/card\.value->'display_faces'/);
      return {rows:[{puzzle_id:stored.puzzle_id,payload:stored,corpus_version:stored.corpus_version}]};
    }
    if(sql.includes('UPDATE draft_run_verified_puzzles')) {
      writes++;stored=JSON.parse(params[0])[0].payload;return {rows:[{puzzle_id:stored.puzzle_id}]};
    }
    throw Error('Unexpected query');
  };
  assert.equal((await refreshTrophyImagePage(query,'neo',mapping)).updated_puzzles,1);
  assert.deepEqual(stored.candidates.find(c=>c.name===fable.name).display_faces,mapping[0].display_faces);
  assert.equal((await refreshTrophyImagePage(query,'neo',mapping)).updated_puzzles,0);
  assert.equal(writes,1);
  const strip=p=>({...p,candidates:p.candidates.map(({display_faces,...c})=>c),prior_picks:p.prior_picks.map(({display_faces,...c})=>c)});
  assert.deepEqual(strip(stored),strip(frozen));
  await assert.rejects(refreshTrophyImagePage(query,'neo',[{...mapping[0],display_faces:[mapping[0].display_faces[0]]}]),/Invalid card face mapping/);
});
