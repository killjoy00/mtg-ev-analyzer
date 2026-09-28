#!/usr/bin/env python3
"""Frozen EOE P1P1 randomized-pack primary analysis for issue #529.

Do not run until the preregistered outcome-opening gate is authorized.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from contextual_value.dataset import _games_lower_bound, _number

EXPECTED_SHA="1dd9d1baf31fa56e06bbd2d9d9bb8c2c87cf342bc15872b5a30dbe9d4ecab648"
EXPECTED_N=91377
Z_BONF=2.807033768343811
Z_95=1.959963984540054
CARDS=(
    "Elegy Acolyte","Nova Hellkite","Anticausal Vestige","Lumen-Class Frigate",
    "Genemorph Imago","Possibility Technician","Warmaker Gunship",
    "Sunstar Chaplain","Thrumming Hivepool","Mightform Harmonizer",
)


def parse_args():
    p=argparse.ArgumentParser()
    p.add_argument("--draft-archive",type=Path,required=True)
    p.add_argument("--cohort-manifest",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    return p.parse_args()


def sha256(path):
    h=hashlib.sha256()
    with path.open("rb") as fh:
        for b in iter(lambda:fh.read(1024*1024),b""):h.update(b)
    return h.hexdigest()


def mean_diff_se(y,z):
    y=np.asarray(y,float);z=np.asarray(z,bool)
    y1=y[z];y0=y[~z]
    d=float(np.mean(y1)-np.mean(y0))
    se=math.sqrt(float(np.var(y1,ddof=1)/len(y1)+np.var(y0,ddof=1)/len(y0)))
    return d,se


def wald_if(y,z,d):
    y=np.asarray(y,float);z=np.asarray(z,bool);d=np.asarray(d,float)
    p=float(np.mean(z))
    mu_y1=float(np.mean(y[z]));mu_y0=float(np.mean(y[~z]))
    mu_d1=float(np.mean(d[z]));mu_d0=float(np.mean(d[~z]))
    rf=mu_y1-mu_y0; fs=mu_d1-mu_d0
    if abs(fs)<1e-12: return rf,fs,float("nan"),float("nan")
    theta=rf/fs
    if_rf=np.where(z,(y-mu_y1)/p,-(y-mu_y0)/(1-p))
    if_fs=np.where(z,(d-mu_d1)/p,-(d-mu_d0)/(1-p))
    influence=(if_rf-theta*if_fs)/fs
    se=float(np.std(influence,ddof=1)/math.sqrt(len(y)))
    return rf,fs,theta,se


def standardized_difference(x,z):
    x=np.asarray(x,float);z=np.asarray(z,bool)
    a=x[z];b=x[~z]
    denom=math.sqrt((float(np.var(a,ddof=1))+float(np.var(b,ddof=1)))/2)
    return float((np.mean(a)-np.mean(b))/denom) if denom>0 else 0.0


def main():
    args=parse_args()
    if sha256(args.draft_archive)!=EXPECTED_SHA:
        raise SystemExit("EOE archive hash mismatch")
    cohort=json.loads(args.cohort_manifest.read_text())
    if cohort.get("expansion")!="EOE":
        raise SystemExit("wrong cohort manifest")
    reserved=set(map(str,cohort["prior_8000_ids"]))|set(map(str,cohort["confirmation_ids"]))
    if len(reserved)!=13000:
        raise SystemExit("EOE reserved boundary is not 13,000")

    rows=[]
    with gzip.open(args.draft_archive,"rt",encoding="utf-8",newline="") as fh:
        reader=csv.DictReader(fh)
        pack_cols=[c for c in reader.fieldnames if c.startswith("pack_card_")]
        for row in reader:
            if row.get("event_type")!="PremierDraft":continue
            if row.get("pack_number")!="0" or row.get("pick_number")!="0":continue
            did=str(row["draft_id"])
            if did in reserved:continue
            wins=row.get("event_match_wins","").strip()
            if wins=="": outcome=None
            else: outcome=float(wins)
            offered={c[len("pack_card_"):] for c in pack_cols if int(row.get(c) or 0)>0}
            rows.append({
                "draft_id":did,
                "outcome":outcome,
                "pick":row.get("pick",""),
                "offered":offered,
                "skill":_number(row.get("user_game_win_rate_bucket","")),
                "experience":_games_lower_bound(row.get("user_n_games_bucket","")),
                "rank":row.get("rank",""),
            })
    if len(rows)!=EXPECTED_N:
        raise SystemExit(f"expected {EXPECTED_N} untouched EOE P1P1 drafts, got {len(rows)}")
    missing=sum(r["outcome"] is None for r in rows)
    complete=[r for r in rows if r["outcome"] is not None]
    if missing:
        # Primary point estimates use observed outcome rows but missingness is never
        # hidden; bounds/sensitivity must accompany interpretation.
        pass
    y=np.asarray([r["outcome"] for r in complete],float)
    result_cards={}
    for card in CARDS:
        z=np.asarray([card in r["offered"] for r in complete],bool)
        d=np.asarray([r["pick"]==card for r in complete],float)
        rf,fs,wald,wald_se=wald_if(y,z,d)
        _,rf_se=mean_diff_se(y,z)
        balance={}
        for name in ("skill","experience"):
            vals=[r[name] for r in complete]
            if all(v is not None for v in vals):
                balance[name+"_standardized_difference"]=standardized_difference(vals,z)
        # Collation association with other primary cards.
        co={}
        for other in CARDS:
            if other==card:continue
            x=np.asarray([other in r["offered"] for r in complete],float)
            co[other]=float(np.mean(x[z])-np.mean(x[~z]))
        result_cards[card]={
            "n_present":int(np.sum(z)),"n_absent":int(np.sum(~z)),
            "reduced_form":rf,
            "reduced_form_se":rf_se,
            "reduced_form_ci99_5":[rf-Z_BONF*rf_se,rf+Z_BONF*rf_se],
            "reduced_form_ci95":[rf-Z_95*rf_se,rf+Z_95*rf_se],
            "first_stage":fs,
            "wald":wald,
            "wald_se":wald_se,
            "wald_ci99_5":[wald-Z_BONF*wald_se,wald+Z_BONF*wald_se],
            "wald_ci95":[wald-Z_95*wald_se,wald+Z_95*wald_se],
            "recorded_covariate_balance":balance,
            "primary_card_copresence_difference":co,
        }
    report={
        "phase":"p1p1_eoe_randomized_pack_primary",
        "archive_sha256":EXPECTED_SHA,
        "frozen_sample_size":EXPECTED_N,
        "observed_outcome_n":len(complete),
        "missing_outcome_n":missing,
        "primary_cards":list(CARDS),
        "familywise_method":"Bonferroni alpha .05 / 10; two-sided 99.5% CI",
        "cards":result_cards,
        "interpretation_boundary":[
            "Reduced form is effect of randomized collated pack shock containing card, under player-independent pack generation.",
            "Wald ratio additionally requires relevance, monotonicity and approximate exclusion.",
            "Do not condition on event completion.",
        ],
    }
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print(json.dumps({"missing_outcomes":missing,"cards":{k:{"RF":v["reduced_form"],"Wald":v["wald"]} for k,v in result_cards.items()}},indent=2))


if __name__=="__main__":
    main()
