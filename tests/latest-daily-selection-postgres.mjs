// Runs ONLY after the disposable local PostgreSQL fixture was created.
// Both Latest Set and Main Daily apply the same per-set stakes rule once
// every serving puzzle of the planned sets is scored, record their own rule,
// and fall back to the existing band draw if their data is incomplete.
import assert from 'node:assert/strict';
import {fixturePool,textTypes} from './support/postgres-fixture.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {DRAFT_RUN_SELECTION_VERSION,runDifficultyBands} from '../draft-run-policy.mjs';
import {dailySetPlan} from '../daily-selection.mjs';
import {seededRandom} from '../gameplay.mjs';
import {loadLiveSetMetadata,selectDatabaseRun} from '../worker/draft-run-selection.mjs';
import {ensureDailySchedule,RECENT_DAILY_DECISIONS,DAILY_REPEAT_WINDOW_DAYS,dailyRepeatExclusion,selectDailyWithoutRepeats} from '../worker/draft-run-daily.mjs';
import {decisionKey} from '../worker/draft-run-selection.mjs';
import {LATEST_DAILY_RULE,MIXED_DAILY_RULE,SELECTION_FEATURE_VERSION,STAKES_RULE,stakesTopPoolSize} from '../puzzle-selection.mjs';
import {scorePuzzleSelection} from '../scripts/score-puzzle-selection.mjs';

const pool=fixturePool();
const query=async(text,values=[])=>pool.query({text,values,types:textTypes});
const array=values=>`{${values.join(',')}}`;
const seed=day=>`daily:latest:${day}:${DRAFT_RUN_CORPUS_VERSION}:${DRAFT_RUN_SELECTION_VERSION}`;
const mixedSeed=day=>`daily:mixed:${day}:${DRAFT_RUN_CORPUS_VERSION}:${DRAFT_RUN_SELECTION_VERSION}`;
// Returns the run and the rule that chose it.
const select=async(environment,day,seedText)=>{
  const report={};
  const run=await selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,seedText,environment,{daily:true,day,report});
  return {run,rule:report.selectionRule};
};
const latest=day=>select('latest',day,seed(day));
const mixed=day=>select('mixed',day,mixedSeed(day));
const DAYS=['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06'];
// The fixture's serving filters, as the selector applies them.
const SERVING=`p.interesting AND r.target_support_ratio>=0.2 AND NOT EXISTS(SELECT 1 FROM draft_run_pick_removal_members m
  JOIN draft_run_pick_removals q USING(decision_key) WHERE m.puzzle_id=p.puzzle_id AND q.removed)`;
let tests=0;
const check=(ok,message)=>{assert.ok(ok,message);tests++;};

