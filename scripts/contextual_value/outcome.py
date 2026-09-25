"""Dependency-free regularized linear Q baseline.

This is the interpretable baseline in the frozen protocol, not the final model
family. It intentionally avoids adding a production dependency; the nonlinear
challenger can be fitted by the experiment environment after validation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Sequence

from .features import validate_feature_map, with_intercept


def _solve(matrix: list[list[float]], vector: list[float]) -> list[float]:
    """Solve Ax=b by Gauss-Jordan elimination with partial pivoting."""
    n = len(vector)
    augmented = [list(matrix[row]) + [float(vector[row])] for row in range(n)]
    for column in range(n):
        pivot = max(range(column, n), key=lambda row: abs(augmented[row][column]))
        if abs(augmented[pivot][column]) < 1e-12:
            raise ValueError("singular design matrix")
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        scale = augmented[column][column]
        augmented[column] = [value / scale for value in augmented[column]]
        for row in range(n):
            if row == column:
                continue
            factor = augmented[row][column]
            if factor == 0:
                continue
            augmented[row] = [
                value - factor * pivot_value
                for value, pivot_value in zip(augmented[row], augmented[column])
            ]
    return [augmented[row][-1] for row in range(n)]


@dataclass(frozen=True)
class RidgeOutcomeModel:
    feature_names: tuple[str, ...]
    coefficients: tuple[float, ...]
    l2: float

    @classmethod
    def fit(
        cls,
        rows: Sequence[Mapping[str, float]],
        outcomes: Sequence[float],
        sample_weights: Sequence[float] | None = None,
        l2: float = 1.0,
    ) -> "RidgeOutcomeModel":
        if len(rows) != len(outcomes) or not rows:
            raise ValueError("rows and outcomes must be non-empty and have the same length")
        if l2 < 0:
            raise ValueError("l2 must be non-negative")
        if sample_weights is None:
            sample_weights = [1.0] * len(rows)
        if len(sample_weights) != len(rows) or any(weight < 0 for weight in sample_weights):
            raise ValueError("sample_weights must be non-negative and align with rows")
        for row in rows:
            validate_feature_map(row)
        names = tuple(sorted({name for row in rows for name in row}))
        design_names = ("__intercept__",) + names
        size = len(design_names)
        xtx = [[0.0] * size for _ in range(size)]
        xty = [0.0] * size
        for row, outcome, weight in zip(rows, outcomes, sample_weights):
            values = with_intercept(row)
            vector = [values.get(name, 0.0) for name in design_names]
            for i in range(size):
                xty[i] += weight * vector[i] * float(outcome)
                for j in range(size):
                    xtx[i][j] += weight * vector[i] * vector[j]
        for index in range(1, size):
            xtx[index][index] += l2  # never penalize intercept
        coefficients = _solve(xtx, xty)
        return cls(design_names, tuple(coefficients), l2)

    def predict(self, features: Mapping[str, float]) -> float:
        validate_feature_map(features)
        values = with_intercept(features)
        return sum(
            coefficient * values.get(name, 0.0)
            for name, coefficient in zip(self.feature_names, self.coefficients)
        )
