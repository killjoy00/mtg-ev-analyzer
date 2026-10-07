const { compileModule } = require('./support/compile-module.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
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
  return compileModule('app/draft-run.tsx', mocks, { resolve: (request) => {
    if (request === '@/src/storage/session' && !mocks[request]) return { readSession: mocks['@/src/api/guest'].ensureGuestSession, subscribeSession: () => () => {} };
    if (request === '@/src/config') return { config: { screenshots: { fixtures: false } } };
  } }).default;
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
  let session = {
    playerToken: `p1_11111111-1111-4111-8111-111111111111.${'A'.repeat(43)}`,
    accountToken: 'B'.repeat(43),
  };
  const sessionListeners = new Set();
  const Image = host('Image');
  Image.prefetch = async () => {};
  const mocks = {
    'expo-application': { nativeApplicationVersion: '1.0', nativeBuildVersion: '1' },
    'expo-haptics': {
      selectionAsync: async () => {}, notificationAsync: async () => {},
      NotificationFeedbackType: { Success: 'success' },
    },
    'expo-image': { Image },
    'expo-router': {
      router: { push() {}, replace() {} },
      useLocalSearchParams: () => params,
    },
    'react-native': { useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
      AccessibilityInfo: { announceForAccessibility() {} },
      ActivityIndicator: host('ActivityIndicator'), KeyboardAvoidingView: host('KeyboardAvoidingView'), Modal: host('Modal'),
      Platform: { OS: 'ios' }, Pressable: host('Pressable'), ScrollView, Share: { share: async () => {} },
      Linking: { openURL: options.openURL ?? (async () => {}) },
      StyleSheet: { create: (value) => value }, Text: host('Text'), TextInput: host('TextInput'), View: host('View'),
    },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/api/guest': { ensureGuestSession: async () => session },
    '@/src/storage/session': { readSession: async () => session, subscribeSession: callback => { sessionListeners.add(callback); return () => sessionListeners.delete(callback); } },
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
      submitDraftRunDecisionReport: options.submitReport ?? (async () => ({ ok: true, id: 'report-id' })),
      rerollDraftRun: async () => runZero(),
    },
    '@/src/hooks/useAppResume': { useAppResume() {} },
    '@/src/storage/idempotency': {
      clearPracticeIdempotencyKey: options.clearKey ?? (async () => {}),
      practiceIdempotencyKey: async () => 'practice_' + 'k'.repeat(32),
    },
    '@/src/tcgplayer': {
      tcgplayerUrl: (name) => 'https://partner.tcgplayer.com/c/7742974/1780961/21018?u='
        + encodeURIComponent('https://www.tcgplayer.com/search/magic/product?q=' + encodeURIComponent(String(name).trim()) + '&view=grid'),
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
    async switchAccount() { await act(async () => { session = { ...session, accountToken: 'C'.repeat(43) }; for (const callback of sessionListeners) callback(session); await flush(); }); },
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
    assert.ok(screen.root.root.findAll((node) => node.type === 'Text' && node.props.testID === 'feedback-score' && node.props.children[0] === 88).length);
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


test('TCGplayer affiliate destinations stay hidden until score analysis is opened', async () => {
  const completedPick = { ...runZero(), revision: 5, round: 1, answers: [answer(0, 'a', 88)], current: puzzle(1) };
  const screen = await fixture({ submitPick: async () => completedPick });
  try {
    assert.doesNotMatch(screen.text(), /TCGplayer/);
    await screen.chooseAndConfirm();
    assert.doesNotMatch(screen.text(), /TCGplayer/, 'compact reveal must not contain affiliate links');
    const why = screen.root.root.findAll((node) => node.type === 'Pressable' && renderedText(node).includes('Why this score?'))[0];
    assert.ok(why);
    await act(async () => why.props.onPress());
    assert.equal(screen.root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityRole === 'link').length, 2);
    assert.match(screen.text(), /Affiliate links\. Pack One may earn a commission/);
  } finally { await screen.close(); }
});


test('decision report stays inside score analysis and preserves the run', async () => {
  const reports = [];
  const completedPick = { ...runZero(), revision: 5, round: 1, answers: [answer(0, 'a', 88)], current: puzzle(1) };
  const screen = await fixture({
    submitPick: async () => completedPick,
    submitReport: async (...args) => { reports.push(args); return { ok: true, id: 'report-id' }; },
  });
  try {
    await screen.chooseAndConfirm();
    assert.doesNotMatch(screen.text(), /Report this decision/);
    const why = screen.root.root.findAll((node) => node.type === 'Pressable' && renderedText(node).includes('Why this score?'))[0];
    await act(async () => why.props.onPress());
    const report = screen.root.root.findAll((node) => node.type === 'Pressable' && renderedText(node).includes('Report this decision'))[0];
    assert.ok(report);
    await act(async () => report.props.onPress());
    const reason = screen.root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityRole === 'radio'
      && renderedText(node).includes('Score / recommendation seems wrong'))[0];
    assert.ok(reason);
    await act(async () => reason.props.onPress());
    const comment = screen.root.root.findAll((node) => node.type === 'TextInput' && node.props.accessibilityLabel === 'Anything else?')[0];
    await act(async () => comment.props.onChangeText('The recommendation looks reversed.'));
    const send = screen.root.root.findAll((node) => node.type === 'Pressable' && renderedText(node).includes('Send report'))[0];
    await act(async () => { send.props.onPress(); await flush(); });
    assert.equal(reports.length, 1);
    assert.equal(reports[0][0].id, completedPick.id);
    assert.equal(reports[0][1], 0);
    assert.equal(reports[0][2], 'score_recommendation');
    assert.equal(reports[0][3], 'The recommendation looks reversed.');
    assert.match(reports[0][4].playerToken, /^p1_11111111-1111-4111-8111-111111111111\./);
    assert.match(screen.text(), /Thanks — report sent\./);
    assert.match(screen.text(), /Hide score analysis/);
  } finally { await screen.close(); }
});

