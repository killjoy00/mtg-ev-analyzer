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
const OTHER_SHARE = 'b'.repeat(24);
const RUN = '11111111-1111-4111-8111-111111111111';
const PLAYER = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const OTHER_ACCOUNT = '44444444-4444-4444-8444-444444444444';
const SESSION_KEY = 'packone.mobile.session.v2';
const CHECKPOINT_KEY = 'packone.mobile.shared-run.v1';
const signedSession = (id = ACCOUNT) => ({
  playerToken: `p1_${PLAYER}.${'A'.repeat(43)}`, subjectId: PLAYER,
  accountToken: (id === ACCOUNT ? 'B' : 'C').repeat(43), accountUser: { id, email: 'qa@example.invalid' },
});
const guestSession = () => ({ playerToken: signedSession().playerToken, subjectId: PLAYER });
const clone = (value) => structuredClone(value);
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const host = (name) => function Host(props) { return React.createElement(name, props, props.children); };
const ScrollView = React.forwardRef(function ScrollViewHost(props, ref) {
  React.useImperativeHandle(ref, () => ({ scrollTo() {} }), []);
  return React.createElement('ScrollView', props, props.children);
});
function text(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  return text(node.children || []);
}
async function flush() {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

// Compile the actual route, Account, DraftRun, coordinator and SecureStore modules.
// Only platform primitives and API transport are mocked; no copied state machine.
function compileGraph(mocks) {
  const cache = new Map();
  const root = process.cwd();
  function load(filename) {
    const absolute = path.resolve(root, filename);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const source = fs.readFileSync(absolute, 'utf8');
    const compiled = new Module(absolute, module);
    compiled.filename = absolute;
    compiled.paths = Module._nodeModulePaths(path.dirname(absolute));
    cache.set(absolute, compiled);
    compiled.require = (request) => {
      if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
      const base = request.startsWith('@/') ? path.join(root, request.slice(2))
        : request.startsWith('.') ? path.resolve(path.dirname(absolute), request) : null;
      if (base) {
        const candidate = [base, `${base}.ts`, `${base}.tsx`].find((file) => fs.existsSync(file) && fs.statSync(file).isFile());
        if (candidate && /\.tsx?$/.test(candidate)) return load(candidate);
      }
      return Module.prototype.require.call(compiled, request);
    };
    compiled._compile(ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: absolute,
    }).outputText, absolute);
    return compiled.exports;
  }
  return load;
}

function puzzle(index) {
  return { puzzle_id: `puzzle-${index}`, set_id: 'msh', pack_number: 1, pick_number: index + 1,
    prior_picks: [{ id: 'pool-card', name: 'Earlier Card', image_url: 'https://example.invalid/pool.jpg' }],
    candidates: [{ id: 'a', name: 'Card A' }, { id: 'b', name: 'Card B' }] };
}
function answer(index, score = 88) {
  return { score, selectedId: 'a', selectedName: 'Card A', historicalId: 'b', historicalName: 'Card B', historicalMatch: false, puzzle: puzzle(index) };
}
function run(count = 0, complete = false) {
  return { id: RUN, environment: 'mixed', day: null, revision: count, round: count, run_length: 8,
    complete, score: complete ? 88 : null, leaderboard_eligible: false,
    answers: Array.from({ length: count }, (_, index) => answer(index)), current: complete ? null : puzzle(count),
    rerolls: { set: 0, pack: 0 }, set_reroll_allowed: false, custom_set_ids: [],
    comparison: complete ? { name: 'Opponent', score: 82, exact: true } : null };
}

