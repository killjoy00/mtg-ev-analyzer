"""Offline conditional-choice residual against frozen v6 support; no runtime imports.

Rows require unrounded, positive v6 support from a disjoint baseline fitting
partition. This module does not reconstruct or authenticate those supports.
Choice labels are historical behavior, not independently judged quality.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import math
from typing import Iterable

FEATURES = (
    'mana_supported', 'missing_single_pip', 'missing_multiple_pips',
    'missing_multiple_colours', 'fixing_utility', 'opportunity_cost',
    'synergy_payoff', 'synergy_enabler',
)
ARMS = {
    'baseline': (), 'mana': FEATURES[:5], 'opportunity': FEATURES[:6],
    'synergy': FEATURES[6:], 'combined': FEATURES,
}


def timestamp(value):
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        raise ValueError('timezone-aware timestamp required')
    return dt


@dataclass(frozen=True)
class Choice:
    source: str
    event_time: str
    candidates: tuple[str, ...]
    support: tuple[float, ...]
    features: tuple[tuple[float, ...], ...]
    chosen: int

    def __post_init__(self):
        n = len(self.candidates)
        if not self.source or not n or len(set(self.candidates)) != n:
            raise ValueError('source and unique candidates required')
        timestamp(self.event_time)
        if not 0 <= self.chosen < n or len(self.support) != n or len(self.features) != n:
            raise ValueError('misaligned choice row')
        if any(not math.isfinite(p) or p <= 0 for p in self.support):
            raise ValueError('require positive unrounded baseline support')
        if any(len(row) != len(FEATURES) or any(not math.isfinite(x) or abs(x) > 1 for x in row)
               for row in self.features):
            raise ValueError('features must be finite, bounded, in the frozen order')


def check_partitions(baseline: Iterable[tuple[str, str]], residual: Iterable[Choice],
                     validation: Iterable[Choice], assessment: Iterable[Choice],
                     purge_days: int = 7):
    """Check source isolation and chronological ordering; not archive provenance.

    Baseline times must include the last game used by its fit, not just draft
    start. Other partitions must be similarly purged by upstream construction.
    IDs are global source-draft identifiers, not puzzle IDs.
    """
    if purge_days < 0:
        raise ValueError('invalid purge')
    groups = [list(baseline)] + [[(x.source, x.event_time) for x in rows]
                                for rows in (residual, validation, assessment)]
    seen = set()
    latest = None
    for group in groups:
        ids = {source for source, _ in group}
        if not group or '' in ids or seen & ids:
            raise ValueError('empty or overlapping source-draft partitions')
        times = [timestamp(time) for _, time in group]
        if latest is not None and min(times) < latest + timedelta(days=purge_days):
            raise ValueError('chronology/purge violation')
        latest = max(times)
        seen.update(ids)


def weights(row: Choice, beta: tuple[float, ...]):
    if len(beta) != len(FEATURES) or any(not math.isfinite(x) for x in beta):
        raise ValueError('invalid coefficients')
    logits = [math.log(p) + sum(a*b for a,b in zip(f, beta))
              for p, f in zip(row.support, row.features)]
    peak = max(logits)
    exp = [math.exp(x - peak) for x in logits]
    total = sum(exp)
    return tuple(x / total for x in exp)


def awards(row: Choice, beta: tuple[float, ...]):
    p = weights(row, beta)
    lead = max(p)
    return tuple(100 if i == row.chosen else min(95, math.floor(95 * x / lead + .5))
                 for i, x in enumerate(p))


def objective(rows, beta, penalty):
    n = len(rows)
    if not n:
        raise ValueError('empty fit sample')
    loss = penalty * sum(b*b for b in beta) / 2
    grad = [penalty*b for b in beta]
    for row in rows:
        p = weights(row, beta)
        loss -= math.log(max(p[row.chosen], 1e-300)) / n
        for j, chosen in enumerate(row.features[row.chosen]):
            grad[j] += (sum(prob * f[j] for prob, f in zip(p, row.features)) - chosen) / n
    return loss, tuple(grad)


def fit(rows: Iterable[Choice], arm='combined', penalty=.1, max_iter=200, tol=1e-7):
    """L2 regularized conditional logit; labels used only on fitting rows.

    Coefficients are learned rather than fixed bonuses/penalties. Caller must
    freeze the arm/regularization using validation before assessment.
    """
    if arm not in ARMS or not math.isfinite(penalty) or penalty <= 0:
        raise ValueError('invalid arm or penalty')
    if max_iter < 1 or tol <= 0:
        raise ValueError('invalid optimizer parameters')
    rows = tuple(rows)
    active = set(ARMS[arm])
    beta = (0.,) * len(FEATURES)
    for iteration in range(max_iter):
        loss, grad = objective(rows, beta, penalty)
        grad = tuple(g if f in active else 0. for f, g in zip(FEATURES, grad))
        norm = sum(g*g for g in grad)
        if norm <= tol*tol:
            return beta, {'iterations': iteration, 'objective': loss, 'converged': True}
        step = 1.
        while step >= 1e-10:
            candidate = tuple(b - step*g for b,g in zip(beta,grad))
            new_loss, _ = objective(rows, candidate, penalty)
            if new_loss <= loss - 1e-4*step*norm:
                beta = candidate
                break
            step *= .5
        else:
            raise RuntimeError('line search failed')
    loss, _ = objective(rows, beta, penalty)
    return beta, {'iterations': max_iter, 'objective': loss, 'converged': False}


def evaluate(rows, beta, display_exponent=1.75):
    """Behavioral metrics only. No trophy override in prediction metrics."""
    if not math.isfinite(display_exponent) or display_exponent <= 0:
        raise ValueError('invalid display exponent')
    n = alternatives = top1 = 0
    raw_loss = display_loss = brier = 0.
    bands = [0]*5
    for row in rows:
        p = weights(row, beta)
        v = [x**display_exponent for x in p]
        q = [x/sum(v) for x in v]
        leader = min(range(len(p)), key=lambda i: (-p[i], row.candidates[i]))
        n += 1
        top1 += leader == row.chosen
        raw_loss -= math.log(max(p[row.chosen], 1e-300))
        display_loss -= math.log(max(q[row.chosen], 1e-300))
        brier += sum((x-(i == row.chosen))**2 for i,x in enumerate(q))
        for i, a in enumerate(awards(row, beta)):
            if i != row.chosen:
                alternatives += 1
                bands[0 if a < 25 else 1 if a < 50 else 2 if a < 75 else 3 if a < 90 else 4] += 1
    if not n:
        raise ValueError('empty evaluation sample')
    return {'decisions': n, 'top1': top1/n, 'raw_log_loss': raw_loss/n,
            'display_log_loss': display_loss/n, 'display_brier': brier/n,
            'alternatives': alternatives, 'bands_0_to_95': bands}


def self_test():
    """Synthetic contracts only; no empirical claim about Magic decisions."""
    def row(i, time='2026-02-01T00:00:00Z', chosen=1):
        return Choice(str(i), time, ('a', 'b'), (.6,.4),
                      ((0.,)*8, (1.,)+(0.,)*7), chosen)
    rows = [row(i) for i in range(20)]
    zero = (0.,)*8
    assert awards(rows[0], zero) == (95,100)
    assert awards(row('x', chosen=0), zero) == (100,63)
    assert abs(weights(rows[0], zero)[1]-.4) < 1e-12
    beta, info = fit(rows, 'mana')
    assert info['converged'] and beta[0] > 0 and all(x==0 for x in beta[5:])
    assert evaluate(rows,beta)['raw_log_loss'] < evaluate(rows,zero)['raw_log_loss']
    b, _ = fit(rows,'baseline')
    assert b == zero
    check_partitions([('base','2026-01-01T00:00:00Z')], rows,
                     [row('v','2026-03-01T00:00:00Z')], [row('a','2026-04-01T00:00:00Z')])
    for args in [([('0','2026-01-01T00:00:00Z')], rows,
                  [row('v','2026-03-01T00:00:00Z')], [row('a','2026-04-01T00:00:00Z')]),
                 ([('base','2026-01-31T00:00:00Z')], rows,
                  [row('v','2026-03-01T00:00:00Z')], [row('a','2026-04-01T00:00:00Z')])]:
        try:
            check_partitions(*args)
        except ValueError:
            pass
        else:
            raise AssertionError('leakage guard did not reject invalid partition')
    print('Synthetic contracts passed; no real-data fit performed.')


if __name__ == '__main__':
    self_test()
