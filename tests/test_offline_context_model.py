import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from offline_context_model import (source_fold, candidate_features, pool_state,
                                   prepare_case, rerank, train, evaluate, metadata_view)


def card(name, cost='', typ='Creature', **extra):
    return {'id': name, 'name': name, 'mana_cost': cost, 'type_line': typ, **extra}


def puzzle(src, pk, prior, opts, chosen):
    return {'source_draft_hash': src, 'pick_number': pk, 'prior_picks': prior,
            'candidates': [dict(c, model_probability=p) for c, p in opts],
            'historical_pick_id': chosen}


class OfflineModelTests(unittest.TestCase):
    def test_unknown_layout_and_hybrid_are_not_assumed_simple(self):
        hybrid = card('Hybrid', '{W/U}')
        self.assertEqual(candidate_features(hybrid, [], {}, True)[0], 'unknown')
        self.assertEqual(candidate_features(card('Flex', '{2}{G}', display_faces=[{}]), [], {}, True)[0],
                         'unknown')
        self.assertIsNone(metadata_view(card('Green', '{G}'), {}, False))

    def test_picks_and_typed_lands_are_context_without_implicit_fetching(self):
        prior = [card('Blue', '{U}'), card('Black', '{B}'),
                 card('Tundra', '', 'Land — Plains Island')]
        state = pool_state(prior, {}, True)
        self.assertEqual(candidate_features(card('White', '{W}'), prior, {}, True, state)[0],
                         'spell:new0')
        self.assertEqual(candidate_features(card('Red', '{R}'), prior, {}, True, state)[0],
                         'spell:new1')
        self.assertEqual(candidate_features(card('Flooded Strand', '', 'Land'), prior, {}, True, state)[1][1], 0.)
        self.assertEqual(candidate_features(card('Badlands', '', 'Land — Swamp Mountain'),
                                            prior, {}, True, state)[1][1], 1.)
        self.assertEqual(candidate_features(card('Island', '', 'Basic Land — Island'),
                                            prior, {}, True, state)[1][1], 0.)
        self.assertEqual(candidate_features(card('Bayou', '', 'Land — Swamp Forest'),
                                            prior, {}, True, state)[1][1], 1.)

    def test_group_mass_fixed_for_pivot_and_lands(self):
        prior = [card('Blue', '{U}'), card('Blue Two', '{2}{U}')]
        p = puzzle('source-1', 5, prior,
                   [(card('New', '{R}'), .20), (card('New Two', '{R}'), .10),
                    (card('Blue Spell', '{1}{U}'), .40), (card('Blue Two', '{2}{U}'), .20),
                    (card('Tundra', '', 'Land — Plains Island'), .10)], 'New')
        case = prepare_case(p, {}, True)
        adjusted = rerank(case, (1.5, 0.3))
        self.assertAlmostEqual(sum(adjusted), 1.)
        for group in set(case['groups']):
            before = sum(v for v, g in zip(case['probs'], case['groups']) if g == group)
            after = sum(v for v, g in zip(adjusted, case['groups']) if g == group)
            self.assertAlmostEqual(before, after, places=12)
        self.assertAlmostEqual(sum(adjusted[i] for i, g in enumerate(case['groups'])
                                   if g == 'spell:new1'), .30)
        self.assertAlmostEqual(sum(adjusted[i] for i, g in enumerate(case['groups'])
                                   if g == 'land'), .10)

    def test_source_fold_not_changed_by_pick_or_candidate(self):
        x = puzzle('same-draft', 5, [card('U', '{U}')],
                   [(card('R', '{R}'), .5), (card('U2', '{U}'), .5)], 'R')
        a = prepare_case(x, {}, True)
        x['pick_number'] = 6
        b = prepare_case(x, {}, True)
        self.assertEqual(a['fold'], b['fold'])
        self.assertEqual(a['fold'], source_fold('same-draft'))
        self.assertRaises(ValueError, source_fold, '')

    def test_training_and_aggregate_reporting(self):
        cases = []
        for i in range(75):
            prior = [card('U', '{U}'), card('U2', '{U}'), card('R', '{R}')]
            picks = [(card('BlueOne', '{U}'), .2), (card('BlueTwo', '{1}{U}'), .4),
                     (card('RedOne', '{R}'), .2), (card('RedTwo', '{2}{R}'), .2)]
            chosen = 'BlueOne' if i % 3 != 0 else 'RedTwo'
            cases.append(prepare_case(puzzle(f'draft-{i}', 5, prior, picks, chosen), {}, True))
        weights = train(cases, iterations=30)
        self.assertEqual(len(weights), 2)
        report = evaluate(cases, weights)
        self.assertTrue(report)
        self.assertFalse(any('draft-' in repr(value) for value in report.values()))
        for stat in report.values():
            self.assertEqual(stat['max_absolute_group_mass_drift'], 0)

    def test_invalid_puzzle_fails_closed(self):
        p = puzzle('src', 5, [], [(card('A', '{R}'), .2), (card('B', '{U}'), .2)], 'A')
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            prepare_case(p, {}, True)
        p['candidates'][0]['model_probability'] = .8
        p['historical_pick_id'] = 'MISSING'
        with self.assertRaisesRegex(ValueError, 'absent'):
            prepare_case(p, {}, True)


if __name__ == '__main__':
    unittest.main()
