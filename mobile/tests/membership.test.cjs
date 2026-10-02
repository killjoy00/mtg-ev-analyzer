const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
const { act } = Renderer;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PLAYER = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const session = (id = ACCOUNT) => ({ playerToken: `p1_${PLAYER}.${'A'.repeat(43)}`, subjectId: PLAYER,
  accountToken: (id === ACCOUNT ? 'B' : 'C').repeat(43), accountUser: { id } });
const data = (overrides = {}) => ({ configured: true, connected: false, ad_free: false, ads_allowed: true, capabilities: [],
  account_capabilities: ['account', 'unlimited_regular_practice', 'custom_corpus', 'unlimited_cube_practice'],
  account_user_id: ACCOUNT, player_id: PLAYER, checked_at: '2026-09-26T17:00:00Z', membership: null, ...overrides });
const connected = (overrides = {}) => data({ connected: true, capabilities: ['custom_corpus', 'unlimited_cube_practice'],
  membership: { effective_state: 'elite_entitled', sync_pending: false, last_synced_at: '2026-09-26T17:00:00Z' }, ...overrides });
const APPLE_PRODUCT = 'pro.packone.app.elite.monthly';
const appleData = (overrides = {}) => ({ configured: true, product_id: APPLE_PRODUCT,
  subscription: { linked: false, active: false, provider: 'apple-app-store', productId: APPLE_PRODUCT },
  account_capabilities: ['account', 'unlimited_regular_practice'], checked_at: '2026-09-26T17:00:00Z', ...overrides });
const authorize = () => 'https://www.patreon.com/oauth2/authorize?' + new URLSearchParams({ response_type: 'code',
  client_id: 'fixture', scope: 'identity', state: 'm_' + 'a'.repeat(64),
  redirect_uri: 'https://br-orange-feather-ayps8kep-pack1growth.compute.c-5.us-east-2.aws.neon.tech/v1/patreon/callback' });
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const host = (name) => function Host(props) { return React.createElement(name, props, props.children); };
function text(node) { if (node == null) return ''; if (typeof node === 'string' || typeof node === 'number') return String(node); if (Array.isArray(node)) return node.map(text).join(' '); return text(node.children || []); }
const drain = () => new Promise((resolve) => setImmediate(resolve));

