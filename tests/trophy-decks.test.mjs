import test from 'node:test';
import assert from 'node:assert/strict';
import {brotliCompressSync,brotliDecompressSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {encoded,sha256} from '../corpus/trophy-decks/fra.mjs';
import {decodeTrophyDeckCatalog,withTrophyDeckAvailability,trophyDeckForRound} from '../worker/trophy-decks.mjs';
import {revealCardChoices} from '../draft-run-reveal.mjs';
import {gateway,routeFamily} from '../edge/gateway.mjs';
import {catalogLoaders} from '../corpus/trophy-decks/index.mjs';
import coverage from '../corpus/trophy-decks/coverage.json' with {type:'json'};
import {normalizedDisplayFaces} from '../card-faces.mjs';
import {safeCardImageUrl} from '../card-image-policy.mjs';

const bytes=brotliDecompressSync(Buffer.from(encoded,'base64')),catalog=decodeTrophyDeckCatalog(encoded);
const source=Object.keys(catalog.sources)[0];
const answer={puzzle:{puzzle_id:'locked',set_id:'fra'}};

test('compact sources retain only the selected aliases and reject corrupt masks',()=>{
  const id='0'.repeat(32),deck={draft_url:'https://www.17lands.com/draft/'+id,event_type:'PremierDraft'};
  const hashes=[`fra|${id}`,`fra|PremierDraft|${id}`,`pack-one|FRA|${id}`]
    .map(value=>createHash('sha256').update(value).digest('hex').slice(0,32)).sort();
  const raw={set_id:'fra',decks:[deck],source_alias_masks:[5]};
  const encode=value=>brotliCompressSync(Buffer.from(JSON.stringify(value))).toString('base64');
  const expanded=decodeTrophyDeckCatalog(encode(raw));
  assert.deepEqual(expanded.sources,{[hashes[0]]:0,[hashes[2]]:0});
  assert.equal(expanded.sources[hashes[1]],undefined,'unused compatibility aliases stay absent');
  assert.equal(expanded.source_alias_masks,undefined);
  for(const source_alias_masks of [[],[0],[8],[1.5],[null]])
    assert.throws(()=>decodeTrophyDeckCatalog(encode({...raw,source_alias_masks})),/Invalid trophy source/);
  assert.throws(()=>decodeTrophyDeckCatalog(encode({...raw,sources:{}})),/Invalid trophy source/);
  assert.throws(()=>decodeTrophyDeckCatalog(encode({...raw,decks:[{...deck,draft_url:'https://example.invalid/'}]})),/Invalid trophy draft/);
  assert.throws(()=>decodeTrophyDeckCatalog(encode({...raw,decks:[deck,deck],source_alias_masks:[1,1]})),/Duplicate trophy source/);
  const legacy={set_id:'fra',sources:{[hashes[0]]:0},decks:[deck]};
  assert.deepEqual(decodeTrophyDeckCatalog(encode(legacy)),legacy);
});

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
  assert.equal(catalog.decks.length,1170);assert.equal(Object.keys(catalog.sources).length,1170);
  for(const deck of catalog.decks) {
    assert.equal(deck.deck.reduce((sum,[,count])=>sum+count,0),deck.size);assert.ok(deck.size>=40);
    for(const [index,count] of [...deck.deck,...deck.sideboard]) {
      assert.ok(Number.isInteger(count)&&count>0);assert.ok(catalog.cards[index]?.name);
      assert.match(catalog.cards[index].image_url,/^https:\/\/cards\.scryfall\.io\//);
      assert.ok(catalog.cards[index].type_line);assert.ok(Number.isFinite(catalog.cards[index].mana_value));
    }
  }
});

