"""Native baseline evidence. Adds measurement callbacks only; never changes layout."""
import json
from pathlib import Path
import subprocess
import sys
import time


def command(*args):
    return subprocess.check_output(args, text=True).strip()


if sys.argv[1] == 'instrument':
    path = Path('mobile/app/draft-run.tsx')
    source = path.read_text()
    for name in ['feedback', 'feedbackScore', 'feedbackCopy', 'feedbackTitle', 'feedbackBody']:
        source = source.replace(f'style={{styles.{name}}}', f'onLayout={{(event) => console.info("PACKONE_LAYOUT", "{name}", JSON.stringify(event.nativeEvent.layout))}} style={{styles.{name}}}')
    path.write_text(source)
else:
    output = Path(sys.argv[2])
    output.mkdir(parents=True, exist_ok=True)
    package = 'pro.packone.preview'
    manifest = {'source_sha': '388d9ab045240e0d96a4b1382f140e35fc91d0b4', 'evidence': 'Android emulator, preview fixtures, unchanged baseline layout',
                'device': command('adb', 'shell', 'getprop', 'ro.product.model'), 'os': command('adb', 'shell', 'getprop', 'ro.build.version.release'),
                'package': command('adb', 'shell', 'dumpsys', 'package', package), 'scenes': []}
    for width, scale in [(390, 1), (320, 1), (320, 1.5), (600, 1.5)]:
        name = f'feedback-{width}dp-{scale}x'
        command('adb', 'shell', 'wm', 'size', f'{int(width * 3)}x2400')
        command('adb', 'shell', 'wm', 'density', '480')
        command('adb', 'shell', 'settings', 'put', 'system', 'font_scale', str(scale))
        command('adb', 'shell', 'am', 'force-stop', package)
        command('adb', 'logcat', '-c')
        command('adb', 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', 'packone://store-screenshot-feedback', '-p', package)
        time.sleep(15)
        (output / f'{name}.png').write_bytes(subprocess.check_output(['adb', 'exec-out', 'screencap', '-p']))
        logs = command('adb', 'logcat', '-d', '-s', 'ReactNativeJS:V')
        (output / f'{name}.log').write_text(logs)
        command('adb', 'shell', 'uiautomator', 'dump', '/sdcard/packone-evidence.xml')
        (output / f'{name}.xml').write_text(command('adb', 'shell', 'cat', '/sdcard/packone-evidence.xml'))
        manifest['scenes'].append({'name': name, 'width_dp': width, 'font_scale': scale, 'observed_font_scale': command('adb', 'shell', 'settings', 'get', 'system', 'font_scale')})
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
