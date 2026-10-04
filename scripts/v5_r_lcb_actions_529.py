#!/usr/bin/env python3
"""Reconstruct exact shipped v5 actions on the frozen #529 45k R-LCB cohort.

This is a retrospective spent-cohort diagnostic. It does not refit R, change its
actions, or tune any outcome-facing parameter. The v5 grader is reconstructed
from the exact pinned 17Lands draft/game archives and the all-qualified v5 cohort.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

from build_replays import (
    CountStore,
    DraftSkill,
    OutOfFoldModel,
    PickExample,
    build_colour_tables_by_fold,
    build_fold_training,
    candidate_columns,
    normalize_probabilities,
    parse_games_lower_bound,
    parse_rate_bucket,
    pool_columns,
    select_strong_drafts,
    stable_fold,
    truthy_count,
)

EXPECTED = {
    "FIN": {
        "draft_sha256": "9d5b2a3e908bb8daf0ea6e951097714b651546370a5c852893dc90a1f2f6ab8b",
        "game_sha256": "f6452e622976f66dd5420c55741da5b246c7e8d25d63c080e728635e1741a6a6",
        "training_drafts": 20366,
    },
    "TDM": {
        "draft_sha256": "831ba8bc4be5eabe140fac00a8e6eaded3f3f931685be8f91403ad9cfde5cbf5",
        "game_sha256": "e2e679168818d67d812972343ba541d626d0f57140bc22955e09dd07bc2086e4",
        "training_drafts": 11887,
    },
    "DFT": {
        "draft_sha256": "7812d16e0de78ff7a69faf9981f7ff03be4dfc618a86f14369424ec2204580cd",
        "game_sha256": "734325afbe5c023245e7769fab66c88dcf241407666becb06b956d7fee13a28b",
        "training_drafts": 18966,
    },
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def scan_skills(path: Path):
    skills: dict[str, DraftSkill] = {}
    with gzip.open(path, "rt", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        header = tuple(next(reader))
        idx = {name: i for i, name in enumerate(header)}
        required = {"draft_id", "user_n_games_bucket", "user_game_win_rate_bucket"}
        if not required <= set(header):
            raise ValueError(f"missing skill columns: {sorted(required-set(header))}")
        did_at = idx["draft_id"]
        rate_at = idx["user_game_win_rate_bucket"]
        games_at = idx["user_n_games_bucket"]
        event_at = idx.get("event_type")
        for values in reader:
            if len(values) != len(header):
                continue
            did = values[did_at].strip()
            if not did or did in skills:
                continue
            if event_at is not None and values[event_at].strip() != "PremierDraft":
                continue
            rate = parse_rate_bucket(values[rate_at])
            games = parse_games_lower_bound(values[games_at])
            if rate is not None and games is not None:
                skills[did] = DraftSkill(rate=rate, games_lower_bound=games)
    return skills, header


def load_examples(path: Path, wanted_ids: set[str], header: tuple[str, ...], full_ids: set[str]):
    pack_cols = candidate_columns(header)
    pool_cols = pool_columns(header)
    idx = {name: i for i, name in enumerate(header)}
    need = ("draft_id", "pick", "pack_number", "pick_number")
    if any(k not in idx for k in need):
        raise ValueError("draft archive missing pick-state columns")
    packed = [(c, idx[c]) for c in pack_cols]
    pooled = [(c, idx[c]) for c in pool_cols]
    by_draft: dict[str, list[PickExample]] = defaultdict(list)
    did_at, pick_at = idx["draft_id"], idx["pick"]
    pack_at, pos_at = idx["pack_number"], idx["pick_number"]
    with gzip.open(path, "rt", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        actual = tuple(next(reader))
        if actual != header:
            raise ValueError("draft header changed between passes")
        for values in reader:
            if len(values) != len(header):
                continue
            did = values[did_at].strip()
            if did not in wanted_ids:
                continue
            historical = values[pick_at].strip()
            if not historical:
                continue
            try:
                raw_pack = int(float(values[pack_at]))
                raw_pick = int(float(values[pos_at]))
            except ValueError:
                continue
            if did not in full_ids and (raw_pack != 0 or raw_pick > 7):
                continue
            candidates = [c[len("pack_card_"):] for c, i in packed if truthy_count(values[i]) > 0]
            if historical not in candidates or len(candidates) != len(set(candidates)):
                continue
            pool = {
                c[len("pool_"):]: count
                for c, i in pooled
                if (count := truthy_count(values[i])) > 0
            }
            by_draft[did].append(PickExample(did, raw_pack, raw_pick, historical, candidates, pool))
    for did in by_draft:
        by_draft[did].sort(key=lambda x: (x.raw_pack_number, x.raw_pick_number))
    return dict(by_draft)


def example_lookup(examples):
    return {
        (did, ex.raw_pack_number + 1, ex.raw_pick_number + 1): ex
        for did, rows in examples.items()
        for ex in rows
    }


def probs(model, ex: PickExample):
    raw = {
        card: model.card_tendency(card, ex.raw_pack_number, ex.raw_pick_number, ex.pool)
        for card in ex.candidates
    }
    return normalize_probabilities(raw)


def ranking(p):
    return sorted(p, key=lambda card: (-p[card], card))


def load_replays(root: Path):
    rows = []
    for path in sorted((root / "replay" / "data" / "shards").glob("*.json")):
        payload = json.loads(path.read_text())
        rows.extend(payload.get("replays", []))
    return rows


def outcomes(path: Path, ids: set[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    with gzip.open(path, "rt", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        header = tuple(next(reader))
        pos = {x: i for i, x in enumerate(header)}
        for need in ("draft_id", "event_match_wins"):
            if need not in pos:
                raise ValueError(f"missing {need}")
        for row in reader:
            if len(row) != len(header):
                continue
            did = row[pos["draft_id"]].strip()
            if did not in ids:
                continue
            raw = row[pos["event_match_wins"]].strip()
            if not raw:
                continue
            y = float(raw)
            if did in out and out[did] != y:
                raise ValueError(f"{did}: inconsistent event_match_wins")
            out[did] = y
    if set(out) != ids:
        raise ValueError(f"missing outcomes for {len(ids-set(out))} drafts")
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--set", dest="env", required=True, choices=sorted(EXPECTED))
    p.add_argument("--draft", type=Path, required=True)
    p.add_argument("--game", type=Path, required=True)
    p.add_argument("--freeze", type=Path, required=True)
    p.add_argument("--v5-artifact-root", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--meta", type=Path, required=True)
    a = p.parse_args()
    exp = EXPECTED[a.env]
    sid = a.env.lower()

    if sha256(a.draft) != exp["draft_sha256"]:
        raise SystemExit(f"{a.env}: draft archive hash mismatch")
    if sha256(a.game) != exp["game_sha256"]:
        raise SystemExit(f"{a.env}: game archive hash mismatch")

    manifest_path = a.v5_artifact_root / "replay" / "data" / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    cohort = manifest["cohort"]
    if manifest["model"]["model_version"] != "strong-player-colour-stage-v5":
        raise SystemExit(f"{a.env}: artifact is not v5")
    if cohort.get("training_mode") != "all-qualified" or cohort.get("training_cap") is not None:
        raise SystemExit(f"{a.env}: artifact is not uncapped all-qualified")
    if int(cohort["training_drafts"]) != exp["training_drafts"]:
        raise SystemExit(f"{a.env}: manifest training count mismatch")
    prov = manifest["v5_source_provenance"]
    if prov["source_archive"]["sha256"] != exp["draft_sha256"] or prov["skill_source"]["sha256"] != exp["game_sha256"]:
        raise SystemExit(f"{a.env}: manifest source identity mismatch")

    z0 = np.load(a.freeze, allow_pickle=False)
    data = {k: z0[k] for k in z0.files}
    eval_ids = set(map(str, data["draft_ids"]))
    if len(eval_ids) != 15000:
        raise SystemExit(f"{a.env}: expected 15000 frozen drafts")

    replays = load_replays(a.v5_artifact_root)
    replay_ids = {str(r["draft_id"]) for r in replays}
    skills, header = scan_skills(a.draft)
    training, cutoff, experienced = select_strong_drafts(skills, 100, .15, None)
    training = set(training)
    if len(training) != exp["training_drafts"]:
        raise SystemExit(f"{a.env}: reconstructed training count {len(training)} != {exp['training_drafts']}")
    if abs(float(cutoff) - float(cohort["win_rate_cutoff"])) > 1e-12:
        raise SystemExit(f"{a.env}: reconstructed cutoff mismatch")

    wanted = training | eval_ids | replay_ids
    full_ids = training | replay_ids
    examples = load_examples(a.draft, wanted, header, full_ids)
    lookup = example_lookup(examples)
    pairs = [(did, ex) for did in training for ex in examples.get(did, ())]
    folds = build_fold_training(pairs, training, 5)
    fits = build_colour_tables_by_fold(a.game, pairs, folds, sid)
    models = {
        f.fold: OutOfFoldModel(f.counts, CountStore.empty(), fits[f.fold])
        for f in folds
    }

    checked = 0
    top_mismatch = 0
    max_abs = 0.0
    missing = []
    for replay in replays:
        did = str(replay["draft_id"])
        for pick in replay.get("picks", []):
            key = (did, int(pick["pack_number"]), int(pick["pick_number"]))
            ex = lookup.get(key)
            if ex is None:
                missing.append(key)
                continue
            pcur = probs(models[stable_fold(did, 5)], ex)
            stored = {c["name"]: float(c["model_probability"]) for c in pick["candidates"]}
            if set(stored) != set(pcur):
                raise SystemExit(f"{a.env}: replay candidate set mismatch {key}")
            for card, value in stored.items():
                max_abs = max(max_abs, abs(pcur[card] - value))
            stored_top = sorted(stored, key=lambda c: (-stored[c], c))[0]
            top_mismatch += int(stored_top != ranking(pcur)[0])
            checked += 1
    if missing or top_mismatch or max_abs > 1.000001e-6:
        raise SystemExit(f"{a.env}: v5 replay reproduction failed: missing={len(missing)} top_mismatch={top_mismatch} max_abs={max_abs}")

    offsets = np.asarray(data["offsets"], np.int64)
    names = np.asarray(data["candidate_names"])
    dids = np.asarray(data["draft_ids"]).astype(str)
    packs = np.asarray(data["pack_number"], np.int64)
    picks = np.asarray(data["pick_number"], np.int64)
    selected = np.asarray(data["selected_ord"], np.int64)
    r_ord = np.asarray(data["r_lcb_ord"], np.int64)
    v5_ord = np.empty(len(dids), np.int16)
    action_digest = hashlib.sha256()
    for i, did in enumerate(dids):
        key = (did, int(packs[i]) + 1, int(picks[i]) + 1)
        ex = lookup.get(key)
        if ex is None:
            raise SystemExit(f"{a.env}: missing frozen decision {key}")
        lo, hi = int(offsets[i]), int(offsets[i + 1])
        local = [str(x) for x in names[lo:hi]]
        if set(local) != set(ex.candidates):
            raise SystemExit(f"{a.env}: frozen candidate set differs {key}")
        if not 0 <= int(selected[i]) < len(local) or local[int(selected[i])] != ex.historical_pick:
            raise SystemExit(f"{a.env}: frozen historical pick differs {key}")
        pcur = probs(models[stable_fold(did, 5)], ex)
        top = ranking(pcur)[0]
        v5_ord[i] = local.index(top)
        action_digest.update(f"{did}\0{packs[i]}\0{picks[i]}\0{top}\n".encode())

    ymap = outcomes(a.draft, eval_ids)
    y = np.asarray([ymap[str(x)] for x in dids], np.float64)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(a.out, v5_ord=v5_ord, outcome=y)
    meta = {
        "schema": 1,
        "environment": a.env,
        "model_version": "strong-player-colour-stage-v5",
        "training_mode": "all-qualified",
        "training_cap": None,
        "training_drafts": len(training),
        "experienced_drafts": int(experienced),
        "win_rate_cutoff": float(cutoff),
        "frozen_drafts": len(eval_ids),
        "frozen_decisions": len(dids),
        "r_v5_action_agreement": float(np.mean(r_ord == v5_ord)),
        "r_v5_disagreement_count": int(np.sum(r_ord != v5_ord)),
        "v5_action_digest_sha256": action_digest.hexdigest(),
        "archive": {"draft_sha256": sha256(a.draft), "game_sha256": sha256(a.game)},
        "shipped_v5_reproduction": {
            "replays": len(replays),
            "decisions_checked": checked,
            "top_pick_mismatches": top_mismatch,
            "max_abs_probability_error": max_abs,
            "missing_source_decisions": len(missing),
            "pass": True,
        },
    }
    a.meta.write_text(json.dumps(meta, indent=2, sort_keys=True) + "\n")
    print(json.dumps(meta, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
