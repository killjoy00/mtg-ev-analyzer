#!/usr/bin/env python3
"""Compact validated Phase A rich-feature JSONL into exact SQLite fold caches.

The source artifact remains authoritative. This is a serialization-only pass:
no features are recomputed and no model is fit. Every source row is streamed
into SQLite and then streamed back out for exact metadata/presence/value parity.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import sqlite3
from pathlib import Path
from typing import Iterable, Mapping

SCHEMA_VERSION = 1


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fold", type=int, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--source-report", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    return parser.parse_args()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _iter_jsonl_gz(path: Path):
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def _q(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _columns(prefix: str, count: int) -> list[str]:
    return [f"{prefix}{index}" for index in range(count)]


def _feature_vector(
    row: Mapping[str, object],
    names: list[str],
) -> tuple[float | None, ...]:
    values = []
    for name in names:
        if name not in row:
            values.append(None)
            continue
        value = float(row[name])
        if not math.isfinite(value):
            raise SystemExit(f"non-finite feature value for {name}")
        values.append(value)
    return tuple(values)


def _same_feature_vector(
    expected: Mapping[str, object],
    actual: Iterable[float | None],
    names: list[str],
) -> bool:
    values = tuple(actual)
    if len(values) != len(names):
        return False
    for name, observed in zip(names, values):
        present = name in expected
        if not present:
            if observed is not None:
                return False
            continue
        if observed is None:
            return False
        if float(expected[name]) != float(observed):
            return False
    return True


def _source_counts(source: Path) -> tuple[int, int]:
    decisions = 0
    candidates = 0
    for row in _iter_jsonl_gz(source):
        decisions += 1
        candidates += len(row["candidate_features"])
    return decisions, candidates


def _create_db(
    path: Path,
    *,
    state_names: list[str],
    candidate_names: list[str],
):
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode=OFF")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA locking_mode=EXCLUSIVE")
    conn.execute("PRAGMA page_size=16384")

    state_cols = _columns("s", len(state_names))
    candidate_cols = _columns("c", len(candidate_names))
    conn.execute(
        "CREATE TABLE decisions ("
        "decision_idx INTEGER PRIMARY KEY,"
        "decision_id TEXT NOT NULL,"
        "draft_id TEXT NOT NULL,"
        "fold INTEGER NOT NULL,"
        "role TEXT NOT NULL,"
        "training_draft_count INTEGER NOT NULL,"
        "expansion TEXT NOT NULL,"
        "selected_action TEXT NOT NULL,"
        "outcome REAL NOT NULL,"
        "sample_weight REAL,"
        + ",".join(f"{_q(name)} REAL" for name in state_cols)
        + ")"
    )
    conn.execute(
        "CREATE TABLE candidates ("
        "decision_idx INTEGER NOT NULL,"
        "candidate_ord INTEGER NOT NULL,"
        "candidate TEXT NOT NULL,"
        + ",".join(f"{_q(name)} REAL" for name in candidate_cols)
        + ",PRIMARY KEY(decision_idx,candidate_ord)) WITHOUT ROWID"
    )
    conn.execute(
        "CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID"
    )
    return conn, state_cols, candidate_cols


def _write_db(
    conn: sqlite3.Connection,
    source: Path,
    *,
    fold: int,
    state_names: list[str],
    candidate_names: list[str],
):
    state_cols = _columns("s", len(state_names))
    candidate_cols = _columns("c", len(candidate_names))
    decision_sql = (
        "INSERT INTO decisions VALUES ("
        + ",".join("?" for _ in range(10 + len(state_cols)))
        + ")"
    )
    candidate_sql = (
        "INSERT INTO candidates VALUES ("
        + ",".join("?" for _ in range(3 + len(candidate_cols)))
        + ")"
    )

    decision_count = 0
    candidate_count = 0
    expansions: dict[str, int] = {}
    candidate_batch = []

    conn.execute("BEGIN")
    for decision_idx, row in enumerate(_iter_jsonl_gz(source)):
        if int(row["fold"]) != fold:
            raise SystemExit("source row fold mismatch")
        sample_weight = row.get("sample_weight")
        state_vector = _feature_vector(row["state_features"], state_names)
        conn.execute(
            decision_sql,
            (
                decision_idx,
                str(row["decision_id"]),
                str(row["draft_id"]),
                int(row["fold"]),
                str(row["role"]),
                int(row["training_draft_count"]),
                str(row["expansion"]),
                str(row["selected_action"]),
                float(row["outcome"]),
                None if sample_weight is None else float(sample_weight),
                *state_vector,
            ),
        )
        decision_count += 1
        expansion = str(row["expansion"])
        expansions[expansion] = expansions.get(expansion, 0) + 1

        for candidate_ord, candidate in enumerate(sorted(row["candidate_features"])):
            features = row["candidate_features"][candidate]
            candidate_batch.append((
                decision_idx,
                candidate_ord,
                str(candidate),
                *_feature_vector(features, candidate_names),
            ))
            candidate_count += 1
            if len(candidate_batch) >= 2000:
                conn.executemany(candidate_sql, candidate_batch)
                candidate_batch.clear()

        if decision_count % 10000 == 0:
            print(json.dumps({
                "event": "compact_progress",
                "fold": fold,
                "decisions": decision_count,
                "candidates": candidate_count,
            }), flush=True)

    if candidate_batch:
        conn.executemany(candidate_sql, candidate_batch)
    conn.commit()
    return decision_count, candidate_count, expansions


def _verify_parity(
    conn: sqlite3.Connection,
    source: Path,
    *,
    fold: int,
    state_names: list[str],
    candidate_names: list[str],
):
    state_cols = _columns("s", len(state_names))
    candidate_cols = _columns("c", len(candidate_names))
    decision_select = (
        "SELECT decision_id,draft_id,fold,role,training_draft_count,expansion,"
        "selected_action,outcome,sample_weight,"
        + ",".join(_q(name) for name in state_cols)
        + " FROM decisions WHERE decision_idx=?"
    )
    candidate_select = (
        "SELECT candidate,"
        + ",".join(_q(name) for name in candidate_cols)
        + " FROM candidates WHERE decision_idx=? ORDER BY candidate_ord"
    )

    decisions = 0
    candidates = 0
    for decision_idx, expected in enumerate(_iter_jsonl_gz(source)):
        got = conn.execute(decision_select, (decision_idx,)).fetchone()
        if got is None:
            raise SystemExit(f"parity: missing decision_idx {decision_idx}")
        (
            decision_id,
            draft_id,
            observed_fold,
            role,
            training_draft_count,
            expansion,
            selected_action,
            outcome,
            sample_weight,
            *state_values,
        ) = got
        expected_weight = expected.get("sample_weight")
        scalar_checks = (
            decision_id == str(expected["decision_id"]),
            draft_id == str(expected["draft_id"]),
            observed_fold == int(expected["fold"]) == fold,
            role == str(expected["role"]),
            training_draft_count == int(expected["training_draft_count"]),
            expansion == str(expected["expansion"]),
            selected_action == str(expected["selected_action"]),
            float(outcome) == float(expected["outcome"]),
            (
                sample_weight is None
                if expected_weight is None
                else sample_weight is not None and float(sample_weight) == float(expected_weight)
            ),
        )
        if not all(scalar_checks):
            raise SystemExit(f"parity: decision metadata mismatch at {decision_idx}")
        if not _same_feature_vector(
            expected["state_features"], state_values, state_names
        ):
            raise SystemExit(f"parity: state feature mismatch at {decision_idx}")

        got_candidates = conn.execute(candidate_select, (decision_idx,)).fetchall()
        expected_names = sorted(expected["candidate_features"])
        if len(got_candidates) != len(expected_names):
            raise SystemExit(f"parity: candidate count mismatch at {decision_idx}")
        for expected_name, got_candidate in zip(expected_names, got_candidates):
            candidate, *feature_values = got_candidate
            if candidate != expected_name:
                raise SystemExit(f"parity: candidate identity mismatch at {decision_idx}")
            if not _same_feature_vector(
                expected["candidate_features"][expected_name],
                feature_values,
                candidate_names,
            ):
                raise SystemExit(
                    f"parity: candidate feature mismatch at {decision_idx}/{expected_name}"
                )
            candidates += 1
        decisions += 1

    db_decisions = conn.execute("SELECT COUNT(*) FROM decisions").fetchone()[0]
    db_candidates = conn.execute("SELECT COUNT(*) FROM candidates").fetchone()[0]
    if db_decisions != decisions or db_candidates != candidates:
        raise SystemExit("parity: SQLite row counts do not match source")
    return decisions, candidates


def main():
    args = parse_args()
    if args.fold not in {-1, 0, 1, 2, 3, 4}:
        raise SystemExit("fold must be -1 or 0..4")

    report = json.loads(args.source_report.read_text(encoding="utf-8"))
    if int(report["fold"]) != args.fold:
        raise SystemExit("source report fold mismatch")
    if report.get("assessment_opened") is not False:
        raise SystemExit("source report assessment boundary violation")
    if report.get("assessment_outcomes_used") is not False:
        raise SystemExit("source report assessment outcome boundary violation")
    if report.get("ranking_strong_player_features_removed") is not True:
        raise SystemExit("source report retained strong-player ranking features")
    if report.get("factorized_state_features") is not True:
        raise SystemExit("source report is not factorized")

    source_sha = _sha256(args.source)
    expected_source_sha = str(report.get("payload_sha256") or "")
    expected_source_size = int(report.get("payload_size_bytes") or -1)
    if source_sha != expected_source_sha or args.source.stat().st_size != expected_source_size:
        raise SystemExit(
            "source rich-feature payload provenance mismatch: "
            f"actual_sha256={source_sha} expected_sha256={expected_source_sha} "
            f"actual_bytes={args.source.stat().st_size} expected_bytes={expected_source_size}"
        )

    state_names = list(report["state_feature_names"])
    candidate_names = list(report["candidate_feature_names"])
    if len(state_names) != int(report["state_feature_count"]):
        raise SystemExit("state feature schema count mismatch")
    if len(candidate_names) != int(report["candidate_feature_count"]):
        raise SystemExit("candidate feature schema count mismatch")
    if len(state_names) != len(set(state_names)) or len(candidate_names) != len(set(candidate_names)):
        raise SystemExit("duplicate feature names in schema")
    if any("strong_choice_probability" in name for name in candidate_names):
        raise SystemExit("strong-player choice leaked into compact ranking schema")

    args.out.mkdir(parents=True, exist_ok=True)
    db_path = args.out / f"phase-a-compact-fold-{args.fold}.sqlite"
    schema_path = args.out / f"phase-a-compact-fold-{args.fold}-schema.json"
    parity_path = args.out / f"phase-a-compact-fold-{args.fold}-parity.json"

    if db_path.exists():
        db_path.unlink()

    conn, _state_cols, _candidate_cols = _create_db(
        db_path,
        state_names=state_names,
        candidate_names=candidate_names,
    )
    try:
        decision_count, candidate_count, expansions = _write_db(
            conn,
            args.source,
            fold=args.fold,
            state_names=state_names,
            candidate_names=candidate_names,
        )

        schema = {
            "schema_version": SCHEMA_VERSION,
            "format": "sqlite_two_table_fixed_schema",
            "fold": args.fold,
            "source_payload_sha256": source_sha,
            "source_payload_size_bytes": args.source.stat().st_size,
            "source_report_sha256": _sha256(args.source_report),
            "state_feature_names": state_names,
            "candidate_feature_names": candidate_names,
            "tables": {
                "decisions": {
                    "feature_columns": {
                        f"s{index}": name for index, name in enumerate(state_names)
                    }
                },
                "candidates": {
                    "feature_columns": {
                        f"c{index}": name for index, name in enumerate(candidate_names)
                    }
                },
            },
            "missing_value_semantics": "SQL NULL means source feature key absent; numeric zero remains REAL 0.0",
            "candidate_order": "lexicographic by exact candidate name within each decision",
            "assessment_opened": False,
            "assessment_outcomes_used": False,
        }
        schema_path.write_text(
            json.dumps(schema, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        conn.executemany(
            "INSERT INTO metadata(key,value) VALUES (?,?)",
            [
                ("schema_json", json.dumps(schema, sort_keys=True, separators=(",", ":"))),
                ("source_report_json", json.dumps(report, sort_keys=True, separators=(",", ":"))),
            ],
        )
        conn.commit()
        conn.execute("VACUUM")
        conn.execute("PRAGMA optimize")

        verified_decisions, verified_candidates = _verify_parity(
            conn,
            args.source,
            fold=args.fold,
            state_names=state_names,
            candidate_names=candidate_names,
        )
    finally:
        conn.close()

    if verified_decisions != decision_count or verified_candidates != candidate_count:
        raise SystemExit("parity verification counts differ from write counts")

    compact_bytes = db_path.stat().st_size
    source_bytes = args.source.stat().st_size
    parity = {
        "scope": "development_only",
        "fold": args.fold,
        "source_payload_sha256": source_sha,
        "source_payload_size_bytes": source_bytes,
        "compact_payload_sha256": _sha256(db_path),
        "compact_payload_size_bytes": compact_bytes,
        "size_ratio_compact_over_source": compact_bytes / max(1, source_bytes),
        "decision_rows": decision_count,
        "candidate_rows": candidate_count,
        "expansion_decision_rows": dict(sorted(expansions.items())),
        "state_feature_count": len(state_names),
        "candidate_feature_count": len(candidate_names),
        "exact_metadata_feature_presence_and_float64_value_parity": True,
        "assessment_opened": False,
        "assessment_outcomes_used": False,
    }
    parity_path.write_text(
        json.dumps(parity, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(parity, sort_keys=True))


if __name__ == "__main__":
    main()
