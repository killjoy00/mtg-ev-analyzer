import dataclasses
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import tempfile
import csv
import gzip

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from decision_context import PickState, card_features, feature_blocks
from decision_context_audit import build,load_public


class Features(unittest.TestCase):
    def test_no_outcome_or_choice_in_state_contract(self):
        names={f.name for f in dataclasses.fields(PickState)}
        self.assertEqual(names,{'set_id','pick','candidates','pool'})
        with self.assertRaises(TypeError):PickState('x',1,('A',),(),event_match_wins=7)

    def test_pool_must_be_real_prefix(self):
        with self.assertRaises(ValueError):PickState('x',4,('A',),(('B',2),))
        with self.assertRaises(ValueError):PickState('x',1,('A','A'),())
        with self.assertRaises(ValueError):PickState('x',3,('A',),(('B',1),('B',1)))

    def test_missing_and_complex_cost_is_not_vanilla_zero_drop(self):
        self.assertEqual(card_features(None)['cost_missing'],1)
        self.assertEqual(card_features(None)['cheap_creature'],0)
        complex_card={'name':'A // B','mana_cost':'{1}{G} // {2}{G}','type_line':'Creature // Sorcery'}
        self.assertEqual(card_features(complex_card)['cheap_creature'],0)
        self.assertEqual(card_features(complex_card)['complex_card'],1)

    def test_hybrid_phyrexian_and_variable_cost(self):
        f=card_features({'mana_cost':'{X}{2/W}{U/P}','type_line':'Creature — Human'})
        self.assertEqual(f['mana_value'],3)
        self.assertEqual(f['color_W'],1);self.assertEqual(f['color_U'],1)
        self.assertEqual(f['variable_cost'],1)

    def test_explicit_redundancy_and_synergy(self):
        meta={'A':{'mana_cost':'{1}{B}','type_line':'Creature — Rat','oracle_text':'Whenever you sacrifice a creature, draw a card.'},
              'B':{'mana_cost':'{2}{B}','type_line':'Creature — Rat','oracle_text':'Create a 1/1 Rat creature token.'}}
        state=PickState('x',4,('A',),(('B',3),))
        b,p,c=feature_blocks(state,'A',meta)
        self.assertEqual(c['tribal_matches'],1)
        self.assertEqual(c['sacrifice_payoff_proxy_with_enablers'],1)
        self.assertEqual(c['color_overlap'],1)
        self.assertFalse(any('selected' in k or 'wins' in k for block in (b,p,c) for k in block))

    def test_no_implicit_future_or_player_metadata(self):
        s=PickState('x',1,('A',),())
        plain={'A':{'mana_cost':'{1}{G}','type_line':'Creature'}}
        contaminated={'A':{**plain['A'],'event_match_wins':7,'model_probability':.99,'final_deck':True}}
        self.assertEqual(feature_blocks(s,'A',plain),feature_blocks(s,'A',contaminated))
        with self.assertRaises(ValueError):feature_blocks(s,'B',plain)

    def test_diagnostic_is_repeatable_blind_and_source_distinct(self):
        p,m,_=load_public();a,k,s=build(p,m)
        self.assertEqual((a,k,s),build(list(reversed(p)),m))
        self.assertEqual(len(a),240)
        self.assertEqual(len({(x['set'],x['source_draft_hash']) for x in k}),240)
        text=json.dumps(a)
        for forbidden in ('historical_pick','model_probability','source_draft_hash','stratum','v5_support','event_match_wins'):
            self.assertNotIn(forbidden,text)
        self.assertEqual(s['strata']['representative']['count'],120)


