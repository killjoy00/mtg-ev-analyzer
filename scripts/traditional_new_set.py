#!/usr/bin/env python3
"""Evaluate a new regular-set Traditional source against an exact Premier Candidate.

Read-only admission work: no database connection, publication or model fitting
from Traditional data. The historical admission thresholds remain unchanged.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile

from corpus_promotion_provenance import verify_catalog_builder, ingestion_revision, INGESTION_RELEVANT_PATHS
from import_all_trophies import ROOT, atomic_json, digest
from model_training import V5_CORPUS, validate_training_manifest
from set_policy import require_supported_set
from traditional_v4_revalidation import measure


def builder_revision(commit, root=ROOT, paths=INGESTION_RELEVANT_PATHS):
    """Authenticate the original builder while requiring identical grading inputs.

    A schema-preflight update cannot change this read-only reconstruction. Every
    other ingestion input must still match byte-for-byte; artifact provenance is
    checked against the revision independently rebuilt from the original commit.
    """
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("A full Premier builder SHA is required")
    root = Path(root)
    with tempfile.TemporaryDirectory() as temporary:
        original = Path(temporary)
        for relative in paths:
            content = subprocess.check_output(
                ["git", "show", f"{commit}:{relative}"], cwd=root)
            if relative != 'scripts/verify-neon-schema.mjs' and content != (root / relative).read_bytes():
                raise ValueError(f"Premier grading input changed since builder: {relative}")
            destination = original / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
        return ingestion_revision(root=original, paths=paths)


def candidate_pin(root, sid, run_id, run_sha, revision):
    if not re.fullmatch(r"[a-z0-9]{2,10}", sid):
        raise ValueError("A regular set code is required")
    require_supported_set(sid)
    root = Path(root)
    catalog = json.loads((root / "catalog.json").read_text())
    verify_catalog_builder(catalog, run_id, run_sha, revision)
    matches = [row for row in catalog.get("sets", []) if row.get("id") == sid]
    if len(matches) != 1:
        raise ValueError("Premier run must contain exactly one matching set")
    path = root / sid / "manifest.json"
    pin = json.loads(path.read_text())
    if pin != matches[0]:
        raise ValueError("Premier catalog and set manifest differ")
    validate_training_manifest(pin)
    if pin.get("corpus_version") != V5_CORPUS or pin.get("source_event_type") != "PremierDraft":
        raise ValueError("Premier model/parent/event identity differs")
    if not re.fullmatch(r"[a-f0-9]{64}", pin.get("input_signature", "")):
        raise ValueError("Missing exact Premier model signature")
    base = "https://17lands-public.s3.amazonaws.com/analysis_data"
    for kind, key in (("draft", "source_archive"), ("game", "skill_source")):
        expected = f"{base}/{kind}_data/{kind}_data_public.{sid.upper()}.PremierDraft.csv.gz"
        if pin.get(key, {}).get("url") != expected:
            raise ValueError("Unexpected Premier source archive")
    for name, field in (("puzzles", "puzzle_file_sha256"), ("trophies", "ledger_file_sha256")):
        if digest(root / sid / f"{name}.jsonl.gz") != pin.get(field):
            raise ValueError("Premier artifact checksum mismatch")
    return {**pin, "_manifest_sha256": digest(path)}, catalog["builder"]


def run(args):
    pin, builder = candidate_pin(args.premier, args.set, args.run_id,
                                 args.run_sha, builder_revision(args.run_sha))
    directory = args.output / args.set
    measure(args.set, directory, args.premier, premier_pin=pin)
    summary = json.loads((directory / "summary.json").read_text())
    atomic_json(args.output / "admission.json", {
        "schema": "new-set-traditional-v5-v1",
        "set": args.set,
        "premier_builder": builder,
        "premier_input_signature": pin["input_signature"],
        "premier_source_snapshot_id": pin.get("source_snapshot_id"),
        "traditional_used_for_training": False,
        "production_changed": False,
        "publication_authorized": False,
        "admission_pass": summary["pass"],
        "failure_reasons": summary["failure_reasons"],
        "next_step": "Review admission evidence before staging a supplemental Candidate.",
    })
    if not summary["pass"]:
        raise SystemExit("Traditional admission blocked by unchanged quality gates")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--set", required=True)
    parser.add_argument("--premier", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-sha", required=True)
    parser.add_argument("--output", type=Path, default=Path("generated/traditional-new-set"))
    run(parser.parse_args())
