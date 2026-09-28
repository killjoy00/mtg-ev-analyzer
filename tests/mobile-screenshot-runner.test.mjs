import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

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
    fs.writeFileSync(path.join(root, 'bin/sleep'), '#!/bin/sh\nexit 0\n', {mode:0o755});
    fs.writeFileSync(path.join(root, 'bin/adb'), `#!/bin/sh
if [ "$1" = shell ]; then
  if [ "$PACKAGE_READY" = 1 ]; then echo 'Service package: found'; fi
elif [ "$1" = install ]; then
  echo attempt >> "$INSTALL_ATTEMPTS"
  [ "$INSTALL_OK" = 1 ] || exit 1
fi
`, {mode:0o755});
    const marker=path.join(root,'captured'), attempts=path.join(root,'attempts');
    const run=(ready, install)=>{
      fs.rmSync(marker,{force:true}); fs.rmSync(attempts,{force:true});
      return spawnSync('/bin/sh',['-c',command],{cwd:root,encoding:'utf8',env:{...process.env,
        PATH:path.join(root,'bin')+path.delimiter+process.env.PATH,
        PACKONE_ANDROID_SCREENSHOT_SCRIPT:program,PACKAGE_READY:String(ready),INSTALL_OK:String(install),INSTALL_ATTEMPTS:attempts,
        CAPTURE_MARKER:marker,SCREENSHOT_ANDROID_APK:path.join(root,'preview.apk'),GITHUB_WORKSPACE:root,
      }});
    };
    const success=run(1,1);
    assert.equal(success.status,0,success.stderr);
    assert.ok(fs.existsSync(marker));
    const missing=run(0,1);
    assert.notEqual(missing.status,0);
    assert.match(missing.stderr,/package manager never became ready/);
    assert.ok(!fs.existsSync(marker));
    assert.ok(!fs.existsSync(attempts));
    const failed=run(1,0);
    assert.notEqual(failed.status,0);
    assert.ok(!fs.existsSync(marker));
    assert.equal(fs.readFileSync(attempts,'utf8').trim().split('\n').length,3);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
