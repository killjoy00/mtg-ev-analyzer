#!/usr/bin/env python3
"""Outcome-blind deployed-A vs research-A transfer audit for issue #529.

This program intentionally does not deserialize or index draft/game outcome
columns. It reconstructs only the strong-choice scoring models, then compares
their rankings. Step 4 outcome evaluation is deliberately not implemented here.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import re
import statistics
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable, Mapping, Sequence

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_replays import (  # noqa: E402
    CountStore,
    DraftSkill,
    OutOfFoldModel,
    build_colour_table,
    build_colour_tables_by_fold,
    build_fold_training,
    candidate_columns,
    normalize_probabilities,
    parse_example,
    parse_games_lower_bound,
    parse_rate_bucket,
    pool_columns,
    select_strong_drafts,
    stable_fold,
)
from deck_fit import scan_deck_observations  # noqa: E402

SETS = ("msh", "sos", "ecl", "tla", "eoe", "fin", "tdm", "dft")
FOCAL_CARDS = frozenset({
    "Elegy Acolyte",
    "Nova Hellkite",
    "Anticausal Vestige",
    "Lumen-Class Frigate",
    "Genemorph Imago",
    "Possibility Technician",
    "Warmaker Gunship",
    "Sunstar Chaplain",
    "Thrumming Hivepool",
    "Mightform Harmonizer",
})
PRODUCTION_RELEASE_COMMIT = "31fef96eb59599a31fe7cb431f128d549030b6ed"
PRODUCTION_MODEL = "strong-player-colour-stage-v4"
PRODUCTION_CORPUS = "elite-trophy-colour-stage-v8"
FORBIDDEN_OUTCOME_KEYS = (
    "event_match_wins",
    "event_match_losses",
    "won",
    "game_wins",
    "game_losses",
    "match_wins",
    "match_losses",
)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def percentile(values: Sequence[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(float(x) for x in values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * q
    low = int(math.floor(position))
    high = int(math.ceil(position))
    if low == high:
        return ordered[low]
    weight = position - low
    return ordered[low] * (1 - weight) + ordered[high] * weight


def describe(values: Sequence[float]) -> dict:
    return {
        "n": len(values),
        "median": percentile(values, 0.5),
        "p90": percentile(values, 0.9),
        "p95": percentile(values, 0.95),
        "max": max(values) if values else None,
        "mean": statistics.fmean(values) if values else None,
    }


def rank_order(probabilities: Mapping[str, float]) -> list[str]:
    return sorted(probabilities, key=lambda card: (-float(probabilities[card]), card))


def kendall_tau_total_order(a: Sequence[str], b: Sequence[str]) -> float:
    if len(a) != len(b) or set(a) != set(b):
        raise ValueError("ranking candidate sets differ")
    n = len(a)
    if n < 2:
        return 1.0
    pos = {card: i for i, card in enumerate(b)}
    concordant = discordant = 0
    for i in range(n):
        for j in range(i + 1, n):
            if pos[a[i]] < pos[a[j]]:
                concordant += 1
            else:
                discordant += 1
    return (concordant - discordant) / (concordant + discordant)


class AgreementStats:
    def __init__(self):
        self.n = 0
        self.agree = 0
        self.top2_overlap_sum = 0.0
        self.tau_sum = 0.0
        self.prod_margins: list[float] = []
        self.research_margins: list[float] = []
        self.behavior_prod: list[float] = []
        self.behavior_research: list[float] = []
        self.behavior_available = 0
        self.pairs: Counter[tuple[str, str]] = Counter()
        self.focal_pick_involved = 0
        self.focal_present = 0

    def add(
        self,
        candidates: Sequence[str],
        prod: Mapping[str, float],
        research: Mapping[str, float],
        *,
        pick_number: int,
        behavior: Mapping[str, float] | None = None,
    ) -> None:
        p_order = rank_order(prod)
        r_order = rank_order(research)
        self.n += 1
        self.agree += int(p_order[0] == r_order[0])
        self.top2_overlap_sum += len(set(p_order[:2]) & set(r_order[:2])) / 2.0
        self.tau_sum += kendall_tau_total_order(p_order, r_order)
        if p_order[0] == r_order[0]:
            return
        p, r = p_order[0], r_order[0]
        self.prod_margins.append(float(prod[p]) - float(prod[r]))
        self.research_margins.append(float(research[r]) - float(research[p]))
        self.pairs[(p, r)] += 1
        if pick_number == 0:
            if p in FOCAL_CARDS or r in FOCAL_CARDS:
                self.focal_pick_involved += 1
            if any(card in FOCAL_CARDS for card in candidates):
                self.focal_present += 1
        if behavior is not None and p in behavior and r in behavior:
            self.behavior_prod.append(float(behavior[p]))
            self.behavior_research.append(float(behavior[r]))
            self.behavior_available += 1

    def report(self) -> dict:
        disagreements = self.n - self.agree
        return {
            "n": self.n,
            "top1_agreement": self.agree / self.n if self.n else None,
            "top1_disagreements": disagreements,
            "top2_overlap_mean": self.top2_overlap_sum / self.n if self.n else None,
            "kendall_tau_mean": self.tau_sum / self.n if self.n else None,
            "disagreement_margins": {
                "deployed_leader_minus_research_pick": describe(self.prod_margins),
                "research_leader_minus_deployed_pick": describe(self.research_margins),
            },
            "behavior_propensity_on_disagreements": {
                "available_n": self.behavior_available,
                "deployed_pick": describe(self.behavior_prod),
                "research_pick": describe(self.behavior_research),
                "availability_note": (
                    "Exact pre-frozen primary behavior propensity is attached only where an "
                    "outcome-free research artifact stored candidate propensities (the 45k R freeze). "
                    "No substitute nuisance was fit for other blocks."
                ),
            },
            "common_disagreement_pairs": [
                {"deployed": pair[0], "research": pair[1], "n": n}
                for pair, n in self.pairs.most_common(12)
            ],
            "p1p1_focal": {
                "disagreements_where_either_recommendation_is_one_of_ten_focal_cards": self.focal_pick_involved,
                "disagreements_where_any_focal_card_is_present_in_pack": self.focal_present,
            },
        }


def source_hash(set_id: str, draft_id: str) -> str:
    return hashlib.sha256(f"{set_id}|{draft_id}".encode()).hexdigest()[:32]


def sanitized_corpus(path: Path) -> list[dict]:
    """Mask outcome values at byte level before JSON deserialization."""
    raw = gzip.decompress(path.read_bytes())
    key_alt = "|".join(re.escape(key) for key in FORBIDDEN_OUTCOME_KEYS).encode()
    pattern = re.compile(
        rb'("(?:(?:' + key_alt + rb'))"\s*:\s*)'
        rb'(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|"[^"]*")'
    )
    raw = pattern.sub(rb"\1null", raw)
    rows = json.loads(raw)
    if not isinstance(rows, list):
        raise ValueError("corpus payload is not a list")
    for row in rows:
        for key in FORBIDDEN_OUTCOME_KEYS:
            if key in row and row[key] is not None:
                raise AssertionError(f"outcome masking failed for {key}")
    return rows


def read_header(path: Path) -> tuple[list[str], dict[str, int]]:
    with gzip.open(path, "rt", encoding="utf-8", newline="") as fh:
        header = next(csv.reader(fh))
    return header, {name: i for i, name in enumerate(header)}


def require_safe_columns(names: Iterable[str]) -> None:
    for name in names:
        lower = name.lower()
        if any(key in lower for key in FORBIDDEN_OUTCOME_KEYS):
            raise AssertionError(f"forbidden outcome column requested: {name}")


def first_pass(
    draft_path: Path,
    set_id: str,
    served_hashes: set[str],
) -> tuple[dict[str, DraftSkill], set[str], dict[str, str], list[str]]:
    header, index = read_header(draft_path)
    needed = ("draft_id", "user_game_win_rate_bucket", "user_n_games_bucket")
    missing = set(needed) - set(index)
    if missing:
        raise ValueError(f"draft archive missing safe skill fields: {sorted(missing)}")
    require_safe_columns(needed)
    skills: dict[str, DraftSkill] = {}
    signatures: dict[str, tuple[float | None, int | None]] = {}
    conflicts: set[str] = set()
    by_source: dict[str, str] = {}
    with gzip.open(draft_path, "rt", encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh)
        next(reader)
        for values in reader:
            if len(values) != len(header):
                continue
            did = values[index["draft_id"]].strip()
            if not did:
                continue
            if did not in signatures:
                rate = parse_rate_bucket(values[index["user_game_win_rate_bucket"]])
                games = parse_games_lower_bound(values[index["user_n_games_bucket"]])
                signatures[did] = (rate, games)
                h = source_hash(set_id, did)
                if h in served_hashes:
                    by_source[h] = did
            else:
                # Only safe skill fields are checked. No outcome column is indexed.
                rate = parse_rate_bucket(values[index["user_game_win_rate_bucket"]])
                games = parse_games_lower_bound(values[index["user_n_games_bucket"]])
                if signatures[did] != (rate, games):
                    conflicts.add(did)
    for did, (rate, games) in signatures.items():
        if did in conflicts or rate is None or games is None:
            continue
        skills[did] = DraftSkill(rate=rate, games_lower_bound=games)
    return skills, conflicts, by_source, header


def safe_row(values: Sequence[str], header: Sequence[str], index: Mapping[str, int],
             pack_cols: Sequence[str], pool_cols: Sequence[str]) -> dict[str, str]:
    names = ["draft_id", "pick", "pack_number", "pick_number", *pack_cols, *pool_cols]
    require_safe_columns(names)
    return {name: values[index[name]] for name in names}


def collect_examples(
    draft_path: Path,
    all_training_ids: set[str],
    limited_ids: set[str],
    served_ids: set[str],
) -> tuple[list[tuple[str, object]], dict[tuple[str, int, int], object], set[str]]:
    header, index = read_header(draft_path)
    pack_cols = candidate_columns(header)
    pool_cols = pool_columns(header)
    required = {"draft_id", "pick", "pack_number", "pick_number", *pack_cols, *pool_cols}
    missing = required - set(index)
    if missing:
        raise ValueError(f"draft archive missing scoring fields: {sorted(missing)[:8]}")
    require_safe_columns(required)
    training_pairs: list[tuple[str, object]] = []
    examples: dict[tuple[str, int, int], object] = {}
    seen_limited: set[str] = set()
    wanted = all_training_ids | limited_ids | served_ids
    with gzip.open(draft_path, "rt", encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh)
        next(reader)
        for values in reader:
            if len(values) != len(header):
                continue
            did = values[index["draft_id"]].strip()
            if did not in wanted:
                continue
            try:
                pack = int(float(values[index["pack_number"]] or 0))
                pick = int(float(values[index["pick_number"]] or 0))
            except ValueError:
                continue
            needs_all = did in all_training_ids
            needs_served = did in served_ids and pack == 0 and pick <= 11
            needs_limited = did in limited_ids and pack == 0 and 0 <= pick <= 7
            if not (needs_all or needs_served or needs_limited):
                continue
            row = safe_row(values, header, index, pack_cols, pool_cols)
            ex = parse_example(row, pack_cols, pool_cols)
            if ex is None:
                continue
            if needs_all:
                training_pairs.append((did, ex))
            if needs_served or needs_limited:
                examples[(did, ex.raw_pack_number, ex.raw_pick_number)] = ex
                if needs_limited:
                    seen_limited.add(did)
    return training_pairs, examples, seen_limited


def build_research_model(
    pairs: Sequence[tuple[str, object]],
    research_strong_ids: set[str],
    game_path: Path,
    set_id: str,
) -> OutOfFoldModel:
    selected = [(did, ex) for did, ex in pairs if did in research_strong_ids]
    counts = CountStore.empty()
    for _, ex in selected:
        counts.observe(ex)
    base = OutOfFoldModel(counts, CountStore.empty())
    memo: dict[tuple[str, int, int], float] = {}

    def base_of(card: str, pack: int, pick: int) -> float:
        key = (card, pack, pick)
        if key not in memo:
            memo[key] = base.base_tendency(card, pack, pick)
        return memo[key]

    for _, ex in selected:
        counts.observe_expected(ex, base_of)
    fit = build_colour_table(game_path, selected, set(research_strong_ids), set_id)
    return OutOfFoldModel(counts, CountStore.empty(), fit)


def probabilities(model: OutOfFoldModel, ex) -> dict[str, float]:
    return normalize_probabilities({
        card: model.card_tendency(card, ex.raw_pack_number, ex.raw_pick_number, ex.pool)
        for card in ex.candidates
    })


def cohort_ids(cohort_path: Path, research_kind: str, expansion: str) -> tuple[set[str], dict[str, set[str]], dict]:
    payload = json.loads(cohort_path.read_text())
    if research_kind == "core":
        rows = [row for row in payload["selected_drafts"] if row["expansion"] == expansion]
        prior = {row["draft_id"] for row in rows if row["split"] == "train"}
        blocks = {
            "core_validation": {row["draft_id"] for row in rows if row["split"] == "validation"},
            "core_assessment": {row["draft_id"] for row in rows if row["split"] == "assessment"},
        }
    else:
        prior = set(payload["prior_train_ids"])
        blocks = {"spent_20k": set(payload["confirmation_ids"])}
    return prior, blocks, payload


def behavior_from_frozen(npz, decision_id: str, prod_pick: str, research_pick: str) -> dict[str, float] | None:
    if npz is None:
        return None
    lookup = npz["_decision_lookup"]
    i = lookup.get(decision_id)
    if i is None:
        return None
    start = int(npz["offsets"][i])
    end = int(npz["offsets"][i + 1])
    names = npz["candidate_names"][start:end]
    values = npz["primary_behavior"][start:end]
    result = {str(name): float(value) for name, value in zip(names, values)}
    if prod_pick not in result or research_pick not in result:
        return None
    return result


def load_frozen_45k(path: Path | None):
    if path is None:
        return None
    z = np.load(path, allow_pickle=False)
    data = {name: z[name] for name in z.files}
    data["_decision_lookup"] = {str(value): i for i, value in enumerate(data["decision_ids"])}
    return data


def frozen_research_leader(npz, decision_id: str) -> str | None:
    if npz is None:
        return None
    i = npz["_decision_lookup"].get(decision_id)
    if i is None:
        return None
    start = int(npz["offsets"][i])
    ordinal = int(npz["incumbent_ord"][i])
    return str(npz["candidate_names"][start + ordinal])


def model_identity_commit() -> dict:
    try:
        subject = subprocess.check_output(
            ["git", "show", "-s", "--format=%s", PRODUCTION_RELEASE_COMMIT],
            cwd=ROOT, text=True
        ).strip()
        present = True
    except Exception:
        subject = None
        present = False
    return {
        "commit": PRODUCTION_RELEASE_COMMIT,
        "commit_present_in_checkout": present,
        "subject": subject,
        "builders": [
            "scripts/import_all_trophies.py::build_set / collect_isolated",
            "scripts/build_replays.py::build_fold_training / OutOfFoldModel / render_replay",
            "scripts/deck_fit.py::build_colour_tables_by_fold",
        ],
    }


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--set-id", choices=SETS, required=True)
    p.add_argument("--expansion", required=True)
    p.add_argument("--draft-archive", type=Path, required=True)
    p.add_argument("--game-archive", type=Path, required=True)
    p.add_argument("--expected-draft-sha256", required=True)
    p.add_argument("--expected-game-sha256", required=True)
    p.add_argument("--research-kind", choices=("core", "fresh"), required=True)
    p.add_argument("--cohort-manifest", type=Path, required=True)
    p.add_argument("--frozen-45k", type=Path)
    p.add_argument("--output", type=Path, required=True)
    return p.parse_args()


def main() -> None:
    args = parse_args()
    sid = args.set_id
    expansion = args.expansion
    draft_sha = sha256_file(args.draft_archive)
    game_sha = sha256_file(args.game_archive)
    if draft_sha != args.expected_draft_sha256 or game_sha != args.expected_game_sha256:
        raise SystemExit("archive SHA-256 mismatch")

    corpus_path = ROOT / "corpus" / "draft-run" / f"{sid}.json.gz"
    manifest_path = ROOT / "data" / sid / "manifest.json"
    catalog = json.loads((ROOT / "corpus" / "draft-run" / "catalog.json").read_text())
    catalog_entry = next(row for row in catalog["sets"] if row["id"] == sid)
    manifest = json.loads(manifest_path.read_text())
    corpus = sanitized_corpus(corpus_path)
    served_hashes = {row["source_draft_hash"] for row in corpus}

    research_prior_ids, research_blocks, cohort_payload = cohort_ids(
        args.cohort_manifest, args.research_kind, expansion
    )
    frozen45 = load_frozen_45k(args.frozen_45k)
    if frozen45 is not None:
        research_blocks["r_45k"] = set(str(x) for x in frozen45["draft_ids"])

    skills, skill_conflicts, by_source, _ = first_pass(args.draft_archive, sid, served_hashes)
    missing_sources = sorted(served_hashes - set(by_source))
    production_training, production_cutoff, experienced_n = select_strong_drafts(
        skills, 100, 0.15, 5000
    )
    production_training = set(production_training)
    manifest_cohort = manifest.get("cohort", {})
    cohort_identity_ok = (
        len(production_training) == int(manifest_cohort.get("training_drafts", -1))
        and experienced_n == int(manifest_cohort.get("experienced_drafts", -1))
        and abs(production_cutoff - float(manifest_cohort.get("win_rate_cutoff", production_cutoff))) <= 1e-12
    )

    research_skills = {
        did: skills[did]
        for did in research_prior_ids
        if did in skills and skills[did].games_lower_bound >= 100
    }
    research_training, research_cutoff, research_experienced = select_strong_drafts(
        research_skills, 100, 0.15, 5000
    )
    research_strong_ids = set(research_training)

    # Every full-archive top-15% strong draft not used by either fitted model is
    # the secondary held-out strong-pick prediction population.
    full_elite, _, _ = select_strong_drafts(skills, 100, 0.15, None)
    heldout_strong_ids = set(full_elite) - production_training - research_strong_ids

    served_ids = set(by_source.values())
    target_ids = set().union(*research_blocks.values()) if research_blocks else set()
    limited_ids = target_ids | heldout_strong_ids
    all_training_ids = production_training | research_strong_ids
    training_pairs, examples, seen_limited = collect_examples(
        args.draft_archive, all_training_ids, limited_ids, served_ids
    )

    production_pairs = [(did, ex) for did, ex in training_pairs if did in production_training]
    fold_training = build_fold_training(production_pairs, production_training, 5)
    prod_fits = build_colour_tables_by_fold(
        args.game_archive, production_pairs, fold_training, sid
    )
    prod_models = [
        OutOfFoldModel(fold.counts, CountStore.empty(), prod_fits[fold.fold])
        for fold in fold_training
    ]
    research_model = build_research_model(
        training_pairs, research_strong_ids, args.game_archive, sid
    )

    # Step 2 reproduction gate: every stored candidate probability and every
    # stored top pick across the full current v8 parent corpus.
    reproduction_errors: list[str] = []
    max_abs_probability_error = 0.0
    reproduced_puzzles = 0
    top_pick_mismatches = 0
    candidate_set_mismatches = 0
    for puzzle in corpus:
        did = by_source.get(puzzle["source_draft_hash"])
        if did is None:
            reproduction_errors.append(f"unmapped source {puzzle['source_draft_hash']}")
            continue
        pick = int(puzzle["pick_number"]) - 1
        ex = examples.get((did, 0, pick))
        if ex is None:
            reproduction_errors.append(f"missing source example {did}/P1P{pick+1}")
            continue
        stored = {str(card["name"]): float(card["model_probability"]) for card in puzzle["candidates"]}
        if set(stored) != set(ex.candidates):
            candidate_set_mismatches += 1
            reproduction_errors.append(f"candidate set mismatch {did}/P1P{pick+1}")
            continue
        prod = probabilities(prod_models[stable_fold(did, 5)], ex)
        reproduced_puzzles += 1
        for card, value in stored.items():
            err = abs(float(prod[card]) - value)
            max_abs_probability_error = max(max_abs_probability_error, err)
            if err > 1e-6:
                reproduction_errors.append(
                    f"probability mismatch {did}/P1P{pick+1}/{card}: {prod[card]} vs {value}"
                )
                if len(reproduction_errors) >= 40:
                    break
        stored_top = sorted(stored, key=lambda card: (-stored[card], card))[0]
        prod_top = rank_order(prod)[0]
        if stored_top != prod_top:
            top_pick_mismatches += 1
            reproduction_errors.append(
                f"top pick mismatch {did}/P1P{pick+1}: {prod_top} vs {stored_top}"
            )
        if len(reproduction_errors) >= 40:
            break

    reproduction_pass = (
        not missing_sources
        and cohort_identity_ok
        and not reproduction_errors
        and reproduced_puzzles == len(corpus)
        and top_pick_mismatches == 0
        and candidate_set_mismatches == 0
        and max_abs_probability_error <= 1e-6
    )

    stats: dict[str, dict[str, AgreementStats]] = defaultdict(
        lambda: {
            "P1P1-P1P8": AgreementStats(),
            "P1P1": AgreementStats(),
            "P1P2-P1P8": AgreementStats(),
        }
    )

    def add_agreement(dataset: str, ex, prod, research, behavior=None):
        stages = ["P1P1-P1P8", "P1P1" if ex.raw_pick_number == 0 else "P1P2-P1P8"]
        for stage in stages:
            stats[dataset][stage].add(
                ex.candidates, prod, research,
                pick_number=ex.raw_pick_number, behavior=behavior
            )

    research_parity_45k_total = 0
    research_parity_45k_mismatch = 0

    if reproduction_pass:
        # Step 3a: every current served v8 P1P1-P1P8 decision.
        for puzzle in corpus:
            pick = int(puzzle["pick_number"]) - 1
            if not 0 <= pick <= 7:
                continue
            did = by_source[puzzle["source_draft_hash"]]
            ex = examples[(did, 0, pick)]
            prod = probabilities(prod_models[stable_fold(did, 5)], ex)
            research = probabilities(research_model, ex)
            add_agreement("served", ex, prod, research)

        # Step 3b: all requested research decision blocks.
        for block, ids in research_blocks.items():
            for did in sorted(ids):
                for pick in range(8):
                    ex = examples.get((did, 0, pick))
                    if ex is None:
                        continue
                    prod = probabilities(prod_models[stable_fold(did, 5)], ex)
                    research = probabilities(research_model, ex)
                    decision_id = f"{did}:0:{pick}"
                    frozen_leader = frozen_research_leader(frozen45, decision_id) if block == "r_45k" else None
                    if frozen_leader is not None:
                        research_parity_45k_total += 1
                        if rank_order(research)[0] != frozen_leader:
                            research_parity_45k_mismatch += 1
                    behavior = None
                    if block == "r_45k":
                        ptop = rank_order(prod)[0]
                        rtop = rank_order(research)[0]
                        behavior = behavior_from_frozen(frozen45, decision_id, ptop, rtop)
                    add_agreement(block, ex, prod, research, behavior)
                    add_agreement("research_combined", ex, prod, research, behavior)

    # Secondary: actual-pick prediction on strong drafts outside both training sets.
    pred = {
        "n_drafts": len(heldout_strong_ids),
        "n_decisions": 0,
        "deployed_top1_hits": 0,
        "research_top1_hits": 0,
        "deployed_log_loss_sum": 0.0,
        "research_log_loss_sum": 0.0,
    }
    if reproduction_pass:
        for did in sorted(heldout_strong_ids):
            for pick in range(8):
                ex = examples.get((did, 0, pick))
                if ex is None:
                    continue
                prod = probabilities(prod_models[stable_fold(did, 5)], ex)
                research = probabilities(research_model, ex)
                actual = ex.historical_pick
                pred["n_decisions"] += 1
                pred["deployed_top1_hits"] += int(rank_order(prod)[0] == actual)
                pred["research_top1_hits"] += int(rank_order(research)[0] == actual)
                pred["deployed_log_loss_sum"] += -math.log(max(prod.get(actual, 0.0), 1e-12))
                pred["research_log_loss_sum"] += -math.log(max(research.get(actual, 0.0), 1e-12))
    n_pred = pred["n_decisions"]
    prediction_report = {
        "population": (
            "All full-archive top-15%-by-recorded-win-rate experienced draft IDs "
            "outside both the deployed 5,000-draft training cohort and the research-A "
            "strong training cohort; one stable player identifier is unavailable, so "
            "this is draft-level rather than guaranteed unseen-player evaluation."
        ),
        "drafts": pred["n_drafts"],
        "decisions_p1p1_p1p8": n_pred,
        "deployed": {
            "top1_accuracy": pred["deployed_top1_hits"] / n_pred if n_pred else None,
            "log_loss": pred["deployed_log_loss_sum"] / n_pred if n_pred else None,
        },
        "research": {
            "top1_accuracy": pred["research_top1_hits"] / n_pred if n_pred else None,
            "log_loss": pred["research_log_loss_sum"] / n_pred if n_pred else None,
        },
    }

    research_block_counts = {}
    for block, ids in research_blocks.items():
        research_block_counts[block] = {
            "drafts": len(ids),
            "drafts_overlapping_deployed_training": len(ids & production_training),
            "eligible_decisions_found_p1p1_p1p8": sum(
                1 for did in ids for pick in range(8) if (did, 0, pick) in examples
            ),
        }

    metrics = {
        dataset: {stage: value.report() for stage, value in stages.items()}
        for dataset, stages in stats.items()
    }
    served_agree = metrics.get("served", {}).get("P1P1-P1P8", {}).get("top1_agreement")
    research_agree = metrics.get("research_combined", {}).get("P1P1-P1P8", {}).get("top1_agreement")
    set_threshold_pass = (
        reproduction_pass
        and served_agree is not None and served_agree >= 0.95
        and research_agree is not None and research_agree >= 0.95
        and research_parity_45k_mismatch == 0
    )

    core_archive_hash = None
    if args.research_kind == "core":
        wanted = [
            row for row in cohort_payload["archives"]
            if row["kind"] == "draft" and row["path"].endswith(f"draft-{expansion}.csv.gz")
        ]
        core_archive_hash = wanted[0]["sha256"] if wanted else None
    else:
        core_archive_hash = cohort_payload.get("draft_sha256")

    report = {
        "schema": 1,
        "set_id": sid,
        "expansion": expansion,
        "outcome_boundary": {
            "outcome_values_deserialized_from_corpus": False,
            "draft_outcome_columns_indexed": False,
            "game_outcome_columns_indexed": False,
            "step4_implemented_or_run": False,
            "note": (
                "Corpus outcome values are byte-masked to null before JSON parsing. "
                "Raw draft/game scanners index only draft state, skill buckets, deck_* and main_colors."
            ),
        },
        "step1_identity": {
            "production": {
                "corpus_version": catalog.get("corpus_version"),
                "model_version": catalog.get("model_version"),
                "release": model_identity_commit(),
                "corpus_file_sha256": sha256_file(corpus_path),
                "catalog_corpus_sha256": catalog_entry.get("sha256"),
                "manifest_file_sha256": sha256_file(manifest_path),
                "manifest_data_date": manifest.get("source", {}).get("data_date"),
                "catalog_source_date": catalog_entry.get("source_date"),
                "catalog_draft_archive_sha256": catalog_entry.get("source_archive", {}).get("sha256"),
                "actual_draft_archive_sha256": draft_sha,
                "actual_game_archive_sha256": game_sha,
            },
            "research": {
                "kind": args.research_kind,
                "frozen_draft_archive_sha256": core_archive_hash,
                "actual_draft_archive_sha256": draft_sha,
                "frozen_game_archive_sha256": args.expected_game_sha256,
                "actual_game_archive_sha256": game_sha,
                "draft_snapshot_matches_production": (
                    core_archive_hash == catalog_entry.get("source_archive", {}).get("sha256") == draft_sha
                ),
            },
            "data_date_matches_catalog": (
                manifest.get("source", {}).get("data_date") == catalog_entry.get("source_date")
            ),
        },
        "step2_reproduction": {
            "pass": reproduction_pass,
            "production_training": {
                "training_drafts": len(production_training),
                "experienced_drafts": experienced_n,
                "win_rate_cutoff": production_cutoff,
                "manifest_identity_match": cohort_identity_ok,
                "skill_field_conflict_drafts_excluded": len(skill_conflicts),
            },
            "served_puzzles": len(corpus),
            "reproduced_puzzles": reproduced_puzzles,
            "max_abs_probability_error": max_abs_probability_error,
            "top_pick_mismatches": top_pick_mismatches,
            "candidate_set_mismatches": candidate_set_mismatches,
            "unmapped_served_source_hashes": missing_sources[:20],
            "first_errors": reproduction_errors[:20],
            "scoring_rule": (
                "Exact production builder extension: each draft is scored by "
                "OutOfFoldModel[stable_fold(draft_id,5)], whose counts and colour "
                "fit are rebuilt only from that fold's training complement."
            ),
        },
        "research_a_fit": {
            "prior_training_drafts": len(research_prior_ids),
            "prior_training_drafts_with_safe_skill_fields": research_experienced,
            "strong_training_drafts": len(research_strong_ids),
            "win_rate_cutoff_within_prior_training": research_cutoff,
            "definition": (
                "Argmax strong-choice support reconstructed from the environment's "
                "research prior-training IDs: >=100 games, top 15% by recorded win-rate, "
                "stable-hash cap 5,000; OutOfFoldModel formula with a single complement fit."
            ),
            "frozen_45k_action_parity": {
                "checked_decisions": research_parity_45k_total,
                "mismatches": research_parity_45k_mismatch,
                "exact": research_parity_45k_mismatch == 0,
            },
        },
        "step3_agreement": metrics,
        "research_blocks": research_block_counts,
        "secondary_strong_pick_prediction": prediction_report,
        "step0_set_pass": set_threshold_pass,
        "step0_rule_interpretation": (
            "This set passes the numeric transfer gate only if both served-distribution "
            "and research-decision P1P1-P1P8 top-1 agreement are >=95%, exact deployed "
            "reproduction succeeds, and any available frozen research-A action parity is exact. "
            "Disagreement margins remain descriptive because Step 0 did not freeze a numeric "
            "support-margin cutoff for the phrase 'mostly close calls'."
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "set": sid,
        "reproduction_pass": reproduction_pass,
        "served_agreement": served_agree,
        "research_agreement": research_agree,
        "set_pass": set_threshold_pass,
        "research_45k_parity_mismatches": research_parity_45k_mismatch,
        "output": str(args.output),
    }, indent=2))


if __name__ == "__main__":
    main()
