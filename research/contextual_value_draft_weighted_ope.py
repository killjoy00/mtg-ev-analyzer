#!/usr/bin/env python3
"""Draft-weighted one-step off-policy evaluation helpers for #529.

Primary amended estimand: average the eligible one-step policy terms within
each draft, then average equally across drafts. This is not a whole-draft
multi-action policy value.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np


@dataclass(frozen=True)
class DraftWeightedEstimate:
    n_drafts: int
    n_decisions: int
    direct: float
    ipw: float
    snips: float
    dr: float
    ess: float
    ess_ratio: float
    clipped_fraction: float
    max_unclipped_weight: float


@dataclass(frozen=True)
class DraftWeightedTerms:
    draft_ids: np.ndarray
    direct: np.ndarray
    ipw: np.ndarray
    snips_numerator: np.ndarray
    target_weight: np.ndarray
    dr: np.ndarray
    clipped_weight: np.ndarray
    max_unclipped_weight: np.ndarray


def eligible_p1p1_p1p8(pack_number: np.ndarray, pick_number: np.ndarray) -> np.ndarray:
    return np.flatnonzero(
        (np.asarray(pack_number, dtype=np.int64) == 0)
        & (np.asarray(pick_number, dtype=np.int64) >= 0)
        & (np.asarray(pick_number, dtype=np.int64) < 8)
    )


def _analysis_weights(draft_ids: Sequence[str], decision_indices: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    ids = np.asarray([str(draft_ids[int(i)]) for i in decision_indices])
    unique, inverse, counts = np.unique(ids, return_inverse=True, return_counts=True)
    weight = 1.0 / counts[inverse].astype(np.float64)
    return unique, inverse, weight


def policy_terms(
    *,
    offsets: np.ndarray,
    selected_ord: np.ndarray,
    target_ord: np.ndarray,
    outcome: np.ndarray,
    behavior: np.ndarray,
    q_values: np.ndarray,
    draft_ids: Sequence[str],
    decision_indices: np.ndarray,
    cap: float,
) -> DraftWeightedTerms:
    idx = np.asarray(decision_indices, dtype=np.int64)
    offsets = np.asarray(offsets, dtype=np.int64)
    selected_ord = np.asarray(selected_ord, dtype=np.int64)
    target_ord = np.asarray(target_ord, dtype=np.int64)
    outcome = np.asarray(outcome, dtype=np.float64)
    behavior = np.asarray(behavior, dtype=np.float64)
    q_values = np.asarray(q_values, dtype=np.float64)
    if len(target_ord) != len(selected_ord):
        raise ValueError("target ordinals must align with all decisions")
    unique, inverse, within = _analysis_weights(draft_ids, idx)
    selected_global = offsets[idx] + selected_ord[idx]
    target_global = offsets[idx] + target_ord[idx]
    propensity = behavior[selected_global]
    if np.any(~np.isfinite(propensity)) or np.any(propensity <= 0):
        raise ValueError("selected-action propensity must be positive")
    matched = selected_ord[idx] == target_ord[idx]
    raw_weight = np.where(matched, 1.0 / propensity, 0.0)
    capped = np.minimum(float(cap), raw_weight)
    y = outcome[idx]
    q_selected = q_values[selected_global]
    direct = q_values[target_global]
    ipw = capped * y
    dr = direct + capped * (y - q_selected)
    clipped = (raw_weight > float(cap)).astype(np.float64)

    n_drafts = len(unique)
    per_direct = np.zeros(n_drafts, dtype=np.float64)
    per_ipw = np.zeros(n_drafts, dtype=np.float64)
    per_num = np.zeros(n_drafts, dtype=np.float64)
    per_weight = np.zeros(n_drafts, dtype=np.float64)
    per_dr = np.zeros(n_drafts, dtype=np.float64)
    per_clip = np.zeros(n_drafts, dtype=np.float64)
    per_max = np.zeros(n_drafts, dtype=np.float64)
    np.add.at(per_direct, inverse, within * direct)
    np.add.at(per_ipw, inverse, within * ipw)
    np.add.at(per_num, inverse, within * ipw)
    np.add.at(per_weight, inverse, within * capped)
    np.add.at(per_dr, inverse, within * dr)
    np.add.at(per_clip, inverse, within * clipped)
    np.maximum.at(per_max, inverse, raw_weight)

    return DraftWeightedTerms(
        draft_ids=unique,
        direct=per_direct,
        ipw=per_ipw,
        snips_numerator=per_num,
        target_weight=per_weight,
        dr=per_dr,
        clipped_weight=per_clip,
        max_unclipped_weight=per_max,
    )


def summarize_terms(terms: DraftWeightedTerms) -> DraftWeightedEstimate:
    n = len(terms.draft_ids)
    weight_sum = float(np.sum(terms.target_weight))
    weight_sq_sum = float(np.sum(np.square(terms.target_weight)))
    ess = weight_sum * weight_sum / weight_sq_sum if weight_sq_sum > 0 else 0.0
    return DraftWeightedEstimate(
        n_drafts=n,
        n_decisions=-1,
        direct=float(np.mean(terms.direct)),
        ipw=float(np.mean(terms.ipw)),
        snips=float(np.sum(terms.snips_numerator) / weight_sum) if weight_sum > 0 else float("nan"),
        dr=float(np.mean(terms.dr)),
        ess=float(ess),
        ess_ratio=float(ess / n) if n else 0.0,
        clipped_fraction=float(np.mean(terms.clipped_weight)),
        max_unclipped_weight=float(np.max(terms.max_unclipped_weight)) if n else 0.0,
    )


def evaluate_draft_weighted(**kwargs) -> tuple[DraftWeightedEstimate, DraftWeightedTerms]:
    idx = np.asarray(kwargs["decision_indices"], dtype=np.int64)
    terms = policy_terms(**kwargs)
    estimate = summarize_terms(terms)
    estimate = DraftWeightedEstimate(
        n_drafts=estimate.n_drafts,
        n_decisions=int(len(idx)),
        direct=estimate.direct,
        ipw=estimate.ipw,
        snips=estimate.snips,
        dr=estimate.dr,
        ess=estimate.ess,
        ess_ratio=estimate.ess_ratio,
        clipped_fraction=estimate.clipped_fraction,
        max_unclipped_weight=estimate.max_unclipped_weight,
    )
    return estimate, terms


def paired_delta(left: DraftWeightedTerms, right: DraftWeightedTerms) -> np.ndarray:
    if not np.array_equal(left.draft_ids, right.draft_ids):
        raise ValueError("paired policies must have identical draft ordering")
    return np.asarray(left.dr - right.dr, dtype=np.float64)


def paired_bootstrap_ci(
    delta: np.ndarray,
    *,
    alpha: float = 0.05,
    draws: int = 5000,
    seed: int = 529,
) -> list[float]:
    delta = np.asarray(delta, dtype=np.float64)
    if delta.ndim != 1 or len(delta) < 2:
        raise ValueError("paired draft delta must be a nontrivial vector")
    rng = np.random.default_rng(seed)
    out = np.empty(draws, dtype=np.float64)
    n = len(delta)
    for b in range(draws):
        out[b] = float(np.mean(delta[rng.integers(0, n, size=n)]))
    return [
        float(np.quantile(out, alpha / 2.0)),
        float(np.quantile(out, 1.0 - alpha / 2.0)),
    ]


def stable_hashed_indices(decision_ids: Sequence[str], draft_ids: Sequence[str], eligible_indices: np.ndarray) -> np.ndarray:
    # Import lazily to keep this helper independent of the heavier research modules.
    from build_replays import stable_score

    by_draft: dict[str, list[int]] = {}
    for raw_index in np.asarray(eligible_indices, dtype=np.int64):
        i = int(raw_index)
        by_draft.setdefault(str(draft_ids[i]), []).append(i)
    chosen = []
    for draft_id in sorted(by_draft):
        chosen.append(min(
            by_draft[draft_id],
            key=lambda i: stable_score(f"contextual-value-v1-primary:{str(decision_ids[i])}"),
        ))
    return np.asarray(chosen, dtype=np.int64)
