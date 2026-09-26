const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const TestRenderer = require('react-test-renderer');

const { act } = TestRenderer;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const host = (name) => function Host(props) {
  return React.createElement(name, props, props.children);
};
const ScrollView = React.forwardRef(function ScrollViewHost(props, ref) {
  React.useImperativeHandle(ref, () => ({ scrollTo() {} }), []);
  return React.createElement('ScrollView', props, props.children);
});

function renderedText(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(renderedText).join(' ');
  return renderedText(node.children || []);
}

function compileScreen(mocks) {
  const filename = path.join(process.cwd(), 'app', 'draft-run.tsx');
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    compiled._compile(output, filename);
  } finally {
    Module._load = originalLoad;
  }
  return compiled.exports.default;
}

function puzzle(index) {
  return {
    puzzle_id: `puzzle-${index}`,
    set_id: 'msh',
    pack_number: 1,
    pick_number: index + 1,
    prior_picks: [],
    candidates: [{ id: 'a', name: 'Card A' }, { id: 'b', name: 'Card B' }],
  };
}

function runZero(environment = 'mixed') {
  return {
    id: environment === 'mixed'
      ? '11111111-1111-4111-8111-111111111111'
      : '22222222-2222-4222-8222-222222222222',
    environment,
    run_length: 8,
    set_reroll_allowed: false,
    custom_set_ids: [],
    rerolls: { set: 0, pack: 0 },
    day: '2026-09-26',
    revision: 4,
    round: 0,
    complete: false,
    score: null,
    leaderboard_eligible: true,
    answers: [],
    current: puzzle(0),
  };
}

function answer(index, selectedId, score) {
  const selectedName = selectedId === 'a' ? 'Card A' : 'Card B';
  const historicalId = selectedId === 'a' ? 'b' : 'a';
  const historicalName = historicalId === 'a' ? 'Card A' : 'Card B';
  return {
    score,
    selectedId,
    selectedName,
    historicalId,
    historicalName,
    historicalMatch: false,
    puzzle: puzzle(index),
  };
}

async function flush() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function fixture(options = {}) {
  let params = options.params ?? { environment: 'mixed' };
  const session = {
    playerToken: `p1_11111111-1111-4111-8111-111111111111.${'A'.repeat(43)}`,
    accountToken: 'B'.repeat(43),
  };
  const Image = host('Image');
  Image.prefetch = async () => {};
  const mocks = {
    'expo-haptics': {
      selectionAsync: async () => {}, notificationAsync: async () => {},
      NotificationFeedbackType: { Success: 'success' },
    },
    'expo-image': { Image },
    'expo-router': {
      router: { push() {}, replace() {} },
      useLocalSearchParams: () => params,
    },
    'react-native': {
      AccessibilityInfo: { announceForAccessibility() {} },
      ActivityIndicator: host('ActivityIndicator'), Modal: host('Modal'),
      Pressable: host('Pressable'), ScrollView, Share: { share: async () => {} },
      StyleSheet: { create: (value) => value }, Text: host('Text'), View: host('View'),
    },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/api/guest': { ensureGuestSession: async () => session },
    '@/src/api/draftRun': {
      createDraftRunShare: async () => ({ id: 'a'.repeat(24) }),
      DAILY_ENVIRONMENT_META: {
        mixed: { eyebrow: 'DAILY DRAFT RUN', resultTitle: 'Your Draft Run.' },
        latest: { eyebrow: 'LATEST SET DAILY', resultTitle: 'Your Latest Set run.' },
        'powered-cube': { eyebrow: 'POWERED CUBE DAILY', resultTitle: 'Your Powered Cube.' },
      },
      isDailyEnvironment: (value) => ['mixed', 'latest', 'powered-cube'].includes(value),
      startDailyDraftRun: async (_session, environment) => runZero(environment),
      startPracticeDraftRun: async (_session, { environment }) => ({ ...runZero(environment), day: null }),
      loadDraftRun: options.loadRun ?? (async () => runZero()),
      submitDraftRunPick: options.submitPick ?? (async () => { throw new Error('Response lost.'); }),
      rerollDraftRun: async () => runZero(),
    },
    '@/src/hooks/useAppResume': { useAppResume() {} },
    '@/src/storage/idempotency': {
      clearPracticeIdempotencyKey: options.clearKey ?? (async () => {}),
      practiceIdempotencyKey: async () => 'practice_' + 'k'.repeat(32),
    },
    '@/src/theme': {
      colors: new Proxy({}, { get: () => '#000' }),
      spacing: new Proxy({}, { get: () => 8 }),
    },
  };
  const Screen = compileScreen(mocks);
  let root;
  await act(async () => {
    root = TestRenderer.create(React.createElement(Screen));
    await flush();
  });
  return {
    root,
    text: () => renderedText(root.toJSON()),
    async chooseAndConfirm() {
      const pick = root.root.findAll((node) => (
        node.type === 'Pressable' && node.props.accessibilityLabel === 'Pick Card A'
      ))[0];
      assert.ok(pick, 'the actual screen must expose the selectable card');
      await act(async () => pick.props.onPress());
      const confirm = root.root.findAll((node) => (
        node.type === 'Pressable' && renderedText(node).includes('Confirm pick')
      ))[0];
      assert.ok(confirm, 'the actual screen must expose confirm');
      await act(async () => { confirm.props.onPress(); await flush(); });
    },
    async navigate(next) {
      params = next;
      await act(async () => { root.update(React.createElement(Screen)); await flush(); });
    },
    async close() { await act(async () => root.unmount()); },
  };
}

