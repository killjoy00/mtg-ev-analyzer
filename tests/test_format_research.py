import csv
import gzip
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from format_research import cohort, normalize, event_support, paired_interval, first_game_decks
from format_residuals import card_tags, residual_report

class FormatResearchTests(unittest.TestCase):
    def archive(self,path,event,outcomes):
        header=['expansion','event_type','draft_id','draft_time','rank','event_match_wins','event_match_losses','pack_number','pick_number','pick','pack_card_A','pack_card_B','pack_card_C','pack_card_D','pool_A','user_n_games_bucket','user_game_win_rate_bucket']
        with gzip.open(path,'wt',newline='') as f:
            writer=csv.writer(f);writer.writerow(header)
            for did,wins,losses in outcomes:
                for pick in range(8):writer.writerow(['TEST',event,did,'2026-01-01','Gold',wins,losses,0,pick,'A',1,1,1,1,pick,100,.7])

    def test_trophy_outcomes_and_first_eight_are_event_specific(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'archive.gz'
            self.archive(path,'PremierDraft',[('p0',7,0),('p1',7,1),('p2',7,2),('p3',7,3),('p6',6,0)])
            drafts,report=cohort(path,'PremierDraft')
            self.assertEqual(set(drafts),{'p0','p1','p2'});self.assertTrue(all(len(v)==8 for v in drafts.values()))
            self.assertEqual(report['trophy_outcomes'],{'7-0':1,'7-1':1,'7-2':1})
            self.archive(path,'TradDraft',[('t0',3,0),('t1',3,1),('t2',2,0)])
            drafts,report=cohort(path,'TradDraft',include_sources=True);self.assertEqual(set(drafts),{'t0'})
            self.assertEqual(set(report['sources']),{'t0'})
            self.assertEqual(report['sources']['t0']['games'],100)
            self.assertEqual(report['sources']['t0']['rate'],.7)
            with self.assertRaisesRegex(ValueError,'identity'):cohort(path,'PremierDraft')

    def test_event_weight_zero_removes_event_information(self):
        a=[.1,.4,.5];b=[.8,.1,.1]
        for x,y in zip(normalize(event_support(a,b,0)),normalize(a)):self.assertAlmostEqual(x,y)
        self.assertNotEqual(normalize(event_support(a,b,1)),normalize(a))
        self.assertAlmostEqual(sum(normalize([1e-100,.2],2.5)),1)

    def test_sideboard_games_never_enter_color_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'games.gz'
            with gzip.open(path,'wt',newline='') as f:
                w=csv.writer(f);w.writerow(['expansion','event_type','draft_id','match_number','game_number','main_colors','deck_A','deck_B'])
                w.writerow(['TEST','TradDraft','source',1,1,'WU',1,0])
                w.writerow(['TEST','TradDraft','source',1,2,'WU',0,1])
                w.writerow(['TEST','TradDraft','heldout',1,1,'BR',0,1])
            played,hits=first_game_decks(path,{'source'},'TradDraft')
            self.assertEqual(played,{'source':{'A'}});self.assertNotIn('B',hits)

    def test_paired_uncertainty_clusters_sources(self):
        records=[{'draft':str(d),'chosen':0,'a':[.9,.1],'b':[.5,.5]} for d in range(30) for _ in range(8)]
        interval=paired_interval(records,'a','b',draws=100)
        self.assertEqual(interval['drafts'],30);self.assertLess(interval['high'],0)

    def test_card_categories_are_explicit_proxies(self):
        tags=card_tags({'oracle_text':'Add one mana of any color.','type_line':'Land','colors':[]})
        self.assertIn('fixing',tags);self.assertNotIn('bomb',tags)
        self.assertIn('sideboard',card_tags({'oracle_text':'Destroy target artifact.','type_line':'Instant'}))

    def test_unknown_context_cannot_be_claimed_as_matched_evidence(self):
        r={'set':'test','card_tags':{'A':['fixing']},'tests':[{'event':'PremierDraft','draft':'d','pick':1,'cards':['A'],'chosen':0,'combined':[1],'commitments':{'A':None}}]}
        report=residual_report([r]);self.assertEqual(report['coverage']['test']['unknown_color_or_missing_metadata'],1)
        self.assertFalse(report['all_categories_have_three_sets']);self.assertEqual(report['persistent_category_patterns'],[])

if __name__=='__main__':unittest.main()
