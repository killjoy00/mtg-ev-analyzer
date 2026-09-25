"""Leakage-safe decision and candidate row construction."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping, Sequence

from build_replays import stable_score

from . import (
    ASSESSMENT_SHARE,
    PRIMARY_PACK,
    PRIMARY_PICK_START,
    PRIMARY_PICK_STOP,
    SPLIT_SALT,
    TRAIN_SHARE,
    VALIDATION_SHARE,
)

CARD_PREFIX = "pack_card_"
POOL_PREFIX = "pool_"


@dataclass(frozen=True)
class Decision:
    draft_id: str
    expansion: str
    event_type: str
    draft_time: str
    rank: str
    pack_number: int
    pick_number: int
    selected_card: str
    candidates: tuple[str, ...]
    pool: tuple[tuple[str, int], ...]
    user_game_win_rate: float
    user_games_lower_bound: int
    event_match_wins: int
    event_match_losses: int | None

    @property
    def decision_id(self) -> str:
        return f"{self.draft_id}:{self.pack_number}:{self.pick_number}"

    def pre_treatment_state(self) -> dict:
        """Return only fields that are legal before the action is taken."""
        return {
            "draft_id": self.draft_id,
            "expansion": self.expansion,
            "event_type": self.event_type,
            "draft_time": self.draft_time,
            "rank": self.rank,
            "pack_number": self.pack_number,
            "pick_number": self.pick_number,
            "candidates": list(self.candidates),
            "pool": dict(self.pool),
            "user_game_win_rate": self.user_game_win_rate,
            "user_games_lower_bound": self.user_games_lower_bound,
        }


@dataclass(frozen=True)
class CandidateRow:
    decision_id: str
    draft_id: str
    candidate: str
    selected: bool
    outcome: int | None
    split: str


def _number(value: object) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace("%", "")
    if not text:
        return None
    if "-" in text and not text.startswith("-"):
        parts = []
        for piece in text.split("-", 1):
            try:
                parts.append(float(piece.strip()))
            except ValueError:
                pass
        if parts:
            result = sum(parts) / len(parts)
            return result / 100.0 if result > 1 else result
    try:
        result = float(text)
    except ValueError:
        return None
    return result / 100.0 if result > 1 else result


def _games_lower_bound(value: object) -> int | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    token = ""
    for char in text:
        if char.isdigit() or (char == "-" and not token):
            token += char
        elif token:
            break
    try:
        return max(0, int(token))
    except (TypeError, ValueError):
        return None


def _count(value: object) -> int:
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return 0
    if not math.isfinite(number) or number <= 0:
        return 0
    return max(1, int(round(number)))


def _int(value: object) -> int | None:
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return None


def draft_split(draft_id: str) -> str:
    bucket = stable_score(f"{SPLIT_SALT}:{draft_id}") % 100
    if bucket < TRAIN_SHARE:
        return "train"
    if bucket < TRAIN_SHARE + VALIDATION_SHARE:
        return "validation"
    return "assessment"


def parse_decision(row: Mapping[str, object], header: Sequence[str]) -> Decision | None:
    draft_id = str(row.get("draft_id") or "").strip()
    selected = str(row.get("pick") or "").strip()
    pack_number = _int(row.get("pack_number"))
    pick_number = _int(row.get("pick_number"))
    wins = _int(row.get("event_match_wins"))
    losses = _int(row.get("event_match_losses"))
    rate = _number(row.get("user_game_win_rate_bucket"))
    games = _games_lower_bound(row.get("user_n_games_bucket"))
    if not draft_id or not selected or pack_number is None or pick_number is None:
        return None
    if wins is None or rate is None or games is None or not 0 <= rate <= 1:
        return None

    candidates = tuple(
        column[len(CARD_PREFIX):]
        for column in header
        if column.startswith(CARD_PREFIX) and _count(row.get(column)) > 0
    )
    if not candidates or selected not in candidates or len(candidates) != len(set(candidates)):
        return None
    pool = tuple(sorted(
        (column[len(POOL_PREFIX):], count)
        for column in header
        if column.startswith(POOL_PREFIX) and (count := _count(row.get(column))) > 0
    ))
    return Decision(
        draft_id=draft_id,
        expansion=str(row.get("expansion") or "").strip(),
        event_type=str(row.get("event_type") or "").strip(),
        draft_time=str(row.get("draft_time") or "").strip(),
        rank=str(row.get("rank") or "").strip(),
        pack_number=pack_number,
        pick_number=pick_number,
        selected_card=selected,
        candidates=candidates,
        pool=pool,
        user_game_win_rate=rate,
        user_games_lower_bound=games,
        event_match_wins=wins,
        event_match_losses=losses,
    )


def expand_candidates(decision: Decision) -> tuple[CandidateRow, ...]:
    split = draft_split(decision.draft_id)
    rows = tuple(CandidateRow(
        decision_id=decision.decision_id,
        draft_id=decision.draft_id,
        candidate=card,
        selected=(card == decision.selected_card),
        outcome=decision.event_match_wins if card == decision.selected_card else None,
        split=split,
    ) for card in decision.candidates)
    if sum(row.selected for row in rows) != 1:
        raise AssertionError("every decision must have exactly one selected action")
    if sum(row.outcome is not None for row in rows) != 1:
        raise AssertionError("terminal outcome must label only the selected action")
    return rows


def choose_primary_decision(decisions: Sequence[Decision]) -> Decision | None:
    """One deterministic Pack One decision per draft for primary OPE."""
    eligible = [
        decision for decision in decisions
        if decision.pack_number == PRIMARY_PACK
        and PRIMARY_PICK_START <= decision.pick_number < PRIMARY_PICK_STOP
    ]
    if not eligible:
        return None
    draft_ids = {decision.draft_id for decision in eligible}
    if len(draft_ids) != 1:
        raise ValueError("primary-decision selection expects one draft at a time")
    return min(
        eligible,
        key=lambda decision: stable_score(f"contextual-value-v1-primary:{decision.decision_id}"),
    )


def normalized_draft_weights(decisions: Sequence[Decision]) -> dict[str, float]:
    """Each draft contributes total weight one regardless of decision count."""
    counts: dict[str, int] = {}
    for decision in decisions:
        counts[decision.draft_id] = counts.get(decision.draft_id, 0) + 1
    return {
        decision.decision_id: 1.0 / counts[decision.draft_id]
        for decision in decisions
    }
