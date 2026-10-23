import gzip
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

from import_all_trophies import digest
from prepare_new_set_p1p6_admission import PINNED, prepare


class RestrictedAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'artifact'
        (self.root / 'fra').mkdir(parents=True)
        for relative in PINNED:
            payload = json.dumps({'fixture': relative}).encode()
            (self.root / relative).write_bytes(gzip.compress(payload) if relative.endswith('.gz') else payload)
        self.pins = {relative: digest(self.root / relative) for relative in PINNED}

    def test_only_the_pinned_artifact_bytes_are_accepted(self):
        with self.assertRaisesRegex(ValueError, 'changed: admission.json'):
            prepare(self.root, Path(self.temp.name) / 'out')

    def test_wrong_set_or_unreviewed_evidence_is_refused(self):
        (self.root / 'admission.json').write_text(json.dumps({'set': 'hob'}))
        self.pins['admission.json'] = digest(self.root / 'admission.json')
        with self.assertRaisesRegex(ValueError, 'not the reviewed FRA evidence'):
            prepare(self.root, Path(self.temp.name) / 'out', pinned=self.pins)

    def test_policy_window_is_p1_to_p6(self):
        import prepare_new_set_p1p6_admission as module
        self.assertEqual((module.FIRST_PICK, module.LAST_PICK), (1, 6))
        self.assertEqual(module.EXCLUDED_PICKS, [7, 8])
        self.assertEqual(module.COMPONENT, 'traditional-premier-v5-p1p6-v1')


if __name__ == '__main__':
    unittest.main()
