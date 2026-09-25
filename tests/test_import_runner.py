import pickle
import sys
import urllib.error
import unittest
import tempfile
from concurrent.futures import Future
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import run_import_all_trophies as runner


class ImportRunnerTests(unittest.TestCase):
    def test_budget_finishes_active_sets_but_does_not_queue_the_rest(self):
        executor = mock.Mock()
        def submit(*args):
            future = Future()
            future.set_result({'ok': True, 'result': {'id': args[1]}})
            return future
        executor.submit.side_effect = submit
        args = SimpleNamespace(workers=2, output='unused', refresh=False,
                               max_seconds=1, discard_source_archives=True)
        with mock.patch.object(runner.time, 'monotonic', side_effect=[0, 0, 2]):
            results, errors = runner.run_jobs(executor, ['a', 'b', 'c'],
                                              {'a': 'A', 'b': 'B', 'c': 'C'}, args, 0)
        self.assertEqual(sorted(r['id'] for r in results), ['a', 'b'])
        self.assertEqual(list(errors), ['c'])
        self.assertIn('Time budget', errors['c'])
        self.assertEqual(executor.submit.call_count, 2)
        self.assertTrue(all(call.args[-1] is True for call in executor.submit.call_args_list),
                        'The cleanup flag must actually reach each worker')

    def test_archive_cleanup_preserves_verified_checkpoints(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)/'ktk'
            root.mkdir()
            for name in ['draft.csv.gz', 'games.csv.gz', 'manifest.json', 'puzzles.jsonl.gz', 'trophies.jsonl.gz']:
                (root/name).write_bytes(b'checkpoint')
            with mock.patch.object(runner.importer, 'build_set', return_value={'id': 'ktk'}):
                result = runner.run_set_safely('ktk', directory, False, 'KTK', True)
            self.assertTrue(result['ok'])
            self.assertFalse((root/'draft.csv.gz').exists())
            self.assertFalse((root/'games.csv.gz').exists())
            self.assertEqual(sorted(p.name for p in root.iterdir()),
                             ['manifest.json', 'puzzles.jsonl.gz', 'trophies.jsonl.gz'])

    def test_worker_converts_unpickleable_exception_to_plain_result(self):
        exc = RuntimeError('source failed')
        exc.fp = open(__file__, 'rb')
        try:
            with self.assertRaises((TypeError, pickle.PicklingError)):
                pickle.dumps(exc)
            with mock.patch.object(runner.importer, 'build_set', side_effect=exc):
                result = runner.run_set_safely('msh', 'generated/trophy-import', False, 'MSH')
            self.assertFalse(result['ok'])
            self.assertEqual(result['error'], 'RuntimeError: source failed')
            pickle.dumps(result)
        finally:
            exc.fp.close()

    def test_transient_http_error_retries_and_closes_response(self):
        error = urllib.error.HTTPError('https://example.invalid', 429, 'rate limited', {'Retry-After': '0'}, None)
        response = object()
        with mock.patch.object(runner, '_RAW_REQUEST', side_effect=[error, response]) as request, \
             mock.patch.object(runner.time, 'sleep') as sleep:
            self.assertIs(runner.resilient_request('https://example.invalid'), response)
        self.assertEqual(request.call_count, 2)
        sleep.assert_called_once_with(1)

    def test_nontransient_http_error_remains_caller_visible(self):
        error = urllib.error.HTTPError('https://example.invalid', 404, 'missing', {}, None)
        with mock.patch.object(runner, '_RAW_REQUEST', side_effect=error):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                runner.resilient_request('https://example.invalid')
        self.assertEqual(caught.exception.code, 404)


if __name__ == '__main__':
    unittest.main()
