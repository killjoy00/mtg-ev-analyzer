#!/usr/bin/env python3
"""Compare frozen v3 scoring with the fold-isolated v4 candidate on pinned data.

This is a release-evidence tool, not a new tuning harness. It reconstructs the
current production cohort from the exact archived 17Lands inputs, requires the
legacy builder to reproduce every committed frozen probability, and then scores
those same decisions with v4. No model constants are fitted here.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_replays import (  # noqa: E402
    CountStore, OutOfFoldModel, build_colour_table, build_colour_tables_by_fold,
    choose_output_ids, normalize_probabilities, stable_fold,
)
from import_all_trophies import (  # noqa: E402
    collect_legacy_v3, collect_isolated, scan_metadata,
)
from build_replays import DraftSkill, select_strong_drafts  # noqa: E402


SETS = ("tmt", "hob", "msh", "blb", "sos")
GRADE_THRESHOLDS = (50, 60, 65, 70, 75, 80, 85, 90, 95)


def percentile(values, q):
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * q
    low = int(math.floor(position)); high = int(math.ceil(position))
    if low == high:
        return ordered[low]
    weight = position - low
    return ordered[low] * (1 - weight) + ordered[high] * weight


def score(probability, leader, historical=False):
    if historical:
        return 100
    return round(95 * probability / leader) if leader > 0 else 95


def implied_trophy_score(probability, leader):
    return round(95 * probability / leader) if leader > 0 else 95


def grade_bucket(value):
    for threshold in reversed(GRADE_THRESHOLDS):
        if value >= threshold:
            return threshold
    return 0


def difficulty(probabilities):
    ordered = sorted(probabilities.values(), reverse=True)
    if len(ordered) < 2 or ordered[0] <= 0:
        return 0
    return round(100 * ordered[1] / ordered[0])


def difficulty_band(value):
    if value < 50:
        return "easy"
    if value < 80:
        return "medium"
    return "hard"


def downloads():
    rows = json.loads((ROOT / "results/scoring-2026-09-16/downloads.json").read_text())
    return {(row["set_id"], row["kind"]): row for row in rows}


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_sources(work, set_id):
    pins = downloads()
    paths = {}
    for kind in ("draft_data", "game_data"):
        pin = pins[(set_id, kind)]
        path = work / set_id / f"{kind}.csv.gz"
        if not path.exists():
            raise ValueError(f"{path} is missing; workflow must download pinned inputs first")
        if path.stat().st_size != pin["bytes"] or sha256(path) != pin["sha256"]:
            raise ValueError(f"{set_id}/{kind}: pinned archive identity mismatch")
        paths[kind] = path
    return paths


def load_frozen(set_id):
    return json.loads(gzip.decompress((ROOT / "corpus/draft-run" / f"{set_id}.json.gz").read_bytes()))


def model_probabilities(model, example):
    raw = {
        card: model.card_tendency(
            card, example.raw_pack_number, example.raw_pick_number, example.pool)
        for card in example.candidates
    }
    return raw, normalize_probabilities(raw)


def reconstruct(set_id, draft_path, game_path):
    """Rebuild the exact normal-set v3 replay-builder context plus strict v4.

    The all-trophy corpus preserves rows from several historical publication
    contexts. The pinned baseline here is the original 300-replay v3 build for
    each set: its source IDs are deterministic, and those rows remain immutable
    inside the current corpus. That gives an exact artifact parity target rather
    than incorrectly pretending every later trophy row had one shared fit.
    """
    drafts, header, _, conflicts = scan_metadata(draft_path)
    skills = {
        did: DraftSkill(d["rate"], d["games"])
        for did, d in drafts.items()
        if did not in conflicts and d.get("rate") is not None and d.get("games") is not None
    }
    manifest = json.loads((ROOT / "data" / set_id / "manifest.json").read_text())
    training, cutoff, experienced = select_strong_drafts(skills, 100, .15, 5000)
    cohort = manifest.get("cohort", {})
    if len(training) != int(cohort.get("training_drafts", -1)):
        raise ValueError(
            f"{set_id}: pinned training cohort changed: {len(training)} vs "
            f"{cohort.get('training_drafts')}")
    if abs(cutoff - float(cohort.get("win_rate_cutoff", cutoff))) > 1e-9:
        raise ValueError(
            f"{set_id}: pinned win-rate cutoff changed: {cutoff} vs "
            f"{cohort.get('win_rate_cutoff')}")
    if experienced != int(cohort.get("experienced_drafts", experienced)):
        raise ValueError(
            f"{set_id}: pinned experienced cohort changed: {experienced} vs "
            f"{cohort.get('experienced_drafts')}")

    # This is the deterministic source-ID selection used by build_replays.py.
    output_ids = set(choose_output_ids(training, 300))

    # Frozen v3: direct held counts are subtracted after global aggregation and
    # one colour table is shared. This is retained only to reproduce the pinned
    # artifact being compared.
    old_counts, old_held, old_output, _, _, old_colour_examples = collect_legacy_v3(
        draft_path, set(training), output_ids, header)
    old_fit = build_colour_table(
        game_path, old_colour_examples,
        {draft_id for draft_id, _ in old_colour_examples}, set_id)
    old_models = [
        OutOfFoldModel(old_counts, old_held[fold], old_fit)
        for fold in range(5)
    ]

    # Candidate v4: the same IDs, packs and answers, but every numeric model
    # input is derived after removing the complete held fold.
    fold_training, new_output, _, _, new_colour_examples = collect_isolated(
        draft_path, set(training), output_ids, header)
    new_fits = build_colour_tables_by_fold(
        game_path, new_colour_examples, fold_training, set_id)
    new_models = [
        OutOfFoldModel(fold.counts, CountStore.empty(), new_fits[fold.fold])
        for fold in fold_training
    ]
    return output_ids, old_output, new_output, old_models, new_models, new_fits, manifest


def run_set(set_id, work):
    paths = verify_sources(work, set_id)
    output_ids, old_output, new_output, old_models, new_models, new_fits, manifest = reconstruct(
        set_id, paths["draft_data"], paths["game_data"])
    frozen = load_frozen(set_id)
    by_hash = {
        hashlib.sha256(f"{set_id}|{draft_id}".encode()).hexdigest()[:32]: draft_id
        for draft_id in output_ids
    }

    parity_errors = []
    decision_rows = []
    candidate_deltas = []
    ranking_movements = 0
    top1_changes = 0
    grade_crossings = 0
    serving_floor_crossings = 0
    difficulty_band_crossings = 0
    selection_state_changes = 0
    old_hits = new_hits = 0
    old_loss = new_loss = 0.0
    old_rank_sum = new_rank_sum = 0

    for puzzle in frozen:
        draft_id = by_hash.get(puzzle.get("source_draft_hash"))
        if draft_id is None:
            # Later all-trophy additions were built under their own immutable
            # publication context. They are not part of this exact v3 baseline.
            continue
        raw_pick = int(puzzle["pick_number"]) - 1
        old_example = next((p for p in old_output.get(draft_id, [])
                            if p.raw_pack_number == 0 and p.raw_pick_number == raw_pick), None)
        new_example = next((p for p in new_output.get(draft_id, [])
                            if p.raw_pack_number == 0 and p.raw_pick_number == raw_pick), None)
        if old_example is None or new_example is None:
            parity_errors.append(f"{draft_id}/pick {raw_pick}: source example missing")
            continue

        fold = stable_fold(draft_id, 5)
        old_raw, old_p = model_probabilities(old_models[fold], old_example)
        new_raw, new_p = model_probabilities(new_models[fold], new_example)
        frozen_p = {card["name"]: float(card["model_probability"]) for card in puzzle["candidates"]}
        for card, value in frozen_p.items():
            if card not in old_p or abs(round(old_p[card], 6) - value) > 5e-7:
                parity_errors.append(
                    f"{draft_id}/p{raw_pick + 1}/{card}: frozen={value} reconstructed={old_p.get(card)}")
                if len(parity_errors) >= 20:
                    break
        if len(parity_errors) >= 20:
            break

        cards = list(old_example.candidates)
        old_order = sorted(cards, key=lambda card: (-old_p[card], card))
        new_order = sorted(cards, key=lambda card: (-new_p[card], card))
        if old_order != new_order:
            ranking_movements += 1
        if old_order[0] != new_order[0]:
            top1_changes += 1

        historical = old_example.historical_pick
        old_hit = old_order[0] == historical
        new_hit = new_order[0] == historical
        old_hits += int(old_hit); new_hits += int(new_hit)
        old_loss += -math.log(max(old_p[historical], 1e-12))
        new_loss += -math.log(max(new_p[historical], 1e-12))
        old_rank = old_order.index(historical) + 1
        new_rank = new_order.index(historical) + 1
        old_rank_sum += old_rank; new_rank_sum += new_rank

        old_leader = old_p[old_order[0]]
        new_leader = new_p[new_order[0]]
        old_implied = implied_trophy_score(old_p[historical], old_leader)
        new_implied = implied_trophy_score(new_p[historical], new_leader)
        floor_changed = (old_implied >= 20) != (new_implied >= 20)
        if floor_changed:
            serving_floor_crossings += 1
        old_difficulty = difficulty(old_p)
        new_difficulty = difficulty(new_p)
        band_changed = difficulty_band(old_difficulty) != difficulty_band(new_difficulty)
        if band_changed:
            difficulty_band_crossings += 1
        if floor_changed or band_changed:
            selection_state_changes += 1

        per_candidate_abs = []
        for card in cards:
            old_score = score(old_p[card], old_leader, card == historical)
            new_score = score(new_p[card], new_leader, card == historical)
            delta = new_score - old_score
            candidate_deltas.append({
                "set": set_id, "draft_id": draft_id, "pick": raw_pick + 1,
                "card": card, "historical": card == historical,
                "old_score": old_score, "new_score": new_score, "delta": delta,
                "abs_delta": abs(delta),
            })
            per_candidate_abs.append(abs(delta))
            if grade_bucket(old_score) != grade_bucket(new_score):
                grade_crossings += 1

        colour = new_fits[fold].get("cards", {}).get(historical, {}).get("colours", "?")
        decision_rows.append({
            "set": set_id, "draft_id": draft_id, "pick": raw_pick + 1,
            "historical_card": historical, "colour": colour,
            "old_top1": old_order[0], "new_top1": new_order[0],
            "old_rank": old_rank, "new_rank": new_rank,
            "old_implied_trophy_score": old_implied,
            "new_implied_trophy_score": new_implied,
            "implied_score_delta": new_implied - old_implied,
            "old_difficulty": old_difficulty,
            "new_difficulty": new_difficulty,
            "difficulty_delta": new_difficulty - old_difficulty,
            "old_difficulty_band": difficulty_band(old_difficulty),
            "new_difficulty_band": difficulty_band(new_difficulty),
            "selection_state_changed": floor_changed or band_changed,
            "max_candidate_score_abs_delta": max(per_candidate_abs) if per_candidate_abs else 0,
            "max_probability_abs_delta": max(abs(new_p[c] - old_p[c]) for c in cards),
        })

    if parity_errors:
        raise ValueError(
            f"{set_id}: replay-builder reconstruction did not reproduce pinned v3: "
            + "; ".join(parity_errors[:5]))
    if len(decision_rows) < 500:
        raise ValueError(
            f"{set_id}: only {len(decision_rows)} pinned baseline decisions matched; "
            "expected broad coverage of the immutable 300-replay artifact.")

    n = len(decision_rows)
    abs_scores = [row["abs_delta"] for row in candidate_deltas]
    decision_abs = [abs(row["implied_score_delta"]) for row in decision_rows]
    return {
        "set_id": set_id,
        "decisions": n,
        "candidate_scores": len(candidate_deltas),
        "legacy_frozen_parity": True,
        "baseline_replays": int(manifest.get("replay_count", 0)),
        "old_prediction": {
            "top1_accuracy": old_hits / n if n else 0,
            "log_loss": old_loss / n if n else 0,
            "mean_historical_rank": old_rank_sum / n if n else 0,
        },
        "corrected_prediction": {
            "top1_accuracy": new_hits / n if n else 0,
            "log_loss": new_loss / n if n else 0,
            "mean_historical_rank": new_rank_sum / n if n else 0,
        },
        "ranking_changed": ranking_movements,
        "top1_changed": top1_changes,
        "serving_floor_20_crossings": serving_floor_crossings,
        "difficulty_band_crossings": difficulty_band_crossings,
        "selection_state_changes": selection_state_changes,
        "grade_boundary_crossings": grade_crossings,
        "candidate_score_abs_change": {
            "median": percentile(abs_scores, .5),
            "p90": percentile(abs_scores, .9),
            "p95": percentile(abs_scores, .95),
            "max": max(abs_scores, default=0),
        },
        "implied_trophy_score_abs_change": {
            "median": percentile(decision_abs, .5),
            "p90": percentile(decision_abs, .9),
            "p95": percentile(decision_abs, .95),
            "max": max(decision_abs, default=0),
        },
        "_decisions": decision_rows,
        "_candidate_deltas": candidate_deltas,
    }


def summarize(results):
    decisions = [row for result in results for row in result.pop("_decisions")]
    candidate_deltas = [row for result in results for row in result.pop("_candidate_deltas")]
    n = sum(result["decisions"] for result in results)
    cand_n = sum(result["candidate_scores"] for result in results)

    def weighted(path):
        total = 0.0
        for result in results:
            value = result
            for key in path:
                value = value[key]
            total += value * result["decisions"]
        return total / n if n else 0.0

    abs_scores = [row["abs_delta"] for row in candidate_deltas]
    implied_abs = [abs(row["implied_score_delta"]) for row in decisions]
    difficulty_abs = [abs(row["difficulty_delta"]) for row in decisions]
    probability_abs = [row["max_probability_abs_delta"] for row in decisions]

    by_stage = defaultdict(list); by_colour = defaultdict(list); by_card = defaultdict(list)
    for row in decisions:
        magnitude = row["max_candidate_score_abs_delta"]
        by_stage[row["pick"]].append(magnitude)
        by_colour[row["colour"]].append(magnitude)
        by_card[row["historical_card"]].append(magnitude)

    def standout(group, minimum=5, limit=12):
        rows = []
        for key, values in group.items():
            if len(values) < minimum:
                continue
            rows.append({
                "key": key, "n": len(values),
                "mean_max_candidate_score_abs_delta": statistics.fmean(values),
                "p95": percentile(values, .95), "max": max(values),
            })
        return sorted(rows, key=lambda row: (-row["mean_max_candidate_score_abs_delta"], str(row["key"])))[:limit]

    changed_scores = sum(row["abs_delta"] > 0 for row in candidate_deltas)
    grade_crossings = sum(result["grade_boundary_crossings"] for result in results)
    floor_crossings = sum(result["serving_floor_20_crossings"] for result in results)
    difficulty_crossings = sum(result["difficulty_band_crossings"] for result in results)
    selection_changes = sum(result["selection_state_changes"] for result in results)
    return {
        "schema": 1,
        "old_model": "strong-player-colour-stage-v3",
        "corrected_model": "strong-player-colour-stage-v4",
        "pinned_source": "results/scoring-2026-09-16/downloads.json",
        "frozen_corpus": json.loads(
            (ROOT / "corpus/draft-run/catalog.json").read_text())["corpus_version"],
        "legacy_frozen_parity_all_sets": all(r["legacy_frozen_parity"] for r in results),
        "decisions": n,
        "candidate_scores": cand_n,
        "prediction": {
            "old_top1_accuracy": weighted(("old_prediction", "top1_accuracy")),
            "corrected_top1_accuracy": weighted(("corrected_prediction", "top1_accuracy")),
            "old_log_loss": weighted(("old_prediction", "log_loss")),
            "corrected_log_loss": weighted(("corrected_prediction", "log_loss")),
            "old_mean_historical_rank": weighted(("old_prediction", "mean_historical_rank")),
            "corrected_mean_historical_rank": weighted(("corrected_prediction", "mean_historical_rank")),
        },
        "ranking": {
            "decisions_with_any_ranking_change": sum(r["ranking_changed"] for r in results),
            "decisions_with_top1_change": sum(r["top1_changed"] for r in results),
        },
        "candidate_score_change": {
            "changed": changed_scores,
            "changed_pct": changed_scores / cand_n if cand_n else 0,
            "median_abs": percentile(abs_scores, .5),
            "p90_abs": percentile(abs_scores, .9),
            "p95_abs": percentile(abs_scores, .95),
            "max_abs": max(abs_scores, default=0),
            "grade_boundary_crossings": grade_crossings,
            "grade_boundary_crossing_pct": grade_crossings / cand_n if cand_n else 0,
        },
        "implied_trophy_score_change": {
            "median_abs": percentile(implied_abs, .5),
            "p90_abs": percentile(implied_abs, .9),
            "p95_abs": percentile(implied_abs, .95),
            "max_abs": max(implied_abs, default=0),
            "serving_floor_20_crossings": floor_crossings,
            "serving_floor_20_crossing_pct": floor_crossings / n if n else 0,
        },
        "probability_change": {
            "median_decision_max_abs": percentile(probability_abs, .5),
            "p90_decision_max_abs": percentile(probability_abs, .9),
            "p95_decision_max_abs": percentile(probability_abs, .95),
            "max_decision_max_abs": max(probability_abs, default=0),
        },
        "selection_movement": {
            "difficulty_band_crossings": difficulty_crossings,
            "difficulty_band_crossing_pct": difficulty_crossings / n if n else 0,
            "difficulty_abs_change": {
                "median": percentile(difficulty_abs, .5),
                "p90": percentile(difficulty_abs, .9),
                "p95": percentile(difficulty_abs, .95),
                "max": max(difficulty_abs, default=0),
            },
            "serving_floor_20_crossings": floor_crossings,
            "selection_relevant_state_changes": selection_changes,
            "selection_relevant_state_change_pct": selection_changes / n if n else 0,
        },
        "largest_change_groups": {
            "sets": sorted([
                {
                    "key": r["set_id"], "n": r["decisions"],
                    "p95_candidate_score_abs_change": r["candidate_score_abs_change"]["p95"],
                    "max_candidate_score_abs_change": r["candidate_score_abs_change"]["max"],
                }
                for r in results
            ], key=lambda row: (-row["p95_candidate_score_abs_change"], row["key"])),
            "stages": standout(by_stage, 5),
            "colours": standout(by_colour, 5),
            "historical_cards": standout(by_card, 5),
            "archetypes": {
                "available": False,
                "reason": "The pinned production inputs do not carry a validated archetype label; none is inferred."
            },
        },
        "strict_train_only_evaluation": {
            "construction_changes_formula": False,
            "expected_predictive_delta": 0.0,
            "reason": (
                "eval_model.py already filters to explicit train_ids before direct counts, "
                "pair expectations and deck-fit estimation. v4 changes production fold "
                "construction to match that isolation; it does not change the v3 scoring formula."
            ),
        },
        "per_set": results,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--sets", default=",".join(SETS))
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    selected = tuple(value.strip() for value in args.sets.split(",") if value.strip())
    unknown = set(selected) - set(SETS)
    if unknown:
        raise ValueError(f"Unknown sets: {sorted(unknown)}")
    results = [run_set(set_id, args.work) for set_id in selected]
    report = summarize(results)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
