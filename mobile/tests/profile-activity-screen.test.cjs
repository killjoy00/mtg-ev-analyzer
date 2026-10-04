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
const host = (name) => function Host(props) { return React.createElement(name, props, props.children); };
const drain = () => new Promise((resolve) => setImmediate(resolve));
const text = (node) => node == null ? '' : typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(text).join(' ') : text(node.children || []);
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const PLAYER = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const KEY = 'a'.repeat(16);
const OTHER_KEY = 'b'.repeat(16);
const owner = () => ({ playerToken: `p1_${PLAYER}.${'A'.repeat(43)}`, subjectId: PLAYER, accountToken: 'B'.repeat(43), accountUser: { id: ACCOUNT } });
const daily = (day, extra = {}) => ({ date: `2026-09-${String(day).padStart(2, '0')}`, set_id: 'mixed', mode: 'draft_run', score: 0, final: true, rank: 2, total: 10, percentile: 20, ...extra });
const profile = () => ({
  player: { display_name: 'Player A', profile_public: false, profile_key: KEY, favorite_set_id: 'msh', showcase_achievement: 'first' },
  summary: { games: 3, average_score: 80, best_score: 100, daily_games: 2, current_streak: 1, best_streak: 1, environments_played: 1,
    challenge_wins: 0, challenge_losses: 0, challenge_ties: 0 },
  environment_total: 3, by_mode: [], best_environments: [], current_season: null, recent: [], trend: [],
  by_set: [{ set_id: 'msh', games: 3, average_score: 80, best_score: 100, daily_games: 2 }],
  achievements: [
    { id: 'first', label: 'First Pack', unlocked: true, current: 1, target: 1, description: 'Complete a game.', earned_at: '2026-09-25' },
    { id: 'ten_games', label: 'Settling In', unlocked: false, current: 3, target: 10, progress_text: '3 / 10 games' },
  ],
  daily_history: [daily(25)],
});
function compile(relative, mocks, cache = new Map()) {
  const filename = path.join(process.cwd(), relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename, module); cache.set(filename, mod); mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.require = (name) => {
      if (name === '@/src/components/Text') return { Text: mocks['react-native'].Text };
      if (name === '@/src/components/ScreenArea') return { ScreenArea: mocks['react-native-safe-area-context'].SafeAreaView };
    if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name];
    if (name.startsWith('@/')) {
      const stem = name.slice(2); const extension = fs.existsSync(path.join(process.cwd(), stem + '.tsx')) ? '.tsx' : '.ts';
      return compile(stem + extension, mocks, cache);
    }
    return require(name);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  }).outputText, filename);
  return mod.exports;
}
async function mount(t, options = {}) {
  let params = options.params || {};
  let stored = owner();
  let record = profile();
  let dimensions = { width: 390, fontScale: 1 };
  let resume = () => {};
  const listeners = new Set(); const calls = []; const routes = [];
  const api = {
    private: options.private || (async () => record),
    public: options.public || (async (key) => ({ ...record, player: { ...record.player, profile_key: key, profile_public: true, display_name: key === OTHER_KEY ? 'Player B' : 'Player A' } })),
    archive: options.archive || (async () => [
      { id: 'msh', name: 'Marvel', dataDate: '2026-09-01' },
      { id: 'vow', name: 'Crimson Vow', dataDate: null },
      { id: 'powered-cube', name: 'Powered Cube', dataDate: null },
    ]),
    coverage: options.coverage || (async () => ({ corpus_version: 'serving-fixture', sets: [
      { set_id: 'msh', set_name: 'Marvel', verified_decisions: 1200, qualified_trophy_drafts: 300, training_drafts: 5000, data_date: '2026-09-24' },
    ] })),
    share: options.share || (async () => ({ action: 'sharedAction' })),
  };
  const mocks = {
    'expo-router': { router: { push: (target) => routes.push(target) }, Stack: { Screen: host('StackScreen') },
      useLocalSearchParams: () => params, useFocusEffect: (callback) => React.useEffect(callback, [callback]) },
    'react-native': { ActivityIndicator: host('ActivityIndicator'), Pressable: host('Pressable'), ScrollView: host('ScrollView'),
      Text: host('Text'), View: host('View'), TextInput: host('TextInput'), StyleSheet: { create: (styles) => styles },
      useWindowDimensions: () => dimensions,
      Share: { share: async (payload, options) => { calls.push(['share', payload, options]); return api.share(payload); } } },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/api/career': { loadMobileCareer: async (session) => { calls.push(['private']); return api.private(session); } },
    '@/src/api/publicProfile': { loadPublicProfile: async (key) => { calls.push(['public', key]); return api.public(key); } },
    '@/src/api/profileArchive': { loadProfileArchive: async () => { calls.push(['archive']); return api.archive(); },
      loadProfileCoverage: async () => { calls.push(['coverage']); return api.coverage(); } },
    '@/src/api/draftRun': { DAILY_ENVIRONMENT_META: { mixed: { title: 'Draft Run' }, latest: { title: 'Latest Set' }, 'powered-cube': { title: 'Powered Cube' } },
      isDailyEnvironment: (value) => ['mixed', 'latest', 'powered-cube'].includes(value) },
    '@/src/hooks/useAppResume': { useAppResume: (callback) => { resume = callback; } },
    '@/src/storage/session': { readSession: async () => { calls.push(['session']); return stored; },
      subscribeSession: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } },
    '@/src/theme': { colors: new Proxy({}, { get: () => '#000' }), spacing: new Proxy({}, { get: () => 8 }) },
  };
  const Screen = compile('app/profile-activity.tsx', mocks).default;
  let root;
  await act(async () => { root = Renderer.create(React.createElement(Screen)); await drain(); });
  await act(async () => { await drain(); });
  t.after(async () => { await act(async () => root.unmount()); });
  return {
    root, calls, routes, api, mocks, text: () => text(root.toJSON()),
    setRecord: (next) => { record = next; },
    async press(label) {
      const button = root.root.findAll((node) => node.type === 'Pressable'
        && (node.props.accessibilityLabel === label || text(node) === label))[0];
      assert.ok(button, `missing button: ${label}`); assert.notEqual(button.props.disabled, true);
      await act(async () => { button.props.onPress(); await drain(); });
    },
    async navigate(next) { params = next; await act(async () => { root.update(React.createElement(Screen)); await drain(); }); },
    async signOut() { stored = null; await act(async () => { listeners.forEach((listener) => listener(null)); await drain(); }); },
    async foreground() { await act(async () => { resume(); await drain(); }); },
    async dimensions(next) { dimensions = next; await act(async () => root.update(React.createElement(Screen))); },
  };
}

