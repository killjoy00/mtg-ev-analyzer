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
function playableRun(environment, sourceType, setIds, count = 0) {
  const complete = count === 8;
  const puzzle = index => ({ puzzle_id: `creator-puzzle-${index}`, set_id: setIds[0] ?? 'cube', pack_number: 1, pick_number: index + 1,
    prior_picks: [], candidates: [{ id: 'a', name: 'Card A' }, { id: 'b', name: 'Card B' }, { id: 'c', name: 'Card C' }] });
  return { ...run(), environment, revision: count, round: count, complete, score: complete ? 88 : null,
    leaderboard_eligible: false, custom_set_ids: setIds, rerolls: { set: 0, pack: 0 }, set_reroll_allowed: false,
    current: complete ? null : puzzle(count),
    answers: Array.from({ length: count }, (_, index) => ({ score: 88, selectedId: 'a', selectedName: 'Card A',
      historicalId: 'b', historicalName: 'Card B', historicalMatch: false, creatorId: 'c', creatorName: 'Card C', puzzle: puzzle(index) })),
    comparison: { ...run().comparison, source_type: sourceType, source_day: sourceType === 'daily' ? '2026-01-01' : null,
      ...(complete ? { outcome: 'win', creator_matches: 0, trophy_matches: 0 } : {}) },
  };
}
class ApiError extends Error { constructor(status) { super(`HTTP ${status}`); this.status = status; } }
const host = name => function Host(props) { return React.createElement(name, props, props.children); };
const text = node => node == null ? '' : typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join(' ') : text(node.children ?? node.props?.children);
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }

