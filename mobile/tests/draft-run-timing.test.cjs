const test = require('node:test');
const assert = require('node:assert/strict');
const { compileModule } = require('./support/compile-module.cjs');
const { createForegroundDecisionTimer } = compileModule('src/decisionTiming.ts', {});

test('foreground pick time pauses on background, reveal and request', () => {
  let now = 0;
  const clock = createForegroundDecisionTimer(() => now);
  clock.sync('run:0:puzzle-a', true);
  now = 1200;
  clock.sync('run:0:puzzle-a', false); // app hidden
  now = 25200;
  assert.equal(clock.sample('run:0:puzzle-a'), 1200, 'background time is excluded');
  clock.sync('run:0:puzzle-a', true);
  now = 26500;
  assert.equal(clock.sample('run:0:puzzle-a'), 2500);
  clock.sync('run:0:puzzle-a', false); // confirmed pick / feedback
  now = 45000;
  assert.equal(clock.sample('run:0:puzzle-a'), 2500, 'network delay and reveal are excluded');
  clock.sync('run:1:puzzle-b', true);
  now = 45250;
  assert.equal(clock.sample('run:1:puzzle-b'), 250, 'next pick has a fresh clock');
  assert.equal(clock.sample('run:0:puzzle-a'), null, 'old pick cannot borrow time from new pick');
});

test('native timer excludes missing or implausibly long foreground measurements', () => {
  let now = 0;
  const clock = createForegroundDecisionTimer(() => now);
  assert.equal(clock.sample('unseen'), null);
  clock.sync('seen', true);
  now = 1_800_001;
  assert.equal(clock.sample('seen'), null, 'the server rejects active time over 30 minutes');
  clock.clear();
  assert.equal(clock.sample('seen'), null);
});
