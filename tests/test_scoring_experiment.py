import argparse
import contextlib
import gzip
import io
import json
import random
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from build_replays import CountStore
from deck_fit import parse_colour_mark
from eval_model import (Cache, Calibration, GradingStats, VARIANTS, VariantModel,
                        cache_identity, draft_split, fit_temperature, guard_test_split,
                        load_training_fit, paired_bootstrap, parse_args, run_awards,
                        validation_role)
from grading_curve import curve_score
from scoring_experiment import (BASELINE, MODELS, SCHEMA, band, choose_curve,
                                model_signature, outcome_report, prepare_scores,
                                profiles_for, report, resample_sources, simulate, tail_safe)


def cache_fixture(directory):
    drafts = [f'd{i}' for i in range(240)]
    picks = directory / 'cache.picks.gz'
    with gzip.open(picks, 'wt') as f:
        for i, did in enumerate(drafts):
            for pick in range(3):
                f.write(json.dumps([i, 0, pick, i % 2, [0, 1], []])+'\n')
    path = directory / 'cache.json'
    path.write_text(json.dumps(dict(cache_version=3, set_id='fixture', drafts=drafts,
        vocabulary=['a', 'b'], picks_file=picks.name, pack_offset=1, pick_offset=1)))
    return Cache.load(path)


class InputSafetyTests(unittest.TestCase):
    def test_validation_roles_are_disjoint_and_do_not_change_original_split(self):
        original = {d: draft_split(d) for d in map(str, range(5000))}
        roles = {name: {d for d, split in original.items() if split == 'validation'
                       and validation_role(d) == name} for name in ['calibration','selection','assessment']}
        self.assertTrue(all(roles.values()))
        self.assertEqual(sum(map(len, roles.values())), sum(s == 'validation' for s in original.values()))
        self.assertFalse(roles['calibration'] & roles['assessment'])
        self.assertEqual(original, {d:draft_split(d) for d in original})

    def test_all_split_also_requires_deliberate_test_access(self):
        with self.assertRaises(SystemExit):
            guard_test_split('all', False)
        guard_test_split('all', True)

    def test_fit_rejects_wrong_set_heldout_and_stale_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            cache = cache_fixture(directory)
            path = directory/'fit.json'
            valid = dict(set_id='fixture', split='train', fit_schema_version=2,
                         cache_identity=cache_identity(cache), cards={})
            path.write_text(json.dumps(valid))
            self.assertEqual(load_training_fit(path, cache), valid)
            for changes in [{'split':'test'}, {'set_id':'elsewhere'}, {'fit_schema_version':1},
                            {'cache_identity':{}}]:
                path.write_text(json.dumps(valid | changes))
                with self.assertRaises(ValueError):
                    load_training_fit(path, cache)
            path.write_text(json.dumps(valid))
            with gzip.open(directory/cache.meta['picks_file'], 'at') as f:
                f.write('\n')
            with self.assertRaises(ValueError):
                load_training_fit(path, cache)

    def test_unknown_marks_do_not_become_colourless(self):
        for mark in ['?', '', None, 'WXYZ', 'CU']:
            self.assertIsNone(parse_colour_mark(mark))
        self.assertEqual(parse_colour_mark('C'), frozenset())
        self.assertEqual(parse_colour_mark('WU'), frozenset('WU'))

    def test_stage_context_cannot_move_an_empty_pool_even_without_stage_table(self):
        fit = dict(cards={'a':dict(colours='U')}, play_rate=.8, by_commitment={'0':.2})
        model = VariantModel(CountStore.empty(), VARIANTS['v3-colour-and-pair'], fit=fit)
        self.assertEqual(model.fit_shift('a', {}), 0)

    def test_paired_bootstrap_rejects_misaligned_drafts(self):
        with self.assertRaises(ValueError):
            paired_bootstrap([('a',1,.2,1)], [('b',1,.2,1)], 10)


