#!/usr/bin/env bash
set -euo pipefail

# Required repository gates can read the same replay objects concurrently.
# R2 may throttle simultaneous reads of one object, so serialize S3 downloads
# within each runner and resume only the specific transient read-throttle case.
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
  # missing objects, unrelated storage failures, or failed assertions.
  if ! grep -q 'ServiceUnavailable.*Reduce your rate of simultaneous reads' "$log_file" || [[ "$attempt" == 3 ]]; then
    exit "$status"
  fi
  echo "R2 read throttling; retrying incomplete replay downloads (attempt $((attempt + 1))/3)." >&2
  sleep "$((attempt * 15))"
done
