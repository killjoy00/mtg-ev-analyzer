import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import puzzle_quality_v3 as q
from test_puzzle_quality import SCIENTIFIC
from test_puzzle_quality_v2 import example

if SCIENTIFIC:
    import numpy as np
    import puzzle_quality_model_selection as experiment


class CandidateInferenceTests(unittest.TestCase):
    def test_methods_and_frozen_blend(self):
        card={'A_gih_z':1.,'B_iwd_z':-.5,'C_adjusted_z':-1.}
        self.assertEqual(q.selected_strength(card,'gih'),1.)
        self.assertEqual(q.selected_strength(card,'iwd'),-.5)
        self.assertEqual(q.selected_strength(card,'adjusted'),-1.)
        self.assertEqual(q.selected_strength(card,'equal_blend'),0.)
        self.assertEqual(q.selected_strength(card,'adaptive_blend',.25),.5)
        for weight in (None,-.1,1.1,float('nan')):
            with self.assertRaises(ValueError):q.selected_strength(card,'adaptive_blend',weight)

    def test_missing_component_is_unknown_not_neutral(self):
        card={'A_gih_z':1.}
        self.assertIsNone(q.selected_strength(card,'equal_blend'))
        self.assertIsNone(q.selected_strength(card,'adjusted'))
        self.assertEqual(q.selected_strength(card,'adaptive_blend',0),1.)

    def test_blending_does_not_modify_frozen_strengths(self):
        p,t,protocol=example();before=copy.deepcopy(t)
        q.assess(p,t,protocol,'gih')
        q.assess(p,t,protocol,'adaptive_blend',.25)
        self.assertEqual(t,before)

    def test_winning_card_cannot_rescue_weak_target_or_lone_bomb(self):
        p,t,protocol=example()
        for r in t['cards'].values():r['A_gih_z']=-1.
        t['cards']['b']['A_gih_z']=3.
        self.assertFalse(q.assess(p,t,protocol,'gih')['eligible'])
        t['cards']['a']['A_gih_z']=3.
        for card,support in zip(p['candidates'],[.98,.01,.01]):card['model_probability']=support
        self.assertFalse(q.assess(p,t,protocol,'gih')['eligible'])

    def test_choice_counts_and_future_outcomes_cannot_affect_inference(self):
        p,t,protocol=example();before=q.assess(p,t,protocol,'gih')
        p.update(choices=[{'id':'a','n':10000}],observed_match_rate=0,final_deck=['a'],final_wins=7)
        self.assertEqual(before,q.assess(p,t,protocol,'gih'))

    def test_artifact_keeps_source_version_and_removal_guards(self):
        p,t,protocol=example()
        artifact={'version':'puzzle-quality-v3','use':'offline-research-only','strength_estimator':'gih',
                  'base_protocol':protocol,'excluded_sources':{p['set_id']:[p['source_draft_hash']]}}
        out=q.score_artifact([p],{p['set_id']:t},artifact,{p['puzzle_id']})
        self.assertIn('admin_removed',out['puzzles'][0]['reasons'])
        altered=copy.deepcopy(artifact);altered['excluded_sources']={}
        with self.assertRaises(ValueError):q.score_artifact([p],{p['set_id']:t},altered,set())
        altered=copy.deepcopy(p);altered['model_version']='unknown'
        with self.assertRaises(ValueError):q.score_artifact([altered],{p['set_id']:t},artifact,set())
        with self.assertRaises(ValueError):q.score_artifact([p,p],{p['set_id']:t},artifact,set())


