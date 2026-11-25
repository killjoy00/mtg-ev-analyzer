import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeStrengthContext,attachStrengthContext,readStrengthContext} from '../research/pack-one-lab/card-strength-context.mjs';
const meta={set_id:'fra',game_sha256:'a'.repeat(64)};
const t={schema_version:1,set_id:'fra',strength_version:'gih-shrunk-400-v1',prior_games:400,game_rows:2000,baseline_win_rate:.55,source:{provider:'17Lands',license:'CC BY 4.0',sha256:meta.game_sha256},cards:{Alpha:[2.3,700],Rare:[-4,500],Tiny:[3,399]}};
const p={research_context:{cards:[{name:'Alpha'},{name:'Tiny'}],rare_examples:[{rare:'Rare'}]},provenance:{hashes:{game:meta.game_sha256}},limitations:[]};
test('game context must match source and preserves separate samples and hash',()=>{
  const c=normalizeStrengthContext(meta,t,'b'.repeat(64));
  assert.deepEqual(Object.keys(c.cards),['Alpha','Rare']);
  const q=attachStrengthContext(p,meta,c);
  assert.deepEqual(q.research_context.game_context.cards,[{name:'Alpha',points:2.3,in_hand_games:700},{name:'Rare',points:-4,in_hand_games:500}]);
  assert.equal(q.provenance.hashes.card_strength_table,'b'.repeat(64));
  assert.match(q.research_context.game_context.scope,/not only the retained trophy drafts/);
  assert.equal(normalizeStrengthContext({...meta,game_sha256:'c'.repeat(64)},t,'b'.repeat(64)),null);
  assert.equal(attachStrengthContext(p,{...meta,game_sha256:'c'.repeat(64)},c),p);
});
test('actual FRA table is read offline; mismatched or absent tables omitted',async()=>{
  const c=await readStrengthContext({set_id:'fra',game_sha256:'a350666bfd293bd14601105af0187f13353b16fa86e81307432a7b3a9a0bbfdc'});
  assert.deepEqual(c.cards['Mindseeker Oculus'],[4.57,51185]);
  assert.equal(await readStrengthContext(meta),null);
  assert.equal(await readStrengthContext({set_id:'fixture-unknown',game_sha256:meta.game_sha256}),null);
});
