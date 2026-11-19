import copy
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import import_all_trophies as importer


class CheckpointTests(unittest.TestCase):
    def test_resume_without_raw_archives_requires_outputs_code_and_both_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            draft_url, game_url = importer.BASE+'/draft.csv.gz', importer.BASE+'/game.csv.gz'
            source = {'etag': 'original', 'last_modified': 'same-date',
                      'compressed_bytes': 123, 'sha256': 'a'*64}
            old = {'input_signature': 'expected',
                   'source_archive': {**source, 'url': draft_url},
                   'skill_source': {**source, 'url': game_url}}
            for key, filename in [('puzzle_file', 'puzzles.jsonl.gz'), ('ledger_file', 'trophies.jsonl.gz')]:
                (root/filename).write_bytes(b'verified')
                old[key] = filename
                old[key+'_sha256'] = hashlib.sha256(b'verified').hexdigest()
            response = mock.MagicMock()
            response.__enter__.return_value.headers = {
                'ETag': 'original', 'Last-Modified': 'same-date', 'Content-Length': '123'}
            with mock.patch.object(importer, 'request', return_value=response) as request:
                self.assertTrue(importer.reusable_checkpoint(root, old, 'expected', draft_url, game_url))
                self.assertEqual(request.call_args_list,
                                 [mock.call(draft_url, 'HEAD'), mock.call(game_url, 'HEAD')])
                self.assertFalse((root/'draft.csv.gz').exists())
                self.assertFalse((root/'games.csv.gz').exists())
                request.reset_mock()
                self.assertFalse(importer.reusable_checkpoint(root, old, 'changed-code', draft_url, game_url))
                request.assert_not_called()
                changed = copy.deepcopy(old)
                changed['skill_source']['etag'] = 'different-game-data'
                self.assertFalse(importer.reusable_checkpoint(root, changed, 'expected', draft_url, game_url))
                (root/'puzzles.jsonl.gz').write_bytes(b'corrupt')
                request.reset_mock()
                self.assertFalse(importer.reusable_checkpoint(root, old, 'expected', draft_url, game_url))
                request.assert_not_called()


if __name__ == '__main__':
    unittest.main()