async function mount(t, options = {}) {
  const listeners = new Set();
  const h = { current: options.session === undefined ? session() : options.session, value: options.data || data(),
    appleValue: options.appleData || appleData(), calls: [], opened: [], alerts: [], routes: [], resumes: [],
    handler: options.handler, browser: options.browser, platform: options.platform || 'ios', links: [],
    iapFetches: [], iapRequests: [], iapFinishes: [], iapRestores: [], iapAvailable: options.iapAvailable || [],
    iapSubscriptions: options.iapSubscriptions || [{ id: APPLE_PRODUCT, platform: 'ios', displayPrice: '$4.99',
      subscriptionPeriodNumberIOS: '1', subscriptionPeriodUnitIOS: 'month' }], iapEvents: [] };
  h.iap = {
    connected: options.iapConnected !== false,
    subscriptions: h.iapSubscriptions,
    fetchProducts: async (request) => { h.iapFetches.push(request); },
    requestPurchase: async (request) => {
      h.iapRequests.push(request);
      h.iapEvents.push('request');
      if (options.purchaseError) {
        h.iapOptions?.onPurchaseError?.(options.purchaseError);
        return null;
      }
      if (options.purchase) h.iapOptions?.onPurchaseSuccess?.(options.purchase);
      return options.purchase || null;
    },
    finishTransaction: async ({ purchase }) => { h.iapEvents.push('finish'); h.iapFinishes.push(purchase); },
    restorePurchases: async (request) => { h.iapEvents.push('restore'); h.iapRestores.push(request); },
  };
  const mocks = {
    '@/src/iap/apple-store': {
      useAppleStore: (iapOptions) => { h.iapOptions = iapOptions; return h.iap; },
      getAvailableApplePurchases: async () => h.iapAvailable,
      openAppleSubscriptionManagement: async () => { h.links.push('apple-subscriptions'); },
    },
    'expo-router': { router: { push: (route) => h.routes.push(route) },
      useFocusEffect: (callback) => React.useEffect(callback, [callback]),
      Stack: Object.assign(host('Stack'), { Screen: host('Screen') }) },
    'expo-status-bar': { StatusBar: host('StatusBar') },
    'expo-web-browser': { openBrowserAsync: async (url) => { h.opened.push(url); return h.browser ? h.browser(url) : { type: 'cancel' }; } },
    'react-native': { ActivityIndicator: host('ActivityIndicator'), Pressable: host('Pressable'), ScrollView: host('ScrollView'),
      Text: host('Text'), View: host('View'), StyleSheet: { create: (value) => value }, Alert: { alert: (...args) => h.alerts.push(args) },
      Platform: { OS: h.platform }, Linking: { openURL: async (url) => { h.links.push(url); return true; } } },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/hooks/useAppResume': { useAppResume: (callback) => { h.resumes[0] = callback; } },
    '@/src/storage/session': { readSession: async () => h.current,
      subscribeSession: (callback) => { listeners.add(callback); return () => listeners.delete(callback); } },
    '@/src/api/client': { requestJson: async (route, config) => {
      h.calls.push({ route, config });
      if (h.handler) { const result = h.handler(route, config); if (result !== undefined) return result; }
      if (route.includes('/apple-subscriptions/')) {
        if (route.endsWith('/verify')) h.iapEvents.push('verify');
        if (route.endsWith('/verify')) return { ...h.appleValue, verified: true };
        return h.appleValue;
      }
      if (route.endsWith('/status')) return h.value;
      if (route.endsWith('/connect')) return { url: authorize() };
      return { ok: true, requested: true };
    } },
    '@/src/components/VersionGate': { VersionGate: ({ children }) => children },
    '@/src/components/ScreenErrorBoundary': { ScreenErrorBoundary: host('ErrorBoundary') },
    '@/src/theme': { colors: new Proxy({}, { get: () => '#000' }), spacing: new Proxy({}, { get: () => 8 }) },
  };
  const cache = new Map();
  const original = Module._load;
  const compile = (relative) => {
    const filename = path.join(process.cwd(), relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const compiled = new Module(filename, module);
    compiled.filename = filename; compiled.paths = Module._nodeModulePaths(path.dirname(filename)); cache.set(filename, compiled);
    const prior = Module._load;
    Module._load = function load(request, parent, isMain) {
      if (Object.hasOwn(mocks, request)) return mocks[request];
      if (request.startsWith('@/')) return compile(request.slice(2) + '.ts');
      return original.call(this, request, parent, isMain);
    };
    try { compiled._compile(output, filename); } finally { Module._load = prior; }
    return compiled.exports;
  };
  h.compile = compile;
  const Screen = compile('app/membership.tsx').default;
  await act(async () => { h.root = Renderer.create(React.createElement(Screen)); await drain(); });
  t.after(async () => { await act(async () => h.root.unmount()); });
  h.text = () => text(h.root.toJSON());
  h.press = async (label) => {
    const button = h.root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === label)[0];
    assert.ok(button, 'Expected button: ' + label);
    await act(async () => { button.props.onPress(); await drain(); });
  };
  h.switchAccount = async (next, nextData) => { await act(async () => { h.current = next; if (nextData) h.value = nextData; for (const listener of listeners) listener(next); await drain(); }); };
  h.posts = (action) => h.calls.filter(({ route, config }) => route.endsWith('/' + action) && config.method === 'POST');
  return h;
}

test('non-Patreon additional access is shown independently from an unconnected Patreon', async (t) => {
  const h = await mount(t);
  assert.match(h.text(), /Additional practice access active/);
  assert.match(h.text(), /No Patreon account is connected/);
  assert.equal(h.posts('connect').length, 0);
});

