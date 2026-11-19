// Runs ONLY after the disposable local PostgreSQL fixture was created.
// Both Latest Set and Main Daily apply the same per-set stakes rule once
// every serving puzzle of the planned sets is scored, record their own rule,
// and fall back to the existing band draw if their data is incomplete. Easy
// rounds additionally apply the clear-Easy rule, with its own switch and
// fallback to the previous uniform easy draw.
import assert from 'node:assert/strict';
import {fixturePool,textTypes} from './support/postgres-fixture.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {DRAFT_RUN_SELECTION_VERSION,runDifficultyBands} from '../draft-run-policy.mjs';
import {dailySetPlan} from '../daily-selection.mjs';
import {seededRandom} from '../gameplay.mjs';
import {loadLiveSetMetadata,selectDatabaseRun,RECENT_EASY_ANSWERS,easyAnswerKey} from '../worker/draft-run-selection.mjs';
import {ensureDailySchedule,RECENT_DAILY_DECISIONS,DAILY_REPEAT_WINDOW_DAYS,dailyRepeatExclusion,selectDailyWithoutRepeats} from '../worker/draft-run-daily.mjs';
import {decisionKey} from '../worker/draft-run-selection.mjs';
import {LATEST_DAILY_RULE,MIXED_DAILY_RULE,LATEST_DAILY_CLEAR_EASY_RULE,MIXED_DAILY_CLEAR_EASY_RULE,SELECTION_FEATURE_VERSION,STAKES_RULE,EASY_RULE,isClearEasy,stakesTopPoolSize} from '../puzzle-selection.mjs';
import {scorePuzzleSelection} from '../scripts/score-puzzle-selection.mjs';
import {loadForwardCheck,forwardCheckOutcome} from '../scripts/easy-forward-check.mjs';

const pool=fixturePool();
const query=async(text,values=[])=>pool.query({text,values,types:textTypes});
const array=values=>`{${values.join(',')}}`;
const seed=day=>`daily:latest:${day}:${DRAFT_RUN_CORPUS_VERSION}:${DRAFT_RUN_SELECTION_VERSION}`;
const mixedSeed=day=>`daily:mixed:${day}:${DRAFT_RUN_CORPUS_VERSION}:${DRAFT_RUN_SELECTION_VERSION}`;
// Returns the run and the rule that chose it.
const select=async(environment,day,seedText,options={},run=query)=>{
  const report={};
  const selected=await selectDatabaseRun(run,DRAFT_RUN_CORPUS_VERSION,seedText,environment,{daily:true,day,report,...options});
  return {run:selected,rule:report.selectionRule};
};
const latest=(day,options,run)=>select('latest',day,seed(day),options,run);
const ids=run=>run.map(p=>p.puzzle_id).join();
const mixed=day=>select('mixed',day,mixedSeed(day));
const DAYS=['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06'];
// The fixture's serving filters, as the selector applies them.
const SERVING=`p.interesting AND r.target_support_ratio>=0.2 AND NOT EXISTS(SELECT 1 FROM draft_run_pick_removal_members m
  JOIN draft_run_pick_removals q USING(decision_key) WHERE m.puzzle_id=p.puzzle_id AND q.removed)`;
