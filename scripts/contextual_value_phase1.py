#!/usr/bin/env python3
"""Run the development-only contextual-value-v1 archive experiment.

This command reads local 17Lands Draft + Game archives, fits only on the frozen
train partition, tunes only on validation, and writes research artifacts. The
locked assessment partition is counted but never scored.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from contextual_value.archive import ArchiveSignalProvider, GameStore, load_decisions
from contextual_value.pipeline import run_development
from contextual_value.schema import inspect_archive, write_manifest


def _write_predictions(path: Path, predictions) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        for prediction in predictions:
            handle.write(json.dumps(asdict(prediction), sort_keys=True) + "\n")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--draft-archive", required=True, type=Path)
    parser.add_argument("--game-archive", required=True, type=Path)
    parser.add_argument("--out", type=Path, default=Path("results/contextual-value-v1"))
    parser.add_argument("--max-drafts", type=int,
                        help="deterministic development cap for smoke runs; omit for full archive")
    parser.add_argument("--nuisance-folds", type=int, default=5)
    parser.add_argument("--inner-feature-folds", type=int, default=5)
    parser.add_argument("--propensity-l2", type=float, default=1.0)
    parser.add_argument("--outcome-l2", type=float, default=10.0)
    parser.add_argument("--value-l2", type=float, default=10.0)
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    draft_manifest = inspect_archive(args.draft_archive, "draft")
    game_manifest = inspect_archive(args.game_archive, "game")
    decisions = load_decisions(args.draft_archive, max_drafts=args.max_drafts)
    if not decisions:
        raise SystemExit("draft archive produced no eligible broad-population decisions")
    draft_ids = frozenset(row.draft_id for row in decisions)
    games = GameStore.from_archive(args.game_archive, draft_ids)
    if not games.drafts:
        raise SystemExit("no eligible draft IDs matched the game archive")

    provider = ArchiveSignalProvider(decisions, games)
    report, train_predictions, validation_predictions, value_model = run_development(
        decisions,
        signal_provider=provider,
        nuisance_folds=args.nuisance_folds,
        inner_feature_folds=args.inner_feature_folds,
        propensity_l2=args.propensity_l2,
        outcome_l2=args.outcome_l2,
        value_l2=args.value_l2,
    )

    args.out.mkdir(parents=True, exist_ok=True)
    write_manifest([draft_manifest, game_manifest], args.out / "archive-manifest.json")
    (args.out / "development-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    _write_predictions(args.out / "train-nuisance.jsonl.gz", train_predictions)
    _write_predictions(args.out / "validation-nuisance.jsonl.gz", validation_predictions)
    (args.out / "value-model.json").write_text(
        json.dumps({
            "feature_names": list(value_model.regression.feature_names),
            "coefficients": list(value_model.regression.coefficients),
            "training_draft_count": value_model.training_draft_count,
            "training_weight_cap": value_model.training_weight_cap,
            "l2": value_model.l2,
            "assessment_opened": False,
        }, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "decisions": len(decisions),
        "drafts": len(draft_ids),
        "game_drafts_matched": len(games.drafts),
        "assessment_opened": False,
        "selected_temperature": report["models"]["G_contextual_value"][
            "selected_validation_temperature"
        ],
        "selected_simple_blend": report["models"]["E_simple_behavior_outcome_blend"][
            "selected_validation_config"
        ],
        "out": str(args.out),
    }, indent=2))


if __name__ == "__main__":
    main()
