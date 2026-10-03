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

const host = name => function Host(props) { return React.createElement(name, props, props.children); };
function text(node) {
  if (node == null) return '';
  if (typeof node !== 'object') return String(node);
  return Array.isArray(node) ? node.map(text).join(' ') : text(node.children || []);
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
const session = name => ({ playerToken: `player-${name}`, ...(name === 'guest' ? {} : { accountToken: `account-${name}`, accountUser: { id: name } }) });
const status = (scores = [], claimed = false) => ({ day: day(), player: { claimed }, daily_streak: 0, capabilities: [], daily_history: scores.map((score, index) => ({ date: day(), mode: 'draft_run', set_id: ['mixed', 'powered-cube', 'latest'][index], score })) });

function compiler(mocks) {
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve(relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = new Module(filename, module);
    cache.set(filename, mod);
    mod.paths = Module._nodeModulePaths(path.dirname(filename));
    mod.require = request => {
      if (Object.hasOwn(mocks, request)) return mocks[request];
      if (request.startsWith('@/') || request.startsWith('.')) {
        const base = request.startsWith('@/') ? path.resolve(request.slice(2)) : path.resolve(path.dirname(filename), request);
        const target = [base, `${base}.ts`, `${base}.tsx`].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
        if (target) return load(target);
      }
      return Module.prototype.require.call(mod, request);
    };
    mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
    return mod.exports;
  }
  return load;
}

async function fixture(options = {}) {
  let current = options.session || session('guest');
  let daily = options.daily || status();
  let readDaily = () => Promise.resolve(daily);
  let readAccount = () => Promise.resolve({ user: current.accountUser });
  const listeners = new Set(), resumes = new Set(), destinations = [];
  const write = async value => { current = value; for (const listener of listeners) listener(value); };
  class ApiError extends Error { constructor(status) { super('account'); this.status = status; } }
  const Tabs = host('Tabs'); Tabs.Screen = host('TabScreen');
  const native = Object.fromEntries(['Pressable', 'Text', 'View', 'ScrollView', 'ActivityIndicator'].map(name => [name, host(name)]));
  const mocks = {
    'react-native': { ...native, StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width: 320, height: 740, fontScale: 1.5 }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24, bottom: 20, left: 0, right: 0 }) },
    'expo-image': { Image: host('Image') },
    'expo-router': { Tabs, router: { push: value => destinations.push(value), navigate: value => destinations.push(value) },
      useFocusEffect: callback => React.useEffect(callback, [callback]) },
    '@/src/components/Text': { Text: native.Text },
    '@/src/components/ScreenArea': { ScreenArea: host('SafeAreaView') },
    '@/src/api/guest': { ensureGuestSession: async () => current },
    '@/src/storage/session': { readSession: async () => current, subscribeSession: callback => { listeners.add(callback); return () => listeners.delete(callback); } },
    '@/src/hooks/useAppResume': { useAppResume: callback => React.useEffect(() => { resumes.add(callback); return () => resumes.delete(callback); }, [callback]) },
    '@/src/api/account': { loadMobileAccount: () => readAccount(), forgetAccountLocally: async previous => { const guest = { playerToken: previous.playerToken }; await write(guest); return guest; } },
    '@/src/api/client': { ApiError },
    '@/src/api/draftRun': { DAILY_ENVIRONMENT_META: Object.fromEntries(['mixed', 'powered-cube', 'latest'].map(name => [name, { title: name, eyebrow: name, description: 'Eight decisions.' }])), loadDailyStatus: () => readDaily() },
    '@/src/api/patreon': { loadNativePatreonStatus: async () => ({ ads_allowed: false }) },
    '@/src/tcgplayer': { tcgplayerMagicUrl: () => 'https://example.invalid' },
  };
  const load = compiler(mocks);
  const Provider = load('src/navigation/session.tsx').NavigationSessionProvider;
  const Screen = load(options.tabs ? 'app/(tabs)/_layout.tsx' : 'src/screens/index.tsx').default;
  let root;
  await act(async () => { root = Renderer.create(React.createElement(Provider, null, React.createElement(Screen))); await flush(); });
  return {
    ApiError, root, destinations,
    text: () => text(root.toJSON()),
    visibleTabs: () => root.root.findAllByType('TabScreen').filter(node => node.props.options.href !== null).map(node => node.props.options.title),
    readDaily: value => { readDaily = value; }, readAccount: value => { readAccount = value; },
    updateDaily: value => { daily = value; },
    current: () => current,
    async write(value) { await act(async () => { await write(value); await flush(); }); },
    async resume() { await act(async () => { for (const callback of [...resumes]) void callback(); await flush(); }); },
    async press(label) { await act(async () => {
      const button = root.root.findAllByType('Pressable').find(node => text(node).trim() === label || node.props.accessibilityLabel === label);
      assert.ok(button, `Missing ${label}`); button.props.onPress(); await flush();
    }); },
    async close() { await act(async () => root.unmount()); },
  };
}

