import math
import unittest

import numpy as np

from contextual_value.dr import PolicyObservation, evaluate_policy


def make_obs(action, outcome, behavior, target, q):
    return PolicyObservation(
        action=action,
        outcome=float(outcome),
        behavior=dict(behavior),
        target=dict(target),
        q_values=dict(q),
        cluster=None,
    )


class TrustAuditSyntheticTests(unittest.TestCase):
    def test_identical_targets_have_exact_zero_difference(self):
        rows = []
        for i in range(200):
            action = "A" if i % 3 else "B"
            rows.append(make_obs(
                action,
                1.0 if action == "A" else 0.0,
                {"A": 2/3, "B": 1/3},
                {"A": 1.0, "B": 0.0},
                {"A": 0.5, "B": 0.2},
            ))
        left = evaluate_policy(rows, weight_cap=20)
        right = evaluate_policy(rows, weight_cap=20)
        self.assertEqual(left.dr - right.dr, 0.0)
        self.assertEqual(left.direct - right.direct, 0.0)
        self.assertEqual(left.snips - right.snips, 0.0)
        self.assertEqual(left.ipw - right.ipw, 0.0)

    def _variable_action_sample(self, *, effect_a=0.5, effect_b=0.0, seed=529, n=50000):
        rng = np.random.default_rng(seed)
        a_rows, b_rows = [], []
        for i in range(n):
            high_skill = bool(i % 2)
            actions = ("A", "B", "C") if i % 5 == 0 else ("A", "B")
            if high_skill:
                probs = {"A": 0.70, "B": 0.20, "C": 0.10} if "C" in actions else {"A": 0.78, "B": 0.22}
                baseline = 2.0
            else:
                probs = {"A": 0.20, "B": 0.70, "C": 0.10} if "C" in actions else {"A": 0.22, "B": 0.78}
                baseline = 0.0
            names = list(actions)
            p = np.asarray([probs[x] for x in names], dtype=float)
            p /= p.sum()
            action = names[int(rng.choice(len(names), p=p))]
            effects = {"A": effect_a, "B": effect_b, "C": -0.1}
            outcome = baseline + effects[action]
            wrong_q = {name: 0.0 for name in names}
            target_a = {name: float(name == "A") for name in names}
            target_b = {name: float(name == "B") for name in names}
            behavior = {name: float(p[j]) for j, name in enumerate(names)}
            a_rows.append(make_obs(action, outcome, behavior, target_a, wrong_q))
            b_rows.append(make_obs(action, outcome, behavior, target_b, wrong_q))
        return a_rows, b_rows

    def test_correct_behavior_recovers_known_advantage_with_wrong_q(self):
        a_rows, b_rows = self._variable_action_sample(effect_a=0.5, effect_b=0.0)
        a = evaluate_policy(a_rows, weight_cap=50)
        b = evaluate_policy(b_rows, weight_cap=50)
        self.assertAlmostEqual(a.dr - b.dr, 0.5, delta=0.06)

    def test_correct_q_recovers_known_advantage_with_wrong_behavior(self):
        rows_a, rows_b = [], []
        rng = np.random.default_rng(529)
        for i in range(20000):
            high_skill = bool(i % 2)
            baseline = 2.0 if high_skill else 0.0
            true_behavior = {"A": 0.75, "B": 0.25} if high_skill else {"A": 0.25, "B": 0.75}
            action = "A" if rng.random() < true_behavior["A"] else "B"
            outcome = baseline + (0.4 if action == "A" else 0.0)
            exact_q = {"A": baseline + 0.4, "B": baseline}
            wrong_behavior = {"A": 0.5, "B": 0.5}
            rows_a.append(make_obs(action, outcome, wrong_behavior, {"A": 1.0, "B": 0.0}, exact_q))
            rows_b.append(make_obs(action, outcome, wrong_behavior, {"A": 0.0, "B": 1.0}, exact_q))
        a = evaluate_policy(rows_a, weight_cap=20)
        b = evaluate_policy(rows_b, weight_cap=20)
        self.assertAlmostEqual(a.dr - b.dr, 0.4, places=12)

    def test_skill_confounding_does_not_create_null_effect_with_correct_behavior(self):
        a_rows, b_rows = self._variable_action_sample(effect_a=0.0, effect_b=0.0, seed=530)
        a = evaluate_policy(a_rows, weight_cap=50)
        b = evaluate_policy(b_rows, weight_cap=50)
        self.assertAlmostEqual(a.dr - b.dr, 0.0, delta=0.06)

    def test_clipping_trades_variance_for_bias_in_extreme_support(self):
        unclipped = []
        for i in range(10000):
            action = "A" if i < 100 else "B"
            unclipped.append(make_obs(
                action,
                1.0 if action == "A" else 0.0,
                {"A": 0.01, "B": 0.99},
                {"A": 1.0, "B": 0.0},
                {"A": 0.0, "B": 0.0},
            ))
        no_clip = evaluate_policy(unclipped, weight_cap=1000)
        clipped = evaluate_policy(unclipped, weight_cap=20)
        self.assertAlmostEqual(no_clip.dr, 1.0, places=12)
        self.assertAlmostEqual(clipped.dr, 0.2, places=12)
        self.assertGreater(no_clip.dr, clipped.dr)
        self.assertEqual(clipped.clipped_fraction, 0.01)


if __name__ == "__main__":
    unittest.main()
