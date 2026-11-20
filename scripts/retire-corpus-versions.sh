#!/usr/bin/env bash
# Permanently retire superseded elite corpus versions while keeping every puzzle
# that a Daily, run, share, report or observation still references. Then
# rewrite the affected tables online with pg_repack so the freed space is
# returned instead of only being reused.
#
# Usage: retire-corpus-versions.sh <connection-file> [--repack-only]
# Output is row counts only: no sizes, hosts or connection details.
set -euo pipefail

connection_file=${1:?connection file required}
mode=${2:-}
conn=$(cat "$connection_file")

# Reviewed list. Never the live version, never one a Daily used in the last
# 28 days (DAILY_REPEAT_WINDOW_DAYS.decision in worker/draft-run-daily.mjs).
RETIRED=(elite-trophy-verified-v6 elite-trophy-colour-stage-v7 elite-trophy-colour-stage-v8)
REPACK_TABLES=(draft_run_verified_puzzles draft_run_puzzle_ratings draft_run_puzzle_selection_features
  draft_run_serving_inventory draft_run_serving_source_groups)
BATCH=20000

retired_sql=$(printf "'%s'," "${RETIRED[@]}"); retired_sql=${retired_sql%,}
q() { psql "$conn" -X -v ON_ERROR_STOP=1 -qtAc "$1"; }

live=$(node --input-type=module -e "import {DRAFT_RUN_CORPUS_VERSION as v} from './draft-run.mjs';console.log(v)")
for version in "${RETIRED[@]}"; do
  if [ "$version" = "$live" ]; then echo "Refusing: $version is the live corpus."; exit 1; fi
done
recent=$(q "SELECT count(*) FROM draft_run_schedules WHERE corpus_version IN ($retired_sql) AND day > current_date - 29")
if [ "$recent" != 0 ]; then echo "Refusing: a retired version was scheduled in the last 28 days."; exit 1; fi

if [ "$mode" != --repack-only ]; then
  # Every puzzle id anything points at. Views over these tables are derived,
  # so only base tables count.
  q "BEGIN;
    DROP TABLE IF EXISTS corpus_retirement_keep;
    CREATE TABLE corpus_retirement_keep (id text PRIMARY KEY);
    INSERT INTO corpus_retirement_keep SELECT DISTINCT id FROM (
      SELECT jsonb_array_elements_text(puzzle_ids) id FROM draft_run_schedules
      UNION ALL SELECT jsonb_array_elements_text(puzzle_ids) FROM draft_run_sessions
      UNION ALL SELECT jsonb_array_elements_text(puzzle_ids) FROM draft_run_shares
      UNION ALL SELECT puzzle_id FROM draft_run_decision_observations
      UNION ALL SELECT puzzle_id FROM draft_run_decision_reports
      UNION ALL SELECT puzzle_id FROM draft_run_pick_removal_members
    ) r WHERE id IS NOT NULL;
    COMMIT;"
  kept=$(q "SELECT count(*) FROM corpus_retirement_keep k JOIN draft_run_verified_puzzles p ON p.puzzle_id=k.id WHERE p.corpus_version IN ($retired_sql)")
  echo "Referenced retired puzzles kept: $kept"

  deleted=0 last=
  while :; do
    # Walk the primary key from where the last batch ended. Restarting the scan
    # each batch re-reads every dead index entry and slows down quadratically.
    # Ratings, selection features and pick-removal members cascade.
    if ! [[ "$last" =~ ^[0-9a-f]{0,32}$ ]]; then echo "Refusing: unexpected puzzle id format."; exit 1; fi
    IFS='|' read -r n last < <(q "WITH c AS (SELECT p.puzzle_id FROM draft_run_verified_puzzles p
        WHERE p.puzzle_id > '$last' AND p.corpus_version IN ($retired_sql)
          AND NOT EXISTS (SELECT 1 FROM corpus_retirement_keep k WHERE k.id=p.puzzle_id)
        ORDER BY p.puzzle_id LIMIT $BATCH),
      d AS (DELETE FROM draft_run_verified_puzzles p USING c WHERE p.puzzle_id=c.puzzle_id RETURNING p.puzzle_id)
      SELECT count(*), coalesce(max(puzzle_id),'') FROM d")
    deleted=$((deleted+n))
    echo "Deleted unreferenced retired puzzles: $deleted"
    [ "$n" = 0 ] && break
  done
  left=$(q "SELECT count(*) FROM draft_run_verified_puzzles p WHERE p.corpus_version IN ($retired_sql)
    AND NOT EXISTS (SELECT 1 FROM corpus_retirement_keep k WHERE k.id=p.puzzle_id)")
  if [ "$left" != 0 ]; then echo "Refusing to continue: $left unreferenced retired puzzles remain."; exit 1; fi

  # Retired versions are never served, so their serving snapshots are dead
  # weight. Inventory and source groups cascade.
  snapshots=$(q "WITH d AS (DELETE FROM draft_run_serving_snapshots WHERE corpus_version IN ($retired_sql) RETURNING 1) SELECT count(*) FROM d")
  echo "Deleted retired serving snapshots: $snapshots"
  q "DROP TABLE corpus_retirement_keep"
fi

# pg_repack reads libpq environment variables; never pass secrets as arguments.
while IFS=$'\t' read -r key value; do export "$key=$value"; done < <(node --input-type=module -e '
  const u=new URL(process.argv[1]),d=decodeURIComponent;
  for(const [k,v] of [["PGHOST",u.hostname],["PGPORT",u.port||"5432"],["PGUSER",d(u.username)],
    ["PGPASSWORD",d(u.password)],["PGDATABASE",d(u.pathname.slice(1))],["PGSSLMODE","require"]])
    console.log(k+"\t"+v);' "$conn")
q "CREATE EXTENSION IF NOT EXISTS pg_repack"
args=(); for table in "${REPACK_TABLES[@]}"; do args+=(-t "public.$table"); done
pg_repack -k --no-order "${args[@]}"
q "DROP EXTENSION pg_repack"
echo "Repacked ${#REPACK_TABLES[@]} tables."
