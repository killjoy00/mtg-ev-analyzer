#!/usr/bin/env python3
"""Build one exact 5k unused confirmation cohort for #529.

The prior 8k and next 13k cohorts are both derived with the existing stable-hash
selector on a frozen archive snapshot. The confirmation IDs are exactly
first_13000 - prior_8000.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from contextual_value.archive import select_global_draft_ids
from contextual_value.dataset import draft_split

PRIOR_N = 8000
TOTAL_N = 13000
CONFIRM_N = 5000


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--expansion", required=True)
    p.add_argument("--draft-archive", type=Path, required=True)
    p.add_argument("--expected-draft-sha256", required=True)
    p.add_argument("--output", type=Path, required=True)
    return p.parse_args()


def main():
    args = parse_args()
    actual = sha256(args.draft_archive)
    if actual != args.expected_draft_sha256:
        raise SystemExit(f"archive hash mismatch: {actual} != {args.expected_draft_sha256}")

    prior = select_global_draft_ids([args.draft_archive], PRIOR_N)
    first13 = select_global_draft_ids([args.draft_archive], TOTAL_N)
    if not prior.issubset(first13):
        raise SystemExit("stable-hash nesting failure")
    confirm = first13 - prior
    if len(prior) != PRIOR_N or len(first13) != TOTAL_N or len(confirm) != CONFIRM_N:
        raise SystemExit(
            f"cohort size failure prior={len(prior)} first13={len(first13)} confirm={len(confirm)}"
        )
    if prior & confirm:
        raise SystemExit("confirmation overlaps prior cohort")

    train = frozenset(d for d in prior if draft_split(d) == "train")
    validation = frozenset(d for d in prior if draft_split(d) == "validation")
    assessment = prior - train - validation
    if not train or not validation or not assessment:
        raise SystemExit("prior 8k split reconstruction failure")

    report = {
        "phase": "q_guard10_20k_cohort",
        "expansion": args.expansion,
        "draft_sha256": actual,
        "selection": {
            "stable_hash_prior_n": PRIOR_N,
            "stable_hash_total_n": TOTAL_N,
            "confirmation_n": CONFIRM_N,
            "confirmation_rule": "select_global_draft_ids(13000) - select_global_draft_ids(8000)",
        },
        "prior_8000_ids": sorted(prior),
        "prior_train_ids": sorted(train),
        "prior_validation_ids": sorted(validation),
        "prior_assessment_ids": sorted(assessment),
        "confirmation_ids": sorted(confirm),
        "overlap_with_prior": 0,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "expansion": args.expansion,
        "prior": len(prior),
        "train": len(train),
        "validation": len(validation),
        "assessment": len(assessment),
        "confirmation": len(confirm),
        "overlap": 0,
        "draft_sha256": actual,
    }, sort_keys=True))


if __name__ == "__main__":
    main()
