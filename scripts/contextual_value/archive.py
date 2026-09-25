"""Archive-backed signal construction for contextual-value-v1.

This module deliberately keeps every aggregate keyed by an explicit training
complement. A scored draft may never contribute to the strong-player model,
card outcomes, deck-fit estimate, or pick-position summaries used to score it.
"""

from __future__ import annotations

import csv
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, Mapping, Sequence

from build_replays import (
    CountStore,
    OutOfFoldModel,
    PickExample,
    normalize_probabilities,
    quantile_cutoff,
    stable_score,
)
from card_outcomes import IWD_PRIOR_GAMES, PRIOR_GAMES, column_index, count_of, shrink
from deck_fit import (
    card_colours,
    colour_hits_for_drafts,
    commit_bucket,
    commitment,
    estimate,
    observe_examples,
)
from contextual_value.dataset import Decision, draft_split, parse_decision
from contextual_value.features import CardSignals
from contextual_value.schema import open_text, validate_header

STRONG_MINIMUM_GAMES = 100
STRONG_TOP_FRACTION = 0.15
STRONG_TRAINING_CAP = 5000


def _pick_example(decision: Decision) -> PickExample:
    return PickExample(
        decision.draft_id,
        decision.pack_number,
        decision.pick_number,
        decision.selected_card,
        list(decision.candidates),
        dict(decision.pool),
    )


def load_decisions(
    archive: Path,
    *,
    split: str | None = None,
    max_drafts: int | None = None,
) -> list[Decision]:
    """Parse the broad outcome population from one 17Lands draft archive.

    The optional cap is deterministic and exists only for development/smoke
    runs. It never changes split assignment and therefore cannot leak one draft
    across train/validation/assessment.
    """
    if split not in {None, "train", "validation", "assessment"}:
        raise ValueError("split must be train, validation, assessment, or None")
    with open_text(archive) as handle:
        reader = csv.DictReader(handle)
        header = tuple(reader.fieldnames or ())
        validate_header(header, "draft")
        decisions: dict[str, Decision] = {}
        by_draft: dict[str, list[str]] = defaultdict(list)
        draft_signature: dict[str, tuple] = {}
        for row in reader:
            decision = parse_decision(row, header)
            if decision is None:
                continue
            if decision.event_type != "PremierDraft":
                continue
            if split is not None and draft_split(decision.draft_id) != split:
                continue
            signature = (
                decision.expansion,
                decision.event_type,
                decision.user_game_win_rate,
                decision.user_games_lower_bound,
                decision.event_match_wins,
                decision.event_match_losses,
            )
            prior = draft_signature.setdefault(decision.draft_id, signature)
            if prior != signature:
                raise ValueError(
                    f"{decision.draft_id}: draft-level outcome/skill fields changed across picks"
                )
            existing = decisions.get(decision.decision_id)
            if existing is not None and existing != decision:
                raise ValueError(f"{decision.decision_id}: conflicting duplicate decision")
            decisions[decision.decision_id] = decision
            by_draft[decision.draft_id].append(decision.decision_id)

    keep = set(by_draft)
    if max_drafts is not None:
        if max_drafts <= 0:
            raise ValueError("max_drafts must be positive")
        ordered = sorted(
            keep,
            key=lambda draft_id: stable_score(f"contextual-value-v1-sample:{draft_id}"),
        )
        keep = set(ordered[:max_drafts])
    return sorted(
        (decision for decision in decisions.values() if decision.draft_id in keep),
        key=lambda item: (item.draft_id, item.pack_number, item.pick_number),
    )


@dataclass
class GameDraftSummary:
    rows: int = 0
    wins: int = 0
    cards: dict[str, dict[str, int]] = field(default_factory=dict)
    played: set[str] = field(default_factory=set)
    main_colours: Counter = field(default_factory=Counter)


