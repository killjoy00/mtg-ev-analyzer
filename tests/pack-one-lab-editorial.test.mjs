import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,access} from 'node:fs/promises';
import {archivePackets,cachedArchivePackets,prepareReport,SOURCE_KEY} from '../research/pack-one-lab/archive-packets.mjs';
import {selectPackets} from '../scripts/pack-one-lab-weekly.mjs';
import {assembleArticle} from '../worker/lab-writer.mjs';
import {candidates,renderResearchBrief} from '../research/pack-one-lab/editorial.mjs';

const pins={draft:'f9497000be929d3f8cef87be643dc0b010e406a966ece7d0fc05e5e8e0c4b43d',game:'a350666bfd293bd14601105af0187f13353b16fa86e81307432a7b3a9a0bbfdc',metadata:'5dee48cee16adf09b5c1003c4ef9af88a4951e4c24e7f7ba47283e444b80dfd7'};
const defs={
 'early-fixing':['fixing land','other card'],
 'color-pivot':['same-color spell','new-color spell','other card'],
 'colorless-flex':['generic-mana spell','colored spell','other card'],
 'rarity-choice':['common spell','rare/mythic spell','other card'],
 'first-pick-abandon':['first-pick card name observed','first-pick card name absent'],
};
// Entirely synthetic fixture: never present as a real finding.
function fixture(){
  return {schema_version:1,status:'draft-evidence-only',source_sha256:{...pins},sample_floor:100,metadata_coverage_floor:.8,
    cohort:{qualified_drafts:1000,qualified_trophies:600,complete_trajectories:500,first_game_decks:450,win_rate_cutoff:.6},
    results:Object.entries(defs).map(([id,labels])=>({
      id,status:'candidate-evidence',
      rows:(id==='first-pick-abandon'?[1]:id==='color-pivot'?[3,4,5,6,7,8]:[1,2,3,4,5,6,7,8]).map(p=>{
        const n=id==='first-pick-abandon'?450:200,k=id==='first-pick-abandon'?450:500;
        const a=id==='first-pick-abandon'?[360,90]:labels.length===3?[p<5?100:40,p<5?60:120,40]:[p<5?40:80,p<5?160:120];
        return {pick:p,eligible_drafts:500,known_drafts:k,qualifying_drafts:n,coverage:k/500,qualified:true,
          metrics:labels.map((label,i)=>({label,numerator:a[i],denominator:n,percent:Math.round(1000*a[i]/n)/10}))};
      })
    }))
  };
}
test('deterministic top three and same-theme suppression',()=>{
  const report=fixture(),x=candidates(report);
  assert.equal(x.status,'needs-editorial-review');
  assert.equal(x.candidates.length,3);
  assert.equal(new Set(x.candidates.map(f=>f.theme)).size,3);
  assert.ok(x.skipped.some(f=>f.reason==='same-theme-lower-ranked'));
  assert.deepEqual(x,candidates(report));
  for(const f of x.candidates){
    const b=renderResearchBrief(f);
    assert.equal(b.status,'research-brief-not-publishable');
    assert.ok(b.required_limits.includes('not a causal'));
    assert.ok(b.source.includes('CC BY 4.0'));
    assert.ok(b.observations.every(s=>s.includes('P1P')));
  }
});
test('skip when selected fixed stages lack coverage; no cherry-picked substitute',()=>{
  const report=fixture(),entry=report.results[0],row=entry.rows.find(x=>x.pick===1);
  row.known_drafts=50;row.coverage=.1;row.qualifying_drafts=50;row.qualified=false;delete row.metrics;
  const x=candidates(report);
  assert.ok(x.skipped.some(s=>s.id==='early-fixing'&&s.reason==='predefined-comparison-lacks-coverage'));
  assert.equal(candidates(report,{excludedIds:Object.keys(defs)}).status,'skip-week');
});
test('reject corrupted counts, provenance, duplicate stages and suppressed metrics',()=>{
  for(const change of [
    x=>x.results[0].rows[0].metrics[0].numerator++,
    x=>x.results[0].rows[0].metrics[0].percent=99,
    x=>x.source_sha256.draft='fake',
    x=>x.results[0].rows[1].pick=1,
    x=>{const row=x.results[0].rows[0];row.known_drafts=50;row.coverage=.1;row.qualifying_drafts=50;row.qualified=false;},
    x=>x.cohort.complete_trajectories=700,
    x=>x.results[0].rows[0].metrics[0].label='different'
  ]){const x=fixture();change(x);assert.throws(()=>candidates(x),/lab-editorial-/);}
});
test('small descriptive effect and repeat coverage are suppressed',()=>{
  const report=fixture();
  for(const entry of report.results.filter(x=>x.id!=='first-pick-abandon')){
    const first=entry.rows[0].metrics;
    for(const row of entry.rows)row.metrics=structuredClone(first);
  }
  const out=candidates(report,{excludedIds:['first-pick-abandon']});
  assert.equal(out.status,'skip-week');
  assert.equal(out.candidates.length,0);
  assert.equal(out.skipped.filter(x=>x.reason==='small-descriptive-signal').length,4);
});