test('revealed-card affiliate link opens the approved card-specific Impact destination', async () => {
  const opened = [];
  const custom = puzzle(0);
  custom.candidates = [{ id: 'a', name: 'Black Lotus & Co' }, { id: 'b', name: 'Mox Pearl' }];
  const selected = { ...answer(0, 'a', 88), selectedName: 'Black Lotus & Co', historicalName: 'Mox Pearl', puzzle: custom };
  const completedPick = { ...runZero(), revision: 5, round: 1, answers: [selected], current: puzzle(1) };
  const screen = await fixture({ submitPick: async () => completedPick, openURL: async (url) => { opened.push(url); } });
  try {
    await screen.chooseAndConfirm();
    const why = screen.root.root.findAll((node) => node.type === 'Pressable' && renderedText(node).includes('Why this score?'))[0];
    await act(async () => why.props.onPress());
    const link = screen.root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Find Black Lotus & Co on TCGplayer, affiliate link')[0];
    assert.ok(link);
    await act(async () => { link.props.onPress(); await flush(); });
    assert.equal(opened.length, 1);
    assert.equal(opened[0], 'https://partner.tcgplayer.com/c/7742974/1780961/21018?u=https%3A%2F%2Fwww.tcgplayer.com%2Fsearch%2Fmagic%2Fproduct%3Fq%3DBlack%2520Lotus%2520%2526%2520Co%26view%3Dgrid');
  } finally { await screen.close(); }
});

test('failed revealed-card affiliate handoff stays in analysis and offers a retryable error', async () => {
  const completedPick = { ...runZero(), revision: 5, round: 1, answers: [answer(0, 'a', 88)], current: puzzle(1) };
  const screen = await fixture({ submitPick: async () => completedPick, openURL: async () => { throw new Error('no handler'); } });
  try {
    await screen.chooseAndConfirm();
    const why = screen.root.root.findAll((node) => node.type === 'Pressable' && renderedText(node).includes('Why this score?'))[0];
    await act(async () => why.props.onPress());
    const link = screen.root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Find Card A on TCGplayer, affiliate link')[0];
    await act(async () => { link.props.onPress(); await flush(); });
    assert.match(screen.text(), /Could not open TCGplayer\. You can try the affiliate link again\./);
    assert.match(screen.text(), /Hide score analysis/);
  } finally { await screen.close(); }
});


test('TCGplayer helper rejects blank names and preserves the approved nested card destination', () => {
  const compiled = { exports: compileModule('src/tcgplayer.ts', {}) };
  assert.throws(() => compiled.exports.tcgplayerUrl('   '), /Invalid TCGplayer card name/);
  assert.equal(
    compiled.exports.tcgplayerUrl('Black Lotus & Co'),
    'https://partner.tcgplayer.com/c/7742974/1780961/21018?u=https%3A%2F%2Fwww.tcgplayer.com%2Fsearch%2Fmagic%2Fproduct%3Fq%3DBlack%2520Lotus%2520%2526%2520Co%26view%3Dgrid',
  );
});


test('account switching invalidates mounted gameplay and discards a delayed pick', async () => {
  const pending = deferred();
  const screen = await fixture({ submitPick: () => pending.promise });
  try {
    await screen.chooseAndConfirm();
    await screen.switchAccount();
    assert.match(screen.text(), /Your account changed/);
    await act(async () => { pending.resolve({ ...runZero(), revision: 5, round: 1, answers: [answer(0, 'a', 88)], current: puzzle(1) }); await flush(); });
    assert.doesNotMatch(screen.text(), /You chose/);
    assert.match(screen.text(), /Your account changed/);
  } finally { await screen.close(); }
});
