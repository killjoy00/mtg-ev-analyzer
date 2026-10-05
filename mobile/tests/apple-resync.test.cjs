const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const PLAYER = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const PRODUCT = 'pro.packone.app.elite.monthly';
const session = (id = ACCOUNT) => ({ playerToken: `p1_${PLAYER}.${'A'.repeat(43)}`, accountToken: 'B'.repeat(43), accountUser: { id } });
const purchase = (overrides = {}) => ({ id: '2000001', transactionId: '2000001', productId: PRODUCT, appAccountToken: ACCOUNT,
  purchaseToken: 'header.payload.signature', isAutoRenewing: true, purchaseState: 'purchased', quantity: 1, store: 'apple',
  transactionDate: 0, ...overrides });

function load(h) {
  const mocks = {
    '@/src/api/apple-subscriptions': {
      APPLE_ELITE_PRODUCT_ID: PRODUCT,
      verifyNativeAppleSubscription: async (value, signed) => {
        h.events.push('verify');
        h.verified.push({ account: value.accountUser.id, signed });
        if (h.verifyError) throw h.verifyError;
        return {};
      },
    },
    '@/src/iap/apple-store': {
      getAvailableApplePurchases: async (options) => { h.events.push('read'); h.reads.push(options); return h.available; },
      finishApplePurchase: async (item) => { h.events.push('finish'); h.finished.push(item.transactionId); },
    },
  };
  const filename = path.join(process.cwd(), 'src/iap/apple-resync.ts');
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  const original = Module._load;
  Module._load = function loadMock(request, parent, isMain) {
    if (Object.hasOwn(mocks, request)) return mocks[request];
    return original.call(this, request, parent, isMain);
  };
  try { compiled._compile(output, filename); } finally { Module._load = original; }
  return compiled.exports;
}

function harness(overrides = {}) {
  const h = { events: [], verified: [], reads: [], finished: [], available: [purchase()], verifyError: null, ...overrides };
  h.sync = load(h);
  return h;
}

test('active Elite subscription is re-verified and finished only after the backend accepts it', async () => {
  const h = harness();
  assert.equal(await h.sync.resyncAppleSubscription(session(), 1_000), 1);
  assert.deepEqual(h.reads, [{ onlyIncludeActiveItemsIOS: true }]);
  assert.deepEqual(h.verified, [{ account: ACCOUNT, signed: 'header.payload.signature' }]);
  assert.deepEqual(h.events, ['read', 'verify', 'finish']);
});

test('another account, another product, or an unbound transaction is never sent', async () => {
  const h = harness({ available: [purchase({ appAccountToken: OTHER }), purchase({ productId: 'other.product' }), purchase({ appAccountToken: null })] });
  assert.equal(await h.sync.resyncAppleSubscription(session(), 1_000), 0);
  assert.deepEqual(h.verified, []);
  assert.deepEqual(h.finished, []);
});

test('guest sessions and signed-out state do nothing', async () => {
  const h = harness();
  assert.equal(await h.sync.resyncAppleSubscription(null, 1_000), 0);
  assert.equal(await h.sync.resyncAppleSubscription({ playerToken: 'p1_guest' }, 1_000), 0);
  assert.deepEqual(h.events, []);
});

test('re-sync is throttled per account but runs at once for a newly signed-in account', async () => {
  const h = harness();
  await h.sync.resyncAppleSubscription(session(), 1_000);
  await h.sync.resyncAppleSubscription(session(), 1_000 + h.sync.APPLE_RESYNC_INTERVAL_MS - 1);
  assert.equal(h.reads.length, 1);
  await h.sync.resyncAppleSubscription(session(OTHER), 2_000);
  assert.equal(h.reads.length, 2);
  await h.sync.resyncAppleSubscription(session(OTHER), 2_000 + h.sync.APPLE_RESYNC_INTERVAL_MS);
  assert.equal(h.reads.length, 3);
});

test('a rejected verification leaves the transaction unfinished and never throws', async () => {
  const h = harness({ verifyError: new Error('rejected') });
  assert.equal(await h.sync.resyncAppleSubscription(session(), 1_000), 0);
  assert.deepEqual(h.finished, []);
});

test('a StoreKit read failure is swallowed', async () => {
  const h = harness();
  h.available = null;
  assert.equal(await h.sync.resyncAppleSubscription(session(), 1_000), 0);
});

test('concurrent triggers share one StoreKit read', async () => {
  const h = harness();
  const [first, second] = await Promise.all([
    h.sync.resyncAppleSubscription(session(), 1_000),
    h.sync.resyncAppleSubscription(session(), 1_000),
  ]);
  assert.equal(first, 1);
  assert.equal(second, 0);
  assert.equal(h.reads.length, 1);
});
