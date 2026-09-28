const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const repo = path.resolve(root, '..');

function read(relative) {
  return fs.readFileSync(path.join(repo, relative), 'utf8');
}

test('store screenshot fixture mode is isolated from production builds', () => {
  const config = read('mobile/src/config.ts');
  const appConfig = read('mobile/app.config.ts');
  const client = read('mobile/src/api/client.ts');
  const session = read('mobile/src/storage/session.ts');
  const draftRun = read('mobile/app/draft-run.tsx');
  const workflow = read('.github/workflows/mobile-store-screenshots.yml');

  assert.match(config, /process\.env\.EXPO_PUBLIC_PACKONE_ENV/);
  assert.match(config, /screenshotFixtures && resolvedEnvironment !== 'preview'/);
  assert.match(config, /Store screenshot fixtures are allowed only in the preview mobile environment/);
  assert.match(appConfig, /preview: 'pro\.packone\.preview'/);
  assert.match(appConfig, /STORE_IDENTIFIER = 'pro\.packone\.app'/);
  assert.match(appConfig, /screenshotFixtures && profile !== 'preview'/);
  assert.match(appConfig, /PACKONE_BUILD_PROFILE=preview/);
  assert.match(client, /if \(config\.screenshots\.fixtures\)/);
  assert.match(session, /if \(config\.screenshots\.fixtures\)/);
  assert.match(draftRun, /config\.screenshots\.fixtures && params\.screenshot === 'feedback'/);
  assert.match(workflow, /EXPO_PUBLIC_PACKONE_ENV: preview/);
  assert.match(workflow, /EXPO_PUBLIC_PACKONE_SCREENSHOT_FIXTURES: '1'/);
  assert.match(workflow, /PACKONE_BUILD_PROFILE: preview/);
  assert.doesNotMatch(
    workflow.slice(0, workflow.indexOf('jobs:')),
    /EXPO_PUBLIC_PACKONE_SCREENSHOT_FIXTURES/,
  );
  assert.match(workflow, /xcodebuild -list -json -workspace/);
  assert.match(workflow, /pro\.packone\.preview/);
  assert.doesNotMatch(workflow, /-scheme PackOne\b/);
  assert.doesNotMatch(workflow, /Release-iphonesimulator\/PackOne\.app/);
  const iosCapture = read('mobile/scripts/capture-store-screenshots-ios.sh');
  const androidCapture = read('mobile/scripts/capture-store-screenshots-android.sh');
  assert.match(androidCapture, /adb shell "am start -W -a android\.intent\.action\.VIEW -d '\$url' -p '\$package_name'"/);
  assert.doesNotMatch(androidCapture, /adb shell am start -W -a android\.intent\.action\.VIEW -d "\$url"/);
  assert.match(iosCapture, /com\.apple\.launchservices\.schemeapproval\.plist/);
  assert.match(iosCapture, /CoreSimulatorBridge-->/);
  assert.match(iosCapture, /UIKitApplication:\$bundle_id/);
  assert.match(workflow, /Enable KVM for Android emulator/);
  assert.match(workflow, /MODE="0666"/);
  assert.match(workflow, /test -w \/dev\/kvm/);
  assert.match(workflow, /adb shell service check package/);
  assert.match(workflow, /for attempt in 1 2 3; do/);
  assert.match(workflow, /adb kill-server/);
});

test('store screenshot and App Store configuration encode reviewed release decisions', () => {
  const iosStore = read('mobile/src/iap/apple-store.ios.ts');
  const asc = read('.github/scripts/app-store-elite-config.mjs');
  const request = JSON.parse(read('.github/app-store-elite-request.json'));

  assert.match(iosStore, /displayPrice: '\$7\.00'/);
  assert.match(asc, /const targetTerritories=\['USA','CAN'\]/);
  assert.match(asc, /const targetUsPrice=7/);
  assert.match(asc, /subscriptionAvailability/);
  assert.match(asc, /subscriptionAvailabilities/);
  assert.match(asc, /\/equalizations\?/);
  assert.match(asc, /availableInNewTerritories:false/);
  assert.match(asc, /Refusing to replace an existing/);
  assert.doesNotMatch(asc, /subscriptionPlanAvailabilities/);
  assert.doesNotMatch(asc, /adjustedEqualizations/);
  assert.doesNotMatch(asc, /const planType='MONTHLY'/);
  assert.equal(request.operation, 'configure-pack-one-elite');
  assert.match(request.reason, /United States and Canada only/);
  assert.match(request.reason, /exact United States customer price to \$7\.00/);
});

test('iOS capture consumes a large process listing and rejects missing or failed launches', () => {
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'packone-capture-'));
  try {
    const source = read('mobile/scripts/capture-store-screenshots-ios.sh');
    const capture = source.slice(source.indexOf('capture() {'), source.indexOf('\ncapture "01-'));
    assert.ok(capture.endsWith('}\n'));
    const fixture = path.join(directory, 'processes.txt');
    const screenshot = path.join(directory, 'captured');
    const run = (listing, producerStatus = 0) => {
      fs.writeFileSync(fixture, listing);
      fs.rmSync(screenshot, { force: true });
      return spawnSync('bash', ['-c', `
        set -euo pipefail
        udid=fixture; bundle_id=pro.packone.preview; out_root=unused; label=fixture
        sleep() { :; }
        xcrun() {
          if [[ "$2" == spawn ]]; then
            cat "$PROCESS_FIXTURE" || return $?
            return "$PRODUCER_STATUS"
          elif [[ "$2" == io ]]; then
            touch "$SCREENSHOT_MARKER"
          fi
        }
        ${capture}
        capture test packone://practice
      `], { encoding: 'utf8', env: { ...process.env,
        PROCESS_FIXTURE: fixture, SCREENSHOT_MARKER: screenshot,
        PRODUCER_STATUS: String(producerStatus),
      } });
    };
    const largeListing = 'UIKitApplication:pro.packone.preview\n' + 'unrelated service\n'.repeat(100000);
    const success = run(largeListing);
    assert.equal(success.status, 0, success.stderr);
    assert.ok(fs.existsSync(screenshot));
    const missing = run('unrelated service\n');
    assert.notEqual(missing.status, 0);
    assert.ok(!fs.existsSync(screenshot));
    const failed = run(largeListing, 1);
    assert.notEqual(failed.status, 0);
    assert.ok(!fs.existsSync(screenshot));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