@unittest.skipUnless(SCIENTIFIC,'Optional scientific experiment dependencies are absent')
class ModelSelectionTests(unittest.TestCase):
    def test_identity_mapping_survives_entirely_invalid_source_draft(self):
        frame=experiment.pd.DataFrame({'draft_id':['z','invalid','a'],
            'game_time':['2026-01-01T00:00:00Z','2026-01-02T00:00:00Z','2026-01-03T00:00:00Z'],
            'won':['True','False','False'],'deck_Mountain':[39,0,39],
            'deck_Card':[1,0,1],'opening_hand_Mountain':[3,0,3],
            'opening_hand_Card':[1,0,1],'drawn_Mountain':[0,0,0],'drawn_Card':[0,0,0]})
        rows={'draft':np.array([1,0]),'time':experiment.pd.to_datetime(frame.game_time[[0,2]],utc=True).astype('int64').to_numpy(),'y':np.array([1.,0.])}
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'source.csv.gz';frame.to_csv(path,index=False,compression='gzip')
            self.assertEqual(experiment.verified_valid_ids(path,rows).tolist(),['a','z'])
            rows['draft']=np.array([0,1])
            with self.assertRaises(ValueError):experiment.verified_valid_ids(path,rows)

    def test_budget_orders_completed_drafts_and_respects_time_cutoff(self):
        drafts=np.array([0,0,1,1,2,2]);times=np.array([1,100,2,3,4,5])
        chosen,cutoff=experiment.completed_ids(np.array([0,1,2]),drafts,times,'1')
        self.assertEqual(chosen.tolist(),[1]);self.assertEqual(cutoff,3)
        self.assertTrue((times[np.isin(drafts,chosen)]<=cutoff).all())
        with self.assertRaises(ValueError):experiment.completed_ids(np.array([0]),drafts,times,'2')

    def test_adaptive_weight_ignores_excluded_target(self):
        val={s:{'500':{'blend:0.0':{'utility':a},'blend:1.0':{'utility':c}}} for s,a,c in [('train1',.6,.1),('train2',.4,.3),('target',-999,999)]}
        first=experiment.choose_weight(val,['train1','train2'],'500',[0.,1.])
        val['target']['500']['blend:0.0']['utility']=99999
        val['target']['500']['blend:1.0']['utility']=-99999
        self.assertEqual(first,experiment.choose_weight(val,['train1','train2'],'500',[0.,1.]))
        self.assertEqual(first[0],0.)

    def test_recommendation_uses_simple_model_on_exact_tie(self):
        scores={s:{'gih':.5,'adjusted':.5} for s in ['a','b','c']}
        self.assertEqual(experiment.recommend(scores,['gih','adjusted'],['gih','adjusted'])['recommended'],'gih')
        for row in scores.values():row['adjusted']=.8
        self.assertEqual(experiment.recommend(scores,['gih','adjusted'],['gih','adjusted'])['recommended'],'adjusted')

    def test_larger_uncertainty_does_not_promote_lower_scoring_candidate(self):
        scores={'a':{'gih':.8,'adaptive_blend':.6},'b':{'gih':.1,'adaptive_blend':.6},
                'c':{'gih':.5,'adaptive_blend':.6}}
        result=experiment.recommend(scores,['gih','adaptive_blend'],['gih','adaptive_blend'])
        self.assertIn('gih',result['within_one_se'])
        self.assertEqual(result['recommended'],'adaptive_blend')

    def test_empty_slots_and_unknown_selected_pairs_are_not_dropped(self):
        p={'minimum_assessment_hand_games':100,'minimum_assessment_hand_drafts':20,'penalty_sensitivity':[0.,1.,2.]}
        rows=[{'puzzle_id':'a','pick_number':1,'eligible':True,'pair':None,'cards':[]}]
        port={'selected_puzzle_ids':['a'],'strata':[{'quota':4}]}
        r=experiment.summarize(rows,port,{},p)
        self.assertEqual(r['utility'],-.25);self.assertEqual(r['coverage'],.25)
        self.assertEqual(r['unknown'],1);self.assertEqual(r['verified_strong_fraction'],0.)

    def test_pair_requires_both_cards_to_have_independent_draft_evidence(self):
        p={'minimum_assessment_hand_games':100,'minimum_assessment_hand_drafts':20}
        row={'pair':{'target_id':'a','alternative_id':'b'},'cards':[{'id':'a','name':'A'},{'id':'b','name':'B'}]}
        evidence={n:{'gih_z':1.,'gih_games':1000,'gih_drafts':20} for n in ['A','B']}
        self.assertEqual(experiment.pair_value(row,evidence,p),1.)
        evidence['B']['gih_drafts']=19
        self.assertIsNone(experiment.pair_value(row,evidence,p))


if __name__=='__main__':unittest.main()