test('partial capabilities are not mislabeled full access or Free', async (t) => {
  const h = await mount(t, { data: data({ account_capabilities: ['account', 'unlimited_regular_practice', 'custom_corpus'] }) });
  assert.match(h.text(), /Additional practice access/);
  assert.doesNotMatch(h.text(), /Additional practice access active|Free member/);
});

test('loading, timeout and retry never turn unknown membership into Free', async (t) => {
  const pending = deferred();
  const h = await mount(t, { handler: (route) => route.endsWith('/status') ? pending.promise : undefined });
  assert.match(h.text(), /Account access not verified/);
  await act(async () => { pending.reject(Error('Status timeout')); await drain(); });
  assert.match(h.text(), /Status timeout/);
  assert.doesNotMatch(h.text(), /Additional practice access active|Free member/);
  h.handler = null;
  await h.press('Check membership status');
  assert.match(h.text(), /Additional practice access active/);
});

test('expired or revoked Patreon grants do not erase current grants from another provider', async (t) => {
  const h = await mount(t, { data: connected({ capabilities: [] }) });
  assert.match(h.text(), /Additional practice access active/);
  assert.match(h.text(), /Patreon is connected, but Elite is not currently active/);
});

test('refresh has explicit pending semantics and never reports completed reconciliation', async (t) => {
  const h = await mount(t, { data: connected() });
  h.value = connected({ membership: { effective_state: 'elite_entitled', sync_pending: true } });
  await h.press('Refresh Patreon access');
  assert.deepEqual(h.posts('refresh')[0].config.body, { confirm: true });
  assert.match(h.text(), /Refresh requested/);
  assert.match(h.text(), /still updating your membership/);
  assert.doesNotMatch(h.text(), /successfully refreshed|membership status refreshed/);
});

test('failed refresh is exposed and access becomes unverified rather than Free', async (t) => {
  const h = await mount(t, { data: connected() });
  h.handler = (route) => { if (route.endsWith('/refresh')) throw Error('Provider unavailable'); };
  await h.press('Refresh Patreon access');
  assert.match(h.text(), /Provider unavailable/);
  assert.match(h.text(), /Account access not verified/);
});

test('Patreon stays passive while iOS exposes Apple-native Elite billing', async (t) => {
  const h = await mount(t);
  const copy = h.text();
  assert.match(copy, /Pack One Elite with Apple/);
  assert.match(copy, /Subscribe with Apple/);
  assert.match(copy, /Sign in with Patreon connects an existing Patreon account/);
  assert.match(copy, /Patreon membership changes remain managed through Patreon/);
  assert.doesNotMatch(copy, /join Patreon|upgrade with Patreon/i);
  const patreon = h.root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Connect Patreon')[0];
  assert.ok(patreon);
});

test('browser cancellation is not reported as successful connection', async (t) => {
  const h = await mount(t);
  await h.press('Connect Patreon');
  assert.equal(h.opened.length, 1);
  assert.match(h.text(), /No Patreon account is connected/);
  assert.match(h.text(), /Only the checked account status/);
  assert.doesNotMatch(h.text(), /successfully connected|membership status refreshed/);
});

test('a failed status read after browser return cannot report a verified connection', async (t) => {
  const h = await mount(t);
  h.browser = async () => { h.handler = (route) => { if (route.endsWith('/status')) throw Error('Read failed after browser'); }; return { type: 'dismiss' }; };
  await h.press('Sign in with Patreon');
  assert.match(h.text(), /Read failed after browser/);
  assert.match(h.text(), /Account access not verified/);
});

test('untrusted authorize destinations are blocked before opening the browser', async (t) => {
  const h = await mount(t);
  h.handler = (route) => route.endsWith('/connect') ? { url: authorize().replace('www.patreon.com', 'attacker.example') } : undefined;
  await h.press('Sign in with Patreon');
  assert.equal(h.opened.length, 0);
  assert.match(h.text(), /could not be verified/);
});