test('all published set catalogs have verified hashes, exact lists and complete card details',async()=>{
  assert.equal(Object.keys(catalogLoaders).length,31);
  assert.deepEqual(Object.keys(catalogLoaders).sort(),coverage.sets.map(set=>set.set_id).sort());
  let total=0;
  for(const [set,load] of Object.entries(catalogLoaders)) {
    const {encoded,sha256}=await load(),bytes=brotliDecompressSync(Buffer.from(encoded,'base64'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),sha256,set);
    const current=decodeTrophyDeckCatalog(encoded),expected=coverage.sets.find(row=>row.set_id===set);
    assert.equal(current.set_id,set);assert.equal(current.decks.length,expected.decks);total+=current.decks.length;
    assert.equal(Object.keys(current.sources).length,expected.serving_sources,set);
    assert.equal(new Set(Object.values(current.sources)).size,current.decks.length,set+' retains every deck');
    for(const [source,index] of Object.entries(current.sources)) {
      assert.match(source,/^[a-f0-9]{32}$/);assert.ok(current.decks[index]);
      const deck=current.decks[index];
      assert.match(deck.draft_url,/^https:\/\/www\.17lands\.com\/draft\/[a-f0-9]{32}$/);
      const id=deck.draft_url.split('/').at(-1),expansion=set==='powered-cube'?'Cube_-_Powered':set.toUpperCase();
      const aliases=[`${set}|${id}`,`${set}|${deck.event_type}|${id}`,`pack-one|${expansion}|${id}`,`pack-one|${expansion.toUpperCase()}|${id}`];
      assert.ok(aliases.some(value=>createHash('sha256').update(value).digest('hex').slice(0,32)===source),set+' draft URL matches the exact source');
    }
    for(const card of current.cards) {
      assert.ok(card.name&&card.type_line,set);assert.ok(safeCardImageUrl(card.image_url),card.name);
      assert.ok(Number.isFinite(card.mana_value)&&card.mana_value>=0,card.name);
      if(card.display_faces)assert.equal(normalizedDisplayFaces(card.display_faces).length,2,card.name);
    }
    for(const deck of current.decks) {
      assert.equal(deck.deck.reduce((sum,[,count])=>sum+count,0),deck.size,set);assert.ok(deck.size>=40);
      for(const [index,count] of [...deck.deck,...deck.sideboard]) {
        assert.ok(current.cards[index]);assert.ok(Number.isInteger(count)&&count>0);
      }
    }
  }
  assert.equal(total,110373);assert.equal(total,coverage.decks);
  assert.equal(coverage.source_drafts-coverage.matched_sources,181);
});

test('deck and availability caches cannot mix sets or sources with the same local index',async()=>{
  const session={answers:[answer],puzzle_ids:['locked']};
  for(const set of ['fra','hob','powered-cube','fra']) {
    const {encoded}=await catalogLoaders[set](),current=decodeTrophyDeckCatalog(encoded);
    const source=Object.keys(current.sources).find(source=>current.sources[source]===0);
    const query=async()=>({rows:[{puzzle_id:'locked',set_id:set,source_draft_hash:source}]});
    const value=await trophyDeckForRound(query,session,'0');
    assert.deepEqual(value.deck,current.decks[0].deck.map(([index,count])=>({...current.cards[index],count})));
    const state=await withTrophyDeckAvailability(query,[{puzzle:{puzzle_id:'locked',set_id:set}}]);
    assert.equal(state[0].deckAvailable,true);
  }
  await assert.rejects(()=>trophyDeckForRound(async()=>({rows:[{set_id:'hob',source_draft_hash:source}]}),session,'0'),error=>error.status===404);
});

test('FRA Traditional sources return their own exact deck without affecting publication',async()=>{
  const index=catalog.decks.findIndex(deck=>deck.event_type==='TradDraft');assert.ok(index>=0);
  const source=Object.keys(catalog.sources).find(source=>catalog.sources[source]===index);
  const query=async()=>({rows:[{puzzle_id:'locked',set_id:'fra',source_draft_hash:source}]});
  const state=await withTrophyDeckAvailability(query,[answer]);assert.equal(state[0].deckAvailable,true);
  const value=await trophyDeckForRound(query,{answers:[answer],puzzle_ids:['locked']},'0');
  assert.equal(value.event_type,'TradDraft');
  assert.deepEqual(value.deck,catalog.decks[index].deck.map(([card,count])=>({...catalog.cards[card],count})));
  assert.deepEqual(value.sideboard,catalog.decks[index].sideboard.map(([card,count])=>({...catalog.cards[card],count})));
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
  assert.equal(deck.source.draft_url,catalog.decks[catalog.sources[source]].draft_url);
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
