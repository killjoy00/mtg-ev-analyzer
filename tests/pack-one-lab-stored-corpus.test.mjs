import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MAX_SETS,PRIORITY_SETS,readStoredDeckCatalog,buildStoredCorpusReport,summarizeStoredSet,storedCorpusPackets,cachedStoredCorpusPackets} from '../research/pack-one-lab/stored-corpus.mjs';
import {assembleArticle} from '../worker/lab-writer.mjs';
import {articleHash} from '../worker/lab-editorial.mjs';

const meta={set_id:'fra',set_name:'Reality Fracture',corpus_version:'fixture-corpus',source_snapshot_id:'a'.repeat(64),draft_sha256:'b'.repeat(64),game_sha256:'c'.repeat(64)};
const card=(id,mana,rarity='common',type='Creature')=>({id,name:id,mana_cost:mana,rarity,type_line:type,multi_face:false});
const cards=[card('black','{1}{B}'),card('blue','{2}{U}','rare'),card('artifact','{2}','uncommon','Artifact Creature'),card('big-black','{3}{B}','rare'),card('trick','{B}','common','Instant')];
function fixture(){
  const rows=[],decks=[],sources={};
  for(let i=0;i<200;i++){
    const source_draft_hash=i.toString(16).padStart(32,'0');
    sources[source_draft_hash]=i;
    decks.push({event_type:'PremierDraft',size:40,deck:[[0,40]],sideboard:[[1,1]],splash_colors:i<80?'U':''});
    for(let p=1;p<=8;p++){
      const chosen=p===1?(i<180?'black':'blue'):p===2?'black':p===3?(i<20?'blue':'black'):p===5?(i<60?'black':i<130?'artifact':'big-black'):p===6?(i<100?'blue':'black'):'black';
      rows.push({source_draft_hash,pick_number:p,historical_pick_id:chosen,candidates:cards});
    }
  }
  const deckInput={sha256:'d'.repeat(64),catalog:{set_id:'fra',sources,decks,cards:[{name:'black'},{name:'blue'}]}};
  return {rows,deckInput};
}
test('eight predefined analyses from stored choices and last recorded decks; no individual data leaves report',()=>{
  const {rows,deckInput}=fixture(),set=summarizeStoredSet(meta,rows,deckInput);
  assert.equal(set.complete_drafts,200);
  assert.equal(set.source_drafts,200);
  const report={schema_version:1,kind:'stored-corpus',sets:[set]};
  const out=storedCorpusPackets(report);
  assert.equal(set.analyses.length,8);
  assert.equal(out.length,7);
  assert.equal(out.find(p=>p.id.endsWith('repeat-choice')).metrics[0].percent,30);
  const first=out.find(x=>x.id==='corpus-fra-first-pick-last-deck');
  assert.deepEqual(first.metrics.map(m=>[m.numerator,m.denominator,m.percent]),[[180,200,90],[20,200,10]]);
  const splash=out.find(x=>x.id==='corpus-fra-last-deck-splash');
  assert.equal(splash.metrics[0].percent,40);
  const rarity=out.find(x=>x.id==='corpus-fra-rarity-choice');
  assert.equal(rarity.metrics[0].percent,90);
  assert.equal(rarity.metrics[3].percent,30);
  const text=JSON.stringify(report);
  for(const key of ['source_draft_hash','historical_pick_id','candidates','black','artifact','draft_url'])assert.ok(!text.includes(key));
  assert.ok(out.every(p=>p.provenance.hashes.draft===meta.draft_sha256));
  assert.equal(first.provenance.hashes.deck_catalog,deckInput.sha256);
});
test('coverage, incomplete trajectories, malformed counts and duplicate picks fail safely',()=>{
  const {rows,deckInput}=fixture();
  const set=summarizeStoredSet(meta,rows.filter(r=>r.pick_number!==8),deckInput);
  assert.equal(set.complete_drafts,0);
  assert.deepEqual(storedCorpusPackets({schema_version:1,kind:'stored-corpus',sets:[set]}),[]);
  assert.throws(()=>summarizeStoredSet(meta,[...rows,rows[0]],deckInput),/duplicate-pick/);
  const report={schema_version:1,kind:'stored-corpus',sets:[summarizeStoredSet(meta,rows,null)]};
  assert.equal(storedCorpusPackets(report).filter(p=>p.theme==='mana'||p.theme==='deck-inclusion').length,0);
  report.sets[0].analyses[0].stages[0].counts[0]=201;
  assert.throws(()=>storedCorpusPackets(report),/denominator/);
});
test('actual committed FRA trophy catalog loads offline with verified checksum',async()=>{
  const d=await readStoredDeckCatalog('fra');
  assert.equal(d.catalog.set_id,'fra');
  assert.match(d.sha256,/^[a-f0-9]{64}$/);
  assert.ok(d.catalog.decks.filter(x=>x.event_type==='PremierDraft').length>=1000);
  assert.ok(Object.keys(d.catalog.sources).length>=1000);
  assert.equal(await readStoredDeckCatalog('unknown-fixture-set'),null);
});
test('weekly stored corpus cache is private, snapshot-consistent, hash checked and reused',async()=>{
  const {rows,deckInput}=fixture(),report={schema_version:1,kind:'stored-corpus',sets:[summarizeStoredSet(meta,rows,deckInput)]};
  let row=null,builds=0;
  const queries=[];
  const query=async(sql,params)=>{
    queries.push(sql);
    if(sql.startsWith('SELECT state'))return {rows:row?[row]:[]};
    if(sql.startsWith('INSERT')){row={state:'preparing'};return {rows:[]};}
    if(sql.startsWith('BEGIN')||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
    if(sql.includes("SET state='ready'")){row={state:'ready',report:JSON.parse(params[1]),report_hash:params[2]};return {rows:[{source_key:params[0]}]};}
    if(sql.includes("SET state='failed'")){row={state:'failed'};return {rows:[]};}
    throw Error('unexpected SQL');
  };
  const options={week:'2026-11-23',build:async()=>{builds++;return report;}};
  assert.equal((await cachedStoredCorpusPackets(query,options)).length,7);
  assert.equal((await cachedStoredCorpusPackets(query,options)).length,7);
  assert.equal(builds,1);
  assert.ok(queries.includes('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'));
  assert.equal(row.report_hash,articleHash(report));
  row.report_hash='0'.repeat(64);
  await assert.rejects(cachedStoredCorpusPackets(query,options),/cache-hash/);
});
test('stored-corpus article describes retained sources, not a fresh archive',()=>{
  const {rows,deckInput}=fixture();
  const packet=storedCorpusPackets({schema_version:1,kind:'stored-corpus',sets:[summarizeStoredSet(meta,rows,deckInput)]}).find(p=>p.id.endsWith('rarity-choice'));
  const article=assembleArticle(packet,{title:'When does a common beat a rare?',lead:'A rarity symbol is easy to notice, but it does not tell you whether a card fills a useful role.',
    sections:[{heading:'',text:'The opening pack and later packs offer different choices. A later common may be useful in a pool that has already started taking shape, and the available rare may not be the same quality as an opening rare. Look at the card and the alternatives rather than treating rarity as a rule.'}],closing:''});
  assert.match(article.body,/retained, verified high-win-rate PremierDraft trophy sources/);
  assert.equal(article.editorial_mode,'quick-hit');
  assert.deepEqual(article.blocks.slice(0,2).map(b=>b.type),['facts','chart']);
  assert.match(article.body,/P1P1 — Common spell: 90\.0% \(180 of 200\)/);
  assert.equal(article.provenance.source_hashes.draft,meta.draft_sha256);
});

test('weekly Lab research covers only the five latest live regular sets, favoring the newest three',async()=>{
  assert.equal(MAX_SETS,5);
  assert.equal(PRIORITY_SETS,3);
  const {rows,deckInput}=fixture();
  const metas=Array.from({length:5},(_,i)=>({...meta,set_id:'fixture-'+i,set_name:'Fixture set '+i}));
  const query=async(sql,params)=>{
    if(sql.includes('FROM pack1_lab_corpus_sources')){
      assert.match(sql,/ORDER BY release_date DESC NULLS LAST,set_id LIMIT 5$/);
      return {rows:metas};
    }
    assert.match(sql,/FROM pack1_lab_corpus_picks/);
    assert.ok(metas.some(m=>m.set_id===params[0]));
    return {rows};
  };
  const report=await buildStoredCorpusReport(query,{loadDeck:async set_id=>({...deckInput,catalog:{...deckInput.catalog,set_id}})});
  assert.deepEqual(report.sets.map(s=>s.set_id),metas.map(m=>m.set_id));
  const packets=storedCorpusPackets(report);
  const rarity=packets.filter(p=>p.id.endsWith('rarity-choice'));
  assert.ok(rarity[2].triage_score>rarity[3].triage_score);
  assert.throws(()=>storedCorpusPackets({...report,sets:[...report.sets,{...report.sets[0],set_id:'fixture-old'}]}),/lab-corpus-report/);
  const runner=readFileSync(new URL('../scripts/pack-one-lab-weekly.mjs',import.meta.url),'utf8');
  assert.match(runner,/cycle\(query,\{packets:stored,writer,reviewer\}\)/);
  assert.doesNotMatch(runner,/const packets=await readPackets\(\)/);
});

test('opening creature comparison uses the same condition and only newest three sets',()=>{
  const {rows}=fixture();
  const sets=Array.from({length:5},(_,i)=>{
    const m={...meta,set_id:'fixture-'+i,set_name:'Fixture set '+i};
    const variant=rows.map(r=>r.pick_number===1&&parseInt(r.source_draft_hash,16)<i*30?{...r,historical_pick_id:'trick'}:r);
    return summarizeStoredSet(m,variant,null);
  });
  const packet=storedCorpusPackets({schema_version:1,kind:'stored-corpus',sets}).find(p=>p.kind==='stored-comparison');
  assert.deepEqual(packet.sets,['Fixture set 0','Fixture set 1','Fixture set 2']);
  assert.deepEqual(packet.metrics.map(m=>m.percent),[100,85,70]);
  assert.equal(packet.editorial_mode,'format-comparison');
  assert.equal(packet.cohort.sets.length,3);
  assert.equal(Object.keys(packet.provenance.hashes).length,6);
  const article=assembleArticle(packet,{title:'Different formats, different first picks',
    lead:'Opening packs differ between formats. Even with the same definition of a creature choice, the decisions can look quite different.',
    sections:[{heading:'The creatures in the pack',text:'A creature can be an excellent starting point when it offers an efficient body or a useful effect. A spell can be a better opening pick when it answers a problem the deck will otherwise struggle to solve. The category itself does not tell you which card is best.'},
      {heading:'Use the format as context',text:'A format with many strong creatures might offer more tempting bodies than a format with exceptional noncreature spells. Those are possible explanations, not causes established by this comparison. Pay attention to the roles and the specific available cards rather than aiming for a particular percentage.'}],
    closing:''});
  assert.equal(article.editorial_mode,'format-comparison');
  assert.equal(article.blocks.filter(b=>b.type==='heading').length,2);
  assert.deepEqual(article.blocks.slice(0,3).map(b=>b.type),['paragraph','facts','chart']);
  assert.equal(article.artwork.chart_alt.split('; ').length,3);
});
