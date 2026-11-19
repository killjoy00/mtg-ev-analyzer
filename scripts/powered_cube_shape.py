#!/usr/bin/env python3
"""Measure and normalize the public 17Lands Powered Cube draft shape.

Arena's current Powered Cube export omits the complete P1P1 pack. The first
fully observed first-pack decision is logged at raw pick 1 with 14 candidates,
and its pool already contains the historical drafter's real P1P1 card. That is
the evidence Pack One needs: preserve the P1P2 row and its pool exactly rather
than inventing or injecting a missing P1P1 row.
"""

from __future__ import annotations

import csv
import gzip
from collections import Counter
from pathlib import Path
from typing import Mapping, Optional

try:
    from build_replays import truthy_count
except ModuleNotFoundError:
    from scripts.build_replays import truthy_count


def open_csv(path: Path):
    if str(path).endswith('.gz'):
        return gzip.open(path, 'rt', encoding='utf-8', newline='')
    return path.open('r', encoding='utf-8', newline='')


def _coords(row: Mapping[str, str]) -> Optional[tuple[int, int]]:
    try:
        return int(float(row.get('pack_number', 0))), int(float(row.get('pick_number', 0)))
    except (TypeError, ValueError):
        return None


def _candidate_count(row: Mapping[str, str], pack_columns: list[str]) -> int:
    return sum(1 for column in pack_columns if truthy_count(row.get(column)) > 0)


def _pool(row: Mapping[str, str], pool_columns: list[str]) -> dict[str, int]:
    result: dict[str, int] = {}
    for column in pool_columns:
        count = truthy_count(row.get(column))
        if count > 0:
            result[column[len('pool_'):]] = count
    return result


def analyze_raw_archive(
    path: Path,
    *,
    minimum_first_visible_candidates: int = 14,
    complete_p1p1_candidates: int = 15,
) -> tuple[dict, dict[str, str]]:
    """Measure first-pack logging and recover P1P1 only from observed pool state."""
    with open_csv(path) as handle:
        reader = csv.DictReader(handle)
        fieldnames = reader.fieldnames or []
        pack_columns = [name for name in fieldnames if name.startswith('pack_card_')]
        pool_columns = [name for name in fieldnames if name.startswith('pool_')]
        if not pack_columns:
            raise ValueError('Powered Cube draft data has no pack_card_ columns.')
        if not pool_columns:
            raise ValueError('Powered Cube draft data has no pool_ columns.')

        first_pack_number: Optional[int] = None
        first_visible_raw_pick: Optional[int] = None
        first_pack_rows = Counter()
        first_pack_candidate_counts: dict[int, Counter] = {}
        first_pack_pool_nonempty = Counter()
        first_pack_singleton_pool = Counter()
        inherited: dict[str, str] = {}
        malformed_first_visible_pool_rows = 0
        total_rows = 0

        for row in reader:
            coords = _coords(row)
            if coords is None:
                continue
            total_rows += 1
            if first_pack_number is None:
                first_pack_number = coords[0]
            if coords[0] != first_pack_number:
                continue

            raw_pick = coords[1]
            candidates = _candidate_count(row, pack_columns)
            pool = _pool(row, pool_columns)
            pool_total = sum(pool.values())

            first_pack_rows[raw_pick] += 1
            first_pack_candidate_counts.setdefault(raw_pick, Counter())[candidates] += 1
            if pool_total > 0:
                first_pack_pool_nonempty[raw_pick] += 1
            if pool_total == 1 and len(pool) == 1:
                first_pack_singleton_pool[raw_pick] += 1

            # A complete 15-card pack can be true P1P1. With P1P1 omitted, the
            # earliest usable decision is the 14-card row whose pool already
            # contains the first pick. Choose the earliest raw coordinate that
            # satisfies either observed shape.
            usable = candidates >= complete_p1p1_candidates or (
                candidates >= minimum_first_visible_candidates and pool_total > 0
            )
            if usable and (first_visible_raw_pick is None or raw_pick < first_visible_raw_pick):
                first_visible_raw_pick = raw_pick
                inherited = {}
                malformed_first_visible_pool_rows = 0

            if first_visible_raw_pick is None or raw_pick != first_visible_raw_pick:
                continue
            if candidates >= complete_p1p1_candidates and pool_total == 0:
                continue
            if candidates < minimum_first_visible_candidates:
                continue

            draft_id = str(row.get('draft_id') or '').strip()
            if pool_total == 1 and len(pool) == 1 and draft_id:
                inherited[draft_id] = next(iter(pool))
            elif pool_total > 0:
                malformed_first_visible_pool_rows += 1

    if first_pack_number is None or first_visible_raw_pick is None:
        raise ValueError('Powered Cube draft archive contained no usable first-pack decision.')

    picks = []
    for raw_pick in sorted(first_pack_rows):
        rows = first_pack_rows[raw_pick]
        distribution = first_pack_candidate_counts.get(raw_pick, Counter())
        dominant_count, dominant_rows = distribution.most_common(1)[0] if distribution else (0, 0)
        picks.append({
            'raw_pick_number': raw_pick,
            'rows': rows,
            'dominant_candidate_count': dominant_count,
            'dominant_candidate_share': round(dominant_rows / rows, 4) if rows else 0,
            'candidate_count_distribution': {str(k): v for k, v in sorted(distribution.items())},
            'pool_nonempty_share': round(first_pack_pool_nonempty[raw_pick] / rows, 4) if rows else 0,
            'singleton_pool_share': round(first_pack_singleton_pool[raw_pick] / rows, 4) if rows else 0,
        })

    visible = next(item for item in picks if int(item['raw_pick_number']) == first_visible_raw_pick)
    missing_p1p1 = int(visible['dominant_candidate_count']) < complete_p1p1_candidates
    if not missing_p1p1:
        inherited = {}

    raw_shape = {
        'first_pack_number': first_pack_number,
        'first_visible_raw_pick_number': first_visible_raw_pick,
        'first_visible_true_pick_number': 2 if missing_p1p1 else 1,
        'missing_p1p1': missing_p1p1,
        'total_rows': total_rows,
        'recovered_inherited_p1p1_picks': len(inherited),
        'malformed_first_visible_pool_rows': malformed_first_visible_pool_rows,
        'first_visible_summary': visible,
        'first_pack_picks': picks,
    }
    return raw_shape, inherited


