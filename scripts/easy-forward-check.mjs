// The locked forward check for the clear-Easy rule
// (docs/DIFFICULTY-REVIEW-2026-11.md, "Forward check"). Scheduled by
// .github/workflows/easy-forward-check.yml; nobody has to run or read it.
//
//   node scripts/easy-forward-check.mjs CONNECTION_FILE [--summary PATH]
//
// It runs two SELECT statements and writes nothing. Only per-puzzle counts
// leave the database: the person key exists inside the query, to keep each
// person's first encounter with a puzzle, and is never selected. The process
// exits 1 only when the rule is still choosing Dailies and the check says it
// should be turned off, so the scheduled run fails and notifies the owner.
// Turning the rule off (PACK1_DAILY_CLEAR_EASY=off) stays a deliberate release
// step; this script never changes configuration.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {gameDateKey} from '../game-date.mjs';
import {LATEST_DAILY_CLEAR_EASY_RULE,MIXED_DAILY_CLEAR_EASY_RULE} from '../puzzle-selection.mjs';
import {toPgArray} from '../worker/draft-run-selection.mjs';

// Fixed when the rule was reviewed. Changing any value is a new experiment,
// not a correction: see the difficulty review before touching them.
export const FORWARD_CHECK=Object.freeze({
  rules:Object.freeze([LATEST_DAILY_CLEAR_EASY_RULE,MIXED_DAILY_CLEAR_EASY_RULE]),
  // Easy puzzles per stage, and first-encounter answers a puzzle needs to count.
  sample:56,
  min_answers:50,
  // Mean per-puzzle share of answers under 50 on the 28 Easy puzzles the -v1
  // rules served, and the share that confirms the rule (5 points lower).
  baseline_under_50:0.367,
  confirm_under_50:0.317,
  // An unconfirmed first stage is repeated once on the next sample.
  stages:2,
});

// Easy-band puzzles of Dailies scheduled by the rule before `today`, in
// schedule order, with first-encounter Daily answers. $1 rules, $2 today.
export const FORWARD_CHECK_SQL=`WITH scheduled AS (
  SELECT s.day,s.environment,e.ord,e.puzzle_id
  FROM draft_run_schedules s
  CROSS JOIN LATERAL jsonb_array_elements_text(s.puzzle_ids) WITH ORDINALITY e(puzzle_id,ord)
  JOIN draft_run_puzzle_ratings r ON r.puzzle_id=e.puzzle_id AND r.difficulty_version='support-ratio-v1' AND r.band='easy'
  WHERE s.selection_rule=ANY($1::text[]) AND s.day<$2::date
), observed AS (
  SELECT o.puzzle_id,o.score,o.first_seen_at,(s.day IS NOT NULL) daily,
    coalesce(s.daily_account_id::text,(SELECT min(a.auth_user_id::text) FROM account_links a WHERE a.player_id=s.player_id),'g:'||s.player_id::text) person
  FROM draft_run_decision_observations o
  JOIN draft_run_sessions s ON s.id=o.session_id
  JOIN players p ON p.id=s.player_id
  WHERE o.puzzle_id IN (SELECT puzzle_id FROM scheduled) AND o.observed AND o.outcome='pick' AND NOT s.measurement_qa
    AND NOT coalesce(p.display_name ~* '^(QA([ _-]|$)|Import check$|Production smoke|Release check)',false)
    AND NOT EXISTS (SELECT 1 FROM account_links al JOIN pack1_admins ad ON ad.auth_user_id=al.auth_user_id WHERE al.player_id=s.player_id)
), first_encounter AS (
  SELECT DISTINCT ON (person,puzzle_id) puzzle_id,score,daily FROM observed ORDER BY person,puzzle_id,first_seen_at
), totals AS (
  SELECT puzzle_id,count(*)::int answers,(count(*) FILTER (WHERE score<50))::int under_50
  FROM first_encounter WHERE daily GROUP BY puzzle_id
)
SELECT sc.day::text AS day,sc.environment,sc.ord::int AS ord,coalesce(t.answers,0)::int AS answers,coalesce(t.under_50,0)::int AS under_50
FROM scheduled sc LEFT JOIN totals t USING(puzzle_id)
ORDER BY sc.day,sc.environment,sc.ord`;

// Whether the newest Latest Set or Main Daily schedule was chosen by the rule.
export const RULE_ACTIVE_SQL=`SELECT coalesce(bool_or(selection_rule=ANY($1::text[])),false) active FROM (
  SELECT DISTINCT ON (environment) selection_rule FROM draft_run_schedules
  WHERE environment IN ('latest','mixed') ORDER BY environment,day DESC
) newest`;

const yes=value=>value===true||value==='t'||value===1||value==='1';

export async function loadForwardCheck(query,today=gameDateKey()) {
  const rules=toPgArray(FORWARD_CHECK.rules);
  const rows=(await query(FORWARD_CHECK_SQL,[rules,today])).rows.map(row=>({day:row.day,environment:row.environment,answers:Number(row.answers),under_50:Number(row.under_50)}));
  return {rows,ruleActive:yes((await query(RULE_ACTIVE_SQL,[rules])).rows[0]?.active)};
}

