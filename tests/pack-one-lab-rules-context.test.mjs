import test from 'node:test';
import assert from 'node:assert/strict';
import {readRulesContext,attachRulesContext} from '../research/pack-one-lab/rules-context.mjs';
test('recent rules snapshots are read offline and exact named card text is pinned',async()=>{
  const meta={set_id:'hob'};
  const ctx=await readRulesContext(meta);
  const name='Lakeshore Apothecary';
  assert.ok(ctx.cards[name]);
  assert.match(ctx.cards[name].oracle_text,/second card/i);
  const packet={research_context:{cards:[{name}]},reference:'Example.',provenance:{hashes:{}}};
  const a=attachRulesContext(packet,meta,ctx);
  assert.equal(a.research_context.rules_context.cards[0].oracle_text,ctx.cards[name].oracle_text);
  assert.equal(a.provenance.hashes.rules_metadata,ctx.sha256);
  assert.equal(await readRulesContext({set_id:'unavailable-fixture'}),null);
  assert.throws(()=>attachRulesContext(packet,meta,{...ctx,sha256:'a'.repeat(64)}),/lab-rules-context/);
  assert.equal(attachRulesContext({...packet,research_context:{cards:[{name:'Invented fixture'}]}},meta,ctx).research_context.rules_context,undefined);
  console.log('HOB verified Lakeshore Apothecary rules: '+JSON.stringify(ctx.cards[name]));
});
test('all five audited recent-set snapshots have valid pinned rules',async()=>{
  for(const set_id of ['fra','hob','msh','sos','tmt']){
    const c=await readRulesContext({set_id});
    assert.ok(Object.keys(c.cards).length>100,set_id);
  }
});
