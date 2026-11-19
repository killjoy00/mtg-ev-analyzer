const assert = require('node:assert/strict');
const test = require('node:test');
const { compileModule } = require('./support/compile-module.cjs');
const { planRatingPrompt } = compileModule('src/ratingPrompt.ts', {});
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
