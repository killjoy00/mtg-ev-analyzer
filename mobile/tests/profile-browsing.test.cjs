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

const KEY_A = 'a'.repeat(16);
const KEY_B = 'b'.repeat(16);
const PLAYER_A = '11111111-1111-4111-8111-111111111111';
const PLAYER_B = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_A = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_B = '44444444-4444-4444-8444-444444444444';
const SESSION_KEY = 'packone.mobile.session.v2';
const session = (other = false) => ({ playerToken: `p1_${other ? PLAYER_B : PLAYER_A}.${'A'.repeat(43)}`,
  subjectId: other ? PLAYER_B : PLAYER_A, accountToken: (other ? 'C' : 'B').repeat(43), accountUser: { id: other ? ACCOUNT_B : ACCOUNT_A } });
const row = (cursor = '100', score = 80) => ({ cursor, played_at: '2026-09-26T15:00:00Z', set_id: 'mixed', mode: 'draft_run', score, is_daily: true, grade: 'A', outcome: 'win' });
function profile(key = KEY_A, privateView = false) {
  return {
    player: { display_name: `${privateView ? 'Private' : 'Public'} ${key === KEY_A ? 'Alice' : 'Bob'}`,
      profile_key: key, profile_public: !privateView, favorite_set_id: 'msh', showcase_achievement: 'first_run' },
    summary: { games: 2, average_score: 80, best_score: 90, challenge_wins: 1, challenge_losses: 0, challenge_ties: 0,
      daily_games: 1, environments_played: 1, current_streak: 1, best_streak: 2 },
    environment_total: 2,
    by_set: [{ set_id: 'msh', games: 2, average_score: 80, best_score: 90, daily_games: 1, last_played_at: '2026-09-26T15:00:00Z' }],
    by_mode: [{ mode: 'draft_run', games: 2, average_score: 80, best_score: 90 }],
    best_environments: [], cube: null, current_season: null, best_final_percentile: 8,
    daily_history: [], recent: [row(key === KEY_A ? '100' : '200')], trend: [],
    achievements: [{ id: 'first_run', label: 'First Run', unlocked: true, progress_text: 'Unlocked' }],
  };
}
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const drain = () => new Promise((resolve) => setImmediate(resolve));
function text(node) { if (node == null) return ''; if (typeof node === 'string' || typeof node === 'number') return String(node); if (Array.isArray(node)) return node.map(text).join(' '); return text(node.children || []); }
const host = (name) => function Host(props) { return React.createElement(name, props, props.children); };
function FlatList(props) {
  return React.createElement('FlatList', props, props.ListHeaderComponent,
    props.data.length ? props.data.map((item, index) => React.createElement(React.Fragment, { key: `${item.cursor}:${index}` }, props.renderItem({ item, index }))) : props.ListEmptyComponent,
    props.ListFooterComponent);
}

