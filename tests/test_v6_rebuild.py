"""v6 rebuild plan, Traditional window admission and QA; no archive data."""
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'scripts'))
import v6_rebuild as rebuild
import v6_traditional as traditional
from model_training import V5_MODEL, V6_MODEL, VERSIONS
from v5_rebuild_qa import compare


class PlanTests(unittest.TestCase):
    def test_every_production_v9_environment_rebuilds_from_its_exact_inputs(self):
        pins = rebuild.pins()
        plan = json.loads(rebuild.PINS.read_text())
        self.assertEqual((plan['baseline_corpus'], plan['baseline_model']), (VERSIONS['v5']['corpus_version'], V5_MODEL))
        catalog = {s['id'] for s in json.loads((ROOT/'data/catalog.json').read_text())['sets']}
        self.assertEqual({sid for sid, p in pins.items() if p['replay']}, catalog)
        self.assertEqual(sorted(set(pins) - catalog), ['fra'])
        for sid, pin in pins.items():
            with self.subTest(sid=sid):
                self.assertEqual((pin['training_mode'], pin['training_cap']), ('all-qualified', None))
                self.assertEqual(pin['training_drafts'], pin['qualified_training_drafts'])
                for key in ('source_archive', 'skill_source'):
                    self.assertRegex(pin[key]['sha256'], '^[a-f0-9]{64}$')

    def test_every_measured_traditional_source_is_pinned_inside_the_plan(self):
        pins = rebuild.pins()
        sources = json.loads(rebuild.TRADITIONAL_PINS.read_text())['sets']
        self.assertEqual(len(sources), 28)
        by_id = {s['set_id']: s for s in sources}
        self.assertTrue(set(by_id) <= set(pins))
        # Previously blocked sets are rescored too; HOB alone is measured fresh.
        self.assertTrue({'hbg', 'ktk', 'pio', 'hob'} <= set(by_id))
        self.assertEqual([s for s, p in by_id.items() if p['origin'] == 'fresh'], ['hob'])
        self.assertEqual(by_id['fra']['origin'], 'new-set-v5')
        for sid, source in by_id.items():
            with self.subTest(sid=sid):
                self.assertRegex(source['source_archive']['sha256'], '^[a-f0-9]{64}$')
                expansion = 'Cube_-_Powered' if sid == 'powered-cube' else sid.upper()
                self.assertTrue(source['source_archive']['url'].endswith(f'.{expansion}.TradDraft.csv.gz'))
                if source['origin'] != 'fresh':
                    self.assertRegex(source['artifact']['puzzle_file_sha256'], '^[a-f0-9]{64}$')
                    self.assertTrue(source['artifact_name'] and source['run_id'])


class WindowTests(unittest.TestCase):
    def records(self, picks):
        return [{'pick': pick, 'raw': [.5, .3, .2]} for pick in picks]

    def puzzles(self, picks):
        return [{'pick_number': pick} for pick in picks]

    def gates(self, failing_from):
        def fake(rows):
            ok = all(r['pick'] < failing_from for r in rows)
            return {'pass': ok, 'gates': {'calibration': ok}}
        return fake

    def test_each_set_is_scored_once_on_its_approved_window(self):
        self.assertEqual([traditional.approved_window(s) for s in ('blb', 'ktk', 'hob', 'fra', 'powered-cube')],
                         ['phase2', 'phase2', 'phase2', 'p1p6', 'cube-p2p7'])
        with patch.object(traditional, 'compare', side_effect=self.gates(99)):
            windows, admitted = traditional.admit('blb', self.records(range(1, 9)), self.puzzles(range(1, 9)), 1)
        self.assertEqual((list(windows), admitted), (['phase2'], 'phase2'))

    def test_a_failing_window_has_no_fallback(self):
        # Late picks fail: a regular set is not admitted, never narrowed to P1-P6.
        with patch.object(traditional, 'compare', side_effect=self.gates(7)):
            windows, admitted = traditional.admit('ktk', self.records(range(1, 9)), self.puzzles(range(1, 9)), 1)
        self.assertIsNone(admitted)
        self.assertEqual(list(windows), ['phase2'])
        self.assertEqual(windows['phase2']['failure_reasons'], ['all_picks.calibration', 'serving_picks.calibration',
                                                                'late_picks.calibration', 'serving_late_picks.calibration'])
        # FRA and Cube are scored only on their approved restricted windows.
        with patch.object(traditional, 'compare', side_effect=self.gates(7)):
            self.assertEqual(traditional.admit('fra', self.records(range(1, 9)), self.puzzles(range(1, 9)), 1)[1], 'p1p6')
        with patch.object(traditional, 'compare', side_effect=self.gates(8)):
            self.assertEqual(traditional.admit('powered-cube', self.records(range(2, 10)), self.puzzles(range(2, 10)), 1,
                                               {'pass': True})[1], 'cube-p2p7')
        with patch.object(traditional, 'compare', side_effect=self.gates(99)):
            _, cube = traditional.admit('powered-cube', self.records(range(2, 10)), self.puzzles(range(2, 10)), 1,
                                        {'pass': False})
        self.assertIsNone(cube)
        self.assertNotIn('cube-p2p9', traditional.WINDOWS)

    def test_quality_counts_only_puzzles_inside_the_window(self):
        with patch.object(traditional, 'compare', side_effect=self.gates(99)):
            result = traditional.evaluate('p1p6', self.records(range(1, 9)), self.puzzles([1, 2, 3, 4, 5, 6, 7, 8]), 2)
        self.assertEqual(result['quality']['usable_traditional_puzzles'], 6)
        self.assertAlmostEqual(result['quality']['unusable_fraction'], .5)


class QATests(unittest.TestCase):
    def test_v6_qa_requires_v6_support_on_every_candidate_decision(self):
        def puzzle(a, b, model):
            return {'model_version': model, 'source_draft_hash': 'a'*32, 'pick_number': 1,
                    'historical_pick_id': 'A', 'prior_picks': [],
                    'candidates': [{'id': 'A', 'model_probability': a}, {'id': 'B', 'model_probability': b}]}
        result = compare([puzzle(.8, .2, V5_MODEL)], [puzzle(.4, .6, V6_MODEL)], V6_MODEL)
        self.assertEqual(result['matched_decisions'], 1)
        with self.assertRaisesRegex(ValueError, 'Invalid or mixed'):
            compare([], [puzzle(.4, .6, V5_MODEL)], V6_MODEL)


if __name__ == '__main__':
    unittest.main()