@dataclass
class GameStore:
    """Per-draft sufficient statistics from the wide 17Lands game archive."""

    drafts: dict[str, GameDraftSummary]

    @classmethod
    def from_archive(cls, archive: Path, keep_ids: Iterable[str]) -> "GameStore":
        keep = set(keep_ids)
        drafts: dict[str, GameDraftSummary] = {}
        with open_text(archive) as handle:
            reader = csv.reader(handle)
            header = tuple(next(reader))
            validate_header(header, "game")
            cards, plain = column_index(header)
            draft_at = plain.get("draft_id")
            main_at = plain.get("main_colors")
            won_at = plain["won"]
            if draft_at is None:
                raise ValueError("game data is missing draft_id")
            if main_at is None:
                raise ValueError(
                    "game data is missing main_colors; contextual-value-v1 requires "
                    "the complete v4 colour-fit comparator"
                )

            compact: list[tuple[str, int, tuple[int, ...]]] = []
            for name, groups in cards.items():
                if "deck_" not in groups:
                    continue
                in_hand = tuple(
                    groups[group]
                    for group in ("opening_hand_", "drawn_", "tutored_")
                    if group in groups
                )
                if in_hand:
                    compact.append((name, groups["deck_"], in_hand))

            for values in reader:
                if len(values) != len(header):
                    continue
                draft_id = values[draft_at].strip()
                if not draft_id or draft_id not in keep:
                    continue
                won = 1 if values[won_at] in ("True", "true", "1") else 0
                summary = drafts.setdefault(draft_id, GameDraftSummary())
                summary.rows += 1
                summary.wins += won
                main = "".join(
                    char for char in values[main_at].strip().upper()
                    if char in "WUBRG"
                )
                summary.main_colours[main] += 1
                for name, deck_at, hand_at in compact:
                    if not count_of(values[deck_at]):
                        continue
                    summary.played.add(name)
                    counts = summary.cards.setdefault(
                        name,
                        {
                            "gih_games": 0,
                            "gih_wins": 0,
                            "gnd_games": 0,
                            "gnd_wins": 0,
                            "deck_games": 0,
                            "deck_wins": 0,
                        },
                    )
                    counts["deck_games"] += 1
                    counts["deck_wins"] += won
                    drawn = any(count_of(values[position]) for position in hand_at)
                    key = "gih" if drawn else "gnd"
                    counts[f"{key}_games"] += 1
                    counts[f"{key}_wins"] += won
        return cls(drafts)

    def _ids(self, training_ids: frozenset[str]) -> list[str]:
        return sorted(draft_id for draft_id in training_ids if draft_id in self.drafts)

    def outcome_table(self, training_ids: frozenset[str]) -> dict[str, dict]:
        merged: dict[str, dict[str, int]] = {}
        rows = wins = 0
        for draft_id in self._ids(training_ids):
            summary = self.drafts[draft_id]
            rows += summary.rows
            wins += summary.wins
            for card, counts in summary.cards.items():
                target = merged.setdefault(card, {key: 0 for key in counts})
                for key, value in counts.items():
                    target[key] += value
        baseline = wins / rows if rows else 0.5
        result: dict[str, dict] = {}
        for card, counts in merged.items():
            gih = shrink(
                counts["gih_wins"],
                counts["gih_games"],
                baseline,
                PRIOR_GAMES,
            )
            gnd = shrink(
                counts["gnd_wins"],
                counts["gnd_games"],
                baseline,
                PRIOR_GAMES,
            )
            support = min(counts["gih_games"], counts["gnd_games"])
            impact = (gih - gnd) * (
                support / (support + IWD_PRIOR_GAMES)
                if support + IWD_PRIOR_GAMES
                else 0.0
            )
            result[card] = {
                "gih_wr": gih,
                "gnd_wr": gnd,
                "iwd": impact,
                "gih_games": counts["gih_games"],
                "gnd_games": counts["gnd_games"],
            }
        return result

    def deck_observations(
        self,
        training_ids: frozenset[str],
    ) -> tuple[dict[str, set], dict[str, str]]:
        played: dict[str, set] = {}
        main_by_draft: dict[str, str] = {}
        for draft_id in self._ids(training_ids):
            summary = self.drafts[draft_id]
            played[draft_id] = set(summary.played)
            if summary.main_colours:
                main_by_draft[draft_id] = summary.main_colours.most_common(1)[0][0]
        return played, main_by_draft


