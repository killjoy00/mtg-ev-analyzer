"""Android 15/16 preview-only Google demo-banner and safe-area acceptance.

Uses an unsigned preview APK with Google's sample app/banner IDs, never
production ad IDs or Pack One production API traffic. Results are evidence for
the native SDK's Android behavior, not proof of live AdMob account fill.
"""
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

PACKAGE = 'pro.packone.preview'
out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
manifest = {'source_sha': os.environ.get('ACCEPTANCE_SOURCE_SHA', os.environ.get('GITHUB_SHA')),
            'test': 'preview Google sample banner and Android native insets',
            'production_app': False, 'live_ad_units': False,
            'physical_device': False, 'events': []}


def command(*args, check=True, timeout=90):
    proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if check and proc.returncode:
        raise RuntimeError(f'{args!r}: {proc.stderr or proc.stdout}')
    return proc.stdout.strip()


def adb(*args, **kwargs):
    return command('adb', *args, **kwargs)


def require(value, message):
    if not value:
        raise AssertionError(message)


def bounds_of(root, label):
    for node in root.iter():
        if label not in (node.attrib.get('text'), node.attrib.get('content-desc')):
            continue
        bounds = [int(x) for x in re.findall(r'-?\d+', node.attrib.get('bounds', ''))]
        if len(bounds) == 4 and bounds[0] < bounds[2] and bounds[1] < bounds[3]:
            return bounds
    return None


def read_events(logs):
    events = []
    for line in logs.splitlines():
        if 'PACKONE_ANDROID_AD_TEST' not in line:
            continue
        raw = line.split('PACKONE_ANDROID_AD_TEST', 1)[1]
        start, end = raw.find('{'), raw.rfind('}')
        if start < 0 or end < start:
            continue
        try:
            entry = json.loads(raw[start:end + 1])
        except json.JSONDecodeError:
            continue
        if isinstance(entry, dict) and 'stage' in entry:
            events.append(entry)
    return events


try:
    api_level = int(adb('shell', 'getprop', 'ro.build.version.sdk'))
    expected_api = int(os.environ.get('PACKONE_ANDROID_EXPECTED_API_LEVEL', str(api_level)))
    require(api_level == expected_api, f'Expected API {expected_api}; running {api_level}')
    expected_mode = os.environ.get('PACKONE_ANDROID_NAVIGATION_MODE', 'gesture')
    require(expected_mode in ('gesture', 'threebutton'), 'Unknown navigation mode')
    expected_overlay = 'com.android.internal.systemui.navbar.' + ('gestural' if expected_mode == 'gesture' else 'threebutton')
    overlays = adb('shell', 'cmd', 'overlay', 'list', 'android')
    require(('[x] ' + expected_overlay) in overlays,
            f'System navigation overlay {expected_overlay} was not active')
    manifest.update({'android_api_level': api_level, 'navigation_mode': expected_mode,
                     'navigation_overlay': expected_overlay, 'device': adb('shell', 'getprop', 'ro.product.model')})

    adb('shell', 'wm', 'size', '1080x1920')
    adb('shell', 'wm', 'density', '420')
    adb('shell', 'settings', 'put', 'system', 'font_scale', '1.5')
    adb('logcat', '-c')
    adb('shell', 'am', 'force-stop', PACKAGE)
    # Protect deep-link URI from Android's remote shell parsing.
    adb('shell', "am start -W -a android.intent.action.VIEW -d 'packone://android-admob-acceptance' -p '" + PACKAGE + "'")
    # Google UMP and test-ad responses depend on network access. Collect actual
    # SDK events rather than treating a mere APK launch as a successful ad test.
    events = []
    for _ in range(48):
        logs = adb('logcat', '-d', '-s', 'ReactNativeJS:V')
        events = read_events(logs)
        if any(entry.get('stage') in ('banner-loaded', 'banner-no-fill', 'banner-error',
                                      'consent-blocked', 'consent-error', 'sdk-error') for entry in events):
            break
        time.sleep(2)
    manifest['events'] = events
    # The app's preview-only boot marker distinguishes an actual AdMob SDK
    # failure from an unrelated home-screen/Expo deep-link fallback.
    boot_records = []
    for line in logs.splitlines():
        if 'PACKONE_ANDROID_AD_PROBE_BOOT' not in line:
            continue
        raw_boot = line.split('PACKONE_ANDROID_AD_PROBE_BOOT', 1)[1]
        start, end = raw_boot.find('{'), raw_boot.rfind('}')
        if start >= 0 and end > start:
            try:
                boot_records.append(json.loads(raw_boot[start:end + 1]))
            except json.JSONDecodeError:
                pass
    manifest['preview_boot'] = boot_records
    raw = subprocess.check_output(['adb', 'exec-out', 'screencap', '-p'], timeout=30)
    require(raw[:8] == b'\x89PNG\r\n\x1a\n', 'Android screenshot is not PNG')
    width, height = struct.unpack('>II', raw[16:24])
    (out / 'google-test-banner.png').write_bytes(raw)
    adb('shell', 'uiautomator', 'dump', '/sdcard/packone-admob-insets.xml', check=False)
    xml = adb('shell', 'cat', '/sdcard/packone-admob-insets.xml')
    (out / 'ui.xml').write_text(xml)
    (out / 'ad-events.log').write_text('\n'.join(json.dumps(event, sort_keys=True) for event in events) + '\n')
    require(not re.search(r"isn.t responding|Close app", xml), 'System error dialog detected')
    root = ET.fromstring(xml)
    title = bounds_of(root, 'Edge-to-edge test title')
    footer = bounds_of(root, 'Bottom safe-area marker')
    manifest.update({'screen_px': [width, height], 'title_bounds': title, 'footer_bounds': footer})
    require(boot_records and any(record.get('routeEnabled') for record in boot_records),
            f'Preview AdMob route did not activate; boot records: {boot_records}')
    require(title is not None and footer is not None, 'Preview-only ad test UI did not render')
    require(0 < title[1] and title[3] < footer[1] and footer[3] <= height - 8,
            f'App top/bottom safety markers were clipped: {title}, {footer}, screen={width}x{height}')
    stages = [event.get('stage') for event in events]
    require('banner-loaded' in stages,
            f'Google demo banner was not confirmed loaded (SDK stages: {stages})')
    require('Advertisement' in xml, 'Expected native advertisement accessibility label missing')
    manifest['result'] = 'passed'
except Exception as error:
    manifest['result'] = 'failed'
    manifest['error'] = str(error)
    raise
finally:
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2))
