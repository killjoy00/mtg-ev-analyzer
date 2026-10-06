#!/usr/bin/env bash
set -euo pipefail

# Browser jobs share the same replay objects. The default ten parallel S3
# downloads can exhaust R2's per-object read limit across simultaneous PRs.
aws configure set default.s3.preferred_transfer_client classic
aws configure set default.s3.max_concurrent_requests 1

log_file="$(mktemp)"
trap 'rm -f "$log_file"' EXIT
for attempt in 1 2 3; do
  if bash scripts/r2_replay_shards.sh hydrate >"$log_file" 2>&1; then
    cat "$log_file"
    exit 0
  else
    status=$?
  fi
  cat "$log_file"
  # A resumed sync skips completed downloads. Never retry credentials, scope,
  # missing objects, or browser assertions as though they were throttling.
  if ! grep -q 'ServiceUnavailable.*Reduce your rate of simultaneous reads' "$log_file" || [[ "$attempt" == 3 ]]; then
    exit "$status"
  fi
  echo "R2 read throttling; retrying incomplete replay downloads (attempt $((attempt + 1))/3)." >&2
  sleep "$((attempt * 15))"
done
