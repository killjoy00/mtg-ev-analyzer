import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))

from corpus_promotion_provenance import ingestion_revision, verify_catalog_builder


class CorpusPromotionProvenanceTests(unittest.TestCase):
    def test_unrelated_repository_changes_do_not_change_ingestion_revision(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'relevant.py').write_text('one')
            (root / 'policy.json').write_text('{"v":1}')
            first = ingestion_revision(root, ('relevant.py', 'policy.json'))
            (root / 'unrelated.md').write_text('main advanced for an unrelated reason')
            self.assertEqual(first, ingestion_revision(root, ('relevant.py', 'policy.json')))
            (root / 'relevant.py').write_text('two')
            self.assertNotEqual(first, ingestion_revision(root, ('relevant.py', 'policy.json')))

    def catalog(self, run_id='1234', sha='a' * 40, revision='b' * 64):
        return {
            'complete': True,
            'errors': {},
            'builder': {
                'run_id': run_id,
                'sha': sha,
                'ingestion_revision': revision,
            },
        }

    def test_exact_builder_run_and_revision_are_accepted(self):
        catalog = self.catalog()
        self.assertEqual(
            verify_catalog_builder(catalog, '1234', 'a' * 40, 'b' * 64),
            catalog['builder'],
        )

    def test_stale_fallback_catalog_cannot_be_relabelled_as_new_run(self):
        with self.assertRaisesRegex(ValueError, 'referenced run'):
            verify_catalog_builder(self.catalog(run_id='1111'), '2222', 'a' * 40, 'b' * 64)

    def test_builder_sha_must_match_the_referenced_run_not_current_main(self):
        with self.assertRaisesRegex(ValueError, 'builder SHA'):
            verify_catalog_builder(self.catalog(sha='c' * 40), '1234', 'a' * 40, 'b' * 64)

    def test_mismatched_ingestion_revision_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'ingestion revision'):
            verify_catalog_builder(self.catalog(revision='c' * 64), '1234', 'a' * 40, 'b' * 64)

    def test_incomplete_or_missing_builder_artifact_is_not_promotable(self):
        missing = {'complete': True, 'errors': {}}
        with self.assertRaisesRegex(ValueError, 'no builder provenance'):
            verify_catalog_builder(missing, '1234', 'a' * 40, 'b' * 64)
        incomplete = self.catalog()
        incomplete['complete'] = False
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            verify_catalog_builder(incomplete, '1234', 'a' * 40, 'b' * 64)


if __name__ == '__main__':
    unittest.main()