class CalibrationSafetyTests(unittest.TestCase):
    def test_runner_up_error_is_not_hidden_by_low_rank_cards(self):
        cal = Calibration()
        # Rank 2 claims 0.2 but is taken 0.4; many tail cards dilute pooled ECE.
        for i in range(100):
            cal.add([.5,.2] + [.03]*10, 0 if i < 60 else 1)
        summary = cal.summary()
        self.assertAlmostEqual(summary['by_candidate_rank']['2']['ece'], .2)
        self.assertLess(summary['per_card_ece'], .06)

    def test_empty_calibration_is_an_error(self):
        with self.assertRaises(ValueError):
            fit_temperature([], [1,2])

    def test_grading_rounds_half_points_like_the_game(self):
        grading = GradingStats()
        grading.add([1,.7],1)
        self.assertEqual(grading.summary()['median_displayed_score'], 67)

    def test_awards_fits_and_scores_different_drafts_and_freezes_temperature(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            cache = cache_fixture(directory)
            frozen, output = directory/'calibration.json', directory/'awards.json'
            args = parse_args(['awards',str(cache.path),'--baseline','v2',
                '--candidate','v2-no-context','--calibration-out',str(frozen),'--json-out',str(output)])
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                run_awards(args)
            fit, result = json.loads(frozen.read_text()), json.loads(output.read_text())
            expected = Counter(validation_role(d) for d in cache.split_drafts('validation'))
            self.assertEqual(fit['decisions'], expected['calibration']*3)
            self.assertEqual(result['decisions'], expected['assessment']*3)
            self.assertEqual(result['production_trophy_override_award_change'], 0)
            self.assertEqual(result['award_change']['unchanged_share'], 1)
            args = parse_args(['awards',str(cache.path),'--baseline','v2',
                '--candidate','v2-no-context','--split','test','--final-test'])
            with self.assertRaisesRegex(ValueError, 'calibration-in'):
                run_awards(args)
            args.calibration_in = str(frozen)
            args.json_out = str(output)
            # On test the only permissible loss evaluation is at a singleton,
            # already frozen temperature: no grid search can occur.
            original = fit_temperature
            def fixed_only(pairs, grid):
                self.assertEqual(len(grid), 1)
                return original(pairs, grid)
            with patch('eval_model.fit_temperature',side_effect=fixed_only), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                run_awards(args)
            self.assertEqual(json.loads(output.read_text())['evaluation_partition'], 'test')


class SimulationTests(unittest.TestCase):
    def rows(self):
        return [dict(cohort=c,set_id='powered-cube',draft_id=f'{c}-{i}',pick=2,
                     band='medium', chosen=0 if c=='elite' else 1,
                     probabilities={m:[.6,.25,.1,.05] for m in MODELS})
                for c in ['elite','control'] for i in range(20)]

    def test_eight_distinct_sources_and_paired_configuration_choices(self):
        rows = self.rows()
        prepare_scores(rows)
        profiles = [[['powered-cube',2,2,'medium']]*8]*10
        values, complete = simulate(rows, profiles)
        self.assertEqual(complete, 10)
        self.assertEqual(values['elite'][BASELINE], [95]*10)
        self.assertEqual(values['control'][BASELINE], [curve_score(.25/.6,1)]*10)
        self.assertEqual(values['elite'][BASELINE], values['elite']['v3-colour-and-pair|1'])
        # Seven available source drafts cannot manufacture an eight-pick run.
        for r in rows:
            r['draft_id'] = r['draft_id'].split('-')[0]+'-'+str(int(r['draft_id'].split('-')[1])%7)
        self.assertEqual(simulate(rows,profiles)[1], 0)

    def test_bootstrap_keeps_all_picks_from_a_sampled_draft_together(self):
        rows = [dict(cohort='elite',set_id='x',draft_id=str(d),pick=p)
                for d in range(20) for p in range(3)]
        boot = resample_sources(rows,random.Random(12))
        self.assertEqual(len(boot), len(rows))
        multiplicity = Counter((r['draft_id'],r['pick']) for r in boot)
        for d in range(20):
            self.assertEqual(len({multiplicity[(str(d),p)] for p in range(3)}),1)

    def test_policy_profiles_use_current_eight_pick_windows_and_latest_sets(self):
        rows=[]
        for sid in ['hob','msh','sos','tmt','blb','powered-cube']:
            for pick in range(1,12):
                for b in ['easy','medium','hard']:
                    for c in ['elite','control']:
                        rows.extend(dict(set_id=sid,pick=pick,band=b,cohort=c,
                            probabilities={'v2':[.5,.3,.1,.1]}) for _ in range(5))
        for env in ['mixed','powered-cube']:
            profiles=profiles_for(rows,env,20,True,'2026-09-16')
            self.assertEqual(profiles,profiles_for(rows,env,20,True,'2026-09-16'))
            for profile in profiles:
                self.assertEqual(len(profile),8)
                bands=Counter(slot[3] for slot in profile)
                self.assertEqual(bands,Counter(easy=1,medium=5,hard=2))
                if env=='mixed':
                    self.assertTrue({'hob','msh','sos'} <= {slot[0] for slot in profile})
                    self.assertEqual(profile[0][1:3],[1,1])
                    self.assertEqual(profile[-1][1:3],[8,8])
                else:
                    self.assertEqual({slot[0] for slot in profile},{'powered-cube'})
                    self.assertEqual(profile[0][1:3],[2,2])

    def test_outcome_correlation_is_stratified_within_set_and_skill(self):
        rows=[]
        for sid in ['a','b']:
            for d in range(250):
                for pick in range(4):
                    rows.append(dict(set_id=sid,draft_id=str(d),outcome={'skill':'.6','wins':d%8},
                        scores={f'{m}|{e:g}':95-(d%8) for m in MODELS for e in [.5,.75,1,1.25,1.5]}))
        # Add noise to keep Fisher correlation finite.
        for r in rows:
            r['outcome']['wins'] += int(r['draft_id'])%3
        result=outcome_report(rows)[BASELINE]
        self.assertEqual(result['drafts'],500)
        self.assertEqual(result['pooled']['strata'],2)
        self.assertGreater(result['pooled']['r'],.8)


class SelectionTests(unittest.TestCase):
    def test_noisy_gain_cannot_replace_incumbent_and_tail_guard_is_per_environment(self):
        key='v3-colour-and-pair|1'
        sim={'configurations':{BASELINE:dict(auc=.6,delta_ci95=[0,0]),
                              key:dict(auc=.61,delta_ci95=[-.001,.03])}}
        grade={BASELINE:{'set:blb':dict(n=100,below_25=.1),'set:powered-cube':dict(n=100,below_25=.1)},
               key:{'set:blb':dict(n=100,below_25=.105),'set:powered-cube':dict(n=100,below_25=.2)}}
        self.assertEqual(choose_curve(sim,grade,'mixed'),BASELINE)
        sim['configurations'][key]['delta_ci95']=[.001,.03]
        self.assertEqual(choose_curve(sim,grade,'mixed'),key)
        self.assertEqual(choose_curve(sim,grade,'powered-cube'),BASELINE)
        self.assertFalse(tail_safe(key,{BASELINE:{},key:{}},'mixed'))

    def test_development_report_refuses_final_test_or_stale_measurements(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'measure.gz'
            for data in [dict(split='test'),dict(split='validation',schema=SCHEMA,model_signature={})]:
                with gzip.open(path,'wt') as f:
                    json.dump(data,f)
                with self.assertRaises(ValueError):
                    report(argparse.Namespace(measurements=[path]))


if __name__=='__main__':
    unittest.main()
