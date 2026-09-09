#!/usr/bin/env python3
"""Audit every published Pack One dataset and write deterministic health reports.

Outputs:
  * data/<set>/quality.json -- per-dataset structural/model sanity report
  * data/status.json        -- compact live/pending/blocked pipeline status

The reports intentionally contain no wall-clock generation timestamp, so merely
re-running the audit cannot create a data commit or an import-trigger loop.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter
from pathlib import Path
from typing import Iterable, Optional, Sequence

REPO_ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = REPO_ROOT / "data" / "catalog.json"
QUEUE_PATH = REPO_ROOT / "data" / "import-queue.json"
STATUS_PATH = REPO_ROOT / "data" / "status.json"
PATH_MODEL_VERSION = "strong-player-counterfactual-path-v3"
SUPPORT_EXPONENT = 0.75


def read_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def repo_path(relative: str) -> Path:
    clean = str(relative or "").strip()
    while clean.startswith("./"):
        clean = clean[2:]
    return REPO_ROOT / clean


def quantile(values: Sequence[float], fraction: float) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * fraction)))
    return round(float(ordered[index]), 2)


def pct(value: int, total: int) -> float:
    return round(value / total, 4) if total else 0.0


def score_support(selected: float, best: float) -> int:
    if best <= 1e-12:
        return 100
    ratio = max(0.0, min(1.0, selected / best))
    return round((ratio ** SUPPORT_EXPONENT) * 100)


def first_pack_picks(replay: dict) -> list[dict]:
    picks = replay.get("picks") or []
    if not picks:
        return []
    first_pack = min(int(pick.get("pack_number") or 0) for pick in picks)
    return sorted(
        (pick for pick in picks if int(pick.get("pack_number") or 0) == first_pack),
        key=lambda pick: int(pick.get("pick_number") or 0),
    )


def add_issue(target: list[dict], code: str, message: str, **details) -> None:
    item = {"code": code, "message": message}
    if details:
        item["details"] = details
    target.append(item)


def audit_dataset(entry: dict) -> dict:
    set_id = str(entry.get("id") or "").lower()
    name = str(entry.get("name") or set_id.upper())
    manifest_path = repo_path(entry.get("manifest_path") or f"data/{set_id}/manifest.json")
    errors: list[dict] = []
    warnings: list[dict] = []

    if not manifest_path.exists():
        add_issue(errors, "manifest_missing", f"Manifest is missing for {set_id}.")
        return {
            "schema_version": 1,
            "set_id": set_id,
            "name": name,
            "status": "error",
            "errors": errors,
            "warnings": warnings,
            "metrics": {},
        }

    try:
        manifest = read_json(manifest_path, {})
    except Exception as exc:
        add_issue(errors, "manifest_invalid", f"Manifest could not be parsed: {exc}")
        return {
            "schema_version": 1, "set_id": set_id, "name": name,
            "status": "error", "errors": errors, "warnings": warnings, "metrics": {},
        }

    declared_replays = int(manifest.get("replay_count") or 0)
    shard_declared = sum(int(item.get("replay_count") or 0) for item in manifest.get("shards") or [])
    actual_replays = 0
    total_picks = 0
    probability_sum_errors = 0
    invalid_probabilities = 0
    missing_historical_pick = 0
    all_candidate_occurrences = 0
    image_occurrences = 0
    rarity_occurrences = 0
    unique_cards: set[str] = set()
    missing_image_names: set[str] = set()
    missing_rarity_names: set[str] = set()
    opening_top_support: list[float] = []
    historical_pack_scores: list[float] = []

    for shard_meta in manifest.get("shards") or []:
        shard_path = repo_path(shard_meta.get("path") or "")
        if not shard_path.exists():
            add_issue(errors, "shard_missing", f"Missing shard {shard_meta.get('path')!r}.")
            continue
        try:
            payload = read_json(shard_path, {})
        except Exception as exc:
            add_issue(errors, "shard_invalid", f"Could not parse {shard_meta.get('path')}: {exc}")
            continue
        replays = payload.get("replays") or []
        actual_replays += len(replays)

        for replay in replays:
            first_pack = first_pack_picks(replay)
            replay_score_weight = 0.0
            replay_score_total = 0.0
            for index, pick in enumerate(replay.get("picks") or []):
                candidates = pick.get("candidates") or []
                total_picks += 1
                if not candidates:
                    add_issue(errors, "empty_pick", "A replay pick has no candidates.", draft_id=replay.get("draft_id"))
                    continue

                probs = [float(card.get("model_probability") or 0) for card in candidates]
                if any(value < 0 or value > 1 or not math.isfinite(value) for value in probs):
                    invalid_probabilities += 1
                if abs(sum(probs) - 1.0) > 0.01:
                    probability_sum_errors += 1

                for card in candidates:
                    name_value = str(card.get("name") or "").strip()
                    if name_value:
                        unique_cards.add(name_value)
                    all_candidate_occurrences += 1
                    if card.get("image_url"):
                        image_occurrences += 1
                    elif name_value:
                        missing_image_names.add(name_value)
                    if card.get("rarity"):
                        rarity_occurrences += 1
                    elif name_value:
                        missing_rarity_names.add(name_value)

            if first_pack:
                first_candidates = first_pack[0].get("candidates") or []
                if len(first_candidates) >= 8:
                    opening_top_support.append(max(float(card.get("model_probability") or 0) for card in first_candidates))

                for pick in first_pack:
                    candidates = pick.get("candidates") or []
                    if not candidates:
                        continue
                    by_id = {str(card.get("id")): card for card in candidates}
                    selected = by_id.get(str(pick.get("historical_pick_id")))
                    if selected is None:
                        missing_historical_pick += 1
                        continue
                    best = max(float(card.get("model_probability") or 0) for card in candidates)
                    selected_prob = float(selected.get("model_probability") or 0)
                    weight = math.log2(max(1, len(candidates)))
                    replay_score_total += score_support(selected_prob, best) * weight
                    replay_score_weight += weight
                if replay_score_weight > 0:
                    historical_pack_scores.append(replay_score_total / replay_score_weight)

    if declared_replays != shard_declared:
        add_issue(errors, "manifest_shard_count_mismatch", "Manifest replay count does not equal shard metadata total.", declared=declared_replays, shards=shard_declared)
    if declared_replays != actual_replays:
        add_issue(errors, "actual_replay_count_mismatch", "Manifest replay count does not equal rows found in shards.", declared=declared_replays, actual=actual_replays)
    if actual_replays < 100:
        add_issue(errors, "too_few_replays", "Fewer than 100 playable replay seats were published.", actual=actual_replays)
    elif actual_replays < 280:
        add_issue(warnings, "low_replay_count", "Replay sample is smaller than the usual ~300-seat target.", actual=actual_replays)
    if invalid_probabilities:
        add_issue(errors, "invalid_probabilities", "Candidate probabilities outside [0,1] were found.", picks=invalid_probabilities)
    if probability_sum_errors:
        add_issue(errors, "probability_sum_errors", "At least one pack's rounded probabilities do not sum near 1.0.", picks=probability_sum_errors)
    if missing_historical_pick:
        add_issue(errors, "historical_pick_missing", "Historical selections were absent from rendered candidate lists.", picks=missing_historical_pick)

    training_drafts = int((manifest.get("cohort") or {}).get("training_drafts") or 0)
    training_picks = int((manifest.get("cohort") or {}).get("training_picks") or 0)
    if training_drafts < 1000:
        add_issue(warnings, "small_training_cohort", "Strong-player training cohort is below 1,000 drafts.", drafts=training_drafts)

    image_coverage = pct(image_occurrences, all_candidate_occurrences)
    rarity_coverage = pct(rarity_occurrences, all_candidate_occurrences)
    if image_coverage < 0.95:
        add_issue(warnings, "image_metadata_coverage", "Card image metadata coverage is below 95%.", coverage=image_coverage, examples=sorted(missing_image_names)[:8])
    if rarity_coverage < 0.95:
        add_issue(warnings, "rarity_metadata_coverage", "Card rarity metadata coverage is below 95%.", coverage=rarity_coverage, examples=sorted(missing_rarity_names)[:8])

    opening_p50 = quantile(opening_top_support, 0.50)
    if opening_p50 is not None and opening_p50 < 0.06:
        add_issue(warnings, "opening_consensus_unusually_flat", "Median opening-pack leader support is unusually low.", median=opening_p50)
    if opening_p50 is not None and opening_p50 > 0.80:
        add_issue(warnings, "opening_consensus_unusually_peaked", "Median opening-pack leader support is unusually high.", median=opening_p50)

    historical_p50 = quantile(historical_pack_scores, 0.50)
    if historical_p50 is not None and historical_p50 < 60:
        add_issue(warnings, "historical_score_unusually_low", "Strong historical seats score unexpectedly low against the consensus model.", median=historical_p50)
    if historical_p50 is not None and historical_p50 > 99:
        add_issue(warnings, "historical_score_unusually_high", "Historical seats are almost perfectly aligned with consensus; inspect for leakage.", median=historical_p50)

    path_path = manifest_path.parent / "path-model.json"
    path_metrics = {
        "present": path_path.exists(),
        "model_version": None,
        "cards": 0,
        "pairs": 0,
        "excluded_replay_drafts": 0,
        "candidate_card_coverage": 0.0,
        "bytes": 0,
    }
    if not path_path.exists():
        add_issue(errors, "path_model_missing", "Counterfactual path model is missing.")
    else:
        try:
            model = read_json(path_path, {})
            cards_value = model.get("cards") or []
            path_cards = set(cards_value.keys()) if isinstance(cards_value, dict) else set(str(item) for item in cards_value)
            pairs = model.get("pairs") or []
            excluded = int((model.get("training") or {}).get("excluded_replay_drafts") or 0)
            coverage = len(path_cards & unique_cards) / max(1, len(unique_cards))
            path_metrics.update({
                "model_version": model.get("model_version"),
                "cards": len(path_cards),
                "pairs": len(pairs),
                "excluded_replay_drafts": excluded,
                "candidate_card_coverage": round(coverage, 4),
                "bytes": path_path.stat().st_size,
            })
            if model.get("model_version") != PATH_MODEL_VERSION:
                add_issue(errors, "path_model_version", "Unexpected counterfactual path-model version.", actual=model.get("model_version"))
            if excluded < 100:
                add_issue(errors, "path_model_holdout", "Path model excludes fewer than 100 replay drafts.", excluded=excluded)
            if len(path_cards) < (250 if set_id == "powered-cube" else 100):
                add_issue(errors, "path_model_card_count", "Path model covers too few cards.", cards=len(path_cards))
            if len(pairs) < (500 if set_id == "powered-cube" else 100):
                add_issue(errors, "path_model_pair_count", "Path model covers too few card pairs.", pairs=len(pairs))
            if coverage < 0.70:
                add_issue(warnings, "path_model_card_coverage", "Path model covers less than 70% of candidate card names.", coverage=round(coverage, 4))
        except Exception as exc:
            add_issue(errors, "path_model_invalid", f"Path model could not be parsed: {exc}")

    status = "error" if errors else "warning" if warnings else "healthy"
    return {
        "schema_version": 1,
        "set_id": set_id,
        "name": name,
        "status": status,
        "data_date": str((manifest.get("source") or {}).get("data_date") or entry.get("data_date") or ""),
        "errors": errors,
        "warnings": warnings,
        "metrics": {
            "replays": {"declared": declared_replays, "actual": actual_replays},
            "training": {
                "drafts": training_drafts,
                "picks": training_picks,
                "win_rate_cutoff": (manifest.get("cohort") or {}).get("win_rate_cutoff"),
            },
            "cards": {
                "unique_candidates": len(unique_cards),
                "candidate_occurrences": all_candidate_occurrences,
                "image_metadata_coverage": image_coverage,
                "rarity_metadata_coverage": rarity_coverage,
            },
            "consensus": {
                "opening_top_support_p10": quantile(opening_top_support, 0.10),
                "opening_top_support_p50": opening_p50,
                "opening_top_support_p90": quantile(opening_top_support, 0.90),
                "historical_pack_score_p10": quantile(historical_pack_scores, 0.10),
                "historical_pack_score_p50": historical_p50,
                "historical_pack_score_p90": quantile(historical_pack_scores, 0.90),
            },
            "path_model": path_metrics,
        },
    }


def write_quality(report: dict) -> None:
    destination = REPO_ROOT / "data" / report["set_id"] / "quality.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def current_failures(path: Optional[Path]) -> dict[str, str]:
    payload = read_json(path, {}) if path else {}
    failures = {}
    for item in (payload or {}).get("failures") or []:
        code = str(item.get("code") or "").upper()
        if code:
            failures[code] = str(item.get("error") or "unknown import failure")
    return failures


def queue_status(catalog: dict, import_report: Optional[Path], prior_status: dict) -> list[dict]:
    queue = read_json(QUEUE_PATH, {}) or {}
    codes = [str(code).upper() for code in queue.get("sets") or []]
    live = {str(item.get("id") or "").upper() for item in catalog.get("sets") or [] if item.get("id")}
    failures = current_failures(import_report)
    prior_by_code = {
        str(item.get("code") or "").upper(): item
        for item in (prior_status.get("normal_queue") or [])
        if item.get("code")
    }
    rows = []
    for code in codes:
        if code in live:
            rows.append({"code": code, "status": "live"})
        elif code in failures:
            rows.append({"code": code, "status": "blocked", "reason": failures[code]})
        elif prior_by_code.get(code, {}).get("status") == "blocked":
            rows.append({"code": code, "status": "blocked", "reason": prior_by_code[code].get("reason")})
        else:
            rows.append({"code": code, "status": "pending"})
    return rows


def cube_status(catalog: dict, cube_report: Optional[Path], prior_status: dict) -> dict:
    live = next((item for item in catalog.get("sets") or [] if item.get("id") == "powered-cube"), None)
    if live:
        return {"id": "powered-cube", "name": "Powered Cube", "status": "live", "replay_count": int(live.get("replay_count") or 0)}

    report = read_json(cube_report, {}) if cube_report else None
    if report:
        if report.get("status") == "failed":
            diagnostics = report.get("rendered_replay_diagnostics") or {}
            return {
                "id": "powered-cube",
                "name": "Powered Cube",
                "status": "blocked",
                "reason": (report.get("error") or {}).get("message") or "Cube build failed",
                "rejection_reasons": diagnostics.get("rejection_reasons") or {},
            }
        return {"id": "powered-cube", "name": "Powered Cube", "status": str(report.get("status") or "building")}

    previous = prior_status.get("special_modes") or []
    prior_cube = next((item for item in previous if item.get("id") == "powered-cube"), None)
    return prior_cube or {"id": "powered-cube", "name": "Powered Cube", "status": "blocked", "reason": "not yet published"}


def build_status(catalog: dict, reports: Iterable[dict], *, import_report: Optional[Path], cube_report: Optional[Path]) -> dict:
    report_list = list(reports)
    prior = read_json(STATUS_PATH, {}) or {}
    normal = queue_status(catalog, import_report, prior)
    cube = cube_status(catalog, cube_report, prior)
    counts = Counter(report.get("status") for report in report_list)
    overall = "error" if counts.get("error") else "warning" if counts.get("warning") else "healthy"
    signature = [
        f"{item.get('id')}:{item.get('data_date')}:{item.get('replay_count')}"
        for item in catalog.get("sets") or []
        if item.get("id")
    ]
    return {
        "schema_version": 1,
        "catalog_signature": signature,
        "overall": overall,
        "published_dataset_count": len(report_list),
        "quality_counts": {key: counts.get(key, 0) for key in ("healthy", "warning", "error")},
        "datasets": [
            {
                "id": report["set_id"],
                "name": report["name"],
                "status": report["status"],
                "data_date": report.get("data_date"),
                "replay_count": (report.get("metrics") or {}).get("replays", {}).get("actual", 0),
                "warning_codes": [item["code"] for item in report.get("warnings") or []],
                "error_codes": [item["code"] for item in report.get("errors") or []],
            }
            for report in report_list
        ],
        "normal_queue": normal,
        "normal_queue_counts": {
            "live": sum(1 for item in normal if item["status"] == "live"),
            "pending": sum(1 for item in normal if item["status"] == "pending"),
            "blocked": sum(1 for item in normal if item["status"] == "blocked"),
        },
        "special_modes": [cube],
    }


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", default=str(CATALOG_PATH))
    parser.add_argument("--import-report", default="")
    parser.add_argument("--cube-report", default="")
    parser.add_argument("--fail-on-error", action="store_true")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    catalog_path = Path(args.catalog)
    catalog = read_json(catalog_path, {}) or {}
    reports = []
    for entry in catalog.get("sets") or []:
        if entry.get("is_fixture") or not entry.get("id"):
            continue
        report = audit_dataset(entry)
        write_quality(report)
        reports.append(report)

    status = build_status(
        catalog,
        reports,
        import_report=Path(args.import_report) if args.import_report else None,
        cube_report=Path(args.cube_report) if args.cube_report else None,
    )
    STATUS_PATH.write_text(json.dumps(status, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(status, indent=2, sort_keys=True))
    if args.fail_on_error and any(report["status"] == "error" for report in reports):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
