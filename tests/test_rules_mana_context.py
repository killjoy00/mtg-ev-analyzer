import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from rules_mana_context import card_mana_context, candidate_pool_context


def card(cost, type_line='Creature', **extra):
    return {'mana_cost': cost, 'type_line': type_line, **extra}


class RulesManaContextTests(unittest.TestCase):
    def test_colored_artifact_requires_both_new_colors(self):
        prior = [card('{2}{B}{B}{G}'), card('{2}{U}'), card('{1}{B}'), card('{3}{B}')]
        result = candidate_pool_context(card('{2}{R}{W}', 'Artifact — Equipment'), prior)
        self.assertEqual(result['new_required_colors'], ['W', 'R'])
        self.assertEqual(result['prior_cards_requiring_color'], {'W': 0, 'U': 1, 'B': 3, 'R': 0, 'G': 1})

    def test_one_color_overlap_does_not_erase_second_requirement(self):
        result = candidate_pool_context(card('{1}{B}{R}'), [card('{B}')] * 4)
        self.assertEqual(result['new_required_colors'], ['R'])
        self.assertEqual(result['required_color_overlap'], {'B': 4, 'R': 0})

    def test_landcycling_is_a_separate_generic_mode(self):
        c = card_mana_context(card('{4}{G}{G}', oracle_text='Reach\nBasic landcycling {2} ({2}, Discard this card: Search.)'))
        self.assertEqual(c['cast']['colored_pips'], {'G': 2})
        self.assertEqual(c['basic_landcycling']['activation_cost']['colors'], [])
        self.assertEqual(c['basic_landcycling']['activation_cost']['generic_mana'], 2)

    def test_dual_land_records_which_colors_it_produces(self):
        c = card_mana_context(card('', 'Land', produced_mana=['B', 'G']))
        self.assertIsNone(c['cast'])
        self.assertEqual(c['produced_mana'], ['B', 'G'])

    def test_missing_or_complex_metadata_never_means_colorless(self):
        for c in [None, {}, card(''), card('{WU}'), card('{W/U}'), card('{W/P}'), card('{2/W}'),
                  card('{G}', layout='adventure'), card('{B}', card_faces=[{}])]:
            with self.subTest(c=c):
                self.assertEqual(card_mana_context(c)['status'], 'unknown')

    def test_explicit_zero_and_colorless_mana_remain_distinct(self):
        self.assertEqual(card_mana_context(card('{0}'))['cast']['colorless_pips'], 0)
        self.assertEqual(card_mana_context(card('{2}{C}'))['cast']['colorless_pips'], 1)

    def test_missing_rules_do_not_assert_no_fixing(self):
        c = card_mana_context(card('{G}'))
        self.assertFalse(c['rules_text_available'])
        self.assertIsNone(c['produced_mana'])


if __name__ == '__main__':
    unittest.main()
