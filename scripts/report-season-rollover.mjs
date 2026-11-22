// Automatic, read-only closing-season report. It prints aggregate counts,
// never player names, and does not save or publish named standings.
// Run by the existing corpus activation smoke schedule after the Pacific Daily.
import {appendFileSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {readClosedStandings} from './capture-season-standings.mjs';

export async function recentSeasonRollover(query) {
  const latest=(await query(`SELECT old.set_id outgoing_set,next.set_id incoming_set
    FROM draft_run_seasons old
    JOIN draft_run_seasons next ON next.start_date=old.end_date+1
    WHERE next.start_date BETWEEN
      (now() AT TIME ZONE 'America/Los_Angeles')::date-1
      AND (now() AT TIME ZONE 'America/Los_Angeles')::date
    ORDER BY next.start_date DESC LIMIT 1`)).rows[0];
  if(!latest)return null;
  // Existing, tested read-only capture computes the *same* eligible rankings
  // as player leaderboards in one repeatable-read snapshot. Discard names.
  const snapshot=await readClosedStandings(query,latest.outgoing_set,latest.incoming_set);
  return {
    outgoing_set:snapshot.set_id,
    incoming_set:snapshot.next_set,
    start_date:snapshot.start_date,
    end_date:snapshot.end_date,
    board_counts:Object.fromEntries(Object.entries(snapshot.boards)
      .map(([board,result])=>[board,result.standings.length])),
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
  const {Client}=await import('pg');
  const client=new Client({connectionString:readFileSync(connectionFile,'utf8').trim()});
  await client.connect();
  try {
    const report=await recentSeasonRollover(client.query.bind(client));
    console.log(JSON.stringify(report||{status:'no_recent_rollover'}));
    if(report&&process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY,formatSeasonRolloverReport(report)+'\n');
  } finally {
    await client.end();
  }
}
