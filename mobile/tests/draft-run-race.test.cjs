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
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function host(name) {
  return function Host(props) {
    return React.createElement(name, props, props.children);
  };
}

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

function compileDraftRunScreen(mocks) {
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

  const priorLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return priorLoad.call(this, request, parent, isMain);
  };
  try {
    compiled._compile(output, filename);
  } finally {
    Module._load = priorLoad;
  }
  return compiled.exports.default;
}

function card(id, name) {
  return { id, name };
}

function puzzle(id, pickNumber) {
  return {
    puzzle_id: id,
    set_id: 'msh',
    pack_number: 1,
    pick_number: pickNumber,
    prior_picks: [],
    candidates: [card('a', 'Card A'), card('b', 'Card B')],
  };
}

function runZero() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    environment: 'mixed',
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
    current: puzzle('puzzle-0', 1),
  };
}

function runAfterPick() {
  const first = puzzle('puzzle-0', 1);
  return {
    ...runZero(),
    revision: 5,
    round: 1,
    answers: [{
      score: 88,
      selectedId: 'a',
      selectedName: 'Card A',
      selectedSupport: 0.8,
      historicalId: 'b',
      historicalName: 'Card B',
      historicalMatch: false,
      consensusId: 'a',
      consensusName: 'Card A',
      consensusSupport: 0.8,
      ranking: [
        { id: 'a', name: 'Card A', support: 0.8, score: 88 },
        { id: 'b', name: 'Card B', support: 0.7, score: 100 },
      ],
      puzzle: first,
    }],
    current: puzzle('puzzle-1', 2),
  };
}