test('guest/member navigation changes with persisted identity and keeps public route aliases', async () => {
  const h = await fixture({ tabs: true });
  try {
    assert.deepEqual(h.visibleTabs(), ['Daily', 'How to Play', 'Sign in']);
    assert.equal(h.root.root.findByType('Tabs').props.backBehavior, 'history');
    await h.write(session('A'));
    assert.deepEqual(h.visibleTabs(), ['Daily', 'Practice', 'Leaders', 'Learn', 'My Pack One']);
    await h.write(session('B'));
    assert.equal(h.visibleTabs().length, 5);
    await h.write(session('guest'));
    assert.deepEqual(h.visibleTabs(), ['Daily', 'How to Play', 'Sign in']);
    assert.equal(h.root.root.findAllByType('TabScreen').length, 6, 'Hidden public routes remain navigable');
  } finally { await h.close(); }
});

test('Daily preserves loaded completion and zero scores through refresh failure, then retries', async () => {
  const h = await fixture({ daily: status([0, 87, 100]) });
  try {
    assert.match(h.text(), /3\/3 complete/);
    assert.match(h.text(), /Complete · 0\/100/);
    assert.match(h.text(), /0-day streak/);
    assert.match(h.text(), /Create a free account/);
    const pending = deferred(); h.readDaily(() => pending.promise);
    await h.resume();
    assert.match(h.text(), /3\/3 complete/);
    await act(async () => { pending.reject(Error('offline')); await flush(); });
    assert.match(h.text(), /last loaded progress/);
    assert.match(h.text(), /Complete · 100\/100/);
    h.readDaily(async () => status([87]));
    await h.press('Retry');
    assert.match(h.text(), /1\/3 complete/);
    assert.doesNotMatch(h.text(), /temporarily unavailable/);
    const dailyCards = h.root.root.findAllByType('Pressable').filter(node => /(?:Play|View) .+ Daily/.test(node.props.accessibilityLabel || ''));
    assert.deepEqual(dailyCards.map(node => node.props.accessibilityLabel), ['View mixed Daily', 'Play powered-cube Daily', 'Play latest Daily']);
  } finally { await h.close(); }
});

test('unknown progress is never zero and account B cannot retain A completion on failure', async () => {
  const h = await fixture({ session: session('A'), daily: status([87], true) });
  try {
    const pending = deferred(); h.readDaily(() => pending.promise);
    await h.write(session('B'));
    assert.doesNotMatch(h.text(), /87\/100|0\/3 complete|0-day streak|Start here/);
    assert.match(h.text(), /Checking Daily progress/);
    await act(async () => { pending.reject(Error('offline')); await flush(); });
    assert.match(h.text(), /Streak unavailable/);
    assert.doesNotMatch(h.text(), /87\/100|0\/3 complete/);
  } finally { await h.close(); }
});

test('an old account response cannot overwrite new identity progress', async () => {
  const h = await fixture({ session: session('A') });
  try {
    const old = deferred(); h.readDaily(() => old.promise); await h.resume();
    h.readDaily(async () => status([42], true)); await h.write(session('B'));
    await act(async () => { old.resolve(status([99, 99, 99], true)); await flush(); });
    assert.match(h.text(), /Complete · 42\/100/); assert.doesNotMatch(h.text(), /99\/100/);
  } finally { await h.close(); }
});

test('account check failure preserves sign-in, authoritative expiration changes guest tabs', async () => {
  const h = await fixture({ tabs: true, session: session('A') });
  try {
    h.readAccount(async () => { throw Error('offline'); }); await h.resume();
    assert.ok(h.current().accountToken); assert.ok(h.visibleTabs().includes('My Pack One'));
    h.readAccount(async () => { throw new h.ApiError(401); }); await h.resume();
    assert.equal(h.current().accountToken, undefined);
    assert.deepEqual(h.visibleTabs(), ['Daily', 'How to Play', 'Sign in']);
  } finally { await h.close(); }
});

test('late expiration from A never clears a successfully switched B session', async () => {
  const h = await fixture({ tabs: true, session: session('A') });
  try {
    const old = deferred(); h.readAccount(() => old.promise); await h.resume();
    await h.write(session('B'));
    await act(async () => { old.reject(new h.ApiError(401)); await flush(); });
    assert.equal(h.current().accountUser.id, 'B'); assert.ok(h.visibleTabs().includes('My Pack One'));
  } finally { await h.close(); }
});

test('Pacific clock uses game-day midnight across both DST boundaries', () => {
  const clock = compiler({})('src/dailyClock.ts');
  assert.equal(clock.pacificDay(new Date('2026-10-03T06:59:00Z')), '2026-10-02');
  assert.equal(clock.dailyResetCue(new Date('2026-03-08T08:00:00Z')), 'New Dailies in 23h');
  assert.equal(clock.dailyResetCue(new Date('2026-11-01T07:00:00Z')), 'New Dailies in 25h');
});
