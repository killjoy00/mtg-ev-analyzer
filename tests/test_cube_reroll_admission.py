import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from build_verified_trophy_corpus import prune_cube_reroll_dead_ends


def puzzle(pid, source, rating, pick=4):
    top = 0.5
    second = top * rating / 100
    remaining = max(0.0, 1 - top - second)
    third = remaining * 0.6
    fourth = remaining - third
    cards = [
        {'id': f'{pid}-a', 'name': 'A', 'model_probability': top},
        {'id': f'{pid}-b', 'name': 'B', 'model_probability': second},
        {'id': f'{pid}-c', 'name': 'C', 'model_probability': third},
        {'id': f'{pid}-d', 'name': 'D', 'model_probability': fourth},
    ]
    return {
        'puzzle_id': pid,
        'set_id': 'powered-cube',
        'source_draft_hash': source,
        'pick_number': pick,
        'historical_pick_id': cards[0]['id'],
        'prior_picks': [{'id': f'prior-{i}', 'name': f'Prior {i}'} for i in range(pick - 1)],
        'candidates': cards,
    }


class CubeRerollAdmissionTests(unittest.TestCase):
    def test_isolated_easy_decision_is_removed_but_supported_cluster_survives(self):
        rows = [puzzle('isolated', 's0', 20)]
        rows += [puzzle(f'neighbor-{i}', f's{i + 1}', 34) for i in range(4)]
        kept, removed = prune_cube_reroll_dead_ends(rows)
        self.assertEqual(removed, 1)
        self.assertNotIn('isolated', {p['puzzle_id'] for p in kept})
        self.assertEqual({p['puzzle_id'] for p in kept}, {f'neighbor-{i}' for i in range(4)})

    def test_two_node_component_is_removed_because_second_reroll_would_dead_end(self):
        rows = [puzzle('a', 'sa', 55), puzzle('b', 'sb', 56)]
        kept, removed = prune_cube_reroll_dead_ends(rows)
        self.assertEqual(removed, 2)
        self.assertEqual(kept, [])

    def test_non_current_cube_pick_is_not_pruned_by_current_reroll_contract(self):
        row = puzzle('historical-late', 'late', 20, pick=10)
        kept, removed = prune_cube_reroll_dead_ends([row])
        self.assertEqual(removed, 0)
        self.assertEqual(kept, [row])


if __name__ == '__main__':
    unittest.main()