try {
  check((await query("SELECT count(*)::int n FROM draft_run_verified_puzzles p LEFT JOIN draft_run_puzzle_selection_features f ON f.puzzle_id=p.puzzle_id AND f.feature_version=$1 WHERE f.puzzle_id IS NULL",[SELECTION_FEATURE_VERSION])).rows[0].n==='0',
    'Every fixture puzzle was scored when it was imported');
  const rescored=await scorePuzzleSelection(query,{log:()=>{}});
  check(rescored.sets.every(r=>r.scored===0&&r.written===0)&&rescored.remaining===0,'A backfill after import finds nothing to score');
  // A full rescore reads every heap chunk once and agrees with import scoring.
  const total=Number((await query('SELECT count(*)::int n FROM draft_run_verified_puzzles')).rows[0].n);
  const full=await scorePuzzleSelection(query,{rescore:true,log:()=>{}});
  check(full.sets.reduce((n,r)=>n+r.scored,0)===total,'A full rescore visits every puzzle exactly once');
  check(full.sets.every(r=>r.written===0),'Backfill scoring equals import scoring, so a rescore writes nothing');

  let contested=0,ruleRounds=0;
  for(const day of DAYS) {
    const {run,rule}=await latest(day);
    check(rule===LATEST_DAILY_RULE&&run.length===8,`${day}: the scored latest set uses the stakes rule`);
    const rows=new Map((await query(`SELECT p.puzzle_id,p.source_draft_hash,p.pick_number,r.band,f.stakes_points,f.credible_count,f.trophy_in_main_deck,f.trophy_is_land
      FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
      JOIN draft_run_puzzle_selection_features f ON f.puzzle_id=p.puzzle_id AND f.feature_version=$2 WHERE p.puzzle_id=ANY($1::text[])`,
      [array(run.map(p=>p.puzzle_id)),SELECTION_FEATURE_VERSION])).rows.map(r=>[r.puzzle_id,r]));
    const used=[];
    for(const [round,choice] of run.entries()) {
      const f=rows.get(choice.puzzle_id),pick=Number(f.pick_number);
      check(pick===round+1,`${day}: round ${round+1} asks P1P${round+1}`);
      check(!(pick>=STAKES_RULE.no_land_answer_from_pick&&f.trophy_is_land==='t'),`${day}: no land answer at P1P${pick}`);
      check(pick<STAKES_RULE.deck_gate_from_pick||f.trophy_in_main_deck==='t',`${day}: the P1P${pick} answer made the main deck`);
      if(f.band!=='easy') {
        contested++;
        check(Number(f.credible_count)>=2&&f.stakes_points!==null,`${day}: P1P${pick} has two credible options and a stakes value`);
        // Recompute the round's ranked pool with the sources already used.
        const ranked=(await query(`SELECT p.puzzle_id FROM draft_run_verified_puzzles p
          JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
          JOIN draft_run_puzzle_selection_features f ON f.puzzle_id=p.puzzle_id AND f.feature_version=$1
          WHERE ${SERVING} AND p.set_id=$2 AND p.pick_number=$3 AND p.source_draft_hash<>ALL($4::text[])
            AND r.band IN ('medium','hard') AND f.credible_count>=2 AND f.stakes_points IS NOT NULL
            AND NOT (p.pick_number>=$5 AND f.trophy_is_land) AND (p.pick_number<$6 OR f.trophy_in_main_deck)
          ORDER BY f.stakes_points DESC,p.puzzle_id COLLATE "C"`,
          [SELECTION_FEATURE_VERSION,choice.set_id,pick,array(used),STAKES_RULE.no_land_answer_from_pick,STAKES_RULE.deck_gate_from_pick])).rows.map(r=>r.puzzle_id);
        const top=ranked.slice(0,stakesTopPoolSize(ranked.length));
        if(top.includes(choice.puzzle_id))ruleRounds++;
      }
      used.push(f.source_draft_hash);
    }
    check(new Set(run.map(p=>p.source_draft_hash)).size===8,`${day}: eight distinct source drafts`);
  }
  const plain=await selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,seed(DAYS[0]),'latest',{daily:true,day:DAYS[0]});
  assert.deepStrictEqual(plain,(await latest(DAYS[0])).run,'The report option does not change the returned run');tests++;
  check(contested>=DAYS.length*5&&ruleRounds===contested,`Every contested round came from its top stakes pool (${ruleRounds}/${contested})`);

  // Main Daily keeps its eight-slot set plan and uses the same stakes rule
  // independently of Latest Set. Turning off its flag restores the band draw.
  const mixedDay=DAYS[0],mixedResult=await mixed(mixedDay);
  check(mixedResult.rule===MIXED_DAILY_RULE&&mixedResult.run.length===8,'Main Daily applies its stakes rule to eight picks');
  const plannedRandom=seededRandom(mixedSeed(mixedDay));
  runDifficultyBands(plannedRandom,DRAFT_RUN_SELECTION_VERSION);
  const metadata=await loadLiveSetMetadata(query,DRAFT_RUN_CORPUS_VERSION);
  const expectedSets=dailySetPlan(metadata,mixedDay,plannedRandom);
  check(JSON.stringify(mixedResult.run.map(p=>p.set_id).sort())===JSON.stringify([...expectedSets].sort()),
    'Main Daily keeps its exact set composition under stakes selection');
  check(new Set(mixedResult.run.map(p=>p.source_draft_hash)).size===8,'Main Daily uses eight distinct trophy sources');

  const disabledReport={};
  const disabledMixed=await selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,mixedSeed(mixedDay),'mixed',
    {daily:true,day:mixedDay,mixedStakesEnabled:false,report:disabledReport});
  check(disabledReport.selectionRule===null&&disabledMixed.length===8,"Main Daily's independent switch restores the band draw");
  const latestWithMixedDisabled=await selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,seed(mixedDay),'latest',
    {daily:true,day:mixedDay,mixedStakesEnabled:false,report:disabledReport});
  check(disabledReport.selectionRule===LATEST_DAILY_RULE&&latestWithMixedDisabled.length===8,
    'Disabling Main Daily stakes does not affect Latest Set');

  const mixedVictim=mixedResult.run.at(-1);
  await query('DELETE FROM draft_run_puzzle_selection_features WHERE puzzle_id=$1',[mixedVictim.puzzle_id]);
  const mixedFallback=await mixed(mixedDay);
  check(mixedFallback.rule===null&&JSON.stringify(mixedFallback.run.map(p=>p.puzzle_id))===JSON.stringify(disabledMixed.map(p=>p.puzzle_id)),
    'One unscored Main Daily set returns the entire Daily to the old selector');
  const mixedRestored=await scorePuzzleSelection(query,{setIds:[mixedVictim.set_id],log:()=>{}});
  check(mixedRestored.remaining===0&&JSON.stringify((await mixed(mixedDay)).run.map(p=>p.puzzle_id))===
    JSON.stringify(mixedResult.run.map(p=>p.puzzle_id)),
    'Backfilling the missing feature restores exactly the same Main Daily');

  // One unscored serving puzzle of the latest set turns the rule off.
  const setId=(await latest(DAYS[0])).run[0].set_id;
  const victim=(await query(`SELECT p.puzzle_id FROM draft_run_verified_puzzles p
    JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
    WHERE ${SERVING} AND p.set_id=$1 AND p.pick_number=8 ORDER BY p.puzzle_id LIMIT 1`,[setId])).rows[0].puzzle_id;
  const ruled=(await latest(DAYS[0])).run.map(p=>p.puzzle_id);
  await query('DELETE FROM draft_run_puzzle_selection_features WHERE puzzle_id=$1',[victim]);
  const fallback=await latest(DAYS[0]);
  check(fallback.rule===null&&fallback.run.length===8,'A partly scored latest set keeps the band draw');
  check(fallback.run.map(p=>p.puzzle_id).join()!==ruled.join(),'The band draw chooses differently from the rule');
  const restored=await scorePuzzleSelection(query,{setIds:[setId],log:()=>{}});
  check(restored.sets[0].written===1&&restored.remaining===0,'The backfill scores the missing puzzle');
  check((await latest(DAYS[0])).run.map(p=>p.puzzle_id).join()===ruled.join(),'Scored again, the rule returns the same Daily');

  // A changed strength table marks rows stale; the backfill rewrites them.
  await query("UPDATE draft_run_puzzle_selection_features SET strength_sha256=repeat('0',64) WHERE puzzle_id=$1",[victim]);
  check((await scorePuzzleSelection(query,{setIds:[setId],log:()=>{}})).sets[0].written===1,'A stale strength table is rescored');

  // The schedule records the rule that chose it, and the rule draws after the
  // Daily repeat window. Earlier suites may have generated today's Dailies, so
  // the expected run uses the same exclusion, read before this schedule exists.
  const day='2026-11-20';
  const recent=(await query(RECENT_DAILY_DECISIONS,[day,DAILY_REPEAT_WINDOW_DAYS.decision-1,DAILY_REPEAT_WINDOW_DAYS.source-1])).rows;
  const exclusion=dailyRepeatExclusion(recent);
  const report={};
  const expected=await selectDailyWithoutRepeats(exclude=>selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,seed(day),'latest',{daily:true,day,exclude,report}),
    exclusion,{environment:'latest',day,warn:()=>{}});
  check(report.selectionRule===LATEST_DAILY_RULE,'The stakes rule still applies with the repeat window');
  check(!expected.some(p=>exclusion.decisions.includes(decisionKey(p))),'The rule never repeats a decision from the repeat window');
  try {
    const {schedule,created}=await ensureDailySchedule(query,day,'latest');
    check(created,'The latest-set Daily schedule is created');
    const stored=(await query("SELECT selection_rule FROM draft_run_schedules WHERE day=$1::date AND environment='latest'",[day])).rows[0];
    check(stored.selection_rule===LATEST_DAILY_RULE,'The schedule records the stakes rule');
    check(JSON.parse(schedule.puzzle_ids).join()===expected.map(p=>p.puzzle_id).join(),'The schedule holds the rule selection');
    // Main Daily's schedule is generated after Latest Set and uses the same
    // cross-environment repeat exclusions, without changing its set mix.
    const mixedRecent=(await query(RECENT_DAILY_DECISIONS,[day,DAILY_REPEAT_WINDOW_DAYS.decision-1,DAILY_REPEAT_WINDOW_DAYS.source-1])).rows;
    const mixedReport={};
    const mixedExpected=await selectDailyWithoutRepeats(exclude=>selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,
      mixedSeed(day),'mixed',{daily:true,day,exclude,report:mixedReport}),
      dailyRepeatExclusion(mixedRecent),{environment:'mixed',day,warn:()=>{}});
    const {schedule:mixedSchedule,created:mixedCreated}=await ensureDailySchedule(query,day,'mixed');
    check(mixedCreated&&mixedReport.selectionRule===MIXED_DAILY_RULE,'Main Daily creates a new stakes schedule');
    check((await query("SELECT selection_rule FROM draft_run_schedules WHERE day=$1::date AND environment='mixed'",[day])).rows[0].selection_rule===MIXED_DAILY_RULE,
      'Main Daily records its own selection rule');
    check(JSON.parse(mixedSchedule.puzzle_ids).join()===mixedExpected.map(p=>p.puzzle_id).join(),
      "Main Daily's scheduled decisions match the deterministic stakes draw");
  } finally {
    await query('DELETE FROM draft_run_schedules WHERE day=$1::date',[day]);
  }
  console.log('PASS: '+tests+' real PostgreSQL Main and Latest Set Daily stakes assertions.');
} finally {
  await pool.end();
}
