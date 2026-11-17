const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const audit = path.resolve(__dirname, '../scripts/audit-ios-archive.py');
const trackingDeviceId = {
  NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeDeviceID',
  NSPrivacyCollectedDataTypeTracking: true,
  NSPrivacyCollectedDataTypeLinked: true,
  NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeThirdPartyAdvertising'],
};

function runAudit(t, { att = true, bundle = 'GoogleMobileAdsResources.bundle', data = trackingDeviceId, tracking = false,
  otherUsage = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packone-ios-privacy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = path.join(dir, 'Products', 'Applications', 'PackOne.app');
  const info = {
    CFBundleIdentifier: 'pro.packone.app',
    CFBundleVersion: '101003',
    CFBundleShortVersionString: '1.2',
    ITSAppUsesNonExemptEncryption: false,
    ...(att ? { NSUserTrackingUsageDescription: 'Use an identifier for advertising measurement across apps and websites.' } : {}),
    ...(otherUsage ? { NSCameraUsageDescription: 'Not required.' } : {}),
  };
  const manifest = {
    NSPrivacyTracking: tracking,
    NSPrivacyCollectedDataTypes: [data],
  };
  const manifestPath = path.join(app, bundle, 'PrivacyInfo.xcprivacy');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const write = spawnSync('python3', ['-c', [
    'import json, plistlib, sys',
    'a = json.loads(sys.stdin.read())',
    'for name, contents in a:',
    '    with open(name, "wb") as f: plistlib.dump(contents, f)',
  ].join('\n')], {
    input: JSON.stringify([[path.join(app, 'Info.plist'), info], [manifestPath, manifest]]),
    encoding: 'utf8',
  });
  assert.equal(write.status, 0, write.stderr);
  return spawnSync('python3', [audit, dir, '--output', path.join(dir, 'audit.json')], { encoding: 'utf8' });
}

test('reviewed AdMob Device ID tracking requires ATT but passes the privacy audit', t => {
  const result = runAudit(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /NSPrivacyCollectedDataTypeDeviceID/);
});

test('tracked AdMob Device ID without ATT must fail closed', t => {
  const result = runAudit(t, { att: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NSUserTrackingUsageDescription/);
});

test('an unreviewed tracking SDK must fail even if ATT is configured', t => {
  const result = runAudit(t, { bundle: 'UnreviewedSDK.bundle' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unreviewed tracked data/);
});

test('an unexpected tracked data type must fail closed', t => {
  const result = runAudit(t, { data: {
    ...trackingDeviceId,
    NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeEmailAddress',
  } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unreviewed tracked data/);
});

test('top-level privacy tracking declarations are still rejected', t => {
  const result = runAudit(t, { tracking: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /a bundled privacy manifest declares tracking/);
});

test('unrelated privacy-sensitive permissions are not silently approved', t => {
  const result = runAudit(t, { otherUsage: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unexpected privacy usage-description keys/);
});
