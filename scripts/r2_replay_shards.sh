#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"
: "${R2_ENDPOINT:?R2_ENDPOINT is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"

case "$mode" in
  hydrate)
    mkdir -p data
    aws s3 sync "s3://${R2_BUCKET}/data" data \
      --endpoint-url "$R2_ENDPOINT" \
      --exclude '*' \
      --include '*/shards/*.json'
    ;;
  upload)
    aws s3 sync data "s3://${R2_BUCKET}/data" \
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
      --prefix 'data/' \
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