async function fixture(t, options = {}) {
  const mobile = process.cwd();
  const cache = new Map();
  const storage = new Map([[SESSION_KEY, JSON.stringify(session())]]);
  const calls = []; const shares = []; const pushes = []; let backs = 0;
  let params = { key: options.key ?? KEY_A }; let focus; let resume; let locked = false;
  const priorFetch = globalThis.fetch;
  const mocks = {
    'expo-router': {
      router: { push(value) { pushes.push(value); }, back() { backs += 1; } }, useLocalSearchParams: () => params,
      useFocusEffect(callback) { React.useEffect(() => { focus = callback; const cleanup = callback(); return () => { if (focus === callback) focus = null; cleanup?.(); }; }, [callback]); },
    },
    'react-native': { useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }), ActivityIndicator: host('ActivityIndicator'), FlatList, Pressable: host('Pressable'), Text: host('Text'), View: host('View'),
      StyleSheet: { create: (value) => value }, Share: { share: async (value) => { shares.push(value); return {}; } } },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    'expo-secure-store': {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device',
      async getItemAsync(key) { if (locked) throw new Error('Secure store locked'); return storage.get(key) ?? null; },
      async setItemAsync(key, value) { storage.set(key, value); }, async deleteItemAsync(key) { storage.delete(key); },
    },
    '@/src/config': { config: { screenshots: { fixtures: false }, api: { origin: 'https://api.packone.pro' } } },
    '@/src/hooks/useAppResume': { useAppResume(callback) { resume = callback; } },
    '@/src/theme': { colors: new Proxy({}, { get: () => '#000' }), spacing: new Proxy({}, { get: () => 8 }) },
  };
  function compile(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename)); cache.set(filename, mod);
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const prior = Module._load;
    Module._load = function load(request, parent, main) {
    if (request === '@/src/components/Text') return { Text: mocks['react-native'].Text };
    if (request === '@/src/components/ScreenArea') return { ScreenArea: mocks['react-native-safe-area-context'].SafeAreaView };

      if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
      const base = request.startsWith('@/') ? path.join(mobile, request.slice(2))
        : request.startsWith('.') && parent?.filename.startsWith(mobile) ? path.resolve(path.dirname(parent.filename), request) : null;
      if (base) { const file = [base, base + '.ts', base + '.tsx'].find((value) => fs.existsSync(value) && fs.statSync(value).isFile()); if (file && /\.tsx?$/.test(file)) return compile(file); }
      return prior.call(this, request, parent, main);
    };
    try { mod._compile(output, filename); } finally { Module._load = prior; }
    return mod.exports;
  }
  globalThis.fetch = async (url, init) => {
    const target = new URL(url); const cursor = target.searchParams.get('cursor');
    const other = init.headers.get('x-pack1-mobile-account') === session(true).accountToken;
    calls.push({ path: target.pathname, cursor, init });
    let result;
    if (target.pathname === '/growth/v1/mobile/profile/me') result = await (options.privateProfile?.(other) ?? profile(other ? KEY_B : KEY_A, true));
    else if (target.pathname === '/growth/v1/mobile/profile/history') result = await (options.privateHistory?.(other, cursor) ?? { rows: [row(other ? '200' : '100')], next_cursor: '90' });
    else if (/^\/growth\/v1\/mobile\/profile\/[ab]{16}\/(report|block)$/.test(target.pathname)) {
      const parts = target.pathname.split('/'); const key = parts[5]; const action = parts[6];
      result = await (options.safety?.(key, action, init) ?? (action === 'report' ? { ok: true, report_id: '1' } : { ok: true, blocked: true }));
    } else if (/^\/growth\/v1\/mobile\/profile\/[ab]{16}$/.test(target.pathname)) {
      const key = target.pathname.split('/')[5]; result = await (options.profile?.(key) ?? profile(key));
    } else if (/^\/growth\/v1\/profile\/[ab]{16}\/history$/.test(target.pathname)) {
      const key = target.pathname.split('/')[4]; result = await (options.history?.(key, cursor) ?? { rows: [row(key === KEY_A ? '100' : '200')], next_cursor: '90' });
    } else if (/^\/growth\/v1\/profile\/[ab]{16}$/.test(target.pathname)) {
      const key = target.pathname.split('/')[4]; result = await (options.profile?.(key) ?? profile(key));
    } else throw new Error(`Unexpected request: ${target.pathname}`);
    return result instanceof Response ? result : Response.json(result);
  };
  const Screen = compile(path.join(mobile, options.privateView ? 'src/screens/career.tsx' : 'app/profile.tsx')).default;
  const sessions = compile(path.join(mobile, 'src/storage/session.ts'));
  let root;
  await act(async () => { root = Renderer.create(React.createElement(Screen)); await drain(); });
  t.after(async () => { await act(async () => root.unmount()); globalThis.fetch = priorFetch; });
  return {
    calls, shares, pushes, root, backs: () => backs,
    text: () => text(root.toJSON()),
    rows: () => root.root.findAllByType('FlatList')[0]?.props.data ?? [],
    list: () => root.root.findByType('FlatList'),
    async press(label) {
      const button = root.root.findAll((node) => node.type === 'Pressable' && (node.props.accessibilityLabel === label || text(node).includes(label)))[0];
      assert.ok(button, `Expected button ${label}`); assert.notEqual(button.props.disabled, true, `${label} should be enabled`);
      await act(async () => { button.props.onPress(); await drain(); });
    },
    async more() { await act(async () => { root.root.findByType('FlatList').props.onEndReached(); await drain(); }); },
    async focus() { await act(async () => { focus(); await drain(); }); },
    async resume() { await act(async () => { resume(); await drain(); }); },
    async route(key) { params = { key }; await act(async () => { root.update(React.createElement(Screen)); await drain(); }); },
    async write(next) { await act(async () => { await sessions.writeSession(next); await drain(); }); },
    async signOut() { await act(async () => { await sessions.clearSession(); await drain(); }); },
    silent(next) { storage.set(SESSION_KEY, JSON.stringify(next)); },
    lock() { locked = true; },
  };
}

