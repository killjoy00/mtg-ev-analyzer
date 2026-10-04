import test from 'node:test';
import assert from 'node:assert/strict';
import {pinnedGameSources,verifyPinnedGameHeader,repairPinnedGameMetadata} from '../.github/release-v5-source-metadata.mjs';

function fixture() {
 const sets=Array.from({length:30},(_,i)=>({id:'set'+String(i).padStart(2,'0'),
  source_snapshot_id:(i+1).toString(16).padStart(64,'0'),model_version:'strong-player-colour-stage-v5',
  source_archive:{sha256:'a'.repeat(64)},input_signature:'input',puzzle_file_sha256:'b'.repeat(64),
  skill_source:{sha256:'c'.repeat(64),etag:'"'+'d'.repeat(32)+'-2"',compressed_bytes:12345,
   last_modified:'Thu, 01 Oct 2026 13:17:00 GMT',
   url:'https://17lands-public.s3.amazonaws.com/analysis_data/game_data/game_data_public.SET'+String(i).padStart(2,'0')+'.PremierDraft.csv.gz'}}));
 const catalog={corpus_version:'elite-trophy-colour-stage-v9',complete:true,errors:{},sets};
 const baseline={sets:sets.map(s=>s.id),environment:sets.map(s=>({set_id:s.id,active_corpus_version:'elite-trophy-colour-stage-v8',active_snapshot_id:'old-'+s.id,active_manifest_hash:'old-hash'}))};
 return {catalog,baseline};
}
function response(pin,patch={}) {
 return new Response(null,{status:200,headers:{etag:pin.game_etag,'content-length':String(pin.compressed_bytes),
  'last-modified':pin.game_last_modified,...patch}});
}
test('pinned metadata requires the complete unchanged v9 cohort, model, exact source host and rollback parents',()=>{
 const {catalog,baseline}=fixture();assert.equal(pinnedGameSources(catalog,baseline).length,30);
 for(const change of [c=>c.sets.pop(),c=>c.sets[1]=c.sets[0],c=>c.complete=false,
  c=>c.sets[0].model_version='v4',c=>c.sets[0].skill_source.sha256='bad',
  c=>c.sets[0].skill_source.url='https://example.com/game.csv.gz',
  c=>c.sets[0].skill_source.compressed_bytes=0,c=>c.sets[0].skill_source.etag='bad']) {
  const c=structuredClone(catalog);change(c);assert.throws(()=>pinnedGameSources(c,baseline));
 }
 const b=structuredClone(baseline);b.environment[0].active_corpus_version='elite-trophy-colour-stage-v9';
 assert.throws(()=>pinnedGameSources(catalog,b));
});
test('archive probe is HEAD-only and fails on unavailable, redirected or changed pinned archives',async()=>{
 const {catalog,baseline}=fixture(),pin=pinnedGameSources(catalog,baseline)[0];
 const fetcher=async(url,options)=>{assert.equal(url,pin.game_url);assert.equal(options.method,'HEAD');assert.equal(options.redirect,'error');return response(pin);};
 assert.equal((await verifyPinnedGameHeader(pin,fetcher)).sha256,pin.game_sha256);
 for(const patch of [{etag:'"changed"'},{'content-length':'12346'},{'last-modified':'Fri, 02 Oct 2026 13:17:00 GMT'}])
  await assert.rejects(verifyPinnedGameHeader(pin,async()=>response(pin,patch)));
 await assert.rejects(verifyPinnedGameHeader(pin,async()=>new Response(null,{status:404})));
 await assert.rejects(verifyPinnedGameHeader(pin,async()=>{throw Error('redirect blocked');}));
});
test('one changed source prevents every metadata mutation and promotion',async()=>{
 const {catalog,baseline}=fixture(),pins=pinnedGameSources(catalog,baseline);let queries=0,promotions=0;
 const fetcher=async url=>{const pin=pins.find(p=>p.game_url===url);return response(pin,pin.set_id==='set05'?{etag:'"changed"'}:{});};
 await assert.rejects(repairPinnedGameMetadata(async()=>{queries++;},catalog,baseline,{fetcher,promote:async()=>{promotions++;}}));
 assert.equal(queries,0);assert.equal(promotions,0);
});
test('all headers precede the guarded repair, and existing health promotion runs for every exact snapshot',async()=>{
 const {catalog,baseline}=fixture(),pins=pinnedGameSources(catalog,baseline);let headers=0;const promotions=[];
 const fetcher=async url=>{headers++;return response(pins.find(p=>p.game_url===url));};
 const query=async(_sql,params)=>{assert.equal(headers,30);assert.equal(JSON.parse(params[0]).length,30);return {rows:[{eligible:30,expected_repairs:30,repaired:30,candidates:pins.map(p=>({...p,manifest_hash:'hash'}))}]};};
 const result=await repairPinnedGameMetadata(query,catalog,baseline,{fetcher,promote:async(_q,set,hash,id)=>promotions.push({set,hash,id})});
 assert.equal(result.passed,true);assert.equal(result.headers_checked,30);assert.equal(result.repaired,30);
 assert.deepEqual(promotions.map(p=>p.id),pins.map(p=>p.source_snapshot_id));
 for(const row of [{eligible:29,expected_repairs:29,repaired:0},{eligible:30,expected_repairs:30,repaired:29}]) {
  let promoted=0;await assert.rejects(repairPinnedGameMetadata(async()=>({rows:[row]}),catalog,baseline,{fetcher,promote:async()=>{promoted++;}}));assert.equal(promoted,0);
 }
});
