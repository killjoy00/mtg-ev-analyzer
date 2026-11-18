import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seededRandom} from '../gameplay.mjs';
import {runDifficultyBands,requiredSetRounds} from '../draft-run-policy.mjs';
import {balancedSetPlan} from '../daily-selection.mjs';
import {customPracticeCoverage,customRunShape,currentPracticeBatchPlan} from '../worker/draft-run-selection.mjs';
import {createOrderedDailyScheduleEnsurer} from '../worker/draft-run-daily.mjs';

test('50 custom practice seeds can assign a set with Medium and Hard but no Easy inventory',()=>{
  const groups=Array.from({length:7},(_,i)=>i+2).flatMap(pick_number=>
    ['medium','hard'].map(band=>({set_id:'fixture',pick_number,band,sources:20,n:20})));
  const coverage=customPracticeCoverage(groups);
  assert.equal(coverage.eligible('fixture'),true);
  assert.equal(coverage.opensAtP1P1('fixture'),false);
  const shape=customRunShape(['fixture'],coverage,groups);
  for(let seed=0;seed<50;seed++){
    const random=seededRandom('fixture:'+seed);
    const bands=runDifficultyBands(random);
    const required=balancedSetPlan(['fixture'],random);
    const assignment=requiredSetRounds(shape.groups,bands,shape.windows,random,required);
    assert.equal(assignment.size,8,'seed '+seed+' must reserve every custom-set round');
    assert.ok([...assignment.values()].every(value=>value==='fixture'));
    const {plan}=currentPracticeBatchPlan({groups,metadata:[
      {set_id:'fixture',status:'Live',regular_run:true,release_date:'2041-01-01',set_name:'Fixture'}
    ]},'fixture:'+seed,'mixed',{day:'2041-06-15',setIds:['fixture']});
    assert.equal(plan.forced.length,8);
    assert.deepEqual(plan.forced,Array(8).fill('fixture'),
      'the production batched planner must generate all eight decisions for seed '+seed);
  }
});

test('custom required-set assignment preserves the available Easy pick across 50 seeds',()=>{
  const groups=Array.from({length:8},(_,i)=>i+1).flatMap(pick_number=>[
    ...['easy','medium','hard'].map(band=>({set_id:'easy-set',pick_number,band,n:20})),
    ...['medium','hard'].map(band=>({set_id:'other-set',pick_number,band,n:20})),
  ]);
  const windows=Array.from({length:8},(_,i)=>[i+1,i+1]);
  for(let seed=0;seed<50;seed++) {
    const random=seededRandom('exact-before-fallback:'+seed);
    const bands=runDifficultyBands(random);
    const required=balancedSetPlan(['easy-set','other-set'],random);
    const assignment=requiredSetRounds(groups,bands,windows,random,required);
    assert.equal(assignment.size,8);
    const easyRound=bands.indexOf('easy');
    assert.ok(easyRound>=0);
    assert.equal(assignment.get(easyRound),'easy-set',
      'an exact Easy assignment exists and must win over a fallback for seed '+seed);
  }
});

test('required-set assignment never falls back from Hard to Medium',()=>{
  const groups=[{set_id:'fixture',pick_number:4,band:'medium',n:20}];
  assert.throws(()=>requiredSetRounds(groups,['hard'],[[4,4]],()=>0,['fixture']),error=>error.status===503);
});

test('Latest always waits for Main Daily publication before selecting',async()=>{
  let publishMain;
  const gate=new Promise(resolve=>{publishMain=resolve;});
  const calls=[],query=async()=>({rows:[]}),day='2041-06-15';
  let mainFinished=false;
  const ensure=createOrderedDailyScheduleEnsurer(async(_query,_day,environment)=>{
    calls.push(environment);
    if(environment==='mixed'){await gate;mainFinished=true;}
    else assert.equal(mainFinished,true,'Latest must read completed Main decisions');
    return {schedule:{puzzle_ids:[environment],scoring_version:'pinned'},created:true};
  });
  const latest=ensure(query,day,'latest');
  const main=ensure(query,day,'mixed');
  await Promise.resolve();
  assert.deepEqual(calls,['mixed']);
  publishMain();
  const [latestResult,mainResult]=await Promise.all([latest,main]);
  assert.deepEqual(calls,['mixed','latest']);
  assert.deepEqual(latestResult.schedule.puzzle_ids,['latest']);
  assert.deepEqual(mainResult.schedule.puzzle_ids,['mixed']);
  assert.equal(mainResult.created,false,'the overlapping Main request coalesces with prepublication');
});

test('an already saved Latest Daily is returned even if Main cannot generate',async()=>{
  const saved={puzzle_ids:['saved-latest'],scoring_version:'pinned'};
  const calls=[];
  const query=async(sql,params)=>{
    assert.match(sql,/FROM draft_run_schedules/);
    calls.push(['lookup',params[1]]);
    return {rows:params[1]==='latest'?[saved]:[]};
  };
  const ensure=createOrderedDailyScheduleEnsurer(async(_query,_day,environment)=>{
    calls.push(['generate',environment]);
    throw Object.assign(new Error('Main requires four Live sets'),{status:503});
  });
  const first=await ensure(query,'2041-06-15','latest');
  assert.deepEqual(first,{schedule:saved,created:false});
  first.schedule.puzzle_ids.push('caller-mutated');
  assert.deepEqual((await ensure(query,'2041-06-15','latest')).schedule,saved,
    'saved schedules must be cloned for each caller');
  assert.deepEqual(calls,[['lookup','latest'],['lookup','latest']],
    'no Main generation should happen when Latest is already saved');
});

test('native answers remain in first-encounter puzzle quality even without a view ping',()=>{
  const source=readFileSync(new URL('../worker/measurement-admin.mjs',import.meta.url),'utf8');
  assert.equal((source.match(/\(observed OR outcome='pick'\) AND NOT is_qa AND first_encounter/g)||[]).length,3,
    'summary, reviews and decision detail must all count unobserved answers');
  assert.match(source,/NOT observed AND outcome IS DISTINCT FROM 'pick' AND NOT is_qa\)::int unobserved_excluded/);
  assert.match(source,/answered_without_view/);
});

test("Home active streak allows yesterday when today's Daily is unfinished",()=>{
  const source=readFileSync(new URL('../worker/draft-run-function.mjs',import.meta.url),'utf8');
  assert.match(source,/EXISTS\(SELECT 1 FROM completed_days WHERE day=\$2::date\)/);
  assert.match(source,/THEN \$2::date ELSE \$2::date-1 END\)-day_offset/);
});

test('resharing a completed friend run creates a score-bound share for that session',()=>{
  const source=readFileSync(new URL('../worker/draft-run-function.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/if\(s\.challenge_id\)\{const original=await share\(s\.challenge_id\)/);
  assert.match(source,/INSERT INTO draft_run_shares\(id,session_id,display_name,score,puzzle_ids\)/);
  assert.match(source,/ON CONFLICT\(session_id\) DO UPDATE/);
});
