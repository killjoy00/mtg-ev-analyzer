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
#
# Rebuild workflows may checkpoint only a subset of environments while the
# checkout is intentionally mixed-model. In that case REPLAY_MODEL_VERSION and
# REPLAY_SETS must be supplied together so those shards can be durably staged in
# the target model namespace without pretending the whole checkout is uniform.
model_override="${REPLAY_MODEL_VERSION:-}"
set_filter="${REPLAY_SETS:-}"

if [[ -n "$model_override" && -z "$set_filter" ]]; then
  echo "REPLAY_MODEL_VERSION requires REPLAY_SETS for a scoped shard operation." >&2
  exit 2
fi

if [[ -n "$model_override" ]]; then
  model_version="$model_override"
else
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
fi

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

scoped_sets=()
if [[ -n "$set_filter" ]]; then
  IFS=',' read -r -a raw_sets <<< "$set_filter"
  for raw in "${raw_sets[@]}"; do
    sid="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
    [[ "$sid" =~ ^[a-z0-9-]+$ ]] || {
      echo "Unsafe replay set id: $sid" >&2
      exit 2
    }
    manifest="data/$sid/manifest.json"
    [[ -f "$manifest" ]] || {
      echo "Missing manifest for scoped replay set: $sid" >&2
      exit 1
    }
    manifest_model="$(python3 - "$manifest" <<'PY'
import json
import sys
from pathlib import Path
print(json.loads(Path(sys.argv[1]).read_text())['model']['model_version'])
PY
)"
    [[ "$manifest_model" == "$model_version" ]] || {
      echo "Scoped replay set $sid has model $manifest_model, expected $model_version" >&2
      exit 1
    }
    scoped_sets+=("$sid")
  done
fi

case "$mode" in
  hydrate)
    mkdir -p data
    if [[ ${#scoped_sets[@]} -gt 0 ]]; then
      for sid in "${scoped_sets[@]}"; do
        mkdir -p "data/$sid/shards"
        aws s3 sync "s3://${R2_BUCKET}/${replay_prefix}/${sid}/shards/" "data/$sid/shards/" \
          --endpoint-url "$R2_ENDPOINT"
      done
    else
      aws s3 sync "s3://${R2_BUCKET}/${replay_prefix}" data \
        --endpoint-url "$R2_ENDPOINT" \
        --exclude '*' \
        --include '*/shards/*.json'
    fi
    ;;
  upload)
    if [[ ${#scoped_sets[@]} -gt 0 ]]; then
      for sid in "${scoped_sets[@]}"; do
        shard_dir="data/$sid/shards"
        local_count="$(find "$shard_dir" -maxdepth 1 -type f -name '*.json' | wc -l | tr -d ' ')"
        [[ "$local_count" -gt 0 ]] || {
          echo "No local replay shards for scoped set: $sid" >&2
          exit 1
        }
        aws s3 sync "$shard_dir/" "s3://${R2_BUCKET}/${replay_prefix}/${sid}/shards/" \
          --endpoint-url "$R2_ENDPOINT" \
          --delete \
          --content-type 'application/json; charset=utf-8' \
          --cache-control 'public, max-age=3600'
      done
    else
      aws s3 sync data "s3://${R2_BUCKET}/${replay_prefix}" \
        --endpoint-url "$R2_ENDPOINT" \
        --exclude '*' \
        --include '*/shards/*.json' \
        --content-type 'application/json; charset=utf-8' \
        --cache-control 'public, max-age=3600'
    fi
    ;;
  verify)
    if [[ ${#scoped_sets[@]} -gt 0 ]]; then
      for sid in "${scoped_sets[@]}"; do
        local_count="$(find "data/$sid/shards" -maxdepth 1 -type f -name '*.json' | wc -l | tr -d ' ')"
        remote_count="$(aws s3api list-objects-v2 \
          --bucket "$R2_BUCKET" \
          --prefix "${replay_prefix}/${sid}/shards/" \
          --endpoint-url "$R2_ENDPOINT" \
          --query 'Contents[?ends_with(Key, `.json`)].Key' \
          --output text | awk '{ count += NF } END { print count + 0 }')"
        echo "$sid replay shards: local=$local_count remote=$remote_count"
        test "$local_count" -gt 0
        test "$remote_count" = "$local_count"
      done
    else
      local_count="$(find data -type f -path '*/shards/*.json' | wc -l | tr -d ' ')"
      remote_count="$(aws s3api list-objects-v2 \
        --bucket "$R2_BUCKET" \
        --prefix "${replay_prefix}/" \
        --endpoint-url "$R2_ENDPOINT" \
        --query 'Contents[?contains(Key, `/shards/`) && ends_with(Key, `.json`)].Key' \
        --output text | awk '{ count += NF } END { print count + 0 }')"
      echo "Local replay shards: $local_count"
      echo "Remote replay shards: $remote_count"
      test "$local_count" -gt 0
      test "$remote_count" -ge "$local_count"
    fi
    ;;
  *)
    echo "usage: $0 {hydrate|upload|verify}" >&2
    exit 2
    ;;
esac