async function fixture(options = {}) {
  const store = options.store ?? new Map();
  if (!store.has(SESSION_KEY)) store.set(SESSION_KEY, JSON.stringify(options.guest ? guestSession() : signedSession()));
  const calls = [];
  const resumes = new Set();
  const focuses = new Set();
  let params = { shared: options.share ?? SHARE };
  let server = options.run ?? run();
  let sessionApi;
  let storageApi;
  let load;
  let Screen;
  let AccountScreen;
  let accountVisible = false;
  let root;
  function TestApp() {
    return React.createElement(React.Fragment, null,
      React.createElement(Screen),
      accountVisible ? React.createElement(AccountScreen) : null);
  }
  let failSave = options.failSave ?? false;
  const Image = host('Image');
  Image.prefetch = async () => {};
  const finishAuth = async () => {
    const session = signedSession();
    await sessionApi.writeSession(session);
    return { session, result: { session: {}, linked: {} } };
  };
  const mocks = {
    'expo-haptics': { selectionAsync: async () => {}, notificationAsync: async () => {}, NotificationFeedbackType: { Success: 'success' } },
    'expo-image': { Image },
    'expo-router': {
      router: {
        push(value) {
          calls.push(['push', value]);
          if (value.pathname === '/account' || value === '/account') {
            accountVisible = true;
            root.update(React.createElement(TestApp));
          }
        },
        replace(value) {
          calls.push(['replace', value]);
          accountVisible = false;
          if (value.params?.shared) params = { shared: value.params.shared };
          root.update(React.createElement(TestApp));
        },
      },
      useLocalSearchParams: () => params,
      useFocusEffect(callback) {
        React.useEffect(() => {
          const entry = { callback, cleanup: callback() };
          focuses.add(entry);
          return () => { focuses.delete(entry); entry.cleanup?.(); };
        }, [callback]);
      },
    },
    'expo-web-browser': {
      maybeCompleteAuthSession() {},
      openAuthSessionAsync: async (url) => ({ type: 'success', url: `packone://account?${url.includes('apple') ? 'apple' : 'google'}Handoff=fixture` }),
    },
    'expo-apple-authentication': {},
    'expo-secure-store': {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
      async getItemAsync(key) { return store.get(key) ?? null; },
      async setItemAsync(key, value) {
        if (key === CHECKPOINT_KEY && failSave) throw new Error('Checkpoint save failed.');
        store.set(key, value);
      },
      async deleteItemAsync(key) { store.delete(key); },
    },
    'react-native': {
      AccessibilityInfo: { announceForAccessibility: (value) => calls.push(['announce', value]) },
      ActivityIndicator: host('ActivityIndicator'),
      Modal: (props) => props.visible ? React.createElement('Modal', props, props.children) : null,
      Pressable: host('Pressable'), ScrollView, Text: host('Text'), TextInput: host('TextInput'), View: host('View'),
      StyleSheet: { create: (value) => value }, Platform: { OS: 'android' }, Alert: { alert() {} },
      Share: { share: async (value) => calls.push(['share', value]) },
    },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/api/client': { ApiError: class ApiError extends Error {} },
    '@/src/api/guest': { ensureGuestSession: async () => sessionApi.readSession() },
    '@/src/api/account': {
      signInWithEmail: async () => { calls.push(['email-auth']); return finishAuth(); },
      loadMobileAccount: async () => { throw new Error('Account details offline.'); },
      startGoogleSignIn: async () => ({ url: 'https://example.invalid/google' }),
      finishGoogleSignIn: async () => { calls.push(['google-auth']); return finishAuth(); },
      startAppleSignIn: async () => ({ url: 'https://example.invalid/apple', flowToken: 'flow' }),
      finishAppleSignIn: async () => { calls.push(['apple-auth']); return finishAuth(); },
    },
    '@/src/api/career': { loadMobileCareer: async () => { throw new Error('Career enrichment offline.'); } },
    '@/src/api/draftRun': {
      DAILY_ENVIRONMENT_META: {
        mixed: { eyebrow: 'DAILY DRAFT RUN', resultTitle: 'Daily complete.' },
        latest: { eyebrow: 'LATEST SET DAILY', resultTitle: 'Latest complete.' },
        'powered-cube': { eyebrow: 'POWERED CUBE DAILY', resultTitle: 'Cube complete.' },
      },
      isDailyEnvironment: (value) => ['mixed', 'latest', 'powered-cube'].includes(value),
      loadSetCatalog: async () => { throw new Error('Catalog enrichment offline.'); },
      loadSharedDraftRunInfo: async (id) => {
        calls.push(['info', id]);
        if (options.loadInfo) return options.loadInfo(id);
        return { id, name: id === SHARE ? 'Opponent' : 'Other invitation', score: 82, scores: [], run_length: 8, environment: server.environment };
      },
      startSharedDraftRun: async (session, id) => {
        calls.push(['start', id, session.accountUser.id]);
        if (options.startRun) return options.startRun(id, session);
        return clone(server);
      },
      loadDraftRun: async (id, session) => {
        calls.push(['get', id, session.accountUser.id]);
        if (options.loadRun) return options.loadRun(id, session);
        return clone(server);
      },
      submitDraftRunPick: async (current, cardId, session) => {
        calls.push(['pick', current.id, cardId, current.revision, session.accountUser.id]);
        if (options.submitPick) return options.submitPick(current, cardId, session);
        server = run(current.answers.length + 1, current.answers.length + 1 === 8);
        if (options.lostPick) throw new Error('Pick response lost after commit.');
        return clone(server);
      },
      createDraftRunShare: async (id) => { calls.push(['create-share', id]); return { id: SHARE }; },
      startDailyDraftRun: async () => { calls.push(['daily']); throw new Error('A shared link must not start a Daily.'); },
      startPracticeDraftRun: async () => { calls.push(['practice']); throw new Error('A shared link must not start random practice.'); },
      rerollDraftRun: async () => { calls.push(['reroll']); throw new Error('Shared runs cannot reroll.'); },
    },
    '@/src/hooks/useAppResume': {
      useAppResume(callback) {
        const ref = React.useRef(callback);
        ref.current = callback;
        React.useEffect(() => {
          const invoke = () => ref.current();
          resumes.add(invoke);
          return () => resumes.delete(invoke);
        }, []);
      },
    },
    '@/src/storage/idempotency': { clearPracticeIdempotencyKey: async () => {}, practiceIdempotencyKey: async () => { throw new Error('No client practice key for shared runs.'); } },
    '@/src/theme': { colors: new Proxy({}, { get: () => '#000' }), spacing: new Proxy({}, { get: () => 8 }) },
  };
  function freshRuntime() {
    load = compileGraph(mocks);
    sessionApi = load('src/storage/session.ts');
    storageApi = load('src/storage/sharedRun.ts');
    Screen = load('app/shared-run.tsx').default;
    AccountScreen = load('app/account.tsx').default;
  }
  freshRuntime();
  if (options.checkpoint) await storageApi.writeSharedRunContinuation(SHARE, RUN, signedSession());
  await act(async () => { root = Renderer.create(React.createElement(TestApp)); await flush(); });
  const button = (label) => root.root.findAll((node) => node.type === 'Pressable' && (node.props.accessibilityLabel === label || text(node).trim() === label)).at(-1);
  return {
    calls, store,
    get root() { return root; },
    text: () => text(root.toJSON()),
    count: (method) => calls.filter(([kind]) => kind === method).length,
    button,
    async press(label) {
      const target = button(label);
      assert.ok(target, `Missing actual-screen button: ${label}`);
      assert.notEqual(target.props.disabled, true, `Disabled button: ${label}`);
      await act(async () => { target.props.onPress(); await flush(); });
    },
    async input(label, value) {
      const field = root.root.findAll((node) => node.type === 'TextInput' && node.props.accessibilityLabel === label)[0];
      assert.ok(field, `Missing actual-screen input: ${label}`);
      await act(async () => { field.props.onChangeText(value); await flush(); });
    },
    async resume() { await act(async () => { await Promise.all([...resumes].map((invoke) => invoke())); await flush(); }); },
    async startResume() {
      let pending;
      await act(async () => { pending = Promise.all([...resumes].map((invoke) => invoke())); await flush(); });
      return { pending };
    },
    async blur() { await act(async () => { for (const entry of focuses) { entry.cleanup?.(); entry.cleanup = null; } await flush(); }); },
    async focus() { await act(async () => { for (const entry of focuses) entry.cleanup = entry.callback(); await flush(); }); },
    async switchSession(session) { await act(async () => { await sessionApi.writeSession(session); await flush(); }); },
    async navigate(share) { params = { shared: share }; await act(async () => { root.update(React.createElement(TestApp)); await flush(); }); },
    setSaveFailure(value) { failSave = value; },
    async remount() {
      await act(async () => root.unmount());
      freshRuntime();
      await act(async () => { root = Renderer.create(React.createElement(TestApp)); await flush(); });
    },
    async close() { await act(async () => root.unmount()); },
  };
}

