import test from 'node:test';
import assert from 'node:assert/strict';
import {selectDatabaseRun,currentPracticeBatchPlan,selectDatabaseReroll,customPracticeFromSnapshot} from '../worker/draft-run-selection.mjs';
import {DRAFT_RUN_PICK_WINDOWS,P1P2_OPENING_PICK_WINDOWS,eligiblePickForRound,runPickWindows} from '../draft-run.mjs';
import {DRAFT_RUN_SELECTION_VERSION} from '../draft-run-policy.mjs';
import {DRAFT_RUN_DIFFICULTY_VERSION} from '../draft-run-difficulty.mjs';

// Synthetic serving snapshot. "opener" archives start at P1P1; "late" archives
// begin at P1P2, as some public 17Lands archives do. "thin" has a P1P1 below
// the custom coverage standard. Every other pick/band has 20 distinct sources.
const day='2026-10-21',bands=['easy','medium','hard'];
const kinds={opener:1,second:1,late:2,later:2,thin:1};
const inventory=Object.entries(kinds).flatMap(([set_id,first])=>Array.from({length:60},(_,s)=>
  // The thin archive keeps P1P1 rows, but only 15 distinct sources per band.
  Array.from({length:11-first},(_,i)=>i+first).filter(pick=>set_id!=='thin'||pick>1||s<30).map(pick_number=>({
    puzzle_id:`${set_id}-${String(s).padStart(2,'0')}-${String(pick_number).padStart(2,'0')}`,set_id,
    source_draft_hash:`${set_id}-source-${s}`,pick_number,band:set_id==='thin'&&pick_number===1?bands[s%2+1]:bands[(s+pick_number)%3],
  }))).flat());
const groups=[];
for(const p of inventory) {
  let g=groups.find(g=>g.set_id===p.set_id&&g.pick_number===p.pick_number&&g.band===p.band);
  if(!g)groups.push(g={set_id:p.set_id,pick_number:p.pick_number,band:p.band,n:0,sources:new Set()});
  g.n++;g.sources.add(p.source_draft_hash);
}
const snapshot={id:'7',revision:'7',
  metadata:Object.keys(kinds).map((set_id,i)=>({set_id,status:'Live',regular_run:true,release_date:`2026-0${i+1}-01`,set_name:set_id})),
  groups:groups.map(g=>({...g,sources:g.sources.size}))};
const row=p=>({...p,corpus_version:'v',pack_number:'1',candidate_count:'12',consensus_top_gap:'0.1',support_entropy:'0.5',
  difficulty_version:'support-ratio-v1',rating:p.band==='easy'?'40':p.band==='medium'?'60':'90',top_two_ratio:'0.5',target_support_ratio:'0.5'});
const pgArray=value=>value==='{}'?[]:value.slice(2,-2).split('","');

// Answers the snapshot-path round query exactly as SQL would: C-ordered offset
// within the round's set/band/window, then that source's whole trajectory.
async function query(sql,params) {
  assert.match(sql,/FROM draft_run_serving_inventory/);
  const [,,start,end,sources,setId,band,offset]=params,used=new Set(pgArray(sources));
  const chosen=inventory.filter(p=>p.pick_number>=start&&p.pick_number<=end&&!used.has(p.source_draft_hash)&&p.set_id===setId&&p.band===band)
    .sort((a,b)=>a.puzzle_id<b.puzzle_id?-1:a.puzzle_id>b.puzzle_id?1:0)[Number(offset)];
  return {rows:chosen?inventory.filter(p=>p.source_draft_hash===chosen.source_draft_hash).map(p=>({...row(p),selected_id:chosen.puzzle_id})):[]};
}
const run=(seed,setIds)=>selectDatabaseRun(query,'v',seed,'mixed',{day,setIds,snapshot});
const seeds=Array.from({length:30},(_,i)=>'custom-opening-'+i);
const checkRun=(selected,setIds,expectedPicks)=>{
  assert.equal(selected.length,8);
  assert.deepEqual(selected.map(p=>p.pick_number),expectedPicks);
  assert.equal(new Set(selected.map(p=>p.source_draft_hash)).size,8,'no source draft repeats, even with two P1P2 rounds');
  assert.ok(selected.every(p=>setIds.includes(p.set_id)));
  const counts=setIds.map(id=>selected.filter(p=>p.set_id===id).length);
  assert.ok(Math.max(...counts)-Math.min(...counts)<=1,'selected sets stay balanced');
};

test('coverage offers archives without P1P1 and records which sets can open',()=>{
  const {sets,coverage}=customPracticeFromSnapshot(snapshot,day);
  assert.deepEqual(sets.map(s=>s.set_id).sort(),Object.keys(kinds).sort());
  assert.deepEqual(Object.keys(kinds).filter(coverage.opensAtP1P1),['opener','second']);
  assert.deepEqual(runPickWindows('mixed',DRAFT_RUN_SELECTION_VERSION,2),P1P2_OPENING_PICK_WINDOWS);
  assert.deepEqual(P1P2_OPENING_PICK_WINDOWS.map(w=>w[0]),[2,2,3,4,5,6,7,8]);
  // Cube, Daily and historical windows ignore a custom opening.
  assert.deepEqual(runPickWindows('powered-cube',DRAFT_RUN_SELECTION_VERSION,2),runPickWindows('powered-cube'));
  assert.deepEqual(runPickWindows('mixed','eight-pick-v3',2),runPickWindows('mixed','eight-pick-v3'));
});