// Execute the production route and production session/continuation modules.
// Platform primitives and transport are test adapters. Access regressions also
// mount the real gameplay view; entry/recovery tests use a lightweight child.
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
  const store = new Map([[SESSION_KEY, JSON.stringify(options.session ?? guest())]]);
  if (options.checkpoint) store.set(KEY, JSON.stringify({ challengeId: CHALLENGE, runId: RUN, playerId: PLAYER, slug: info.slug }));
  const calls = [];
  let root, sessionApi, Screen, surface;
  const Image = host('Image');
  Image.prefetch = async () => {};
  const ScrollView = React.forwardRef(function ScrollViewHost(props, ref) {
    React.useImperativeHandle(ref, () => ({ scrollTo() {} }), []);
    return React.createElement('ScrollView', props, props.children);
  });
  const mocks = {
    react: React,
    'react-native': { ActivityIndicator: host('Spinner'), Pressable: host('Pressable'), ScrollView, View: host('View'), TextInput: host('TextInput'),
      Modal: props => props.visible ? React.createElement('Modal', props, props.children) : null,
      StyleSheet: { create: value => value }, Platform: { OS: 'android' },
      useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
      AccessibilityInfo: { announceForAccessibility() {} }, Share: { share: async value => calls.push(['share', value]) } },
    'expo-image': { Image },
    'expo-haptics': { selectionAsync: async () => {}, notificationAsync: async () => {}, NotificationFeedbackType: { Success: 'success' } },
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
      DAILY_ENVIRONMENT_META: { mixed: {}, latest: {}, 'powered-cube': {} },
      isDailyEnvironment: value => ['mixed', 'latest', 'powered-cube'].includes(value),
      loadCreatorChallengeInfo: async (id, session) => { calls.push(['info', id, session]); return options.loadInfo ? options.loadInfo(id, session) : info; },
      startCreatorChallenge: async (session, id) => { calls.push(['start', id, session]); return options.start ? options.start(session, id) : run(); },
      loadDraftRun: async (id, session) => { calls.push(['load', id, session]); return options.load ? options.load(session, id) : run(); },
      submitDraftRunPick: async (current, cardId, session) => { calls.push(['pick', current.id, cardId, session]); return options.pick ? options.pick(current, cardId, session) : run(); },
      createDraftRunShare: async () => ({}),
      startDailyDraftRun: async () => { calls.push(['daily']); throw new Error('Creator replay must not start a Daily.'); },
      startPracticeDraftRun: async () => { calls.push(['practice']); throw new Error('Creator replay must not start normal practice.'); },
      loadPracticeCapabilities: async () => { calls.push(['capabilities']); throw new Error('Creator replay does not require practice capabilities.'); },
      rerollDraftRun: async () => { calls.push(['reroll']); throw new Error('Creator replay must retain its exact decisions.'); },
    },
  };
  if (options.realGameplay) delete mocks['./draft-run'];
  function freshRuntime() { const load = compileGraph(mocks); sessionApi = load('src/storage/session.ts'); Screen = load('app/creator-run.tsx').default; }
  freshRuntime();
  await act(async () => { root = Renderer.create(React.createElement(Screen)); await flush(); });
  return { calls, store, text: () => text(root.toJSON()), surface: () => surface,
    async accept() { const button = root.root.findAll(node => node.type === 'Pressable' && text(node.props.children).includes('Play Fixture'))[0];
      assert.ok(button, 'actual creator invite must offer explicit guest acceptance');
      await act(async () => { await button.props.onPress(); await flush(); }); },
    async press(label) { const button = root.root.findAll(node => node.type === 'Pressable'
      && (node.props.accessibilityLabel === label || text(node.props.children) === label))[0];
      assert.ok(button, `missing gameplay action: ${label}`);
      assert.notEqual(button.props.disabled, true, `${label} must be enabled`);
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

for (const [access, session] of [['guest', guest()], ['free account', { ...guest(), accountToken: 'B'.repeat(43) }]]) {
  for (const [label, environment, sourceType, setIds] of [
    ['Cube Practice', 'powered-cube', 'practice', []],
    ['older set Practice', 'mixed', 'practice', ['dsk']],
    ['Cube Daily', 'powered-cube', 'daily', []],
    ['Latest Set Daily', 'latest', 'daily', ['dsk']],
  ]) test(`${access} can finish and reopen the actual ${label} creator replay without Elite`, async () => {
    let server = playableRun(environment, sourceType, setIds);
    const h = await fixture({ session, realGameplay: true,
      loadInfo: async () => ({ ...info, environment, source_type: sourceType, source_day: server.comparison.source_day }),
      start: async () => structuredClone(server), load: async () => structuredClone(server),
      pick: async current => { server = playableRun(environment, sourceType, setIds, current.answers.length + 1); return structuredClone(server); },
    });
    try {
      assert.match(h.text(), /BEAT THE CREATOR/);
      await h.accept();
      for (let round = 0; round < 8; round += 1) {
        assert.doesNotMatch(h.text(), /Sign in|Elite|Upgrade/);
        await h.press('Pick Card A');
        await h.press('Confirm pick');
        assert.match(h.text(), /Fixture Creator’s Pick/);
        await h.press(round === 7 ? 'See result' : 'Next pick');
      }
      assert.match(h.text(), /You beat Fixture Creator/);
      assert.match(h.text(), /does not consume or modify your Daily attempt/);
      assert.equal(h.calls.filter(([kind]) => kind === 'start').length, 1);
      assert.equal(h.calls.filter(([kind]) => kind === 'pick').length, 8);
      for (const [kind, , , pickedSession] of h.calls.filter(([kind]) => kind === 'pick')) {
        assert.equal(kind, 'pick');
        assert.equal(pickedSession.accountToken, session.accountToken);
      }
      const beforeReopen = h.calls.length;
      await h.remount();
      assert.match(h.text(), /You beat Fixture Creator/);
      assert.deepEqual(h.calls.slice(beforeReopen).map(([kind]) => kind), ['load']);
      assert.equal(h.calls.filter(([kind]) => ['daily', 'practice', 'capabilities', 'reroll', 'replace', 'dismiss'].includes(kind)).length, 0);
    } finally { await h.close(); }
  });
}

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