def write_model_archive(
    source: Path,
    destination: Path,
    raw_shape: Mapping[str, object],
    *,
    minimum_first_visible_candidates: int = 14,
) -> dict:
    """Keep the real first visible row and remove only unusable earlier/anomalous rows."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    first_pack_number = int(raw_shape['first_pack_number'])
    first_visible_raw_pick = int(raw_shape['first_visible_raw_pick_number'])
    missing_p1p1 = bool(raw_shape.get('missing_p1p1'))

    removed_previsible_rows = 0
    removed_malformed_first_visible_rows = 0
    retained_first_visible_rows = 0
    retained_first_visible_pool_rows = 0

    with open_csv(source) as src:
        reader = csv.DictReader(src)
        fieldnames = reader.fieldnames or []
        pack_columns = [name for name in fieldnames if name.startswith('pack_card_')]
        pool_columns = [name for name in fieldnames if name.startswith('pool_')]
        if not pack_columns or not pool_columns:
            raise ValueError('Powered Cube draft data is missing pack or pool columns.')

        with gzip.open(destination, 'wt', encoding='utf-8', newline='') as dst:
            writer = csv.DictWriter(dst, fieldnames=fieldnames)
            writer.writeheader()
            for row in reader:
                coords = _coords(row)
                if coords is None:
                    writer.writerow(row)
                    continue

                if coords[0] == first_pack_number and coords[1] < first_visible_raw_pick:
                    removed_previsible_rows += 1
                    continue

                if coords[0] == first_pack_number and coords[1] == first_visible_raw_pick:
                    candidates = _candidate_count(row, pack_columns)
                    pool_total = sum(_pool(row, pool_columns).values())
                    if missing_p1p1 and candidates < minimum_first_visible_candidates:
                        removed_malformed_first_visible_rows += 1
                        continue
                    retained_first_visible_rows += 1
                    if pool_total > 0:
                        retained_first_visible_pool_rows += 1

                writer.writerow(row)

    if destination.stat().st_size < 1024:
        raise ValueError('Powered Cube model archive is unexpectedly small.')
    if missing_p1p1 and retained_first_visible_pool_rows == 0:
        raise ValueError('Powered Cube model archive retained no inherited P1P1 pool context.')

    return {
        'first_visible_raw_pick_number': first_visible_raw_pick,
        'missing_p1p1': missing_p1p1,
        'previsible_rows_removed': removed_previsible_rows,
        'malformed_first_visible_rows_removed': removed_malformed_first_visible_rows,
        'first_visible_rows_retained': retained_first_visible_rows,
        'first_visible_rows_with_pool': retained_first_visible_pool_rows,
        'pool_context_injected': False,
    }
