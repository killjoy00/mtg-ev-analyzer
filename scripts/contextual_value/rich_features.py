"""Leakage-safe rich pre-pick features for contextual-value Phase A.

This module deliberately contains only deterministic transformations of:
* the pre-pick Decision state,
* static card metadata, and
* already cross-fitted candidate signals.

It never reads the selected action, terminal outcome, future picks, final deck,
or same-draft game information while constructing features.
"""

from __future__ import annotations

import math
import statistics
from typing import Mapping, Sequence

from .dataset import Decision
from .features import validate_feature_map

COLORS = ("W", "U", "B", "R", "G")
RARITIES = ("common", "uncommon", "rare", "mythic")
TYPE_FLAGS = (
    "creature",
    "artifact",
    "enchantment",
    "instant",
    "sorcery",
    "planeswalker",
    "battle",
    "land",
)
CURVE_BUCKETS = ("01", "2", "3", "4", "5plus")
STRONG_RANKING_FEATURES = frozenset({
    "strong_choice_probability",
    "log_strong_choice_probability",
})
BASE_STATE_EXACT = frozenset({
    "pack_number",
    "pick_number",
    "pool_size",
    "candidate_count",
    "user_game_win_rate",
    "log1p_user_games",
})
BASE_STATE_PREFIXES = ("set=", "rank=")
PACK_RELATIVE_SIGNALS = (
    "gih_wr",
    "gnd_wr",
    "iwd",
    "deck_inclusion_probability",
    "ata",
    "alsa",
    "log1p_gih_games",
    "log1p_gnd_games",
)


