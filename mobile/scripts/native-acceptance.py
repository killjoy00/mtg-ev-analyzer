"""Capture real native rendering and drive gameplay against isolated preview fixtures.

No credentials, live backend writes, or production package. Evidence describes
the simulator/emulator explicitly; it is not physical-device acceptance.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

PACKAGE = 'pro.packone.preview'
platform, out_arg = sys.argv[1:3]
out = Path(out_arg)
out.mkdir(parents=True, exist_ok=True)
manifest = {'source_sha': os.environ.get('ACCEPTANCE_SOURCE_SHA', os.environ.get('GITHUB_SHA')),
            'tested_checkout_sha': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
            'platform': platform, 'backend': 'isolated persistent preview fixtures',
    'physical_device': False, 'scenes': [], 'journeys': [], 'failures': []}


def command(*args, check=True):
    result = subprocess.run(args, capture_output=True, text=True, timeout=90)
    if check and result.returncode:
        raise RuntimeError(f'{args}: {result.stderr or result.stdout}')
    return result.stdout.strip()


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def save_manifest():
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2))


def attempt(name, callback):
    try:
        callback()
        manifest['journeys'].append({'name': name, 'result': 'passed'})
    except Exception as error:
        manifest['failures'].append({'name': name, 'error': str(error)})
        if platform == 'android':
            snapshot(f'failure-{name}')
    finally:
        save_manifest()


def adb(*args, **kwargs):
    return command('adb', *args, **kwargs)


def hierarchy():
    for _ in range(3):
        adb('shell', 'uiautomator', 'dump', '/sdcard/packone-evidence.xml', check=False)
        xml = adb('shell', 'cat', '/sdcard/packone-evidence.xml', check=False)
        try:
            return xml, ET.fromstring(xml)
        except ET.ParseError:
            time.sleep(1)
    raise RuntimeError('No Android UI hierarchy was available.')


def snapshot(name):
    (out / f'{name}.png').write_bytes(subprocess.check_output(['adb', 'exec-out', 'screencap', '-p']))
    xml, root = hierarchy()
    (out / f'{name}.xml').write_text(xml)
    logs = adb('logcat', '-d', '-s', 'ReactNativeJS:V')
    (out / f'{name}.log').write_text(logs)
    require(not re.search(r'isn.t responding|Close app', xml), 'System error dialog is visible')
    require(not any(node.get('text') in ['index', '(tabs)'] for node in root.iter()), 'Internal route name is visible')
    return xml, logs


def tap(label, exact=False, scroll=True):
    for step in range(8 if scroll else 1):
        _, root = hierarchy()
        for node in root.iter():
            values = [node.get('text', ''), node.get('content-desc', '')]
            if any(value == label if exact else label.lower() in value.lower() for value in values):
                bounds = [int(n) for n in re.findall(r'\d+', node.get('bounds', ''))]
                if len(bounds) == 4 and bounds[2] > bounds[0] and bounds[3] > bounds[1]:
                    adb('shell', 'input', 'tap', str((bounds[0]+bounds[2])//2), str((bounds[1]+bounds[3])//2))
                    time.sleep(2)
                    return
        if scroll:
            swipe_page(up=True)
    raise AssertionError(f'No visible actionable {label!r}')


def swipe_page(up):
    size = adb('shell', 'wm', 'size').splitlines()[-1]
    width, height = map(int, re.findall(r'(\d+)x(\d+)', size)[0])
    start, end = (0.75, 0.30) if up else (0.30, 0.75)
    adb('shell', 'input', 'swipe', str(width//2), str(int(height*start)),
        str(width//2), str(int(height*end)), '300')


def top():
    for _ in range(5):
        swipe_page(up=False)


def launch(scenario, screen='home', width=390, scale=1, landscape=False):
    adb('shell', 'am', 'force-stop', PACKAGE)
    adb('shell', 'wm', 'size', f'{int(width*3)}x{1200 if landscape else 2400}')
    adb('shell', 'wm', 'density', '480')
    adb('shell', 'settings', 'put', 'system', 'font_scale', str(scale))
    adb('logcat', '-c')
    # Quote the entire URI for Android's remote shell (& separates commands).
    url = f'packone://native-acceptance?scenario={scenario}&destination={screen}'
    adb('shell', f"am start -W -a android.intent.action.VIEW -d '{url}' -p '{PACKAGE}'")
    time.sleep(12)


def measure(logs):
    layouts, texts = {}, {}
    for line in logs.splitlines():
        for marker, target in [('PACKONE_LAYOUT', layouts), ('PACKONE_TEXT', texts)]:
            if marker not in line:
                continue
            raw = line.split(marker, 1)[1]
            start, end = raw.find('{'), raw.rfind('}')
            if start < 0:
                continue
            record = json.loads(raw[start:end+1])
            target[record['label']] = record
    for label in ['feedback', 'copy', 'score', 'title', 'choice']:
        require(label in layouts, f'Missing native layout measurement: {label}')
    for child, parent in [('copy', 'feedback'), ('score', 'feedback'), ('title', 'copy'), ('choice', 'copy')]:
        box, container = layouts[child], layouts[parent]
        require(box['x'] >= -1 and box['x']+box['width'] <= container['width']+1,
                f'{child} overflows {parent} horizontally: {box} / {container}')
        require(box['y'] >= -1 and box['y']+box['height'] <= container['height']+1,
                f'{child} overflows {parent} vertically: {box} / {container}')
    for label in ['score', 'title', 'choice']:
        require(label in texts and texts[label]['lines'], f'Missing real text metrics: {label}')
        require(all(line['width'] <= layouts[label]['width']+2 for line in texts[label]['lines']), f'{label} glyph lines exceed text box')
    require('PACKONE_FONTS' in logs, 'Bundled fonts did not finish loading')
    return {'layouts': layouts, 'text': texts}


if platform == 'android':
    manifest.update(device=adb('shell', 'getprop', 'ro.product.model'), os=adb('shell', 'getprop', 'ro.build.version.release'),
                    package=adb('shell', 'dumpsys', 'package', PACKAGE))
    adb('shell', 'settings', 'put', 'global', 'hide_error_dialogs', '1')
    metrics = {}

    def feedback(scenario, width, scale, landscape=False):
        name = f'{scenario}-{width}dp-{scale}x' + ('-landscape' if landscape else '')
        launch(scenario, 'feedback', width, scale, landscape)
        xml, logs = snapshot(name)
        metric = measure(logs)
        metrics[name] = metric
        manifest['scenes'].append({'name': name, 'width_dp': width, 'font_scale': scale, 'metrics': metric,
                                  'observed_font_scale': adb('shell', 'settings', 'get', 'system', 'font_scale')})
        require('You chose' in xml, 'Feedback text was not rendered')
        if 'match' in scenario:
            require('You matched the trophy drafter' in xml, 'Trophy-match fixture missing')
        tap('Why this score?')
        snapshot(name+'-analysis')
        tap('Review the pack')
        snapshot(name+'-pack')

    for scenario, width, scale, landscape in [
        ('member-long', 320, 1, False), ('member-long', 320, 1.5, False),
        ('member-match', 320, 1.5, False), ('member-zero', 320, 1.5, False),
        ('member-long', 600, 1.5, False), ('member-long', 840, 1.5, True),
    ]:
        attempt(f'{scenario}-{width}-{scale}', lambda s=scenario,w=width,f=scale,l=landscape: feedback(s,w,f,l))

    def text_growth():
        normal = metrics['member-long-320dp-1x']['text']['choice']['lines'][0]['height']
        large = metrics['member-long-320dp-1.5x']['text']['choice']['lines'][0]['height']
        require(large > normal * 1.2, f'Actual text did not grow: {normal} -> {large}')
        manifest['actual_text_growth'] = {'normal_line_height': normal, 'large_line_height': large, 'ratio': large/normal}
    attempt('actual-text-growth', text_growth)

    for scenario in ['guest', 'guest-returning', 'member-new', 'member-zero', 'member-partial', 'member-all', 'member-checking', 'member-error', 'elite']:
        def home_scene(s=scenario):
            launch(s)
            xml, _ = snapshot(s+'-home')
            require('DRAFT DECISION LAB' not in xml and 'Your last shared run' not in xml, 'Old home directory still visible')
            if s == 'member-checking':
                require('0/3 complete' not in xml and '0-day streak' not in xml, 'Unknown progress shown as zero')
            manifest['scenes'].append({'name': s+'-home', 'width_dp': 390, 'font_scale': 1})
        attempt(scenario+'-home', home_scene)

    def daily_journey():
        launch('guest')
        tap('How to Play', exact=True, scroll=False)
        snapshot('guest-how-to')
        tap('Play Daily Draft Run', exact=True)
        for pick in range(8):
            top()
            tap('Pick Hero in Training')
            tap('Confirm pick', exact=True)
            xml, _ = snapshot(f'journey-pick-{pick+1}')
            require('You chose' in xml, f'No feedback after pick {pick+1}')
            tap('See result' if pick == 7 else 'Next pick', exact=True)
        snapshot('journey-result')
        tap('Review pick 1,')
        snapshot('journey-final-review')
        tap('See result', exact=True)
        tap('Home', exact=True)
        xml, _ = snapshot('journey-home')
        require('View result' in xml, 'Completed Daily action missing')
        require('Navigate up' not in xml, 'Root tab has a Back button')
    attempt('eight-pick-daily-and-final-review', daily_journey)

    def member_navigation():
        launch('member')
        for tab in ['Practice', 'Learn', 'My Pack One', 'Leaders']:
            tap(tab, exact=True, scroll=False)
            snapshot('member-tab-'+tab.replace(' ', '-'))
        tap('A Very Long Pack One Player Name')
        snapshot('leader-profile')
        adb('shell', 'input', 'keyevent', '4')
        snapshot('leader-back')
        tap('My Pack One', exact=True, scroll=False)
        tap('Account settings', exact=True)
        snapshot('account-settings')
        adb('shell', 'input', 'keyevent', '4')
        xml, _ = snapshot('settings-back')
        require('My Pack One' in xml, 'Settings Back did not restore member dashboard')
    attempt('member-tabs-profile-settings-and-hardware-back', member_navigation)

    def practice_journey():
        launch('member', 'practice')
        tap('Start regular Draft Run practice')
        for pick in range(8):
            top()
            tap('Pick Hero in Training')
            tap('Confirm pick', exact=True)
            tap('See result' if pick == 7 else 'Next pick', exact=True)
        snapshot('practice-result')
        tap('Review pick 1,')
        snapshot('practice-final-review')
        tap('See result', exact=True)
        tap('Return to Practice', exact=True)
        xml, _ = snapshot('practice-return')
        require('Choose your Draft Run' in xml, 'Practice tab was not restored')
        require('Navigate up' not in xml, 'Practice root has a Back button')
    attempt('practice-complete-review-return', practice_journey)

    def shared_journey():
        launch('guest-shared', 'shared')
        tap('Sign in to play this run', exact=True)
        tap('Email', exact=True)
        adb('shell', 'input', 'text', 'reviewer@packone.example')
        tap('Password', exact=True)
        adb('shell', 'input', 'text', 'fixture-password')
        adb('shell', 'input', 'keyevent', '4')
        tap('Sign in with email', exact=True)
        tap('Play or resume this run', exact=True)
        top()
        tap('Pick Hero in Training')
        tap('Confirm pick', exact=True)
        _, before = snapshot('shared-before-relaunch')
        require('"method":"POST"' in before, 'Invitation was not accepted')
        adb('shell', 'am', 'force-stop', PACKAGE)
        adb('logcat', '-c')
        # Launch the normal public recovery route, not the reset-fixture entry.
        adb('shell', f"am start -W -a android.intent.action.VIEW -d 'packone://resume-shared-run' -p '{PACKAGE}'")
        time.sleep(12)
        xml, after = snapshot('shared-after-relaunch')
        require('You chose' in xml, 'Shared feedback was not restored')
        require('"method":"GET","id":"33333333-3333-4333-8333-333333333333","round":1' in after, 'Exact attempt and progress were not loaded')
        require('"method":"POST"' not in after, 'Relaunch created another shared attempt')
    attempt('shared-invitation-auth-accept-kill-relaunch', shared_journey)

    def image_failure():
        launch('member-image-error', 'feedback')
        tap('Your Pick: Hero in Training. Open enlarged card.', exact=True)
        xml, _ = snapshot('card-image-unavailable')
        require('Image unavailable' in xml and 'Retry image' in xml, 'Missing image failure and retry state')
        tap('Retry image', exact=True)
        xml, _ = snapshot('card-image-retry')
        require('Image unavailable' in xml, 'Deterministic broken image should remain retryable')
        tap('Close', exact=True)
        xml, _ = snapshot('card-image-close')
        require('You chose' in xml, 'Closing card zoom lost the run')
    attempt('image-failure-retry-keeps-run', image_failure)

    def account_switch():
        launch('member', 'career')
        xml, _ = snapshot('account-a-career')
        require('PackOneReviewer' in xml, 'Account A fixture was not loaded')
        tap('Account settings', exact=True)
        tap('Sign out', exact=True)
        xml, _ = snapshot('signed-out-settings')
        require('Sign in to Pack One' in xml and 'PackOneReviewer' not in xml, 'Sign-out retained private account details')
        tap('Email', exact=True)
        adb('shell', 'input', 'text', 'second@packone.example')
        tap('Password', exact=True)
        adb('shell', 'input', 'text', 'fixture-password')
        adb('shell', 'input', 'keyevent', '4')
        tap('Sign in with email', exact=True)
        xml, _ = snapshot('account-b-career')
        require('SecondReviewer' in xml and 'PackOneReviewer' not in xml, 'Account B retained account A profile')
    attempt('sign-out-and-account-switch', account_switch)

elif platform == 'ios':
    udid, label = sys.argv[3:5]
    import plistlib
    app = command('xcrun', 'simctl', 'get_app_container', udid, PACKAGE, 'app')
    with (Path(app) / 'Info.plist').open('rb') as info:
        version = plistlib.load(info)
    manifest.update(device=label, simulator_udid=udid, build_number=version['CFBundleVersion'], version=version['CFBundleShortVersionString'],
                    runtime=json.loads(command('xcrun', 'simctl', 'list', 'devices', '-j')))
    app_log = out / 'runtime.log'
    # Unified logging includes native JS console messages in release preview builds.
    logger = subprocess.Popen(['xcrun', 'simctl', 'spawn', udid, 'log', 'stream', '--level', 'info', '--style', 'compact',
                               '--predicate', 'process CONTAINS "PackOne" OR eventMessage CONTAINS "PACKONE_"'],
                              stdout=app_log.open('w'), stderr=subprocess.STDOUT)
    try:
        ios_metrics = {}
        for setting in ['large', 'accessibility-extra-extra-extra-large']:
            command('xcrun', 'simctl', 'ui', udid, 'content_size', setting)
            for scenario, screen in [('guest','home'), ('guest','learn'), ('member','learn'), ('member-new','career'),
                                     ('member-long','feedback'), ('member-match','feedback'), ('member-zero','feedback')]:
                name = f'{label}-{scenario}-{screen}-{setting}'
                def ios_scene():
                    command('xcrun', 'simctl', 'terminate', udid, PACKAGE, check=False)
                    offset = app_log.stat().st_size
                    command('xcrun', 'simctl', 'launch', udid, PACKAGE, '-packoneScreenshotScene', f'acceptance:{scenario}:{screen}')
                    time.sleep(15)
                    command('xcrun', 'simctl', 'io', udid, 'screenshot', str(out / f'{name}.png'))
                    logs = app_log.read_bytes()[offset:].decode(errors='replace')
                    require('PACKONE_SCENE' in logs, 'Requested native fixture did not finish loading')
                    scene = {'name': name, 'text_setting': setting,
                             'observed_text_setting': command('xcrun', 'simctl', 'ui', udid, 'content_size')}
                    if screen == 'feedback':
                        scene['metrics'] = measure(logs)
                        ios_metrics[(scenario, setting)] = scene['metrics']
                    manifest['scenes'].append(scene)
                attempt(name, ios_scene)
        def ios_text_growth():
            normal = ios_metrics[('member-long', 'large')]['text']['choice']['lines'][0]['height']
            large = ios_metrics[('member-long', 'accessibility-extra-extra-extra-large')]['text']['choice']['lines'][0]['height']
            require(large > normal * 1.2, f'Actual iOS text did not grow: {normal} -> {large}')
            manifest['actual_text_growth'] = {'normal_line_height': normal, 'large_line_height': large, 'ratio': large/normal}
        attempt('ios-actual-text-growth', ios_text_growth)
    finally:
        logger.terminate()
        logger.wait(timeout=10)
        command('xcrun', 'simctl', 'ui', udid, 'content_size', 'large')
else:
    raise SystemExit(f'Unknown platform {platform}')
save_manifest()
if manifest['failures']:
    raise SystemExit(json.dumps(manifest['failures'], indent=2))
