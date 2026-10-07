import hashlib
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('android_toolchain', Path(__file__).resolve().parents[1] / 'scripts/prepare-android-toolchain.py')
toolchain = importlib.util.module_from_spec(spec)
spec.loader.exec_module(toolchain)


class AndroidToolchainTests(unittest.TestCase):
    def package(self, folder):
        archive = Path(folder) / 'valid.zip'
        with zipfile.ZipFile(archive, 'w') as package:
            package.writestr('android-ndk-r27b/source.properties', 'Pkg.Revision = 27.1.12297006\n')
        return archive, {'directory': 'android-ndk-r27b', 'size': archive.stat().st_size,
                         'sha1': hashlib.sha1(archive.read_bytes()).hexdigest(), 'url': 'https://fixture.invalid/ndk.zip'}

    def test_wrong_size_and_checksum_are_refused_before_extraction(self):
        with tempfile.TemporaryDirectory() as folder:
            archive, pin = self.package(folder)
            toolchain.verify_archive(archive, pin)
            archive.write_bytes(b'<html>temporary upstream failure</html>')
            with self.assertRaisesRegex(ValueError, 'size mismatch'):
                toolchain.verify_archive(archive, pin)
            archive.write_bytes(b'x' * pin['size'])
            with self.assertRaisesRegex(ValueError, 'checksum'):
                toolchain.verify_archive(archive, pin)

    def test_download_retries_corruption_once_then_accepts_verified_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            valid, pin = self.package(folder)
            target = Path(folder) / 'download.zip'
            calls, records = [], []
            def download(args, **kwargs):
                calls.append(args)
                target.write_bytes(b'not a zip' if len(calls) == 1 else valid.read_bytes())
                return subprocess.CompletedProcess(args, 0, 'NDK download HTTP 200', '')
            toolchain.download_ndk(target, pin, records, run=download, sleep=lambda _: None)
            self.assertEqual(len(calls), 2)
            self.assertIn('size mismatch', records[0]['error'])
            self.assertTrue(records[1]['verified'])

    def test_persistent_corruption_has_exactly_two_attempts(self):
        with tempfile.TemporaryDirectory() as folder:
            _, pin = self.package(folder)
            target, records = Path(folder) / 'download.zip', []
            def download(args, **kwargs):
                target.write_bytes(b'broken')
                return subprocess.CompletedProcess(args, 0, 'HTTP 200', '')
            with self.assertRaisesRegex(RuntimeError, 'two bounded attempts'):
                toolchain.download_ndk(target, pin, records, run=download, sleep=lambda _: None)
            self.assertEqual(len(records), 2)

    def test_permanent_http_failure_does_not_retry(self):
        with tempfile.TemporaryDirectory() as folder:
            _, pin = self.package(folder)
            records = []
            with self.assertRaises(RuntimeError):
                toolchain.download_ndk(Path(folder) / 'download.zip', pin, records,
                    run=lambda *args, **kwargs: subprocess.CompletedProcess([], 22, 'HTTP 403', ''), sleep=lambda _: None)
            self.assertEqual(len(records), 1)

    def test_version_drift_is_not_silently_overridden(self):
        config = {'ndk': {'version': '27.1.12297006'}, 'compile_sdk': '36', 'build_tools': '36.0.0'}
        catalog = 'ndkVersion = "27.1.12297006"\ncompileSdk = "36"\nbuildTools = "36.0.0"\n'
        toolchain.validate_versions(config, catalog)
        with self.assertRaisesRegex(ValueError, 'Review Android toolchain pins'):
            toolchain.validate_versions(config, catalog.replace('27.1.12297006', '28.0.0'))

    def test_sdk_failure_is_not_treated_as_success_or_retried_for_license_errors(self):
        with tempfile.TemporaryDirectory() as folder:
            calls = []
            def install(*args, **kwargs):
                calls.append(args)
                return subprocess.CompletedProcess([], 1, '', 'License not accepted')
            with self.assertRaisesRegex(RuntimeError, 'SDK dependency preparation failed'):
                toolchain.ensure_sdk_package(Path(folder), 'cmake;3.22.1', ['cmake/3.22.1/bin/cmake'], run=install)
            self.assertEqual(len(calls), 1)

    def test_a_partial_ndk_is_not_a_cache_hit(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder)
            (target / 'source.properties').write_text('Pkg.Revision = 27.1.12297006\n')
            self.assertFalse(toolchain.valid_ndk(target, '27.1.12297006'))


if __name__ == '__main__':
    unittest.main()
