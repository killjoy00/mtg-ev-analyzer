import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {encoded,sha256} from '../corpus/trophy-decks/fra.mjs';
import {withTrophyDeckAvailability,trophyDeckForRound} from '../worker/trophy-decks.mjs';
import {revealCardChoices} from '../draft-run-reveal.mjs';
import {gateway,routeFamily} from '../edge/gateway.mjs';

const bytes=gunzipSync(Buffer.from(encoded,'base64')),catalog=JSON.parse(bytes);
const source=Object.keys(catalog.sources)[0];
const answer={puzzle:{puzzle_id:'locked',set_id:'fra'}};

test('every match and non-match keeps three distinct role-appropriate cards',()=>{
  const ranking=[{id:'leader',support:.6},{id:'runner',support:.3},{id:'trophy',support:.09},{id:'weak',support:.01}];
  for(const selectedId of ranking.map(c=>c.id)) {
    const result=revealCardChoices({ranking,historicalId:'trophy',selectedId});
    assert.equal(result.length,3);assert.equal(new Set(result.map(c=>c.id)).size,3);
    assert.equal(result[0].id,'trophy');
    if(selectedId==='trophy')assert.deepEqual(result.map(c=>c.id),['trophy','leader','runner']);
    else {
      assert.equal(result[1].id,selectedId);
      assert.equal(result[2].id,ranking.find(c=>!['trophy',selectedId].includes(c.id)).id);
      assert.deepEqual(result.map(c=>c.label),['Trophy pick','Your pick','Next best']);
    }
  }
});

test('curated public decks retain exact quantities, aliases and complete display metadata',()=>{
  assert.equal(createHash('sha256').update(bytes).digest('hex'),sha256);
  assert.equal(catalog.decks.length,1029);assert.equal(Object.keys(catalog.sources).length,3087);
  for(const deck of catalog.decks) {
    assert.equal(deck.deck.reduce((sum,[,count])=>sum+count,0),deck.size);assert.ok(deck.size>=40);
    for(const [index,count] of [...deck.deck,...deck.sideboard]) {
      assert.ok(Number.isInteger(count)&&count>0);assert.ok(catalog.cards[index]?.name);
      assert.match(catalog.cards[index].image_url,/^https:\/\/cards\.scryfall\.io\//);
      assert.ok(catalog.cards[index].type_line);assert.ok(Number.isFinite(catalog.cards[index].mana_value));
    }
  }
});

test('availability reads only revealed metadata and never includes a deck in a run snapshot',async()=>{
  let calls=0;
  const query=async(sql,params)=>{calls++;assert.deepEqual(params,[JSON.stringify(['locked'])]);assert.doesNotMatch(sql,/payload|SELECT \*/);return {rows:[{puzzle_id:'locked',set_id:'fra',source_draft_hash:source}]};};
  assert.deepEqual(await withTrophyDeckAvailability(query,[]),[]);assert.equal(calls,0);
  const result=await withTrophyDeckAvailability(query,[answer,{puzzle:{puzzle_id:'other',set_id:'other'}}]);
  assert.equal(result[0].deckAvailable,true);assert.equal(result[1].deckAvailable,false);assert.equal(result[0].deck,undefined);
  assert.equal(answer.deckAvailable,undefined,'historical answers are not mutated');
});

test('unlocked and mismatched rounds are rejected before any source lookup',async()=>{
  const query=()=>assert.fail('Must authorize the revealed round first');
  for(const round of ['-1','',null,'0.5','1'])await assert.rejects(()=>trophyDeckForRound(query,{answers:[answer],puzzle_ids:['locked','future']},round),e=>[400,403].includes(e.status));
  await assert.rejects(()=>trophyDeckForRound(query,{answers:[answer],puzzle_ids:['another']},'0'),e=>e.status===403);
});

test('a revealed source returns its exact deck; missing sources never get a substitute',async()=>{
  const session={answers:[answer],puzzle_ids:['locked']};
  const deck=await trophyDeckForRound(async()=>({rows:[{set_id:'fra',source_draft_hash:source}]}),session,'0');
  assert.equal(deck.deck.reduce((sum,c)=>sum+c.count,0),deck.size);
  assert.equal(deck.source.license,'CC BY 4.0');assert.match(deck.source.note,/last game recorded/);
  assert.equal(deck.source_draft_hash,undefined);assert.equal(deck.draft_id,undefined);
  await assert.rejects(()=>trophyDeckForRound(async()=>({rows:[{set_id:'fra',source_draft_hash:'missing'}]}),session,'0'),e=>e.status===404);
});

test('the gateway forwards only read requests for a deck to the owning-run handler',async()=>{
  const path='/draft/v1/runs/11111111-1111-4111-8111-111111111111/deck';
  const env={MODE:'production',NEON_BRANCH_ID:'br-orange-feather-ayps8kep',QUOTA_KEY:'d'.repeat(64),NETWORK_QUOTA:{idFromName:n=>n,get:()=>({fetch:async()=>new Response(null,{status:204})})}};
  let forwarded=null;
  const result=await gateway(new Request('https://api.packone.pro'+path+'?round=0',{headers:{'cf-connecting-ip':'192.0.2.1'}}),env,async url=>{forwarded=String(url);return Response.json({size:40});});
  assert.equal(result.status,200);assert.ok(forwarded.endsWith('/deck?round=0'));assert.equal(routeFamily(path),'draft_read');
  const post=await gateway(new Request('https://api.packone.pro'+path,{method:'POST',headers:{'cf-connecting-ip':'192.0.2.1','content-type':'application/json'},body:'{}'}),env,()=>assert.fail('Read-only route'));
  assert.equal(post.status,404);
});