const missing = () => Response.json({ error: 'Profile not found or private.' }, { status: 404 });

test('public profile uses an existing account session for block-aware identity lookup without creating a new session', async (t) => {
  const f = await fixture(t);
  assert.match(f.text(), /Public Alice/); assert.match(f.text(), /Favorite environment:.*MSH/);
  assert.match(f.text(), /Showcased achievement:.*First Run/); assert.match(f.text(), /Best final Daily finish: Top.*8/);
  assert.match(f.text(), /Played environments/); assert.deepEqual(f.rows().map((item) => item.cursor), ['100']);
  const profileCall=f.calls.find((call)=>call.path===`/growth/v1/mobile/profile/${KEY_A}`);
  assert.ok(profileCall);
  assert.match(profileCall.init.headers.get('x-pack1-mobile-session')||'',/^p1_/);
  assert.equal(profileCall.init.headers.get('x-pack1-mobile-account'),session().accountToken);
  const historyCall=f.calls.find((call)=>call.path===`/growth/v1/profile/${KEY_A}/history`);
  assert.ok(historyCall);
  assert.equal(historyCall.init.headers.has('x-pack1-mobile-session'),false);
  assert.equal(historyCall.init.headers.has('x-pack1-mobile-account'),false);
  assert.equal(f.calls.some((call)=>call.path.includes('/session')),false);
});

test('public profile safety controls report and block with the existing account identity', async (t) => {
  const f = await fixture(t);
  await f.press('Report profile');
  const report=f.calls.find((call)=>call.path===`/growth/v1/mobile/profile/${KEY_A}/report`);
  assert.ok(report); assert.equal(report.init.method,'POST');
  assert.deepEqual(JSON.parse(report.init.body),{reason:'offensive_name'});
  assert.match(f.text(),/Report sent to Pack One/);

  await f.press('Block profile');
  const block=f.calls.find((call)=>call.path===`/growth/v1/mobile/profile/${KEY_A}/block`);
  assert.ok(block); assert.equal(block.init.method,'POST'); assert.equal(f.backs(),1);
});

test('an invalid profile link makes no request and never shows cached identity', async (t) => {
  const f = await fixture(t, { key: '../account?token=secret' });
  assert.match(f.text(), /link is invalid/); assert.equal(f.calls.length, 0);
});

test('changing public keys clears A immediately while B is delayed', async (t) => {
  const pending = deferred();
  const f = await fixture(t, { profile: (key) => key === KEY_B ? pending.promise : profile(key) });
  await f.route(KEY_B); assert.doesNotMatch(f.text(), /Public Alice/); assert.equal(f.rows().length, 0);
  await act(async () => { pending.resolve(profile(KEY_B)); await drain(); });
  assert.match(f.text(), /Public Bob/); assert.deepEqual(f.rows().map((item) => item.cursor), ['200']);
});