test('archive exposes played/unplayed/favorite/special rows and the exact selected live coverage', async (t) => {
  const h = await mount(t);
  assert.match(h.text(), /1\s*\/\s*3\s*environments played/);
  assert.match(h.text(), /Favorite/); assert.match(h.text(), /Special environment/);
  await h.press('View Marvel set details'); assert.match(h.text(), /1,200\s*verified decisions/); assert.match(h.text(), /serving-fixture/);
  await h.press('View Crimson Vow set details'); assert.match(h.text(), /Not present in the current live serving catalog/);
  assert.equal(h.calls.filter(([kind]) => kind === 'archive').length, 1);
});
test('archive search and played filters operate on the actual rendered records', async (t) => {
  const h = await mount(t);
  await h.press('Show unplayed environments'); assert.doesNotMatch(h.text(), /3 games/);
  const field = h.root.root.findAll((node) => node.type === 'TextInput' && node.props.accessibilityLabel === 'Search archive environments')[0];
  await act(async () => field.props.onChangeText('CRIMSON'));
  assert.match(h.text(), /Crimson Vow/); assert.doesNotMatch(h.text(), /Powered Cube/);
  await h.press('Show played environments'); assert.match(h.text(), /No environments match/);
});
test('a failed live catalog does not erase archive progress and retry recovers the optional details', async (t) => {
  const h = await mount(t, { coverage: async () => { throw new Error('live offline'); } });
  assert.match(h.text(), /1\s*\/\s*3/); assert.match(h.text(), /live offline/);
  await h.press('View Marvel set details'); assert.match(h.text(), /Live coverage has not been verified/);
  h.api.coverage = async () => ({ corpus_version: 'new', sets: [] });
  await h.press('Refresh archive catalog'); assert.doesNotMatch(h.text(), /live offline/);
});
test('missing published catalog is explicitly unavailable rather than zero of zero complete', async (t) => {
  const h = await mount(t, { archive: async () => { throw new Error('archive offline'); } });
  assert.match(h.text(), /Progress cannot be determined from live sets alone/);
  assert.doesNotMatch(h.text(), /0\s*\/\s*0/);
  await h.press('Achievements'); assert.match(h.text(), /First Pack/);
});
test('unlocked achievement sharing revalidates server data while locked awards have no share action', async (t) => {
  const h = await mount(t, { params: { tab: 'achievements' } });
  assert.equal(h.root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Share achievement Settling In').length, 0);
  const meter = h.root.root.findAll((node) => node.type === 'View' && node.props.accessibilityLabel === 'Settling In progress')[0];
  assert.equal(meter.props.accessibilityValue.now, 30);
  const updated = profile(); updated.player.display_name = 'Updated Player'; h.setRecord(updated);
  await h.press('Share achievement First Pack');
  assert.match(h.calls.find(([kind]) => kind === 'share')[1].message, /Updated Player unlocked/);
});
test('Daily history renders beyond twelve rows and shares the selected dated zero-score finish', async (t) => {
  const record = profile(); record.daily_history = Array.from({ length: 14 }, (_, index) => daily(index + 1, { final: index !== 13 }));
  const h = await mount(t, { params: { tab: 'daily' }, private: async () => record });
  assert.match(h.text(), /2026-09-14/);
  await h.press('Share mixed Daily finish 2026-09-14 draft_run');
  const value = h.calls.find(([kind]) => kind === 'share')[1].message;
  assert.match(value, /0\/100/); assert.match(value, /Daily 2026-09-14/); assert.match(value, /Live, so far/);
  assert.doesNotMatch(value, /today|daily=1|profile=/);
});
test('a share-sheet failure exposes selectable verified text and sign-out removes it', async (t) => {
  const h = await mount(t, { params: { tab: 'daily' }, share: async () => { throw new Error('sheet unavailable'); } });
  await h.press('Share mixed Daily finish 2026-09-25 draft_run');
  assert.match(h.text(), /sheet unavailable/);
  const selectable = h.root.root.findAll((node) => node.type === 'Text' && node.props.accessibilityLabel === 'Verified activity share text')[0];
  assert.equal(selectable.props.selectable, true);
  await h.signOut(); assert.doesNotMatch(h.text(), /Player A|2026-09-25|Verified share text/);
});
test('public A-to-B navigation discards a delayed A share without touching native identity', async (t) => {
  const pending = deferred(); let reads = 0;
  const response = (key) => ({ ...profile(), player: { display_name: key === KEY ? 'Player A' : 'Player B', profile_public: true, profile_key: key } });
  const h = await mount(t, { params: { profileKey: KEY, tab: 'daily' }, public: async (key) => key === KEY && ++reads > 1 ? pending.promise : response(key) });
  await h.press('Share mixed Daily finish 2026-09-25 draft_run');
  await h.navigate({ profileKey: OTHER_KEY, tab: 'daily' }); assert.match(h.text(), /Player B/);
  await act(async () => { pending.resolve(response(KEY)); await drain(); });
  assert.equal(h.calls.filter(([kind]) => ['share', 'private', 'session'].includes(kind)).length, 0);
});
test('private/deleted public records disappear on foreground revalidation', async (t) => {
  const h = await mount(t, { params: { profileKey: KEY, tab: 'daily' } });
  h.api.public = async () => { throw Object.assign(new Error('Profile unavailable'), { status: 404 }); };
  await h.foreground(); assert.doesNotMatch(h.text(), /Player A|Share Daily finish/);
});
test('invalid public scope performs no profile, session or catalog reads', async (t) => {
  const h = await mount(t, { params: { profileKey: [KEY] } });
  assert.match(h.text(), /link is invalid/); assert.equal(h.calls.length, 0);
});
test('archive cards adapt to tablet width but return to one column for large text', async (t) => {
  const h = await mount(t);
  const count = (width) => h.root.root.findAll((node) => node.type === 'View' && Array.isArray(node.props.style)
    && node.props.style.some((item) => item?.width === width)).length;
  assert.equal(count('100%'), 3);
  await h.dimensions({ width: 1024, fontScale: 1 }); assert.equal(count('48.5%'), 3);
  await h.dimensions({ width: 1024, fontScale: 1.8 }); assert.equal(count('100%'), 3);
});
test('the existing ProfileOverview entry points preserve private versus exact public scope', async (t) => {
  const h = await mount(t); const Overview = compile('src/components/ProfileOverview.tsx', h.mocks).ProfileOverview;
  let root;
  await act(async () => { root = Renderer.create(React.createElement(Overview, { profile: profile() })); });
  t.after(async () => { await act(async () => root.unmount()); });
  for (const [label, tab] of [['Explore archive progress', 'archive'], ['Browse achievements and sharing', 'achievements'], ['Browse Daily finishes and sharing', 'daily']]) {
    const button = root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === label)[0];
    assert.ok(button); await act(async () => button.props.onPress());
    assert.deepEqual(h.routes.at(-1), { pathname: '/profile-activity', params: { tab } });
  }
  const publicRecord = profile(); publicRecord.player.profile_public = true;
  await act(async () => root.update(React.createElement(Overview, { profile: publicRecord, publicView: true })));
  await act(async () => root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Explore archive progress')[0].props.onPress());
  assert.deepEqual(h.routes.at(-1), { pathname: '/profile-activity', params: { tab: 'archive', profileKey: KEY } });
  publicRecord.player.profile_key = null;
  await act(async () => root.update(React.createElement(Overview, { profile: publicRecord, publicView: true })));
  assert.equal(root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Explore archive progress').length, 0);
});


test('the native share sheet receives the tapped control anchor for iPad', async (t) => {
  const h = await mount(t, { params: { tab: 'daily' } });
  const button = h.root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Share mixed Daily finish 2026-09-25 draft_run')[0];
  await act(async () => { button.props.onPress({ nativeEvent: { target: 123 } }); await drain(); });
  assert.deepEqual(h.calls.find(([kind]) => kind === 'share')[2], { anchor: 123 });
});
