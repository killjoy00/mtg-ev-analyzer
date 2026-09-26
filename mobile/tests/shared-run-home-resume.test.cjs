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

const SHARE = 'a'.repeat(24);
const RUN = '11111111-1111-4111-8111-111111111111';
const PLAYER = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const SESSION = 'packone.mobile.session.v2';
const SAVED = 'packone.mobile.shared-run.v1';
const session = (account = ACCOUNT) => ({
  playerToken: `p1_${PLAYER}.${'A'.repeat(43)}`, subjectId: PLAYER,
  accountToken: (account === ACCOUNT ? 'B' : 'C').repeat(43), accountUser: { id: account },
});
const checkpoint = () => JSON.stringify({ shareId: SHARE, runId: RUN, playerId: PLAYER, accountUserId: ACCOUNT });
const host = (name) => function Host(props) { return React.createElement(name, props, props.children); };
function text(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return Array.isArray(node) ? node.map(text).join(' ') : text(node.children || []);
}
async function flush() { for (let i = 0; i < 50; i += 1) await Promise.resolve(); }
function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}
function compileGraph(mocks) {
  const cache = new Map();
  function load(file) {
    const filename = path.resolve(process.cwd(), file);
    if (cache.has(filename)) return cache.get(filename).exports;
    const compiled = new Module(filename, module);
    compiled.filename = filename;
    compiled.paths = Module._nodeModulePaths(path.dirname(filename));
    cache.set(filename, compiled);
    compiled.require = (request) => {
      if (Object.hasOwn(mocks, request)) return mocks[request];
      const base = request.startsWith('@/') ? path.resolve(process.cwd(), request.slice(2))
        : request.startsWith('.') ? path.resolve(path.dirname(filename), request) : null;
      if (base) {
        const target = [base, `${base}.ts`, `${base}.tsx`].find((item) => fs.existsSync(item) && fs.statSync(item).isFile());
        if (target && /\.tsx?$/.test(target)) return load(target);
      }
      return Module.prototype.require.call(compiled, request);
    };
    compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: filename,
    }).outputText, filename);
    return compiled.exports;
  }
  return load;
}

async function fixture(options = {}) {
  const store = new Map([[SESSION, JSON.stringify(options.session ?? session())]]);
  if (options.saved !== null) store.set(SAVED, options.saved ?? checkpoint());
  let locked = Boolean(options.locked);
  let route = '/';
  let params = {};
  let root;
  let sessionApi;
  const calls = [];
  const ScrollView = React.forwardRef(function ScrollViewHost(props, ref) {
    React.useImperativeHandle(ref, () => ({ scrollTo() {} }), []);
    return React.createElement('ScrollView', props, props.children);
  });
  const Image = host('Image');
  Image.prefetch = async () => {};
  const run = {
    id: RUN, environment: 'mixed', day: null, revision: 3, round: 0, run_length: 8,
    answers: [], complete: false, score: null, rerolls: { set: 0, pack: 0 }, set_reroll_allowed: false,
    leaderboard_eligible: false, current: { puzzle_id: 'saved-puzzle', set_id: 'msh', pack_number: 1, pick_number: 5,
      prior_picks: [], candidates: [{ id: 'a', name: 'Saved Card' }] },
  };
  function navigate(kind, destination) {
    calls.push([kind, destination]);
    route = typeof destination === 'string' ? destination : destination.pathname;
    params = typeof destination === 'string' ? {} : destination.params ?? {};
    root.update(React.createElement(Navigation));
  }
  const mocks = {
    'expo-router': {
      router: { push: (value) => navigate('push', value), replace: (value) => navigate('replace', value) },
      useLocalSearchParams: () => params,
      useFocusEffect(callback) { React.useEffect(callback, [callback]); },
    },
    'react-native': {
      Pressable: host('Pressable'), View: host('View'), Text: host('Text'), ActivityIndicator: host('ActivityIndicator'),
      ScrollView, Modal: (props) => props.visible ? React.createElement('Modal', props, props.children) : null,
      StyleSheet: { create: (value) => value }, AccessibilityInfo: { announceForAccessibility() {} }, Share: { share: async () => {} },
    },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    'expo-image': { Image },
    'expo-haptics': { selectionAsync: async () => {}, notificationAsync: async () => {}, NotificationFeedbackType: { Success: 'success' } },
    'expo-secure-store': {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
      async getItemAsync(key) {
        if (key === SAVED && locked) throw new Error('Secure store is locked.');
        if (key === SAVED && options.delayRead) return options.delayRead.promise;
        return store.get(key) ?? null;
      },
      async setItemAsync(key, value) { store.set(key, value); },
      async deleteItemAsync(key) { store.delete(key); },
    },
    '@/src/api/guest': { ensureGuestSession: async () => sessionApi.readSession() },
    '@/src/api/draftRun': {
      DAILY_ENVIRONMENT_META: Object.fromEntries(['mixed', 'powered-cube', 'latest'].map((id) => [id, { title: id, eyebrow: id, description: id, resultTitle: id }])),
      isDailyEnvironment: (value) => ['mixed', 'powered-cube', 'latest'].includes(value),
      loadDailyStatus: async () => { throw new Error('Home enrichment offline.'); },
      loadDraftRun: async (id, current) => { calls.push(['get', id, current.accountUser.id]); return run; },
      loadSharedDraftRunInfo: async () => { calls.push(['preview']); throw new Error('Saved run should not need invitation preview.'); },
      startSharedDraftRun: async () => { calls.push(['start']); throw new Error('Resume must never start another run.'); },
      startDailyDraftRun: async () => { calls.push(['daily']); throw new Error('Resume is not a Daily.'); },
    },
    '@/src/hooks/useAppResume': { useAppResume() {} },
    '@/src/storage/idempotency': { clearPracticeIdempotencyKey: async () => {}, practiceIdempotencyKey: async () => { throw new Error('No practice key.'); } },
    '@/src/theme': { colors: new Proxy({}, { get: () => '#000' }), spacing: new Proxy({}, { get: () => 8 }) },
  };
  const load = compileGraph(mocks);
  sessionApi = load('src/storage/session.ts');
  const Home = load('app/index.tsx').default;
  const Resume = load('app/resume-shared-run.tsx').default;
  const Shared = load('app/shared-run.tsx').default;
  function Navigation() {
    if (route === '/') return React.createElement(Home);
    if (route === '/shared-run') return React.createElement(Shared);
    // The native Stack retains the previous Resume route beneath Account.
    return React.createElement(React.Fragment, null, React.createElement(Resume),
      route === '/account' ? React.createElement('Text', null, 'Account sign-in boundary') : null);
  }
  await act(async () => { root = Renderer.create(React.createElement(Navigation)); await flush(); });
  const button = (label) => root.root.findAll((node) => node.type === 'Pressable' && (node.props.accessibilityLabel === label || text(node).trim() === label)).at(-1);
  return {
    calls, store,
    text: () => text(root.toJSON()),
    async press(label) {
      const target = button(label);
      assert.ok(target, `Missing button: ${label}`);
      await act(async () => { target.props.onPress(); await flush(); });
    },
    async writeSession(next) { await act(async () => { await sessionApi.writeSession(next); await flush(); }); },
    unlock() { locked = false; },
    async close() { await act(async () => root.unmount()); },
  };
}