test('an initial history failure preserves the public overview and has an explicit retry', async (t) => {
  let failed = true;
  const f = await fixture(t, { history: () => { if (failed) throw new Error('History temporarily offline'); return { rows: [row('80')], next_cursor: null }; } });
  assert.match(f.text(), /Public Alice/); assert.match(f.text(), /History temporarily offline/);
  failed = false; await f.press('Retry history'); assert.deepEqual(f.rows().map((item) => item.cursor), ['80']);
});

test('public pagination deduplicates existing rows and repeated rows within a page', async (t) => {
  const f = await fixture(t, { history: (_key, cursor) => cursor ? { rows: [row('100'), row('80'), row('80'), row('70')], next_cursor: null }
    : { rows: [row('100')], next_cursor: '90' } });
  await f.more(); assert.deepEqual(f.rows().map((item) => item.cursor), ['100', '80', '70']);
});

test('overlapping public pagination requests only fetch the cursor once', async (t) => {
  const pending = deferred(); const f = await fixture(t, { history: (_key, cursor) => cursor ? pending.promise : { rows: [row()], next_cursor: '90' } });
  await act(async () => { const more = f.list().props.onEndReached; more(); more(); await drain(); });
  assert.equal(f.calls.filter((call) => call.cursor === '90').length, 1);
  await act(async () => { pending.resolve({ rows: [row('80')], next_cursor: null }); await drain(); });
});

test('a cyclic public history cursor stops automatic pagination', async (t) => {
  const f = await fixture(t, { history: (_key, cursor) => ({ rows: [row(cursor ? '80' : '100')], next_cursor: '90' }) });
  await f.more(); assert.match(f.text(), /History changed while loading/);
  const count = f.calls.length; await f.more(); assert.equal(f.calls.length, count);
});

test('a public pagination failure keeps rows and retries the same cursor', async (t) => {
  let fail = true;
  const f = await fixture(t, { history: (_key, cursor) => { if (cursor && fail) throw new Error('Page timed out'); return { rows: [row(cursor ? '80' : '100')], next_cursor: cursor ? null : '90' }; } });
  await f.more(); assert.deepEqual(f.rows().map((item) => item.cursor), ['100']);
  const count = f.calls.length; await f.more(); assert.equal(f.calls.length, count, 'do not loop after an error');
  fail = false; await f.press('Retry history'); assert.deepEqual(f.rows().map((item) => item.cursor), ['100', '80']);
});

for (const stage of ['refresh', 'history', 'share']) {
  test(`a public profile becoming private during ${stage} removes cached rows and sharing`, async (t) => {
    let denied = false;
    const f = await fixture(t, { profile: (key) => denied && stage !== 'history' ? missing() : profile(key),
      history: (_key, cursor) => denied && stage === 'history' ? missing() : { rows: [row()], next_cursor: cursor ? null : '90' } });
    denied = true;
    if (stage === 'refresh') await f.focus();
    else if (stage === 'history') await f.more();
    else await f.press('Share public profile');
    assert.match(f.text(), /Profile unavailable/); assert.doesNotMatch(f.text(), /Public Alice|Share public profile/);
    assert.equal(f.rows().length, 0); assert.equal(f.shares.length, 0);
  });
}

test('public sharing revalidates opt-in and uses only the canonical public key', async (t) => {
  const f = await fixture(t); await f.press('Share public profile');
  assert.equal(f.shares.length, 1); assert.equal(f.shares[0].message, `Public Alice's Pack One profile\nhttps://packone.pro/?profile=${KEY_A}`);
  assert.equal(f.calls.filter((call) => call.path === `/growth/v1/mobile/profile/${KEY_A}`).length, 2);
});

