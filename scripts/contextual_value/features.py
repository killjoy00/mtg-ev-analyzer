"""Feature contracts and baseline candidate features for contextual-value-v1.

Feature builders make post-treatment leakage structurally difficult: the
terminal outcome, observed action, realized final deck, future picks, and game
results are reserved names and cannot be inserted into a candidate feature map.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping

from .dataset import Decision

FORBIDDEN_FEATURES = frozenset({
    "event_match_wins",
    "event_match_losses",
    "selected_card",
    "historical_pick",
    "actual_final_deck",
    "final_main_colors",
    "card_was_played",
    "card_was_drawn",
    "future_picks",
    "future_game_outcome",
})


def validate_feature_map(features: Mapping[str, float]) -> None:
    leaked = FORBIDDEN_FEATURES & set(features)
    if leaked:
        raise ValueError(f"post-treatment features are forbidden: {', '.join(sorted(leaked))}")
    for name, value in features.items():
        if not name:
            raise ValueError(f"feature names must be non-empty")
        if not math.isfinite(float(value)):
            raise ValueError(f"feature {name!r} must be finite")


def with_intercept(features: Mapping[str, float]) -> dict[str, float]:
    validate_feature_map(features)
    if "__intercept__" in features:
        raise ValueError("__intercept__ is reserved")
    return {"__intercept__": 1.0, **{name: float(value) for name, value in features.items()}}


@dataclass(frozen=True)
class CardSignals:
    """Cross-fitted, pre-decision evidence for one candidate.

    All fields are predictions/aggregates from the training complement.  Realized
    same-draft final-deck or game information must never be represented here.
    """

    strong_choice_probability: float | None = None
    gih_wr: float | None = None
    gnd_wr: float | None = None
    iwd: float | None = None
    gih_games: int | None = None
    gnd_games: int | None = None
    deck_inclusion_probability: float | None = None
    ata: float | None = None
    alsa: float | None = None


def _bounded_probability(name: str, value: float | None) -> float | None:
    if value is None:
        return None
    value = float(value)
    if not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError(f"{name} must be a finite probability")
    return value


def candidate_features(
    decision: Decision,
    candidate: str,
    signals: CardSignals | None = None,
    *,
    include_identity: bool = True,
    include_pool_identity: bool = False,
) -> dict[str, float]:
    """Build the dependency-free baseline feature row for ``(state, candidate)`.

    The function intentionally uses only state known before the pick plus
    externally supplied cross-fitted signals.  Rich metadata/color/archetype
    features can be added later without changing the nuisance plumbing.
    """
    if candidate not in decision.candidates:
        raise ValueError("candidate is not in the offered action set")
    pool = dict(decision.pool)
    features: dict[str, float] = {
        "pack_number": float(decision.pack_number),
        "pick_number": float(decision.pick_number),
        "pool_size": float(sum(pool.values())),
        "candidate_count": float(len(decision.candidates)),
        "user_game_win_rate": float(decision.user_game_win_rate),
        "log1p_user_games": math.log1p(decision.user_games_lower_bound),
        f"set={decision.expansion or 'unknown'}": 1.0,
        f"rank={decision.rank or 'unknown'}": 1.0,
    }
    if include_identity:
        features[f"candidate={candidate}"] = 1.0
    if include_pool_identity:
        for pool_card, count in decision.pool:
            features[f"pool={pool_card}"] = float(min(count, 4))

    if signals is not None:
        strong = _bounded_probability("strong_choice_probability", signals.strong_choice_probability)
        if strong is not None:
            features["strong_choice_probability"] = strong
            features["log_strong_choice_probability"] = math.log(max(1e-6, strong))
        gih = _bounded_probability("gih_wr", signals.gih_wr)
        if gih is not None:
            features["gih_wr"] = gih
        gnd = _bounded_probability("gnd_wr", signals.gnd_wr)
        if gnd is not None:
            features["gnd_wr"] = gnd
        if signals.iwd is not None:
            iwd = float(signals.iwd)
            if not math.isfinite(iwd):
                raise ValueError("iwd must be finite")
            features["iwd"] = iwd
        if signals.gih_games is not None:
            features["log1p_gih_games"] = math.log1p(max(0, int(signals.gih_games)))
        if signals.gnd_games is not None:
            features["log1p_gnd_games"] = math.log1p(max(0, int(signals.gnd_games)))
        deck = _bounded_probability("deck_inclusion_probability", signals.deck_inclusion_probability)
        if deck is not None:
            features["deck_inclusion_probability"] = deck
            if gih is not None:
                features["gih_x_deck_probability"] = gih * deck
        for name, value in (("ata", signals.ata), ("alsa", signals.alsa)):
            if value is not None:
                value = float(value)
                if not math.isfinite(value):
                    raise ValueError(f"{name} must be finite")
                features[name] = value
    validate_feature_map(features)
    return features


def decision_feature_map(
    decision: Decision,
    signals: Mapping[str, CardSignals] | None = None,
    *,
    include_identity: bool = True,
    include_pool_identity: bool = False,
) -> dict[str, dict[str, float]]:
    signals = signals or {}
    return {
        candidate: candidate_features(
            decision,
            candidate,
            signals.get(candidate),
            include_identity=include_identity,
            include_pool_identity=include_pool_identity,
        )
        for candidate in decision.candidates
    }


def strong_choice_offsets(signals: Mapping[str, CardSignals], candidates: tuple[str, ...]) -> dict[str, float] | None:
    """Fixed log-probability offset for broad propensity fitting when available."""
    values: dict[str, float] = {}
    for candidate in candidates:
        row = signals.get(candidate)
        if row is None or row.strong_choice_probability is None:
            return None
        probability = _bounded_probability("strong_choice_probability", row.strong_choice_probability)
        assert probability is not None
        values[candidate] = math.log(max(1e-6, probability))
    return values
