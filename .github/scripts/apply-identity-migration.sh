#!/usr/bin/env bash
set -euo pipefail
connection=$1
migration=$2
# Do not replace a hardened merge or write guard with an older migration body.
# A failed marker query must stop the release, never replay an obsolete body.
case "$migration" in
  migrations/0046_public_identity_safety.sql) marker='public.pack1_creator_event_update_dedupe()' ;;
  migrations/0054_creator_event_idempotency.sql) marker='public.pack1_creator_event_assert_read_committed()' ;;
  *) echo 'Unsupported identity migration.' >&2; exit 1 ;;
esac
hardened=$(psql "$connection" -X -v ON_ERROR_STOP=1 -tAc "SELECT to_regprocedure('$marker') IS NOT NULL")
case "$hardened" in
  t) echo "Skipping $migration replay because creator-event hardening is already installed." ;;
  f) psql "$connection" -X -v ON_ERROR_STOP=1 -f "$migration" ;;
  *) echo 'Invalid creator-event schema marker.' >&2; exit 1 ;;
esac
