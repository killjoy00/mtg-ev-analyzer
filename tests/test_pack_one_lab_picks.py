import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from pack_one_lab_picks import summarize, opportunity, role, MIN_DRAFTS
from rules_mana_context import card_mana_context


def card(colors=(), *, fixing=False, land=False, generic=False, rarity='common'):
    return {'land':land,'fixing':fixing,'colors':tuple(colors),'generic':generic,'rarity':rarity}


ROLES = {
    'black':card('B'), 'blue':card('U',rarity='rare'),
    'dual':card(fixing=True,land=True,rarity='uncommon'),
    'generic':card(generic=True,rarity='uncommon'),
    'black2':card('B'), 'gold':card('BU',rarity='uncommon'),
}
def pick(i, chosen, offered=None):
    return SimpleNamespace(raw_pack_number=0,raw_pick_number=i,
                           historical_pick=chosen,candidates=offered or list(ROLES))
def groups(n):
    return {f'private-test-id-{i}':[pick(j,'black' if j<2 else 'blue' if j==2 else 'dual')
                                   for j in range(8)] for i in range(n)}


class LabPicksTests(unittest.TestCase):
    def test_actual_units_and_counts_with_synthetic_data(self):
        g=groups(120)
        decks={did:{'black'} if i<90 else {'blue'} for i,did in enumerate(g)}
        result={x['id']:x for x in summarize(g,ROLES,decks)}
        self.assertEqual(set(result),{'early-fixing','color-pivot','colorless-flex','rarity-choice','first-pick-abandon'})
        first=result['first-pick-abandon']['rows'][0]
        self.assertEqual(first['qualifying_drafts'],120)
        self.assertEqual([m['numerator'] for m in first['metrics']],[90,30])
        pivot=result['color-pivot']['rows'][0]
        self.assertEqual(pivot['pick'],3)
        self.assertEqual([m['numerator'] for m in pivot['metrics']],[0,120,0])
        self.assertFalse(result['color-pivot']['rows'][1]['qualified'])
        self.assertEqual(result['early-fixing']['rows'][3]['metrics'][0]['percent'],100)
        self.assertEqual(result['rarity-choice']['rows'][2]['metrics'][1]['numerator'],120)
        self.assertNotIn('private-test-id-',str(result))

    def test_small_cohort_and_missing_metadata_are_not_findings(self):
        g=groups(MIN_DRAFTS-1)
        for report in summarize(g,ROLES,{}):
            self.assertEqual(report['status'],'skip')
            self.assertTrue(all('metrics' not in row for row in report['rows']))
        unknown={**ROLES,'blue':None}
        for report in summarize(groups(120),unknown,{}):
            self.assertEqual(report['status'],'skip')
        no_rarity={name:{**r,'rarity':None} for name,r in ROLES.items()}
        result={x['id']:x for x in summarize(groups(120),no_rarity,{})}
        self.assertEqual(result['rarity-choice']['status'],'skip')
        self.assertEqual(result['early-fixing']['status'],'candidate-evidence')

    def test_comparison_requires_both_alternatives_and_same_color_prior(self):
        self.assertEqual(opportunity('early-fixing',pick(2,'dual',['dual']),[],ROLES),(True,None))
        self.assertEqual(opportunity('color-pivot',pick(2,'blue'),['black','blue'],ROLES),(True,None))
        self.assertEqual(opportunity('color-pivot',pick(2,'blue'),['black','black2'],ROLES),(True,'new-color spell'))
        self.assertEqual(opportunity('color-pivot',pick(2,'gold'),['black','black2'],ROLES),(True,'other card'))
        self.assertEqual(opportunity('rarity-choice',pick(2,'dual',['dual','blue']),[],ROLES),(True,None))

    def test_land_and_cost_classification(self):
        self.assertEqual(role({'layout':'normal','type_line':'Land','produced_mana':['G','U']},card_mana_context)['fixing'],True)
        self.assertFalse(role({'layout':'normal','type_line':'Land','produced_mana':['G']},card_mana_context)['fixing'])
        self.assertTrue(role({'layout':'normal','type_line':'Artifact','mana_cost':'{3}'},card_mana_context)['generic'])
        self.assertFalse(role({'layout':'normal','type_line':'Creature','mana_cost':'{C}'},card_mana_context)['generic'])
        self.assertIsNone(role({'layout':'modal_dfc','type_line':'Land'},card_mana_context))
        self.assertIsNone(role({'layout':'normal','type_line':'Land'},card_mana_context))

    def test_invalid_draft_trajectory_fails(self):
        g=groups(1)
        g[next(iter(g))].pop()
        with self.assertRaisesRegex(ValueError,'lab-incomplete-trajectory'):
            summarize(g,ROLES,{})


if __name__=='__main__':
    unittest.main()
