#!/usr/bin/env python3
"""Outcome-free P1P1 inventory for #529.

Reads only draft identity, event/position, selected card, and offered-pack
columns. It never reads match wins/losses, rank, skill, or other outcomes.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
from collections import Counter
from pathlib import Path


def parse_args():
    p=argparse.ArgumentParser()
    p.add_argument("--expansion",required=True)
    p.add_argument("--draft-archive",type=Path,required=True)
    p.add_argument("--reserved-id-file",action="append",type=Path,default=[])
    p.add_argument("--first-rows",type=int,default=300000)
    p.add_argument("--output",type=Path,required=True)
    return p.parse_args()


def sha256(path):
    h=hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda:fh.read(1024*1024),b""): h.update(block)
    return h.hexdigest()


def load_reserved(paths):
    out=set()
    provenance=[]
    for path in paths:
        before=len(out)
        for line in path.read_text().splitlines():
            value=line.strip()
            if value: out.add(value)
        provenance.append({"path":str(path),"added":len(out)-before})
    return out,provenance


def parse_int(value):
    try:return int(value)
    except:return None


def main():
    args=parse_args()
    reserved,reserved_provenance=load_reserved(args.reserved_id_file)
    with gzip.open(args.draft_archive,"rt",encoding="utf-8",newline="") as handle:
        reader=csv.reader(handle)
        header=next(reader)
        positions={name:i for i,name in enumerate(header)}
        required=("draft_id","event_type","pack_number","pick_number","pick")
        missing=[x for x in required if x not in positions]
        if missing: raise SystemExit(f"missing columns: {missing}")
        pack_columns=[
            (name[len("pack_card_"):],i)
            for i,name in enumerate(header)
            if name.startswith("pack_card_")
        ]
        rows=0
        all_drafts=set(); first_drafts=set()
        p1p1_drafts=set(); p1p1_first=set()
        p1p1_rows=0
        pack_sizes=Counter()
        presence=Counter(); taken_when_present=Counter(); selected=Counter()
        untouched_presence=Counter(); untouched_taken=Counter(); untouched_selected=Counter()
        for values in reader:
            rows+=1
            if len(values)!=len(header): continue
            if values[positions["event_type"]].strip()!="PremierDraft": continue
            draft_id=values[positions["draft_id"]].strip()
            if not draft_id: continue
            all_drafts.add(draft_id)
            if rows<=args.first_rows: first_drafts.add(draft_id)
            pack=parse_int(values[positions["pack_number"]])
            pick=parse_int(values[positions["pick_number"]])
            if pack!=0 or pick!=0: continue
            p1p1_rows+=1
            p1p1_drafts.add(draft_id)
            if rows<=args.first_rows: p1p1_first.add(draft_id)
            chosen=values[positions["pick"]].strip()
            offered=[]
            for card,index in pack_columns:
                count=parse_int(values[index]) or 0
                if count>0: offered.extend([card]*count)
            unique=set(offered)
            pack_sizes[len(offered)]+=1
            for card in unique: presence[card]+=1
            if chosen:
                selected[chosen]+=1
                if chosen in unique: taken_when_present[chosen]+=1
            if draft_id not in reserved:
                for card in unique: untouched_presence[card]+=1
                if chosen:
                    untouched_selected[chosen]+=1
                    if chosen in unique: untouched_taken[chosen]+=1

    total_untouched_picks=sum(untouched_selected.values())
    stats=[]
    for card,n in untouched_presence.items():
        takes=untouched_taken[card]
        stats.append({
            "card":card,
            "presence":int(n),
            "takes":int(takes),
            "take_rate":takes/n if n else None,
            "selected_share":untouched_selected[card]/total_untouched_picks if total_untouched_picks else 0.0,
        })
    stats.sort(key=lambda r:(-r["takes"],r["card"]))
    contested=[r for r in stats if r["take_rate"] is not None and r["take_rate"]>=0.30]
    report={
        "phase":"p1p1_outcome_free_inventory",
        "outcomes_read":False,
        "expansion":args.expansion,
        "archive_sha256":sha256(args.draft_archive),
        "rows_scanned":rows,
        "premier_drafts_seen":len(all_drafts),
        "p1p1":{
            "rows":p1p1_rows,
            "unique_drafts":len(p1p1_drafts),
            "coverage_fraction_of_seen_drafts":len(p1p1_drafts)/max(1,len(all_drafts)),
            "first_rows_scanned":min(rows,args.first_rows),
            "first_rows_premier_drafts":len(first_drafts),
            "first_rows_p1p1_drafts":len(p1p1_first),
            "first_rows_coverage_fraction":len(p1p1_first)/max(1,len(first_drafts)),
            "pack_size_distribution":dict(sorted(pack_sizes.items())),
        },
        "reserved":{
            "ids_loaded":len(reserved),
            "p1p1_ids_excluded":len(p1p1_drafts & reserved),
            "untouched_p1p1_drafts":len(p1p1_drafts-reserved),
            "provenance":reserved_provenance,
        },
        "untouched_card_stats":{
            "cards_seen":len(stats),
            "cards_take_rate_at_least_0_30":len(contested),
            "share_of_untouched_p1p1_picks_from_take_rate_at_least_0_30_cards":sum(r["selected_share"] for r in contested),
            "top_cards":stats[:100],
        },
    }
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print(json.dumps({
        "expansion":args.expansion,
        "archive_sha256":report["archive_sha256"],
        "p1p1":report["p1p1"],
        "reserved":report["reserved"],
        "contested_cards":report["untouched_card_stats"]["cards_take_rate_at_least_0_30"],
        "contested_pick_share":report["untouched_card_stats"]["share_of_untouched_p1p1_picks_from_take_rate_at_least_0_30_cards"],
    },indent=2,sort_keys=True))


if __name__=="__main__":
    main()
