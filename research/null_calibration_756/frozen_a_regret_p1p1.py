#!/usr/bin/env python3
"""Issue #756: frozen P1P1 randomized-offer regret analysis for incumbent A.

The script deliberately performs all prior-use reconstruction, P1P1 context
loading, A scoring, support selection, and first-stage diagnostics before it
reads any new #756 outcome. If the outcome-free identification gate fails, it
writes an insufficient-identification report and exits without reading the
new outcome column.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from contextual_value.archive import ArchiveSignalProvider, GameStore, load_decisions

LAMBDA = 10.0
FOLDS = 5
MIN_APPEAR = 250
MIN_TAKES = 50
MIN_TAKE_RATE = 0.05
MIN_SUPPORTED = 25
MIN_RANK_FRACTION = 0.90
MIN_MEDIAN_OWN_FS = 0.05
MIN_P10_OWN_FS = 0.01
PRACTICAL = 0.02

EXPECTED_DRAFT = {
    "FIN": "9d5b2a3e908bb8daf0ea6e951097714b651546370a5c852893dc90a1f2f6ab8b",
    "TDM": "831ba8bc4be5eabe140fac00a8e6eaded3f3f931685be8f91403ad9cfde5cbf5",
    "DFT": "7812d16e0de78ff7a69faf9981f7ff03be4dfc618a86f14369424ec2204580cd",
    "MSH": "64100d71db77e0f0ef8ba893b259a1024eb6d15816db337c7758e7d96bc29cf7",
    "SOS": "df6220d8941e99b7264a54a7a7427096246ee6510057a83d4c9424b472761853",
}
EXPECTED_GAME = {
    "FIN": "f6452e622976f66dd5420c55741da5b246c7e8d25d63c080e728635e1741a6a6",
    "TDM": "e2e679168818d67d812972343ba541d626d0f57140bc22955e09dd07bc2086e4",
    "DFT": "734325afbe5c023245e7769fab66c88dcf241407666becb06b956d7fee13a28b",
    "MSH": "8a6bd93a5d50554a3d87703e93624d09e638dc6dd03eda12be9c3f2925484edf",
    "SOS": "1be513933918ca243c137af0314aae099c721c408786c9cb56f08027d9b113fb",
}
EXPECTED_UNUSED = {
    "FIN": 112237,
    "TDM": 73323,
    "DFT": 115504,
    "MSH": 66003,
    "SOS": 105197,
}


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--expansion", choices=tuple(EXPECTED_DRAFT), required=True)
    p.add_argument("--draft-archive", type=Path, required=True)
    p.add_argument("--game-archive", type=Path, required=True)
    p.add_argument("--spent-ledger", type=Path, required=True)
    p.add_argument("--reserve-json", type=Path, required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    return p.parse_args()


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def fold_of(draft_id: str) -> int:
    digest = hashlib.sha256(f"a-regret-v1:{draft_id}".encode()).digest()
    return int.from_bytes(digest[:8], "big") % FOLDS


def as_int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def count_of(value):
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def load_prior(spent_ledger: Path, reserve_json: Path, expansion: str):
    with gzip.open(spent_ledger, "rt", encoding="utf-8") as f:
        ledger = json.load(f)
    rows = [r for r in ledger["rows"] if str(r["expansion"]) == expansion]
    excluded = {str(r["draft_id"]) for r in rows}
    reserve = json.loads(reserve_json.read_text())
    env = reserve.get("environments", {}).get(expansion)
    if env is not None:
        reserve_ids = set(map(str, env["reserve_ids"]))
        if len(reserve_ids) != 15000:
            raise SystemExit(f"{expansion}: retained R reserve is not 15,000")
        excluded |= reserve_ids
        train_ids = frozenset(map(str, env["prior_train_ids"]))
        train_source = "reserve.prior_train_ids"
    else:
        train_ids = frozenset(
            str(r["draft_id"]) for r in rows if "R_training" in set(r.get("usage", []))
        )
        train_source = "spent-ledger R_training"
    if not train_ids:
        raise SystemExit(f"{expansion}: no frozen A training IDs")
    return excluded, train_ids, rows, train_source


def read_contexts_no_outcomes(path: Path, expansion: str, excluded: set[str]):
    contexts = []
    seen = set()
    invalid = Counter()
    with gzip.open(path, "rt", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        pos = {name: i for i, name in enumerate(header)}
        required = ("draft_id", "event_type", "pack_number", "pick_number", "pick")
        missing = [x for x in required if x not in pos]
        if missing:
            raise SystemExit(f"{expansion}: missing columns {missing}")
        pack_cols = [(name[len("pack_card_"):], i) for i, name in enumerate(header) if name.startswith("pack_card_")]
        for values in reader:
            if len(values) != len(header):
                continue
            if values[pos["event_type"]].strip() != "PremierDraft":
                continue
            if as_int(values[pos["pack_number"]]) != 0 or as_int(values[pos["pick_number"]]) != 0:
                continue
            did = values[pos["draft_id"]].strip()
            if not did or did in excluded:
                continue
            if did in seen:
                raise SystemExit(f"{expansion}: duplicate unused P1P1 row {did}")
            seen.add(did)
            chosen = values[pos["pick"]].strip()
            candidates = tuple(card for card, i in pack_cols if count_of(values[i]) > 0)
            if not candidates:
                invalid["empty_pack"] += 1
                continue
            if len(candidates) != len(set(candidates)):
                invalid["duplicate_card_name_action"] += 1
                candidates = tuple(dict.fromkeys(candidates))
            if not chosen or chosen not in candidates:
                invalid["chosen_not_offered"] += 1
                continue
            contexts.append({
                "draft_id": did,
                "candidates": candidates,
                "historical_pick": chosen,
                "fold": fold_of(did),
            })
    return contexts, dict(invalid)


def build_a_scores(draft_archive: Path, game_archive: Path, expansion: str, train_ids: frozenset[str], contexts):
    train = load_decisions(draft_archive, keep_ids=train_ids)
    seen_train = {str(d.draft_id) for d in train}
    if seen_train != set(train_ids):
        raise SystemExit(
            f"{expansion}: frozen A training load mismatch missing={len(set(train_ids)-seen_train)} extra={len(seen_train-set(train_ids))}"
        )
    games = GameStore.from_archive(game_archive, train_ids)
    provider = ArchiveSignalProvider(train, games)
    artifacts = provider.artifacts(train_ids, expansion)
    model = artifacts.strong_model
    if model is None:
        raise SystemExit(f"{expansion}: frozen A strong model unavailable")
    all_cards = sorted({card for row in contexts for card in row["candidates"]})
    raw = {card: float(model.card_tendency(card, 0, 0, {})) for card in all_cards}
    for row in contexts:
        local = [(card, max(0.0, raw.get(card, 0.0))) for card in row["candidates"]]
        total = sum(v for _, v in local)
        if total <= 0:
            probs = {card: 1.0 / len(local) for card, _ in local}
        else:
            probs = {card: v / total for card, v in local}
        ranked = sorted(probs, key=lambda c: (-probs[c], c))
        row["a_card"] = ranked[0]
        row["a_probability"] = float(probs[ranked[0]])
        row["a_margin"] = float(probs[ranked[0]] - probs[ranked[1]]) if len(ranked) > 1 else 1.0
    return {
        "training_ids": len(train_ids),
        "strong_ids": len(artifacts.strong_ids),
        "cards_scored": len(all_cards),
    }


def support_for(rows):
    appearances = Counter()
    takes = Counter()
    for row in rows:
        for card in row["candidates"]:
            appearances[card] += 1
        takes[row["historical_pick"]] += 1
    supported = sorted(
        card for card, n in appearances.items()
        if n >= MIN_APPEAR and takes[card] >= MIN_TAKES and takes[card] / n >= MIN_TAKE_RATE
    )
    return supported, appearances, takes


def first_stage(rows, supported):
    cards = list(supported)
    index = {c: i for i, c in enumerate(cards)}
    m = len(cards)
    p = m + 1
    ztz = np.zeros((p, p), dtype=np.float64)
    ztd = np.zeros((p, m), dtype=np.float64)
    zsum = np.zeros(p, dtype=np.float64)
    for row in rows:
        idx = [0]
        idx.extend(1 + index[c] for c in row["candidates"] if c in index)
        idx = np.asarray(idx, dtype=np.int64)
        ztz[np.ix_(idx, idx)] += 1.0
        zsum[idx] += 1.0
        chosen = index.get(row["historical_pick"])
        if chosen is not None:
            ztd[idx, chosen] += 1.0
    reg = ztz.copy()
    if m:
        reg[1:, 1:] += np.eye(m) * LAMBDA
    b = np.linalg.solve(reg, ztd) if m else np.empty((1, 0))
    raw_rank = int(np.linalg.matrix_rank(ztz))
    card_rank = max(0, min(m, raw_rank - 1))
    rank_fraction = card_rank / m if m else 0.0
    own = np.asarray([b[1 + j, j] for j in range(m)], dtype=np.float64) if m else np.asarray([])
    diagnostics = {
        "supported_cards": m,
        "instrument_design_rank": raw_rank,
        "card_rank": card_rank,
        "rank_fraction": rank_fraction,
        "own_first_stage_median": float(np.median(own)) if len(own) else None,
        "own_first_stage_p10": float(np.quantile(own, 0.10)) if len(own) else None,
    }
    diagnostics["gate"] = bool(
        m >= MIN_SUPPORTED
        and rank_fraction >= MIN_RANK_FRACTION
        and diagnostics["own_first_stage_median"] is not None
        and diagnostics["own_first_stage_median"] >= MIN_MEDIAN_OWN_FS
        and diagnostics["own_first_stage_p10"] is not None
        and diagnostics["own_first_stage_p10"] >= MIN_P10_OWN_FS
    )
    return {
        "cards": cards,
        "index": index,
        "ztz": ztz,
        "ztd": ztd,
        "zsum": zsum,
        "b": b,
        "diagnostics": diagnostics,
    }


def read_new_outcomes(path: Path, wanted: set[str]):
    outcomes = {}
    with gzip.open(path, "rt", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        pos = {name: i for i, name in enumerate(header)}
        if "event_match_wins" not in pos:
            raise SystemExit("event_match_wins missing")
        for values in reader:
            if len(values) != len(header):
                continue
            did = values[pos["draft_id"]].strip()
            if did not in wanted:
                continue
            if values[pos["event_type"]].strip() != "PremierDraft":
                continue
            if as_int(values[pos["pack_number"]]) != 0 or as_int(values[pos["pick_number"]]) != 0:
                continue
            raw = values[pos["event_match_wins"]].strip()
            outcomes[did] = None if raw == "" else float(raw)
    return outcomes


def second_stage(rows, fs, outcomes):
    cards = fs["cards"]
    index = fs["index"]
    m = len(cards)
    b = fs["b"]
    zty = np.zeros(m + 1, dtype=np.float64)
    sum_y = 0.0
    n = 0
    for row in rows:
        y = outcomes[row["draft_id"]]
        if y is None:
            continue
        idx = [0]
        idx.extend(1 + index[c] for c in row["candidates"] if c in index)
        idx = np.asarray(idx, dtype=np.int64)
        zty[idx] += y
        sum_y += y
        n += 1
    if not n:
        raise SystemExit("no outcome rows in second stage")
    dhat_dhat = b.T @ fs["ztz"] @ b
    dhat_sum = b.T @ fs["zsum"]
    dhat_y = b.T @ zty
    xtx = np.zeros((m + 1, m + 1), dtype=np.float64)
    xtx[0, 0] = n
    xtx[0, 1:] = dhat_sum
    xtx[1:, 0] = dhat_sum
    xtx[1:, 1:] = dhat_dhat
    xty = np.concatenate([[sum_y], dhat_y])
    reg = xtx.copy()
    reg[1:, 1:] += np.eye(m) * LAMBDA
    coef = np.linalg.solve(reg, xty)
    return float(coef[0]), {card: float(coef[1 + j]) for j, card in enumerate(cards)}


def percentile(values, q):
    if not values:
        return None
    return float(np.quantile(np.asarray(values, dtype=float), q))


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")


def main():
    args = parse_args()
    exp = args.expansion
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if sha256(args.draft_archive) != EXPECTED_DRAFT[exp]:
        raise SystemExit(f"{exp}: draft hash mismatch")
    if sha256(args.game_archive) != EXPECTED_GAME[exp]:
        raise SystemExit(f"{exp}: game hash mismatch")

    excluded, train_ids, ledger_rows, train_source = load_prior(
        args.spent_ledger, args.reserve_json, exp
    )
    contexts, invalid = read_contexts_no_outcomes(args.draft_archive, exp, excluded)
    expected = EXPECTED_UNUSED[exp]
    if len(contexts) != expected:
        raise SystemExit(
            f"{exp}: unused P1P1 count mismatch expected={expected} actual={len(contexts)} invalid={invalid}"
        )

    a_meta = build_a_scores(args.draft_archive, args.game_archive, exp, train_ids, contexts)

    preflight_folds = []
    fs_by_fold = {}
    all_gates = True
    for fold in range(FOLDS):
        training = [r for r in contexts if r["fold"] != fold]
        supported, appearances, takes = support_for(training)
        fs = first_stage(training, supported)
        fs_by_fold[fold] = fs
        d = dict(fs["diagnostics"])
        d.update({
            "fold": fold,
            "training_rows": len(training),
            "heldout_rows": sum(r["fold"] == fold for r in contexts),
            "support_rule": {
                "min_appearance": MIN_APPEAR,
                "min_takes": MIN_TAKES,
                "min_take_rate": MIN_TAKE_RATE,
            },
        })
        preflight_folds.append(d)
        all_gates = all_gates and d["gate"]

    preflight = {
        "phase": "a_regret_p1p1_outcome_free_preflight",
        "issue": 756,
        "expansion": exp,
        "new_756_outcomes_read": False,
        "protocol": "research/A-REGRET-RANDOM-P1P1-PROTOCOL-2026-09-29.md",
        "draft_sha256": EXPECTED_DRAFT[exp],
        "game_sha256": EXPECTED_GAME[exp],
        "prior_use": {
            "spent_ledger_rows_for_environment": len(ledger_rows),
            "excluded_ids_total": len(excluded),
            "a_training_ids": len(train_ids),
            "a_training_source": train_source,
        },
        "unused_p1p1_rows": len(contexts),
        "expected_unused_p1p1_rows": expected,
        "invalid_context_rows": invalid,
        "a": a_meta,
        "folds": preflight_folds,
        "all_identification_gates_pass": all_gates,
    }
    write_json(args.output_dir / "preflight.json", preflight)

    if not all_gates:
        report = {
            "phase": "a_regret_p1p1_result",
            "issue": 756,
            "expansion": exp,
            "status": "insufficient_identification_outcome_free",
            "new_756_outcomes_read": False,
            "preflight": preflight,
        }
        write_json(args.output_dir / "report.json", report)
        print(json.dumps({"expansion": exp, "status": report["status"], "outcomes_read": False}, indent=2))
        return

    # Outcome boundary: this is the first access to any new #756 outcome value.
    wanted = {r["draft_id"] for r in contexts}
    outcomes = read_new_outcomes(args.draft_archive, wanted)
    missing = [did for did in sorted(wanted) if did not in outcomes or outcomes[did] is None]
    if missing:
        report = {
            "phase": "a_regret_p1p1_result",
            "issue": 756,
            "expansion": exp,
            "status": "missing_outcomes_no_estimate",
            "new_756_outcomes_read": True,
            "missing_outcome_n": len(missing),
            "preflight": preflight,
        }
        write_json(args.output_dir / "report.json", report)
        print(json.dumps({"expansion": exp, "status": report["status"], "missing": len(missing)}, indent=2))
        return

    scored = []
    fold_results = []
    for fold in range(FOLDS):
        training = [r for r in contexts if r["fold"] != fold]
        held = [r for r in contexts if r["fold"] == fold]
        fs = fs_by_fold[fold]
        intercept, beta = second_stage(training, fs, outcomes)
        supported = set(fs["cards"])
        eligible = 0
        unsupported_a = 0
        no_supported_offer = 0
        for row in held:
            a = row["a_card"]
            if a not in supported:
                unsupported_a += 1
                continue
            offered = [c for c in row["candidates"] if c in supported]
            if not offered:
                no_supported_offer += 1
                continue
            best = min(offered, key=lambda c: (-beta[c], c))
            regret = max(0.0, beta[best] - beta[a])
            eligible += 1
            scored.append({
                "expansion": exp,
                "draft_id": row["draft_id"],
                "fold": fold,
                "regret": float(regret),
                "a_card": a,
                "iv_best_card": best,
                "a_iv_disagree": bool(a != best),
                "historical_pick": row["historical_pick"],
                "a_historical_disagree": bool(a != row["historical_pick"]),
                "a_margin": float(row["a_margin"]),
                "a_probability": float(row["a_probability"]),
                "a_value": float(beta[a]),
                "iv_best_value": float(beta[best]),
            })
        fold_results.append({
            "fold": fold,
            "intercept": intercept,
            "eligible_scored": eligible,
            "unsupported_a": unsupported_a,
            "no_supported_offer": no_supported_offer,
            "supported_cards": len(supported),
        })

    regrets = [r["regret"] for r in scored]
    report = {
        "phase": "a_regret_p1p1_result",
        "issue": 756,
        "expansion": exp,
        "status": "analyzed",
        "new_756_outcomes_read": True,
        "new_756_outcome_n": len(outcomes),
        "preflight": preflight,
        "crossfit": {
            "folds": FOLDS,
            "eligible_scored_n": len(scored),
            "coverage": len(scored) / len(contexts),
            "mean_regret": float(np.mean(regrets)) if regrets else None,
            "median_regret": percentile(regrets, 0.5),
            "p90_regret": percentile(regrets, 0.9),
            "share_regret_gt_0_02": float(np.mean(np.asarray(regrets) > PRACTICAL)) if regrets else None,
            "fold_results": fold_results,
        },
        "interpretation_boundary": [
            "Regret is relative to the best statistically supported card under the frozen randomized-offer IV projection, not literal omniscient best play.",
            "A is scored only from the frozen prior-training complement and never from #756 outcomes.",
            "Pack-composition exclusion is approximate because offered cards can affect passed-card signals and P1P9.",
        ],
    }
    write_json(args.output_dir / "report.json", report)
    with gzip.open(args.output_dir / "regret-rows.jsonl.gz", "wt", encoding="utf-8") as f:
        for row in scored:
            f.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")
    print(json.dumps({
        "expansion": exp,
        "status": "analyzed",
        "unused_p1p1": len(contexts),
        "eligible": len(scored),
        "coverage": report["crossfit"]["coverage"],
        "mean_regret": report["crossfit"]["mean_regret"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
