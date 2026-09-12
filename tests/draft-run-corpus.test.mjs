import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {validateDraftRunPuzzle,interestingDraftRunPuzzle,gradeDraftRunPick,selectDraftRun,selectDraftRunReroll,eligiblePickForRound,publicDraftRunPuzzle,summarizeDraftRun,poolForEnvironment} from '../draft-run.mjs';

const catalog=JSON.parse(fs.readFileSync(new URL('../corpus/draft-run/catalog.json',import.meta.url)));
const all=catalog.sets.flatMap(s=>{
  const evidence=fs.readFileSync(new URL(`../corpus/draft-run/evidence/${s.id}.json.gz`,import.meta.url));
  assert.equal(createHash('sha256').update(evidence).digest('hex'),s.evidence_sha256);
  const bytes=fs.readFileSync(new URL(`../corpus/draft-run/${s.id}.json.gz`,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),s.sha256);
  return JSON.parse(gunzipSync(bytes));
});
const pool=all.filter(interestingDraftRunPuzzle);
const registry=JSON.parse(fs.readFileSync(new URL('../data/catalog.json',import.meta.url)));


test('every playable decision has trophy, skill, complete history and valid scoring evidence',()=>{
  assert.ok(all.length>=5000);
  for(const p of all){assert.ok(validateDraftRunPuzzle(p),p.puzzle_id);assert.equal(gradeDraftRunPick(p,p.historical_pick_id).score,100);for(const c of [...p.candidates,...p.prior_picks])assert.match(c.image_url,/^https:\/\//,c.name);}
  for(const patch of [{event_match_wins:6},{player_games_lower_bound:99},{player_win_rate_bucket:.55},{prior_picks:[{id:'extra',name:'Extra'}]},{historical_pick_id:'missing'}]) assert.equal(validateDraftRunPuzzle({...all.find(p=>p.pick_number===1),...patch}),false);
});
test('unanswered payloads contain neither the answer nor model rankings, support, or source identity',()=>{
  const p=all.find(p=>p.pick_number===2);const visible=publicDraftRunPuzzle(p);
  assert.equal(visible.prior_picks.length,1);
  assert.doesNotMatch(JSON.stringify(visible),/model_probability|historical_pick|source_draft|consensus|win_rate/);
  assert.deepEqual(Object.keys(visible).sort(),['candidates','difficulty','pick_number','prior_picks','puzzle_id','set_id']);
});
test('seeded runs and preserved legacy rerolls obey early picks, buckets and source exclusions',()=>{
  for(let i=0;i<40;i++){
    const seed='corpus-check-'+i,run=selectDraftRun(pool,seed);
    assert.deepEqual(selectDraftRun(pool,seed),run);
    assert.equal(run.length,10);assert.equal(new Set(run.map(p=>p.source_draft_hash)).size,10);
    assert.equal(new Set(run.map(p=>p.set_id)).size,10);
    assert.equal(run[0].pick_number,1);assert.equal(run[1].pick_number,2);
    run.forEach((source,round)=>{
      assert.ok(eligiblePickForRound(round,source.pick_number));
      for(const order of [['set','pack'],['pack','set']]){
        let current=source,seen=run.map(p=>p.source_draft_hash);
        for(const type of order){const p=selectDraftRunReroll(pool,current,{type,round,seed,excludedSources:seen,difficultyVersion:'legacy'});assert.ok(p);assert.ok(eligiblePickForRound(round,p.pick_number));assert.ok(!seen.includes(p.source_draft_hash));assert.equal(p.set_id===current.set_id,type==='pack');seen.push(p.source_draft_hash);current=p;}
      }
    });
  }
});
test('score calibration separates uninformed choices, weak choices and strong alternatives across complete runs',()=>{
  let random=0,worst=0,second=0,n=0;
  for(let i=0;i<120;i++)for(const p of selectDraftRun(pool,'score-audit-'+i)){
    const ranked=[...p.candidates].sort((a,b)=>b.model_probability-a.model_probability);
    const score=c=>gradeDraftRunPick(p,c.id).score;
    random+=ranked.reduce((s,c)=>s+score(c),0)/ranked.length;
    worst+=score(ranked.at(-1));second+=score(ranked[1]);n++;
  }
  assert.ok(random/n<45,`Random picks average ${random/n}`);
  assert.ok(worst/n<20,`Worst picks average ${worst/n}`);
  assert.ok(second/n>65&&second/n<85,`Runner-up choices average ${second/n}`);
  assert.ok(second/n-random/n>25);
});
test('missing scoring evidence and incomplete runs fail closed',()=>{
  const p=all[0];assert.throws(()=>gradeDraftRunPick({...p,historical_pick_id:'missing'},p.candidates[0].id));
  assert.throws(()=>gradeDraftRunPick({...p,candidates:p.candidates.map(c=>({...c,model_probability:0}))},p.candidates[0].id));
  assert.throws(()=>summarizeDraftRun([p],[p.historical_pick_id]));
});


test('trophy coverage matches every loaded environment and preserves true opening availability',()=>{
  assert.deepEqual(catalog.sets.map(s=>s.id).sort(),registry.sets.map(s=>s.id).sort());
  for(const set of catalog.sets){
    const rows=pool.filter(p=>p.set_id===set.id),environment=set.id==='powered-cube'?set.id:'mixed';
    assert.ok(new Set(rows.map(p=>p.source_draft_hash)).size>=12,set.id);
    for(let round=0;round<10;round++){
      const choices=rows.filter(p=>eligiblePickForRound(round,p.pick_number,environment));
      if(round===0 && set.first_pick===2 && environment==='mixed') {assert.equal(choices.length,0);continue;}
      assert.ok(choices.length>=12,`${set.id} round ${round+1}`);
      const source=choices[0];
      const replacement=selectDraftRunReroll(pool,source,{type:'pack',round,seed:'all-sets',environment});
      assert.ok(replacement,`${set.id} needs a same-set reroll at round ${round+1}`);
      assert.equal(replacement.set_id,set.id);
    }
  }
  assert.ok(poolForEnvironment(pool).every(p=>p.set_id!=='powered-cube'));
});

test('Cube has ten independent trophy decisions and two sequential pack replacements without expansion leakage',()=>{
  for(let i=0;i<30;i++){
    const seed='cube-'+i,environment='powered-cube',run=selectDraftRun(pool,seed,environment);
    assert.equal(run.length,10);assert.equal(new Set(run.map(p=>p.source_draft_hash)).size,10);
    assert.equal(run[0].pick_number,2);assert.equal(run[1].pick_number,3);
    for(let round=0;round<10;round++){
      let current=run[round],seen=run.map(p=>p.source_draft_hash);
      assert.equal(current.set_id,environment);assert.ok(eligiblePickForRound(round,current.pick_number,environment));
      for(let reroll=0;reroll<2;reroll++){
        const replacement=selectDraftRunReroll(pool,current,{type:'pack',round,seed,environment,excludedSources:seen});
        assert.ok(replacement);assert.equal(replacement.set_id,environment);assert.ok(!seen.includes(replacement.source_draft_hash));
        seen.push(replacement.source_draft_hash);current=replacement;
      }
    }
    assert.throws(()=>selectDraftRunReroll(pool,run[0],{type:'set',round:0,seed,environment}),/stay within Powered Cube/);
  }
});
