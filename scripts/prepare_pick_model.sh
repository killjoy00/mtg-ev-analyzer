#!/usr/bin/env bash
# Prepare every set the product serves, so the pick-value model is fitted once
# across all of them rather than once per set.
#
#   scripts/prepare_pick_model.sh WORKDIR [SET ...]
#
# Per set: fetch the draft and game archives, extract an elite cohort and a
# control cohort, measure card impact, measure deck fit ON THE ELITE TRAIN SPLIT
# ONLY so it never sees a draft the value model is later scored against, then
# measure pick observations. The final pooled fit is a separate step, because pooling has to
# see every set at once:
#
#   python3 scripts/pick_value.py --adaptive --weights ... \
#     $(for f in WORKDIR/obs/*.json; do echo --observations-in "$f"; done)
#
# Set codes are the archive names 17Lands publishes, lowercased; powered-cube
# maps to its own archive name.
set -uo pipefail

WORK="${1:?usage: prepare_pick_model.sh WORKDIR [SET ...]}"; shift
BASE="https://17lands-public.s3.amazonaws.com/analysis_data"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JOBS="${JOBS:-4}"
CONTROL_DRAFTS="${CONTROL_DRAFTS:-3000}"
WEIGHTS="${WEIGHTS:-0,1000,4000,16000,64000}"
LAMBDAS="${LAMBDAS:-0,0.5,1.0}"

SETS=("$@")
if [ ${#SETS[@]} -eq 0 ]; then
  mapfile -t SETS < <(python3 -c "
import json
p = json.load(open('$ROOT/data/selection-policy.json'))
for s in p['regular_sets_newest_first'] + p['selectable_only_sets'] + ['powered-cube']:
    print(s)
")
fi

mkdir -p "$WORK"/{archives,games,cache,cards,fit,obs,log}

archive_name() {
  case "$1" in
    powered-cube) echo "Cube_-_Powered" ;;
    *) echo "$1" | tr '[:lower:]' '[:upper:]' ;;
  esac
}

prepare() {
  local sid="$1" name log
  name="$(archive_name "$sid")"
  log="$WORK/log/$sid.log"
  : > "$log"

  for kind in draft_data game_data; do
    local dest
    [ "$kind" = draft_data ] && dest="$WORK/archives/$sid.csv.gz" || dest="$WORK/games/$sid.csv.gz"
    if [ ! -s "$dest" ]; then
      curl -fsS --max-time 1800 -o "$dest.part" \
        "$BASE/$kind/${kind}_public.$name.PremierDraft.csv.gz" >>"$log" 2>&1 || {
          echo "SKIP $sid: no $kind archive" | tee -a "$log"; rm -f "$dest.part"; return 1; }
      mv "$dest.part" "$dest"
    fi
  done

  [ -s "$WORK/cache/$sid.json" ] || \
    python3 "$ROOT/scripts/eval_model.py" extract --archive "$WORK/archives/$sid.csv.gz" \
      --set-id "$sid" --cache "$WORK/cache/$sid.json" >>"$log" 2>&1 || {
        echo "FAIL $sid: elite extract" | tee -a "$log"; return 1; }

  [ -s "$WORK/cache/$sid-control.json" ] || \
    python3 "$ROOT/scripts/eval_model.py" extract --archive "$WORK/archives/$sid.csv.gz" \
      --set-id "$sid" --cache "$WORK/cache/$sid-control.json" --cohort control \
      --max-drafts "$CONTROL_DRAFTS" >>"$log" 2>&1 || {
        echo "FAIL $sid: control extract" | tee -a "$log"; return 1; }

  [ -s "$WORK/cards/$sid.json" ] || \
    python3 "$ROOT/scripts/card_outcomes.py" --archive "$WORK/games/$sid.csv.gz" \
      --set-id "$sid" --out "$WORK/cards/$sid.json" >>"$log" 2>&1 || {
        echo "FAIL $sid: card outcomes" | tee -a "$log"; return 1; }

  [ -s "$WORK/fit/$sid.json" ] || \
    python3 "$ROOT/scripts/deck_fit.py" --games "$WORK/games/$sid.csv.gz" \
      --cache "$WORK/cache/$sid.json" --split train --out "$WORK/fit/$sid.json" >>"$log" 2>&1 || {
        echo "FAIL $sid: deck fit" | tee -a "$log"; return 1; }

  [ -s "$WORK/obs/$sid.json" ] || \
    python3 "$ROOT/scripts/pick_value.py" --all-picks --adaptive --weights "$WEIGHTS" \
      --deck-fit "$WORK/fit/$sid.json" \
      --set "$WORK/cache/$sid.json:$WORK/archives/$sid.csv.gz:$WORK/cards/$sid.json:$WORK/cache/$sid-control.json" \
      --observations-out "$WORK/obs/$sid.json" >>"$log" 2>&1 || {
        echo "FAIL $sid: measure" | tee -a "$log"; return 1; }

  echo "OK $sid"
}

export -f prepare archive_name
export WORK BASE ROOT CONTROL_DRAFTS WEIGHTS LAMBDAS

printf '%s\n' "${SETS[@]}" | xargs -P "$JOBS" -I{} bash -c 'prepare "$@"' _ {}

echo
echo "measured sets: $(ls "$WORK/obs" 2>/dev/null | wc -l) of ${#SETS[@]}"
echo "pool them with:"
echo "  python3 scripts/pick_value.py --adaptive --weights $WEIGHTS --lambdas $LAMBDAS \\"
echo "    \$(for f in $WORK/obs/*.json; do echo --observations-in \"\$f\"; done)"
