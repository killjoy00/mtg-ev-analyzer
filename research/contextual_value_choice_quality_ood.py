#!/usr/bin/env python3
"""Rejection-only HOB/TMT OOD stress for the frozen propensity-free J correction."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "research"))

from contextual_value.archive import (
    ArchiveSignalProvider,
    GameStore,
    load_decisions,
    select_global_draft_ids,
)
from contextual_value.dataset import draft_split
from contextual_value.features import model_feature_map
from contextual_value.nuisance import build_fold_training_rows
from contextual_value.outcome import RidgeOutcomeModel
from contextual_value.rich_features import rich_feature_bundle
from contextual_value_choice_quality_pilot import (
    arrays,
    bootstrap,
    corr,
    cv,
    draft_rows,
    metric,
    predict,
    selected_cards,
    simple_q,
)
from contextual_value_phase_a_features import _fetch_rich_set

STRONG_FIELDS = frozenset({
    "strong_choice_probability",
    "log_strong_choice_probability",
})
OUTCOME_L2 = 10.0
INNER_FEATURE_FOLDS = 5
MIN_METADATA_COVERAGE = 0.98


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--expansion", choices=("HOB", "TMT"), required=True)
    parser.add_argument("--draft-archive", type=Path, required=True)
    parser.add_argument("--game-archive", type=Path, required=True)
    parser.add_argument("--max-drafts", type=int, default=3000)
    parser.add_argument("--core-train-fold", action="append", type=Path, required=True)
    parser.add_argument(
        "--core-simple-q-prediction",
        action="append",
        type=Path,
        required=True,
    )
    parser.add_argument("--feature-report", type=Path, required=True)
    parser.add_argument("--j-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _drop_strong(row):
    return {
        key: float(value)
        for key, value in row.items()
        if key not in STRONG_FIELDS
    }


def _drop_strong_map(features):
    return {
        action: _drop_strong(row)
        for action, row in features.items()
    }


def _argmax(values, names):
    return min(
        range(len(names)),
        key=lambda index: (-float(values[index]), str(names[index])),
    )


def _fit_frozen_j(args):
    j_report = json.loads(args.j_report.read_text(encoding="utf-8"))
    if j_report.get("assessment_opened") is not False:
        raise SystemExit("J freeze report violated assessment boundary")
    simple_q_source = str(j_report.get("spec", {}).get("simple_q_source") or "")
    if not simple_q_source.startswith("strong_offset_only"):
        raise SystemExit("J freeze report does not use the corrected strong-offset-only Q")

    paths = sorted(args.core_train_fold)
    if len(paths) != 5:
        raise SystemExit("J OOD freeze requires exactly five core training folds")
    cards = selected_cards(paths)
    qmap = simple_q(sorted(args.core_simple_q_prediction), cards)
    train = []
    folds = set()
    for path in paths:
        with np.load(path, allow_pickle=False) as data:
            fold = int(data["fold"][0])
            if fold not in range(5) or "q_simple" in data.files:
                raise SystemExit("unexpected core training fold contract")
        folds.add(fold)
        train.extend(draft_rows(path, qmap=qmap, fold=fold))
    if folds != set(range(5)) or len(train) != 4789:
        raise SystemExit("core J training cohort mismatch")

    cv_report, model = cv(train)
    expected_l2 = float(j_report["model"]["chosen_l2"])
    if float(cv_report["chosen_l2"]) != expected_l2:
        raise SystemExit(
            f"frozen J L2 mismatch: recomputed={cv_report['chosen_l2']} report={expected_l2}"
        )

    mean, scale, active, intercept, beta = model
    payload = {
        "chosen_l2": expected_l2,
        "mean": mean.tolist(),
        "scale": scale.tolist(),
        "active": active.astype(int).tolist(),
        "intercept": float(intercept),
        "beta": beta.tolist(),
    }
    fingerprint = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return model, cv_report, fingerprint, j_report


def _load_ood(args):
    selected_ids = select_global_draft_ids([args.draft_archive], args.max_drafts)
    if not selected_ids:
        raise SystemExit("OOD archive produced no selected draft IDs")
    development_ids = frozenset(
        draft_id
        for draft_id in selected_ids
        if draft_split(draft_id) in {"train", "validation"}
    )
    assessment_ids = frozenset(selected_ids) - development_ids
    if not development_ids:
        raise SystemExit("OOD archive produced no development IDs")

    decisions = load_decisions(args.draft_archive, keep_ids=development_ids)
    if any(decision.expansion != args.expansion for decision in decisions):
        raise SystemExit("OOD archive expansion mismatch")
    if any(decision.draft_id in assessment_ids for decision in decisions):
        raise SystemExit("assessment draft entered OOD development decisions")

    games = GameStore.from_archives([args.game_archive], development_ids)
    train = [row for row in decisions if draft_split(row.draft_id) == "train"]
    validation = [
        row for row in decisions if draft_split(row.draft_id) == "validation"
    ]
    if not train or not validation:
        raise SystemExit("OOD split missing train or validation drafts")
    return selected_ids, assessment_ids, decisions, games, train, validation


def _fit_ood_q(decisions, games, train):
    provider = ArchiveSignalProvider(decisions, games)
    train_ids = frozenset(row.draft_id for row in train)
    rows = build_fold_training_rows(
        train,
        train_ids,
        signal_provider=provider,
        inner_feature_folds=INNER_FEATURE_FOLDS,
    )
    outcome_rows = [
        _drop_strong(row.features[row.selected_action])
        for row in rows
    ]
    model = RidgeOutcomeModel.fit(
        outcome_rows,
        [row.outcome for row in rows],
        sample_weights=[row.sample_weight for row in rows],
        l2=OUTCOME_L2,
    )
    leaked = STRONG_FIELDS & set(model.feature_names)
    if leaked:
        raise SystemExit(f"strong-player ranking fields leaked into OOD Q: {sorted(leaked)}")
    return provider, train_ids, model, len(rows)


def _metadata(expansion, validation):
    primary = [
        row for row in validation
        if int(row.pack_number) == 0 and int(row.pick_number) < 8
    ]
    if not primary:
        raise SystemExit("OOD validation has no P1P1-P1P8 decisions")
    wanted = set()
    for decision in primary:
        wanted.update(decision.candidates)
        wanted.update(name for name, _count in decision.pool)
    resolved, unresolved = _fetch_rich_set(expansion, wanted)
    coverage = len(resolved) / max(1, len(wanted))
    if coverage < MIN_METADATA_COVERAGE:
        raise SystemExit(
            f"{expansion}: metadata coverage {coverage:.2%} below {MIN_METADATA_COVERAGE:.2%}"
        )
    return resolved, unresolved, coverage, primary


def _evaluate(
    expansion,
    validation,
    provider,
    train_ids,
    q_model,
    metadata,
    candidate_feature_names,
    j_model,
):
    schema = set(candidate_feature_names)
    mean, scale, active, _intercept, beta = j_model
    raw = np.zeros(len(candidate_feature_names), dtype=np.float64)
    raw[active] = beta / scale[active]

    by_draft = defaultdict(lambda: {
        "x": [],
        "base": [],
        "y": None,
        "Jreg": [],
        "Freg": [],
    })
    agreement = defaultdict(int)
    decisions = 0
    unknown_features = set()

    for decision in validation:
        if int(decision.pack_number) != 0 or int(decision.pick_number) >= 8:
            continue
        signals = provider(decision, train_ids)
        full_features = model_feature_map(decision, signals)
        q_features = _drop_strong_map(full_features)
        q_values = {
            candidate: float(q_model.predict(q_features[candidate]))
            for candidate in decision.candidates
        }
        _state, rich_candidates = rich_feature_bundle(
            decision,
            full_features,
            metadata,
        )
        for row in rich_candidates.values():
            unknown_features.update(set(row) - schema)
        if unknown_features:
            raise SystemExit(
                "OOD candidate feature schema contains unknown fields: "
                + ",".join(sorted(unknown_features)[:10])
            )

        names = list(decision.candidates)
        x = np.asarray([
            [float(rich_candidates[name].get(feature, 0.0)) for feature in candidate_feature_names]
            for name in names
        ], dtype=np.float64)
        pack_mean = x.mean(axis=0)
        correction_scores = (x - pack_mean) @ raw
        q = np.asarray([q_values[name] for name in names], dtype=np.float64)

        hist = names.index(decision.selected_card)
        j = _argmax(q + correction_scores, names)
        f = _argmax(q, names)
        strong = np.asarray([
            float(
                signals.get(name).strong_choice_probability
                if signals.get(name) is not None
                and signals.get(name).strong_choice_probability is not None
                else 0.0
            )
            for name in names
        ])
        a = _argmax(strong, names)

        agreement["J_eq_F"] += int(j == f)
        agreement["J_eq_A"] += int(j == a)
        agreement["J_eq_hist"] += int(j == hist)
        decisions += 1

        row = by_draft[decision.draft_id]
        row["x"].append(x[hist] - pack_mean)
        row["base"].append(float(q[hist]))
        row["Jreg"].append(float((q[j] + correction_scores[j]) - (q[hist] + correction_scores[hist])))
        row["Freg"].append(float(q[f] - q[hist]))
        outcome = float(decision.event_match_wins)
        if row["y"] is not None and abs(float(row["y"]) - outcome) > 1e-12:
            raise SystemExit("draft outcome changed across decisions")
        row["y"] = outcome

    rows = []
    for draft_id, value in by_draft.items():
        xbar = np.mean(np.asarray(value["x"], dtype=np.float64), axis=0)
        base = float(np.mean(value["base"]))
        correction = float(predict(j_model, xbar[None, :])[0])
        rows.append({
            "draft_id": draft_id,
            "y": float(value["y"]),
            "base": base,
            "correction": correction,
            "augmented": base + correction,
            "Jreg": float(np.mean(value["Jreg"])),
            "Freg": float(np.mean(value["Freg"])),
            "n": len(value["base"]),
        })
    if not rows:
        raise SystemExit("OOD validation has no evaluable primary drafts")

    y = np.asarray([row["y"] for row in rows], dtype=np.float64)
    base = np.asarray([row["base"] for row in rows], dtype=np.float64)
    correction = np.asarray([row["correction"] for row in rows], dtype=np.float64)
    augmented = np.asarray([row["augmented"] for row in rows], dtype=np.float64)
    base_error = base - y
    augmented_error = augmented - y
    boot = bootstrap(base_error, augmented_error)
    residual = y - base
    result = {
        "drafts": len(rows),
        "decisions": decisions,
        "mean_primary_decisions_per_draft": float(np.mean([row["n"] for row in rows])),
        "base": metric(y, base),
        "augmented": metric(y, augmented),
        "correction_corr": corr(correction, residual),
        "correction_std": float(np.std(correction)),
        "bootstrap": boot,
        "ranking_agreement": {
            key: float(value / decisions)
            for key, value in sorted(agreement.items())
        },
        "J_regret_corr": corr(
            np.asarray([row["Jreg"] for row in rows]),
            residual,
        ),
        "F_regret_corr": corr(
            np.asarray([row["Freg"] for row in rows]),
            residual,
        ),
    }
    result["rejection_only"] = {
        "rule": (
            "J is rejected in this environment if frozen-J augmented MSE is not "
            "lower than the strong-offset-only Q baseline. No OOD result may "
            "change J coefficients, L2, features, or thresholds."
        ),
        "mse_delta": float(boot["mse_delta"]),
        "direction_survives": bool(float(boot["mse_delta"]) < 0.0),
        "ci95_excludes_non_improvement": bool(float(boot["mse_ci95"][1]) < 0.0),
    }
    return result


def main():
    args = parse_args()
    if args.max_drafts < 500:
        raise SystemExit("max_drafts must be at least 500")
    feature_report = json.loads(args.feature_report.read_text(encoding="utf-8"))
    if feature_report.get("assessment_opened") is not False:
        raise SystemExit("feature contract violated assessment boundary")
    if feature_report.get("ranking_strong_player_features_removed") is not True:
        raise SystemExit("feature contract retained strong-player ranking fields")
    candidate_feature_names = list(feature_report["candidate_feature_names"])
    if any("strong_choice_probability" in name for name in candidate_feature_names):
        raise SystemExit("strong-player ranking field in frozen J candidate schema")

    # Freeze/reconstruct J entirely from core training artifacts before any
    # HOB/TMT decision or outcome object is loaded.
    j_model, core_cv, j_fingerprint, j_report = _fit_frozen_j(args)

    draft_sha = sha256(args.draft_archive)
    game_sha = sha256(args.game_archive)
    selected_ids, assessment_ids, decisions, games, train, validation = _load_ood(args)
    provider, train_ids, q_model, q_training_rows = _fit_ood_q(
        decisions,
        games,
        train,
    )
    metadata, unresolved, metadata_coverage, _primary = _metadata(
        args.expansion,
        validation,
    )
    result = _evaluate(
        args.expansion,
        validation,
        provider,
        train_ids,
        q_model,
        metadata,
        candidate_feature_names,
        j_model,
    )

    report = {
        "phase": "frozen_J_historical_ood_outcome_residual_stress",
        "scope": "historical_ood_validation_only",
        "expansion": args.expansion,
        "assessment_opened": False,
        "assessment_outcomes_loaded": False,
        "assessment_outcomes_used": False,
        "propensity_used_for_fit": False,
        "propensity_used_for_primary_evidence": False,
        "ood_used_for_J_tuning": False,
        "j_frozen_before_ood_outcomes_loaded": True,
        "archive_snapshot": {
            "draft_sha256": draft_sha,
            "game_sha256": game_sha,
            "max_drafts": args.max_drafts,
        },
        "cohort": {
            "selected_drafts": len(selected_ids),
            "train_drafts": len({row.draft_id for row in train}),
            "validation_drafts": len({row.draft_id for row in validation}),
            "assessment_drafts_withheld": len(assessment_ids),
        },
        "frozen_J": {
            "source_phase": j_report.get("phase"),
            "source_simple_q": j_report["spec"]["simple_q_source"],
            "chosen_l2": float(core_cv["chosen_l2"]),
            "active_features": int(j_model[2].sum()),
            "candidate_feature_count": len(candidate_feature_names),
            "fingerprint_sha256": j_fingerprint,
        },
        "ood_Q": {
            "family": "ridge_outcome_model",
            "l2": OUTCOME_L2,
            "training_rows": q_training_rows,
            "inner_feature_folds": INNER_FEATURE_FOLDS,
            "strong_player_ranking_features": "removed",
            "strong_player_behavior_signal": "not used for primary OOD outcome-residual evidence",
        },
        "metadata": {
            "coverage": metadata_coverage,
            "unresolved_count": len(unresolved),
            "unresolved": unresolved,
        },
        "outcome_residual": result,
        "next_gate": {
            "assessment_authorized": False,
            "model_tuning_authorized": False,
            "status": (
                "direction_survives"
                if result["rejection_only"]["direction_survives"]
                else "rejected_on_ood_direction"
            ),
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "expansion": args.expansion,
        "drafts": result["drafts"],
        "base_rmse": result["base"]["rmse"],
        "augmented_rmse": result["augmented"]["rmse"],
        "mse_delta": result["bootstrap"]["mse_delta"],
        "mse_ci95": result["bootstrap"]["mse_ci95"],
        "mae_delta": result["bootstrap"]["mae_delta"],
        "correction_corr": result["correction_corr"],
        "direction_survives": result["rejection_only"]["direction_survives"],
        "assessment_opened": False,
    }, indent=2))


if __name__ == "__main__":
    main()
