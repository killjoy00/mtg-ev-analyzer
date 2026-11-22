// Automatic, read-only closing-season report. One consistent SQL statement
// returns aggregate board counts only. No player identities or named backup.
// Run by the existing daily scheduled corpus activation smoke workflow.
import {appendFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {STANDINGS_LINEAGE} from '../worker/draft-run-season.mjs';

export const RECENT_SEASON_ROLLOVER_COUNTS=`WITH closed AS (
  SELECT old.set_id outgoing_set,next.set_id incoming_set,
         old.start_date::text start_date,old.end_date::text end_date
  FROM draft_run_seasons old
  JOIN draft_run_seasons next ON next.start_date=old.end_date+1
  WHERE next.start_date BETWEEN
    (now() AT TIME ZONE 'America/Los_Angeles')::date-1
    AND (now() AT TIME ZONE 'America/Los_Angeles')::date
  ORDER BY next.start_date DESC LIMIT 1
), participants AS (
  SELECT s.set_id,count(DISTINCT s.player_id)::int players
  FROM closed c JOIN scores s ON s.challenge_date BETWEEN c.start_date::date AND c.end_date::date
  WHERE s.mode='draft_run' AND s.set_id IN ('mixed','latest','powered-cube')
    AND ($1::text[] IS NULL OR s.details_json->>'corpus_version'=ANY($1::text[]))
    AND EXISTS (
      SELECT 1 FROM account_links a JOIN players owned ON owned.id=a.player_id
      WHERE a.player_id=s.player_id AND owned.username_owned=true
        AND owned.public_identity_hidden_at IS NULL
    )
  GROUP BY s.set_id
)
SELECT c.outgoing_set,c.incoming_set,c.start_date,c.end_date,
       coalesce((SELECT players FROM participants WHERE set_id='mixed'),0)::int mixed,
       coalesce((SELECT players FROM participants WHERE set_id='latest'),0)::int latest,
       coalesce((SELECT players FROM participants WHERE set_id='powered-cube'),0)::int cube
FROM closed c`;

export async function recentSeasonRollover(query) {
  // Match the displayed season boards' corpus-version lineage and eligibility.
  const versions=STANDINGS_LINEAGE[DRAFT_RUN_CORPUS_VERSION];
  const lineage=versions?`{${versions.join(',')}}`:null;
  const row=(await query(RECENT_SEASON_ROLLOVER_COUNTS,[lineage])).rows[0];
  if(!row)return null;
  return {
    outgoing_set:row.outgoing_set,
    incoming_set:row.incoming_set,
    start_date:String(row.start_date),
    end_date:String(row.end_date),
    board_counts:{
      mixed:Number(row.mixed),
      latest:Number(row.latest),
      'powered-cube':Number(row.cube),
    },
  };
}

export function formatSeasonRolloverReport(report) {
  if(!report)return 'No newly closed season to report.\n';
  return [
    `### Season rollover check: ${report.outgoing_set} → ${report.incoming_set}`,
    `- Closed season: ${report.start_date} through ${report.end_date} (Pacific dates)`,
    `- Mixed Daily: ${report.board_counts.mixed} eligible players`,
    `- Latest Set Daily: ${report.board_counts.latest} eligible players`,
    `- Powered Cube: ${report.board_counts['powered-cube']} eligible players`,
    '- Counts only. No named results were saved, published or written to workflow logs.',
    '- Advisory report: a missing or failed report never blocks a Daily or new-set activation.'
  ].join('\n')+'\n';
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const [connectionFile,...extra]=process.argv.slice(2);
  if(!connectionFile||extra.length)throw Error('Usage: node scripts/report-season-rollover.mjs CONNECTION_FILE');
  const {corpusDatabase}=await import('./neon-corpus-db.mjs');
  const report=await recentSeasonRollover(corpusDatabase(connectionFile));
  console.log(JSON.stringify(report||{status:'no_recent_rollover'}));
  if(report&&process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,formatSeasonRolloverReport(report)+'\n');
}