test('a delayed public share cannot open for A after navigating to B', async (t) => {
  const pending = deferred(); let reads = 0;
  const f = await fixture(t, { profile: (key) => key === KEY_A && ++reads > 1 ? pending.promise : profile(key) });
  await f.press('Share public profile'); await f.route(KEY_B);
  await act(async () => { pending.resolve(profile(KEY_A)); await drain(); });
  assert.match(f.text(), /Public Bob/); assert.equal(f.shares.length, 0);
});

test('late public history for A cannot append to B', async (t) => {
  const pending = deferred();
  const f = await fixture(t, { history: (key, cursor) => key === KEY_A && cursor ? pending.promise : { rows: [row(key === KEY_A ? '100' : '200')], next_cursor: '90' } });
  await f.more(); await f.route(KEY_B);
  await act(async () => { pending.resolve({ rows: [row('80')], next_cursor: null }); await drain(); });
  assert.deepEqual(f.rows().map((item) => item.cursor), ['200']);
});

test('a same-key public refresh outage preserves the last verified view and offers retry', async (t) => {
  let fail = false; const f = await fixture(t, { profile: (key) => { if (fail) throw new Error('Public API offline'); return profile(key); } });
  fail = true; await f.resume(); assert.match(f.text(), /Public Alice/); assert.match(f.text(), /Public API offline/);
});

test('a returned foreign key fails closed rather than retaining the previous public profile', async (t) => {
  let wrong = false; const f = await fixture(t, { profile: (key) => profile(wrong ? KEY_B : key) });
  wrong = true; await f.focus(); assert.match(f.text(), /Profile unavailable/); assert.doesNotMatch(f.text(), /Public Alice|Public Bob/);
});

test('Career clears account A before a delayed and failed account B load', async (t) => {
  const pending = deferred(); const f = await fixture(t, { privateView: true, privateProfile: (other) => other ? pending.promise : profile(KEY_A, true) });
  assert.match(f.text(), /Private Alice/); await f.write(session(true));
  assert.doesNotMatch(f.text(), /Private Alice|Share my record/); assert.equal(f.rows().length, 0);
  await act(async () => { pending.reject(new Error('Bob profile offline')); await drain(); });
  assert.match(f.text(), /Bob profile offline/); assert.doesNotMatch(f.text(), /Private Alice/);
});

test('Career focus detects a silently changed account and cannot fall back to A after B fails', async (t) => {
  const f = await fixture(t, { privateView: true, privateProfile: (other) => { if (other) throw new Error('B offline'); return profile(KEY_A, true); } });
  f.silent(session(true)); await f.focus(); assert.doesNotMatch(f.text(), /Private Alice/); assert.equal(f.rows().length, 0);
});

test('Career retains loaded same-account data through a transient refresh failure', async (t) => {
  let fail = false; const f = await fixture(t, { privateView: true, privateProfile: () => { if (fail) throw new Error('Career temporarily offline'); return profile(KEY_A, true); } });
  fail = true; await f.focus(); assert.match(f.text(), /Private Alice/); assert.match(f.text(), /Career temporarily offline/);
  assert.deepEqual(f.rows().map((item) => item.cursor), ['100']);
});

test('Career sign-out notifications immediately remove private data', async (t) => {
  const f = await fixture(t, { privateView: true }); await f.signOut();
  assert.match(f.text(), /Welcome to My Pack One/); assert.match(f.text(), /Play Daily/); assert.doesNotMatch(f.text(), /Private Alice/); assert.equal(f.rows().length, 0);
});

test('first-time signed-in Career leads with Play Daily instead of zero metrics and empty sections', async (t) => {
  const zero = profile(KEY_A, true);
  zero.summary = { ...zero.summary, games:0, average_score:0, best_score:0, challenge_wins:0, challenge_losses:0, current_streak:0 };
  zero.recent = [];
  zero.daily_history = [];
  zero.by_set = [];
  zero.by_mode = [];
  zero.achievements = [];
  const f = await fixture(t, { privateView:true, privateProfile:()=>zero, privateHistory:()=>({rows:[],next_cursor:null}) });
  assert.match(f.text(), /Start with today.s Daily/);
  assert.match(f.text(), /Your real scores, streaks, environments, achievements, and history will appear here after you play/);
  assert.doesNotMatch(f.text(), /0\.0 average|Recent Games|Share my record/);
  await f.press('Play Daily');
  assert.equal(f.pushes.at(-1),'/');
});

