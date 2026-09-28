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
  const screenshotFixtures = read('mobile/src/screenshots/fixtures.ts');
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
  assert.match(screenshotFixtures, /https:\/\/cards\.scryfall\.io\/normal\/front\//);
  assert.doesNotMatch(screenshotFixtures, /api\.scryfall\.com\/cards\/named/);
  assert.match(draftRun, /config\.screenshots\.fixtures[\s\S]*screenshotFeedbackOverride \|\| params\.screenshot === 'feedback'/);
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
  const layout = read('mobile/app/_layout.tsx');
  const screenshotFeedbackRoute = read('mobile/app/store-screenshot-feedback.tsx');
  const iosCapture = read('mobile/scripts/capture-store-screenshots-ios.sh');
  const androidCapture = read('mobile/scripts/capture-store-screenshots-android.sh');
  assert.match(androidCapture, /adb shell "am start -W -a android\.intent\.action\.VIEW -d '\$url' -p '\$package_name'"/);
  assert.doesNotMatch(androidCapture, /adb shell am start -W -a android\.intent\.action\.VIEW -d "\$url"/);
  assert.match(androidCapture, /capture "02-reveal-comparison" "packone:\/\/store-screenshot-feedback"/);
  assert.doesNotMatch(androidCapture, /screenshot=feedback/);
  assert.match(androidCapture, /adb shell wm size 1080x1920/);
  assert.match(androidCapture, /adb shell wm density 420/);
  assert.match(androidCapture, /ffmpeg[\s\S]*\.jpg/);
  assert.match(androidCapture, /expected="1080x1920"/);
  assert.match(screenshotFeedbackRoute, /config\.screenshots\.fixtures/);
  assert.match(screenshotFeedbackRoute, /<DraftRunScreen screenshotFeedback \/>/);
  assert.match(draftRun, /screenshotFeedbackOverride/);
  assert.match(layout, /store-screenshot-feedback/);
  assert.match(layout, /config\.screenshots\.fixtures \|\| Platform\.OS !== 'ios'/);
  assert.match(layout, /Settings\.get\('packoneScreenshotScene'\)/);
  assert.match(layout, /scene === 'reveal-comparison'/);
  assert.match(iosCapture, /simctl launch "\$udid" "\$bundle_id" -packoneScreenshotScene "\$scene"/);
  assert.match(iosCapture, /sips -s format jpeg[\s\S]*\.jpg/);
  assert.match(iosCapture, /iphone:1320x2868/);
  assert.match(iosCapture, /ipad:2064x2752/);
  assert.doesNotMatch(iosCapture, /simctl openurl/);
  assert.doesNotMatch(iosCapture, /schemeapproval/);
  assert.match(workflow, /Enable KVM for Android emulator when available/);
  assert.match(workflow, /MODE="0666"/);
  assert.match(workflow, /sudo chmod 666 \/dev\/kvm/);
  assert.match(workflow, /emulator-boot-timeout: 900/);
  assert.match(workflow, /concurrency:[\s\S]*group: mobile-store-screenshots[\s\S]*cancel-in-progress: true/);
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

test('iOS capture launches an explicit preview scene and rejects failed or unexpected launches', () => {
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'packone-capture-'));
  try {
    const source = read('mobile/scripts/capture-store-screenshots-ios.sh');
    const capture = source.slice(source.indexOf('capture() {'), source.indexOf('\ncapture "01-'));
    assert.ok(capture.endsWith('}\n'));
    const screenshot = path.join(directory, 'captured');
    const args = path.join(directory, 'args.txt');
    const run = (launchOutput = 'pro.packone.preview: 1234', launchStatus = 0) => {
      fs.rmSync(screenshot, { force: true });
      fs.rmSync(args, { force: true });
      return spawnSync('bash', ['-c', `
        set -euo pipefail
        udid=fixture; bundle_id=pro.packone.preview; out_root=unused; label=fixture
        mkdir -p unused/fixture
        sleep() { :; }
        xcrun() {
          if [[ "$2" == terminate ]]; then
            return 0
          elif [[ "$2" == launch ]]; then
            printf '%s\\n' "$*" > "$ARGS_MARKER"
            printf '%s\\n' "$LAUNCH_OUTPUT"
            return "$LAUNCH_STATUS"
          elif [[ "$2" == io ]]; then
            touch "\${@: -1}"
            return 0
          fi
          return 2
        }
        sips() {
          local out=""
          while [[ "$#" -gt 0 ]]; do
            if [[ "$1" == "--out" ]]; then
              out="$2"
              break
            fi
            shift
          done
          [[ -n "$out" ]]
          touch "$out"
        }
        ${capture}
        capture test practice
      `], { encoding: 'utf8', env: { ...process.env,
        SCREENSHOT_MARKER: screenshot, ARGS_MARKER: args,
        LAUNCH_OUTPUT: launchOutput, LAUNCH_STATUS: String(launchStatus),
      } });
    };

    const success = run();
    assert.equal(success.status, 0, success.stderr);
    assert.ok(fs.existsSync(screenshot));
    assert.match(fs.readFileSync(args, 'utf8'), /simctl launch fixture pro\.packone\.preview -packoneScreenshotScene practice/);

    const unexpected = run('different.bundle: 1234');
    assert.notEqual(unexpected.status, 0);
    assert.ok(!fs.existsSync(screenshot));

    const failed = run('', 1);
    assert.notEqual(failed.status, 0);
    assert.ok(!fs.existsSync(screenshot));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
