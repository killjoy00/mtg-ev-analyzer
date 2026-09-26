import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSharedRunRecovery,
  SharedRunIdentityChangedError,
} from '../mobile/src/state/sharedRunRecovery.ts';

const SHARE = 'a'.repeat(24);
const RUN = '11111111-1111-4111-8111-111111111111';
const OTHER_RUN = '66666666-6666-4666-8666-666666666666';
const PLAYER = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const OTHER_ACCOUNT = '44444444-4444-4444-8444-444444444444';

function session(account = ACCOUNT) {
  return {
    playerToken: `p1_${PLAYER}.${'A'.repeat(43)}`,
    subjectId: PLAYER,
    accountToken: (account === ACCOUNT ? 'B' : 'C').repeat(43),
    accountUser: { id: account },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  let current = session();
  const records = new Map();
  const calls = [];
  const run = { id: RUN, day: null, revision: 3, answers: [{ score: 88 }], complete: false };
  const key = (share, owner) => `${owner.subjectId}:${owner.accountUser.id}:${share}`;
  const io = {
    async readSession() { return current; },
    async readContinuation(share, owner) { calls.push(['read', share]); return records.get(key(share, owner)) ?? null; },
    async writeContinuation(share, id, owner) { calls.push(['write', share, id]); records.set(key(share, owner), id); },
    async loadRun(id) { calls.push(['get', id]); return { ...run, id }; },
    async startRun(share) { calls.push(['post', share]); return run; },
  };
  return {
    io, calls, run, records,
    current: () => current,
    switchTo: (next) => { current = next; },
    save: (id = RUN, owner = current, share = SHARE) => records.set(key(share, owner), id),
    recovery: () => createSharedRunRecovery(io),
  };
}

const count = (h, method) => h.calls.filter(([kind]) => kind === method).length;

test('opening an invitation does not start a run without explicit acceptance', async () => {
  const h = harness();
  assert.equal(await h.recovery().resume(SHARE, h.current()), null);
  assert.equal(count(h, 'post'), 0);
  assert.equal(count(h, 'get'), 0);
});

test('a recreated coordinator restores the exact saved server UUID and progress', async () => {
  const h = harness();
  await h.recovery().start(SHARE, h.current());
  const restored = await h.recovery().resume(SHARE, h.current());
  assert.equal(restored.id, RUN);
  assert.deepEqual(restored.answers, h.run.answers);
  assert.equal(count(h, 'post'), 1);
  assert.deepEqual(h.calls.filter(([kind]) => kind === 'get'), [['get', RUN]]);
});

test('a completed creator or recipient result is recovered, not restarted', async () => {
  const h = harness();
  h.save();
  h.run.complete = true;
  h.run.score = 88;
  const run = await h.recovery().start(SHARE, h.current());
  assert.equal(run.complete, true);
  assert.equal(run.score, 88);
  assert.equal(count(h, 'post'), 0);
});

for (const message of ['404 missing', 'network timeout', '401 unauthorized']) {
  test(`saved-run GET failure (${message}) cannot fall back to a new POST`, async () => {
    const h = harness();
    h.save();
    h.io.loadRun = async (id) => { h.calls.push(['get', id]); throw new Error(message); };
    const recovery = h.recovery();
    await assert.rejects(recovery.start(SHARE, h.current()), new RegExp(message));
    await assert.rejects(recovery.resume(SHARE, h.current()), new RegExp(message));
    assert.equal(count(h, 'post'), 0);
    assert.equal(h.records.size, 1);
  });
}

test('a failed SecureStore read never creates a run', async () => {
  const h = harness();
  h.io.readContinuation = async () => { throw new Error('locked store'); };
  await assert.rejects(h.recovery().start(SHARE, h.current()), /locked store/);
  assert.equal(count(h, 'post'), 0);
});

test('a failed save after server commit retries the known UUID without another POST', async () => {
  const h = harness();
  const save = h.io.writeContinuation;
  h.io.writeContinuation = async () => { throw new Error('save failed'); };
  const recovery = h.recovery();
  await assert.rejects(recovery.start(SHARE, h.current()), /save failed/);
  h.io.writeContinuation = save;
  const recovered = await recovery.start(SHARE, h.current());
  assert.equal(recovered.id, RUN);
  assert.equal(count(h, 'post'), 1);
  assert.equal(count(h, 'get'), 1);
  assert.equal(h.records.size, 1);
});

test('concurrent accept actions join one in-flight server start', async () => {
  const h = harness();
  const started = deferred();
  const response = deferred();
  h.io.startRun = async (share) => { h.calls.push(['post', share]); started.resolve(); return response.promise; };
  const recovery = h.recovery();
  const first = recovery.start(SHARE, h.current());
  const second = recovery.start(SHARE, h.current());
  await started.promise;
  assert.equal(count(h, 'post'), 1);
  response.resolve(h.run);
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((run) => run.id), [RUN, RUN]);
});

