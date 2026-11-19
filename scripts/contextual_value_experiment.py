#!/usr/bin/env python3
"""Research-only entry point for contextual-value-v1 provenance and data audit."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from contextual_value import (
    ASSESSMENT_SHARE,
    HARM_MARGIN,
    MIN_ESS_RATIO,
    PROTOCOL_VERSION,
    SPLIT_SALT,
    TRAIN_SHARE,
    VALIDATION_SHARE,
    WEIGHT_CAPS,
)
from contextual_value.schema import inspect_archive, write_manifest


def protocol() -> dict:
    return {
        "version": PROTOCOL_VERSION,
        "outer_split_salt": SPLIT_SALT,
        "outer_split": {
            "train_percent": TRAIN_SHARE,
            "validation_percent": VALIDATION_SHARE,
            "assessment_percent": ASSESSMENT_SHARE,
        },
        "primary_outcome": "premier_event_match_wins",
        "estimand": "one_current_pick_intervention_with_natural_continuation",
        "primary_ope_sample": "one_hashed_pack_one_pick_1_through_8_decision_per_draft",
        "weight_caps": list(WEIGHT_CAPS),
        "minimum_ess_ratio": MIN_ESS_RATIO,
        "harm_margin_match_wins": HARM_MARGIN,
        "production_changes": False,
    }


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--draft-archive", type=Path)
    parser.add_argument("--game-archive", type=Path)
    parser.add_argument("--out", type=Path, default=Path("results/contextual-value-v1"))
    parser.add_argument("--print-protocol", action="store_true")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    if args.print_protocol:
        print(json.dumps(protocol(), indent=2, sort_keys=True))
    if not args.draft_archive and not args.game_archive:
        if not args.print_protocol:
            raise SystemExit("provide --draft-archive/--game-archive or --print-protocol")
        return
    manifests = []
    if args.draft_archive:
        manifests.append(inspect_archive(args.draft_archive, "draft"))
    if args.game_archive:
        manifests.append(inspect_archive(args.game_archive, "game"))
    args.out.mkdir(parents=True, exist_ok=True)
    write_manifest(manifests, args.out / "archive-manifest.json")
    (args.out / "protocol.json").write_text(
        json.dumps(protocol(), indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
