#!/usr/bin/env python3
"""Conservative multi-action hidden-confounding sensitivity bounds for #529.

This is a native multi-action outer-bound construction. For each target action,
we apply a one-vs-rest marginal odds-ratio sensitivity model around the nominal
propensity and preserve all historical third-action observations in the sample.

The resulting bounds are conservative and are NOT claimed to be sharp
multinomial sensitivity bounds.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

import numpy as np


@dataclass(frozen=True)
class SensitivityBound:
    gamma: float
    lower: float
    upper: float


def propensity_interval(e: np.ndarray, gamma: float) -> tuple[np.ndarray,np.ndarray]:
    if gamma < 1:
        raise ValueError("gamma must be >= 1")
    e=np.asarray(e,dtype=np.float64)
    if np.any((e<=0)|(e>=1)):
        raise ValueError("nominal propensities must be in (0,1)")
    g=float(gamma)
    lower=e/(g*(1.0-e)+e)
    upper=(g*e)/(1.0-e+g*e)
    return lower,upper


def inverse_weight_interval(e: np.ndarray, gamma: float, cap: float|None=None) -> tuple[np.ndarray,np.ndarray]:
    lower_p,upper_p=propensity_interval(e,gamma)
    low_w=1.0/upper_p
    high_w=1.0/lower_p
    if cap is not None:
        low_w=np.minimum(float(cap),low_w)
        high_w=np.minimum(float(cap),high_w)
    return low_w,high_w


def _draft_analysis_weight(draft_ids: Sequence[str], decision_indices: np.ndarray) -> np.ndarray:
    ids=np.asarray([str(draft_ids[int(i)]) for i in decision_indices])
    _,inv,count=np.unique(ids,return_inverse=True,return_counts=True)
    return 1.0/count[inv].astype(np.float64)


def paired_policy_bounds(
    *,
    offsets: np.ndarray,
    selected_ord: np.ndarray,
    challenger_ord: np.ndarray,
    incumbent_ord: np.ndarray,
    outcome: np.ndarray,
    behavior: np.ndarray,
    q_values: np.ndarray,
    draft_ids: Sequence[str],
    decision_indices: np.ndarray,
    gamma: float,
    cap: float|None=20.0,
    estimator: str="dr",
) -> SensitivityBound:
    """Bound challenger-minus-incumbent value under a conservative sensitivity set."""
    idx=np.asarray(decision_indices,dtype=np.int64)
    offsets=np.asarray(offsets,dtype=np.int64)
    selected=np.asarray(selected_ord,dtype=np.int64)
    challenger=np.asarray(challenger_ord,dtype=np.int64)
    incumbent=np.asarray(incumbent_ord,dtype=np.int64)
    y=np.asarray(outcome,dtype=np.float64)
    e=np.asarray(behavior,dtype=np.float64)
    q=np.asarray(q_values,dtype=np.float64)
    if estimator not in {"dr","ipw"}:
        raise ValueError("estimator must be dr or ipw")

    w=_draft_analysis_weight(draft_ids,idx)
    n_drafts=len(set(str(draft_ids[int(i)]) for i in idx))
    base=np.zeros(len(idx),dtype=np.float64)
    lower_corr=np.zeros(len(idx),dtype=np.float64)
    upper_corr=np.zeros(len(idx),dtype=np.float64)

    for pos,raw_i in enumerate(idx):
        i=int(raw_i)
        start=int(offsets[i])
        obs=int(selected[i])
        c=int(challenger[i])
        a=int(incumbent[i])
        if c==a:
            continue

        q_c=float(q[start+c])
        q_a=float(q[start+a])
        if estimator=="dr":
            base[pos]=q_c-q_a
        else:
            base[pos]=0.0

        # Historical third-card action contributes zero to both target policies.
        if obs!=c and obs!=a:
            continue

        g=start+obs
        nominal=float(e[g])
        low_iw,high_iw=inverse_weight_interval(np.asarray([nominal]),gamma,cap=cap)
        low_iw=float(low_iw[0]); high_iw=float(high_iw[0])
        signal=float(y[i]) if estimator=="ipw" else float(y[i]-q[g])
        coefficient=signal if obs==c else -signal
        lo=min(coefficient*low_iw,coefficient*high_iw)
        hi=max(coefficient*low_iw,coefficient*high_iw)
        lower_corr[pos]=lo
        upper_corr[pos]=hi

    lower=float(np.sum(w*(base+lower_corr))/n_drafts)
    upper=float(np.sum(w*(base+upper_corr))/n_drafts)
    return SensitivityBound(gamma=float(gamma),lower=lower,upper=upper)


def sensitivity_curve(**kwargs) -> list[SensitivityBound]:
    grid=kwargs.pop("gamma_grid")
    return [paired_policy_bounds(gamma=float(g),**kwargs) for g in grid]


def gamma_zero(curve: Sequence[SensitivityBound]) -> float|None:
    for row in curve:
        if row.lower <= 0:
            return float(row.gamma)
    return None


def skill_odds_shift_summary(
    *,
    reference_behavior: np.ndarray,
    skill_behavior: np.ndarray,
    offsets: np.ndarray,
    target_ord: np.ndarray,
    decision_indices: np.ndarray,
) -> dict:
    ref=np.asarray(reference_behavior,dtype=np.float64)
    alt=np.asarray(skill_behavior,dtype=np.float64)
    offsets=np.asarray(offsets,dtype=np.int64)
    target=np.asarray(target_ord,dtype=np.int64)
    vals=[]
    for raw_i in np.asarray(decision_indices,dtype=np.int64):
        i=int(raw_i)
        g=int(offsets[i])+int(target[i])
        p0=float(np.clip(ref[g],1e-9,1-1e-9))
        p1=float(np.clip(alt[g],1e-9,1-1e-9))
        shift=abs(math.log(p1/(1-p1))-math.log(p0/(1-p0)))
        vals.append(shift)
    arr=np.asarray(vals,dtype=np.float64)
    return {
        "n":len(arr),
        "abs_log_odds_shift_mean":float(np.mean(arr)),
        "p50":float(np.quantile(arr,.50)),
        "p75":float(np.quantile(arr,.75)),
        "p90":float(np.quantile(arr,.90)),
        "p95":float(np.quantile(arr,.95)),
        "p99":float(np.quantile(arr,.99)),
        "gamma_reference_p95":float(np.exp(np.quantile(arr,.95))),
    }