@dataclass(frozen=True)
class ComplementArtifacts:
    training_ids: frozenset[str]
    strong_ids: frozenset[str]
    strong_model: OutOfFoldModel | None
    outcome_table: Mapping[str, Mapping[str, float]]
    deck_fit: Mapping[str, object] | None
    deck_colours: Mapping[str, object]
    ata: Mapping[str, float]
    alsa: Mapping[str, float]


class ArchiveSignalProvider:
    """Build and cache all candidate signals from an explicit draft complement."""

    def __init__(
        self,
        decisions: Sequence[Decision],
        games: GameStore,
        *,
        strong_minimum_games: int = STRONG_MINIMUM_GAMES,
        strong_top_fraction: float = STRONG_TOP_FRACTION,
        strong_training_cap: int | None = STRONG_TRAINING_CAP,
    ):
        self.decisions = tuple(decisions)
        self.by_draft: dict[str, tuple[Decision, ...]] = {}
        grouped: dict[str, list[Decision]] = defaultdict(list)
        for decision in self.decisions:
            grouped[decision.draft_id].append(decision)
        self.by_draft = {
            draft_id: tuple(
                sorted(rows, key=lambda item: (item.pack_number, item.pick_number))
            )
            for draft_id, rows in grouped.items()
        }
        self.games = games
        self.strong_minimum_games = strong_minimum_games
        self.strong_top_fraction = strong_top_fraction
        self.strong_training_cap = strong_training_cap
        self._cache: dict[frozenset[str], ComplementArtifacts] = {}

    def _pick_pairs(self, ids: frozenset[str]):
        for draft_id in sorted(ids):
            for decision in self.by_draft.get(draft_id, ()):
                yield draft_id, _pick_example(decision)

    def _deck_fit(
        self,
        ids: frozenset[str],
    ) -> tuple[Mapping[str, object] | None, Mapping[str, object]]:
        played, main_by_draft = self.games.deck_observations(ids)
        colour_hits = colour_hits_for_drafts(played, main_by_draft, set(ids))
        colours = card_colours(colour_hits)
        by_bucket, by_card, by_stage = observe_examples(
            self._pick_pairs(ids),
            played,
            colours,
        )
        if not by_card:
            return None, colours
        return estimate(by_bucket, by_card, colours, by_stage), colours

    def _strong_ids(self, ids: frozenset[str]) -> frozenset[str]:
        skills = {}
        for draft_id in ids:
            rows = self.by_draft.get(draft_id)
            if not rows:
                continue
            first = rows[0]
            if first.user_games_lower_bound >= self.strong_minimum_games:
                skills[draft_id] = first.user_game_win_rate
        if not skills:
            return frozenset()
        cutoff = quantile_cutoff(list(skills.values()), self.strong_top_fraction)
        chosen = [draft_id for draft_id, rate in skills.items() if rate >= cutoff]
        chosen.sort(key=lambda draft_id: stable_score(f"train:{draft_id}"))
        if self.strong_training_cap is not None:
            chosen = chosen[: self.strong_training_cap]
        return frozenset(chosen)

    def _strong_model(
        self,
        strong_ids: frozenset[str],
    ) -> OutOfFoldModel | None:
        pairs = list(self._pick_pairs(strong_ids))
        if not pairs:
            return None
        counts = CountStore.empty()
        for _, example in pairs:
            counts.observe(example)
        base = OutOfFoldModel(counts, CountStore.empty())
        memo: Dict[tuple[str, int, int], float] = {}

        def base_of(card: str, pack: int, pick: int) -> float:
            key = (card, pack, pick)
            if key not in memo:
                memo[key] = base.base_tendency(card, pack, pick)
            return memo[key]

        for _, example in pairs:
            counts.observe_expected(example, base_of)
        fit, _ = self._deck_fit(strong_ids)
        return OutOfFoldModel(counts, CountStore.empty(), fit=dict(fit) if fit else None)

    def _position_stats(
        self,
        ids: frozenset[str],
    ) -> tuple[dict[str, float], dict[str, float]]:
        picked_sum: Counter = Counter()
        picked_n: Counter = Counter()
        seen_sum: Counter = Counter()
        seen_n: Counter = Counter()
        for draft_id in ids:
            for decision in self.by_draft.get(draft_id, ()):
                position = float(decision.pick_number)
                picked_sum[decision.selected_card] += position
                picked_n[decision.selected_card] += 1
                for card in decision.candidates:
                    seen_sum[card] += position
                    seen_n[card] += 1
        ata = {
            card: picked_sum[card] / picked_n[card]
            for card in picked_n
            if picked_n[card]
        }
        alsa = {
            card: seen_sum[card] / seen_n[card]
            for card in seen_n
            if seen_n[card]
        }
        return ata, alsa

    def artifacts(self, training_ids: frozenset[str]) -> ComplementArtifacts:
        unknown = training_ids - set(self.by_draft)
        if unknown:
            raise ValueError(f"training complement contains unknown drafts: {sorted(unknown)[:3]}")
        cached = self._cache.get(training_ids)
        if cached is not None:
            return cached
        strong_ids = self._strong_ids(training_ids)
        deck_fit, deck_colours = self._deck_fit(training_ids)
        ata, alsa = self._position_stats(training_ids)
        built = ComplementArtifacts(
            training_ids=training_ids,
            strong_ids=strong_ids,
            strong_model=self._strong_model(strong_ids),
            outcome_table=self.games.outcome_table(training_ids),
            deck_fit=deck_fit,
            deck_colours=deck_colours,
            ata=ata,
            alsa=alsa,
        )
        self._cache[training_ids] = built
        return built

    def __call__(
        self,
        decision: Decision,
        training_ids: frozenset[str],
    ) -> Mapping[str, CardSignals]:
        if decision.draft_id in training_ids:
            raise AssertionError("scored draft is present in its signal training complement")
        artifacts = self.artifacts(training_ids)
        strong: dict[str, float] = {}
        if artifacts.strong_model is not None:
            raw = {
                card: artifacts.strong_model.card_tendency(
                    card,
                    decision.pack_number,
                    decision.pick_number,
                    dict(decision.pool),
                )
                for card in decision.candidates
            }
            strong = normalize_probabilities(raw)

        signals: dict[str, CardSignals] = {}
        pool = dict(decision.pool)
        fit_cards = (
            artifacts.deck_fit.get("cards", {})
            if isinstance(artifacts.deck_fit, Mapping)
            else {}
        )
        for card in decision.candidates:
            outcome = artifacts.outcome_table.get(card, {})
            deck_probability = None
            fit_row = fit_cards.get(card) if isinstance(fit_cards, Mapping) else None
            if isinstance(fit_row, Mapping):
                base = fit_row.get("play_rate")
                matched = commitment(pool, artifacts.deck_colours, card)
                if matched is None:
                    deck_probability = float(base) if base is not None else None
                else:
                    by_commitment = fit_row.get("by_commitment") or {}
                    chosen = by_commitment.get(commit_bucket(matched), base)
                    deck_probability = float(chosen) if chosen is not None else None

            signals[card] = CardSignals(
                strong_choice_probability=strong.get(card),
                gih_wr=float(outcome["gih_wr"]) if "gih_wr" in outcome else None,
                gnd_wr=float(outcome["gnd_wr"]) if "gnd_wr" in outcome else None,
                iwd=float(outcome["iwd"]) if "iwd" in outcome else None,
                gih_games=int(outcome["gih_games"]) if "gih_games" in outcome else None,
                gnd_games=int(outcome["gnd_games"]) if "gnd_games" in outcome else None,
                deck_inclusion_probability=deck_probability,
                ata=artifacts.ata.get(card),
                alsa=artifacts.alsa.get(card),
            )
        return signals
