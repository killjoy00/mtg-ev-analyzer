import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FORWARD_CHECK,FORWARD_CHECK_SQL,RULE_ACTIVE_SQL,forwardCheckOutcome,forwardCheckNeedsAction,forwardCheckSummary,loadForwardCheck} from '../scripts/easy-forward-check.mjs';

// n puzzles, each with 100 answers and `under` of them under 50.
const puzzles=(n,under,answers=100)=>Array.from({length:n},()=>({answers,under_50:under}));

test('the forward check keeps the thresholds locked in the difficulty review',()=>{
  assert.deepEqual({...FORWARD_CHECK,rules:[...FORWARD_CHECK.rules]},{rules:['latest-stakes-v2','mixed-stakes-v2'],sample:56,min_answers:50,
    baseline_under_50:0.367,confirm_under_50:0.317,stages:2});
  const review=readFileSync('docs/DIFFICULTY-REVIEW-2026-11.md','utf8');
  for(const text of ['first 56 Easy puzzles','36.7%','31.7%','PACK1_DAILY_CLEAR_EASY=off','scripts/easy-forward-check.mjs'])assert.ok(review.includes(text),text);
});

test('before the sample is complete the check only reports progress',()=>{
  const none=forwardCheckOutcome([]);
  assert.equal(none.status,'not_started');assert.equal(none.final,false);assert.equal(forwardCheckNeedsAction(none),false);
  // Puzzles short of 50 answers are scheduled but not yet counted.
  const early=forwardCheckOutcome([...puzzles(55,60),...puzzles(10,9,49)]);
  assert.deepEqual([early.status,early.final,early.stage,early.scheduled,early.counted],['collecting',false,1,65,55]);
  assert.equal(early.mean_under_50,undefined,'no outcome is computed on a partial sample');
  assert.equal(forwardCheckNeedsAction(early),false);
});

test('the first 56 counted puzzles decide: confirmed at 31.7% or lower, reversed above 36.7%',()=>{
  const confirmed=forwardCheckOutcome([...puzzles(56,30),...puzzles(40,90)]);
  assert.deepEqual([confirmed.status,confirmed.final,confirmed.stage,confirmed.puzzles],['confirmed',true,1,56]);
  assert.ok(Math.abs(confirmed.mean_under_50-0.30)<1e-12,'later puzzles do not change a decided first sample');
  assert.equal(forwardCheckOutcome(puzzles(56,31.7)).status,'confirmed','the confirming share itself confirms');
  const reversed=forwardCheckOutcome(puzzles(56,40));
  assert.deepEqual([reversed.status,reversed.final],['reversed',true]);
  assert.match(reversed.message,/PACK1_DAILY_CLEAR_EASY=off/);
  assert.equal(forwardCheckNeedsAction(reversed),true);
  assert.notEqual(forwardCheckOutcome(puzzles(56,36.7)).status,'reversed','the baseline itself is not a reversal');
  // Each puzzle counts once, whatever its answer count.
  const mixed=forwardCheckOutcome([...puzzles(28,10),...puzzles(28,250,500)]);
  assert.ok(Math.abs(mixed.mean_under_50-0.30)<1e-12);
  assert.equal(forwardCheckOutcome([...puzzles(55,10),{answers:100,under_50:60}]).majority_under_50,1);
});

test('an unconfirmed first sample is repeated once on the next 56, then the check ends',()=>{
  const waiting=forwardCheckOutcome([...puzzles(56,34),...puzzles(20,10)]);
  assert.deepEqual([waiting.status,waiting.final,waiting.stage],['unconfirmed',false,2]);
  assert.match(waiting.message,/repeating once: 20 of 56/);
  assert.equal(forwardCheckOutcome([...puzzles(56,34),...puzzles(56,30)]).status,'confirmed');
  assert.equal(forwardCheckOutcome([...puzzles(56,34),...puzzles(56,45)]).status,'reversed');
  const ended=forwardCheckOutcome([...puzzles(56,34),...puzzles(56,35),...puzzles(56,90)]);
  assert.deepEqual([ended.status,ended.final,ended.stage],['unconfirmed',true,2]);
  assert.equal(forwardCheckNeedsAction(ended),false);
});

test('a reversal stops failing the scheduled run once the rule is off',()=>{
  const reversed=forwardCheckOutcome(puzzles(56,40),{ruleActive:false});
  assert.equal(reversed.status,'reversed');assert.equal(forwardCheckNeedsAction(reversed),false);
  assert.match(reversed.message,/no longer choosing Dailies/);
});

test('the summary and the query expose aggregates only',()=>{
  const summary=forwardCheckSummary(forwardCheckOutcome(puzzles(56,40)));
  assert.match(summary,/Clear-Easy forward check/);assert.match(summary,/40\.0%/);assert.match(summary,/36\.7% \/ 31\.7%/);
  // Only counts per scheduled puzzle are selected: no player, account or
  // session column, and not the puzzle id either.
  const tail=FORWARD_CHECK_SQL.slice(FORWARD_CHECK_SQL.lastIndexOf('SELECT')),selected=tail.slice(0,tail.indexOf('\nFROM'));
  assert.match(selected,/answers/);
  assert.doesNotMatch(selected,/person|player|account|session|puzzle_id|display_name/);
  for(const sql of [FORWARD_CHECK_SQL,RULE_ACTIVE_SQL])assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i);
});

test('loading runs two read-only statements and decodes the rows',async()=>{
  const calls=[];
  const query=async(sql,params)=>{
    calls.push({sql,params});
    return sql===FORWARD_CHECK_SQL?{rows:[{day:'2026-12-01',environment:'latest',ord:'3',answers:'120',under_50:'30'}]}:{rows:[{active:'t'}]};
  };
  const loaded=await loadForwardCheck(query,'2026-12-05');
  assert.deepEqual(loaded,{rows:[{day:'2026-12-01',environment:'latest',answers:120,under_50:30}],ruleActive:true});
  assert.equal(calls.length,2);
  assert.deepEqual(calls[0].params,['{"latest-stakes-v2","mixed-stakes-v2"}','2026-12-05'],"today's unfinished Daily is excluded by date");
});

test('the scheduled workflow is read-only, runs reviewed code and needs no input',()=>{
  const workflow=readFileSync('.github/workflows/easy-forward-check.yml','utf8');
  assert.match(workflow,/schedule:\n\s+- cron: '43 10 \* \* 3'/);
  assert.match(workflow,/permissions:\n\s+contents: read\n/);
  assert.doesNotMatch(workflow,/issues: write|contents: write|pull-requests: write|actions: write/);
  assert.match(workflow,/test "\$GITHUB_REF" = refs\/heads\/main/);
  assert.match(workflow,/node scripts\/easy-forward-check\.mjs "\$RUNNER_TEMP\/easy-forward-check\.connection" --summary "\$GITHUB_STEP_SUMMARY"/);
  assert.doesNotMatch(workflow,/inputs\.|score-puzzle-selection|wrangler|PACK1_DAILY_CLEAR_EASY/,'it reports; it never changes data or configuration');
});
