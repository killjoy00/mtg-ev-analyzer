import {link, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {DRAFT_RUN_LEADERBOARD_ENVIRONMENTS, draftRunLeaderboardRows} from '../worker/draft-run-season.mjs';
import {seasonRatingPolicy} from '../worker/season-rating.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const setCode = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
class CaptureError extends Error {}

export async function readClosedStandings(query, outgoing, incoming) {
  // Keep the season dates, eligible identities and all three boards on one database snapshot.
  await query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const {rows: [season]} = await query(
      `SELECT old.set_id, old.set_name, old.start_date::text, old.end_date::text,
              next.set_id AS next_set, transaction_timestamp() AS captured_at
       FROM draft_run_seasons old JOIN draft_run_seasons next ON next.start_date = old.end_date + 1
       WHERE old.set_id = $1 AND next.set_id = $2
         AND next.start_date <= (now() AT TIME ZONE 'America/Los_Angeles')::date`, [outgoing, incoming]);
    if (!season) throw new CaptureError('The requested season transition has not been recorded.');
    const boards = {};
    for (const environment of DRAFT_RUN_LEADERBOARD_ENVIRONMENTS) {
      const policy = seasonRatingPolicy(environment, season.start_date);
      // PostgreSQL LIMIT NULL returns every eligible row, including ties beyond the public page.
      const rows = await draftRunLeaderboardRows(query, {
        start: season.start_date, end: season.end_date, environment, ratingPolicy: policy, limit: null,
      });
      boards[environment] = {
        rating_policy: policy.version,
        standings: rows.map(({rank, display_name, rating, average_score, days}) => ({
          rank, display_name, rating, average_score, days,
        })),
      };
    }
    await query('COMMIT');
    return {...season, corpus_version: DRAFT_RUN_CORPUS_VERSION, boards};
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
}

export async function saveClosedStandings(snapshot, directory) {
  const dest = await realpath(directory);
  const fromRepo = relative(await realpath(repoRoot), dest);
  if (!(fromRepo === '..' || fromRepo.startsWith('..' + sep) || isAbsolute(fromRepo))) {
    throw new CaptureError('Choose private storage outside the repository.');
  }
  if (!setCode.test(snapshot.set_id)) throw new CaptureError('Invalid season set code.');
  const filename = snapshot.set_id + '-season-standings.json';
  const staging = await mkdtemp(join(dest, '.season-'));
  try {
    const temporary = join(staging, filename);
    await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n', {mode: 0o600});
    // Only expose a complete file. A retry or concurrent run cannot replace the original capture.
    await link(temporary, join(dest, filename));
  } finally {
    await rm(staging, {recursive: true, force: true});
  }
  return filename;
}

async function main() {
  const [outgoing, incoming, directory, ...extra] = process.argv.slice(2);
  if (!outgoing || !incoming || !setCode.test(outgoing) || !setCode.test(incoming) || outgoing === incoming || !directory || extra.length) {
    throw new CaptureError('Usage: node scripts/capture-season-standings.mjs OUTGOING_SET INCOMING_SET PRIVATE_DIRECTORY');
  }
  if (process.env.GITHUB_ACTIONS === 'true') throw new CaptureError('Run from a private operator environment.');
  if (!process.env.DATABASE_URL) throw new CaptureError('A private DATABASE_URL is required.');
  const {Client} = await import('pg');
  const client = new Client({connectionString: process.env.DATABASE_URL});
  await client.connect();
  try {
    const snapshot = await readClosedStandings(client.query.bind(client), outgoing, incoming);
    const filename = await saveClosedStandings(snapshot, directory);
    const counts = Object.entries(snapshot.boards).map(([key, board]) => key + '=' + board.standings.length);
    console.log('Saved', filename, snapshot.start_date, 'through', snapshot.end_date, counts.join(', '));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    // Never put query parameters, connection details, or player data in a diagnostic.
    if (error.code === 'EEXIST') console.error('A capture already exists. The original file was preserved.');
    else if (error instanceof CaptureError) console.error(error.message);
    else console.error('Capture failed. Check the private database connection, output directory and disk space.');
    process.exitCode = 1;
  });
}