test('reconciliation keeps all server progress but shows the exact recovered round', async () => {
  const reconciled = {
    ...runZero(), revision: 6, round: 2,
    answers: [answer(0, 'a', 88), answer(1, 'b', 25)], current: puzzle(2),
  };
  const screen = await fixture({ loadRun: async () => reconciled });
  try {
    await screen.chooseAndConfirm();
    assert.match(screen.text(), /You chose\s+Card A/);
    assert.doesNotMatch(screen.text(), /You chose\s+Card B/);
    assert.ok(screen.root.root.findAll((node) => node.type === 'Text' && node.props.children === 88).length);
    const progress = screen.root.root.findAll((node) => node.type === 'View' && node.props.accessibilityRole === 'progressbar')[0];
    assert.equal(progress.props.accessibilityValue.now, 2, 'do not truncate the authoritative run to the recovered round');
  } finally { await screen.close(); }
});

for (const failedRead of [false, true]) {
  test(`an ${failedRead ? 'unavailable' : 'uncommitted'} reconciliation preserves the selectable run`, async () => {
    const screen = await fixture({ loadRun: async () => {
      if (failedRead) throw new Error('GET unavailable.');
      return runZero();
    } });
    try {
      await screen.chooseAndConfirm();
      assert.match(screen.text(), /Response lost/);
      assert.doesNotMatch(screen.text(), /Couldn.t load Draft Run/);
      assert.ok(screen.root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Pick Card A').length);
    } finally { await screen.close(); }
  });
}

test('a late reconciliation error cannot attach itself to a newly opened run', async () => {
  const pending = deferred();
  const screen = await fixture({ loadRun: () => pending.promise });
  try {
    await screen.chooseAndConfirm();
    await screen.navigate({ environment: 'latest' });
    assert.match(screen.text(), /LATEST SET DAILY/);
    await act(async () => { pending.reject(new Error('Late GET failure.')); await flush(); });
    assert.match(screen.text(), /LATEST SET DAILY/);
    assert.doesNotMatch(screen.text(), /Response lost|Late GET failure/);
  } finally { await screen.close(); }
});

test('finishing an old practice-key cleanup cannot restore a previous run after navigation', async () => {
  const cleanup = deferred();
  const complete = {
    ...runZero(), day: null, revision: 5, round: 1, run_length: 1,
    complete: true, score: 88, answers: [answer(0, 'a', 88)], current: null,
  };
  const screen = await fixture({
    params: { environment: 'mixed', mode: 'practice' },
    submitPick: async () => complete,
    clearKey: () => cleanup.promise,
  });
  try {
    await screen.chooseAndConfirm();
    await screen.navigate({ environment: 'powered-cube', mode: 'practice' });
    assert.match(screen.text(), /POWERED CUBE PRACTICE/);
    await act(async () => { cleanup.resolve(); await flush(); });
    assert.match(screen.text(), /POWERED CUBE PRACTICE/);
    assert.doesNotMatch(screen.text(), /You chose/);
    const progress = screen.root.root.findAll((node) => node.type === 'View' && node.props.accessibilityRole === 'progressbar')[0];
    assert.equal(progress.props.accessibilityValue.now, 0);
  } finally { await screen.close(); }
});
