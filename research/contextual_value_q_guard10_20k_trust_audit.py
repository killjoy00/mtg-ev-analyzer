#!/usr/bin/env python3
"""Post-confirmation trust audit for frozen A/Q/Guard-10 on one 5k environment.

The registered 20k result is final. This script reconstructs the exact frozen
policies and evaluator, requires parity with the retained environment report,
then emits support/calibration/influence/outcome-completeness diagnostics.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import pickle
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "research"))

from contextual_value import PRIMARY_PACK, PRIMARY_PICK_START, PRIMARY_PICK_STOP
from contextual_value.archive import ArchiveSignalProvider, GameStore, load_decisions
from contextual_value.dr import evaluate_policy
from contextual_value.features import model_feature_map, strong_choice_offsets
from contextual_value.nuisance import build_fold_training_rows
from contextual_value_phase_a_bakeoff import _skill_group, _experience_group
from contextual_value_phase_a_features import _fetch_rich_set
import contextual_value_four_way_fresh as fresh
import contextual_value_q_guard10_20k_confirmation as confirm

EXPECTED_FINGERPRINT = "d1f3cb78d1674b1424805b33637c89d3f3977baa890db61ff534fa7700cb5f33"
EXPECTED_Q_PICKLE_SHA = "854ea2594bb9ae59d38d8a8f7f1e7a12cbc4e7da77293dce91596cd1a8d7d477"
PARITY_TOL = 1e-9
BINS = (0.0, 0.02, 0.05, 0.10, 0.20, 0.40, 1.0000001)
CAPS = (10.0, 20.0, 50.0)


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--expansion", required=True)
    p.add_argument("--draft-archive", type=Path, required=True)
    p.add_argument("--game-archive", type=Path, required=True)
    p.add_argument("--expected-draft-sha256", required=True)
    p.add_argument("--expected-game-sha256", required=True)
    p.add_argument("--cohort-manifest", type=Path, required=True)
    p.add_argument("--freeze-json", type=Path, required=True)
    p.add_argument("--freeze-q-pickle", type=Path, required=True)
    p.add_argument("--retained-confirmation", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--metadata-output", type=Path, required=True)
    return p.parse_args()


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def _canonical_sha(payload) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()


def _metadata(expansion: str, decisions):
    wanted = set()
    for d in decisions:
        if int(d.pack_number) != PRIMARY_PACK or not (PRIMARY_PICK_START <= int(d.pick_number) < PRIMARY_PICK_STOP):
            continue
        wanted.update(d.candidates)
        wanted.update(name for name, _ in d.pool)
    resolved, unresolved = _fetch_rich_set(expansion, wanted)
    coverage = len(resolved) / max(1, len(wanted))
    if coverage < 0.98:
        raise SystemExit(f"metadata coverage {coverage:.2%} below threshold")
    return resolved, unresolved, coverage, wanted


def _calibration(rows):
    if not rows:
        return {"n": 0, "bins": []}
    p = np.asarray([float(r["propensity"]) for r in rows], dtype=float)
    y = np.asarray([int(r["matched"]) for r in rows], dtype=float)
    bins = []
    for lo, hi in zip(BINS[:-1], BINS[1:]):
        mask = (p >= lo) & (p < hi)
        if not np.any(mask):
            continue
        bins.append({
            "lo": lo,
            "hi": 1.0 if hi > 1 else hi,
            "n": int(mask.sum()),
            "predicted_mean": float(p[mask].mean()),
            "observed_rate": float(y[mask].mean()),
            "observed_minus_predicted": float(y[mask].mean() - p[mask].mean()),
        })
    return {
        "n": len(rows),
        "predicted_mean": float(p.mean()),
        "observed_rate": float(y.mean()),
        "observed_minus_predicted": float(y.mean() - p.mean()),
        "median_propensity": float(np.median(p)),
        "p05_propensity": float(np.quantile(p, 0.05)),
        "p10_propensity": float(np.quantile(p, 0.10)),
        "below_0_01_fraction": float(np.mean(p < 0.01)),
        "below_0_02_fraction": float(np.mean(p < 0.02)),
        "below_0_05_fraction": float(np.mean(p < 0.05)),
        "below_0_10_fraction": float(np.mean(p < 0.10)),
        "bins": bins,
    }


def _group_calibration(rows, key):
    groups = defaultdict(list)
    for row in rows:
        groups[str(row[key])].append(row)
    return {name: _calibration(group) for name, group in sorted(groups.items())}


def _weight_tail(rows):
    if not rows:
        return {"n": 0}
    matched = [r for r in rows if r["matched"]]
    inv = np.asarray([1.0 / float(r["propensity"]) for r in matched], dtype=float) if matched else np.asarray([], dtype=float)
    return {
        "n": len(rows),
        "matched_n": len(matched),
        "matched_fraction": len(matched) / len(rows),
        "inverse_weight": {
            "max": float(inv.max()) if len(inv) else None,
            "p50": float(np.quantile(inv, 0.50)) if len(inv) else None,
            "p90": float(np.quantile(inv, 0.90)) if len(inv) else None,
            "p95": float(np.quantile(inv, 0.95)) if len(inv) else None,
            "p99": float(np.quantile(inv, 0.99)) if len(inv) else None,
        },
        "matched_clipped_fraction": {
            str(int(cap)): float(np.mean(inv > cap)) if len(inv) else 0.0
            for cap in CAPS
        },
    }


def _influence(delta):
    x = np.asarray(delta, dtype=float)
    n = len(x)
    mean = float(x.mean())
    if n <= 1:
        raise ValueError("need multiple drafts")
    loo = (float(x.sum()) - x) / (n - 1)
    change = loo - mean
    abs_change = np.abs(change)
    total_abs = float(abs_change.sum())
    order = np.argsort(-abs_change, kind="mergesort")
    out = {
        "n": n,
        "mean": mean,
        "max_abs_leave_one_out_change": float(abs_change.max()),
        "leave_one_out_min": float(loo.min()),
        "leave_one_out_max": float(loo.max()),
        "sign_flips": int(np.sum(np.sign(loo) != np.sign(mean))) if abs(mean) > 0 else None,
    }
    for frac, label in ((0.01, "top_1pct"), (0.05, "top_5pct")):
        k = max(1, int(math.ceil(n * frac)))
        chosen = order[:k]
        keep = np.ones(n, dtype=bool)
        keep[chosen] = False
        out[label] = {
            "n": k,
            "share_total_absolute_leave_one_out_influence": (
                float(abs_change[chosen].sum() / total_abs) if total_abs > 0 else 0.0
            ),
            "effect_without_group": float(x[keep].mean()),
            "signed_delta_sum": float(x[chosen].sum()),
        }
    return out


def _outcome_completeness(confirm_decisions):
    first = {}
    for d in confirm_decisions:
        first.setdefault(str(d.draft_id), d)
    wins = Counter()
    losses = Counter()
    missing_losses = 0
    terminal = 0
    nonterminal = 0
    for d in first.values():
        w = int(d.event_match_wins)
        wins[str(w)] += 1
        if d.event_match_losses is None:
            missing_losses += 1
            losses["missing"] += 1
            is_terminal = w >= 7
        else:
            l = int(d.event_match_losses)
            losses[str(l)] += 1
            is_terminal = w >= 7 or l >= 3
        terminal += int(is_terminal)
        nonterminal += int(not is_terminal)
    return {
        "n": len(first),
        "wins_distribution": dict(sorted(wins.items(), key=lambda x: int(x[0]))),
        "losses_distribution": dict(sorted(losses.items())),
        "missing_losses": missing_losses,
        "terminal_proxy_wins_ge_7_or_losses_ge_3": terminal,
        "nonterminal_proxy": nonterminal,
    }


def main():
    args = parse_args()
    if fresh.sha256(args.draft_archive) != args.expected_draft_sha256:
        raise SystemExit("draft archive hash mismatch")
    if fresh.sha256(args.game_archive) != args.expected_game_sha256:
        raise SystemExit("game archive hash mismatch")

    cohort = json.loads(args.cohort_manifest.read_text())
    retained = json.loads(args.retained_confirmation.read_text())
    freeze = json.loads(args.freeze_json.read_text())
    if retained.get("phase") != "q_guard10_20k_confirmation_environment":
        raise SystemExit("retained confirmation phase mismatch")
    if retained.get("expansion") != args.expansion or cohort.get("expansion") != args.expansion:
        raise SystemExit("environment identity mismatch")
    if freeze.get("fingerprint_sha256") != EXPECTED_FINGERPRINT:
        raise SystemExit("freeze fingerprint mismatch")
    q_pickle_sha = _sha256(args.freeze_q_pickle)
    if q_pickle_sha != EXPECTED_Q_PICKLE_SHA:
        raise SystemExit(f"rich-Q pickle hash mismatch: {q_pickle_sha}")

    prior_ids = frozenset(str(x) for x in cohort["prior_8000_ids"])
    train_ids = frozenset(str(x) for x in cohort["prior_train_ids"])
    confirm_ids = frozenset(str(x) for x in cohort["confirmation_ids"])
    if len(confirm_ids) != 5000 or prior_ids & confirm_ids:
        raise SystemExit("cohort boundary mismatch")

    with args.freeze_q_pickle.open("rb") as handle:
        q_model = pickle.load(handle)

    keep_ids = train_ids | confirm_ids
    decisions = load_decisions(args.draft_archive, keep_ids=keep_ids)
    observed = {str(d.draft_id) for d in decisions}
    if observed != keep_ids:
        raise SystemExit("decision load does not match frozen train+confirm IDs")
    train = [d for d in decisions if str(d.draft_id) in train_ids]
    confirm_decisions = [d for d in decisions if str(d.draft_id) in confirm_ids]

    games = GameStore.from_archives([args.game_archive], train_ids)
    provider = ArchiveSignalProvider(decisions, games)
    metadata, unresolved, coverage, wanted = _metadata(args.expansion, [*train, *confirm_decisions])
    args.metadata_output.parent.mkdir(parents=True, exist_ok=True)
    args.metadata_output.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    metadata_sha = _canonical_sha(metadata)

    train_rows = build_fold_training_rows(
        train, train_ids, signal_provider=provider, inner_feature_folds=fresh.INNER_FEATURE_FOLDS
    )
    strong_behavior, strong_fit = fresh._fit_propensity(train_rows, True)

    scored = []
    for d in confirm_decisions:
        if int(d.pack_number) != PRIMARY_PACK or not (PRIMARY_PICK_START <= int(d.pick_number) < PRIMARY_PICK_STOP):
            continue
        signals = provider(d, train_ids)
        features = model_feature_map(d, signals)
        state, scores, qsimple = fresh._score_decision(d, features, metadata, freeze, q_model)
        scored.append({
            "decision": d,
            "base_features": features,
            "offsets": strong_choice_offsets(signals, d.candidates),
            "state": state,
            "scores": scores,
            "qsimple": qsimple,
        })

    primary = fresh._primary_ope_details(scored)
    if len(primary) != 5000 or {str(x["decision"].draft_id) for x in primary} != confirm_ids:
        raise SystemExit("primary confirmation reconstruction mismatch")

    obs = {"A": [], "Q": [], "guard_010": []}
    disagreement = {"A": [], "Q": []}
    guard_override = {"A": [], "Q": []}

    for item in primary:
        d = item["decision"]
        names = list(d.candidates)
        features = fresh._drop_strong_map(item["base_features"])
        behavior = strong_behavior.probabilities(features, item["offsets"])
        alead = fresh._argmax(item["scores"]["A"], names)
        qlead = fresh._argmax(item["scores"]["Q"], names)
        qadv = float(item["scores"]["Q"][qlead] - item["scores"]["Q"][alead])
        use_q = (
            qlead != alead
            and qadv >= confirm.GUARD_THRESHOLD
            and float(behavior[names[qlead]]) >= confirm._support_floor(len(names))
        )
        glead = qlead if use_q else alead
        leaders = {"A": alead, "Q": qlead, "guard_010": glead}
        for label, lead in leaders.items():
            obs[label].append(confirm._observation(item, lead, behavior))

        base = {
            "draft_id": str(d.draft_id),
            "pick": f"P{int(d.pack_number)+1}P{int(d.pick_number)+1}",
            "skill": _skill_group(float(d.user_game_win_rate)),
            "experience": _experience_group(int(d.user_games_lower_bound)),
            "selected": str(d.selected_card),
        }
        if qlead != alead:
            for label, lead in (("A", alead), ("Q", qlead)):
                disagreement[label].append({
                    **base,
                    "candidate": names[lead],
                    "propensity": float(behavior[names[lead]]),
                    "matched": int(d.selected_card == names[lead]),
                })
        if glead != alead:
            for label, lead in (("A", alead), ("Q", qlead)):
                guard_override[label].append({
                    **base,
                    "candidate": names[lead],
                    "propensity": float(behavior[names[lead]]),
                    "matched": int(d.selected_card == names[lead]),
                })

    # Hard parity gate against the already-final environment report.
    parity = {"max_abs_error": 0.0, "fields": {}}
    for label in ("Q", "guard_010"):
        parity["fields"][label] = {}
        for cap in CAPS:
            key = str(int(cap))
            est = evaluate_policy(obs[label], cap)
            aest = evaluate_policy(obs["A"], cap)
            actual = {
                "dr": float(est.dr - aest.dr),
                "direct": float(est.direct - aest.direct),
                "snips": float(est.snips - aest.snips),
                "ipw": float(est.ipw - aest.ipw),
            }
            expected = retained["comparisons_vs_A"][label][key]
            errors = {name: abs(actual[name] - float(expected[name])) for name in actual}
            parity["fields"][label][key] = {"actual": actual, "expected": {k: float(expected[k]) for k in actual}, "errors": errors}
            parity["max_abs_error"] = max(parity["max_abs_error"], max(errors.values()))
    parity["passed"] = parity["max_abs_error"] <= PARITY_TOL
    if not parity["passed"]:
        raise SystemExit(f"retained confirmation parity failure: {parity['max_abs_error']}")

    delta = {
        label: {
            str(int(cap)): [float(x) for x in (confirm._dr_terms(obs[label], cap) - confirm._dr_terms(obs["A"], cap))]
            for cap in CAPS
        }
        for label in ("Q", "guard_010")
    }
    zero = confirm._dr_terms(obs["A"], 20.0) - confirm._dr_terms(obs["A"], 20.0)
    identical_zero = bool(np.array_equal(zero, np.zeros_like(zero)))
    if not identical_zero:
        raise SystemExit("identical-policy paired delta invariant failed")

    report = {
        "phase": "q_guard10_20k_trust_audit_environment",
        "scope": "post_confirmation_diagnostic_only",
        "expansion": args.expansion,
        "registered_result_unchanged": True,
        "identity": {
            "freeze_fingerprint": freeze["fingerprint_sha256"],
            "freeze_json_sha256": _sha256(args.freeze_json),
            "rich_q_pickle_sha256": q_pickle_sha,
            "metadata_canonical_sha256": metadata_sha,
            "metadata_wanted": len(wanted),
            "metadata_resolved": len(metadata),
            "metadata_coverage": coverage,
            "metadata_unresolved": unresolved,
        },
        "parity": parity,
        "behavior_nuisance": strong_fit,
        "support": {
            "q_a_disagreements": {
                "n": len(disagreement["A"]),
                "A": {
                    "overall": _calibration(disagreement["A"]),
                    "by_pick": _group_calibration(disagreement["A"], "pick"),
                    "by_skill": _group_calibration(disagreement["A"], "skill"),
                    "weight_tail": _weight_tail(disagreement["A"]),
                },
                "Q": {
                    "overall": _calibration(disagreement["Q"]),
                    "by_pick": _group_calibration(disagreement["Q"], "pick"),
                    "by_skill": _group_calibration(disagreement["Q"], "skill"),
                    "weight_tail": _weight_tail(disagreement["Q"]),
                },
            },
            "guard_010_overrides": {
                "n": len(guard_override["A"]),
                "A": {
                    "overall": _calibration(guard_override["A"]),
                    "by_pick": _group_calibration(guard_override["A"], "pick"),
                    "by_skill": _group_calibration(guard_override["A"], "skill"),
                    "weight_tail": _weight_tail(guard_override["A"]),
                },
                "Q": {
                    "overall": _calibration(guard_override["Q"]),
                    "by_pick": _group_calibration(guard_override["Q"], "pick"),
                    "by_skill": _group_calibration(guard_override["Q"], "skill"),
                    "weight_tail": _weight_tail(guard_override["Q"]),
                },
            },
        },
        "influence_cap20": {
            label: _influence(delta[label]["20"]) for label in ("Q", "guard_010")
        },
        "outcome_completeness": _outcome_completeness(confirm_decisions),
        "raw_cap20_delta": {label: delta[label]["20"] for label in ("Q", "guard_010")},
        "raw_support_records": {
            "q_a_disagreements": disagreement,
            "guard_010_overrides": guard_override,
        },
        "invariants": {
            "identical_A_vs_A_exact_zero": identical_zero,
        },
        "boundary": "Diagnostic only; cannot alter the registered no_confirmed_challenger decision or retune any policy.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "expansion": args.expansion,
        "parity_max_error": parity["max_abs_error"],
        "q_a_disagreements": len(disagreement["A"]),
        "guard_overrides": len(guard_override["A"]),
        "metadata_sha256": metadata_sha,
        "identical_zero": identical_zero,
        "outcome": report["outcome_completeness"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
