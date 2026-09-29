#!/usr/bin/env python3
"""Outcome-free research-A reconstruction utilities for #756 null calibration.

This module deliberately never reads event_match_wins, event_match_losses, or
any game win/loss field. It reconstructs only the already-frozen research-A
inputs needed by the synthetic-outcome calibration.
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import importlib.util
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_replays import CountStore, OutOfFoldModel, PickExample, quantile_cutoff, stable_score
from card_outcomes import column_index, count_of
from contextual_value.dataset import _games_lower_bound, _number
from deck_fit import card_colours, colour_hits_for_drafts, estimate, observe_examples

STRONG_MINIMUM_GAMES = 100
STRONG_TOP_FRACTION = 0.15
STRONG_TRAINING_CAP = 5000

FORBIDDEN_DRAFT_OUTCOME_COLUMNS = frozenset({"event_match_wins", "event_match_losses"})
FORBIDDEN_GAME_OUTCOME_COLUMNS = frozenset({"won", "game_won", "match_won"})


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _as_int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _count(value):
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def stable_rng_seed(*parts: object) -> int:
    payload = "|".join(map(str, parts)).encode("utf-8")
    return int.from_bytes(hashlib.sha256(payload).digest()[:8], "big")


def frozen_half(draft_id: str) -> int:
    digest = hashlib.sha256(f"a-regret-v1:{draft_id}".encode()).digest()
    return int.from_bytes(digest[:8], "big") % 2


def parse_training_examples_no_outcomes(
    draft_archive: Path,
    train_ids: frozenset[str],
    expansion: str,
):
    """Parse exactly the fields needed for strong-model pick counts and skill.

    No outcome column is indexed or accessed.
    """
    train = set(map(str, train_ids))
    skills: dict[str, tuple[float, int]] = {}
    pairs_by_draft: dict[str, list[PickExample]] = defaultdict(list)
    with gzip.open(draft_archive, "rt", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        pos = {name: i for i, name in enumerate(header)}
        required = {
            "draft_id", "event_type", "pack_number", "pick_number", "pick",
            "user_game_win_rate_bucket", "user_n_games_bucket",
        }
        missing = sorted(required - set(pos))
        if missing:
            raise SystemExit(f"{expansion}: training parser missing {missing}")
        # Outcome columns may exist in the archive; this parser intentionally
        # does not resolve their positions.
        pack_cols = [
            (name[len("pack_card_"):], i)
            for i, name in enumerate(header)
            if name.startswith("pack_card_")
        ]
        pool_cols = [
            (name[len("pool_"):], i)
            for i, name in enumerate(header)
            if name.startswith("pool_")
        ]
        for values in reader:
            if len(values) != len(header):
                continue
            did = values[pos["draft_id"]].strip()
            if did not in train:
                continue
            if values[pos["event_type"]].strip() != "PremierDraft":
                continue
            pack = _as_int(values[pos["pack_number"]])
            pick = _as_int(values[pos["pick_number"]])
            chosen = values[pos["pick"]].strip()
            if pack is None or pick is None or not chosen:
                continue
            if did not in skills:
                rate = _number(values[pos["user_game_win_rate_bucket"]])
                games = _games_lower_bound(values[pos["user_n_games_bucket"]])
                if rate is not None and games is not None and 0 <= rate <= 1:
                    skills[did] = (float(rate), int(games))
            candidates = [card for card, i in pack_cols if _count(values[i]) > 0]
            if not candidates or chosen not in candidates or len(candidates) != len(set(candidates)):
                continue
            pool = {card: n for card, i in pool_cols if (n := _count(values[i])) > 0}
            pairs_by_draft[did].append(PickExample(did, pack, pick, chosen, candidates, pool))

    missing_train = train - set(pairs_by_draft)
    if missing_train:
        raise SystemExit(f"{expansion}: no parsed pick examples for {len(missing_train)} frozen A training IDs")
    return skills, pairs_by_draft


def select_strong_ids_no_outcomes(
    train_ids: frozenset[str],
    skills: dict[str, tuple[float, int]],
):
    eligible_skills = {
        did: rate
        for did, (rate, games) in skills.items()
        if did in train_ids and games >= STRONG_MINIMUM_GAMES
    }
    if not eligible_skills:
        raise SystemExit("no strong-player skill inputs")
    cutoff = quantile_cutoff(list(eligible_skills.values()), STRONG_TOP_FRACTION)
    chosen = [did for did, rate in eligible_skills.items() if rate >= cutoff]
    chosen.sort(key=lambda did: stable_score(f"train:{did}"))
    chosen = chosen[:STRONG_TRAINING_CAP]
    return frozenset(chosen), float(cutoff)


def read_deck_observations_no_outcomes(game_archive: Path, keep_ids: frozenset[str]):
    """Reproduce GameStore.deck_observations without reading any win field."""
    keep = set(keep_ids)
    played: dict[str, set[str]] = {}
    main_counts: dict[str, Counter] = defaultdict(Counter)
    with gzip.open(game_archive, "rt", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        header = tuple(next(reader))
        cards, plain = column_index(header)
        draft_at = plain.get("draft_id")
        main_at = plain.get("main_colors")
        if draft_at is None or main_at is None:
            raise SystemExit("game archive missing draft_id/main_colors")
        compact: list[tuple[str, int]] = []
        for name, groups in cards.items():
            if "deck_" not in groups:
                continue
            if not any(group in groups for group in ("opening_hand_", "drawn_", "tutored_")):
                continue
            compact.append((name, groups["deck_"]))
        for values in reader:
            if len(values) != len(header):
                continue
            did = values[draft_at].strip()
            if did not in keep:
                continue
            main = "".join(ch for ch in values[main_at].strip().upper() if ch in "WUBRG")
            main_counts[did][main] += 1
            p = played.setdefault(did, set())
            for name, deck_at in compact:
                if count_of(values[deck_at]):
                    p.add(name)
    main_by_draft = {
        did: counter.most_common(1)[0][0]
        for did, counter in main_counts.items()
        if counter
    }
    return played, main_by_draft


def build_research_a_model_no_outcomes(
    draft_archive: Path,
    game_archive: Path | None,
    train_ids: frozenset[str],
    expansion: str,
    *,
    need_colour_fit: bool,
):
    """Reconstruct the frozen research-A strong model without real outcomes."""
    skills, pairs_by_draft = parse_training_examples_no_outcomes(
        draft_archive, train_ids, expansion
    )
    strong_ids, cutoff = select_strong_ids_no_outcomes(train_ids, skills)
    pairs = [
        (did, ex)
        for did in sorted(strong_ids)
        for ex in sorted(pairs_by_draft[did], key=lambda x: (x.raw_pack_number, x.raw_pick_number))
    ]
    counts = CountStore.empty()
    for _did, ex in pairs:
        counts.observe(ex)
    base = OutOfFoldModel(counts, CountStore.empty())
    memo: dict[tuple[str, int, int], float] = {}

    def base_of(card: str, pack: int, pick: int) -> float:
        key = (card, pack, pick)
        if key not in memo:
            memo[key] = base.base_tendency(card, pack, pick)
        return memo[key]

    for _did, ex in pairs:
        counts.observe_expected(ex, base_of)

    fit = None
    if need_colour_fit:
        if game_archive is None:
            raise SystemExit("later-pick A reconstruction requires game archive for outcome-free deck fit")
        played, main_by_draft = read_deck_observations_no_outcomes(game_archive, strong_ids)
        colour_hits = colour_hits_for_drafts(played, main_by_draft, set(strong_ids))
        colours = card_colours(colour_hits)
        by_bucket, by_card, by_stage = observe_examples(pairs, played, colours)
        if by_card:
            fit = estimate(by_bucket, by_card, colours, by_stage)

    model = OutOfFoldModel(counts, CountStore.empty(), fit=dict(fit) if fit else None)
    return model, {
        "training_ids": len(train_ids),
        "strong_ids": len(strong_ids),
        "strong_cutoff": cutoff,
        "pick_examples": len(pairs),
        "colour_fit": bool(fit),
        "outcome_columns_read": [],
    }


def assign_p1_a_scores(contexts, model):
    all_cards = sorted({c for row in contexts for c in row["candidates"]})
    raw = {c: float(model.card_tendency(c, 0, 0, {})) for c in all_cards}
    for row in contexts:
        local = [(c, max(0.0, raw[c])) for c in row["candidates"]]
        total = sum(v for _c, v in local)
        if total <= 0:
            probs = {c: 1.0 / len(local) for c, _v in local}
        else:
            probs = {c: v / total for c, v in local}
        ranked = sorted(probs, key=lambda c: (-probs[c], c))
        row["a_card"] = ranked[0]
        row["a_probability"] = float(probs[ranked[0]])
        row["a_margin"] = float(probs[ranked[0]] - probs[ranked[1]]) if len(ranked) > 1 else 1.0
    return raw


def normal_score_values(raw_scores: dict[str, float], tau: float):
    from scipy.stats import norm

    ranked = sorted(raw_scores, key=lambda c: (-raw_scores[c], c))
    n = len(ranked)
    out = {}
    for idx, card in enumerate(ranked, start=1):
        p = (n - idx + 0.5) / n
        out[card] = float(tau * norm.ppf(p))
    return out


def slice_name(margin: float) -> str:
    if margin <= 0.02:
        return "<=0.02"
    if margin <= 0.05:
        return "(0.02,0.05]"
    if margin <= 0.10:
        return "(0.05,0.10]"
    return ">0.10"
