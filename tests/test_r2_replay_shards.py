import unittest
import json
import os
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
R2_SHARDS = ROOT / "scripts" / "r2_replay_shards.sh"


class ReplayShardPaginationTests(unittest.TestCase):
    def test_remote_verify_aggregates_paginated_object_keys(self):
        text = R2_SHARDS.read_text()
        self.assertNotIn("length(Contents[?", text)
        self.assertGreaterEqual(text.count("].Key'"), 2)
        self.assertGreaterEqual(text.count("count += NF"), 2)
        self.assertIn("Remote replay shards: $remote_count", text)


class ActiveReplayScopeTests(unittest.TestCase):
    def run_hydrate(self, active, manifests, mode='hydrate', stub=None, **overrides):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'data').mkdir()
            (root / 'data/catalog.json').write_text(json.dumps({'sets': [
                {'id': sid, 'model_version': model} for sid, model in active
            ]}))
            for sid, model in manifests.items():
                path = root / 'data' / sid
                path.mkdir()
                (path / 'manifest.json').write_text(json.dumps({'model': {'model_version': model}}))
                (path / 'shards').mkdir()
                (path / 'shards/000.json').write_text('[]')
            bin_dir = root / 'bin'
            bin_dir.mkdir()
            aws = bin_dir / 'aws'
            aws.write_text(stub or '#!/bin/sh\nprintf "%s\\n" "$*" >> "$AWS_CALL_LOG"\n')
            aws.chmod(0o755)
            log = root / 'aws.log'
            env = {**os.environ, 'PATH': str(bin_dir) + os.pathsep + os.environ['PATH'],
                   'R2_ENDPOINT': 'https://example.invalid', 'R2_BUCKET': 'fixture',
                   'AWS_ACCESS_KEY_ID': 'fixture', 'AWS_SECRET_ACCESS_KEY': 'fixture',
                   'AWS_CALL_LOG': str(log), 'REPLAY_MODEL_VERSION': '', 'REPLAY_SETS': '', **overrides}
            result = subprocess.run(['bash', str(R2_SHARDS), mode], cwd=root, env=env,
                                    capture_output=True, text=True)
            return result, log.read_text() if log.exists() else ''

    def test_sync_retries_a_transient_r2_failure(self):
        v5 = 'strong-player-colour-stage-v5'
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'failed-once'
            stub = (f'#!/bin/sh\nprintf "%s\\n" "$*" >> "$AWS_CALL_LOG"\n'
                    f'[ -e {marker} ] && exit 0\ntouch {marker}\nexit 1\n')
            result, calls = self.run_hydrate([('msh', v5)], {'msh': v5}, stub=stub, R2_SYNC_BACKOFF='0')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(calls.splitlines()), 2)
        self.assertIn('R2 sync attempt 1 failed; retrying', result.stderr)

    def test_sync_gives_up_after_bounded_attempts(self):
        v5 = 'strong-player-colour-stage-v5'
        result, calls = self.run_hydrate([('msh', v5)], {'msh': v5},
                                         stub='#!/bin/sh\nprintf "%s\\n" "$*" >> "$AWS_CALL_LOG"\nexit 1\n',
                                         R2_SYNC_BACKOFF='0', R2_SYNC_ATTEMPTS='3')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(calls.splitlines()), 3)
        self.assertIn('R2 sync failed after 3 attempts', result.stderr)

    def test_active_v5_does_not_hydrate_retired_v4_sets(self):
        v4, v5 = 'strong-player-colour-stage-v4', 'strong-player-colour-stage-v5'
        result, calls = self.run_hydrate([('msh', v5)], {'msh': v5, 'mid': v4, 'vow': v4})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(calls.splitlines()), 1)
        self.assertIn(f'replay-models/{v5}/data/msh/shards/', calls)
        self.assertNotIn('/mid/', calls)
        self.assertNotIn('/vow/', calls)

    def test_mixed_active_models_fail_before_storage_access(self):
        v4, v5 = 'strong-player-colour-stage-v4', 'strong-player-colour-stage-v5'
        result, calls = self.run_hydrate([('msh', v5), ('mid', v4)], {'msh': v5, 'mid': v4})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Expected one active replay model', result.stderr)
        self.assertEqual(calls, '')

    def test_catalog_model_mismatch_fails_before_storage_access(self):
        v4, v5 = 'strong-player-colour-stage-v4', 'strong-player-colour-stage-v5'
        result, calls = self.run_hydrate([('msh', v5)], {'msh': v4})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('catalog/manifest model mismatch', result.stderr)
        self.assertEqual(calls, '')

    def test_explicit_historical_scope_stays_addressable(self):
        v4, v5 = 'strong-player-colour-stage-v4', 'strong-player-colour-stage-v5'
        result, calls = self.run_hydrate([('msh', v5)], {'msh': v5, 'mid': v4},
                                       REPLAY_MODEL_VERSION=v4, REPLAY_SETS='mid')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f'replay-models/{v4}/data/mid/shards/', calls)
        self.assertNotIn('/msh/', calls)

    def test_default_upload_does_not_add_remote_deletion(self):
        v5 = 'strong-player-colour-stage-v5'
        for scope, deletes in [({}, False), ({'REPLAY_MODEL_VERSION': v5, 'REPLAY_SETS': 'msh'}, True)]:
            result, calls = self.run_hydrate([('msh', v5)], {'msh': v5}, mode='upload', **scope)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual('--delete' in calls, deletes)


if __name__ == "__main__":
    unittest.main()
