#!/usr/bin/env python3
"""Revalidate Traditional playable-puzzle admission against the production v4 grader.

Research-only. Historical v3 artifacts are inputs, never overwritten. Traditional
rows are evaluation/source data only and never contribute to Premier model inputs.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
import gzip
import hashlib
import json
import time
import urllib.error
import urllib.parse
from email.utils import parsedate_to_datetime
from pathlib import Path

from build_replays import (
    CountStore,
    DraftSkill,
    ISOLATED_MODEL_VERSION,
    OutOfFoldModel,
    build_colour_tables_by_fold,
    candidate_columns,
    parse_example,
    parse_games_lower_bound,
    parse_rate_bucket,
    pool_columns,
    render_replay,
    select_strong_drafts,
    stable_fold,
    slugify,
)
from format_research import cohort
from format_residuals import metadata_for_set, residual_report
from import_all_trophies import (
    BASE,
    ROOT,
    archive,
    atomic_json,
    collect_isolated,
    csv_bytes,
    digest,
    eligible_trophies,
    encoded,
    metadata,
    rows,
    scan_metadata,
    trajectory,
    write_gzip_jsonl,
)
from traditional_puzzles import THRESHOLDS, compare, record
from set_policy import corpus_version
from run_import_all_trophies import resilient_request
from fetch_card_metadata import compact_card, aliases

EVENTS = ("PremierDraft", "TradDraft")
CUBE = "powered-cube"
SETS = (
    "hob", "msh", "sos", "eoe", "fin", "tdm", "dft", "fdn", "dsk", "blb",
    "mh3", "otj", "mkm", "ktk", "lci", "woe", "ltr", "mom", "one", "bro",
    "dmu", "snc", "neo", "hbg", "sir", "pio", CUBE,
)
EXCLUSIONS = {
    "tmt": "Phase 1 did not establish a complete current-product Traditional trajectory cohort.",
    "ecl": "Phase 1 did not establish a complete current-product Traditional trajectory cohort.",
    "tla": "Phase 1 did not establish a complete current-product Traditional trajectory cohort.",
    "mid": "No public TradDraft draft archive in the original Phase 1 source study.",
    "vow": "No public TradDraft draft archive in the original Phase 1 source study.",
    "stx": "Traditional archive lacked the current skill-bucket evidence required by the frozen study and the environment is retired.",
}
PARENT = corpus_version()
MODEL = ISOLATED_MODEL_VERSION
_HISTORY_PIN = json.loads((ROOT / "research/traditional-puzzle-v3-inputs.json").read_text())
PREVIOUS_PARENT = _HISTORY_PIN["blb"]["corpus_version"]
PREVIOUS_MODEL = _HISTORY_PIN["blb"]["model_version"]
COMPONENT = "traditional-premier-v4-phase2-v1"
CUBE_COMPONENT = "traditional-cube-p2p7-v4-v1"
PINNED_V8_RUN = 35646313155
PINNED_V8_ARTIFACT = 10661300487
PINNED_V3_RUN = 35386149822


def expansion(sid: str) -> str:
    return "Cube_-_Powered" if sid == CUBE else sid.upper()


def serving_window(sid: str) -> tuple[int, int]:
    return (2, 9) if sid == CUBE else (1, 8)


def late_floor(sid: str) -> int:
    return 8 if sid == CUBE else 7


def complete_source(examples, sid):
    last = 9 if sid == CUBE else 8
    valid, prior, why = trajectory(examples, last)
    if sid == CUBE:
        ok = len(valid) == 8 and len(prior) == 1 and valid[0].raw_pick_number == 1
        return valid, prior, None if ok else (why or "missing_complete_p1p2_p1p9")
    ok = len(valid) == 8 and not prior and valid and valid[0].raw_pick_number == 0
    return valid, prior, None if ok else (why or "missing_complete_p1p1_p1p8")


def pinned_archive(source: dict, path: Path) -> dict:
    actual = archive(source["url"], path)
    if any(actual.get(key) != source.get(key) for key in ("sha256", "compressed_bytes")):
        raise ValueError("Pinned v8 source archive changed; do not substitute new evidence")
    return actual


def frozen_manifest(frozen: Path, sid: str) -> dict:
    catalog = json.loads((frozen / "catalog.json").read_text())
    if not catalog.get("complete") or catalog.get("errors"):
        raise ValueError("Pinned v8 all-trophy artifact is incomplete")
    if catalog.get("corpus_version") != PARENT:
        raise ValueError(f"Expected {PARENT}, got {catalog.get('corpus_version')}")
    listed = next((row for row in catalog.get("sets", []) if row.get("id") == sid), None)
    if listed is None:
        raise ValueError(f"{sid}: missing from pinned v8 artifact catalog")
    manifest_path = frozen / sid / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    keys = (
        "input_signature", "puzzle_file_sha256", "model_version", "source_archive",
        "skill_source", "training_cap", "training_drafts", "training_picks",
        "win_rate_cutoff", "corpus_version", "qualified_trophies",
    )
    for key in keys:
        if manifest.get(key) != listed.get(key):
            raise ValueError(f"{sid}: artifact catalog/manifest mismatch for {key}")
    if manifest.get("corpus_version") != PARENT or manifest.get("model_version") != MODEL:
        raise ValueError(f"{sid}: pinned evidence is not {PARENT}/{MODEL}")
    if MODEL != ISOLATED_MODEL_VERSION:
        raise AssertionError("Research model identity differs from production isolated model constant")
    puzzle_path = frozen / sid / "puzzles.jsonl.gz"
    reference_path = frozen / sid / "reference.jsonl.gz"
    if puzzle_path.exists():
        if digest(puzzle_path) != manifest.get("puzzle_file_sha256"):
            raise ValueError(f"{sid}: pinned v8 puzzle checksum mismatch")
    elif not reference_path.exists():
        raise ValueError(f"{sid}: pinned v8 evidence has neither full puzzles nor reference sample")
    manifest["_manifest_sha256"] = digest(manifest_path)
    return manifest


def archive_header(path: Path):
    with csv_bytes(path) as handle:
        return next(csv.reader([handle.readline().decode("utf-8-sig")]))


def cube_snapshot_check(premier_source, premier_header, trad_source, trad_header):
    pdate = parsedate_to_datetime(premier_source["last_modified"]).date().isoformat()
    tdate = parsedate_to_datetime(trad_source["last_modified"]).date().isoformat()
    pcards = {name[len("pack_card_"):] for name in candidate_columns(premier_header)}
    tcards = {name[len("pack_card_"):] for name in candidate_columns(trad_header)}
    result = {
        "premier_archive_date": pdate,
        "traditional_archive_date": tdate,
        "premier_card_columns": len(pcards),
        "traditional_card_columns": len(tcards),
        "same_archive_date": pdate == tdate,
        "same_card_column_universe": pcards == tcards,
        "premier_only_cards": sorted(pcards - tcards),
        "traditional_only_cards": sorted(tcards - pcards),
    }
    result["pass"] = result["same_archive_date"] and result["same_card_column_universe"]
    return result


def cube_traditional_cohort(path: Path, include_sources=False):
    drafts = {}
    conflicts = set()
    with csv_bytes(path) as handle:
        header = next(csv.reader([handle.readline().decode("utf-8-sig")]))
        required = {
            "draft_id", "event_type", "event_match_wins", "event_match_losses",
            "pack_number", "pick_number", "pick", "user_n_games_bucket",
            "user_game_win_rate_bucket",
        }
        if not required.issubset(header):
            raise ValueError("Equivalent outcome/skill fields unavailable: " + ",".join(sorted(required - set(header))))
        modern = (
            header[:9] == [
                "expansion", "event_type", "draft_id", "draft_time", "rank",
                "event_match_wins", "event_match_losses", "pack_number", "pick_number",
            ]
            and header[-2:] == ["user_n_games_bucket", "user_game_win_rate_bucket"]
        )
        for line in handle:
            if not line.strip():
                continue
            if modern:
                row = dict(zip(header[:9], (value.decode().strip('"') for value in line.split(b",", 9)[:9])))
                row.update(zip(header[-2:], (value.decode().strip().strip('"') for value in line.rsplit(b",", 2)[-2:])))
            else:
                values = next(csv.reader([line.decode()]))
                if len(values) != len(header):
                    raise ValueError("Malformed archive row")
                row = dict(zip(header, values))
            if row["event_type"] != "TradDraft":
                raise ValueError("Archive event identity mismatch")
            item = {
                "wins": int(float(row["event_match_wins"] or -1)),
                "losses": int(float(row["event_match_losses"])) if row["event_match_losses"] else None,
                "games": parse_games_lower_bound(row["user_n_games_bucket"]),
                "rate": parse_rate_bucket(row["user_game_win_rate_bucket"]),
            }
            did = row["draft_id"]
            if did in drafts and drafts[did] != item:
                conflicts.add(did)
            else:
                drafts[did] = item
    skills = {
        did: DraftSkill(item["rate"], item["games"])
        for did, item in drafts.items()
        if did not in conflicts and item["rate"] is not None and item["games"] is not None
    }
    _, cutoff, experienced = select_strong_drafts(skills, 100, .15, None)
    cutoff = max(.6, cutoff)
    qualified = {
        did for did, skill in skills.items()
        if skill.games_lower_bound >= 100 and skill.rate >= cutoff
    }
    wanted = {
        did for did in qualified
        if drafts[did]["wins"] == 3 and drafts[did]["losses"] == 0
    }
    examples = defaultdict(list)
    pack = candidate_columns(header)
    pool = pool_columns(header)
    if not pack or not pool:
        raise ValueError("Missing candidate/pool columns")
    for row in rows(path, wanted):
        if int(float(row["pack_number"])) != 0 or not 1 <= int(float(row["pick_number"])) < 9:
            continue
        example = parse_example(row, pack, pool)
        if example:
            examples[example.draft_id].append(example)
    clean = {}
    excluded = Counter()
    source_reasons = {}
    for did in sorted(wanted):
        valid, _, reason = complete_source(examples[did], CUBE)
        if reason:
            excluded[reason] += 1
            source_reasons[did] = reason
        else:
            clean[did] = valid
    report = {
        "source_drafts": len(drafts),
        "experienced": experienced,
        "qualified_drafts": len(qualified),
        "qualified_trophies": len(wanted),
        "complete_trajectories": len(clean),
        "excluded": dict(excluded),
        "cutoff": cutoff,
        "source_conflicts": len(conflicts),
        "trophy_outcomes": dict(Counter(
            f"{item['wins']}-{item['losses']}" for item in drafts.values()
            if item["wins"] == 3 and item["losses"] == 0
        )),
    }
    if include_sources:
        report["sources"] = {
            did: {
                **item,
                "qualified": did in qualified,
                "complete": did in clean,
                "reason": (
                    "inconsistent_source_metadata" if did in conflicts else
                    "experience_unverified_or_below_100" if (item["games"] or 0) < 100 else
                    "win_rate_unverified_or_below_cutoff"
                    if item["rate"] is None or item["rate"] < cutoff else
                    source_reasons.get(did)
                ),
            }
            for did, item in drafts.items()
            if item["wins"] == 3 and item["losses"] == 0
        }
    return clean, report


def build_v4_models(sid: str, draft: Path, game: Path, pin: dict):
    drafts, header, source_rows, conflicts = scan_metadata(draft)
    skills = {
        did: DraftSkill(item["rate"], item["games"])
        for did, item in drafts.items()
        if did not in conflicts and item.get("rate") is not None and item.get("games") is not None
    }
    training, calculated_cutoff, experienced = select_strong_drafts(
        skills, 100, .15, int(pin["training_cap"])
    )
    if len(training) != int(pin["training_drafts"]):
        raise ValueError(f"{sid}: production training cohort count changed")
    if float(pin["win_rate_cutoff"]) < max(.6, calculated_cutoff) - 1e-12:
        raise ValueError(f"{sid}: production cutoff is below reconstructed strong-player cutoff")
    qualified, rejected = eligible_trophies(
        drafts, float(pin["win_rate_cutoff"]), conflicts=conflicts
    )
    if len(qualified) != int(pin["qualified_trophies"]):
        raise ValueError(f"{sid}: production qualified trophy count changed")
    fold_training, output, invalid, training_picks, colour_examples = collect_isolated(
        draft, set(training), set(qualified), header
    )
    if training_picks != int(pin["training_picks"]):
        raise ValueError(f"{sid}: production training pick count changed")
    fits = build_colour_tables_by_fold(game, colour_examples, fold_training, sid)
    models = [
        OutOfFoldModel(fold.counts, CountStore.empty(), fits[fold.fold])
        for fold in fold_training
    ]
    if len(models) != 5:
        raise ValueError(f"{sid}: expected five isolated graders")
    return {
        "drafts": drafts,
        "header": header,
        "source_rows": source_rows,
        "conflicts": conflicts,
        "training": set(training),
        "experienced": experienced,
        "qualified": qualified,
        "rejected": rejected,
        "fold_training": fold_training,
        "fits": fits,
        "models": models,
        "output": output,
        "invalid": invalid,
        "training_picks": training_picks,
    }


def grader_for(event: str, did: str, built: dict):
    fold_number = stable_fold(did, 5)
    fold = built["fold_training"][fold_number]
    if event == "PremierDraft" and did in built["training"]:
        if did not in fold.held_out_ids or did in fold.training_ids:
            raise AssertionError(f"{did}: Premier source reached the grader that scores it")
    if event == "TradDraft":
        if did in built["training"]:
            raise AssertionError(f"{did}: Traditional source ID collides with Premier training data")
        if did in fold.training_ids or did in fold.held_out_ids:
            raise AssertionError(f"{did}: Traditional data reached Premier fold construction")
    return built["models"][fold_number]


def resolve_research_images(names, known, cache_path: Path):
    """Resolve only image absence, matching the frozen Phase 2 usability gate.

    The production resolver also refreshes rows missing type_line. Type lines are
    optional display metadata and were never part of this experiment's source
    usability gate, so requesting them here adds rate-limit risk without changing
    the predeclared decision rule.
    """
    cache = (
        {key: value for key, value in json.loads(cache_path.read_text()).items() if value}
        if cache_path.exists() else {}
    )
    known = {**known, **cache}

    def research_request(url, method="GET"):
        # Combined with one research job's own pacing and a bounded workflow
        # matrix, this stays below the public API request rate. Transient 429/5xx
        # responses still receive the importer's bounded retry behavior.
        time.sleep(.30)
        return resilient_request(url, method)

    for name in sorted(
        name for name in names
        if not known.get(name, {}).get("image_url", "").startswith("https://")
    ):
        time.sleep(.15)
        try:
            url = "https://api.scryfall.com/cards/named?exact=" + urllib.parse.quote(name)
            with research_request(url) as response:
                card = json.load(response)
            value = compact_card(card) if name in set(aliases(card)) else None
            if value and value.get("image_url", "").startswith("https://"):
                known[name] = value
                cache[name] = value
            else:
                cache[name] = None
        except urllib.error.HTTPError as exc:
            if exc.code != 404:
                raise
            cache[name] = None
        atomic_json(cache_path, cache)
    return known


def interesting(records):
    kept = []
    for row in records:
        ordered = sorted(row["raw"], reverse=True)
        if max(row["raw"]) <= .75 and ordered[1] / max(row["raw"]) >= .2:
            kept.append(row)
    return kept


def serving_floor_effect(records):
    result = {}
    for event in EVENTS:
        rows_for_event = [row for row in records if row["event"] == event]
        kept = interesting(rows_for_event)
        result[event] = {
            "all_picks": len(rows_for_event),
            "servable_picks": len(kept),
            "removed_by_serving_floor": len(rows_for_event) - len(kept),
            "removed_fraction": (
                (len(rows_for_event) - len(kept)) / len(rows_for_event)
                if rows_for_event else None
            ),
        }
    return result


def parity_with_v8(sid: str, frozen: Path, built: dict):
    by_hash = {
        hashlib.sha256(f"{sid}|{did}".encode()).hexdigest()[:32]: did
        for did in built["qualified"]
    }
    first, last = serving_window(sid)
    parity = 0
    known = metadata(ROOT)
    puzzle_path = frozen / sid / "reference.jsonl.gz"
    if not puzzle_path.exists():
        puzzle_path = frozen / sid / "puzzles.jsonl.gz"
    with gzip.open(puzzle_path, "rt") as handle:
        for line in handle:
            old = json.loads(line)
            for card in old.get("candidates", []) + old.get("prior_picks", []):
                known[card["name"]] = {
                    key: value for key, value in card.items()
                    if key in ("image_url", "mana_cost", "rarity", "type_line")
                }
            pick_number = int(old["pick_number"])
            if not first <= pick_number <= last:
                continue
            did = by_hash.get(old["source_draft_hash"])
            if not did:
                raise ValueError(f"{sid}: v8 source hash is absent from reconstructed qualified cohort")
            matches = [
                example for example in built["output"].get(did, [])
                if example.raw_pick_number == pick_number - 1
            ]
            if len(matches) != 1:
                raise ValueError(f"{sid}/{did}/P1P{pick_number}: v8 source decision missing")
            rebuilt = render_replay(
                did, matches, grader_for("PremierDraft", did, built), 1, 1, {}
            )["picks"][0]
            actual = {card["name"]: card["model_probability"] for card in rebuilt["candidates"]}
            expected = {card["name"]: card["model_probability"] for card in old["candidates"]}
            if actual != expected:
                raise ValueError(f"{sid}/{did}/P1P{pick_number}: reconstructed v4 differs from v8")
            parity += 1
    if parity < 200:
        raise ValueError(f"{sid}: insufficient v8 serving-window parity coverage ({parity})")
    return parity, known


def gate_failure_reasons(report: dict):
    reasons = []
    for scope in ("all_picks", "late_picks", "serving_picks", "serving_late_picks"):
        block = report[scope]
        for gate, passed in block.get("gates", {}).items():
            if not passed:
                reasons.append(f"{scope}.{gate}")
    if not report["quality"]["pass"]:
        reasons.append("quality.unusable_trajectory_fraction")
    return reasons


def measure(sid: str, directory: Path, frozen: Path):
    if sid not in SETS:
        raise ValueError("Environment was not in the frozen Phase 2 testable scope")
    directory.mkdir(parents=True, exist_ok=True)
    pin = frozen_manifest(frozen, sid)
    draft = directory / "premier.csv.gz"
    game = directory / "premier-game.csv.gz"
    premier_source = pinned_archive(pin["source_archive"], draft)
    game_source = pinned_archive(pin["skill_source"], game)

    built = build_v4_models(sid, draft, game, pin)
    parity, known = parity_with_v8(sid, frozen, built)

    groups = {EVENTS[0]: {}}
    premier_incomplete = Counter()
    for did, examples in built["output"].items():
        valid, _, reason = complete_source(examples, sid)
        if reason:
            premier_incomplete[reason] += 1
        else:
            groups[EVENTS[0]][did] = valid

    trad = directory / "traditional.csv.gz"
    trad_source = archive(
        f"{BASE}/draft_data/draft_data_public.{expansion(sid)}.TradDraft.csv.gz", trad
    )
    if sid == CUBE:
        groups[EVENTS[1]], trad_cohort = cube_traditional_cohort(trad, include_sources=True)
    else:
        groups[EVENTS[1]], trad_cohort = cohort(trad, EVENTS[1], include_sources=True)
    trad_sources = trad_cohort.pop("sources")

    collision = set(groups[EVENTS[1]]) & built["training"]
    if collision:
        raise ValueError(f"{sid}: Traditional IDs collide with Premier training IDs")

    snapshot = None
    if sid == CUBE:
        snapshot = cube_snapshot_check(
            premier_source, built["header"], trad_source, archive_header(trad)
        )
        if not snapshot["pass"]:
            raise ValueError("Powered Cube Premier/Traditional snapshot mismatch")

    names = {
        card
        for group in groups.values()
        for examples in group.values()
        for example in examples
        for card in (*example.candidates, *example.pool)
    }
    known = resolve_research_images(names, known, directory / "images.json")

    records = []
    puzzles = []
    excluded = Counter()
    ledger = []
    for did, source in sorted(trad_sources.items()):
        if not source["complete"]:
            ledger.append({
                "source_draft_hash": hashlib.sha256(
                    f"{sid}|TradDraft|{did}".encode()
                ).hexdigest()[:32],
                "status": "excluded",
                "qualified": source["qualified"],
                "reason": source["reason"],
                "event_type": "TradDraft",
                "wins": 3,
                "losses": 0,
            })

    first, last = serving_window(sid)
    for event, group in groups.items():
        for did, examples in sorted(group.items()):
            reason = None
            if any(len(example.candidates) < 4 for example in examples):
                reason = "fewer_than_four_candidates"
            if any(
                not known.get(card, {}).get("image_url", "").startswith("https://")
                for example in examples for card in (*example.candidates, *example.pool)
            ):
                reason = "metadata_or_image_missing"
            if any(
                len({slugify(card) for card in example.candidates}) != len(example.candidates)
                for example in examples
            ):
                reason = "card_identity_collision"
            if reason:
                excluded[event + ":" + reason] += 1
                if event == EVENTS[1]:
                    ledger.append({
                        "source_draft_hash": hashlib.sha256(
                            f"{sid}|{event}|{did}".encode()
                        ).hexdigest()[:32],
                        "status": "excluded",
                        "qualified": True,
                        "reason": reason,
                        "event_type": event,
                        "wins": 3,
                        "losses": 0,
                    })
                continue

            model = grader_for(event, did, built)
            for example in examples:
                records.append(record(sid, event, did, example, model))
            if event != EVENTS[1]:
                continue

            source_hash = hashlib.sha256(f"{sid}|{event}|{did}".encode()).hexdigest()[:32]
            fingerprint = hashlib.sha256(encoded([
                {
                    "pick": example.raw_pick_number,
                    "choice": example.historical_pick,
                    "pack": example.candidates,
                    "pool": example.pool,
                }
                for example in examples
            ])).hexdigest()
            rendered = render_replay(did, examples, model, 1, 1, known)["picks"]
            initial = [next(iter(examples[0].pool))] if sid == CUBE else []
            prior = [
                {**known.get(name, {}), "id": slugify(name), "name": name}
                for name in initial
            ]
            emitted = 0
            for pick in rendered:
                if not first <= pick["pick_number"] <= last:
                    continue
                pid = hashlib.sha256(
                    f"{COMPONENT}|{sid}|{event}|{did}|{pick['pick_number']}".encode()
                ).hexdigest()[:32]
                puzzles.append({
                    "puzzle_id": pid,
                    "set_id": sid,
                    "source_draft_hash": source_hash,
                    "source_fingerprint": fingerprint,
                    "corpus_version": COMPONENT,
                    "parent_corpus_version": PARENT,
                    "model_version": MODEL,
                    "model_input_signature": pin["input_signature"],
                    "model_source_event": "PremierDraft",
                    "source_event_type": event,
                    "source_evidence": "official_archive_trajectory",
                    "skill_evidence": "win_rate_bucket",
                    "event_match_wins": 3,
                    "event_match_losses": 0,
                    "player_games_lower_bound": trad_sources[did]["games"],
                    "player_win_rate_bucket": trad_sources[did]["rate"],
                    "pick_number": pick["pick_number"],
                    "historical_pick_id": pick["historical_pick_id"],
                    "candidates": pick["candidates"],
                    "prior_picks": list(prior),
                })
                card = next(
                    card for card in pick["candidates"]
                    if card["id"] == pick["historical_pick_id"]
                )
                prior.append({key: value for key, value in card.items() if key != "model_probability"})
                emitted += 1
            ledger.append({
                "source_draft_hash": source_hash,
                "source_fingerprint": fingerprint,
                "status": "included",
                "qualified": True,
                "event_type": event,
                "wins": 3,
                "losses": 0,
                "puzzles": emitted,
            })

    if len(ledger) != len(trad_sources):
        raise ValueError("Traditional trophy accounting mismatch")

    tags = {} if sid == CUBE else metadata_for_set(sid, built["models"][0])
    report = {
        "schema": 3,
        "set": sid,
        "parent_corpus_version": PARENT,
        "model_version": MODEL,
        "model_source_event": "PremierDraft",
        "traditional_used_for_training": False,
        "source_hashes": {
            EVENTS[0]: {"draft": premier_source, "game": game_source},
            EVENTS[1]: {"draft": trad_source},
        },
        "production_input_signature": pin["input_signature"],
        "production_manifest_sha256": pin["_manifest_sha256"],
        "production_puzzle_sha256": pin["puzzle_file_sha256"],
        "fold_training_ids_sha256": [fit["training_ids_sha256"] for fit in built["fits"]],
        "v8_parity_picks": parity,
        "training_drafts": len(built["training"]),
        "training_picks": built["training_picks"],
        "traditional_cohort": trad_cohort,
        "excluded": dict(excluded),
        "card_tags": tags,
        "tests": records,
        "serving_window": {"first_pick": first, "last_pick": last},
        "late_pick_floor": late_floor(sid),
        "premier_source_audit": {
            "source_rows": built["source_rows"],
            "qualified_trophies": len(built["qualified"]),
            "rejected_trophies": len(built["rejected"]),
            "reasons": dict(Counter(built["rejected"].values())),
            "incomplete_trajectory_reasons": dict(premier_incomplete),
        },
        "cube_snapshot": snapshot,
        "implementation": {
            name: digest(ROOT / "scripts" / name)
            for name in (
                "traditional_v4_revalidation.py",
                "traditional_puzzles.py",
                "build_replays.py",
                "deck_fit.py",
                "import_all_trophies.py",
            )
        },
    }
    report["all_picks"] = compare(records)
    report["late_picks"] = compare([
        row for row in records if row["pick"] >= late_floor(sid)
    ])
    serving = interesting(records)
    report["serving_picks"] = compare(serving)
    report["serving_late_picks"] = compare([
        row for row in serving if row["pick"] >= late_floor(sid)
    ])
    report["serving_floor_effect"] = serving_floor_effect(records)

    unusable = 1 - len(puzzles) / 8 / max(1, trad_cohort["complete_trajectories"])
    report["quality"] = {
        "usable_traditional_puzzles": len(puzzles),
        "unusable_fraction": unusable,
        "pass": unusable <= THRESHOLDS["unusable_trajectory_fraction_max"],
    }

    if sid == CUBE:
        windows = {}
        for name, selector in (
            ("p2_p7", lambda row: 2 <= row["pick"] <= 7),
            ("p8_p9", lambda row: 8 <= row["pick"] <= 9),
            ("p8", lambda row: row["pick"] == 8),
            ("p9", lambda row: row["pick"] == 9),
        ):
            selected = [row for row in records if selector(row)]
            selected_serving = interesting(selected)
            windows[name] = {
                "all_picks": compare(selected),
                "serving_picks": compare(selected_serving),
                "serving_floor_effect": serving_floor_effect(selected),
            }
        p2p7_puzzles = sum(2 <= puzzle["pick_number"] <= 7 for puzzle in puzzles)
        p2p7_quality = {
            "usable_traditional_puzzles": p2p7_puzzles,
            "unusable_fraction": unusable,
            "pass": report["quality"]["pass"],
        }
        windows["p2_p7"]["quality"] = p2p7_quality
        windows["p2_p7"]["pass"] = (
            windows["p2_p7"]["all_picks"]["pass"]
            and windows["p2_p7"]["serving_picks"]["pass"]
            and p2p7_quality["pass"]
        )
        report["cube_windows"] = windows

    report["pass"] = all(
        report[key]["pass"]
        for key in ("all_picks", "late_picks", "serving_picks", "serving_late_picks", "quality")
    )
    report["failure_reasons"] = gate_failure_reasons(report)

    write_gzip_jsonl(directory / "puzzles.jsonl.gz", puzzles)
    write_gzip_jsonl(directory / "trophies.jsonl.gz", ledger)
    with gzip.open(directory / "measurements.json.gz", "wt") as handle:
        json.dump(report, handle, separators=(",", ":"))
    atomic_json(
        directory / "summary.json",
        {key: value for key, value in report.items() if key not in ("tests", "card_tags")},
    )
    atomic_json(directory / "manifest.json", {
        "id": sid,
        "component_version": COMPONENT,
        "parent_corpus_version": PARENT,
        "model_version": MODEL,
        "model_input_signature": pin["input_signature"],
        "model_source_event": "PremierDraft",
        "source_event_type": "TradDraft",
        "serving_status": "candidate",
        "publication_authorized": False,
        "serving_window": report["serving_window"],
        "source_archive": trad_source,
        "puzzle_file_sha256": digest(directory / "puzzles.jsonl.gz"),
        "ledger_file_sha256": digest(directory / "trophies.jsonl.gz"),
        "puzzles": len(puzzles),
        "v8_parity_picks": parity,
        "fold_training_ids_sha256": report["fold_training_ids_sha256"],
        "cube_snapshot": snapshot,
    })

    for path in (draft, game, trad):
        path.unlink(missing_ok=True)
    print(json.dumps({
        "set": sid,
        "model": MODEL,
        "v8_parity_picks": parity,
        "traditional_trajectories": trad_cohort["complete_trajectories"],
        "puzzles": len(puzzles),
        "pass": report["pass"],
        "cube_p2_p7_pass": report.get("cube_windows", {}).get("p2_p7", {}).get("pass"),
        "failure_reasons": report["failure_reasons"],
    }), flush=True)


def prepare_pins(source: Path, output: Path, sample_size: int = 256):
    """Extract immutable per-set v8 provenance and parity samples from the pinned artifact."""
    source_catalog = json.loads((source / "catalog.json").read_text())
    if (
        source_catalog.get("complete") is not True
        or source_catalog.get("errors")
        or source_catalog.get("corpus_version") != PARENT
    ):
        raise ValueError("Source artifact is not the complete pinned v8 import")
    output.mkdir(parents=True, exist_ok=True)
    pin_catalog = {
        **source_catalog,
        "production_run_id": PINNED_V8_RUN,
        "production_artifact_id": PINNED_V8_ARTIFACT,
        "reference_sample_size": sample_size,
    }
    atomic_json(output / "catalog.json", pin_catalog)
    for sid in SETS:
        src_dir = source / sid
        dest = output / sid
        dest.mkdir(parents=True, exist_ok=True)
        manifest = json.loads((src_dir / "manifest.json").read_text())
        if manifest.get("corpus_version") != PARENT or manifest.get("model_version") != MODEL:
            raise ValueError(f"{sid}: production artifact is not v8/v4")
        (dest / "manifest.json").write_bytes((src_dir / "manifest.json").read_bytes())
        candidates = []
        first, last = serving_window(sid)
        with gzip.open(src_dir / "puzzles.jsonl.gz", "rt") as handle:
            for line in handle:
                row = json.loads(line)
                if first <= int(row["pick_number"]) <= last:
                    candidates.append(row)
        if len(candidates) < sample_size:
            raise ValueError(f"{sid}: only {len(candidates)} v8 serving decisions available for parity")
        candidates.sort(key=lambda row: row["puzzle_id"])
        sample = candidates[:sample_size]
        write_gzip_jsonl(dest / "reference.jsonl.gz", sample)
        atomic_json(dest / "reference.json", {
            "set": sid,
            "production_run_id": PINNED_V8_RUN,
            "production_artifact_id": PINNED_V8_ARTIFACT,
            "production_puzzle_sha256": manifest["puzzle_file_sha256"],
            "reference_decisions": len(sample),
            "reference_sha256": digest(dest / "reference.jsonl.gz"),
        })
    print(json.dumps({
        "prepared": True,
        "sets": len(SETS),
        "model": MODEL,
        "parent": PARENT,
        "sample_per_set": sample_size,
    }), flush=True)


def format_training_audit():
    source_path = ROOT / "scripts" / "format_research.py"
    eval_path = ROOT / "scripts" / "eval_model.py"
    source = source_path.read_text()
    eval_source = eval_path.read_text()
    checks = {
        "split_is_60_15_25_by_draft_id": (
            "TRAIN_SHARE, VALIDATION_SHARE = 60, 15" in eval_source
            and "bucket = stable_score(f\"{SPLIT_SALT}:{draft_id}\") % 100" in eval_source
        ),
        "only_train_ids_feed_deck_inputs": (
            "first_game_decks(game,set(split['train']),event)" in source
            and "pairs[event]=[(event+'|'+did,p) for did in split['train']" in source
        ),
        "train_rows_are_not_scored_as_validation_or_test": (
            "if split=='train':continue" in source
        ),
        "validation_selects_calibration": (
            "calibration_rows=[r for r in validation" in source
            and "min((mean_loss(calibration_rows" in source
        ),
        "test_is_scored_after_fit": (
            "for r in test:" in source and "r[name]=normalize(raw,temperature)" in source
        ),
    }
    valid = all(checks.values())
    return {
        "format_research_sha256": digest(source_path),
        "eval_model_sha256": digest(eval_path),
        "checks": checks,
        "valid_despite_issue_164": valid,
        "rerun_required": not valid,
        "conclusion": (
            "Retain Premier-only training evidence: the old format-training study is "
            "source-draft disjoint and issue #164 does not invalidate it."
            if valid else
            "Do not rely on the prior format-training result; its split isolation audit failed."
        ),
    }


def previous_cube_windows(path: Path | None):
    if path is None:
        return None
    with gzip.open(path, "rt") as handle:
        old = json.load(handle)
    rows_old = old["tests"]
    result = {}
    for name, selector in (
        ("p2_p7", lambda row: 2 <= row["pick"] <= 7),
        ("p8_p9", lambda row: 8 <= row["pick"] <= 9),
        ("p8", lambda row: row["pick"] == 8),
        ("p9", lambda row: row["pick"] == 9),
    ):
        selected = [row for row in rows_old if selector(row)]
        result[name] = {
            "all_picks": compare(selected),
            "serving_picks": compare(interesting(selected)),
        }
    result["p2_p7"]["quality"] = old["quality"]
    result["p2_p7"]["pass"] = (
        result["p2_p7"]["all_picks"]["pass"]
        and result["p2_p7"]["serving_picks"]["pass"]
        and old["quality"]["pass"]
    )
    return result


def summarize(paths, previous_path: Path, previous_cube_path: Path | None, out: Path, markdown: Path):
    reports = []
    for path in paths:
        with gzip.open(path, "rt") as handle:
            reports.append(json.load(handle))
    if sorted(report["set"] for report in reports) != sorted(SETS):
        missing = sorted(set(SETS) - {report["set"] for report in reports})
        extra = sorted({report["set"] for report in reports} - set(SETS))
        raise ValueError(f"Incomplete v4 revalidation; missing={missing}, extra={extra}")

    previous = json.loads(previous_path.read_text())
    old_sets = previous.get("sets", {})
    if set(SETS) - set(old_sets):
        raise ValueError("Historical v3 report does not cover the full frozen Phase 2 scope")

    residuals = residual_report(reports)
    residuals["definition"] = residuals["definition"].replace(
        "calibrated combined-model", "Premier-only leakage-corrected v4 model"
    )
    by_set = {}
    classes = {
        "previously_passing_still_passing": [],
        "previously_passing_now_failing": [],
        "previously_failing_now_passing": [],
        "still_failing": [],
        "insufficient_or_unavailable": [],
    }
    for report in sorted(reports, key=lambda item: item["set"]):
        sid = report["set"]
        old_pass = bool(old_sets[sid].get("pass"))
        new_pass = bool(report["pass"])
        if old_pass and new_pass:
            bucket = "previously_passing_still_passing"
        elif old_pass and not new_pass:
            bucket = "previously_passing_now_failing"
        elif not old_pass and new_pass:
            bucket = "previously_failing_now_passing"
        else:
            bucket = "still_failing"
        classes[bucket].append(sid)
        by_set[sid] = {
            "previous_v3_result": "PASS" if old_pass else "FAIL",
            "new_v4_result": "PASS" if new_pass else "FAIL",
            "changed": old_pass != new_pass,
            "main_failure_reasons": report["failure_reasons"],
            "qualified_traditional_trajectories": report["traditional_cohort"]["complete_trajectories"],
            "usable_decisions": report["quality"]["usable_traditional_puzzles"],
            "all_picks": report["all_picks"],
            "late_picks": report["late_picks"],
            "serving_picks": report["serving_picks"],
            "serving_late_picks": report["serving_late_picks"],
            "quality": report["quality"],
            "serving_floor_effect": report["serving_floor_effect"],
            "v8_parity_picks": report["v8_parity_picks"],
            "production_input_signature": report["production_input_signature"],
            "fold_training_ids_sha256": report["fold_training_ids_sha256"],
            "cube_windows": report.get("cube_windows"),
        }

    old_cube = previous_cube_windows(previous_cube_path)
    new_cube = by_set[CUBE]["cube_windows"]
    cube_restricted = {
        "previous_v3_p2_p7_result": (
            "PASS" if old_cube and old_cube["p2_p7"]["pass"] else
            "FAIL" if old_cube else "UNAVAILABLE"
        ),
        "new_v4_p2_p7_result": "PASS" if new_cube["p2_p7"]["pass"] else "FAIL",
        "changed": (
            None if old_cube is None
            else bool(old_cube["p2_p7"]["pass"]) != bool(new_cube["p2_p7"]["pass"])
        ),
        "previous": old_cube,
        "new": new_cube,
        "candidate_component_version": CUBE_COMPONENT,
        "publication_authorized": False,
    }

    audit = format_training_audit()
    result = {
        "schema": 1,
        "protocol": "research/TRADITIONAL-V4-REVALIDATION-PROTOCOL.md",
        "previous": {
            "parent_corpus": PREVIOUS_PARENT,
            "model": PREVIOUS_MODEL,
            "run_id": PINNED_V3_RUN,
        },
        "corrected": {
            "parent_corpus": PARENT,
            "model": MODEL,
            "run_id": PINNED_V8_RUN,
            "artifact_id": PINNED_V8_ARTIFACT,
            "component_version": COMPONENT,
        },
        "thresholds": THRESHOLDS,
        "sets": by_set,
        "classifications": classes,
        "excluded": EXCLUSIONS,
        "passing_sets": sorted(sid for sid, value in by_set.items() if value["new_v4_result"] == "PASS"),
        "failing_sets": sorted(sid for sid, value in by_set.items() if value["new_v4_result"] == "FAIL"),
        "residuals": residuals,
        "persistent_category_patterns": residuals["persistent_category_patterns"],
        "powered_cube_restricted": cube_restricted,
        "format_training_audit": audit,
        "production_changed": False,
        "publication_authorized": False,
        "decision": (
            "Research complete. Passing sources are Candidate-only; changed results and "
            "publication require explicit owner review."
        ),
    }
    atomic_json(out, result)
    markdown.parent.mkdir(parents=True, exist_ok=True)
    markdown.write_text(render_markdown(result))
    print(json.dumps({
        "passing_sets": result["passing_sets"],
        "failing_sets": result["failing_sets"],
        "classifications": result["classifications"],
        "cube_p2_p7": {
            "v3": cube_restricted["previous_v3_p2_p7_result"],
            "v4": cube_restricted["new_v4_p2_p7_result"],
            "changed": cube_restricted["changed"],
        },
        "format_training_valid": audit["valid_despite_issue_164"],
        "persistent_category_patterns": len(result["persistent_category_patterns"]),
    }, separators=(",", ":")), flush=True)
    if not audit["valid_despite_issue_164"]:
        raise SystemExit("Format-training isolation audit failed; prior training result cannot be retained")


def render_markdown(report: dict) -> str:
    lines = [
        "# Traditional playable-puzzle admission — v4 revalidation",
        "",
        f"Parent: `{PARENT}` · grader: `{MODEL}` · historical comparison: `{PREVIOUS_PARENT}` / `{PREVIOUS_MODEL}`.",
        "",
        "This is research evidence only. No production component was published by this run.",
        "",
        "## Environment comparison",
        "",
        "| Environment | v3 | v4 | Changed? | Main reason |",
        "| --- | --- | --- | --- | --- |",
    ]
    for sid in SETS:
        row = report["sets"][sid]
        reason = ", ".join(row["main_failure_reasons"]) or "all frozen gates passed"
        lines.append(
            f"| {sid} | {row['previous_v3_result']} | {row['new_v4_result']} | "
            f"{'yes' if row['changed'] else 'no'} | {reason} |"
        )
    lines.extend(["", "## Factual classification", ""])
    labels = (
        ("previously_passing_still_passing", "Previously passing and still passing"),
        ("previously_passing_now_failing", "Previously passing but failing under v4"),
        ("previously_failing_now_passing", "Previously failing but passing under v4"),
        ("still_failing", "Still failing"),
        ("insufficient_or_unavailable", "Insufficient / unavailable evidence"),
    )
    for key, label in labels:
        values = report["classifications"][key]
        lines.append(f"- **{label}:** {', '.join(values) if values else 'none'}")
    lines.extend([
        "",
        "## Powered Cube",
        "",
        f"- Historical restricted P1P2–P1P7 result: **{report['powered_cube_restricted']['previous_v3_p2_p7_result']}**",
        f"- Corrected v4 restricted P1P2–P1P7 result: **{report['powered_cube_restricted']['new_v4_p2_p7_result']}**",
        f"- Changed: **{report['powered_cube_restricted']['changed']}**",
        "- P1P8–P1P9, P1P8 and P1P9 are reported separately in `report.json` with the unchanged gates.",
        "",
        "## Format-training study audit",
        "",
        report["format_training_audit"]["conclusion"],
        "",
        "The implementation audit confirms a 60/15/25 source-draft split, train-only model inputs, validation-only tuning, and untouched test scoring."
        if report["format_training_audit"]["valid_despite_issue_164"]
        else "The implementation audit failed; the historical training conclusion must not be relied on.",
        "",
        "## Publication boundary",
        "",
        f"Passing v4 research artifacts use `{COMPONENT}`; a restricted Cube candidate, if supported, is `{CUBE_COMPONENT}`. Both remain Candidate-only with `publication_authorized=false`.",
        "",
        "Historical v3 artifacts and components were not modified.",
        "",
    ])
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--set", choices=SETS)
    parser.add_argument(
        "--directory", type=Path, default=ROOT / "generated/traditional-v4-revalidation"
    )
    parser.add_argument(
        "--frozen", type=Path, default=ROOT / "generated/frozen-v8"
    )
    parser.add_argument("--summarize", type=Path, nargs="+")
    parser.add_argument("--prepare-pins", type=Path)
    parser.add_argument("--pins-out", type=Path)
    parser.add_argument("--previous", type=Path)
    parser.add_argument("--previous-cube", type=Path)
    parser.add_argument(
        "--out", type=Path,
        default=ROOT / "generated/traditional-v4-revalidation/report.json",
    )
    parser.add_argument(
        "--markdown", type=Path,
        default=ROOT / "generated/traditional-v4-revalidation/REPORT.md",
    )
    args = parser.parse_args()
    if args.prepare_pins:
        if not args.pins_out:
            parser.error("--pins-out is required with --prepare-pins")
        prepare_pins(args.prepare_pins, args.pins_out)
    elif args.summarize:
        if not args.previous:
            parser.error("--previous is required with --summarize")
        summarize(
            args.summarize, args.previous, args.previous_cube, args.out, args.markdown
        )
    elif args.set:
        measure(args.set, args.directory / args.set, args.frozen)
    else:
        parser.error("Choose --set or --summarize")


if __name__ == "__main__":
    main()
