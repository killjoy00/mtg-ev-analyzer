"""Feature contracts for contextual-value-v1.

Feature builders must make post-treatment leakage structurally difficult: the
terminal outcome, observed action, realized final deck, future picks, and game
results are reserved names and cannot be inserted into a candidate feature map.
"""

from __future__ import annotations

import math
from typing import Mapping

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
            raise ValueError("feature names must be non-empty")
        if not math.isfinite(float(value)):
            raise ValueError(f"feature {name!r} must be finite")


def with_intercept(features: Mapping[str, float]) -> dict[str, float]:
    validate_feature_map(features)
    if "__intercept__" in features:
        raise ValueError("__intercept__ is reserved")
    return {"__intercept__": 1.0, **{name: float(value) for name, value in features.items()}}