test('fresh Home opens the stored shared run without the invitation URL, even if Daily enrichment fails', async () => {
  const h = await fixture();
  try {
    await h.press('Resume saved shared run');
    assert.match(h.text(), /Saved Card/);
    assert.deepEqual(h.calls.find(([kind]) => kind === 'get'), ['get', RUN, ACCOUNT]);
    assert.equal(h.calls.some(([kind]) => ['start', 'daily', 'preview'].includes(kind)), false);
    const destination = h.calls.find(([kind]) => kind === 'replace')[1];
    assert.deepEqual(destination, { pathname: '/shared-run', params: { shared: SHARE } });
    assert.equal(JSON.stringify(destination).includes(RUN), false);
  } finally { await h.close(); }
});

for (const saved of [null, 'malformed checkpoint']) {
  test(`Home recovery handles ${saved === null ? 'missing' : 'corrupt'} storage without creating a run`, async () => {
    const h = await fixture({ saved });
    try {
      await h.press('Resume saved shared run');
      assert.match(h.text(), /No shared run is saved for this account/);
      assert.equal(h.calls.some(([kind]) => ['get', 'start', 'replace'].includes(kind)), false);
    } finally { await h.close(); }
  });
}

test('another account cannot discover the previous account checkpoint from Home', async () => {
  const h = await fixture({ session: session(OTHER) });
  try {
    await h.press('Resume saved shared run');
    assert.match(h.text(), /No shared run is saved for this account/);
    assert.equal(h.calls.some(([kind]) => kind === 'get' || kind === 'replace'), false);
    assert.equal(h.store.get(SAVED), checkpoint());
  } finally { await h.close(); }
});

test('guest recovery requests sign-in and a saved same-account session resumes afterward', async () => {
  const h = await fixture({ session: { playerToken: session().playerToken, subjectId: PLAYER } });
  try {
    await h.press('Resume saved shared run');
    assert.match(h.text(), /Sign in to the same Pack One account/);
    await h.press('Sign in to recover your run');
    await h.writeSession(session());
    assert.match(h.text(), /Saved Card/);
    assert.equal(h.calls.some(([kind]) => kind === 'start'), false);
  } finally { await h.close(); }
});

test('an identity change during discovery cannot route to the previous account run', async () => {
  const read = deferred();
  const h = await fixture({ delayRead: read });
  try {
    await h.press('Resume saved shared run');
    await h.writeSession(session(OTHER));
    await act(async () => { read.resolve(checkpoint()); await flush(); });
    assert.equal(h.calls.some(([kind]) => kind === 'replace' || kind === 'get'), false);
    assert.match(h.text(), /No shared run is saved for this account/);
  } finally { await h.close(); }
});

test('locked storage keeps the checkpoint and offers a read-only retry', async () => {
  const h = await fixture({ locked: true });
  try {
    await h.press('Resume saved shared run');
    assert.match(h.text(), /Secure store is locked/);
    assert.equal(h.store.get(SAVED), checkpoint());
    h.unlock();
    await h.press('Try again');
    assert.match(h.text(), /Saved Card/);
    assert.equal(h.calls.some(([kind]) => kind === 'start'), false);
  } finally { await h.close(); }
});

test('a player-token and subject mismatch cannot discover a checkpoint', async () => {
  const h = await fixture({ session: { ...session(), subjectId: OTHER } });
  try {
    await h.press('Resume saved shared run');
    assert.match(h.text(), /No shared run is saved for this account/);
    assert.equal(h.calls.some(([kind]) => kind === 'get' || kind === 'replace'), false);
  } finally { await h.close(); }
});
