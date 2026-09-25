from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from build_replays import PickExample
from traditional_puzzles import compare, record, difference

class FixedPremierModel:
    fit_colours={}
    def card_tendency(self,card,*args):return {'A':.6,'B':.3,'C':.08,'D':.02}[card]

class TraditionalPuzzleTests(unittest.TestCase):
    def rows(self,event,chosen='A',n=110):
        return [record('set',event,str(d),PickExample(str(d),0,p,chosen,['A','B','C','D'],{'A':p} if p else {}),FixedPremierModel()) for d in range(n) for p in range(8)]

    def test_exact_trophy_is_separate_from_support_diagnostic(self):
        r=self.rows('TradDraft','B',1)[0]
        self.assertEqual(r['support_score'],48)
        self.assertEqual(r['disagreement'],1)
        self.assertEqual(r['alternative_95'],1/3)
        self.assertEqual(r['alternative_low'],2/3)
        self.assertAlmostEqual(sum(r['combined']),1)
        self.assertNotIn('score',r) # never serialize diagnostic as the actual trophy grade

    def test_format_shift_is_detected_without_training_a_traditional_model(self):
        result=compare(self.rows('PremierDraft')+self.rows('TradDraft','D'))
        self.assertFalse(result['pass'])
        for gate in ('disagreement','low_support','support_score'):
            self.assertFalse(result['gates'][gate])
        self.assertGreater(result['intervals_traditional_minus_premier']['low_support']['low'],.9)

    def test_sparse_inventory_cannot_pass(self):
        result=compare(self.rows('PremierDraft',n=10)+self.rows('TradDraft',n=10))
        self.assertFalse(result['gates']['sufficient_sources']);self.assertFalse(result['pass'])

    def test_bootstrap_clusters_whole_sources(self):
        a=self.rows('PremierDraft','A',10);b=self.rows('TradDraft','B',10)
        ci=difference(a,b,'support_score',100)
        self.assertEqual(ci,{'delta':-47,'low':-47,'high':-47})
        self.assertEqual(compare([])['pass'],False)

if __name__=='__main__':unittest.main()
