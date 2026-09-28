#!/usr/bin/env python3
"""Outcome-free metadata/collation preflight for frozen EOE P1P1 study."""
from __future__ import annotations

import argparse,csv,gzip,hashlib,json,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"research"))
from contextual_value_phase_a_features import _fetch_rich_set

EXPECTED_SHA="1dd9d1baf31fa56e06bbd2d9d9bb8c2c87cf342bc15872b5a30dbe9d4ecab648"

def sha256(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda:f.read(1024*1024),b""):h.update(b)
    return h.hexdigest()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--draft-archive",type=Path,required=True)
    p.add_argument("--cohort-manifest",type=Path,required=True)
    p.add_argument("--output-dir",type=Path,required=True)
    a=p.parse_args()
    if sha256(a.draft_archive)!=EXPECTED_SHA: raise SystemExit("EOE archive hash mismatch")
    cohort=json.loads(a.cohort_manifest.read_text())
    if cohort.get("expansion")!="EOE": raise SystemExit("wrong cohort")
    reserved=set(map(str,cohort["prior_8000_ids"]))|set(map(str,cohort["confirmation_ids"]))
    if len(reserved)!=13000: raise SystemExit("reserved boundary not 13k")

    wanted=set(); counts={0:0,8:0}; seen_p1p1=set()
    with gzip.open(a.draft_archive,"rt",encoding="utf-8",newline="") as f:
        reader=csv.DictReader(f)
        pack_cols=[c for c in reader.fieldnames if c.startswith("pack_card_")]
        for row in reader:
            if row.get("event_type")!="PremierDraft" or row.get("pack_number")!="0": continue
            pick=int(float(row.get("pick_number") or -1))
            if pick not in (0,8): continue
            did=str(row["draft_id"])
            if did in reserved: continue
            counts[pick]+=1
            if pick==0: seen_p1p1.add(did)
            for c in pack_cols:
                try: n=int(row.get(c) or 0)
                except ValueError: n=0
                if n>0: wanted.add(c[len("pack_card_"):])
    if len(seen_p1p1)!=91377: raise SystemExit(f"expected 91377 P1P1 drafts, got {len(seen_p1p1)}")

    resolved,unresolved=_fetch_rich_set("EOE",wanted)
    coverage=len(resolved)/max(1,len(wanted))
    if coverage<.98: raise SystemExit(f"metadata coverage too low {coverage}")
    a.output_dir.mkdir(parents=True,exist_ok=True)
    meta=a.output_dir/"eoe-card-metadata.json"
    meta.write_text(json.dumps(resolved,indent=2,sort_keys=True)+"\n")
    report={
      "phase":"p1p1_eoe_collation_preflight_outcome_free",
      "outcomes_read":False,
      "archive_sha256":EXPECTED_SHA,
      "reserved_ids":13000,
      "untouched_p1p1_drafts":91377,
      "p1p9_rows_seen":counts[8],
      "wanted_card_names":len(wanted),
      "resolved_card_names":len(resolved),
      "metadata_coverage":coverage,
      "unresolved":unresolved,
      "metadata_sha256":sha256(meta),
      "available_collation_diagnostics":[
        "card-rarity composition of recorded offered packs",
        "co-presence of other frozen primary cards",
        "P1P9 return/offered-card behavior where a P1P9 row is logged",
      ],
      "unavailable_collation_diagnostics":[
        "Arena booster slot provenance / which physical slot generated each card",
        "replacement-slot identity for a focal card",
        "server-side randomization seed or player-independence mechanism",
      ],
      "note":"The 17Lands draft archive records pack card counts, not booster slot provenance. Rarity composition can therefore be measured, while rare/wildcard/special-slot origin cannot be inferred without inventing data.",
    }
    (a.output_dir/"preflight-report.json").write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print(json.dumps(report,indent=2,sort_keys=True))

if __name__=="__main__": main()
