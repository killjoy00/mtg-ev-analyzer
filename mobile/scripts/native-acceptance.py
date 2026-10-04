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
    for step in range(24 if scroll else 1):
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


def enter_field(label, value):
    tap(label, exact=True)
    _, root = hierarchy()
    require(any(node.get('class') == 'android.widget.EditText' and node.get('focused') == 'true'
                and node.get('content-desc') == label for node in root.iter()),
            f'{label} field did not receive keyboard focus')
    adb('shell', 'input', 'text', value)
    # The keyboard covers later fields on a phone. Dismiss before locating them.
    adb('shell', 'input', 'keyevent', '4')


def sign_in(email):
    enter_field('Email', email)
    enter_field('Password', 'fixture-password')
    tap('Sign in with email', exact=True)
    _, root = hierarchy()
    require(not any(node.get('content-desc') == 'Password' for node in root.iter()),
            'Email sign-in did not finish; account-switch assertions have not run')


def swipe_page(up):
    # Use the actual visible scroll viewport. In a short landscape window the
    # bottom quarter of the display is the fixed Next pick action, so gestures
    # based on display height never reach the ScrollView.
    _, root = hierarchy()
    viewports = []
    for node in root.iter():
        if node.get('scrollable') != 'true' or node.get('class') == 'android.widget.HorizontalScrollView':
            continue
        bounds = [int(n) for n in re.findall(r'-?\d+', node.get('bounds', ''))]
        if len(bounds) == 4 and bounds[2] > bounds[0] and bounds[3] > bounds[1]:
            viewports.append(bounds)
    require(viewports, 'No visible scroll viewport is available for the gesture')
    left, top, right, bottom = max(viewports, key=lambda b: (b[2]-b[0])*(b[3]-b[1]))
    start, end = (0.80, 0.20) if up else (0.20, 0.80)
    x = str((left+right)//2)
    adb('shell', 'input', 'swipe', x, str(int(top+(bottom-top)*start)),
        x, str(int(top+(bottom-top)*end)), '300')


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
        # Native line widths can include trailing whitespace and fractional
        # glyph overhang. Check their actual extent against the feedback border,
        # while the layout checks above separately contain every text frame.
        offset = layouts[label]['x'] + (layouts['copy']['x'] if label != 'score' else 0)
        for line in texts[label]['lines']:
            left = offset + line.get('x', 0)
            require(left >= 1 and left + line['width'] <= layouts['feedback']['width'] - 1,
                    f'{label} native line extends beyond the feedback border: {line}')
    require('PACKONE_FONTS' in logs, 'Bundled fonts did not finish loading')
    return {'layouts': layouts, 'text': texts}


def measure_tabs(logs):
    records = {}
    for line in logs.splitlines():
        if 'PACKONE_TAB_LAYOUT' in line:
            raw = line.split('PACKONE_TAB_LAYOUT', 1)[1]
            record = json.loads(raw[raw.find('{'):raw.rfind('}')+1])
            records[(record['kind'], record['label'])] = record
    require(('bar', 'navigation') in records, 'Missing intrinsic tab bar measurement')
    bar = records[('bar', 'navigation')]
    require(bar['height'] > 0 and bar['y']+bar['height'] <= bar['windowHeight']+1, 'Tab bar extends beyond the window')
    result = {'bar': bar, 'items': {}}
    for label in bar['labels']:
        for kind in ['item', 'label', 'text']:
            require((kind, label) in records, f'Missing native tab {kind}: {label}')
        item, box, text = [records[(kind, label)] for kind in ['item', 'label', 'text']]
        require(box['x'] >= -1 and box['x']+box['width'] <= item['width']+1, f'{label} tab text frame overflows horizontally')
        require(box['y'] >= -1 and box['y']+box['height'] <= item['height']+1, f'{label} tab text frame is clipped vertically')
        rendered = ''.join(line['text'] for line in text['lines'])
        require(re.sub(r'\s+', '', rendered) == re.sub(r'\s+', '', label), f'{label} tab text was truncated: {rendered}')
        for line in text['lines']:
            require(box['x']+line['x'] >= 0 and box['x']+line['x']+line['width'] <= item['width'], f'{label} tab line overflows its tile')
            require(line['y']+line['height'] <= box['height']+1, f'{label} tab line is clipped')
        result['items'][label] = {'item': item, 'label': box, 'text': text}
    return result


def measure_header(logs):
    boxes = {}
    for line in logs.splitlines():
        if 'PACKONE_HEADER' in line:
            raw = line.split('PACKONE_HEADER', 1)[1]
            record = json.loads(raw[raw.find('{'):raw.rfind('}')+1])
            boxes[record['label']] = record
    for label in ['title', 'help']:
        require(label in boxes and 'row' in boxes, f'Missing native header measurement: {label}')
        box, row = boxes[label], boxes['row']
        require(box['x'] >= -1 and box['x']+box['width'] <= row['width']+1, f'Header {label} overflows horizontally')
        require(box['y'] >= -1 and box['y']+box['height'] <= row['height']+1, f'Header {label} overflows vertically')
    return boxes


def measure_brand(logs):
    boxes = {}
    for line in logs.splitlines():
        if 'PACKONE_BRAND' in line:
            raw = line.split('PACKONE_BRAND', 1)[1]
            record = json.loads(raw[raw.find('{'):raw.rfind('}')+1])
            boxes[record['label']] = record
    for child, parent in [('brand', 'row'), ('help', 'row'), ('mark', 'brand'), ('name', 'brand')]:
        require(child in boxes and parent in boxes, f'Missing native brand layout: {child}/{parent}')
        box, container = boxes[child], boxes[parent]
        require(box['x'] >= -1 and box['x']+box['width'] <= container['width']+1,
                f'{child} overflows {parent} horizontally')
        require(box['y'] >= -1 and box['y']+box['height'] <= container['height']+1,
                f'{child} overflows {parent} vertically')
    return boxes


if platform == 'android':
    manifest.update(device=adb('shell', 'getprop', 'ro.product.model'), os=adb('shell', 'getprop', 'ro.build.version.release'),
                    package=adb('shell', 'dumpsys', 'package', PACKAGE))
    adb('shell', 'settings', 'put', 'global', 'hide_error_dialogs', '1')
    metrics = {}

    def feedback(scenario, width, scale, landscape=False):
        name = f'{scenario}-{width}dp-{scale}x' + ('-landscape' if landscape else '')
        launch(scenario, 'feedback', width, scale, landscape)
        if landscape:
            swipe_page(up=True)
        xml, logs = snapshot(name)
        metric = measure(logs)
        metrics[name] = metric
        manifest['scenes'].append({'name': name, 'width_dp': width, 'font_scale': scale, 'metrics': metric,
                                  'observed_font_scale': adb('shell', 'settings', 'get', 'system', 'font_scale')})
        require('You chose' in xml, 'Feedback text was not rendered')
        if 'match' in scenario:
            require('You matched the trophy drafter' in xml, 'Trophy-match fixture missing')
        tap('Why this score?')
        swipe_page(up=True)
        snapshot(name+'-analysis')
        tap('Review the pack')
        swipe_page(up=True)
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
            xml, logs = snapshot(s+'-home')
            for icon in ['daily', 'learn', 'account']:
                require(any('PACKONE_TAB_ICON' in line and f'"name":"{icon}"' in line for line in logs.splitlines()),
                        f'{icon} tab icon did not load natively')
            require('DRAFT DECISION LAB' not in xml and 'Your last shared run' not in xml, 'Old home directory still visible')
            if s == 'member-checking':
                require('0/3 complete' not in xml and '0-day streak' not in xml, 'Unknown progress shown as zero')
            manifest['scenes'].append({'name': s+'-home', 'width_dp': 390, 'font_scale': 1, 'brand_metrics': measure_brand(logs)})
        attempt(scenario+'-home', home_scene)

    for scenario in ['guest', 'member']:
        def enlarged_navigation(s=scenario):
            launch(s, scale=2.0)
            _, logs = snapshot(s+'-large-tabs')
            manifest['scenes'].append({'name': s+'-large-tabs', 'width_dp': 390, 'font_scale': 2.0,
                                      'tab_metrics': measure_tabs(logs), 'brand_metrics': measure_brand(logs)})
        attempt(scenario+'-large-tabs', enlarged_navigation)

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
            if pick == 0:
                adb('shell', 'input', 'keyevent', '4')
                tap('Daily', exact=True, scroll=False)
                tap('Play Draft Run Daily', exact=True)
                _, logs = snapshot('daily-leave-and-resume')
                require('"method":"POST","id":"33333333-3333-4333-8333-333333333333","round":1' in logs,
                        'Returning to the Daily did not preserve the existing attempt and first pick')
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
        tap('Account settings', exact=True)
        tap('Profile & visibility', exact=True)
        tap('Open My Pack One', exact=True)
        xml, _ = snapshot('profile-editor-return-to-career')
        require('My Pack One' in xml and 'Navigate up' not in xml, 'Profile return did not restore the root tabs')
        adb('shell', 'input', 'keyevent', '4')
        xml, _ = snapshot('profile-editor-return-hardware-back')
        require('A Very Long Pack One Player Name' in xml and 'Display name' not in xml, 'Profile return left the editor under a duplicate tab stack')

    attempt('member-tabs-profile-settings-and-hardware-back', member_navigation)

    def archive_return():
        launch('member')
        adb('shell', f"am start -W -a android.intent.action.VIEW -d 'packone://set-archive?setId=msh' -p '{PACKAGE}'")
        time.sleep(4)
        tap('Open Practice', exact=True)
        xml, _ = snapshot('archive-return-to-practice')
        require('Choose your Draft Run' in xml and 'Navigate up' not in xml, 'Archive return did not restore the Practice tab')
        adb('shell', 'input', 'keyevent', '4')
        xml, _ = snapshot('archive-return-hardware-back')
        require('Eight picks. Your call.' in xml, 'Archive return did not preserve Daily tab history')
    attempt('archive-deep-link-return-without-duplicate-tabs', archive_return)


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
        sign_in('reviewer@packone.example')
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
        sign_in('second@packone.example')
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
                    # Cold Simulator launches can exceed 15 seconds under CI
                    # load. Wait for this scene and native fonts/layout, keeping
                    # a bounded timeout and capturing failures for diagnosis.
                    deadline = time.monotonic() + 60
                    ready = False
                    while time.monotonic() < deadline:
                        logs = app_log.read_bytes()[offset:].decode(errors='replace')
                        scene_ready = any('PACKONE_SCENE' in line and f'"scenario":"{scenario}"' in line
                                          and f'"destination":"{screen}"' in line for line in logs.splitlines())
                        layout_ready = ('"label":"choice"' in logs if screen == 'feedback' else
                                        'PACKONE_BRAND' in logs if screen == 'home' else
                                        'PACKONE_CAREER_READY' in logs if screen == 'career' else 'PACKONE_HEADER' in logs)
                        if screen != 'feedback' and setting != 'large':
                            layout_ready = layout_ready and '"kind":"bar"' in logs
                        ready = scene_ready and 'PACKONE_FONTS' in logs and layout_ready
                        if ready:
                            time.sleep(2)
                            break
                        time.sleep(1)
                    command('xcrun', 'simctl', 'io', udid, 'screenshot', str(out / f'{name}.png'))
                    logs = app_log.read_bytes()[offset:].decode(errors='replace')
                    (out / f'{name}.log').write_text(logs)
                    require(ready, 'Requested native scene/fonts/layout did not become ready within 60 seconds')
                    require((out / f'{name}.png').stat().st_size > 120000, 'Native capture is blank or incomplete')
                    scene = {'name': name, 'text_setting': setting,
                             'observed_text_setting': command('xcrun', 'simctl', 'ui', udid, 'content_size')}
                    if screen in ['learn', 'career']:
                        scene['header_metrics'] = measure_header(logs)
                    if screen == 'home':
                        scene['brand_metrics'] = measure_brand(logs)
                    if screen != 'feedback' and setting != 'large':
                        scene['tab_metrics'] = measure_tabs(logs)
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
