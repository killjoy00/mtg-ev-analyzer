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

const CHALLENGE = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';
const PLAYER = '33333333-3333-4333-8333-333333333333';
const KEY = 'packone.mobile.creator-challenge.v1';
const SESSION_KEY = 'packone.mobile.session.v2';
const guest = () => ({ playerToken: `p1_${PLAYER}.${'A'.repeat(43)}`, subjectId: PLAYER });
const info = { id: CHALLENGE, slug: 'creator-fixture', creator_name: 'Fixture Creator', score: 87, environment: 'mixed', source_type: 'practice', run_length: 8 };
const run = () => ({ id: RUN, day: null, creator_challenge_id: CHALLENGE, environment: 'mixed', run_length: 8,
  comparison: { kind: 'creator', id: CHALLENGE, slug: info.slug, name: info.creator_name, score: 87, source_type: 'practice' } });
class ApiError extends Error { constructor(status) { super(`HTTP ${status}`); this.status = status; } }
const host = name => function Host(props) { return React.createElement(name, props, props.children); };
const text = node => node == null ? '' : typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join(' ') : text(node.children ?? node.props?.children);
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }

// Execute the production route and production session/continuation modules.
// Platform primitives, transport, and the child gameplay view are test adapters.
function compileGraph(mocks) {
  const cache = new Map();
  function load(filename) {
    const absolute = path.resolve(filename);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const compiled = new Module(absolute, module);
    compiled.filename = absolute;
    compiled.paths = Module._nodeModulePaths(path.dirname(absolute));
    cache.set(absolute, compiled);
    compiled.require = request => {
      if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
      const base = request.startsWith('@/') ? path.resolve(request.slice(2)) : request.startsWith('.') ? path.resolve(path.dirname(absolute), request) : null;
      if (base) {
        const candidate = [base, `${base}.ts`, `${base}.tsx`].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
        if (candidate && /\.tsx?$/.test(candidate)) return load(candidate);
      }
      return Module.prototype.require.call(compiled, request);
    };
    compiled._compile(ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: absolute,
    }).outputText, absolute);
    return compiled.exports;
  }
  return load;
}

async function fixture(options = {}) {
  const store = new Map([[SESSION_KEY, JSON.stringify(guest())]]);
  if (options.checkpoint) store.set(KEY, JSON.stringify({ challengeId: CHALLENGE, runId: RUN, playerId: PLAYER, slug: info.slug }));
  const calls = [];
  let root, sessionApi, Screen, surface;
  const mocks = {
    react: React,
    'react-native': { ActivityIndicator: host('Spinner'), Pressable: host('Pressable'), ScrollView: host('ScrollView'), View: host('View'), StyleSheet: { create: value => value } },
    '@/src/components/Text': { Text: host('Text') },
    '@/src/components/ScreenArea': { ScreenArea: host('SafeArea') },
    '@/src/config': { config: { screenshots: { fixtures: false } } },
    '@/src/screenshots/session': {},
    '@/src/theme': { colors: {}, spacing: {} },
    'expo-router': { router: { replace: target => calls.push(['replace', target]), dismissTo: target => calls.push(['dismiss', target]) },
      useLocalSearchParams: () => ({ creator: info.slug }), useFocusEffect: callback => React.useEffect(() => callback(), [callback]) },
    'expo-secure-store': { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device', getItemAsync: async key => store.get(key) ?? null,
      setItemAsync: async (key, value) => store.set(key, value), deleteItemAsync: async key => store.delete(key) },
    '@/src/api/client': { ApiError },
    '@/src/api/guest': { ensureGuestSession: async () => sessionApi.readSession() },
    '@/src/hooks/useAppResume': { useAppResume() {} },
    './draft-run': { __esModule: true, default: props => { surface = props.shared; return React.createElement('Gameplay', { surface }, surface.kind === 'source' ? `${surface.sourceType} source ready` : 'Creator replay ready'); } },
    '@/src/api/draftRun': {
      loadCreatorChallengeInfo: async (id, session) => { calls.push(['info', id, session]); return options.loadInfo ? options.loadInfo(id, session) : info; },
      startCreatorChallenge: async (session, id) => { calls.push(['start', id, session]); return options.start ? options.start(session, id) : run(); },
      loadDraftRun: async (id, session) => { calls.push(['load', id, session]); return options.load ? options.load(session, id) : run(); },
      submitDraftRunPick: async (current, cardId, session) => { calls.push(['pick', current.id, cardId, session]); return run(); },
      createDraftRunShare: async () => ({}),
    },
  };
  function freshRuntime() { const load = compileGraph(mocks); sessionApi = load('src/storage/session.ts'); Screen = load('app/creator-run.tsx').default; }
  freshRuntime();
  await act(async () => { root = Renderer.create(React.createElement(Screen)); await flush(); });
  return { calls, store, text: () => text(root.toJSON()), surface: () => surface,
    async accept() { const button = root.root.findAll(node => node.type === 'Pressable' && text(node.props.children).includes('Play Fixture'))[0];
      assert.ok(button, 'actual creator invite must offer explicit guest acceptance');
      await act(async () => { await button.props.onPress(); await flush(); }); },
    async switchSession(value) { await act(async () => { await sessionApi.writeSession(value); await flush(); }); },
    async remount() { await act(async () => root.unmount()); freshRuntime(); await act(async () => { root = Renderer.create(React.createElement(Screen)); await flush(); }); },
    async close() { await act(async () => root.unmount()); },
  };
}