let tests=0;
const check=(ok,message)=>{assert.ok(ok,message);tests++;};
// One Easy round's pools as the selector builds them: `clear` is every
// clear-Easy decision still available, `fresh` those whose answer card was not
// an Easy answer of a recent Daily. used: sources taken earlier in the run;
// exclusion: the Daily repeat windows, when the run was selected with them.
const recentAnswers=async day=>(await query(RECENT_EASY_ANSWERS,[day,EASY_RULE.answer_repeat_days-1,SELECTION_FEATURE_VERSION])).rows.map(easyAnswerKey);
async function easyPools({setId,pick,used,day,exclusion={sources:[],decisions:[]}}) {
  const recent=new Set(await recentAnswers(day));
  const rows=(await query(`SELECT p.puzzle_id,p.set_id,f.trophy_card_id FROM draft_run_verified_puzzles p
    JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
    JOIN draft_run_puzzle_selection_features f ON f.puzzle_id=p.puzzle_id AND f.feature_version=$1
    WHERE ${SERVING} AND p.set_id=$2 AND p.pick_number=$3 AND p.source_draft_hash<>ALL($4::text[])
      AND (p.source_draft_hash||':'||p.pick_number)<>ALL($10::text[])
      AND r.band='easy' AND r.target_support_ratio>=$7::float8 AND f.trophy_strength_margin>=$8::real
      AND (p.pick_number<$9 OR f.trophy_off_colour IS FALSE)
      AND NOT (p.pick_number>=$5 AND f.trophy_is_land) AND (p.pick_number<$6 OR f.trophy_in_main_deck)`,
    [SELECTION_FEATURE_VERSION,setId,pick,array([...used,...exclusion.sources]),STAKES_RULE.no_land_answer_from_pick,STAKES_RULE.deck_gate_from_pick,
      EASY_RULE.min_trophy_support_ratio,EASY_RULE.min_strength_margin,EASY_RULE.colour_fit_from_pick,array(exclusion.decisions)])).rows;
  return {clear:rows.map(r=>r.puzzle_id),fresh:rows.filter(r=>!recent.has(easyAnswerKey(r))).map(r=>r.puzzle_id),recent};
}

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

  let contested=0,ruleRounds=0,easyRounds=0,clearRounds=0;
  for(const day of DAYS) {
    const {run,rule}=await latest(day);
    check(rule===LATEST_DAILY_CLEAR_EASY_RULE&&run.length===8,`${day}: the scored latest set uses the stakes and clear-Easy rules`);
    const rows=new Map((await query(`SELECT p.puzzle_id,p.source_draft_hash,p.pick_number,r.band,r.target_support_ratio,f.stakes_points,f.credible_count,f.trophy_in_main_deck,f.trophy_is_land,
        f.trophy_strength_margin,f.trophy_off_colour
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
      } else {
        easyRounds++;
        // Recompute the round's clear-Easy pool with the sources already used.
        const {clear,fresh}=await easyPools({setId:choice.set_id,pick,used,day});
        const features={pick_number:pick,target_support_ratio:f.target_support_ratio,
          trophy_strength_margin:f.trophy_strength_margin,trophy_off_colour:f.trophy_off_colour===null?null:f.trophy_off_colour==='t'};
        if(clear.length) {
          clearRounds++;
          check((fresh.length?fresh:clear).includes(choice.puzzle_id)&&isClearEasy(features),`${day}: the Easy P1P${pick} is a clear-Easy decision`);
        } else check(!isClearEasy(features),`${day}: without a clear-Easy decision P1P${pick} uses the uniform easy draw`);
      }
      used.push(f.source_draft_hash);
    }
    check(new Set(run.map(p=>p.source_draft_hash)).size===8,`${day}: eight distinct source drafts`);
  }
  const plain=await selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,seed(DAYS[0]),'latest',{daily:true,day:DAYS[0]});
  assert.deepStrictEqual(plain,(await latest(DAYS[0])).run,'The report option does not change the returned run');tests++;
  check(contested>=DAYS.length*5&&ruleRounds===contested,`Every contested round came from its top stakes pool (${ruleRounds}/${contested})`);
  check(easyRounds>=1&&clearRounds>=1,`Easy rounds drew from the clear-Easy pool (${clearRounds}/${easyRounds})`);

  // The clear-Easy switch, a row scored before its columns existed, and a
  // database without those columns all keep the stakes rule and return Easy
  // rounds to the uniform draw: the same Daily in each case.
  const switched=await latest(DAYS[0],{clearEasyEnabled:false});
  check(switched.rule===LATEST_DAILY_RULE&&switched.run.length===8,'The clear-Easy switch keeps the stakes rule and restores the uniform Easy draw');
  const legacyQuery=async(text,values)=>{
    if(text.includes('trophy_off_colour'))throw Object.assign(Error('column f.trophy_off_colour does not exist'),{code:'42703'});
    return query(text,values);
  };
  const legacy=await latest(DAYS[0],{},legacyQuery);
  check(legacy.rule===LATEST_DAILY_RULE&&ids(legacy.run)===ids(switched.run),'A database without the clear-Easy columns keeps the stakes rule');
  const latestSet=switched.run[0].set_id;
  const unscored=(await query(`SELECT p.puzzle_id FROM draft_run_verified_puzzles p
    JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
    WHERE ${SERVING} AND p.set_id=$1 AND p.pick_number=8 ORDER BY p.puzzle_id DESC LIMIT 1`,[latestSet])).rows[0].puzzle_id;
  const clearRun=ids((await latest(DAYS[0])).run);
  await query('UPDATE draft_run_puzzle_selection_features SET trophy_strength_margin=NULL,trophy_off_colour=NULL WHERE puzzle_id=$1',[unscored]);
  const partial=await latest(DAYS[0]);
  check(partial.rule===LATEST_DAILY_RULE&&ids(partial.run)===ids(switched.run),'One row without clear-Easy features returns every Easy round to the uniform draw');
  const refreshed=await scorePuzzleSelection(query,{setIds:[latestSet],log:()=>{}});
  check(refreshed.sets[0].written===1&&refreshed.remaining===0,'The backfill rescores a row that predates the clear-Easy features');
  const again=await latest(DAYS[0]);
  check(again.rule===LATEST_DAILY_CLEAR_EASY_RULE&&ids(again.run)===clearRun,'Scored again, the clear-Easy rule returns the same Daily');

  // Main Daily keeps its eight-slot set plan and uses the same stakes rule
  // independently of Latest Set. Turning off its flag restores the band draw.
  const mixedDay=DAYS[0],mixedResult=await mixed(mixedDay);
  check(mixedResult.rule===MIXED_DAILY_CLEAR_EASY_RULE&&mixedResult.run.length===8,'Main Daily applies its stakes and clear-Easy rules to eight picks');
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
  check(disabledReport.selectionRule===LATEST_DAILY_CLEAR_EASY_RULE&&latestWithMixedDisabled.length===8,
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

  // Main is now published first, even when Latest is requested first from
  // another worker. Both deterministic rule checks use the repeat history
  // visible when their own schedule is created.
  const day='2026-11-20';
  try {
    const mixedRecent=(await query(RECENT_DAILY_DECISIONS,[day,DAILY_REPEAT_WINDOW_DAYS.decision-1,DAILY_REPEAT_WINDOW_DAYS.source-1])).rows;
    const mixedReport={};
    const mixedExpected=await selectDailyWithoutRepeats(exclude=>selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,
      mixedSeed(day),'mixed',{daily:true,day,exclude,report:mixedReport}),
      dailyRepeatExclusion(mixedRecent),{environment:'mixed',day,warn:()=>{}});
    const {schedule:mixedSchedule,created:mixedCreated}=await ensureDailySchedule(query,day,'mixed');
    check(mixedCreated&&mixedReport.selectionRule===MIXED_DAILY_CLEAR_EASY_RULE,'Main Daily creates a new stakes schedule');
    check((await query("SELECT selection_rule FROM draft_run_schedules WHERE day=$1::date AND environment='mixed'",[day])).rows[0].selection_rule===MIXED_DAILY_CLEAR_EASY_RULE,
      'Main Daily records its own selection rule');
    check(JSON.parse(mixedSchedule.puzzle_ids).join()===mixedExpected.map(p=>p.puzzle_id).join(),
      "Main Daily's scheduled decisions match the deterministic stakes draw");

    const recent=(await query(RECENT_DAILY_DECISIONS,[day,DAILY_REPEAT_WINDOW_DAYS.decision-1,DAILY_REPEAT_WINDOW_DAYS.source-1])).rows;
    const exclusion=dailyRepeatExclusion(recent);
    const report={};
    const expected=await selectDailyWithoutRepeats(exclude=>selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,seed(day),'latest',
      {daily:true,day,exclude,report}),
      exclusion,{environment:'latest',day,warn:()=>{}});
    check(report.selectionRule===LATEST_DAILY_CLEAR_EASY_RULE,'Latest uses stakes and clear-Easy after Main has published');
    check(!expected.some(p=>exclusion.decisions.includes(decisionKey(p))),'Latest does not repeat Main decisions');
    const {schedule,created}=await ensureDailySchedule(query,day,'latest');
    check(created,'The latest-set Daily schedule is created');
    const stored=(await query("SELECT selection_rule FROM draft_run_schedules WHERE day=$1::date AND environment='latest'",[day])).rows[0];
    check(stored.selection_rule===LATEST_DAILY_CLEAR_EASY_RULE,'The schedule records the rule that chose it');
    check(JSON.parse(schedule.puzzle_ids).join()===expected.map(p=>p.puzzle_id).join(),'Latest uses the repeat-aware rule selection');

    // The forward check queries real schema and includes both Daily schedules
    // only when the day is over, not while today's picks are still in progress.
    const during=await loadForwardCheck(query,day),after=await loadForwardCheck(query,'2026-11-21');
    check(after.rows.length>during.rows.length&&after.rows.every(row=>Number.isInteger(row.answers)&&Number.isInteger(row.under_50)),
      'The forward check reads Easy puzzles of -v2 schedules and leaves out the unfinished day');
    check(typeof after.ruleActive==='boolean'&&['collecting','not_started'].includes(forwardCheckOutcome(during.rows).status)
      &&forwardCheckOutcome(after.rows).status==='collecting','Without answers the forward check only reports progress');
  } finally {
    await query('DELETE FROM draft_run_schedules WHERE day=$1::date',[day]);
  }

  // Answer-card rotation. Find a latest-set Daily whose Easy round has clear
  // decisions with at least two different answer cards, publish its answer in
  // the previous day's schedule, and select it again: the Easy round must
  // move to another answer card, stay clear, and return once that schedule
  // leaves the window. With every answer recent it stays in the clear pool.
  const cardsOf=async puzzleIds=>new Map((await query(`SELECT p.puzzle_id,p.set_id,p.pick_number,p.source_draft_hash,r.band,f.trophy_card_id
    FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
    JOIN draft_run_puzzle_selection_features f ON f.puzzle_id=p.puzzle_id AND f.feature_version=$2 WHERE p.puzzle_id=ANY($1::text[])`,
    [array(puzzleIds),SELECTION_FEATURE_VERSION])).rows.map(r=>[r.puzzle_id,r]));
  let scenario=null;
  for(let i=1;i<=28&&!scenario;i++) {
    const date=`2026-12-${String(i).padStart(2,'0')}`,{run}=await latest(date),rows=await cardsOf(run.map(p=>p.puzzle_id)),used=[];
    for(const choice of run) {
      const row=rows.get(choice.puzzle_id);
      if(row.band==='easy') {
        const {clear}=await easyPools({setId:row.set_id,pick:Number(row.pick_number),used,day:date});
        const answers=new Set([...(await cardsOf(clear)).values()].map(r=>r.trophy_card_id));
        if(clear.includes(choice.puzzle_id)&&answers.size>=2)scenario={date,run,row,used:[...used],clear,answers};
      }
      used.push(row.source_draft_hash);
    }
  }
  check(scenario,'The fixture has an Easy round with two clear answer cards');
  const previous=new Date(Date.parse(scenario.date)-86400000).toISOString().slice(0,10);
  try {
    check((await ensureDailySchedule(query,previous,'latest')).created,'A schedule exists for the previous day');
    const publish=puzzleIds=>query("UPDATE draft_run_schedules SET puzzle_ids=$2::jsonb WHERE day=$1::date AND environment='latest'",[previous,JSON.stringify(puzzleIds)]);
    await publish(scenario.run.map(p=>p.puzzle_id));
    check((await recentAnswers(scenario.date)).includes(easyAnswerKey(scenario.row)),'The published Easy answer is recent on the next day');
    const rotated=await latest(scenario.date),round=scenario.run.findIndex(p=>p.puzzle_id===scenario.row.puzzle_id);
    const next=(await cardsOf([rotated.run[round].puzzle_id])).get(rotated.run[round].puzzle_id);
    check(rotated.rule===LATEST_DAILY_CLEAR_EASY_RULE&&next.band==='easy'&&scenario.clear.includes(next.puzzle_id),'The rotated Easy round is still a clear-Easy decision');
    check(next.trophy_card_id!==scenario.row.trophy_card_id,'The Easy round avoids yesterday\'s Easy answer card');
    // Publish one clear decision per answer card: nothing fresh remains.
    const clearRows=[...(await cardsOf(scenario.clear)).values()];
    const perCard=[...scenario.answers].map(card=>clearRows.find(r=>r.trophy_card_id===card).puzzle_id);
    const filler=scenario.run.map(p=>p.puzzle_id).filter(id=>!perCard.includes(id));
    await publish([...perCard,...filler].slice(0,8));
    check(perCard.length<=8&&(await easyPools({setId:scenario.row.set_id,pick:Number(scenario.row.pick_number),used:scenario.used,day:scenario.date})).fresh.length===0,
      'Every clear answer card can be made recent');
    const exhausted=await latest(scenario.date);
    check(scenario.clear.includes(exhausted.run[round].puzzle_id),'With every clear answer recent, the Easy round stays in the clear pool');
  } finally {
    await query('DELETE FROM draft_run_schedules WHERE day=$1::date',[previous]);
  }
  check(ids((await latest(scenario.date)).run)===ids(scenario.run),'Outside the window the original Easy answer returns');
  console.log('PASS: '+tests+' real PostgreSQL Main and Latest Set Daily stakes and clear-Easy assertions.');
} finally {
  await pool.end();
}
