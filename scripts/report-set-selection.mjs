// Read-only, nonblocking coverage report for a newly staged set.
// Usage: node scripts/report-set-selection.mjs CONNECTION_FILE SET_ID
// Reports selection-feature readiness. It does not activate a set, create a
// Daily, enforce new launch gates or change the existing fallback behavior.
import {appendFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {SERVING_QUALITY_SQL} from '../serving-quality.mjs';
import {SELECTION_FEATURE_VERSION} from '../puzzle-selection.mjs';
import {loadStrengthTable} from './score-puzzle-selection.mjs';

export function summarizeSetSelection({setId,snapshot,total,scored,clearEasy,strength}) {
  const eligible=Number(total||0),current=Number(scored||0),easy=Number(clearEasy||0);
  const status=!snapshot?'no_snapshot':!eligible?'no_eligible_puzzles':!strength?'no_strength_table':
    current<eligible?'older_selection_fallback_possible':easy<eligible?'clear_easy_fallback_possible':'fully_scored';
  return {
    set_id:setId,
    snapshot_id:snapshot?.source_snapshot_id||null,
    snapshot_status:snapshot?.lifecycle_status||null,
    strength_sha256:strength?.sha256||null,
    eligible_puzzles:eligible,
    current_strength_features:current,
    clear_easy_features:easy,
    strength_coverage_pct:eligible?Number((100*current/eligible).toFixed(1)):0,
    clear_easy_coverage_pct:eligible?Number((100*easy/eligible).toFixed(1)):0,
    assessment:status,
    advisory_only:true,
  };
}

export async function reportSetSelection(query,setId,{loadStrength=loadStrengthTable}={}) {
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(setId))throw Error('Invalid set id.');
  const snapshot=(await query(`SELECT source_snapshot_id,lifecycle_status
    FROM corpus_source_snapshots
    WHERE set_id=$1 AND corpus_version=$2 AND lifecycle_status IN ('Candidate','Approved')
    ORDER BY created_at DESC,source_snapshot_id DESC LIMIT 1`,
    [setId,DRAFT_RUN_CORPUS_VERSION])).rows[0]||null;
  const strength=loadStrength(setId);
  let totals={total:0,scored:0,clear_easy:0};
  if(snapshot) {
    totals=(await query(`SELECT count(*)::int total,count(f.puzzle_id)::int scored,
        count(f.trophy_off_colour)::int clear_easy
      FROM draft_run_verified_puzzles p
      JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
      LEFT JOIN draft_run_puzzle_selection_features f ON f.puzzle_id=p.puzzle_id
        AND f.feature_version=$3 AND f.strength_version=$4 AND f.strength_sha256=$5
      WHERE p.source_snapshot_id=$1 AND p.set_id=$2
        AND p.interesting AND p.pack_number=1 AND p.pick_number BETWEEN 1 AND 8
        AND ${SERVING_QUALITY_SQL}
        AND NOT EXISTS(SELECT 1 FROM corpus_source_exclusions x
          WHERE x.set_id=p.set_id AND x.corpus_version=p.corpus_version AND x.source_draft_hash=p.source_draft_hash)
        AND NOT EXISTS(SELECT 1 FROM draft_run_pick_removal_members m
          JOIN draft_run_pick_removals q USING(decision_key)
          WHERE m.puzzle_id=p.puzzle_id AND q.removed)`,
      [snapshot.source_snapshot_id,setId,SELECTION_FEATURE_VERSION,strength?.version||null,strength?.sha256||null])).rows[0]||totals;
  }
  const scheduled=(await query(`SELECT s.environment,s.day::text day,s.selection_rule,
      count(*)::int total_picks,
      count(*) FILTER(WHERE p.set_id=$1)::int set_picks
    FROM draft_run_schedules s
    CROSS JOIN LATERAL jsonb_array_elements_text(s.puzzle_ids) AS chosen(puzzle_id)
    LEFT JOIN draft_run_verified_puzzles p ON p.puzzle_id=chosen.puzzle_id
    WHERE s.day=(now() AT TIME ZONE 'America/Los_Angeles')::date
      AND s.environment IN ('latest','mixed')
    GROUP BY s.environment,s.day,s.selection_rule
    ORDER BY s.environment`,[setId])).rows;
  return {
    ...summarizeSetSelection({setId,snapshot,...totals,strength}),
    observed_today:scheduled.map(row=>({
      day:String(row.day),daily:row.environment,
      set_picks:Number(row.set_picks),total_picks:Number(row.total_picks),
      actual_selection_rule:row.selection_rule||'previous_band_draw',
    })),
  };
}

export function formatSetSelectionReport(report) {
  const heading='Set selection readiness (advisory only)';
  const lines=[`### ${heading}: ${report.set_id}`,
    `- Snapshot: ${report.snapshot_id||'none'} (${report.snapshot_status||'not staged'})`,
    `- Current strength features: ${report.current_strength_features}/${report.eligible_puzzles} (${report.strength_coverage_pct}%)`,
    `- Clear-Easy features: ${report.clear_easy_features}/${report.eligible_puzzles} (${report.clear_easy_coverage_pct}%)`,
    `- Status: **${report.assessment.replaceAll('_',' ')}**`,
    ...(report.observed_today||[]).map(day=>`- Actual ${day.day} ${day.daily} Daily: ${day.set_picks}/${day.total_picks} picks from ${report.set_id}, rule **${day.actual_selection_rule}**`),
    '- An incomplete report warns about a potential Daily selection fallback; it does not prevent release.',
    '- Actual selection rules must also be checked against the first published Latest and Mixed schedules.'];
  return lines.join('\n')+'\n';
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const [connection,setId]=process.argv.slice(2);
  if(!connection||!setId)throw Error('Usage: node scripts/report-set-selection.mjs CONNECTION_FILE SET_ID');
  const {corpusDatabase}=await import('./neon-corpus-db.mjs');
  const report=await reportSetSelection(corpusDatabase(connection),setId);
  console.log(JSON.stringify(report));
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,formatSetSelectionReport(report)+'\n');
}
