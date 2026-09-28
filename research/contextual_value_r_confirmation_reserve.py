#!/usr/bin/env python3
"""Outcome-free prior-use ledger and independent R confirmation reserve for #529."""
from __future__ import annotations

import argparse, gzip, hashlib, json, sys
from collections import defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
from contextual_value.archive import select_global_draft_ids

EXPECTED={
    "FIN":"9d5b2a3e908bb8daf0ea6e951097714b651546370a5c852893dc90a1f2f6ab8b",
    "TDM":"831ba8bc4be5eabe140fac00a8e6eaded3f3f931685be8f91403ad9cfde5cbf5",
    "DFT":"7812d16e0de78ff7a69faf9981f7ff03be4dfc618a86f14369424ec2204580cd",
}
RESERVE_START=13000
RESERVE_STOP=28000
RESERVE_N=15000

def sha256(path:Path)->str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda:f.read(1024*1024),b""): h.update(b)
    return h.hexdigest()

def parse_pair(raw:str):
    left,right=raw.split("=",1)
    return left,Path(right)

def add(ledger,draft_id,expansion,usage):
    did=str(draft_id)
    row=ledger.setdefault(did,{"draft_id":did,"expansion":str(expansion),"usage":[]})
    if row["expansion"]!=str(expansion):
        raise SystemExit(f"draft {did} appears in multiple expansions")
    if usage not in row["usage"]: row["usage"].append(usage)

def read_nuisance_ids(path:Path):
    out=set()
    with gzip.open(path,"rt",encoding="utf-8") as f:
        for line in f:
            if line.strip(): out.add(str(json.loads(line)["draft_id"]))
    return out

