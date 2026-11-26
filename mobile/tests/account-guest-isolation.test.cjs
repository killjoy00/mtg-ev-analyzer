const test = require('node:test');
const assert = require('node:assert/strict');
const { compileModule } = require('./support/compile-module.cjs');

const key = 'packone.mobile.session.v2';
const token = id => 'p1_' + id + '.' + 'A'.repeat(43);
const idA = '11111111-1111-4111-8111-111111111111';
const idB = '22222222-2222-4222-8222-222222222222';
const idG = '33333333-3333-4333-8333-333333333333';
const signed = (id = idA) => ({ playerToken: token(id), subjectId: id, accountToken: (id === idA ? 'B' : 'C').repeat(43), accountUser: { id } });
const legacy = (id = idA) => ({ playerToken: token(id), subjectId: id });
const fresh = { playerToken: token(idG), subjectId: idG, guestVerified: true };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
class ApiError extends Error { constructor(status) { super('HTTP ' + status); this.status = status; } }

function fixture(initial, overrides = {}) {
  const values = new Map(initial ? [[key, JSON.stringify(initial)]] : []);
  const calls = [], consent = [], notifications = [];
  const cache = new Map();
  const mocks = {
    'expo-secure-store': {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
      getItemAsync: async name => values.get(name) ?? null,
      setItemAsync: async (name, value) => { values.set(name, value); },
      deleteItemAsync: async name => { values.delete(name); },
    },
    '@/src/config': { config: { screenshots: { fixtures: false } } },
    '@/src/screenshots/session': {},
    '@/src/api/reminders': { clearLocalReminderConsent: async owner => { consent.push(owner); } },
    '@/src/api/client': {
      ApiError,
      requestJson: async (path, options) => {
        calls.push({ path, options });
        if (overrides[path]) return overrides[path](options);
        if (path === '/growth/v1/session') return { token: token(idG), playerId: idG };
        if (path === '/growth/v1/mobile/account/signout') return { ok: true };
        if (path === '/growth/v1/mobile/account/signin') return {
          linked: { token: token(idA), playerId: idA }, user: { id: idA },
          session: { token: signed().accountToken, expiresAt: '2099-01-01' },
        };
        throw Error('Unexpected request: ' + path);
      },
    },
  };
  const storage = compileModule('src/storage/session.ts', mocks, { cache });
  const guest = compileModule('src/api/guest.ts', mocks, { cache });
  const account = compileModule('src/api/account.ts', mocks, { cache });
  storage.subscribeSession(next => notifications.push(next));
  return { storage, guest, account, values, calls, consent, notifications };
}

test('native logout revokes account, clears old identity, and signs in again to the original player', async () => {
  const f = fixture(signed());
  assert.deepEqual(await f.account.signOutMobileAccount(signed()), fresh);
  assert.deepEqual(await f.storage.readSession(), fresh);
  assert.deepEqual(f.notifications, [null, fresh]);
  assert.deepEqual(f.consent, [idA]);
  assert.deepEqual(f.calls.map(c => c.path), ['/growth/v1/mobile/account/signout', '/growth/v1/session']);
  const result = await f.account.signInWithEmail(fresh, 'qa@example.invalid', 'test-password');
  assert.equal(result.session.playerToken, signed().playerToken);
  assert.equal((await f.storage.readSession()).accountToken, signed().accountToken);
  assert.equal(f.calls.at(-1).options.mobileSessionToken, fresh.playerToken);
});

test('expired account and successful password change share fresh guest reset', async () => {
  const f = fixture(signed());
  assert.deepEqual(await f.account.forgetAccountLocally(signed()), fresh);
  assert.equal(f.calls[0].path, '/growth/v1/session');
});

test('already revoked account does not prevent explicit sign-out', async () => {
  const f = fixture(signed(), { '/growth/v1/mobile/account/signout': async () => { throw new ApiError(401); } });
  assert.deepEqual(await f.account.signOutMobileAccount(signed()), fresh);
});

test('old signed-out installations cannot retain a ranked or unranked account player', async () => {
  for (const ranking_identity of [{ eligible: true, reason: null }, { eligible: false, reason: 'username_required' }]) {
    const f = fixture(legacy(), { '/draft/v1/daily-status': async () => ({ ranking_identity }) });
    assert.deepEqual(await f.guest.ensureGuestSession(), fresh);
    assert.deepEqual(await f.storage.readSession(), fresh);
    assert.equal(f.calls.filter(c => c.path === '/growth/v1/session').length, 1);
  }
});

test('genuine pre-update guests keep history and only validate once', async () => {
  const f = fixture(legacy(), { '/draft/v1/daily-status': async () => ({ ranking_identity: { eligible: false, reason: 'guest' } }) });
  const expected = { ...legacy(), guestVerified: true };
  assert.deepEqual(await Promise.all([f.guest.ensureGuestSession(), f.guest.ensureGuestSession()]), [expected, expected]);
  assert.deepEqual(await f.guest.ensureGuestSession(), expected);
  assert.equal(f.calls.length, 1);
});

test('failed guest verification does not wipe real history or expose unverified identity', async () => {
  const f = fixture(legacy(), { '/draft/v1/daily-status': async () => { throw new ApiError(503); } });
  await assert.rejects(f.guest.ensureGuestSession(), /503/);
  assert.deepEqual(await f.storage.readSession(), legacy());
  assert.equal(f.calls.length, 1);
});

test('server logout followed by guest-creation failure leaves no old account identity', async () => {
  const f = fixture(signed(), { '/growth/v1/session': async () => { throw new ApiError(503); } });
  await assert.rejects(f.account.signOutMobileAccount(signed()), /503/);
  assert.equal(await f.storage.readSession(), null);
  assert.deepEqual(f.notifications, [null]);
});

test('a delayed old guest verification cannot replace a newer signed-in account', async () => {
  const waiting = deferred(), started = deferred();
  const f = fixture(legacy(), { '/draft/v1/daily-status': async () => { started.resolve(); return waiting.promise; } });
  const pending = f.guest.ensureGuestSession();
  await started.promise;
  await f.storage.writeSession(signed(idB));
  waiting.resolve({ ranking_identity: { eligible: true, reason: null } });
  assert.deepEqual(await pending, signed(idB));
  assert.deepEqual(await f.storage.readSession(), signed(idB));
  assert.equal(f.calls.filter(c => c.path === '/growth/v1/session').length, 0);
});

test('stale logout/expiry cannot clear a different signed-in account', async () => {
  const f = fixture(signed(idB));
  await assert.rejects(f.account.forgetAccountLocally(signed()), /Account changed/);
  assert.deepEqual(await f.storage.readSession(), signed(idB));
  assert.equal(f.calls.length, 0);
});
