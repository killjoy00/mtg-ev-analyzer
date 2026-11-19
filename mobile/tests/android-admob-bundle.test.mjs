import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const checker = resolve('scripts/check-android-admob-bundle.mjs');
const liveUnit = 'ca-app-pub-1217971050094766/8963799298';

function embedded({ mode = 'enabled', profile = 'production', appName = 'Pack One', unit, pkg = 'pro.packone.app' } = {}) {
  const enabled = mode === 'enabled';
  return {
    name: appName,
    android: { package: pkg },
    extra: {
      buildProfile: profile,
      adMob: {
        iosEnabled: false,
        androidEnabled: enabled,
        testBanners: false,
        ...(enabled ? { androidBannerUnitId: unit ?? liveUnit } : {}),
      },
    },
  };
}

function runCase(config, expectedMode, { missing = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'packone-aab-runtime-'));
  try {
    const assetPath = join(dir, 'base', 'assets');
    mkdirSync(assetPath, { recursive: true });
    if (!missing) writeFileSync(join(assetPath, 'app.config'), JSON.stringify(config));
    else writeFileSync(join(dir, 'placeholder.txt'), 'No runtime config');
    const aab = join(dir, 'test-release.aab');
    const zip = spawnSync('zip', ['-q', aab, missing ? 'placeholder.txt' : 'base/assets/app.config'], {
      cwd: dir, encoding: 'utf8',
    });
    assert.equal(zip.status, 0, zip.stderr);
    return spawnSync(process.execPath, [checker, aab, expectedMode], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('AAB validates production Expo profile, actual live Android flag and registered banner unit', () => {
  const result = runCase(embedded(), 'enabled');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Android AdMob enabled/);
});

test('AAB validates legitimate ad-disabled production builds', () => {
  const result = runCase(embedded({ mode: 'disabled' }), 'disabled');
  assert.equal(result.status, 0, result.stderr);
});

test('AAB rejects 101070 regression: native AdMob enabled but runtime config is Pack One Dev', () => {
  const config = embedded({ mode: 'disabled', profile: 'development', appName: 'Pack One Dev' });
  const result = runCase(config, 'enabled');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /non-production app name/);
});

test('AAB rejects production profile whose embedded runtime AdMob switch was disabled', () => {
  const result = runCase(embedded({ mode: 'disabled' }), 'enabled');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runtime switch must be true/);
});

test('AAB rejects missing or incorrect live banner unit', () => {
  const absent = embedded();
  delete absent.extra.adMob.androidBannerUnitId;
  assert.match(runCase(absent, 'enabled').stderr, /registered Pack One Daily unit/);
  const demo = embedded({ unit: 'ca-app-pub-3940256099942544/6300978111' });
  assert.match(runCase(demo, 'enabled').stderr, /registered Pack One Daily unit/);
});

test('AAB rejects absent runtime config, wrong package, or mismatched expected mode', () => {
  assert.match(runCase({}, 'enabled', { missing: true }).stderr, /readable base\/assets\/app.config/);
  assert.match(runCase(embedded({ pkg: 'pro.packone.preview' }), 'enabled').stderr, /package name/);
  assert.match(runCase(embedded(), 'disabled').stderr, /switch must remain false/);
});
