#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"
: "${R2_ENDPOINT:?R2_ENDPOINT is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"
export AWS_RETRY_MODE="${AWS_RETRY_MODE:-adaptive}"
export AWS_MAX_ATTEMPTS="${AWS_MAX_ATTEMPTS:-10}"

# v3 predates namespaced replay storage and remains at data/. New model
# versions must never overwrite those historical shards: a model rollout is
# reversible only when both generations remain addressable.
model_version="$(python3 - <<'PY'
import json
from pathlib import Path

versions = {
    json.loads(path.read_text())['model']['model_version']
    for path in Path('data').glob('*/manifest.json')
}
if len(versions) != 1:
    raise SystemExit(f'Expected one replay model in data/, found: {sorted(versions)}')
print(next(iter(versions)))
PY
)"
if [[ "$model_version" == "strong-player-colour-stage-v3" ]]; then
  replay_prefix="data"
else
  [[ "$model_version" =~ ^strong-player-[a-z0-9-]+$ ]] || {
    echo "Unsafe replay model version: $model_version" >&2
    exit 1
  }
  replay_prefix="replay-models/$model_version/data"
fi
echo "Replay shard model: $model_version ($replay_prefix)"

case "$mode" in
  hydrate)
    mkdir -p data
    aws s3 sync "s3://${R2_BUCKET}/${replay_prefix}" data \
      --endpoint-url "$R2_ENDPOINT" \
      --exclude '*' \
      --include '*/shards/*.json'
    ;;
  upload)
    aws s3 sync data "s3://${R2_BUCKET}/${replay_prefix}" \
      --endpoint-url "$R2_ENDPOINT" \
      --exclude '*' \
      --include '*/shards/*.json' \
      --content-type 'application/json; charset=utf-8' \
      --cache-control 'public, max-age=3600'
    ;;
  verify)
    local_count="$(find data -type f -path '*/shards/*.json' | wc -l | tr -d ' ')"
    remote_count="$(aws s3api list-objects-v2 \
      --bucket "$R2_BUCKET" \
      --prefix "${replay_prefix}/" \
      --endpoint-url "$R2_ENDPOINT" \
      --query 'length(Contents[?contains(Key, `/shards/`) && ends_with(Key, `.json`)])' \
      --output text)"
    echo "Local replay shards: $local_count"
    echo "Remote replay shards: $remote_count"
    test "$remote_count" -ge "$local_count"
    ;;
  *)
    echo "usage: $0 {hydrate|upload|verify}" >&2
    exit 2
    ;;
esac
