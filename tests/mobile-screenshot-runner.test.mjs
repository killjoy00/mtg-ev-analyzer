import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

test('native driver scrolls inside the visible article above landscape sticky actions', () => {
  // Execute the real gesture helper without launching the native journey module.
  // Bounds reproduce the failed API 35 landscape capture; the old screen-height
  // gesture started at y=900, on Next pick below the viewport's y=849 boundary.
  const result = spawnSync('python3', ['-c', `
import ast, re, xml.etree.ElementTree as ET
from pathlib import Path
module = ast.parse(Path('mobile/scripts/native-acceptance.py').read_text())
helper = next(node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == 'swipe_page')
calls = []
root = None
def require(value, message):
    if not value: raise AssertionError(message)
scope = {'re': re, 'require': require, 'hierarchy': lambda: ('', root), 'adb': lambda *args: calls.append(args)}
exec(compile(ast.Module(body=[helper], type_ignores=[]), '<native-gesture>', 'exec'), scope)
root = ET.fromstring('<hierarchy><node class="android.widget.ScrollView" scrollable="true" bounds="[0,228][2520,849]"/><node class="android.widget.HorizontalScrollView" scrollable="true" bounds="[0,0][2520,1200]"/></hierarchy>')
scope['swipe_page'](True)
assert calls.pop() == ('shell', 'input', 'swipe', '1260', '724', '1260', '352', '300')
root = ET.fromstring('<hierarchy><node class="android.widget.ScrollView" scrollable="true" bounds="[0,279][1170,2073]"/></hierarchy>')
scope['swipe_page'](False)
assert calls.pop() == ('shell', 'input', 'swipe', '585', '637', '585', '1714', '300')
root = ET.fromstring('<hierarchy/>')
try:
    scope['swipe_page'](True)
except AssertionError as error:
    assert 'No visible scroll viewport' in str(error)
else:
    raise AssertionError('Missing viewport must not gesture on a fixed action')
assert not calls
`], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
});

// Exercise the action's /bin/sh boundary without an SDK or a running emulator.
test('Android screenshot action enters one Bash script and preserves readiness/install failure gates', () => {
  const workflow = fs.readFileSync('.github/workflows/mobile-store-screenshots.yml', 'utf8');
  const command = workflow.match(/          script: (bash [^\n]+)/)?.[1];
  assert.equal(command, 'bash -c \"$PACKONE_ANDROID_SCREENSHOT_SCRIPT\"');
  const program = workflow.match(/          PACKONE_ANDROID_SCREENSHOT_SCRIPT: \|\n([\s\S]*?)        with:/)?.[1].split('\n').map(line => line.slice(12)).join('\n');
  assert.ok(program?.includes('set -euo pipefail'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packone-android-capture-'));
  try {
    fs.mkdirSync(path.join(root, 'mobile/scripts'), {recursive:true});
    fs.mkdirSync(path.join(root, 'bin'));
    fs.writeFileSync(path.join(root, 'mobile/scripts/capture-store-screenshots-android.sh'), 'touch "$CAPTURE_MARKER"\n');
    fs.writeFileSync(path.join(root, 'mobile/scripts/native-acceptance.py'), 'import os\nfrom pathlib import Path\nPath(os.environ["ACCEPTANCE_MARKER"]).touch()\n');
    fs.writeFileSync(path.join(root, 'bin/sleep'), '#!/bin/sh\nexit 0\n', {mode:0o755});
    fs.writeFileSync(path.join(root, 'bin/adb'), `#!/bin/sh
if [ "$1" = shell ]; then
  if [ "$PACKAGE_READY" = 1 ]; then echo 'Service package: found'; fi
elif [ "$1" = install ]; then
  echo attempt >> "$INSTALL_ATTEMPTS"
  [ "$INSTALL_OK" = 1 ] || exit 1
fi
`, {mode:0o755});
    const marker=path.join(root,'captured'), attempts=path.join(root,'attempts'), acceptance=path.join(root,'accepted');
    const run=(ready, install)=>{
      fs.rmSync(marker,{force:true}); fs.rmSync(attempts,{force:true}); fs.rmSync(acceptance,{force:true});
      return spawnSync('/bin/sh',['-c',command],{cwd:root,encoding:'utf8',env:{...process.env,
        PATH:path.join(root,'bin')+path.delimiter+process.env.PATH,
        PACKONE_ANDROID_SCREENSHOT_SCRIPT:program,PACKAGE_READY:String(ready),INSTALL_OK:String(install),INSTALL_ATTEMPTS:attempts,
        CAPTURE_MARKER:marker,ACCEPTANCE_MARKER:acceptance,SCREENSHOT_ANDROID_APK:path.join(root,'preview.apk'),GITHUB_WORKSPACE:root,
      }});
    };
    const success=run(1,1);
    assert.equal(success.status,0,success.stderr);
    assert.ok(fs.existsSync(marker));
    assert.ok(fs.existsSync(acceptance));
    const missing=run(0,1);
    assert.notEqual(missing.status,0);
    assert.match(missing.stderr,/package manager never became ready/);
    assert.ok(!fs.existsSync(marker));
    assert.ok(!fs.existsSync(acceptance));
    assert.ok(!fs.existsSync(attempts));
    const failed=run(1,0);
    assert.notEqual(failed.status,0);
    assert.ok(!fs.existsSync(marker));
    assert.ok(!fs.existsSync(acceptance));
    assert.equal(fs.readFileSync(attempts,'utf8').trim().split('\n').length,3);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
