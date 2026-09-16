#!/usr/bin/env bash
# STEP 2: frozen test pass for the CORRECTED candidate. Second use of the
# reserve - noted in provenance, not hidden.
# STEP 3: the full awards run across the 24-set pool, on validation.
set -u
S=/tmp/claude-0/-home-user-mtg-ev-analyzer/6293f353-0d16-509d-9962-4b76629ce49e/scratchpad
cd /home/user/mtg-ev-analyzer || exit 1
RESERVE="ecl fin ktk mom powered-cube woe"
POOL="blb bro dft dmu dsk eoe fdn hbg hob lci ltr mh3 mkm msh neo one otj pio sir snc sos tdm tla tmt"
OUT="$S/FINAL2"

until grep -q "SAME-POPULATION V2 BASELINE COMPLETE" "$S/samepop.log" 2>/dev/null; do sleep 60; done
echo "STEP 1 DONE"

mkdir -p "$OUT/fit" "$OUT/log"
rebuild() {
  sid="$1"
  [ -s "$OUT/fit/$sid.json" ] && return 0
  python3 scripts/deck_fit.py --games "$S/model/games/$sid.csv.gz" \
    --cache "$S/model/cache/$sid.json" --split train --out "$OUT/fit/$sid.json" \
    >"$OUT/log/$sid.fit" 2>&1 && echo "fit ok $sid" || echo "fit FAIL $sid"
}
export -f rebuild; export S OUT
echo "$RESERVE" | tr ' ' '\n' | xargs -P 3 -I{} bash -c 'rebuild "$@"' _ {} >"$OUT/log/rebuild.log" 2>&1
[ "$(ls "$OUT/fit" | wc -l)" -eq 6 ] || { echo "ABORT: fit tables incomplete"; exit 1; }

caches=""; for sid in $RESERVE; do caches="$caches $S/model/cache/$sid.json"; done
python3 scripts/eval_model.py evaluate $caches \
  --variants v2,v3-colour-and-pair --deck-fit-dir "$OUT/fit" \
  --split test --final-test --bootstrap-draws 2000 \
  --json-out "$OUT/final.json" > "$OUT/final.txt" 2>"$OUT/log/eval.err"
echo "STEP 2 FROZEN PASS COMPLETE rc=$?"

pcaches=""; for sid in $POOL; do pcaches="$pcaches $S/model/cache/$sid.json"; done
python3 scripts/eval_model.py awards $pcaches \
  --deck-fit-dir "$S/C2/fit" --split validation --max-test-drafts 400 \
  --json-out "$S/awards-pool.json" > "$S/awards-pool.txt" 2>"$S/awards-pool.err"
echo "STEP 3 AWARDS COMPLETE rc=$?"