test('delayed foreground zero-answer response cannot overwrite a successful pick', async () => {
  const oldRefresh = deferred();
  const session = {
    playerToken: 'p1_11111111-1111-4111-8111-111111111111.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  };
  let startCalls = 0;
  let resumeCallback = null;

  const Image = host('Image');
  Image.prefetch = async () => {};

  const mocks = {
    'expo-haptics': {
      selectionAsync: async () => {},
      notificationAsync: async () => {},
      NotificationFeedbackType: { Success: 'success' },
    },
    'expo-image': { Image },
    'expo-router': {
      router: { push() {}, replace() {} },
      useLocalSearchParams: () => ({ environment: 'mixed' }),
    },
    'react-native': {
      AccessibilityInfo: { announceForAccessibility() {} },
      ActivityIndicator: host('ActivityIndicator'),
      Modal: host('Modal'),
      Pressable: host('Pressable'),
      ScrollView,
      Share: { share: async () => {} },
      StyleSheet: { create: (value) => value },
      Text: host('Text'),
      View: host('View'),
    },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/api/guest': { ensureGuestSession: async () => session },
    '@/src/api/draftRun': {
      createDraftRunShare: async () => ({ id: 'a'.repeat(24) }),
      DAILY_ENVIRONMENT_META: {
        mixed: { title: 'Draft Run', eyebrow: 'DAILY DRAFT RUN', description: '', resultTitle: 'Your Draft Run.' },
        'powered-cube': { title: 'Powered Cube', eyebrow: 'POWERED CUBE DAILY', description: '', resultTitle: 'Your Powered Cube.' },
        latest: { title: 'Latest Set', eyebrow: 'LATEST SET DAILY', description: '', resultTitle: 'Your Latest Set run.' },
      },
      isDailyEnvironment: (value) => ['mixed', 'powered-cube', 'latest'].includes(value),
      loadDraftRun: async () => runZero(),
      rerollDraftRun: async () => runZero(),
      startDailyDraftRun: async () => {
        startCalls += 1;
        return startCalls === 1 ? runZero() : oldRefresh.promise;
      },
      startPracticeDraftRun: async () => runZero(),
      submitDraftRunPick: async () => runAfterPick(),
    },
    '@/src/hooks/useAppResume': {
      useAppResume(callback) {
        resumeCallback = callback;
      },
    },
    '@/src/storage/idempotency': {
      clearPracticeIdempotencyKey: async () => {},
      practiceIdempotencyKey: async () => 'practice_' + 'k'.repeat(32),
    },
    '@/src/theme': {
      colors: new Proxy({}, { get: () => '#000' }),
      spacing: new Proxy({}, { get: () => 8 }),
    },
  };

  const DraftRunScreen = compileDraftRunScreen(mocks);
  let root;

  await act(async () => {
    root = TestRenderer.create(React.createElement(DraftRunScreen));
    await Promise.resolve();
    await Promise.resolve();
  });

  assert.equal(startCalls, 1);
  assert.ok(root.toJSON(), 'initial Draft Run should render');

  let refreshPromise;
  await act(async () => {
    refreshPromise = resumeCallback();
    await Promise.resolve();
  });
  assert.equal(startCalls, 2, 'foreground refresh should be in flight');

  const pick = root.root.findAll(
    (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Pick Card A',
  )[0];
  assert.ok(pick, 'pick button should be mounted');
  await act(async () => {
    pick.props.onPress();
  });

  const confirm = root.root.findAll((node) => (
    node.type === 'Pressable'
    && renderedText(node.toJSON?.() || node).includes('Confirm pick')
  ))[0] || root.root.findAll((node) => (
    node.type === 'Pressable'
    && node.findAll((child) => child.type === 'Text' && child.props.children === 'Confirm pick').length > 0
  ))[0];
  assert.ok(confirm, 'confirm button should be mounted');

  await act(async () => {
    confirm.props.onPress();
    await Promise.resolve();
    await Promise.resolve();
  });

  assert.match(renderedText(root.toJSON()), /88/, 'successful pick should enter feedback');

  await act(async () => {
    oldRefresh.resolve(runZero());
    await refreshPromise;
    await Promise.resolve();
  });

  assert.ok(root.toJSON(), 'old foreground response must not blank the mounted screen');
  assert.match(renderedText(root.toJSON()), /88/, 'successful feedback must remain authoritative');

  await act(async () => root.unmount());
});


test('a committed pick with a lost response is reconciled into feedback', async () => {
  const session = {
    playerToken: 'p1_11111111-1111-4111-8111-111111111111.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  };
  let loadCalls = 0;

  const Image = host('Image');
  Image.prefetch = async () => {};

  const mocks = {
    'expo-haptics': {
      selectionAsync: async () => {},
      notificationAsync: async () => {},
      NotificationFeedbackType: { Success: 'success' },
    },
    'expo-image': { Image },
    'expo-router': {
      router: { push() {}, replace() {} },
      useLocalSearchParams: () => ({ environment: 'mixed' }),
    },
    'react-native': {
      AccessibilityInfo: { announceForAccessibility() {} },
      ActivityIndicator: host('ActivityIndicator'),
      Modal: host('Modal'),
      Pressable: host('Pressable'),
      ScrollView,
      Share: { share: async () => {} },
      StyleSheet: { create: (value) => value },
      Text: host('Text'),
      View: host('View'),
    },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/api/guest': { ensureGuestSession: async () => session },
    '@/src/api/draftRun': {
      createDraftRunShare: async () => ({ id: 'a'.repeat(24) }),
      DAILY_ENVIRONMENT_META: {
        mixed: { title: 'Draft Run', eyebrow: 'DAILY DRAFT RUN', description: '', resultTitle: 'Your Draft Run.' },
        'powered-cube': { title: 'Powered Cube', eyebrow: 'POWERED CUBE DAILY', description: '', resultTitle: 'Your Powered Cube.' },
        latest: { title: 'Latest Set', eyebrow: 'LATEST SET DAILY', description: '', resultTitle: 'Your Latest Set run.' },
      },
      isDailyEnvironment: (value) => ['mixed', 'powered-cube', 'latest'].includes(value),
      loadDraftRun: async () => {
        loadCalls += 1;
        return runAfterPick();
      },
      rerollDraftRun: async () => runZero(),
      startDailyDraftRun: async () => runZero(),
      startPracticeDraftRun: async () => runZero(),
      submitDraftRunPick: async () => {
        throw new Error('Network interrupted after the server committed the pick.');
      },
    },
    '@/src/hooks/useAppResume': { useAppResume() {} },
    '@/src/storage/idempotency': {
      clearPracticeIdempotencyKey: async () => {},
      practiceIdempotencyKey: async () => 'practice_' + 'k'.repeat(32),
    },
    '@/src/theme': {
      colors: new Proxy({}, { get: () => '#000' }),
      spacing: new Proxy({}, { get: () => 8 }),
    },
  };

  const DraftRunScreen = compileDraftRunScreen(mocks);
  let root;

  await act(async () => {
    root = TestRenderer.create(React.createElement(DraftRunScreen));
    await Promise.resolve();
    await Promise.resolve();
  });

  const pick = root.root.findAll(
    (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Pick Card A',
  )[0];
  assert.ok(pick, 'pick button should be mounted');
  await act(async () => {
    pick.props.onPress();
  });

  const confirm = root.root.findAll((node) => (
    node.type === 'Pressable'
    && node.findAll((child) => child.type === 'Text' && child.props.children === 'Confirm pick').length > 0
  ))[0];
  assert.ok(confirm, 'confirm button should be mounted');

  await act(async () => {
    confirm.props.onPress();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  assert.equal(loadCalls, 1, 'ambiguous mutation should reconcile the authoritative run exactly once');
  assert.ok(root.toJSON(), 'the run must stay mounted after the lost mutation response');
  const text = renderedText(root.toJSON());
  assert.match(text, /88/, 'the committed pick should be shown as feedback');
  assert.doesNotMatch(text, /Network interrupted/, 'transport failure should not replace recovered server state');

  await act(async () => root.unmount());
});
