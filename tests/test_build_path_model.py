import sys
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))

from build_path_model import render_model
from build_replays import CountStore


class BuildPathModelTests(unittest.TestCase):
    def test_render_model_is_compact_and_filters_weak_pairs(self):
        counts = CountStore.empty()
        counts.global_seen.update({'A': 100, 'B': 80})
        counts.global_picked.update({'A': 50, 'B': 20})
        counts.pack_seen.update({('A', 0): 60, ('B', 0): 40})
        counts.pack_picked.update({('A', 0): 30, ('B', 0): 10})
        counts.exact_seen.update({('A', 0, 0): 30, ('B', 0, 0): 25})
        counts.exact_picked.update({('A', 0, 0): 15, ('B', 0, 0): 5})
        counts.pair_seen.update({('A', 'B'): 12, ('B', 'A'): 7})
        counts.pair_picked.update({('A', 'B'): 6, ('B', 'A'): 2})

        model = render_model('TST', '2026-01-01', counts, 0, 0, 100, 20, 3, 0.6)
        self.assertEqual(model['model_version'], 'strong-player-counterfactual-path-v3')
        self.assertEqual(model['cards'], ['A', 'B'])
        self.assertEqual(model['stats'][0][4][0], [1, 30, 15])
        self.assertEqual(len(model['pairs']), 1)
        self.assertEqual(model['pairs'][0][2:], [12, 6])
        self.assertEqual(model['training']['excluded_replay_drafts'], 3)
        self.assertEqual(model['constants']['commitment_picks'], 8.0)


if __name__ == '__main__':
    unittest.main()