test('a single set without P1P1 asks P1P2 twice from different drafts, then P1P3-P1P8',async()=>{
  for(const seed of seeds)checkRun(await run(seed,['late']),['late'],[2,2,3,4,5,6,7,8]);
});

test('sets that all lack P1P1 open with two P1P2 decisions',async()=>{
  for(const seed of seeds)checkRun(await run(seed,['late','later']),['late','later'],[2,2,3,4,5,6,7,8]);
  // A P1P1 below the coverage standard is treated as absent, never asked.
  for(const seed of seeds)checkRun(await run(seed,['late','thin']),['late','thin'],[2,2,3,4,5,6,7,8]);
});

test('a mixed selection opens at P1P1 from a covered set; the others join afterward',async()=>{
  const seen=new Set();
  for(const setIds of [['late','opener'],['opener','late','later'],['thin','second'],['thin','late','opener']])for(const seed of seeds) {
    const selected=await run(seed,setIds);
    checkRun(selected,setIds,[1,2,3,4,5,6,7,8]);
    assert.ok(['opener','second'].includes(selected[0].set_id),'only a set with qualifying P1P1 supplies the opening');
    for(const p of selected.slice(1))seen.add(p.set_id);
  }
  for(const id of ['late','later','thin'])assert.ok(seen.has(id),id+' participates after the opening');
});

test('P1P1-capable selections keep the existing plan and picks',async()=>{
  for(const setIds of [['opener'],['opener','second']])for(const seed of seeds) {
    const {plan}=currentPracticeBatchPlan(snapshot,seed,'mixed',{day,setIds});
    assert.deepEqual(plan.windows,DRAFT_RUN_PICK_WINDOWS);
    assert.equal(plan.groups.length,snapshot.groups.filter(g=>setIds.includes(g.set_id)).length,'no group is withheld');
    checkRun(await run(seed,setIds),setIds,[1,2,3,4,5,6,7,8]);
  }
});

test('batched plans are deterministic and agree with the reference selector',async()=>{
  for(const setIds of [['late'],['late','later'],['late','opener'],['thin','second'],['opener']])for(const seed of seeds) {
    const first=currentPracticeBatchPlan(snapshot,seed,'mixed',{day,setIds});
    assert.deepEqual(currentPracticeBatchPlan(snapshot,seed,'mixed',{day,setIds}),first);
    const selected=await run(seed,setIds);
    assert.deepEqual(await run(seed,setIds),selected,'same seed, same run');
    assert.deepEqual(selected.map(p=>p.set_id),first.plan.forced,'both paths force the same set per round');
    assert.deepEqual(selected.map(p=>[p.pick_number,p.pick_number]),first.plan.windows,'both paths use the same windows');
    // The SQL selector validates plan groups against the snapshot and draws
    // only within them, so a withheld P1P1 group can never be served.
    for(const g of first.plan.groups)assert.ok(snapshot.groups.some(s=>s.set_id===g.set_id&&s.pick_number===g.pick_number&&s.band===g.band&&s.n===g.n));
    if(first.plan.windows[0][0]===1)assert.ok(first.plan.groups.filter(g=>g.pick_number===1).every(g=>['opener','second'].includes(g.set_id)));
  }
});

test('pack rerolls keep a P1P2 opening and never reuse a run source',async()=>{
  for(const seed of seeds.slice(0,10)) {
    const selected=await run(seed,['late']),excludedSources=selected.map(p=>p.source_draft_hash);
    for(const round of [0,1]) {
      const source=selected[round];
      let bounds;
      const reroll=await selectDatabaseReroll(async(sql,params)=>{
        bounds=[params[1],params[2]];
        const used=new Set(pgArray(params[3]));
        return {rows:inventory.filter(p=>p.set_id===source.set_id&&p.pick_number>=params[1]&&p.pick_number<=params[2]&&!used.has(p.source_draft_hash)&&p.band===source.band)
          .map(p=>({...row(p),distance:0})).sort((a,b)=>a.puzzle_id<b.puzzle_id?-1:1).slice(0,20)};
      },'v',source,{type:'pack',round,seed,environment:'mixed',setIds:['late'],excludedSources,
        difficultyVersion:DRAFT_RUN_DIFFICULTY_VERSION,selectionVersion:DRAFT_RUN_SELECTION_VERSION,day});
      assert.deepEqual(bounds,[2,2]);
      assert.ok(reroll,'a P1P2 round can be rerolled');
      assert.equal(reroll.pick_number,2);assert.equal(reroll.set_id,'late');
      assert.ok(!excludedSources.includes(reroll.source_draft_hash));
    }
  }
  // Runs that open at P1P1, non-custom practice and Cube keep their round-one window.
  assert.equal(eligiblePickForRound(0,2,'mixed'),false);
  assert.equal(eligiblePickForRound(0,1,'mixed'),true);
  assert.equal(eligiblePickForRound(0,2,'powered-cube'),true);
});
