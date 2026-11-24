import test from 'node:test';
import assert from 'node:assert/strict';
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
