#!/usr/bin/env bash
# THE FROZEN TEST PASS. Runs once. Regenerates every intermediate table under
# current code, evaluates all six reserve sets, writes one report. Nothing is
# printed per-set: seeing ecl before fin is how a reserve gets consumed.
set -u
S=/tmp/claude-0/-home-user-mtg-ev-analyzer/6293f353-0d16-509d-9962-4b76629ce49e/scratchpad
cd /home/user/mtg-ev-analyzer || exit 1
RESERVE="ecl fin ktk mom powered-cube woe"
OUT="$S/FINAL"
mkdir -p "$OUT/fit" "$OUT/log"

# 1. regenerate the deck-fit tables from scratch under current code
rebuild() {
  sid="$1"
  python3 scripts/deck_fit.py --games "$S/model/games/$sid.csv.gz" \
    --cache "$S/model/cache/$sid.json" --split train \
    --out "$OUT/fit/$sid.json" >"$OUT/log/$sid.fit" 2>&1 \
    && echo "fit ok $sid" || echo "fit FAIL $sid"
}
export -f rebuild; export S OUT
echo "$RESERVE" | tr ' ' '\n' | xargs -P 3 -I{} bash -c 'rebuild "$@"' _ {} >"$OUT/log/rebuild.log" 2>&1
built=$(ls "$OUT/fit" | wc -l)
[ "$built" -eq 6 ] || { echo "ABORT: only $built/6 fit tables"; cat "$OUT/log/rebuild.log"; exit 1; }

# 2. the one evaluation
caches=""; for sid in $RESERVE; do caches="$caches $S/model/cache/$sid.json"; done
python3 scripts/eval_model.py evaluate $caches \
  --variants v2,v3-colour-and-pair \
  --deck-fit-dir "$OUT/fit" \
  --split test --final-test \
  --bootstrap-draws 2000 \
  --json-out "$OUT/final.json" > "$OUT/final.txt" 2>"$OUT/log/eval.err"
rc=$?
echo "FINAL TEST PASS COMPLETE rc=$rc"