test('creator invite accepts a guest explicitly and saves the authoritative continuation', async () => {
  const h = await fixture();
  try {
    assert.match(h.text(), /BEAT THE CREATOR/);
    assert.equal(h.calls.filter(([kind]) => kind === 'start').length, 0);
    await h.accept();
    assert.match(h.text(), /Creator replay ready/);
    assert.equal(h.calls.find(([kind]) => kind === 'start')[2].accountToken, undefined);
    assert.equal(JSON.parse(h.store.get(KEY)).runId, RUN);
    await h.surface().submitPick(run(), 'chosen-card');
    assert.equal(h.calls.find(([kind]) => kind === 'pick')[2], 'chosen-card');
  } finally { await h.close(); }
});

test('kill/relaunch restores the server-authorized creator run without a fresh invite or start', async () => {
  const h = await fixture();
  try {
    await h.accept();
    const before = h.calls.length;
    await h.remount();
    assert.match(h.text(), /Creator replay ready/);
    assert.deepEqual(h.calls.slice(before).map(([kind]) => kind), ['load']);
  } finally { await h.close(); }
});

for (const sourceType of ['practice', 'daily']) test(`${sourceType} creator self-open uses the original source surface`, async () => {
  const h = await fixture({ start: async () => ({ ...run(), day: sourceType === 'daily' ? '2026-10-01' : null, creator_challenge_id: null,
    creator_source_owner: { challenge_id: CHALLENGE, source_type: sourceType } }) });
  try { await h.accept(); assert.match(h.text(), new RegExp(`${sourceType} source ready`)); assert.equal(h.store.has(KEY), false); }
  finally { await h.close(); }
});

test('a stored run is reauthorized after an account switch and a 404 returns to the invite', async () => {
  const h = await fixture({ checkpoint: true, load: async session => { if (session.accountToken) throw new ApiError(404); return run(); } });
  try {
    assert.match(h.text(), /Creator replay ready/);
    await h.switchSession({ ...guest(), accountToken: 'B'.repeat(43) });
    assert.match(h.text(), /BEAT THE CREATOR/);
    assert.equal(h.calls.filter(([kind]) => kind === 'load').at(-1)[2].accountToken, 'B'.repeat(43));
    assert.equal(h.calls.filter(([kind]) => kind === 'start').length, 0);
  } finally { await h.close(); }
});

test('privacy retirement during recovery fails closed without loading public metadata', async () => {
  const h = await fixture({ checkpoint: true, load: async () => { throw new ApiError(410); } });
  try { assert.match(h.text(), /unavailable/); assert.equal(h.calls.filter(([kind]) => kind === 'info').length, 0); }
  finally { await h.close(); }
});