test('a late initial A result cannot replace B after a session change', async (t) => {
  const pending = deferred(); const f = await fixture(t, { privateView: true, privateProfile: (other) => other ? profile(KEY_B, true) : pending.promise });
  await f.write(session(true)); assert.match(f.text(), /Private Bob/);
  await act(async () => { pending.resolve(profile(KEY_A, true)); await drain(); });
  assert.match(f.text(), /Private Bob/); assert.doesNotMatch(f.text(), /Private Alice/);
});

test('a silent identity change during private reads discards the completed result', async (t) => {
  const pending = deferred(); const f = await fixture(t, { privateView: true, privateProfile: () => pending.promise });
  f.silent(session(true)); await act(async () => { pending.resolve(profile(KEY_A, true)); await drain(); });
  assert.doesNotMatch(f.text(), /Private Alice/); assert.equal(f.rows().length, 0);
});

for (const reject of [false, true]) {
  test(`late private pagination ${reject ? '401' : 'success'} cannot affect the new account`, async (t) => {
    const pending = deferred(); const f = await fixture(t, { privateView: true,
      privateHistory: (other, cursor) => !other && cursor ? pending.promise : { rows: [row(other ? '200' : '100')], next_cursor: '90' } });
    await f.more(); await f.write(session(true));
    await act(async () => { pending.resolve(reject ? Response.json({ error: 'Old account expired' }, { status: 401 }) : { rows: [row('80')], next_cursor: null }); await drain(); });
    assert.match(f.text(), /Private Bob/); assert.deepEqual(f.rows().map((item) => item.cursor), ['200']);
  });
}

test('unreadable secure storage clears private data before paging', async (t) => {
  const f = await fixture(t, { privateView: true }); const count = f.calls.length;
  f.lock(); await f.more(); assert.equal(f.calls.length, count); assert.doesNotMatch(f.text(), /Private Alice/); assert.match(f.text(), /could not be verified/);
});

test('a stale Career share action cannot share the previous account record', async (t) => {
  const f = await fixture(t, { privateView: true }); f.silent(session(true));
  await f.press('Share Pack One profile or record'); assert.equal(f.shares.length, 0); assert.doesNotMatch(f.text(), /Private Alice/);
});

test('duplicate private page requests join one read and duplicates within the page are removed', async (t) => {
  const pending = deferred(); const f = await fixture(t, { privateView: true,
    privateHistory: (_other, cursor) => cursor ? pending.promise : { rows: [row()], next_cursor: '90' } });
  await act(async () => { const more = f.list().props.onEndReached; more(); more(); await drain(); });
  assert.equal(f.calls.filter((call) => call.cursor === '90').length, 1);
  await act(async () => { pending.resolve({ rows: [row('100'), row('80'), row('80')], next_cursor: null }); await drain(); });
  assert.deepEqual(f.rows().map((item) => item.cursor), ['100', '80']);
});

test('private history failure remains visible and has a working same-cursor retry', async (t) => {
  let fail = true; const f = await fixture(t, { privateView: true, privateHistory: (_other, cursor) => {
    if (cursor && fail) throw new Error('More games offline'); return { rows: [row(cursor ? '80' : '100')], next_cursor: cursor ? null : '90' };
  } });
  await f.more(); assert.match(f.text(), /More games offline/); assert.match(f.text(), /Private Alice/);
  fail = false; await f.press('Retry history'); assert.deepEqual(f.rows().map((item) => item.cursor), ['100', '80']);
});
