import importlib
import sys
import unittest
import csv
import json
import tempfile
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from model_training import V4_MODEL, V5_MODEL, training_cap, validate_training_manifest
from build_replays import DraftSkill, select_strong_drafts, PickExample, build_fold_training, stable_fold

class V5TrainingTests(unittest.TestCase):
    def test_every_qualified_draft_is_selected_at_all_population_sizes(self):
        for size in (12000, 29313, 2341):
            with self.subTest(size=size):
                skills = {f'qualified-{n}': DraftSkill(.7, 100) for n in range(size)}
                skills['inexperienced'] = DraftSkill(.9, 99)
                v5, _, _ = select_strong_drafts(skills, 100, .15, training_cap(V5_MODEL, None))
                v4, _, _ = select_strong_drafts(skills, 100, .15, training_cap(V4_MODEL, None))
                self.assertEqual(len(v5), size)
                self.assertEqual(len(v4), min(5000, size))
                self.assertEqual(v4, v5[:5000])
                self.assertNotIn('inexperienced', v5)
                self.assertEqual(v5, select_strong_drafts(dict(reversed(list(skills.items()))), 100, .15, None)[0])

    def test_caps_are_forbidden_in_v5(self):
        for cap in (1, 5000, 1000000, -1):
            with self.assertRaisesRegex(ValueError, 'cap is forbidden'):
                training_cap(V5_MODEL, cap)
        self.assertIsNone(training_cap(V5_MODEL, 0))

    def test_production_replay_import_legacy_and_cube_parsers_are_uncapped(self):
        paths = {
            'build_replays': ['--input','unused','--output-dir','unused','--expansion','MOM','--source-date','2026-10-02'],
            'build_path_model': ['--input','unused','--output-dir','unused','--expansion','MOM','--source-date','2026-10-02'],
            'import_sets': [], 'backfill_legacy_sets': [], 'import_powered_cube': [],
            'build_powered_cube': [], 'build_powered_cube_v3': [],
        }
        for name, required in paths.items():
            module = importlib.import_module(name)
            with self.subTest(path=name):
                self.assertEqual(module.parse_args(required+['--model-version',V5_MODEL]).max_training_drafts, 0)
                self.assertGreater(module.parse_args(required+['--model-version',V4_MODEL]).max_training_drafts, 0)
                with self.assertRaises(ValueError):
                    module.parse_args(required+['--model-version',V5_MODEL,'--max-training-drafts','5000'])

    def test_model_and_training_provenance_fail_closed(self):
        valid = {'model_version':V5_MODEL,'training_mode':'all-qualified','training_cap':None,
                 'training_drafts':12000,'qualified_training_drafts':12000}
        self.assertTrue(validate_training_manifest(valid))
        for delta in ({'model_version':V4_MODEL},{'training_drafts':5000},{'training_cap':5000},{'training_mode':'stable-hash-capped'}):
            with self.assertRaises(ValueError):
                validate_training_manifest({**valid,**delta})
        for field in ('training_cap', 'training_drafts', 'qualified_training_drafts'):
            incomplete = {key:value for key,value in valid.items() if key != field}
            with self.assertRaises(ValueError):
                validate_training_manifest(incomplete)

    def test_actual_v5_builder_trains_on_the_complete_large_population(self):
        from build_replays import build, parse_args
        for size in (12000, 29313, 2341):
            with self.subTest(size=size), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                draft, game = directory/'draft.csv', directory/'game.csv'
                with draft.open('w', newline='') as handle:
                    writer = csv.writer(handle)
                    writer.writerow(['draft_id','pack_number','pick_number','pick',
                        'user_game_win_rate_bucket','user_n_games_bucket',
                        'pack_card_A','pack_card_B','pool_A','pool_B'])
                    for number in range(size):
                        for pick in (0,1):
                            writer.writerow([f'draft-{number}',0,pick,
                                'A' if number%2 else 'B','0.70 - 0.72','100 - 499',1,1,pick,0])
                with game.open('w', newline='') as handle:
                    writer = csv.writer(handle)
                    writer.writerow(['draft_id','main_colors','deck_A','deck_B'])
                    for number in range(size):
                        writer.writerow([f'draft-{number}','U',1,1])
                args = parse_args(['--input',str(draft),'--game-data',str(game),
                    '--output-dir',str(directory/'output'),'--expansion','MOM',
                    '--source-date','2026-10-02','--minimum-picks','2',
                    '--max-output-drafts','3','--model-version',V5_MODEL])
                candidate = build(args)
                self.assertEqual(candidate['cohort']['training_drafts'],size)
                self.assertEqual(candidate['cohort']['training_picks'],size*2)
                self.assertEqual(candidate['model']['holdout'],'5-fold by draft_id')
                self.assertTrue(validate_training_manifest(candidate))
                self.assertEqual(build(args),candidate)
                if size == 2341:
                    args.model_version, args.max_training_drafts = V4_MODEL, 5000
                    historical = build(args)
                    self.assertEqual(candidate['replays'],historical['replays'])

    def test_a_source_refresh_cannot_enter_through_a_cached_checkpoint(self):
        import import_all_trophies as importer
        pin = {'source_archive':{'url':'draft','sha256':'a'*64,'etag':'old',
                'compressed_bytes':100,'last_modified':'original'},
               'skill_source':{'url':'game','sha256':'b'*64,'etag':'old',
                'compressed_bytes':100,'last_modified':'original'}}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            catalog = root/'corpus/draft-run/catalog.json'
            catalog.parent.mkdir(parents=True)
            catalog.write_text(json.dumps({'sets':[]}))
            checkpoint = root/'output/blb/manifest.json'
            checkpoint.parent.mkdir(parents=True)
            checkpoint.write_text(json.dumps({**pin,'source_archive':{
                **pin['source_archive'],'sha256':'c'*64}}))
            with patch.object(importer,'ROOT',root), \
                 patch.object(importer,'reusable_checkpoint',return_value=True) as reuse:
                with self.assertRaisesRegex(ValueError,'refusing source refresh'):
                    importer.build_set('blb',root/'output',source_pin=pin)
                reuse.assert_not_called()

    def test_all_qualified_population_preserves_five_fold_source_isolation(self):
        ids = {f'draft-{n}' for n in range(50)}
        examples = [(did,PickExample(did,0,0,'A',['A','B'],{})) for did in sorted(ids)]
        folds = build_fold_training(examples, ids, 5)
        for did in ids:
            grader = folds[stable_fold(did,5)]
            self.assertIn(did, grader.held_out_ids)
            self.assertNotIn(did, grader.training_ids)
            self.assertFalse(grader.observed_ids & grader.held_out_ids)
            self.assertEqual(grader.training_ids | grader.held_out_ids, ids)

if __name__ == '__main__':
    unittest.main()
