import test from 'node:test';
import assert from 'node:assert/strict';
import {DAILY_REPEAT_WINDOW_DAYS,dailyRepeatExclusion,dailyRepeatTiers,selectDailyWithoutRepeats} from '../worker/draft-run-daily.mjs';
import {selectDatabaseRun} from '../worker/draft-run-selection.mjs';

test('Daily repeat windows are two weeks for decisions and one week for source drafts',()=>{
  assert.deepEqual({...DAILY_REPEAT_WINDOW_DAYS},{decision:14,source:7});
});

test('recent schedule rows become decision keys and recent source drafts',()=>{
  const exclusion=dailyRepeatExclusion([
    {source_draft_hash:'b',pick_number:3,recent_source:false},
    {source_draft_hash:'a',pick_number:'5',recent_source:'t'},
    {source_draft_hash:'a',pick_number:2,recent_source:true},
  ]);
  assert.deepEqual(exclusion,{sources:['a'],decisions:['a:2','a:5','b:3']});
});

test('repeat exclusion relaxes the source window, then the decision window, only on unavailability',async()=>{
  const exclusion={sources:['a'],decisions:['a:1','b:2']},seen=[],warnings=[];
  const unavailable=Object.assign(Error('Not enough verified puzzles for a balanced run.'),{status:503});
  const selected=await selectDailyWithoutRepeats(async exclude=>{
    seen.push(exclude);if(seen.length<3)throw unavailable;return ['run'];
  },exclusion,{environment:'latest',day:'2041-06-20',warn:(...args)=>warnings.push(args)});
  assert.deepEqual(selected,['run']);
  assert.deepEqual(seen,dailyRepeatTiers(exclusion).map(t=>t.exclude));
  assert.deepEqual(seen[1],{sources:[],decisions:['a:1','b:2']});
  assert.equal(seen[2],null);
  assert.match(warnings[0][1],/"tier":"none"/);

  const fatal=Object.assign(Error('broken'),{status:500});let calls=0;
  await assert.rejects(selectDailyWithoutRepeats(async()=>{calls++;throw fatal;},exclusion,{warn:()=>{}}),fatal);
  assert.equal(calls,1,'a non-availability error is never retried with weaker exclusions');
  await assert.rejects(selectDailyWithoutRepeats(async()=>{throw unavailable;},exclusion,{warn:()=>{}}),unavailable);

  let first=0;
  await selectDailyWithoutRepeats(async exclude=>{first++;assert.equal(exclude,exclusion);return [];},exclusion,{warn:()=>assert.fail('no warning without relaxation')});
  assert.equal(first,1);
});

// A fake adapter that answers the selector's three query shapes for Cube.
function cubeQuery(log,{groupN=4}={}) {
  return async(sql,params)=>{
    log.push({sql,params});
    if(sql.includes('GROUP BY p.set_id,p.pick_number,r.band'))
      return {rows:Array.from({length:8},(_,i)=>i+2).flatMap(pick=>['easy','medium','hard'].map(band=>({set_id:'powered-cube',pick_number:pick,band,n:groupN})))};
    if(!sql.includes('WITH chosen AS'))
      return {rows:[{set_id:'powered-cube',release_date:'2020-01-01',status:'Live',regular_run:false,set_name:'Powered Cube'}]};
    const pick=Number(params[1]),band=params.at(-2),id=`p${pick}`;
    return {rows:[
      {puzzle_id:id,selected_id:id,set_id:'powered-cube',source_draft_hash:'s'+pick,pick_number:pick,pack_number:1,candidate_count:9,consensus_top_gap:'0.1',support_entropy:'0.5',difficulty_version:'support-ratio-v1',rating:'1',top_two_ratio:'1',target_support_ratio:null,band},
      // A sibling decision from the same source that the exclusion already removed.
      {puzzle_id:id+'x',selected_id:id,set_id:'powered-cube',source_draft_hash:'s'+pick,pick_number:pick+1,pack_number:1,candidate_count:9,consensus_top_gap:'0.1',support_entropy:'0.5',difficulty_version:'support-ratio-v1',rating:'1',top_two_ratio:'1',target_support_ratio:null,band},
    ]};
  };
}

test('repeat exclusion is applied to the group counts and to every round query',async()=>{
  const log=[];
  const run=await selectDatabaseRun(cubeQuery(log),'v','seed','powered-cube',{exclude:{sources:['old-source'],decisions:['s2:3','gone:4']}});
  assert.equal(run.length,8);
  const counted=log.filter(q=>q.sql.includes('GROUP BY p.set_id,p.pick_number,r.band')),rounds=log.filter(q=>q.sql.includes('WITH chosen AS'));
  assert.equal(counted.length,1);assert.equal(rounds.length,8);
  for(const q of [...counted,...rounds]) {
    assert.match(q.sql,/p\.source_draft_hash<>ALL\(\$\d+::text\[\]\) AND \(p\.source_draft_hash\|\|':'\|\|p\.pick_number\)<>ALL\(\$\d+::text\[\]\)/);
    assert.ok(q.params.includes('{"old-source"}'));
    assert.ok(q.params.includes('{"s2:3","gone:4"}'));
  }
});

test('selection without exclusion issues the same queries as before',async()=>{
  const log=[];
  await selectDatabaseRun(cubeQuery(log),'v','seed','powered-cube');
  assert.ok(log.every(q=>!q.sql.includes("||':'||")));
  await assert.rejects(selectDatabaseRun(cubeQuery([]),'v','seed','powered-cube',{snapshot:{groups:[],metadata:[]},exclude:{sources:['a'],decisions:[]}}),/requires live selection/);
});
