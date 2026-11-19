'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const { compileModule } = require('./support/compile-module.cjs');

const { act } = TestRenderer;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const today = '2026-11-19';

function host(name) {
  return function Host(props) { return React.createElement(name, props, props.children); };
}
const ScrollView = React.forwardRef(function MockScroll(props, ref) {
  React.useImperativeHandle(ref, () => ({ scrollTo() {} }), []);
  return React.createElement('ScrollView', props, props.children);
});
function puzzle(n) {
  return { puzzle_id: 'decision-' + n, set_id: 'hob', pack_number: 1,
    pick_number: n, prior_picks: [],
    candidates: [{ id: 'a', name: 'Card A' }, { id: 'b', name: 'Card B' }] };
}
function answer(n) {
  return { puzzle: puzzle(n), score: 100, selectedId: 'a', selectedName: 'Card A',
    selectedSupport: .85, historicalId: 'a', historicalName: 'Card A', historicalMatch: true,
    consensusId: 'a', consensusName: 'Card A', consensusSupport: .85,
    ranking: [{ id: 'a', name: 'Card A', support: .85, score: 100 },
      { id: 'b', name: 'Card B', support: .15, score: 25 }] };
}
function run(complete, missingHistoricPuzzle) {
  const answers = Array.from({ length: complete ? 8 : 7 }, (_unused, i) => answer(i + 1));
  if (missingHistoricPuzzle) answers[2].puzzle = null;
  return { id: '11111111-1111-4111-8111-111111111111', environment: 'mixed',
    day: today, run_length: 8, revision: complete ? 9 : 8,
    round: complete ? 8 : 7, complete, score: complete ? 100 : null,
    leaderboard_eligible: true, set_reroll_allowed: false, custom_set_ids: [],
    rerolls: { set: 0, pack: 0 }, answers, current: complete ? null : puzzle(8) };
}
function renderedText(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(renderedText).join(' ');
  return renderedText(node.children || []);
}
function button(root, label) {
  return root.root.findAll(node => node.type === 'Pressable' &&
    node.findAll(child => child.type === 'Text' && child.props.children === label).length > 0)[0];
}

test('the eighth native Daily pick advances to a readable saved result, even with legacy recap metadata', async () => {
  const session = { playerToken: 'p1_11111111-1111-4111-8111-111111111111.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
  const Image = host('Image');
  Image.prefetch = async () => {};
  const appState = { currentState: 'active', addEventListener: () => ({ remove() {} }) };
  const mocks = {
    'expo-image': { Image },
    'expo-application': { nativeApplicationVersion: '1.4', nativeBuildVersion: '101164' },
    'expo-haptics': { selectionAsync: async () => {}, notificationAsync: async () => {},
      NotificationFeedbackType: { Success: 'success' } },
    'expo-web-browser': { openBrowserAsync: async () => ({ type: 'dismiss' }) },
    'expo-router': {
      router: { push() {}, replace() {}, dismissTo() {} },
      useLocalSearchParams: () => ({ environment: 'mixed' }),
      useFocusEffect(callback) { React.useEffect(callback, [callback]); },
    },
    'react-native': { AppState: appState, Platform: { OS: 'ios' },
      useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
      AccessibilityInfo: { announceForAccessibility() {} }, ActivityIndicator: host('ActivityIndicator'),
      KeyboardAvoidingView: host('KeyboardAvoidingView'), Modal: host('Modal'),
      Pressable: host('Pressable'), ScrollView, Share: { share: async () => {} },
      StyleSheet: { create: value => value, absoluteFill: {} }, Text: host('Text'),
      TextInput: host('TextInput'), View: host('View') },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/api/guest': { ensureGuestSession: async () => session },
    '@/src/storage/session': { readSession: async () => session, subscribeSession: () => () => {} },
    '@/src/hooks/useAppResume': { useAppResume() {} },
    '@/src/ratingPrompt': { maybeRequestPackOneRating: async () => {} },
    '@/src/api/draftRun': {
      recordDraftRunView: async () => ({ ok: true }),
      createDraftRunShare: async () => ({ id: 'a'.repeat(24) }),
      loadDailyPeerStats: async () => ({ available: false }),
      loadDailyStatus: async () => ({ day: today, daily_history: [], daily_streak: 1 }),
      DAILY_ENVIRONMENT_META: {
        mixed: { title: 'Draft Run', eyebrow: 'DAILY DRAFT RUN', description: '', resultTitle: 'Your Draft Run.' },
        'powered-cube': { title: 'Powered Cube', eyebrow: 'POWERED CUBE DAILY', description: '', resultTitle: 'Your Powered Cube.' },
        latest: { title: 'Latest Set', eyebrow: 'LATEST SET DAILY', description: '', resultTitle: 'Your Latest Set run.' },
      },
      isDailyEnvironment: id => ['mixed', 'powered-cube', 'latest'].includes(id),
      loadDraftRun: async () => run(true, true),
      startDailyDraftRun: async () => run(false),
      startPracticeDraftRun: async () => run(false),
      rerollDraftRun: async () => run(false),
      submitDraftRunPick: async () => run(true, true),
    },
    '@/src/dailyClock': { pacificDay: () => today, dailyResetCue: () => 'New Dailies tomorrow' },
    '@/src/storage/idempotency': {
      clearPracticeIdempotencyKey: async () => {}, practiceIdempotencyKey: async () => 'practice_' + 'k'.repeat(32) },
    '@/src/tcgplayer': { tcgplayerUrl: name => 'https://www.tcgplayer.com/search/magic/product?q=' + encodeURIComponent(name) },
    '@/src/theme': { colors: new Proxy({}, { get: () => '#000' }), spacing: new Proxy({}, { get: () => 8 }) },
  };
  const DraftRunScreen = compileModule('app/draft-run.tsx', mocks, { resolve: request => {
    if (request === '@/src/config') return { config: { screenshots: { fixtures: false } } };
  } }).default;
  let root;
  try {
    await act(async () => {
      root = TestRenderer.create(React.createElement(DraftRunScreen));
      await Promise.resolve();
      await Promise.resolve();
    });
    const pick = root.root.findAll(node => node.type === 'Pressable' &&
      node.props.accessibilityLabel === 'Pick Card A')[0];
    assert.ok(pick, 'the eighth card should be selectable');
    await act(async () => pick.props.onPress());
    const confirm = button(root, 'Confirm pick');
    assert.ok(confirm, 'eighth pick has a confirmation button');
    await act(async () => {
      confirm.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.ok(button(root, 'See result'), 'saved final answer should show the See result action');
    await act(async () => {
      button(root, 'See result').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.match(renderedText(root.toJSON()), /Your Draft Run/);
    assert.match(renderedText(root.toJSON()), /Your 8 picks/);
    const rows = root.root.findAll(node => node.type === 'Pressable' &&
      /^(Review|Saved) pick [1-8],/.test(node.props.accessibilityLabel || ''));
    assert.equal(rows.length, 8, 'all eight saved picks remain represented on the result');
    assert.equal(rows[2].props.disabled, true, 'a legacy answer with no pack cannot open a blank review');
    assert.match(renderedText(root.toJSON()), /Saved pick/);
  } finally {
    if (root) await act(async () => root.unmount());
  }
});