#!/usr/bin/env python3
"""Issue #529: exact deployed-A vs research-A scoring-only transfer audit.

Hard boundary: this module never indexes event_match_wins, event_match_losses,
game won, or any other outcome field. Research cohorts are loaded only from
already-frozen outcome-free cohort/freeze artifacts.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable, Mapping

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_replays import (  # noqa: E402
    CountStore,
    DraftSkill,
    OutOfFoldModel,
    PickExample,
    build_colour_table,
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

SETS = ("msh", "sos", "ecl", "tla", "eoe", "fin", "tdm", "dft")
CORE = frozenset(("msh", "sos", "ecl", "tla"))
LATER = frozenset(("eoe", "fin", "tdm", "dft"))
R45 = frozenset(("fin", "tdm", "dft"))
FOCAL_CARDS = frozenset((
    "Anticausal Vestige",
    "Elegy Acolyte",
    "Genemorph Imago",
    "Lumen-Class Frigate",
    "Mightform Harmonizer",
    "Nova Hellkite",
    "Possibility Technician",
    "Sunstar Chaplain",
    "Thrumming Hivepool",
    "Warmaker Gunship",
))
EXPECTED_GAME_SHA256 = {
    "msh": "8a6bd93a5d50554a3d87703e93624d09e638dc6dd03eda12be9c3f2925484edf",
    "sos": "1be513933918ca243c137af0314aae099c721c408786c9cb56f08027d9b113fb",
    "ecl": "54b94edb0702dbcf20aa943d0e7da5a7987cf20232864083953e61b95b38ff48",
    "tla": "6bb12e5cf17e57a2624ca8ac83f15fd4415ea347aa58eac0ed82feb1b17d536b",
    "eoe": "130e7e7580a1cb4b4f635411d187a078bc7bdd9dd3436ef5ff7535e14cadaf1b",
    "fin": "f6452e622976f66dd5420c55741da5b246c7e8d25d63c080e728635e1741a6a6",
    "tdm": "e2e679168818d67d812972343ba541d626d0f57140bc22955e09dd07bc2086e4",
    "dft": "734325afbe5c023245e7769fab66c88dcf241407666becb06b956d7fee13a28b",
}
FORBIDDEN_COLUMNS = frozenset((
    "event_match_wins", "event_match_losses", "won",
    "game_win", "match_win", "wins", "losses",
))
ACCESSED_DRAFT_COLUMNS = frozenset((
    "draft_id", "event_type", "pick", "pack_number", "pick_number",
    "user_n_games_bucket", "user_game_win_rate_bucket",
))
RELEASE_COMMIT = "31fef96eb59599a31fe7cb431f128d549030b6ed"
STEP0_COMMIT = "84d08a6364015fc7624c5ddbc49934b6918e9b8f"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def percentile(values, q):
    values = sorted(float(x) for x in values)
    if not values:
        return None
    if len(values) == 1:
        return values[0]
    pos = (len(values) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    if lo == hi:
        return values[lo]
    w = pos - lo
    return values[lo] * (1 - w) + values[hi] * w


def outcome_guard(header: Iterable[str], accessed: Iterable[str]) -> None:
    header = set(header)
    accessed = set(accessed)
    if accessed & FORBIDDEN_COLUMNS:
        raise AssertionError(f"Outcome field access forbidden: {sorted(accessed & FORBIDDEN_COLUMNS)}")
    # Outcome columns may physically exist in the public archive. The audit
    # intentionally never addresses their positions or puts them in row maps.
    missing = [c for c in accessed if c not in header and c != "event_type"]
    if missing:
        raise ValueError(f"Missing required non-outcome columns: {missing}")


def open_draft(path: Path):
    return gzip.open(path, "rt", encoding="utf-8-sig", newline="")


def scan_skills(path: Path):
    """Read only identity/skill columns. No outcome column is indexed."""
    skills = {}
    draft_ids = set()
    with open_draft(path) as handle:
        reader = csv.reader(handle)
        header = tuple(next(reader))
        idx = {name: i for i, name in enumerate(header)}
        accessed = set(ACCESSED_DRAFT_COLUMNS & set(header))
        outcome_guard(header, accessed)
        required = {"draft_id", "user_n_games_bucket", "user_game_win_rate_bucket"}
        if not required <= set(header):
            raise ValueError(f"Missing skill columns: {sorted(required - set(header))}")
        did_at = idx["draft_id"]
        rate_at = idx["user_game_win_rate_bucket"]
        games_at = idx["user_n_games_bucket"]
        event_at = idx.get("event_type")
        for values in reader:
            if len(values) != len(header):
                continue
            did = values[did_at].strip()
            if not did:
                continue
            if event_at is not None and values[event_at].strip() != "PremierDraft":
                continue
            draft_ids.add(did)
            if did in skills:
                continue
            rate = parse_rate_bucket(values[rate_at])
            games = parse_games_lower_bound(values[games_at])
            if rate is None or games is None:
                continue
            skills[did] = DraftSkill(rate=rate, games_lower_bound=games)
    return skills, draft_ids, header


def load_examples(path: Path, wanted_ids: set[str], header: tuple[str, ...]):
    """Parse only state/action/candidate/pool columns for selected draft IDs."""
    pack_cols = candidate_columns(header)
    pool_cols = pool_columns(header)
    idx = {name: i for i, name in enumerate(header)}
    accessed = set(ACCESSED_DRAFT_COLUMNS & set(header)) | set(pack_cols) | set(pool_cols)
    outcome_guard(header, accessed)
    need = ("draft_id", "pick", "pack_number", "pick_number")
    if any(k not in idx for k in need):
        raise ValueError("Draft archive is missing pick-state columns")

    packed = [(c, idx[c]) for c in pack_cols]
    pooled = [(c, idx[c]) for c in pool_cols]
    by_draft = defaultdict(list)
    did_at, pick_at = idx["draft_id"], idx["pick"]
    pack_at, pos_at = idx["pack_number"], idx["pick_number"]

    with open_draft(path) as handle:
        reader = csv.reader(handle)
        actual = tuple(next(reader))
        if actual != header:
            raise ValueError("Draft header changed between passes")
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


def build_full_model(pairs, game_path: Path, set_id: str):
    counts = CountStore.empty()
    for _, ex in pairs:
        counts.observe(ex)
    base = OutOfFoldModel(counts, CountStore.empty())
    memo = {}

    def base_of(card, pack, pick):
        key = (card, pack, pick)
        if key not in memo:
            memo[key] = base.base_tendency(card, pack, pick)
        return memo[key]

    for _, ex in pairs:
        counts.observe_expected(ex, base_of)
    ids = {did for did, _ in pairs}
    fit = build_colour_table(game_path, pairs, ids, set_id)
    return OutOfFoldModel(counts, CountStore.empty(), fit)


def probs(model, ex: PickExample):
    raw = {
        card: model.card_tendency(card, ex.raw_pack_number, ex.raw_pick_number, ex.pool)
        for card in ex.candidates
    }
    return normalize_probabilities(raw)


def ranking(p):
    return sorted(p, key=lambda card: (-p[card], card))


def kendall_tau(order_a, order_b):
    if len(order_a) < 2:
        return 1.0
    pos = {card: i for i, card in enumerate(order_b)}
    con = dis = 0
    for i in range(len(order_a)):
        for j in range(i + 1, len(order_a)):
            if pos[order_a[i]] < pos[order_a[j]]:
                con += 1
            else:
                dis += 1
    return (con - dis) / (con + dis) if con + dis else 1.0


def read_corpus(path: Path):
    rows = []
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def source_hash(set_id, draft_id):
    return hashlib.sha256(f"{set_id}|{draft_id}".encode()).hexdigest()[:32]


def research_ids(set_id: str, cohort_path: Path):
    data = json.loads(cohort_path.read_text())
    if set_id in CORE:
        selected = [x for x in data["selected_drafts"] if x["expansion"].lower() == set_id]
        prior = {x["draft_id"] for x in selected if x["split"] == "train"}
        eval_ids = {
            x["draft_id"] for x in selected
            if x["split"] in ("validation", "assessment")
        }
        return prior, {"core_validation_assessment": eval_ids}, {
            "cohort_id": data.get("cohort_id"),
            "selected_drafts_sha256": data.get("selected_drafts_sha256"),
        }
    prior = set(data["prior_train_ids"])
    return prior, {"spent_20k": set(data["confirmation_ids"])}, {
        "draft_sha256": data["draft_sha256"],
        "prior_train_n": len(prior),
        "prior_8000_n": len(data["prior_8000_ids"]),
        "spent_20k_n": len(data["confirmation_ids"]),
    }


def load_freeze(path: Path | None):
    if path is None:
        return None, {}, {}
    import numpy as np
    z = np.load(path, allow_pickle=False)
    dids = [str(x) for x in z["draft_ids"]]
    packs = [int(x) for x in z["pack_number"]]
    picks = [int(x) for x in z["pick_number"]]
    exact = {(d, p, k) for d, p, k in zip(dids, packs, picks)}
    unique = set(dids)

    behavior = {}
    incumbent = {}
    if all(k in z.files for k in ("offsets", "candidate_names", "primary_behavior")):
        offsets = z["offsets"]
        names = z["candidate_names"]
        pb = z["primary_behavior"]
        inc = z["incumbent_ord"] if "incumbent_ord" in z.files else None
        for i, key in enumerate(zip(dids, packs, picks)):
            lo, hi = int(offsets[i]), int(offsets[i + 1])
            behavior[key] = {str(names[j]): float(pb[j]) for j in range(lo, hi)}
            if inc is not None:
                ordinal = int(inc[i])
                if 0 <= ordinal < hi - lo:
                    incumbent[key] = str(names[lo + ordinal])
    return unique, exact, {"behavior": behavior, "incumbent": incumbent}


def example_lookup(examples):
    return {
        (did, ex.raw_pack_number + 1, ex.raw_pick_number + 1): ex
        for did, rows in examples.items()
        for ex in rows
    }


def summarize_scope(rows):
    n = len(rows)
    disagreements = [r for r in rows if not r["agree"]]
    dep_m = [r["deployed_margin"] for r in disagreements]
    res_m = [r["research_margin"] for r in disagreements]
    both = [max(r["deployed_margin"], r["research_margin"]) for r in disagreements]
    common = Counter((r["deployed_top"], r["research_top"]) for r in disagreements)
    focal = sum(
        1 for r in disagreements
        if r["stage"] == "P1P1"
        and (r["deployed_top"] in FOCAL_CARDS or r["research_top"] in FOCAL_CARDS)
    )
    p1 = [r for r in rows if r["stage"] == "P1P1"]
    later = [r for r in rows if r["stage"] != "P1P1"]

    def core(group):
        if not group:
            return {"n": 0, "top1_agreement": None, "top2_overlap": None, "kendall_tau": None}
        return {
            "n": len(group),
            "top1_agreement": sum(r["agree"] for r in group) / len(group),
            "top2_overlap": statistics.fmean(r["top2_overlap"] for r in group),
            "kendall_tau": statistics.fmean(r["kendall_tau"] for r in group),
        }

    return {
        **core(rows),
        "p1p1": core(p1),
        "p1p2_p1p8": core(later),
        "disagreements": len(disagreements),
        "disagreement_rate": len(disagreements) / n if n else None,
        "margins": {
            "deployed": {q: percentile(dep_m, v) for q, v in (("median", .5), ("p90", .9), ("p95", .95), ("max", 1))},
            "research": {q: percentile(res_m, v) for q, v in (("median", .5), ("p90", .9), ("p95", .95), ("max", 1))},
            "max_of_two": {q: percentile(both, v) for q, v in (("median", .5), ("p90", .9), ("p95", .95), ("max", 1))},
            "both_le_0_05": sum(x <= .05 for x in both) / len(both) if both else None,
            "both_le_0_10": sum(x <= .10 for x in both) / len(both) if both else None,
            "both_le_0_20": sum(x <= .20 for x in both) / len(both) if both else None,
        },
        "common_card_pairs": [
            {"deployed": a, "research": b, "n": count}
            for (a, b), count in common.most_common(20)
        ],
        "p1p1_disagreements_involving_frozen_10": focal,
        "frozen_10_cards": sorted(FOCAL_CARDS),
        "sample_disagreements": disagreements[:100],
    }


def evaluate_scope(name, set_id, dids, exact_keys, lookup, prod_training, fold_models,
                   full_prod, research_model, freeze_meta):
    rows = []
    missing = 0
    incumbent_mismatch = 0
    behavior_map = freeze_meta.get("behavior", {})
    incumbent_map = freeze_meta.get("incumbent", {})
    for key, ex in lookup.items():
        did, pack, pick = key
        if did not in dids or pack != 1 or not 1 <= pick <= 8:
            continue
        if exact_keys is not None and key not in exact_keys:
            continue
        dep_model = fold_models[stable_fold(did, 5)] if did in prod_training else full_prod
        dp = probs(dep_model, ex)
        rp = probs(research_model, ex)
        dr, rr = ranking(dp), ranking(rp)
        dt, rt = dr[0], rr[0]
        if key in incumbent_map and incumbent_map[key] != rt:
            incumbent_mismatch += 1
        overlap = len(set(dr[:2]) & set(rr[:2])) / min(2, len(dr), len(rr))
        b = behavior_map.get(key, {})
        rows.append({
            "scope": name,
            "set": set_id,
            "draft_id": did,
            "stage": f"P1P{pick}",
            "historical_pick": ex.historical_pick,
            "deployed_top": dt,
            "research_top": rt,
            "agree": dt == rt,
            "top2_overlap": overlap,
            "kendall_tau": kendall_tau(dr, rr),
            "deployed_margin": 0.0 if dt == rt else dp[dt] - dp[rt],
            "research_margin": 0.0 if dt == rt else rp[rt] - rp[dt],
            "deployed_top_probability": dp[dt],
            "research_top_probability": rp[rt],
            "research_strong_propensity_of_deployed_pick": rp[dt],
            "research_strong_propensity_of_research_pick": rp[rt],
            "broad_behavior_propensity_of_deployed_pick": b.get(dt),
            "broad_behavior_propensity_of_research_pick": b.get(rt),
        })
    expected = sum(1 for key in lookup if key[0] in dids and key[1] == 1 and 1 <= key[2] <= 8
                   and (exact_keys is None or key in exact_keys))
    missing = max(0, expected - len(rows))
    return rows, {"incumbent_top_mismatches_vs_frozen_context": incumbent_mismatch, "missing": missing}


def predictive(rows, strong_eval_ids):
    chosen = [r for r in rows if r["draft_id"] in strong_eval_ids]
    if not chosen:
        return {"n": 0}
    dep_hits = res_hits = 0
    dep_loss = res_loss = 0.0
    # Prediction probabilities on the historical pick are not retained in
    # compact row output, so this is filled by caller only when requested.
    return {"n": len(chosen), "note": "computed separately from candidate probabilities"}


def run_set(args):
    set_id = args.set_id.lower()
    if set_id not in SETS:
        raise ValueError(set_id)
    draft_path, game_path = Path(args.draft), Path(args.game)
    corpus_path = ROOT / "corpus/draft-run" / f"{set_id}.json.gz"
    manifest_path = ROOT / "data" / set_id / "manifest.json"
    catalog = json.loads((ROOT / "corpus/draft-run/catalog.json").read_text())
    cat = next(x for x in catalog["sets"] if x["id"] == set_id)
    manifest = json.loads(manifest_path.read_text())

    identity = {
        "set": set_id,
        "step0_commit": STEP0_COMMIT,
        "release_commit": RELEASE_COMMIT,
        "builder": "scripts/import_all_trophies.py using build_replays strong-player-colour-stage-v4 path",
        "corpus_sha256": sha256(corpus_path),
        "catalog_corpus_sha256": cat["sha256"],
        "manifest_sha256": sha256(manifest_path),
        "draft_archive_sha256": sha256(draft_path),
        "catalog_draft_archive_sha256": cat["source_archive"]["sha256"],
        "game_archive_sha256": sha256(game_path),
        "expected_research_game_sha256": EXPECTED_GAME_SHA256[set_id],
        "manifest_data_date": manifest["source"]["data_date"],
        "catalog_source_date": cat["source_date"],
        "catalog_last_modified": cat["source_archive"].get("last_modified"),
    }
    identity["corpus_hash_match"] = identity["corpus_sha256"] == identity["catalog_corpus_sha256"]
    identity["draft_hash_match"] = identity["draft_archive_sha256"] == identity["catalog_draft_archive_sha256"]
    identity["game_hash_match_research"] = identity["game_archive_sha256"] == identity["expected_research_game_sha256"]
    identity["data_date_match"] = identity["manifest_data_date"] == identity["catalog_source_date"]

    skills, all_dids, header = scan_skills(draft_path)
    training, cutoff, experienced = select_strong_drafts(skills, 100, .15, 5000)
    training = set(training)
    cohort = manifest["cohort"]
    cohort_match = (
        len(training) == int(cohort["training_drafts"])
        and experienced == int(cohort["experienced_drafts"])
        and abs(cutoff - float(cohort["win_rate_cutoff"])) <= 1e-12
        and manifest["model"]["version"] == "strong-player-colour-stage-v4"
        and manifest["model"]["holdout"] == "5-fold by draft_id"
    )

    corpus = read_corpus(corpus_path)
    by_hash = {source_hash(set_id, did): did for did in all_dids}
    served_ids = set()
    unmapped = []
    for puzzle in corpus:
        did = by_hash.get(puzzle["source_draft_hash"])
        if did is None:
            unmapped.append(puzzle["source_draft_hash"])
        else:
            served_ids.add(did)

    prior_ids, scopes, research_meta = research_ids(set_id, Path(args.cohort))
    freeze_ids = set()
    freeze_exact = None
    freeze_meta = {}
    if args.freeze_context:
        freeze_ids, freeze_exact, freeze_meta = load_freeze(Path(args.freeze_context))
        scopes["spent_45k"] = freeze_ids

    research_skills = {did: skills[did] for did in prior_ids if did in skills}
    research_strong, research_cutoff, research_experienced = select_strong_drafts(
        research_skills, 100, .15, 5000
    )
    research_strong = set(research_strong)

    wanted = set(training) | served_ids | prior_ids | research_strong
    for ids in scopes.values():
        wanted |= set(ids)
    examples = load_examples(draft_path, wanted, header)
    lookup = example_lookup(examples)

    prod_pairs = [(did, ex) for did in training for ex in examples.get(did, ())]
    folds = build_fold_training(prod_pairs, training, 5)
    fits = build_colour_tables_by_fold(game_path, prod_pairs, folds, set_id)
    fold_models = {
        f.fold: OutOfFoldModel(f.counts, CountStore.empty(), fits[f.fold])
        for f in folds
    }
    full_prod = build_full_model(prod_pairs, game_path, set_id)

    research_pairs = [(did, ex) for did in research_strong for ex in examples.get(did, ())]
    research_model = build_full_model(research_pairs, game_path, set_id)

    repro_errors = []
    max_abs = 0.0
    top_mismatch = 0
    candidates_checked = 0
    decisions_checked = 0
    for puzzle in corpus:
        did = by_hash.get(puzzle["source_draft_hash"])
        if did is None:
            continue
        key = (did, int(puzzle["pack_number"]), int(puzzle["pick_number"]))
        ex = lookup.get(key)
        if ex is None:
            repro_errors.append({"key": key, "error": "source decision missing"})
            continue
        model = fold_models[stable_fold(did, 5)] if did in training else full_prod
        p = probs(model, ex)
        stored = {c["name"]: float(c["model_probability"]) for c in puzzle["candidates"]}
        if set(stored) != set(p):
            repro_errors.append({"key": key, "error": "candidate set mismatch"})
            continue
        for card, sv in stored.items():
            delta = abs(p[card] - sv)
            max_abs = max(max_abs, delta)
            candidates_checked += 1
            if delta > 1e-6:
                repro_errors.append({"key": key, "card": card, "stored": sv, "reproduced": p[card], "abs": delta})
                if len(repro_errors) >= 50:
                    break
        s_top = sorted(stored, key=lambda c: (-stored[c], c))[0]
        r_top = ranking(p)[0]
        top_mismatch += int(s_top != r_top)
        decisions_checked += 1
        if len(repro_errors) >= 50:
            break

    reproduction_pass = (
        not unmapped and not repro_errors and max_abs <= 1e-6 and top_mismatch == 0
        and cohort_match
    )

    served_rows, served_check = evaluate_scope(
        "served_v8", set_id, served_ids, None, lookup, training, fold_models,
        full_prod, research_model, freeze_meta={}
    )

    scope_rows = {"served_v8": served_rows}
    scope_checks = {"served_v8": served_check}
    if reproduction_pass:
        for name, ids in scopes.items():
            exact = freeze_exact if name == "spent_45k" else None
            rows, check = evaluate_scope(
                name, set_id, set(ids), exact, lookup, training, fold_models,
                full_prod, research_model, freeze_meta if name == "spent_45k" else {}
            )
            scope_rows[name] = rows
            scope_checks[name] = check

    # Secondary held-out strong-player prediction on research evaluation scopes,
    # outside both model training sets.
    strong_cutoff_ids = {
        did for did, skill in skills.items()
        if skill.games_lower_bound >= 100 and skill.rate >= cutoff
    }
    eval_ids = set().union(*(set(v) for k, v in scopes.items()))
    held_ids = eval_ids & strong_cutoff_ids - training - prior_ids
    pred_n = dep_hit = res_hit = 0
    dep_loss = res_loss = 0.0
    if reproduction_pass:
        for key, ex in lookup.items():
            did, pack, pick = key
            if did not in held_ids or pack != 1 or not 1 <= pick <= 8:
                continue
            dm = fold_models[stable_fold(did, 5)] if did in training else full_prod
            dp, rp = probs(dm, ex), probs(research_model, ex)
            if ex.historical_pick not in dp or ex.historical_pick not in rp:
                continue
            pred_n += 1
            dep_hit += int(ranking(dp)[0] == ex.historical_pick)
            res_hit += int(ranking(rp)[0] == ex.historical_pick)
            dep_loss += -math.log(max(dp[ex.historical_pick], 1e-12))
            res_loss += -math.log(max(rp[ex.historical_pick], 1e-12))

    report = {
        "schema": 1,
        "set": set_id,
        "outcome_guard": {
            "outcome_fields_accessed": [],
            "forbidden_fields": sorted(FORBIDDEN_COLUMNS),
            "draft_fields_addressed": sorted(ACCESSED_DRAFT_COLUMNS),
            "game_path": "deck_fit.scan_deck_observations/build_colour_table: draft_id, main_colors, deck_* only",
        },
        "identity": identity,
        "production_cohort": {
            "minimum_games": 100,
            "top_fraction": .15,
            "cap": 5000,
            "folds": 5,
            "training_drafts": len(training),
            "experienced_drafts": experienced,
            "win_rate_cutoff": cutoff,
            "manifest_match": cohort_match,
        },
        "research_A": {
            "prior_training_ids": len(prior_ids),
            "experienced_in_prior": research_experienced,
            "strong_training_ids": len(research_strong),
            "strong_cutoff": research_cutoff,
            "definition": "ArchiveSignalProvider strong_choice_probability path reconstructed outcome-free from identical OutOfFoldModel/count/deck-colour inputs",
            "cohort": research_meta,
        },
        "reproduction": {
            "pass": reproduction_pass,
            "served_decisions_checked": decisions_checked,
            "candidate_probabilities_checked": candidates_checked,
            "max_abs_probability_error": max_abs,
            "top_pick_mismatches": top_mismatch,
            "unmapped_source_hashes": unmapped[:20],
            "errors": repro_errors[:20],
        },
        "scope_checks": scope_checks,
        "agreement": {name: summarize_scope(rows) for name, rows in scope_rows.items()},
        "training_overlap": {
            name: len(set(ids) & training) for name, ids in scopes.items()
        },
        "held_out_strong_player_prediction": {
            "drafts": len(held_ids),
            "decisions": pred_n,
            "deployed_A_top1_accuracy": dep_hit / pred_n if pred_n else None,
            "research_A_top1_accuracy": res_hit / pred_n if pred_n else None,
            "deployed_A_log_loss": dep_loss / pred_n if pred_n else None,
            "research_A_log_loss": res_loss / pred_n if pred_n else None,
        },
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "set": set_id,
        "reproduction": report["reproduction"],
        "agreements": {
            k: {"n": v["n"], "top1": v["top1_agreement"], "disagreements": v["disagreements"]}
            for k, v in report["agreement"].items()
        },
    }, indent=2))


def aggregate(args):
    root = Path(args.aggregate)
    reports = []
    for sid in SETS:
        matches = list(root.rglob(f"{sid}.json"))
        if len(matches) != 1:
            raise ValueError(f"{sid}: expected exactly one report, found {matches}")
        reports.append(json.loads(matches[0].read_text()))

    reproduction_ok = all(r["reproduction"]["pass"] for r in reports)
    served_pass = {
        r["set"]: (r["agreement"]["served_v8"]["top1_agreement"] or 0) >= .95
        for r in reports
    }
    close = {
        r["set"]: r["agreement"]["served_v8"]["margins"]["max_of_two"]
        for r in reports
    }
    # Frozen rule: numerical gate is >=95% in every set; close-call margins are
    # reported rather than retroactively inventing a second numerical threshold.
    transfer = reproduction_ok and all(served_pass.values())
    verdict = (
        "inconclusive: reproduction failed"
        if not reproduction_ok
        else ("research verdict transfers" if transfer else "does not transfer")
    )

    all_scopes = sorted(set().union(*(r["agreement"].keys() for r in reports)))
    aggregate_scopes = {}
    for scope in all_scopes:
        rows = []
        # Combine metrics by decision-count weighting without rehydrating all rows.
        available = [(r["set"], r["agreement"][scope]) for r in reports if scope in r["agreement"]]
        n = sum(x["n"] for _, x in available)
        if not n:
            continue
        def w(field):
            return sum(x["n"] * x[field] for _, x in available if x[field] is not None) / n
        aggregate_scopes[scope] = {
            "n": n,
            "top1_agreement": w("top1_agreement"),
            "top2_overlap": w("top2_overlap"),
            "kendall_tau": w("kendall_tau"),
            "per_set": {sid: x for sid, x in available},
        }

    final = {
        "schema": 1,
        "decision_rule_commit": STEP0_COMMIT,
        "release_commit": RELEASE_COMMIT,
        "verdict": verdict,
        "reproduction_all_sets": reproduction_ok,
        "step0_top1_pass_each_set": served_pass,
        "served_close_call_margins": close,
        "outcome_fields_accessed": [],
        "per_set": reports,
        "aggregate_scopes": aggregate_scopes,
    }
    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / "report.json").write_text(json.dumps(final, indent=2, sort_keys=True) + "\n")

    lines = [
        "# Issue #529 — deployed A vs research A transfer audit",
        "",
        f"- Step-0 decision-rule commit: {STEP0_COMMIT}",
        f"- v8 release commit: {RELEASE_COMMIT}",
        f"- Outcome fields accessed by this audit: none",
        f"- Exact production reproduction across all eight sets: {'PASS' if reproduction_ok else 'FAIL'}",
        f"- Verdict: **{verdict}**",
        "",
        "## Identity and exact reproduction",
        "",
        "| Set | corpus SHA-256 | manifest SHA-256 | draft snapshot | game snapshot | prod cohort | exact probabilities | top picks |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in reports:
        i, p, rr = r["identity"], r["production_cohort"], r["reproduction"]
        lines.append(
            f"| {r['set'].upper()} | {i['corpus_sha256']} | {i['manifest_sha256']} | "
            f"{'match' if i['draft_hash_match'] else 'MISMATCH'} | "
            f"{'match' if i['game_hash_match_research'] else 'MISMATCH'} | "
            f"{'match' if p['manifest_match'] else 'MISMATCH'} | "
            f"{rr['max_abs_probability_error']:.3g} max abs | {rr['top_pick_mismatches']} mismatches |"
        )

    lines += ["", "## Served v8 agreement", "",
              "| Set | N | top-1 | P1P1 top-1 | P1P2–P1P8 top-1 | top-2 overlap | Kendall tau | disagreements | margin p90 (max-of-two) | focal-10 P1P1 disagreements |",
              "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for r in reports:
        a = r["agreement"]["served_v8"]
        p1, pl = a["p1p1"], a["p1p2_p1p8"]
        m = a["margins"]["max_of_two"]["p90"]
        lines.append(
            f"| {r['set'].upper()} | {a['n']} | {a['top1_agreement']:.4%} | "
            f"{'—' if p1['top1_agreement'] is None else f'{p1['top1_agreement']:.4%}'} | "
            f"{'—' if pl['top1_agreement'] is None else f'{pl['top1_agreement']:.4%}'} | "
            f"{a['top2_overlap']:.4f} | {a['kendall_tau']:.4f} | {a['disagreements']} | "
            f"{'—' if m is None else f'{m:.6f}'} | {a['p1p1_disagreements_involving_frozen_10']} |"
        )

    lines += ["", "## Research-decision agreement", ""]
    for scope in ("core_validation_assessment", "spent_20k", "spent_45k"):
        available = [(r["set"], r["agreement"][scope]) for r in reports if scope in r["agreement"]]
        if not available:
            continue
        lines += [f"### {scope}", "",
                  "| Set | N | top-1 | P1P1 | P1P2–P1P8 | top-2 overlap | Kendall tau | deployed-training overlap |",
                  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
        for sid, a in available:
            r = next(x for x in reports if x["set"] == sid)
            p1, pl = a["p1p1"], a["p1p2_p1p8"]
            lines.append(
                f"| {sid.upper()} | {a['n']} | {a['top1_agreement']:.4%} | "
                f"{'—' if p1['top1_agreement'] is None else f'{p1['top1_agreement']:.4%}'} | "
                f"{'—' if pl['top1_agreement'] is None else f'{pl['top1_agreement']:.4%}'} | "
                f"{a['top2_overlap']:.4f} | {a['kendall_tau']:.4f} | "
                f"{r['training_overlap'].get(scope, 0)} |"
            )
        lines.append("")

    lines += ["## Secondary held-out strong-player prediction", "",
              "| Set | decisions | deployed top-1 | research top-1 | deployed log loss | research log loss |",
              "| --- | ---: | ---: | ---: | ---: | ---: |"]
    for r in reports:
        p = r["held_out_strong_player_prediction"]
        def fmt(v, pct=False):
            if v is None: return "—"
            return f"{v:.4%}" if pct else f"{v:.6f}"
        lines.append(
            f"| {r['set'].upper()} | {p['decisions']} | {fmt(p['deployed_A_top1_accuracy'], True)} | "
            f"{fmt(p['research_A_top1_accuracy'], True)} | {fmt(p['deployed_A_log_loss'])} | {fmt(p['research_A_log_loss'])} |"
        )

    lines += ["", "## Verdict", ""]
    if verdict == "research verdict transfers":
        lines.append(
            "research verdict transfers. Exact v8 probabilities/top picks reproduced first, and every set met the frozen >=95% served P1P1–P1P8 top-1 agreement gate. "
            "The disagreement-margin tables above characterize how close the remaining recommendation differences are; no production change follows from this audit."
        )
    elif verdict == "does not transfer":
        lines.append(
            "does not transfer. Exact deployed A reproduced, but at least one set failed the frozen >=95% served-decision agreement gate. "
            "Per the precommitted rule, the single permitted Step-4 diagnostic is required before any statement about the research value verdict; no production change follows from this audit alone."
        )
    else:
        lines.append(
            "inconclusive: reproduction failed. At least one set did not reproduce stored v8 model_probability values to 1e-6 and/or the exact served top pick, so no approximated deployed-A transfer conclusion is reported. "
            "Only the descriptive served comparison is retained, and no production change follows."
        )
    (outdir / "report.md").write_text("\n".join(lines) + "\n")
    print(json.dumps({"verdict": verdict, "reproduction_all_sets": reproduction_ok, "served_pass": served_pass}, indent=2))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--set", dest="set_id")
    p.add_argument("--draft")
    p.add_argument("--game")
    p.add_argument("--cohort")
    p.add_argument("--freeze-context")
    p.add_argument("--out")
    p.add_argument("--aggregate")
    args = p.parse_args()
    if args.aggregate:
        if not args.out:
            raise SystemExit("--aggregate requires --out")
        aggregate(args)
    else:
        for name in ("set_id", "draft", "game", "cohort", "out"):
            if not getattr(args, name):
                raise SystemExit(f"missing --{name.replace('_','-')}")
        run_set(args)


if __name__ == "__main__":
    main()
