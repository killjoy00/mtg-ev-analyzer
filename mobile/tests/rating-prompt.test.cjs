const assert = require('node:assert/strict');
const test = require('node:test');
const { compileModule } = require('./support/compile-module.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { planRatingPrompt } = compileModule('src/ratingPrompt.ts', { 'react-native': { Platform: { OS: 'ios' } } });
const seen = (raw, id, day, version = '1.4', now = Date.UTC(2026, 10, 18)) =>
  planRatingPrompt(raw, id, day, version, now);
test('review request needs three distinct Daily dates and never fires on first day', () => {
  let result = seen(null, 'run1', '2026-11-16');
  assert.equal(result.shouldRequest, false);
  result = seen(JSON.stringify(result.state), 'run2', '2026-11-16');
  assert.equal(result.shouldRequest, false);
  result = seen(JSON.stringify(result.state), 'run3', '2026-11-17');
  assert.equal(result.shouldRequest, false);
  result = seen(JSON.stringify(result.state), 'run4', '2026-11-18');
  assert.equal(result.shouldRequest, true);
});
test('revisiting a finished Daily never increments the threshold', () => {
  const a = seen(null, 'a', '2026-11-16');
  const b = seen(JSON.stringify(a.state), 'a', '2026-11-16');
  assert.equal(b.state.runs.length, 1);
  assert.equal(b.shouldRequest, false);
});
test('no repeat in same version; minimum 90 days even across versions', () => {
  const state = { runs: [
    { id: 'a', day: '2026-11-16' }, { id: 'b', day: '2026-11-17' }, { id: 'c', day: '2026-11-18' }
  ], lastRequestedVersion: '1.4', lastRequestedAt: Date.UTC(2026, 10, 18) };
  assert.equal(seen(JSON.stringify(state), 'd', '2026-11-19').shouldRequest, false);
  assert.equal(seen(JSON.stringify(state), 'd', '2026-11-19','1.5').shouldRequest, false);
  assert.equal(seen(JSON.stringify(state), 'd', '2026-11-19','1.5', Date.UTC(2027, 2, 19)).shouldRequest, true);
});
test('corrupt state fails closed without blocking play', () => {
  assert.equal(seen('garbled','x','not-a-day').shouldRequest,false);
  assert.equal(seen(null,'','2026-11-18').shouldRequest,false);
});

// #1679: a dynamic import of react-native made Metro's importAll evaluate every
// lazy getter on react-native's CommonJS index. On iOS, PushNotificationIOS
// throws during module init (native module not linked) and Metro reports
// module-init errors as fatal, bypassing try/catch. Keep react-native static.
test('native code never dynamically imports or namespace-imports react-native', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:[cm]?js|tsx?)$/.test(entry.name)) {
        const source = fs.readFileSync(full, 'utf8');
        if (/\bimport\s*\(\s*['"]react-native['"]\s*\)/.test(source)
          || /\bimport\s*\*\s*as\s+\w+\s+from\s*['"]react-native['"]/.test(source)) offenders.push(full);
      }
    }
  };
  walk('app');
  walk('src');
  assert.deepEqual(offenders, []);
});

function ratingHarness(os, stored) {
  const calls = { reads: 0, writes: [], requested: 0 };
  const mocks = {
    'react-native': { Platform: { OS: os } },
    'expo-application': { nativeApplicationVersion: '1.4' },
    'expo-secure-store': {
      getItemAsync: async () => { calls.reads += 1; return stored; },
      setItemAsync: async (_key, value) => { calls.writes.push(JSON.parse(value)); },
    },
    'expo-store-review': {
      isAvailableAsync: async () => true,
      requestReview: async () => { calls.requested += 1; },
    },
  };
  const { maybeRequestPackOneRating } = compileModule('src/ratingPrompt.ts', mocks);
  return { calls, maybeRequestPackOneRating };
}

test('iOS rating gate records the run and requests review on the third distinct day', async () => {
  const prior = JSON.stringify({ runs: [{ id: 'a', day: '2026-11-17' }, { id: 'b', day: '2026-11-18' }] });
  const { calls, maybeRequestPackOneRating } = ratingHarness('ios', prior);
  await maybeRequestPackOneRating('c', '2026-11-19');
  assert.equal(calls.reads, 1);
  assert.equal(calls.requested, 1);
  assert.equal(calls.writes.at(-1).lastRequestedVersion, '1.4');
});

test('iOS first-day result records history without requesting review', async () => {
  const { calls, maybeRequestPackOneRating } = ratingHarness('ios', null);
  await maybeRequestPackOneRating('a', '2026-11-19');
  assert.equal(calls.requested, 0);
  assert.deepEqual(calls.writes, [{ runs: [{ id: 'a', day: '2026-11-19' }] }]);
});

test('non-iOS platforms never touch rating storage or StoreKit', async () => {
  const { calls, maybeRequestPackOneRating } = ratingHarness('android', null);
  await maybeRequestPackOneRating('a', '2026-11-19');
  assert.deepEqual(calls, { reads: 0, writes: [], requested: 0 });
});
