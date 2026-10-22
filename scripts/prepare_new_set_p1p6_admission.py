#!/usr/bin/env python3
"""Prepare the owner-approved Reality Fracture Traditional P1P1-P1P6 component.

This only narrows the completed new-set admission artifact from run
39451056661. It does not fit a model, change a gate threshold, or mutate a
database. The full P1P1-P1P8 window failed only its late-pick (P1P7-P1P8)
low-support gate; the owner then approved serving P1P1-P1P6, following the
Powered Cube P1P2-P1P7 precedent. The restricted window is re-evaluated here
with the unchanged gates and must pass for both all and servable decisions.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

from import_all_trophies import atomic_json, digest, write_gzip_jsonl
from model_training import V5_CORPUS as PARENT, V5_MODEL as MODEL
from traditional_puzzles import THRESHOLDS, compare
from traditional_v4_revalidation import interesting

SET_ID = "fra"
SOURCE_RUN = 39451056661
RESEARCH_COMPONENT = "traditional-premier-v5-phase2-v1"
COMPONENT = "traditional-premier-v5-p1p6-v1"
POLICY = "new-set-p1p6-v5-admission-v1"
FIRST_PICK, LAST_PICK = 1, 6
EXCLUDED_PICKS = [7, 8]
# Exact bytes of the reviewed artifact; any other evidence is refused.
PINNED = {
    "admission.json": "c8286941a6092c529ec7e050333be5c2d7a0034176d6f6f1136d7312b79f0d48",
    "fra/manifest.json": "b1ebd69bbcc86c1c96e3634d54ba860718bf18227ab24ae288fb6c8289cbd0f3",
    "fra/summary.json": "a40e341a693504ea11a4a0ee8784378acb3c37966f5e3546913325f78dda3777",
    "fra/measurements.json.gz": "08bea893494289eb3838f3d40c9eb5e5ddc11dee09cd34be5c306e217b4c16d3",
    "fra/puzzles.jsonl.gz": "dd6da08a25277e4499584e2115d29170579f29a1da0b36ce56d446a24551cd5a",
    "fra/trophies.jsonl.gz": "f7449299160935beac4b9edc2391610c60fdade20ca26235b688faa1f7273cd8",
}
PREMIER_SIGNATURE = "e46af2c9e291b06be340853d75d066124516206125c7fc09cbec9b0a911c5fc1"
PREMIER_SNAPSHOT = "e906de87bc9ea951dcf746a23390387dd9a6171e4fddae87dbe450b9a3e99863"


def artifact_root(source: Path) -> Path:
    for root in (source, source / "generated" / "traditional-new-set"):
        if (root / "admission.json").is_file():
            return root
    raise ValueError("Admission artifact not found")


def read_jsonl(path: Path):
    with gzip.open(path, "rt") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def prepare(source: Path, out: Path, pinned=PINNED):
    root = artifact_root(source)
    for relative, expected in pinned.items():
        if digest(root / relative) != expected:
            raise ValueError(f"Reviewed admission artifact changed: {relative}")
    admission = json.loads((root / "admission.json").read_text())
    directory = root / SET_ID
    manifest = json.loads((directory / "manifest.json").read_text())
    with gzip.open(directory / "measurements.json.gz", "rt") as handle:
        evidence = json.load(handle)

    if (
        admission.get("set") != SET_ID
        or admission.get("premier_input_signature") != PREMIER_SIGNATURE
        or admission.get("premier_source_snapshot_id") != PREMIER_SNAPSHOT
        or admission.get("traditional_used_for_training") is not False
        or admission.get("production_changed") is not False
        or admission.get("publication_authorized") is not False
    ):
        raise ValueError("Admission record is not the reviewed FRA evidence")
    if (
        manifest.get("id") != SET_ID
        or manifest.get("component_version") != RESEARCH_COMPONENT
        or manifest.get("parent_corpus_version") != PARENT
        or manifest.get("model_version") != MODEL
        or manifest.get("model_input_signature") != PREMIER_SIGNATURE
        or manifest.get("source_event_type") != "TradDraft"
        or manifest.get("publication_authorized") is not False
    ):
        raise ValueError("Manifest is not the FRA v5 research component")
    if (
        digest(directory / "puzzles.jsonl.gz") != manifest.get("puzzle_file_sha256")
        or digest(directory / "trophies.jsonl.gz") != manifest.get("ledger_file_sha256")
    ):
        raise ValueError("FRA research artifact checksum mismatch")
    if (
        evidence.get("set") != SET_ID
        or evidence.get("parent_corpus_version") != PARENT
        or evidence.get("model_version") != MODEL
        or evidence.get("traditional_used_for_training") is not False
        or evidence.get("training_mode") != "all-qualified"
        or evidence.get("training_cap") is not None
        or evidence.get("production_input_signature") != PREMIER_SIGNATURE
        or int(evidence.get("v5_parity_picks", 0)) < 200
        or evidence.get("quality", {}).get("pass") is not True
    ):
        raise ValueError("FRA v5 evidence is incomplete")

    # Re-evaluate only the approved window with the unchanged gate function.
    window = [r for r in evidence["tests"] if FIRST_PICK <= int(r["pick"]) <= LAST_PICK]
    early = compare(window)
    serving_early = compare(interesting(window))
    if early.get("pass") is not True or serving_early.get("pass") is not True:
        raise ValueError("P1P1-P1P6 failed the unchanged gates")

    rows = read_jsonl(directory / "puzzles.jsonl.gz")
    chosen = [p for p in rows if FIRST_PICK <= int(p["pick_number"]) <= LAST_PICK]
    ledger = read_jsonl(directory / "trophies.jsonl.gz")
    included = [d for d in ledger if d.get("status") == "included"]
    width = LAST_PICK - FIRST_PICK + 1
    traditional = sum(1 for r in window if r["event"] == "TradDraft")
    if len(chosen) != width * len(included) or len(chosen) != traditional:
        raise ValueError("Restricted FRA source accounting is incomplete")

    for puzzle in chosen:
        research_id = puzzle["puzzle_id"]
        puzzle["research_puzzle_id"] = research_id
        puzzle["puzzle_id"] = hashlib.sha256(f"{COMPONENT}|{research_id}".encode()).hexdigest()[:32]
        puzzle["corpus_version"] = COMPONENT
    for row in included:
        row["puzzles"] = width
        row["excluded_pick_numbers"] = EXCLUDED_PICKS

    dest = out / SET_ID
    dest.mkdir(parents=True, exist_ok=True)
    write_gzip_jsonl(dest / "puzzles.jsonl.gz", chosen)
    write_gzip_jsonl(dest / "trophies.jsonl.gz", ledger)

    quality = {
        "pass": True,
        "unusable_fraction": evidence["quality"]["unusable_fraction"],
        "usable_traditional_puzzles": len(chosen),
    }
    report = {
        "schema": POLICY,
        "production_changed": False,
        "model_training_changed": False,
        "publication_authorized": False,
        "traditional_used_for_training": False,
        "expansion_supported": True,
        "parent_corpus_version": PARENT,
        "model_version": MODEL,
        "thresholds": THRESHOLDS,
        "source_run": SOURCE_RUN,
        "source_sha256": pinned,
        "premier_builder": admission["premier_builder"],
        "premier_source_snapshot_id": PREMIER_SNAPSHOT,
        "decision": (
            "Owner-approved restricted P1P1-P1P6 admission after the full FRA window "
            "failed only its P1P7-P1P8 low-support gate. Chosen after reviewing results, "
            "following the Powered Cube P1P2-P1P7 precedent; thresholds unchanged."
        ),
        "rejected_picks": {
            "7-8": evidence["late_picks"],
            "serving_7-8": evidence["serving_late_picks"],
            "full_window_failure_reasons": evidence["failure_reasons"],
        },
        "sets": {
            SET_ID: {
                "early_picks": early,
                "serving_early_picks": serving_early,
                "quality": quality,
                "traditional_cohort": evidence["traditional_cohort"],
                "v5_parity_picks": evidence["v5_parity_picks"],
                "production_input_signature": evidence["production_input_signature"],
                "premier_source_audit": evidence["premier_source_audit"],
                "model_version": MODEL,
                "parent_corpus_version": PARENT,
                "traditional_used_for_training": False,
                "training_mode": evidence["training_mode"],
                "training_cap": evidence["training_cap"],
                "training_drafts": evidence["training_drafts"],
                "qualified_training_drafts": evidence["qualified_training_drafts"],
                "fold_training_ids_sha256": evidence["fold_training_ids_sha256"],
            }
        },
    }
    atomic_json(out / "report.json", report)
    release_manifest = {
        **manifest,
        "component_version": COMPONENT,
        "puzzles": len(chosen),
        "serving_window": {"first_pick": FIRST_PICK, "last_pick": LAST_PICK},
        "admission_policy": POLICY,
        "research_component_version": RESEARCH_COMPONENT,
        "puzzle_file_sha256": digest(dest / "puzzles.jsonl.gz"),
        "ledger_file_sha256": digest(dest / "trophies.jsonl.gz"),
        "research_report_sha256": digest(out / "report.json"),
    }
    atomic_json(dest / "manifest.json", release_manifest)
    print(json.dumps({
        "component": COMPONENT,
        "puzzles": len(chosen),
        "servable": sum(1 for r in interesting(window) if r["event"] == "TradDraft"),
        "sources": len(included),
        "excluded_picks": EXCLUDED_PICKS,
        "v5_parity_picks": evidence["v5_parity_picks"],
    }))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    prepare(args.source, args.output)
