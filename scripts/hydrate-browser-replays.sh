#!/usr/bin/env bash
set -euo pipefail

# Backward-compatible alias. Required CI gates use the generalized helper.
exec bash scripts/hydrate-replay-shards.sh