test('invite requires explicit acceptance and uses the actual gameplay screen with no reroll', async () => {
  const h = await fixture({ run: { ...run(), rerolls: { set: 2, pack: 2 }, set_reroll_allowed: true } });
  try {
    assert.match(h.text(), /Play this run and compare/);
    assert.equal(h.count('start'), 0);
    await h.press('Play or resume this run');
    assert.ok(h.button('Pick Card A'));
    assert.equal(h.count('start'), 1);
    assert.equal(JSON.parse(h.store.get(CHECKPOINT_KEY)).runId, RUN);
    assert.doesNotMatch(h.text(), /New pack|New set/);
    assert.equal(h.count('daily') + h.count('practice') + h.count('reroll'), 0);
  } finally { await h.close(); }
});

test('a cold remount restores saved progress by UUID without another start or invitation', async () => {
  const h = await fixture();
  try {
    await h.press('Play or resume this run');
    await h.press('Pick Card A');
    await h.press('Confirm pick');
    await h.remount();
    assert.match(h.text(), /You chose\s+Card A/);
    assert.doesNotMatch(h.text(), /Play this run and compare/);
    assert.equal(h.count('start'), 1);
    assert.ok(h.calls.some(([kind, id]) => kind === 'get' && id === RUN));
  } finally { await h.close(); }
});