test('all qualified archive findings can feed the weekly pool without losing later topics',()=>{
  const report=fixture();
  const all=candidates(report,{allCandidates:true});
  assert.equal(all.candidates.length,5);
  const packets=archivePackets(report);
  assert.equal(packets.length,5);
  const p=packets.find(x=>x.id==='color-pivot');
  assert.deepEqual(p.metrics.map(x=>x.label),[
    'P1P3 — same-color spell','P1P3 — new-color spell','P1P3 — other card',
    'P1P6 — same-color spell','P1P6 — new-color spell','P1P6 — other card']);
  assert.ok(p.limitations[0].includes('not a causal'));
  assert.equal(p.provenance.hashes.draft,pins.draft);
  const eligible=selectPackets(packets,[],{state:'researching',attempted_ids:[]});
  assert.equal(eligible.length,3);
  assert.equal(new Set(eligible.map(x=>x.theme)).size,3);
  const original={...p,reference:'Frozen original evidence'};
  assert.deepEqual(selectPackets([],[],{state:'revision_requested',candidate_id:p.id,candidate_evidence:original}),[original]);
  const article=assembleArticle(p,{
    title:'When is it time to try a new color?',
    lead:'Imagine opening with several black cards. A blue spell and a black creature arrive together. The immediate choice is between familiar mana requirements and an option for later picks. A new color might open a different lane without requiring an immediate commitment.',
    sections:[{heading:'A new card is not a new deck',text:'A player may be willing to take an off-color card without planning to abandon the original color. This observation is conditional on the pack actually containing both options. The quality of those cards matters and can change from pack to pack. When considering a new color, ask whether the spell is valuable enough to be worth the uncertainty and whether the black card fills a role that might be difficult to find again.'}],
    closing:''});
  assert.ok(article.body.includes('qualified trophy drafts with complete early-pick histories'));
  assert.ok(article.body.includes('P1P3 — new-color spell: 30.0% (60 of 200)'));
  assert.ok(article.body.includes('P1P6 — new-color spell: 60.0% (120 of 200)'));
  assert.equal(article.provenance.source_hashes.draft,pins.draft);
});

test('cache only stores validated evidence, retries are claimed, and corrupt cache fails closed',async()=>{
  const report=fixture();
  let row=null,builds=0;
  const query=async(sql,params)=>{
    if(sql.startsWith('SELECT'))return {rows:row?[row]:[]};
    if(sql.startsWith('INSERT')){row={state:'preparing',report:null,report_hash:null};return {rows:[{source_key:SOURCE_KEY}]};}
    if(sql.includes("state='ready'")){row={state:'ready',report:JSON.parse(params[1]),report_hash:params[2]};return {rows:[{source_key:SOURCE_KEY}]};}
    if(sql.includes("state='failed'")){row={state:'failed',report:null,report_hash:null};return {rows:[]};}
    throw Error('unexpected SQL');
  };
  const build=async()=>{builds++;return report;};
  assert.equal((await cachedArchivePackets(query,{build})).status,'not_prepared');
  assert.equal(builds,0);
  assert.equal((await cachedArchivePackets(query,{prepare:true,build})).packets.length,5);
  assert.equal((await cachedArchivePackets(query,{prepare:true,build})).status,'ready');
  assert.equal(builds,1);
  row.report_hash='0'.repeat(64);
  await assert.rejects(cachedArchivePackets(query,{prepare:true,build}),/lab-archive-cache-hash/);
  row=null;
  const broken=fixture();broken.results[0].rows[0].metrics[0].numerator++;
  assert.equal((await cachedArchivePackets(query,{prepare:true,build:async()=>broken})).status,'failed');
  assert.equal(row.report,null);
});

test('archive subprocess gets only minimal environment and private output is removed',async()=>{
  const report=fixture();let output;
  const prior=process.env.PACK1_LAB_AI_KEY;
  process.env.PACK1_LAB_AI_KEY='synthetic-secret-never-forward';
  try{
    const result=await prepareReport({run:async(command,args,options)=>{
      assert.equal(command,'python3');
      assert.ok(!Object.hasOwn(options.env,'PACK1_LAB_AI_KEY'));
      assert.ok(!Object.hasOwn(options.env,'PACK1_LAB_DATABASE_URL'));
      output=args.at(-1);
      await writeFile(output,JSON.stringify(report),{mode:0o600});
    }});
    assert.deepEqual(result,report);
    await assert.rejects(access(output),{code:'ENOENT'});
  }finally{
    if(prior===undefined)delete process.env.PACK1_LAB_AI_KEY;else process.env.PACK1_LAB_AI_KEY=prior;
  }
});