@unittest.skipUnless(importlib.util.find_spec('sklearn'), 'numeric experiment dependencies unavailable')
class Experiment(unittest.TestCase):
    def test_inconsistent_draft_is_quarantined_and_pool_verified(self):
        import decision_context_experiment as exp
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'test-draft.csv.gz'
            names=['draft_id','draft_time','expansion','event_type','pack_number','pick_number','pick',
                   'event_match_wins','event_match_losses','pack_card_A','pool_A']
            with gzip.open(path,'wt') as f:
                writer=csv.DictWriter(f,fieldnames=names);writer.writeheader()
                for did in ('good','inconsistent','bad-pool'):
                    for pick in range(4):
                        writer.writerow(dict(zip(names,[did,'2024-01-01','TEST','PremierDraft',0,pick,'A',
                            2 if did=='inconsistent' and pick==2 else 1,3,1,
                            0 if did=='bad-pool' else pick])))
            with patch.object(exp,'RAW',Path(tmp)),patch.object(exp,'hashed',return_value=0):
                rows,audit=exp.collect_decisions('test')
            self.assertEqual([r['id'] for r in rows],['good'])
            self.assertEqual(audit['exclusions']['inconsistent_source_draft'],1)
            self.assertEqual(audit['exclusions']['pool_prefix_mismatch'],1)

    def test_duplicate_games_fail_and_real_counts_preserved(self):
        import decision_context_experiment as exp
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'test-game.csv.gz'
            names=['draft_id','game_time','won','match_number','game_number','deck_A','opening_hand_A']
            def save(duplicate):
                with gzip.open(path,'wt') as f:
                    writer=csv.writer(f);writer.writerow(names)
                    writer.writerow(['d','2024-01-01','True',1,1,1,1])
                    if duplicate:writer.writerow(['d','2024-01-01','True',1,1,1,1])
            save(False)
            with patch.object(exp,'RAW',Path(tmp)):
                g=exp.collect_games('test',{'d'})
                self.assertEqual(g['d']['cards']['A'],[1,1])
                save(True)
                with self.assertRaises(ValueError):exp.collect_games('test',{'d'})

    def test_strength_complement_has_no_held_out_outcome(self):
        from decision_context_experiment import strengths
        games={'fit':{'wins':5,'games':8,'cards':{'A':[3,4]}},
               'held':{'wins':7,'games':7,'cards':{'A':[7,7]}}}
        first=strengths(games,{'fit'})
        games['held']={'wins':0,'games':3,'cards':{'A':[0,3]}}
        self.assertEqual(first,strengths(games,{'fit'}))
        self.assertEqual(first[0]['A'][1],4)

    def test_chronological_boundaries_and_incomplete_history(self):
        from decision_context_experiment import chronology
        import pandas as pd
        rows=[];games={}
        for i in range(1000):
            start=pd.Timestamp('2024-01-01')+pd.Timedelta(hours=i)
            rows.append({'id':str(i),'time':start.isoformat(),'wins':4,'losses':3})
            games[str(i)]={'last':(start+pd.Timedelta(minutes=10)).isoformat(),'wins':4,'games':7}
        games['599']['last']=rows[601]['time']
        groups,audit=chronology(rows,games)
        self.assertEqual(audit['purged_boundary_crossers'],1)
        self.assertNotIn('599',{r['id'] for r in groups['fit']})
        games['10']['games']=6
        groups,audit=chronology(rows,games)
        self.assertEqual(audit['incomplete_game_history'],1)
        all_ids=[r['id'] for rs in groups.values() for r in rs]
        self.assertEqual(len(all_ids),len(set(all_ids)))

    def test_interaction_signal_is_detectable_on_synthetic_held_data(self):
        import numpy as np
        from decision_context_experiment import fit_predict,paired_summary
        rng=np.random.default_rng(42)
        def sample(n):
            a=rng.integers(0,2,n);p=rng.integers(0,2,n)
            x=[({'card':int(c)},{'pool':int(d)},{'interaction':int(c*d)}) for c,d in zip(a,p)]
            y=2+3*a*p+rng.normal(0,.1,n)
            return x,y
        x,y=sample(500);z,t=sample(200)
        pred=fit_predict(x,y,z)
        report=paired_summary(t,pred,['a']*200,[4]*200,draws=100)
        self.assertLess(report['contrasts']['C_minus_P']['ci95'][1],0)
        # Fitting accepts no held labels: changing them cannot alter predictions.
        again=fit_predict(x,y,z)
        np.testing.assert_array_equal(pred['C'],again['C'])


if __name__=='__main__':unittest.main()
