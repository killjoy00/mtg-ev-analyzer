import pickle
import sys
import urllib.error
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import run_import_all_trophies as runner


class ImportRunnerTests(unittest.TestCase):
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

    def test_nontransient_http_error_becomes_plain_runtime_error(self):
        error = urllib.error.HTTPError('https://example.invalid', 404, 'missing', {}, None)
        with mock.patch.object(runner, '_RAW_REQUEST', side_effect=error):
            with self.assertRaisesRegex(RuntimeError, 'HTTP 404'):
                runner.resilient_request('https://example.invalid')


if __name__ == '__main__':
    unittest.main()
