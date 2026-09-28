#!/usr/bin/env python3
"""Final execution wrapper for the already-frozen EOE P1P1 randomized-pack study.

The registered primary RF/Wald definitions and frozen ten-card family are
imported unchanged from contextual_value_p1p1_eoe_primary.py. Added collation
and P1P9 diagnostics are explicitly secondary diagnostics.
"""
from __future__ import annotations

import argparse,csv,gzip,json,math
from pathlib import Path
import numpy as np

from contextual_value_p1p1_eoe_primary import (
    EXPECTED_SHA,EXPECTED_N,Z_BONF,Z_95,CARDS,sha256,mean_diff_se,wald_if,
    standardized_difference,categorical_balance,missing_outcome_rf_bounds,
)
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
from contextual_value.dataset import _games_lower_bound,_number

def parse_args():
    p=argparse.ArgumentParser()
    p.add_argument("--draft-archive",type=Path,required=True)
    p.add_argument("--cohort-manifest",type=Path,required=True)
    p.add_argument("--card-metadata",type=Path,required=True)
    p.add_argument("--metadata-report",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    return p.parse_args()

def mean_rarity(rows,metadata):
    levels=("mythic","rare","uncommon","common","unknown")
    total={k:0.0 for k in levels}
    if not rows:return {k:None for k in levels}
    for r in rows:
        counts={k:0 for k in levels}
        for name,n in r["offered_counts"].items():
            rarity=str(metadata.get(name,{}).get("rarity") or "unknown").lower()
            if rarity not in counts: rarity="unknown"
            counts[rarity]+=int(n)
        for k in levels: total[k]+=counts[k]
    return {k:total[k]/len(rows) for k in levels}

def rarity_contrast(rows,card,metadata):
    a=[r for r in rows if card in r["offered"]]
    b=[r for r in rows if card not in r["offered"]]
    ma=mean_rarity(a,metadata); mb=mean_rarity(b,metadata)
    return {
      "present_mean_counts":ma,
      "absent_mean_counts":mb,
      "present_minus_absent":{k:(None if ma[k] is None or mb[k] is None else ma[k]-mb[k]) for k in ma},
      "slot_provenance_available":False,
      "slot_provenance_note":"17Lands pack_card_* columns record card counts but not Arena booster slot identity/replacement provenance. Rarity composition is observable; rare/wildcard/special-slot origin is not.",
    }

def p1p9_diag(rows,p1p9,card):
    present=[r for r in rows if card in r["offered"]]
    passed=[r for r in present if r["pick"]!=card]
    logged=[r for r in passed if r["draft_id"] in p1p9]
    returned=[r for r in logged if card in p1p9[r["draft_id"]]["offered"]]
    picked=[r for r in logged if p1p9[r["draft_id"]]["pick"]==card]
    absent_logged=[r for r in rows if card not in r["offered"] and r["draft_id"] in p1p9]
    anomalous=[r for r in absent_logged if card in p1p9[r["draft_id"]]["offered"]]
    return {
      "p1p1_present_n":len(present),
      "p1p1_present_not_taken_n":len(passed),
      "p1p9_logged_among_present_not_taken_n":len(logged),
      "p1p9_logged_fraction_among_present_not_taken":len(logged)/len(passed) if passed else None,
      "focal_card_present_at_p1p9_n":len(returned),
      "focal_card_return_rate_given_logged_and_passed":len(returned)/len(logged) if logged else None,
      "focal_card_selected_at_p1p9_n":len(picked),
      "focal_card_selected_rate_given_logged_and_passed":len(picked)/len(logged) if logged else None,
      "absent_at_p1p1_but_present_at_p1p9_n":len(anomalous),
      "interpretation":"P1P9 is the returning original pack where logged. This is an exclusion/collation diagnostic, not part of the registered primary RF test.",
    }

def covariate_balance(rows,card):
    z=np.asarray([card in r["offered"] for r in rows],bool)
    out={}
    for name in ("skill","experience"):
        vals=[r[name] for r in rows]
        observed=np.asarray([v is not None for v in vals],bool)
        out[name+"_missing_fraction_present"]=float(np.mean(~observed[z]))
        out[name+"_missing_fraction_absent"]=float(np.mean(~observed[~z]))
        if np.any(observed&z) and np.any(observed&~z):
            vv=np.asarray([0.0 if v is None else float(v) for v in vals])
            out[name+"_standardized_difference_complete_covariate"]=standardized_difference(vv[observed],z[observed])
    out["rank"]=categorical_balance([r["rank"] for r in rows],z)
    return out

def main():
    args=parse_args()
    if sha256(args.draft_archive)!=EXPECTED_SHA: raise SystemExit("EOE archive hash mismatch")
    cohort=json.loads(args.cohort_manifest.read_text())
    if cohort.get("expansion")!="EOE": raise SystemExit("wrong cohort manifest")
    reserved=set(map(str,cohort["prior_8000_ids"]))|set(map(str,cohort["confirmation_ids"]))
    if len(reserved)!=13000: raise SystemExit("EOE reserved boundary is not 13,000")
    meta_report=json.loads(args.metadata_report.read_text())
    if meta_report.get("outcomes_read") is not False or meta_report.get("archive_sha256")!=EXPECTED_SHA:
        raise SystemExit("invalid outcome-free metadata preflight")
    if sha256(args.card_metadata)!=meta_report.get("metadata_sha256"):
        raise SystemExit("card metadata hash mismatch")
    metadata=json.loads(args.card_metadata.read_text())

    rows=[]; p1p9={}
    with gzip.open(args.draft_archive,"rt",encoding="utf-8",newline="") as fh:
        reader=csv.DictReader(fh)
        pack_cols=[c for c in reader.fieldnames if c.startswith("pack_card_")]
        for row in reader:
            if row.get("event_type")!="PremierDraft" or row.get("pack_number")!="0":continue
            did=str(row["draft_id"])
            if did in reserved:continue
            try: pick_number=int(float(row.get("pick_number") or -1))
            except ValueError: continue
            if pick_number not in (0,8):continue
            counts={}
            for c in pack_cols:
                try:n=int(row.get(c) or 0)
                except ValueError:n=0
                if n>0:counts[c[len("pack_card_"):]]=n
            payload={"draft_id":did,"pick":row.get("pick",""),"offered":set(counts),"offered_counts":counts}
            if pick_number==8:
                p1p9[did]=payload
                continue
            wins=row.get("event_match_wins","").strip()
            payload.update({
              "outcome":None if wins=="" else float(wins),
              "skill":_number(row.get("user_game_win_rate_bucket","")),
              "experience":_games_lower_bound(row.get("user_n_games_bucket","")),
              "rank":row.get("rank",""),
            })
            rows.append(payload)

    if len(rows)!=EXPECTED_N: raise SystemExit(f"expected {EXPECTED_N}, got {len(rows)}")
    if len({r["draft_id"] for r in rows})!=EXPECTED_N: raise SystemExit("duplicate P1P1 draft")
    missing=sum(r["outcome"] is None for r in rows)
    complete=[r for r in rows if r["outcome"] is not None]
    y=np.asarray([r["outcome"] for r in complete],float)
    result_cards={}
    for card in CARDS:
        z=np.asarray([card in r["offered"] for r in complete],bool)
        d=np.asarray([r["pick"]==card for r in complete],float)
        rf,fs,wald,wald_se=wald_if(y,z,d)
        _,rf_se=mean_diff_se(y,z)
        zall=np.asarray([card in r["offered"] for r in rows],bool)
        dall=np.asarray([r["pick"]==card for r in rows],float)
        full_fs=float(np.mean(dall[zall])-np.mean(dall[~zall]))
        co={}
        for other in CARDS:
            if other==card:continue
            x=np.asarray([other in r["offered"] for r in rows],float)
            co[other]=float(np.mean(x[zall])-np.mean(x[~zall]))
        result_cards[card]={
          "n_present_outcome_observed":int(np.sum(z)),
          "n_absent_outcome_observed":int(np.sum(~z)),
          "n_present_full_frozen_cohort":int(np.sum(zall)),
          "reduced_form":rf,
          "reduced_form_se":rf_se,
          "reduced_form_ci99_5":[rf-Z_BONF*rf_se,rf+Z_BONF*rf_se],
          "reduced_form_ci95":[rf-Z_95*rf_se,rf+Z_95*rf_se],
          "first_stage_same_observed_outcome_rows":fs,
          "first_stage_full_frozen_cohort":full_fs,
          "missing_outcome_reduced_form_worst_case":missing_outcome_rf_bounds(rows,card),
          "wald":wald,
          "wald_se":wald_se,
          "wald_ci99_5":[wald-Z_BONF*wald_se,wald+Z_BONF*wald_se],
          "wald_ci95":[wald-Z_95*wald_se,wald+Z_95*wald_se],
          "recorded_covariate_balance_full_frozen_cohort":covariate_balance(rows,card),
          "primary_card_copresence_difference_full_frozen_cohort":co,
          "rarity_composition_diagnostic_full_frozen_cohort":rarity_contrast(rows,card,metadata),
          "p1p9_return_diagnostic_full_frozen_cohort":p1p9_diag(rows,p1p9,card),
        }

    overlap_counts=[]
    for r in rows:
        if r["draft_id"] in p1p9:
            overlap_counts.append(len(r["offered"]&p1p9[r["draft_id"]]["offered"]))
    report={
      "phase":"p1p1_eoe_randomized_pack_primary_final",
      "registered_primary_source":"research/CONTEXTUAL-VALUE-V1-P1P1-EOE-PRIMARY-2026-09-28.md",
      "registered_formula_source":"research/contextual_value_p1p1_eoe_primary.py",
      "primary_changed_after_outcomes":False,
      "archive_sha256":EXPECTED_SHA,
      "frozen_sample_size":EXPECTED_N,
      "observed_outcome_n":len(complete),
      "missing_outcome_n":missing,
      "nonterminal_or_retired_records_excluded":False,
      "primary_cards":list(CARDS),
      "familywise_method":"Bonferroni alpha .05 / 10; two-sided 99.5% CI",
      "cards":result_cards,
      "collation_diagnostics":{
        "p1p9_rows_logged":len(p1p9),
        "p1p9_row_coverage":len(p1p9)/EXPECTED_N,
        "mean_count_of_p1p1_card_names_still_present_at_p1p9":float(np.mean(overlap_counts)) if overlap_counts else None,
        "metadata_sha256":sha256(args.card_metadata),
        "rarity_composition_available":True,
        "booster_slot_provenance_available":False,
        "booster_slot_note":"17Lands records offered card counts, not the Arena slot/replacement provenance that generated those cards. No slot identity is inferred.",
      },
      "interpretation_boundary":[
        "Primary reduced form is the association induced by receiving the randomized collated P1P1 pack shock containing the focal card, under player-independent Arena pack generation.",
        "Wald additionally requires relevance, monotonicity, and approximate exclusion; it is reported separately and is more assumption-dependent.",
        "Pack presence changes the rest of the pack and can affect passed-card signals and P1P9 return behavior.",
        "This study does not compare A versus R recommendations.",
        "No additional card or environment enters the registered primary family.",
      ],
    }
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print(json.dumps({
      "sample":EXPECTED_N,"observed_outcomes":len(complete),"missing_outcomes":missing,
      "p1p9_rows":len(p1p9),
      "cards":{k:{"RF":v["reduced_form"],"RF_CI99_5":v["reduced_form_ci99_5"],"Wald":v["wald"],"Wald_CI99_5":v["wald_ci99_5"]} for k,v in result_cards.items()},
    },indent=2,sort_keys=True))

if __name__=="__main__":main()
