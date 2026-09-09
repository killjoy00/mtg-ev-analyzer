import csv
import gzip
import tempfile
import unittest
from pathlib import Path

from scripts import powered_cube_shape


class PoweredCubeShapeTests(unittest.TestCase):
    def _write_current_shape(self, path: Path, drafts: int = 150):
        fields = [
            'draft_id', 'pick', 'pack_number', 'pick_number',
            'pack_card_A', 'pack_card_B', 'pack_card_C',
            'pool_A', 'pool_B', 'pool_C',
        ]
        with gzip.open(path, 'wt', encoding='utf-8', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            for index in range(drafts):
                draft_id = f'draft-{index:04d}'
                # Current Arena shape: P1P1 is absent. Raw pick 1 is the visible
                # P1P2 row, and the P1P1 card is already in the pool.
                writer.writerow({
                    'draft_id': draft_id,
                    'pick': 'B',
                    'pack_number': 0,
                    'pick_number': 1,
                    'pack_card_A': 1,
                    'pack_card_B': 1,
                    'pack_card_C': 1,
                    'pool_A': 1,
                    'pool_B': 0,
                    'pool_C': 0,
                })
                writer.writerow({
                    'draft_id': draft_id,
                    'pick': 'C',
                    'pack_number': 0,
                    'pick_number': 2,
                    'pack_card_A': 1,
                    'pack_card_B': 0,
                    'pack_card_C': 1,
                    'pool_A': 1,
                    'pool_B': 1,
                    'pool_C': 0,
                })
                # Include a later raw pick 0 so the shared replay builder's
                # global pick offset behavior matches the real archive.
                writer.writerow({
                    'draft_id': draft_id,
                    'pick': 'A',
                    'pack_number': 1,
                    'pick_number': 0,
                    'pack_card_A': 1,
                    'pack_card_B': 1,
                    'pack_card_C': 1,
                    'pool_A': 1,
                    'pool_B': 1,
                    'pool_C': 1,
                })

    def test_current_logging_recovers_p1p1_from_pool_not_pick(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'source.csv.gz'
            self._write_current_shape(source)
            raw, inherited = powered_cube_shape.analyze_raw_archive(
                source,
                minimum_first_visible_candidates=3,
                complete_p1p1_candidates=4,
            )
            self.assertEqual(raw['first_visible_raw_pick_number'], 1)
            self.assertEqual(raw['first_visible_true_pick_number'], 2)
            self.assertTrue(raw['missing_p1p1'])
            self.assertEqual(len(inherited), 150)
            self.assertEqual(set(inherited.values()), {'A'})
            self.assertNotIn('B', inherited.values())

    def test_model_archive_preserves_first_visible_row_and_pool(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'source.csv.gz'
            destination = Path(tmp) / 'model.csv.gz'
            self._write_current_shape(source)
            raw, _ = powered_cube_shape.analyze_raw_archive(
                source,
                minimum_first_visible_candidates=3,
                complete_p1p1_candidates=4,
            )
            result = powered_cube_shape.write_model_archive(
                source,
                destination,
                raw,
                minimum_first_visible_candidates=3,
            )
            self.assertEqual(result['previsible_rows_removed'], 0)
            self.assertEqual(result['pool_context_injected'], False)
            self.assertEqual(result['first_visible_rows_retained'], 150)
            self.assertEqual(result['first_visible_rows_with_pool'], 150)

            with gzip.open(destination, 'rt', encoding='utf-8', newline='') as handle:
                rows = list(csv.DictReader(handle))
            first = rows[0]
            self.assertEqual(first['pick_number'], '1')
            self.assertEqual(first['pick'], 'B')
            self.assertEqual(first['pool_A'], '1')
            self.assertEqual(first['pool_B'], '0')


if __name__ == '__main__':
    unittest.main()