for (const failure of ['404 missing', '401 unauthorized', 'network timeout']) {
  test(`saved GET ${failure} cannot silently start a replacement`, async () => {
    const h = await fixture({ checkpoint: true, loadRun: async () => { throw new Error(failure); } });
    try {
      assert.match(h.text(), /Could not recover this shared run/);
      await h.press('Try again');
      assert.equal(h.count('start'), 0);
      assert.equal(JSON.parse(h.store.get(CHECKPOINT_KEY)).runId, RUN);
    } finally { await h.close(); }
  });
}

test('failed checkpoint persistence after start retries GET on the known UUID', async () => {
  const h = await fixture({ failSave: true });
  try {
    await h.press('Play or resume this run');
    assert.match(h.text(), /Checkpoint save failed/);
    h.setSaveFailure(false);
    await h.press('Play or resume this run');
    assert.ok(h.button('Pick Card A'));
    assert.equal(h.count('start'), 1);
    assert.equal(h.count('get'), 1);
  } finally { await h.close(); }
});

test('lost pick response reconciles on the same UUID and renders recovered feedback', async () => {
  const h = await fixture({ lostPick: true });
  try {
    await h.press('Play or resume this run');
    await h.press('Pick Card A');
    await h.press('Confirm pick');
    assert.match(h.text(), /You chose\s+Card A/);
    assert.doesNotMatch(h.text(), /Pick response lost/);
    assert.equal(h.count('pick'), 1);
    assert.equal(h.count('get'), 1);
  } finally { await h.close(); }
});

test('an old foreground read cannot overwrite shared-run feedback', async () => {
  const old = deferred();
  const h = await fixture({ loadRun: () => old.promise });
  try {
    await h.press('Play or resume this run');
    const { pending } = await h.startResume();
    await h.press('Pick Card A');
    await h.press('Confirm pick');
    await act(async () => { old.resolve(run()); await pending; await flush(); });
    assert.match(h.text(), /You chose\s+Card A/);
    assert.equal(h.count('start'), 1);
  } finally { await h.close(); }
});

for (const provider of ['email', 'Google', 'Apple']) {
  test(`${provider} sign-in returns to the exact invitation despite failed optional enrichment`, async () => {
    const h = await fixture({ guest: true });
    try {
      await h.press('Sign in to play this run');
      if (provider === 'email') {
        await h.input('Email', 'qa@example.invalid');
        await h.input('Password', 'test-password');
        await h.resume();
        assert.equal(h.root.root.findAll((node) => node.type === 'TextInput' && node.props.accessibilityLabel === 'Email')[0].props.value, 'qa@example.invalid');
        await h.press('Sign in');
      } else await h.press(`Continue with ${provider}`);
      assert.match(h.text(), /Play this run and compare/);
      assert.ok(h.button('Play or resume this run'));
      assert.equal(h.count('start'), 0);
      assert.deepEqual(h.calls.find(([kind]) => kind === 'replace')[1], { pathname: '/shared-run', params: { shared: SHARE } });
      await h.press('Play or resume this run');
      assert.deepEqual(h.calls.find(([kind]) => kind === 'start').slice(1), [SHARE, ACCOUNT]);
    } finally { await h.close(); }
  });
}

test('a session change during a pick cannot display the old account response', async () => {
  const response = deferred();
  const h = await fixture({ submitPick: () => response.promise });
  try {
    await h.press('Play or resume this run');
    await h.press('Pick Card A');
    await h.press('Confirm pick');
    await h.switchSession(signedSession(OTHER_ACCOUNT));
    await act(async () => { response.resolve(run(1)); await flush(); });
    assert.match(h.text(), /Play this run and compare/);
    assert.doesNotMatch(h.text(), /You chose/);
    assert.equal(h.count('start'), 1);
  } finally { await h.close(); }
});