test('a lost start response retries the invitation through server recovery, without a client key', async () => {
  const h = harness();
  let committed = false;
  h.io.startRun = async (...args) => {
    assert.equal(args.length, 2);
    assert.equal(args[0], SHARE);
    h.calls.push(['post', args[0]]);
    if (!committed) { committed = true; throw new Error('response lost after commit'); }
    return h.run;
  };
  const recovery = h.recovery();
  await assert.rejects(recovery.start(SHARE, h.current()), /response lost/);
  assert.equal((await recovery.start(SHARE, h.current())).id, RUN);
  assert.equal(count(h, 'post'), 2);
  assert.equal(h.records.size, 1);
});

test('changing account while start is in flight cannot save or reveal the old account result', async () => {
  const h = harness();
  const started = deferred();
  const response = deferred();
  h.io.startRun = async () => { started.resolve(); return response.promise; };
  const pending = h.recovery().start(SHARE, h.current());
  await started.promise;
  h.switchTo(session(OTHER_ACCOUNT));
  response.resolve(h.run);
  await assert.rejects(pending, SharedRunIdentityChangedError);
  assert.equal(count(h, 'write'), 0);
});

test('changing account during checkpoint lookup prevents a stale GET or POST', async () => {
  const h = harness();
  h.io.readContinuation = async () => { h.switchTo(session(OTHER_ACCOUNT)); return RUN; };
  await assert.rejects(h.recovery().start(SHARE, session()), SharedRunIdentityChangedError);
  assert.equal(count(h, 'get'), 0);
  assert.equal(count(h, 'post'), 0);
});

test('sign-out during saved-run GET prevents stale progress from being returned', async () => {
  const h = harness();
  h.save();
  h.io.loadRun = async () => { h.switchTo({ playerToken: session().playerToken }); return h.run; };
  await assert.rejects(h.recovery().resume(SHARE, session()), SharedRunIdentityChangedError);
});

test('account token rotation invalidates an old request but preserves the stable checkpoint', async () => {
  const h = harness();
  h.save();
  const oldSession = h.current();
  h.switchTo({ ...oldSession, accountToken: 'D'.repeat(43) });
  await assert.rejects(h.recovery().resume(SHARE, oldSession), SharedRunIdentityChangedError);
  assert.equal((await h.recovery().resume(SHARE, h.current())).id, RUN);
  assert.equal(count(h, 'post'), 0);
});

test('another signed-in account does not reuse the first account checkpoint', async () => {
  const h = harness();
  h.save();
  h.switchTo(session(OTHER_ACCOUNT));
  assert.equal(await h.recovery().resume(SHARE, h.current()), null);
  assert.equal(count(h, 'get'), 0);
});

test('guest, invalid share, and conflicting player identity are rejected before IO', async () => {
  const h = harness();
  const recovery = h.recovery();
  await assert.rejects(recovery.start(SHARE, { playerToken: session().playerToken }), /Sign in/);
  await assert.rejects(recovery.start('b'.repeat(12), h.current()), /Invalid shared/);
  await assert.rejects(recovery.start(SHARE, { ...session(), subjectId: OTHER_RUN }), /Sign in/);
  assert.equal(h.calls.length, 0);
});

test('a mismatched server UUID is not accepted and does not replace the checkpoint', async () => {
  const h = harness();
  h.save();
  h.io.loadRun = async () => ({ ...h.run, id: OTHER_RUN });
  await assert.rejects(h.recovery().resume(SHARE, h.current()), /did not match/);
  assert.equal(count(h, 'write'), 0);
  assert.equal(count(h, 'post'), 0);
});

test('a malformed checkpoint or an accidental Daily response fails closed', async () => {
  const h = harness();
  h.save('not-a-run-uuid');
  await assert.rejects(h.recovery().start(SHARE, h.current()), /continuation is invalid/);
  assert.equal(count(h, 'post'), 0);
  h.records.clear();
  h.io.startRun = async () => ({ ...h.run, day: '2026-09-26' });
  await assert.rejects(h.recovery().start(SHARE, h.current()), /valid shared practice run/);
  assert.equal(count(h, 'write'), 0);
});
