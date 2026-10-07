"""Prepare and verify CI dependencies before invoking the Android app build."""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

MOBILE = Path(__file__).resolve().parents[1]
CONFIG = MOBILE / 'android-toolchain.json'
REPORT = MOBILE.parent / 'artifacts/native-build/toolchain.json'


def validate_versions(config, catalog):
    expected = {'ndkVersion': config['ndk']['version'], 'compileSdk': config['compile_sdk'],
                'buildTools': config['build_tools']}
    for key, value in expected.items():
        match = re.search(r'^' + key + r'\s*=\s*"([^"]+)"', catalog, re.M)
        if not match or match[1] != value:
            raise ValueError(f'Review Android toolchain pins: React Native {key} differs from {value}')


def verify_archive(archive, pin):
    size = archive.stat().st_size
    if size != pin['size']:
        raise ValueError(f'NDK archive size mismatch: expected {pin["size"]}, received {size}')
    digest = hashlib.sha1()
    with archive.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    if digest.hexdigest() != pin['sha1']:
        raise ValueError('NDK archive checksum does not match the Android release')
    with zipfile.ZipFile(archive) as package:
        bad = package.testzip()
        if bad:
            raise ValueError('NDK archive has corrupt entry: ' + bad)
        for entry in package.infolist():
            parts = Path(entry.filename).parts
            if not parts or parts[0] != pin['directory'] or '..' in parts:
                raise ValueError('Unexpected path in NDK archive')


def valid_ndk(target, version, run=subprocess.run):
    try:
        properties = (target / 'source.properties').read_text()
        if not re.search(r'^Pkg.Revision\s*=\s*' + re.escape(version) + r'\s*$', properties, re.M):
            return False
        compiler = target / 'toolchains/llvm/prebuilt/linux-x86_64/bin/clang'
        result = run([str(compiler), '--version'], capture_output=True, text=True, timeout=20)
        return result.returncode == 0 and 'clang version' in result.stdout
    except (OSError, subprocess.TimeoutExpired):
        return False


def download_ndk(archive, pin, records, run=subprocess.run, sleep=time.sleep):
    # Retry only fetching/validating dependency bytes. Never retry the app build.
    for attempt in range(1, 3):
        archive.unlink(missing_ok=True)
        result = run(['curl', '--fail', '--location', '--connect-timeout', '15', '--max-time', '180',
                      '--speed-time', '30', '--speed-limit', '10240', '--output', str(archive),
                      '--write-out', '\nNDK download HTTP %{http_code}; received %{size_download} bytes\n', pin['url']],
                     capture_output=True, text=True, timeout=200)
        print(result.stdout, flush=True)
        record = {'attempt': attempt, 'curl_exit': result.returncode,
                  'received_bytes': archive.stat().st_size if archive.exists() else 0}
        records.append(record)
        try:
            if result.returncode:
                raise ValueError('NDK download failed: ' + result.stderr[-500:])
            verify_archive(archive, pin)
            record['verified'] = True
            return
        except (ValueError, zipfile.BadZipFile) as error:
            record['error'] = str(error)
            # Permanent HTTP/credential errors are not made green by retries.
            if result.returncode == 22 and not re.search(r'\b(?:429|500|502|503|504)\b', result.stdout + result.stderr):
                raise RuntimeError(str(error)) from error
            if attempt == 2:
                raise RuntimeError('NDK dependency preparation failed after two bounded attempts: ' + str(error)) from error
            print('Retrying NDK dependency download after failed integrity/network check.', flush=True)
            sleep(2)


def ensure_sdk_package(sdk, name, required, run=subprocess.run):
    if all((sdk / path).is_file() for path in required):
        return
    manager = sdk / 'cmdline-tools/latest/bin/sdkmanager'
    for attempt in range(1, 3):
        result = run([str(manager), '--sdk_root=' + str(sdk), '--install', name],
                     input='y\n' * 20, capture_output=True, text=True, timeout=180)
        output = result.stdout + result.stderr
        print(output[-4000:], flush=True)
        if result.returncode == 0 and all((sdk / path).is_file() for path in required):
            return
        transient = re.search(r'(?i)zip|archive|timed? ?out|failed to download|\b(?:429|500|502|503|504)\b', output)
        if not transient or attempt == 2:
            raise RuntimeError('SDK dependency preparation failed: ' + name)
        print('Retrying SDK dependency preparation: ' + name, flush=True)


def main():
    config = json.loads(CONFIG.read_text())
    validate_versions(config, (MOBILE / 'node_modules/react-native/gradle/libs.versions.toml').read_text())
    if platform.system() != 'Linux' or platform.machine() != 'x86_64':
        raise RuntimeError('The reviewed Android toolchain archive requires Linux x86_64')
    sdk_value = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
    if not sdk_value or not (Path(sdk_value) / 'cmdline-tools').is_dir():
        raise RuntimeError('An existing Android SDK with command-line tools is required')
    sdk = Path(sdk_value).resolve()
    pin = config['ndk']
    if '--outputs' in sys.argv:
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write(f'sdk_root={sdk}\nndk_version={pin["version"]}\n')
            output.write('cache_key=pack1-android-sdk-v1-' + hashlib.sha256(CONFIG.read_bytes()).hexdigest() + '\n')
        return
    report = {'phase': 'toolchain', 'ndk_version': pin['version'], 'archive_source': pin['source'],
              'expected_bytes': pin['size'], 'expected_sha1': pin['sha1'], 'downloads': [], 'status': 'failed'}
    try:
        target = sdk / 'ndk' / pin['version']
        if valid_ndk(target, pin['version']):
            report['ndk_reused'] = True
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix='pack1-ndk-', dir=target.parent) as folder:
                archive = Path(folder) / 'ndk.zip'
                download_ndk(archive, pin, report['downloads'])
                subprocess.run(['unzip', '-q', str(archive), '-d', folder], check=True, timeout=180)
                extracted = Path(folder) / pin['directory']
                if not valid_ndk(extracted, pin['version']):
                    raise RuntimeError('Verified NDK archive did not provide a working compiler')
                # Replace only this pinned SDK package, never the whole SDK/cache.
                if target.exists():
                    shutil.rmtree(target)
                extracted.rename(target)
            report['ndk_reused'] = False
        ensure_sdk_package(sdk, 'platforms;android-' + config['compile_sdk'],
                           ['platforms/android-' + config['compile_sdk'] + '/android.jar'])
        ensure_sdk_package(sdk, 'build-tools;' + config['build_tools'],
                           ['build-tools/' + config['build_tools'] + '/aapt2'])
        ensure_sdk_package(sdk, 'cmake;' + config['cmake'], ['cmake/' + config['cmake'] + '/bin/cmake'])
        subprocess.run([str(sdk / 'cmake' / config['cmake'] / 'bin/cmake'), '--version'], check=True, timeout=20)
        report['status'] = 'passed'
        print('Android SDK and exact NDK compiler verified before app build.', flush=True)
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        REPORT.parent.mkdir(parents=True, exist_ok=True)
        REPORT.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