test('route changes discard a delayed invitation response', async () => {
  const old = deferred();
  const h = await fixture({ loadInfo: async (id) => id === SHARE ? old.promise : { id, name: 'New sender', score: 73, scores: [], run_length: 8, environment: 'mixed' } });
  try {
    await h.navigate(OTHER_SHARE);
    await act(async () => { old.resolve({ id: SHARE, name: 'Old sender', score: 99, scores: [], run_length: 8, environment: 'mixed' }); await flush(); });
    assert.match(h.text(), /New sender/);
    assert.doesNotMatch(h.text(), /Old sender/);
    assert.equal(h.count('start'), 0);
  } finally { await h.close(); }
});

test('a completed result uses server comparison and server environment in sharing', async () => {
  const h = await fixture({ checkpoint: true, run: { ...run(8, true), environment: 'powered-cube' } });
  try {
    assert.match(h.text(), /Shared run complete/);
    assert.match(h.text(), /You won this shared run/);
    assert.match(h.text(), /Opponent/);
    await h.press('Share Pack One result');
    const payload = h.calls.find(([kind]) => kind === 'share')[1].message;
    assert.match(payload, /Powered Cube/);
    assert.match(payload, new RegExp(`shared=${SHARE}`));
    assert.equal(h.count('start'), 0);
  } finally { await h.close(); }
});

test('creator reopening shows the original completed result without invented opposition', async () => {
  const h = await fixture({ run: { ...run(8, true), comparison: null } });
  try {
    await h.press('Play or resume this run');
    assert.match(h.text(), /Shared run complete/);
    assert.doesNotMatch(h.text(), /You won|friend won|was a tie/);
    assert.equal(JSON.parse(h.store.get(CHECKPOINT_KEY)).runId, RUN);
  } finally { await h.close(); }
});

test('prior-pool zoom works before choosing and does not submit or select a card', async () => {
  const h = await fixture();
  try {
    await h.press('Play or resume this run');
    await h.press('View earlier pick 1: Earlier Card');
    assert.equal(h.root.root.findAll((node) => node.type === 'Modal' && node.props.visible).length, 1);
    assert.equal(h.button('Pick Card A').props.accessibilityState.selected, false);
    assert.equal(h.count('pick'), 0);
    await h.press('Close');
    assert.equal(h.root.root.findAll((node) => node.type === 'Modal').length, 0);
  } finally { await h.close(); }
});

test('an invalid share renders an error without any gameplay or preview request', async () => {
  const h = await fixture({ share: 'invalid' });
  try {
    assert.match(h.text(), /link is invalid/);
    assert.equal(h.count('info') + h.count('start') + h.count('daily') + h.count('practice'), 0);
  } finally { await h.close(); }
});


test('a lost start response can be retried without a client practice key', async () => {
  let starts = 0;
  const h = await fixture({ startRun: async (id) => {
    assert.equal(id, SHARE);
    starts += 1;
    if (starts === 1) throw new Error('Start response lost after commit.');
    return run(1);
  } });
  try {
    await h.press('Play or resume this run');
    assert.match(h.text(), /Start response lost/);
    await h.press('Play or resume this run');
    assert.match(h.text(), /You chose\s+Card A/);
    assert.equal(JSON.parse(h.store.get(CHECKPOINT_KEY)).runId, RUN);
    assert.equal(h.count('start'), 2);
  } finally { await h.close(); }
});

test('duplicate accept taps before rerender start only once', async () => {
  const pending = deferred();
  const h = await fixture({ startRun: () => pending.promise });
  try {
    const button = h.button('Play or resume this run');
    await act(async () => { button.props.onPress(); button.props.onPress(); await flush(); });
    assert.equal(h.count('start'), 1);
    await act(async () => { pending.resolve(run()); await flush(); });
    assert.ok(h.button('Pick Card A'));
  } finally { await h.close(); }
});

test('leaving during start does not leave the returning invitation permanently busy', async () => {
  const pending = deferred();
  const h = await fixture({ startRun: () => pending.promise });
  try {
    await h.press('Play or resume this run');
    await h.blur();
    await act(async () => { pending.resolve(run()); await flush(); });
    await h.focus();
    assert.ok(h.button('Pick Card A'));
    assert.equal(h.count('start'), 1);
  } finally { await h.close(); }
});
