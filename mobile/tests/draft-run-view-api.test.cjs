const test = require('node:test');
const assert = require('node:assert/strict');
const { compileModule } = require('./support/compile-module.cjs');

test('native Draft Run view ID survives refocus without compromising timing', async () => {
  const requests = [];
  const api = compileModule('src/api/draftRun.ts', {
    'expo-application': { nativeApplicationVersion: '1.3', nativeBuildVersion: '6' },
    'react-native': { Platform: { OS: 'ios' } },
    '@/src/api/client': {
      requestJson: async (url, options) => {
        requests.push({ url, ...options.body });
        return { ok: true };
      },
    },
  });
  const session = { playerToken: 'synthetic-player-token' };
  const run = {
    id: '11111111-1111-4111-8111-111111111111',
    revision: 0,
    current: { puzzle_id: 'first-pick' },
  };
  await api.recordDraftRunView(run, session);
  await api.recordDraftRunView(run, session);
  await api.recordDraftRunView({ ...run, revision: 1, current: { puzzle_id: 'next-pick' } }, session);
  await api.submitDraftRunPick(run, 'card-a', session, 2700);
  await api.submitDraftRunPick({ ...run, revision: 1, current: { puzzle_id: 'next-pick' } }, 'card-b', session, 1300);
  await api.submitDraftRunPick({ ...run, revision: 2, current: { puzzle_id: 'missing-timing' } }, 'card-c', session);

  assert.equal(requests.length, 6);
  assert.equal(requests[0].viewId, requests[1].viewId,
    'resuming the same decision must update last_seen_at without breaking timing_reliable');
  assert.notEqual(requests[1].viewId, requests[2].viewId,
    'a new decision requires a distinct observation identity');
  assert.match(requests[0].viewId, /^[a-f0-9-]{36}$/i);
  assert.equal(requests[0].revision, 0);
  assert.equal(requests[2].revision, 1);
  assert.equal(requests[0].url, '/draft/v1/runs/11111111-1111-4111-8111-111111111111/view');
  assert.equal(requests[3].viewId, requests[0].viewId, 'pick must use the observed UUID');
  assert.equal(requests[3].activeMs, 2700, 'pick must send measured native foreground time');
  assert.equal(requests[3].cardId, 'card-a');
  assert.equal(requests[4].viewId, requests[2].viewId);
  assert.equal(requests[4].activeMs, 1300);
  assert.equal(requests[5].activeMs, undefined, 'unmeasured picks never invent timing');
  assert.equal(requests[5].viewId, undefined, 'unmeasured picks never imply a reliable view');
});
