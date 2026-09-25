"""Variable-action-set observational propensity models.

The broad-population propensity is deliberately separate from the strong-player
policy. LinearSoftmaxPropensityModel is a dependency-free conditional-logit
baseline over arbitrary candidate feature maps.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping, Sequence

from .features import validate_feature_map

MIN_PROBABILITY = 1e-9


def softmax(scores: Mapping[str, float], temperature: float = 1.0) -> dict[str, float]:
    if temperature <= 0 or not math.isfinite(temperature):
        raise ValueError("temperature must be finite and positive")
    if not scores:
        raise ValueError("cannot normalize an empty action set")
    if any(not math.isfinite(float(value)) for value in scores.values()):
        raise ValueError("all scores must be finite")
    peak = max(float(value) / temperature for value in scores.values())
    weights = {key: math.exp(float(value) / temperature - peak) for key, value in scores.items()}
    total = sum(weights.values())
    probabilities = {key: value / total for key, value in weights.items()}
    validate_distribution(probabilities, tuple(scores))
    return probabilities


def validate_distribution(
    probabilities: Mapping[str, float],
    actions: Sequence[str] | None = None,
) -> None:
    if not probabilities:
        raise ValueError("empty probability distribution")
    if actions is not None and set(probabilities) != set(actions):
        raise ValueError("probability keys must match the complete action set")
    if any(
        (not math.isfinite(float(value))) or value < 0 or value > 1
        for value in probabilities.values()
    ):
        raise ValueError("probabilities must be finite and in [0, 1]")
    if not math.isclose(sum(probabilities.values()), 1.0, rel_tol=1e-10, abs_tol=1e-10):
        raise ValueError("probabilities must sum to one over the offered pack")


def support_threshold(candidate_count: int) -> float:
    if candidate_count <= 0:
        raise ValueError("candidate_count must be positive")
    return max(0.01, 0.10 / candidate_count)


def is_supported(probability: float, candidate_count: int) -> bool:
    return probability >= support_threshold(candidate_count)


@dataclass(frozen=True)
class PropensityExample:
    features: Mapping[str, Mapping[str, float]]
    selected_action: str
    sample_weight: float = 1.0
    offsets: Mapping[str, float] | None = None

    def validate(self) -> None:
        if not self.features:
            raise ValueError("propensity example has no actions")
        if self.selected_action not in self.features:
            raise ValueError("selected action is not in the offered action set")
        if not math.isfinite(self.sample_weight) or self.sample_weight < 0:
            raise ValueError("sample_weight must be finite and non-negative")
        for row in self.features.values():
            validate_feature_map(row)
        if self.offsets is not None:
            if set(self.offsets) != set(self.features):
                raise ValueError("offsets must cover exactly the offered action set")
            if any(not math.isfinite(float(value)) for value in self.offsets.values()):
                raise ValueError("offsets must be finite")


@dataclass(frozen=True)
class LinearSoftmaxPropensityModel:
    feature_names: tuple[str, ...]
    coefficients: tuple[float, ...]
    l2: float

    @classmethod
    def fit(
        cls,
        examples: Sequence[PropensityExample],
        *,
        l2: float = 1.0,
        learning_rate: float = 0.2,
        epochs: int = 250,
    ) -> "LinearSoftmaxPropensityModel":
        if not examples:
            raise ValueError("at least one propensity example is required")
        if l2 < 0:
            raise ValueError("l2 must be non-negative")
        if learning_rate <= 0 or not math.isfinite(learning_rate):
            raise ValueError("learning_rate must be finite and positive")
        if epochs <= 0:
            raise ValueError("epochs must be positive")
        for example in examples:
            example.validate()

        names = tuple(sorted({
            name
            for example in examples
            for action in example.features.values()
            for name in action
        }))
        beta = [0.0] * len(names)
        name_at = {name: index for index, name in enumerate(names)}
        total_weight = sum(example.sample_weight for example in examples)
        if total_weight <= 0:
            raise ValueError("positive total sample weight is required")

        # Compile the immutable sparse design once. The previous implementation
        # rebuilt string-keyed score/probability dictionaries and revalidated
        # every action set on every one of the 250 epochs. On a real Draft
        # archive that dominated Phase 1 runtime even though the mathematical
        # update is sparse and small.
        compiled = []
        for example in examples:
            actions = tuple(example.features)
            selected_index = actions.index(example.selected_action)
            sparse_rows = tuple(
                tuple(
                    (name_at[name], float(value))
                    for name, value in example.features[action].items()
                    if float(value) != 0.0
                )
                for action in actions
            )
            offsets = tuple(
                float(example.offsets[action]) if example.offsets is not None else 0.0
                for action in actions
            )
            compiled.append((
                float(example.sample_weight),
                selected_index,
                sparse_rows,
                offsets,
            ))

        for epoch in range(epochs):
            gradient = [0.0] * len(beta)
            for sample_weight, selected_index, sparse_rows, offsets in compiled:
                scores = []
                for offset, row in zip(offsets, sparse_rows):
                    score = offset
                    for index, value in row:
                        score += beta[index] * value
                    scores.append(score)
                peak = max(scores)
                action_weights = [math.exp(score - peak) for score in scores]
                denominator = sum(action_weights)
                for action_index, row in enumerate(sparse_rows):
                    probability = action_weights[action_index] / denominator
                    residual = (1.0 if action_index == selected_index else 0.0) - probability
                    scale = sample_weight * residual
                    for index, value in row:
                        gradient[index] += scale * value

            step = learning_rate / math.sqrt(1.0 + epoch / 25.0)
            for index in range(len(beta)):
                grad = gradient[index] / total_weight - l2 * beta[index] / total_weight
                beta[index] += step * grad

        return cls(feature_names=names, coefficients=tuple(beta), l2=l2)

    def probabilities(
        self,
        features: Mapping[str, Mapping[str, float]],
        offsets: Mapping[str, float] | None = None,
    ) -> dict[str, float]:
        if not features:
            raise ValueError("cannot score an empty action set")
        if offsets is not None and set(offsets) != set(features):
            raise ValueError("offsets must cover exactly the offered action set")
        coefficients = dict(zip(self.feature_names, self.coefficients))
        scores: dict[str, float] = {}
        for action, row in features.items():
            validate_feature_map(row)
            score = float(offsets[action]) if offsets is not None else 0.0
            score += sum(coefficients.get(name, 0.0) * float(value) for name, value in row.items())
            scores[action] = score
        return softmax(scores)

    def selected_probability(
        self,
        features: Mapping[str, Mapping[str, float]],
        selected_action: str,
        offsets: Mapping[str, float] | None = None,
    ) -> float:
        probabilities = self.probabilities(features, offsets)
        if selected_action not in probabilities:
            raise ValueError("selected action is not in the offered action set")
        return probabilities[selected_action]