def _finite(value: object, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def _strings(value: object) -> tuple[str, ...]:
    if not isinstance(value, (list, tuple)):
        return ()
    return tuple(str(item).upper() for item in value if str(item).upper() in COLORS)


def _metadata(metadata: Mapping[str, object] | None) -> dict[str, object]:
    raw = metadata or {}
    colors = _strings(raw.get("colors"))
    identity = _strings(raw.get("color_identity"))
    type_line = str(raw.get("type_line") or "")
    oracle_text = str(raw.get("oracle_text") or "")
    rarity = str(raw.get("rarity") or "").lower()
    cmc = max(0.0, _finite(raw.get("cmc"), 0.0))
    return {
        "missing": not bool(raw),
        "colors": colors,
        "identity": identity,
        "type_line": type_line,
        "oracle_text": oracle_text,
        "rarity": rarity,
        "cmc": cmc,
    }


def _has_type(meta: Mapping[str, object], card_type: str) -> bool:
    return card_type.lower() in str(meta["type_line"]).lower()


def _curve_bucket(meta: Mapping[str, object]) -> str | None:
    if _has_type(meta, "land"):
        return None
    cmc = float(meta["cmc"])
    if cmc <= 1:
        return "01"
    if cmc < 3:
        return "2"
    if cmc < 4:
        return "3"
    if cmc < 5:
        return "4"
    return "5plus"


def _is_fixing(meta: Mapping[str, object]) -> bool:
    text = str(meta["oracle_text"]).lower()
    identity = tuple(meta["identity"])
    if _has_type(meta, "land") and len(identity) >= 2:
        return True
    if "add one mana of any color" in text or "add one mana of any type" in text:
        return True
    if "search your library" in text and "land" in text:
        return True
    return False


def _is_multicolor(meta: Mapping[str, object]) -> bool:
    colors = tuple(meta["colors"])
    identity = tuple(meta["identity"])
    return len(colors) >= 2 or len(identity) >= 2


def _base_state_and_candidate(
    base_features: Mapping[str, Mapping[str, float]],
) -> tuple[dict[str, float], dict[str, dict[str, float]]]:
    if not base_features:
        raise ValueError("rich features require a non-empty candidate feature map")
    actions = tuple(base_features)
    first = base_features[actions[0]]
    state: dict[str, float] = {}
    candidates: dict[str, dict[str, float]] = {}

    state_names = {
        name
        for name in first
        if name in BASE_STATE_EXACT or name.startswith(BASE_STATE_PREFIXES)
    }
    for name in state_names:
        expected = _finite(first[name])
        for action in actions[1:]:
            if abs(_finite(base_features[action].get(name)) - expected) > 1e-12:
                raise ValueError(f"base state feature {name!r} varies across candidates")
        state[f"base:{name}"] = expected

    for action, row in base_features.items():
        candidates[action] = {
            f"base:{name}": _finite(value)
            for name, value in row.items()
            if name not in state_names and name not in STRONG_RANKING_FEATURES
        }
        if any(
            key.removeprefix("base:") in STRONG_RANKING_FEATURES
            for key in candidates[action]
        ):
            raise AssertionError("strong-player ranking feature escaped filter")
    return state, candidates


def _pool_features(
    decision: Decision,
    metadata_by_name: Mapping[str, Mapping[str, object]],
) -> tuple[dict[str, float], dict[str, object]]:
    pool_size = sum(int(count) for _name, count in decision.pool)
    unique_cards = len(decision.pool)
    color_counts = {color: 0.0 for color in COLORS}
    identity_counts = {color: 0.0 for color in COLORS}
    curve_counts = {bucket: 0.0 for bucket in CURVE_BUCKETS}
    type_counts = {kind: 0.0 for kind in TYPE_FLAGS}
    nonland_count = 0.0
    fixing_count = 0.0
    multicolor_count = 0.0
    missing_count = 0.0

    for name, count_raw in decision.pool:
        count = float(max(0, int(count_raw)))
        meta = _metadata(metadata_by_name.get(name))
        if meta["missing"]:
            missing_count += count
        for color in meta["colors"]:
            color_counts[color] += count
        for color in meta["identity"]:
            identity_counts[color] += count
        for kind in TYPE_FLAGS:
            if _has_type(meta, kind):
                type_counts[kind] += count
        bucket = _curve_bucket(meta)
        if bucket is not None:
            curve_counts[bucket] += count
            nonland_count += count
        if _is_fixing(meta):
            fixing_count += count
        if _is_multicolor(meta):
            multicolor_count += count

    denom = float(max(1, pool_size))
    nonland_denom = max(1.0, nonland_count)
    state: dict[str, float] = {
        "state:pool_unique_cards": float(unique_cards),
        "state:pool_metadata_missing_share": missing_count / denom,
        "state:pool_fixing_share": fixing_count / denom,
        "state:pool_multicolor_share": multicolor_count / denom,
    }
    for color in COLORS:
        state[f"state:pool_color_share:{color}"] = color_counts[color] / denom
        state[f"state:pool_identity_share:{color}"] = identity_counts[color] / denom
    for bucket in CURVE_BUCKETS:
        state[f"state:pool_curve_share:{bucket}"] = curve_counts[bucket] / nonland_denom
    for kind in TYPE_FLAGS:
        state[f"state:pool_type_share:{kind}"] = type_counts[kind] / denom

    summary = {
        "pool_size": pool_size,
        "color_counts": color_counts,
        "identity_counts": identity_counts,
        "curve_counts": curve_counts,
        "nonland_count": nonland_count,
        "same_name_counts": dict(decision.pool),
    }
    return state, summary


def _card_features(
    candidate: str,
    metadata: Mapping[str, object] | None,
    pool_summary: Mapping[str, object],
) -> dict[str, float]:
    meta = _metadata(metadata)
    row: dict[str, float] = {
        "card:metadata_missing": float(bool(meta["missing"])),
        "card:cmc": float(meta["cmc"]),
        "card:color_count": float(len(meta["colors"])),
        "card:identity_count": float(len(meta["identity"])),
        "card:is_multicolor": float(_is_multicolor(meta)),
        "card:is_fixing": float(_is_fixing(meta)),
    }
    for color in COLORS:
        row[f"card:color:{color}"] = float(color in meta["colors"])
        row[f"card:identity:{color}"] = float(color in meta["identity"])
    for rarity in RARITIES:
        if meta["rarity"] == rarity:
            row[f"card:rarity:{rarity}"] = 1.0
    for kind in TYPE_FLAGS:
        if _has_type(meta, kind):
            row[f"card:type:{kind}"] = 1.0
    bucket = _curve_bucket(meta)
    if bucket is not None:
        row[f"card:curve:{bucket}"] = 1.0

    pool_size = max(1.0, float(pool_summary["pool_size"]))
    color_counts = pool_summary["color_counts"]
    identity_counts = pool_summary["identity_counts"]
    colors = tuple(meta["colors"])
    identities = tuple(meta["identity"])

    row["fit:pool_same_card_count"] = float(
        pool_summary["same_name_counts"].get(candidate, 0)
    )
    if colors:
        row["fit:color_support_mean"] = sum(
            float(color_counts[color]) / pool_size for color in colors
        ) / len(colors)
        row["fit:new_color_count"] = float(sum(color_counts[color] <= 0 for color in colors))
    else:
        row["fit:color_support_mean"] = 0.0
        row["fit:new_color_count"] = 0.0
    if identities:
        row["fit:identity_support_mean"] = sum(
            float(identity_counts[color]) / pool_size for color in identities
        ) / len(identities)
        row["fit:new_identity_color_count"] = float(
            sum(identity_counts[color] <= 0 for color in identities)
        )
    else:
        row["fit:identity_support_mean"] = 0.0
        row["fit:new_identity_color_count"] = 0.0

    if bucket is not None:
        row["fit:curve_bucket_share"] = float(
            pool_summary["curve_counts"][bucket]
        ) / max(1.0, float(pool_summary["nonland_count"]))
    else:
        row["fit:curve_bucket_share"] = 0.0
    return row


def _pack_relative_features(
    base_features: Mapping[str, Mapping[str, float]],
) -> dict[str, dict[str, float]]:
    result = {action: {} for action in base_features}
    action_count = len(base_features)

    for signal in PACK_RELATIVE_SIGNALS:
        present = {
            action: _finite(row[signal])
            for action, row in base_features.items()
            if signal in row and math.isfinite(_finite(row[signal], float("nan")))
        }
        values = list(present.values())
        if values:
            mean = statistics.fmean(values)
            median = statistics.median(values)
            low = min(values)
            high = max(values)
            spread = high - low
        else:
            mean = median = spread = 0.0

        for action in base_features:
            row = result[action]
            prefix = f"packrel:{signal}"
            row[f"{prefix}:present"] = float(action in present)
            row[f"{prefix}:present_fraction"] = len(values) / max(1, action_count)
            row[f"{prefix}:range"] = spread
            if action not in present:
                row[f"{prefix}:minus_mean"] = 0.0
                row[f"{prefix}:minus_median"] = 0.0
                row[f"{prefix}:minus_best_other"] = 0.0
                row[f"{prefix}:percentile"] = 0.0
                continue

            value = present[action]
            others = [v for other, v in present.items() if other != action]
            row[f"{prefix}:minus_mean"] = value - mean
            row[f"{prefix}:minus_median"] = value - median
            row[f"{prefix}:minus_best_other"] = (
                value - max(others) if others else 0.0
            )
            if len(values) <= 1:
                percentile = 0.5
            else:
                less = sum(v < value - 1e-12 for v in values)
                equal = sum(abs(v - value) <= 1e-12 for v in values)
                percentile = (less + 0.5 * max(0, equal - 1)) / (len(values) - 1)
            row[f"{prefix}:percentile"] = min(1.0, max(0.0, percentile))
    return result


def rich_feature_bundle(
    decision: Decision,
    base_features: Mapping[str, Mapping[str, float]],
    metadata_by_name: Mapping[str, Mapping[str, object]],
) -> tuple[dict[str, float], dict[str, dict[str, float]]]:
    """Return factorized state and candidate features for one pre-pick decision.

    Strong-player choice fields are intentionally removed from the ranking
    feature map. They remain available to the separate behavior/support model.
    """
    if set(base_features) != set(decision.candidates):
        raise ValueError("base feature actions do not exactly match offered candidates")

    state, candidates = _base_state_and_candidate(base_features)
    pool_state, pool_summary = _pool_features(decision, metadata_by_name)
    state.update(pool_state)

    relative = _pack_relative_features(base_features)
    for candidate in decision.candidates:
        candidates[candidate].update(
            _card_features(candidate, metadata_by_name.get(candidate), pool_summary)
        )
        candidates[candidate].update(relative[candidate])
        validate_feature_map(candidates[candidate])

    validate_feature_map(state)
    forbidden = {
        f"base:{name}"
        for name in STRONG_RANKING_FEATURES
    }
    leaked = forbidden & set().union(*(row.keys() for row in candidates.values()))
    if leaked:
        raise AssertionError(f"strong-player ranking features leaked: {sorted(leaked)}")
    return state, candidates


def feature_names(
    state: Mapping[str, float],
    candidates: Mapping[str, Mapping[str, float]],
) -> tuple[str, ...]:
    names = set(state)
    for row in candidates.values():
        names.update(row)
    return tuple(sorted(names))
