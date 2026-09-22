#!/usr/bin/env python3
"""Prepare the leakage-corrected v4 Powered Cube P1P2-P1P7 release artifact.

This only narrows the already-completed v4 research artifact. It does not fit a
model, change any gate, or mutate production.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

from import_all_trophies import atomic_json, digest, write_gzip_jsonl
from traditional_puzzles import THRESHOLDS
from traditional_v4_revalidation import CUBE_COMPONENT, COMPONENT, MODEL, PARENT

SOURCE_RUN = 35662906382
POLICY = "cube-p2p7-v4-admission-v1"


def prepare(source: Path, out: Path):
    manifest = json.loads((source / "manifest.json").read_text())
    with gzip.open(source / "measurements.json.gz", "rt") as handle:
        evidence = json.load(handle)

    if (
        manifest.get("id") != "powered-cube"
        or manifest.get("component_version") != COMPONENT
        or manifest.get("parent_corpus_version") != PARENT
        or manifest.get("model_version") != MODEL
        or manifest.get("publication_authorized") is not False
    ):
        raise ValueError("Source is not the pinned v4 Powered Cube research component")
    if (
        evidence.get("set") != "powered-cube"
        or evidence.get("parent_corpus_version") != PARENT
        or evidence.get("model_version") != MODEL
        or evidence.get("traditional_used_for_training") is not False
        or evidence.get("production_input_signature") != manifest.get("model_input_signature")
        or int(evidence.get("v8_parity_picks", 0)) < 200
        or evidence.get("cube_snapshot", {}).get("pass") is not True
    ):
        raise ValueError("Corrected v4 Cube evidence is incomplete")
    window = evidence.get("cube_windows", {}).get("p2_p7", {})
    if window.get("pass") is not True:
        raise ValueError("P1P2-P1P7 failed the frozen v4 gates")

    with gzip.open(source / "puzzles.jsonl.gz", "rt") as handle:
        rows = [json.loads(line) for line in handle if line.strip()]
    chosen = [p for p in rows if 2 <= int(p["pick_number"]) <= 7]
    expected = int(window.get("quality", {}).get("usable_traditional_puzzles", -1))
    if len(chosen) != expected:
        raise ValueError("Restricted Cube inventory differs from measured P1P2-P1P7 evidence")

    with gzip.open(source / "trophies.jsonl.gz", "rt") as handle:
        ledger = [json.loads(line) for line in handle if line.strip()]
    included = [d for d in ledger if d.get("status") == "included"]
    if len(chosen) != 6 * len(included):
        raise ValueError("Restricted Cube source accounting is incomplete")

    for puzzle in chosen:
        research_id = puzzle["puzzle_id"]
        puzzle["research_puzzle_id"] = research_id
        puzzle["puzzle_id"] = hashlib.sha256(
            f"{CUBE_COMPONENT}|{research_id}".encode()
        ).hexdigest()[:32]
        puzzle["corpus_version"] = CUBE_COMPONENT
    for row in included:
        row["puzzles"] = 6
        row["excluded_pick_numbers"] = [8, 9]

    dest = out / "powered-cube"
    dest.mkdir(parents=True, exist_ok=True)
    write_gzip_jsonl(dest / "puzzles.jsonl.gz", chosen)
    write_gzip_jsonl(dest / "trophies.jsonl.gz", ledger)

    report = {
        "schema": POLICY,
        "production_changed": False,
        "model_training_changed": False,
        "publication_authorized": False,
        "expansion_supported": True,
        "thresholds": THRESHOLDS,
        "source_run": SOURCE_RUN,
        "source_measurements_sha256": digest(source / "measurements.json.gz"),
        "decision": (
            "Restricted P1P2-P1P7 admission from the completed leakage-corrected "
            "v4 revalidation; P1P8-P1P9 remain excluded."
        ),
        "rejected_picks": {
            "8-9": evidence["cube_windows"]["p8_p9"],
            "8": evidence["cube_windows"]["p8"],
            "9": evidence["cube_windows"]["p9"],
        },
        "sets": {
            "powered-cube": {
                "all_picks": window["all_picks"],
                "serving_picks": window["serving_picks"],
                "quality": window["quality"],
                "snapshot": evidence["cube_snapshot"],
                "traditional_cohort": evidence["traditional_cohort"],
                "v8_parity_picks": evidence["v8_parity_picks"],
                "production_input_signature": evidence["production_input_signature"],
                "premier_source_audit": evidence["premier_source_audit"],
            }
        },
    }
    atomic_json(out / "report.json", report)
    release_manifest = {
        **manifest,
        "component_version": CUBE_COMPONENT,
        "puzzles": len(chosen),
        "serving_window": {"first_pick": 2, "last_pick": 7},
        "admission_policy": POLICY,
        "research_component_version": manifest["component_version"],
        "puzzle_file_sha256": digest(dest / "puzzles.jsonl.gz"),
        "ledger_file_sha256": digest(dest / "trophies.jsonl.gz"),
        "research_report_sha256": digest(out / "report.json"),
    }
    atomic_json(dest / "manifest.json", release_manifest)
    print(json.dumps({
        "component": CUBE_COMPONENT,
        "puzzles": len(chosen),
        "sources": len(included),
        "excluded_picks": [8, 9],
        "v8_parity_picks": evidence["v8_parity_picks"],
    }))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    prepare(args.source, args.output)