def digest_pairs(pairs):
    h=hashlib.sha256()
    for exp,did in sorted(pairs):
        h.update(exp.encode());h.update(b"\0");h.update(did.encode());h.update(b"\n")
    return h.hexdigest()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--core-cohort-manifest",type=Path,required=True)
    p.add_argument("--fresh-cohort-manifest",action="append",default=[],required=True)
    p.add_argument("--early-train",action="append",default=[])
    p.add_argument("--early-validation",action="append",default=[])
    p.add_argument("--draft-archive",action="append",default=[],required=True)
    p.add_argument("--output-dir",type=Path,required=True)
    args=p.parse_args()

    ledger={}
    sources=[]

    core=json.loads(args.core_cohort_manifest.read_text())
    selected=core["selected_drafts"]
    if len(selected)!=8000: raise SystemExit("core cohort is not 8000")
    for row in selected:
        exp=str(row["expansion"]); did=str(row["draft_id"]); split=str(row["split"])
        add(ledger,did,exp,"core_8000_reserved")
        add(ledger,did,exp,f"core_{split}")
        if split=="train": add(ledger,did,exp,"R_training")
        elif split=="validation": add(ledger,did,exp,"R_development_validation")
        elif split=="assessment": add(ledger,did,exp,"four_way_locked_assessment")
    sources.append({"kind":"core_8000","cohort_id":core.get("cohort_id"),"selected_drafts_sha256":core.get("selected_drafts_sha256")})

    fresh={}
    for raw in args.fresh_cohort_manifest:
        path=Path(raw); j=json.loads(path.read_text()); exp=str(j["expansion"])
        if exp in fresh: raise SystemExit(f"duplicate fresh manifest {exp}")
        fresh[exp]=j
        prior=set(map(str,j["prior_8000_ids"]))
        confirm=set(map(str,j["confirmation_ids"]))
        if len(prior)!=8000 or len(confirm)!=5000 or prior&confirm:
            raise SystemExit(f"{exp}: invalid 8k+5k boundary")
        split_map={
          "prior_train_ids":"fresh_prior_train",
          "prior_validation_ids":"fresh_prior_validation",
          "prior_assessment_ids":"fresh_prior_assessment_reserved",
        }
        for did in prior:
            add(ledger,did,exp,"fresh_prior_8000_boundary")
        for key,tag in split_map.items():
            for did in map(str,j[key]): add(ledger,did,exp,tag)
        for did in confirm:
            add(ledger,did,exp,"q_guard_20k_confirmation")
            add(ledger,did,exp,"q_guard_trust_audit")
            add(ledger,did,exp,"spent20k_variance_diagnostic")
        sources.append({"kind":"fresh_13k","expansion":exp,"draft_sha256":j["draft_sha256"]})

    for raw,tag in [(x,"early_exploratory_train") for x in args.early_train]+[(x,"early_exploratory_validation") for x in args.early_validation]:
        exp,path=parse_pair(raw)
        ids=read_nuisance_ids(path)
        for did in ids: add(ledger,did,exp,tag)
        sources.append({"kind":tag,"expansion":exp,"drafts":len(ids),"source":str(path)})

    archives={}
    for raw in args.draft_archive:
        exp,path=parse_pair(raw)
        actual=sha256(path)
        if exp not in EXPECTED or actual!=EXPECTED[exp]:
            raise SystemExit(f"{exp}: archive hash mismatch {actual}")
        archives[exp]=path

    if set(archives)!=set(EXPECTED):
        raise SystemExit(f"reserve archives must be {sorted(EXPECTED)}")
    if not set(EXPECTED).issubset(fresh):
        raise SystemExit("missing retained fresh cohort manifests")

    reserve={}
    all_reserved=set()
    for exp in sorted(EXPECTED):
        path=archives[exp]
        first13=set(map(str,select_global_draft_ids([path],RESERVE_START)))
        first28=set(map(str,select_global_draft_ids([path],RESERVE_STOP)))
        retained=set(map(str,fresh[exp]["prior_8000_ids"]))|set(map(str,fresh[exp]["confirmation_ids"]))
        if first13!=retained:
            raise SystemExit(f"{exp}: retained 13k boundary differs from current exact stable-hash reconstruction")
        ids=first28-first13
        if len(first28)!=RESERVE_STOP or len(ids)!=RESERVE_N:
            raise SystemExit(f"{exp}: reserve size mismatch first28={len(first28)} reserve={len(ids)}")
        ledger_ids={did for did,row in ledger.items() if row["expansion"]==exp}
        overlap=ids&ledger_ids
        if overlap:
            raise SystemExit(f"{exp}: reserve overlaps prior-use ledger by {len(overlap)}")
        cross=ids&all_reserved
        if cross: raise SystemExit(f"{exp}: cross-environment duplicate reserve IDs")
        all_reserved.update(ids)
        train_ids=set(map(str,fresh[exp]["prior_train_ids"]))
        reserve[exp]={
            "expansion":exp,
            "draft_sha256":EXPECTED[exp],
            "selection":"select_global_draft_ids(28000) - select_global_draft_ids(13000)",
            "prior_boundary_n":len(first13),
            "reserve_n":len(ids),
            "reserve_ids":sorted(ids),
            "prior_train_n":len(train_ids),
            "prior_train_ids":sorted(train_ids),
            "overlap_with_prior_use_ledger":0,
            "reserve_id_sha256":digest_pairs((exp,x) for x in ids),
        }

    # This ledger records outcome/model-use boundaries. The outcome-free P1P1
    # inventory scanned archives but did not spend draft outcomes and is not
    # treated as an exclusion source.
    for row in ledger.values(): row["usage"].sort()
    ledger_rows=sorted(ledger.values(),key=lambda r:(r["expansion"],r["draft_id"]))
    ledger_pairs={(r["expansion"],r["draft_id"]) for r in ledger_rows}

    args.output_dir.mkdir(parents=True,exist_ok=True)
    ledger_path=args.output_dir/"spent-draft-ledger.json.gz"
    with gzip.open(ledger_path,"wt",encoding="utf-8") as f:
        json.dump({
            "phase":"contextual_value_v1_prior_use_ledger_pre_p1p1",
            "outcomes_newly_analyzed":False,
            "note":"Outcome-free archive inventories do not spend draft outcomes. Fresh first-13k assessment-reserved IDs remain excluded conservatively even where their outcomes were not opened.",
            "sources":sources,
            "rows":ledger_rows,
        },f,sort_keys=True,separators=(",",":"))

    summary={
        "phase":"contextual_value_v1_r_confirmation_reserve",
        "new_outcomes_analyzed":False,
        "eligibility_note":"Stable-hash selection uses the established project eligibility parser, including presence of recorded event_match_wins, but no new outcome values are summarized, scored, compared, or used for model/evaluator choice.",
        "ledger":{"rows":len(ledger_rows),"pair_sha256":digest_pairs(ledger_pairs),"file_sha256":sha256(ledger_path)},
        "reserve_total":len(all_reserved),
        "reserve_pair_sha256":digest_pairs((e,x) for e,r in reserve.items() for x in r["reserve_ids"]),
        "environments":reserve,
        "EOE_excluded_from_R_confirmation":True,
        "EOE_reason":"Frozen P1P1 study consumes all 91,377 EOE drafts outside its original 13k boundary.",
    }
    out=args.output_dir/"reserve.json"
    out.write_text(json.dumps(summary,indent=2,sort_keys=True)+"\n")
    print(json.dumps({
        "ledger_rows":summary["ledger"]["rows"],
        "ledger_pair_sha256":summary["ledger"]["pair_sha256"],
        "reserve_total":summary["reserve_total"],
        "reserve_pair_sha256":summary["reserve_pair_sha256"],
        "by_environment":{e:{"n":r["reserve_n"],"sha256":r["reserve_id_sha256"]} for e,r in reserve.items()},
        "new_outcomes_analyzed":False,
    },indent=2,sort_keys=True))

if __name__=="__main__": main()