test('a stale status result cannot replace a new account result', async (t) => {
  const pending = deferred();
  const h = await mount(t, { handler: (route) => route.endsWith('/status') ? pending.promise : undefined });
  h.handler = null;
  await h.switchAccount(session(OTHER), data({ account_user_id: OTHER, account_capabilities: ['account', 'unlimited_regular_practice'] }));
  await act(async () => { pending.resolve(data()); await drain(); });
  assert.match(h.text(), /Regular practice access/);
  assert.doesNotMatch(h.text(), /Additional practice access active/);
});

test('signing out during the browser flow discards its late result', async (t) => {
  const pending = deferred();
  const h = await mount(t, { browser: () => pending.promise });
  await h.press('Sign in with Patreon');
  await h.switchAccount({ playerToken: session().playerToken });
  await act(async () => { pending.resolve({ type: 'cancel' }); await drain(); });
  assert.match(h.text(), /Sign in to manage membership/);
  assert.doesNotMatch(h.text(), /Additional practice access active|Only the checked account status/);
});

test('duplicate connection taps join no second mutation', async (t) => {
  const pending = deferred();
  const h = await mount(t, { browser: () => pending.promise });
  const button = h.root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Sign in with Patreon')[0];
  await act(async () => { button.props.onPress(); button.props.onPress(); await drain(); });
  assert.equal(h.posts('connect').length, 1);
  await act(async () => { pending.resolve({ type: 'cancel' }); await drain(); });
});

test('disconnect requires confirmation and preserves other-provider access', async (t) => {
  const h = await mount(t, { data: connected() });
  await h.press('Disconnect Patreon');
  assert.equal(h.posts('disconnect').length, 0);
  h.value = data();
  const confirm = h.alerts[0][2].find((item) => item.text === 'Disconnect');
  await act(async () => { confirm.onPress(); await drain(); });
  assert.equal(h.posts('disconnect').length, 1);
  assert.match(h.text(), /Patreon disconnected/);
  assert.match(h.text(), /Additional practice access active/);
});

test('an old confirmation cannot disconnect a newly signed-in account', async (t) => {
  const h = await mount(t, { data: connected() });
  await h.press('Disconnect Patreon');
  const confirm = h.alerts[0][2].find((item) => item.text === 'Disconnect');
  await h.switchAccount(session(OTHER), connected({ account_user_id: OTHER }));
  await act(async () => { confirm.onPress(); await drain(); });
  assert.equal(h.posts('disconnect').length, 0);
  assert.match(h.text(), /account changed/);
});

test('malformed and wrong-account payloads are never interpreted as entitlements', async (t) => {
  const h = await mount(t, { data: data({ account_user_id: OTHER }) });
  assert.match(h.text(), /did not match the current account/);
  assert.doesNotMatch(h.text(), /Additional practice access active/);
  h.value = {};
  await h.press('Check membership status');
  assert.match(h.text(), /Account access not verified/);
});

test('membership browser return does not request or overwrite Account profile enrichment', async (t) => {
  const h = await mount(t);
  await h.press('Sign in with Patreon');
  assert.ok(h.calls.filter(({ route }) => route.includes('/patreon/')).every(({ route }) => route.startsWith('/growth/v1/patreon/mobile/')));
  assert.equal(h.calls.filter(({ route, config }) => route.includes('/apple-subscriptions/') && config.method === 'POST').length, 0);
  const layout = h.compile('app/_layout.tsx').default;
  let tree;
  await act(async () => { tree = Renderer.create(React.createElement(layout)); });
  const accountRoute = tree.root.findAll((node) => node.type === 'Screen' && node.props.name === 'account')[0];
  assert.equal(accountRoute.props.options.headerRight, undefined, 'Account no longer owns a Membership header action');
  const accountSource = fs.readFileSync(path.join(process.cwd(), 'app/account.tsx'), 'utf8');
  assert.match(accountSource, /router\.push\('\/membership'\)/, 'Account home keeps the Membership row as the navigation entry');
  await act(async () => tree.unmount());
});


