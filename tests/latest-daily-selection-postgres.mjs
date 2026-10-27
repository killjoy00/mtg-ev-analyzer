// Runs ONLY after the disposable local PostgreSQL fixture was created.
// The latest-set Daily applies the stakes rule (puzzle-selection.mjs) once
// every serving puzzle of its set is scored, records the rule on the schedule,
// and falls back to the band draw otherwise. Other environments are unchanged.
import assert from 'node:assert/strict';
import {fixturePool,textTypes} from './support/postgres-fixture.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {DRAFT_RUN_SELECTION_VERSION} from '../draft-run-policy.mjs';
import {selectDatabaseRun} from '../worker/draft-run-selection.mjs';
import {ensureDailySchedule} from '../worker/draft-run-daily.mjs';
import {LATEST_DAILY_RULE,SELECTION_FEATURE_VERSION,STAKES_RULE,stakesTopPoolSize} from '../puzzle-selection.mjs';
import {scorePuzzleSelection} from '../scripts/score-puzzle-selection.mjs';

const pool=fixturePool();
const query=async(text,values=[])=>pool.query({text,values,types:textTypes});
const array=values=>`{${values.join(',')}}`;
const seed=day=>`daily:latest:${day}:${DRAFT_RUN_CORPUS_VERSION}:${DRAFT_RUN_SELECTION_VERSION}`;
const latest=async day=>selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,seed(day),'latest',{daily:true,day});
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
  check(rescored.every(r=>r.scored===0&&r.written===0),'A backfill after import finds nothing to score');

  let contested=0,ruleRounds=0;
  for(const day of DAYS) {
    const run=await latest(day);
    check(run.selectionRule===LATEST_DAILY_RULE&&run.length===8,`${day}: the scored latest set uses the stakes rule`);
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
  check(contested>=DAYS.length*5&&ruleRounds===contested,`Every contested round came from its top stakes pool (${ruleRounds}/${contested})`);

  const mixed=await selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,`daily:mixed:${DAYS[0]}`,'mixed',{daily:true,day:DAYS[0]});
  check(mixed.selectionRule===null,'The mixed Daily keeps the band draw');

  // One unscored serving puzzle of the latest set turns the rule off.
  const setId=(await latest(DAYS[0]))[0].set_id;
  const victim=(await query(`SELECT p.puzzle_id FROM draft_run_verified_puzzles p
    JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
    WHERE ${SERVING} AND p.set_id=$1 AND p.pick_number=8 ORDER BY p.puzzle_id LIMIT 1`,[setId])).rows[0].puzzle_id;
  const ruled=(await latest(DAYS[0])).map(p=>p.puzzle_id);
  await query('DELETE FROM draft_run_puzzle_selection_features WHERE puzzle_id=$1',[victim]);
  const fallback=await latest(DAYS[0]);
  check(fallback.selectionRule===null&&fallback.length===8,'A partly scored latest set keeps the band draw');
  check(fallback.map(p=>p.puzzle_id).join()!==ruled.join(),'The band draw chooses differently from the rule');
  const restored=await scorePuzzleSelection(query,{setIds:[setId],log:()=>{}});
  check(restored[0].written===1,'The backfill scores the missing puzzle');
  check((await latest(DAYS[0])).map(p=>p.puzzle_id).join()===ruled.join(),'Scored again, the rule returns the same Daily');

  // A changed strength table marks rows stale; the backfill rewrites them.
  await query("UPDATE draft_run_puzzle_selection_features SET strength_sha256=repeat('0',64) WHERE puzzle_id=$1",[victim]);
  check((await scorePuzzleSelection(query,{setIds:[setId],log:()=>{}}))[0].written===1,'A stale strength table is rescored');

  // The schedule records the rule that chose it.
  const day='2026-11-20';
  try {
    const {schedule,created}=await ensureDailySchedule(query,day,'latest');
    check(created,'The latest-set Daily schedule is created');
    const stored=(await query("SELECT selection_rule FROM draft_run_schedules WHERE day=$1::date AND environment='latest'",[day])).rows[0];
    check(stored.selection_rule===LATEST_DAILY_RULE,'The schedule records the stakes rule');
    check(JSON.parse(schedule.puzzle_ids).join()===(await latest(day)).map(p=>p.puzzle_id).join(),'The schedule holds the rule selection');
    await ensureDailySchedule(query,day,'mixed');
    check((await query("SELECT selection_rule FROM draft_run_schedules WHERE day=$1::date AND environment='mixed'",[day])).rows[0].selection_rule===null,
      'A mixed schedule records no rule');
  } finally {
    await query('DELETE FROM draft_run_schedules WHERE day=$1::date',[day]);
  }
  console.log('PASS: '+tests+' real PostgreSQL latest-set Daily selection assertions.');
} finally {
  await pool.end();
}