// rows: scheduled Easy puzzles in schedule order, each {answers, under_50}.
export function forwardCheckOutcome(rows,{ruleActive=true}={},check=FORWARD_CHECK) {
  const counted=rows.filter(row=>row.answers>=check.min_answers);
  const base={scheduled:rows.length,counted:counted.length,rule_active:ruleActive};
  if(!rows.length)return {...base,status:'not_started',final:false,stage:0,message:'No Daily has been scheduled by the clear-Easy rule yet.'};
  let stage=0,result=null;
  for(;stage<check.stages;stage++) {
    const sample=counted.slice(stage*check.sample,(stage+1)*check.sample);
    if(sample.length<check.sample) {
      const waiting=`${sample.length} of ${check.sample} Easy puzzles have ${check.min_answers} or more answers`;
      if(!result)return {...base,status:'collecting',final:false,stage:stage+1,message:`Collecting: ${waiting}.`};
      return {...base,...result,status:'unconfirmed',final:false,stage:stage+1,message:`Unconfirmed on the first ${check.sample}; repeating once: ${waiting}.`};
    }
    const shares=sample.map(row=>row.under_50/row.answers);
    // Rounded to a millionth so a share exactly on a threshold is not moved
    // across it by floating-point summation.
    const mean=Math.round(1e6*shares.reduce((sum,share)=>sum+share,0)/shares.length)/1e6;
    result={mean_under_50:mean,majority_under_50:shares.filter(share=>share>=0.5).length,puzzles:sample.length};
    if(mean<=check.confirm_under_50)return {...base,...result,status:'confirmed',final:true,stage:stage+1,
      message:`Confirmed: the mean share of answers under 50 is at or below ${(100*check.confirm_under_50).toFixed(1)}%. Keep the rule.`};
    if(mean>check.baseline_under_50)return {...base,...result,status:'reversed',final:true,stage:stage+1,
      message:ruleActive
        ?`Reversed: the mean share of answers under 50 is above the ${(100*check.baseline_under_50).toFixed(1)}% baseline. Turn the rule off with PACK1_DAILY_CLEAR_EASY=off.`
        :`Reversed: the mean share of answers under 50 was above the ${(100*check.baseline_under_50).toFixed(1)}% baseline. The rule is no longer choosing Dailies.`};
  }
  return {...base,...result,status:'unconfirmed',final:true,stage:check.stages,
    message:`Unconfirmed after ${check.stages} samples: between the confirming share and the baseline both times. Keep the rule; no further check is scheduled.`};
}

// The owner must act only on a reversal while the rule still chooses Dailies.
export const forwardCheckNeedsAction=outcome=>outcome.status==='reversed'&&outcome.rule_active;

// Aggregates only: safe for a public workflow summary.
export function forwardCheckSummary(outcome,check=FORWARD_CHECK) {
  const lines=['## Clear-Easy forward check','',`**${outcome.message}**`,'',
    '| | |','| --- | --- |',
    `| Status | ${outcome.status}${outcome.final?' (final)':''} |`,
    `| Stage | ${outcome.stage} of ${check.stages} |`,
    `| Easy puzzles scheduled by the rule | ${outcome.scheduled} |`,
    `| With ${check.min_answers}+ first-encounter answers | ${outcome.counted} |`,
    `| Rule still choosing Dailies | ${outcome.rule_active?'yes':'no'} |`];
  if(outcome.mean_under_50!==undefined)lines.push(
    `| Mean share of answers under 50 (${outcome.puzzles} puzzles) | ${(100*outcome.mean_under_50).toFixed(1)}% |`,
    `| Puzzles with a majority under 50 | ${outcome.majority_under_50} |`);
  lines.push(`| Baseline / confirming share | ${(100*check.baseline_under_50).toFixed(1)}% / ${(100*check.confirm_under_50).toFixed(1)}% |`,'',
    'Before-and-after comparison on player outcomes, which are proxies. See docs/DIFFICULTY-REVIEW-2026-11.md.','');
  return lines.join('\n');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if(!args[0]||args[0].startsWith('--'))throw Error('Usage: node scripts/easy-forward-check.mjs CONNECTION_FILE [--summary PATH]');
  const {corpusDatabase}=await import('./neon-corpus-db.mjs');
  const {rows,ruleActive}=await loadForwardCheck(corpusDatabase(args[0]));
  const outcome=forwardCheckOutcome(rows,{ruleActive}),summary=forwardCheckSummary(outcome);
  const at=args.indexOf('--summary');
  if(at>=0&&args[at+1])fs.appendFileSync(args[at+1],summary);
  console.log(summary);
  console.log(JSON.stringify(outcome));
  if(forwardCheckNeedsAction(outcome)) {
    console.error('::error::Clear-Easy forward check reversed. Set PACK1_DAILY_CLEAR_EASY=off through the guarded release.');
    process.exit(1);
  }
}