test('iOS Apple purchase binds StoreKit to the Pack One account and finishes only after server verification', async (t) => {
  const purchase = { id: 'tx-1', transactionId: '200000000000001', productId: APPLE_PRODUCT,
    purchaseToken: 'a'.repeat(80) + '.' + 'b'.repeat(80) + '.' + 'c'.repeat(80), appAccountToken: ACCOUNT,
    isAutoRenewing: true, purchaseState: 'purchased', quantity: 1, store: 'apple', transactionDate: Date.now() };
  const h = await mount(t, { data: data({ account_capabilities: ['account', 'unlimited_regular_practice'] }), purchase });
  h.appleValue = appleData({ subscription: { linked: true, active: true, provider: 'apple-app-store',
    productId: APPLE_PRODUCT, status: 'active', expiresAt: '2026-10-26T17:00:00Z' },
    account_capabilities: ['account', 'unlimited_regular_practice', 'custom_corpus', 'unlimited_cube_practice'] });
  await h.press('Subscribe to Pack One Elite with Apple');
  assert.equal(h.iapRequests.length, 1);
  assert.equal(h.iapRequests[0].type, 'subs');
  assert.equal(h.iapRequests[0].request.apple.sku, APPLE_PRODUCT);
  assert.equal(h.iapRequests[0].request.apple.appAccountToken, ACCOUNT);
  assert.equal(h.iapRequests[0].request.google, undefined);
  assert.deepEqual(h.iapEvents.slice(-3), ['request', 'verify', 'finish']);
  assert.equal(h.iapFinishes.length, 1);
  assert.match(h.text(), /Elite access is active/);
});

test('failed Pack One verification leaves the StoreKit transaction unfinished', async (t) => {
  const purchase = { id: 'tx-2', transactionId: '200000000000002', productId: APPLE_PRODUCT,
    purchaseToken: 'a'.repeat(80) + '.' + 'b'.repeat(80) + '.' + 'c'.repeat(80), appAccountToken: ACCOUNT,
    isAutoRenewing: true, purchaseState: 'purchased', quantity: 1, store: 'apple', transactionDate: Date.now() };
  const h = await mount(t, { data: data({ account_capabilities: ['account', 'unlimited_regular_practice'] }), purchase,
    handler: (route) => { if (route.endsWith('/apple-subscriptions/mobile/verify')) throw Error('Server verification failed'); } });
  await h.press('Subscribe to Pack One Elite with Apple');
  assert.equal(h.iapFinishes.length, 0);
  assert.match(h.text(), /Server verification failed/);
});

test('Restore Purchases verifies the signed Apple transaction before finishing it', async (t) => {
  const purchase = { id: 'tx-3', transactionId: '200000000000003', productId: APPLE_PRODUCT,
    purchaseToken: 'a'.repeat(80) + '.' + 'b'.repeat(80) + '.' + 'c'.repeat(80), appAccountToken: ACCOUNT,
    isAutoRenewing: true, purchaseState: 'purchased', quantity: 1, store: 'apple', transactionDate: Date.now() };
  const h = await mount(t, { data: data({ account_capabilities: ['account', 'unlimited_regular_practice'] }), iapAvailable: [purchase] });
  h.appleValue = appleData({ subscription: { linked: true, active: true, provider: 'apple-app-store',
    productId: APPLE_PRODUCT, status: 'active', expiresAt: '2026-10-26T17:00:00Z' },
    account_capabilities: ['account', 'unlimited_regular_practice', 'custom_corpus', 'unlimited_cube_practice'] });
  await h.press('Restore Apple purchases');
  assert.equal(h.iapRestores.length, 1);
  assert.deepEqual(h.iapEvents.slice(-3), ['restore', 'verify', 'finish']);
  assert.equal(h.iapFinishes.length, 1);
  assert.match(h.text(), /restored subscription|Elite access is active/);
});

test('Android keeps Apple billing out of the native membership surface', async (t) => {
  const h = await mount(t, { platform: 'android' });
  assert.doesNotMatch(h.text(), /Pack One Elite with Apple|Subscribe with Apple|Restore Purchases/);
  assert.match(h.text(), /Sign in with Patreon/);
});
