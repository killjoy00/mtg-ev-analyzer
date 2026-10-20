import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

from traditional_new_set import candidate_pin
from traditional_v4_revalidation import measure
from model_training import V5_CORPUS, V5_MODEL


class NewSetCandidateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.sid = 'fra'
        (self.root / self.sid).mkdir()
        self.pin = {
            'id': self.sid, 'corpus_version': V5_CORPUS,
            'model_version': V5_MODEL, 'source_event_type': 'PremierDraft',
            'input_signature': 'a' * 64, 'training_mode': 'all-qualified',
            'training_cap': None, 'training_drafts': 500,
            'qualified_training_drafts': 500,
        }
        base = 'https://17lands-public.s3.amazonaws.com/analysis_data'
        for kind, key in [('draft', 'source_archive'), ('game', 'skill_source')]:
            self.pin[key] = {'url': f'{base}/{kind}_data/{kind}_data_public.FRA.PremierDraft.csv.gz'}
        for name, key in [('puzzles', 'puzzle_file_sha256'), ('trophies', 'ledger_file_sha256')]:
            payload = f'fixture-{name}'.encode()
            (self.root / self.sid / f'{name}.jsonl.gz').write_bytes(payload)
            self.pin[key] = hashlib.sha256(payload).hexdigest()
        self.catalog = {
            'complete': True, 'errors': {}, 'sets': [self.pin],
            'builder': {'run_id': '12345', 'sha': 'b' * 40, 'ingestion_revision': 'c' * 64},
        }
        self.write()

    def write(self):
        (self.root / 'catalog.json').write_text(json.dumps(self.catalog))
        (self.root / self.sid / 'manifest.json').write_text(json.dumps(self.pin))

    def validate(self):
        return candidate_pin(self.root, self.sid, '12345', 'b' * 40, 'c' * 64)

    def test_exact_current_premier_artifact_is_accepted(self):
        pin, builder = self.validate()
        self.assertEqual(pin['model_version'], V5_MODEL)
        self.assertEqual(builder['run_id'], '12345')
        self.assertEqual(len(pin['_manifest_sha256']), 64)

    def test_foreign_run_and_ingestion_revision_are_rejected(self):
        for field in ['run_id', 'sha', 'ingestion_revision']:
            with self.subTest(field=field):
                old = self.catalog['builder'][field]
                self.catalog['builder'][field] = 'wrong'
                self.write()
                with self.assertRaises(ValueError):
                    self.validate()
                self.catalog['builder'][field] = old

    def test_changed_puzzle_bytes_are_rejected_before_model_reconstruction(self):
        (self.root / self.sid / 'puzzles.jsonl.gz').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.validate()

    def test_stale_catalog_or_incomplete_run_is_rejected(self):
        self.catalog['sets'] = [copy.deepcopy(self.pin)]
        self.catalog['sets'][0]['input_signature'] = 'd' * 64
        self.write()
        with self.assertRaisesRegex(ValueError, 'manifest differ'):
            self.validate()
        self.catalog['complete'] = False
        self.write()
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            self.validate()

    def test_traditional_source_cannot_be_used_as_premier_model_input(self):
        self.pin['source_archive']['url'] = self.pin['source_archive']['url'].replace('PremierDraft', 'TradDraft')
        self.write()
        with self.assertRaisesRegex(ValueError, 'source archive'):
            self.validate()

    def test_old_model_and_capped_training_are_rejected(self):
        for key, value in [('model_version', 'strong-player-colour-stage-v4'), ('training_cap', 5000), ('qualified_training_drafts', 501)]:
            with self.subTest(key=key):
                original = self.pin[key]
                self.pin[key] = value
                self.write()
                with self.assertRaises(ValueError):
                    self.validate()
                self.pin[key] = original

    def test_historical_entry_point_still_rejects_unfrozen_scope(self):
        with self.assertRaisesRegex(ValueError, 'frozen Phase 2'):
            measure('fra', self.root / 'output', self.root)

    def test_current_new_set_measurement_rejects_wrong_parent_before_download(self):
        self.pin['corpus_version'] = 'elite-trophy-colour-stage-v8'
        with self.assertRaisesRegex(ValueError, 'current v5 parent'):
            measure('fra', self.root / 'output', self.root, premier_pin=self.pin)


if __name__ == '__main__':
    unittest.main()
