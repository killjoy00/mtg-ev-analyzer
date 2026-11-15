const { compileModule } = require('./support/compile-module.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');

const { act } = TestRenderer;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mounts the production Draft Run screen through a completed Daily and checks
// the web-parity result screen: dated share text and short links, the
// three-Daily share, the next unfinished Daily and the guest handoff.

const host = (name) => function Host(props) { return React.createElement(name, props, props.children); };
const ScrollView = React.forwardRef(function ScrollViewHost(props, ref) {
  React.useImperativeHandle(ref, () => ({ scrollTo() {} }), []);
  return React.createElement('ScrollView', props, props.children);
});
const rendered = (node) => node == null ? '' : typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(rendered).join(' ') : rendered(node.children || []);
async function flush() { for (let index = 0; index < 20; index += 1) await Promise.resolve(); }

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const IDS = { mixed: '11111111-1111-4111-8111-111111111111', 'powered-cube': '22222222-2222-4222-8222-222222222222', latest: '33333333-3333-4333-8333-333333333333' };

function puzzle(index) {
  return { puzzle_id: `p-${index}`, set_id: 'msh', pack_number: 1, pick_number: index + 1, prior_picks: [],
    candidates: [{ id: 'a', name: 'Card A' }, { id: 'b', name: 'Card B' }] };
}
const answer = (index, match, score) => ({ score, selectedId: 'a', selectedName: 'Card A', historicalId: match ? 'a' : 'b',
  historicalName: match ? 'Card A' : 'Card B', historicalMatch: match, puzzle: puzzle(index) });
function run(environment, { complete = false, day = TODAY } = {}) {
  const answers = complete ? Array.from({ length: 8 }, (_, i) => answer(i, i < 2, i < 2 ? 100 : 60)) : Array.from({ length: 7 }, (_, i) => answer(i, i < 2, i < 2 ? 100 : 60));
  return { id: IDS[environment], environment, run_length: 8, set_reroll_allowed: false, custom_set_ids: [], rerolls: { set: 0, pack: 0 },
    day, revision: answers.length, round: answers.length, complete, score: complete ? 70 : null, leaderboard_eligible: !complete,
    answers, current: complete ? null : puzzle(7) };
}
const status = (environments) => ({ day: TODAY, capabilities: [], player: { claimed: false }, daily_streak: 3,
  daily_history: environments.map((environment) => ({ date: TODAY, set_id: environment, mode: 'draft_run', score: 70, run_id: IDS[environment] })) });

async function fixture({ environment = 'mixed', guest = false, dailyStatus = status(['mixed']), day = TODAY } = {}) {
  const calls = { share: [], replace: [], push: [], runs: [] };
  const session = { playerToken: `p1_${IDS.mixed}.${'A'.repeat(43)}`, ...(guest ? {} : { accountToken: 'B'.repeat(43) }) };
  const Image = host('Image');
  Image.prefetch = async () => {};
  const mocks = {
    '@/src/hooks/useCardCommerce': { useCardCommerce: () => true },
    'expo-web-browser': { openBrowserAsync: async () => ({ type: 'dismiss' }) },
    'expo-haptics': { selectionAsync: async () => {}, notificationAsync: async () => {}, NotificationFeedbackType: { Success: 'success' } },
    'expo-image': { Image },
    'expo-router': { router: { push: (value) => calls.push.push(value), replace: (value) => calls.replace.push(value), dismissTo() {} }, useLocalSearchParams: () => ({ environment }) },
    'react-native': { useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }), AccessibilityInfo: { announceForAccessibility() {} },
      ActivityIndicator: host('ActivityIndicator'), KeyboardAvoidingView: host('KeyboardAvoidingView'), Modal: host('Modal'), Platform: { OS: 'android' },
      Pressable: host('Pressable'), ScrollView, Share: { share: async (value) => { calls.share.push(value.message); } }, Linking: { openURL: async () => {} },
      StyleSheet: { create: (value) => value, absoluteFill: {} }, Text: host('Text'), TextInput: host('TextInput'), View: host('View') },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/api/guest': { ensureGuestSession: async () => session },
    '@/src/storage/session': { readSession: async () => session, subscribeSession: () => () => {} },
    '@/src/api/draftRun': {
      createDraftRunShare: async () => ({ id: 'a'.repeat(24) }),
      loadDailyPeerStats: async () => ({ available: false }),
      DAILY_ENVIRONMENT_META: { mixed: { eyebrow: 'DAILY DRAFT RUN', resultTitle: 'Your Draft Run.' },
        latest: { eyebrow: 'LATEST SET DAILY', resultTitle: 'Your Latest Set Run.' }, 'powered-cube': { eyebrow: 'POWERED CUBE DAILY', resultTitle: 'Your Cube Run.' } },
      isDailyEnvironment: (value) => Object.hasOwn(IDS, value),
      startDailyDraftRun: async (_session, env) => run(env, { day }),
      startPracticeDraftRun: async () => { throw new Error('not used'); },
      loadDraftRun: async (id) => { calls.runs.push(id); return run(Object.keys(IDS).find((key) => IDS[key] === id), { complete: true }); },
      submitDraftRunPick: async () => run(environment, { complete: true, day }),
      submitDraftRunDecisionReport: async () => ({ ok: true }),
      rerollDraftRun: async () => { throw new Error('not used'); },
      loadDailyStatus: async () => dailyStatus,
      loadTrophyDeck: async () => { throw new Error('not used'); },
    },
    '@/src/hooks/useAppResume': { useAppResume() {} },
    '@/src/storage/idempotency': { clearPracticeIdempotencyKey: async () => {}, practiceIdempotencyKey: async () => 'k' },
    '@/src/tcgplayer': { tcgplayerUrl: (name) => `https://example.test/${encodeURIComponent(name)}` },
    '@/src/theme': { colors: new Proxy({}, { get: () => '#000' }), spacing: new Proxy({}, { get: () => 8 }) },
  };
  const Screen = compileModule('app/draft-run.tsx', mocks, { resolve: (request) => {
    if (request === '@/src/config') return { config: { screenshots: { fixtures: false } } };
  } }).default;
  let root;
  await act(async () => { root = TestRenderer.create(React.createElement(Screen)); await flush(); });
  const find = (label) => root.root.findAll((node) => node.type === 'Pressable'
    && (node.props.accessibilityLabel === label || rendered(node).includes(label)))[0];
  const press = async (label) => { const node = find(label); assert.ok(node, `missing ${label}`); await act(async () => { node.props.onPress(); await flush(); }); };
  // Finish the eighth pick and open the result.
  await press('Pick Card A');
  await press('Confirm pick');
  await press('See result');
  return { root, calls, press, find, text: () => rendered(root.toJSON()), close: () => act(async () => root.unmount()) };
}

test('a Daily result shares a dated message and the short Daily link, never a "beat it" challenge', async () => {
  const screen = await fixture();
  try {
    assert.match(screen.text(), /Share your result/);
    await screen.press('Share Pack One result');
    const [message] = screen.calls.share;
    assert.match(message, /^I scored 70\/100 on the Pack One Draft Run Daily \([A-Z][a-z]{2} \d{1,2}\)\.\n🟩🟩🟨🟨🟨🟨🟨🟨\n2\/8 trophy picks matched\.\nTry Pack One's Daily\. No account needed:\n/);
    assert.ok(message.endsWith(`\nhttps://packone.pro/d/?d=${TODAY}`));
    assert.doesNotMatch(message, /beat it|share\/daily/);
    assert.match(screen.text(), /New Dailies in .* · 3-day streak/);
    assert.match(screen.text(), /Your final score is the average of your\s+8\s+picks/);
  } finally { await screen.close(); }
});

test('the recap shows the trophy pick beside each missed pick', async () => {
  const screen = await fixture();
  try {
    assert.match(screen.text(), /Card A\s+· Trophy match/);
    assert.match(screen.text(), /Card A\s+· Trophy pick: Card B/);
    const thumbs = screen.root.root.findAll((node) => node.type === 'View' && node.props.importantForAccessibility === 'no-hide-descendants');
    assert.equal(thumbs.length, 8, 'thumbnails are hidden from screen readers; the row text names both cards');
  } finally { await screen.close(); }
});

test('after the third Daily the share covers all three, and can switch back to just this one', async () => {
  const screen = await fixture({ environment: 'latest', dailyStatus: status(['mixed', 'powered-cube', 'latest']) });
  try {
    assert.deepEqual(screen.calls.runs.sort(), [IDS.mixed, IDS['powered-cube']].sort());
    assert.match(screen.text(), /Share today’s Dailies/);
    await screen.press('Share Pack One result');
    const lines = screen.calls.share[0].split('\n');
    assert.match(lines[0], /^Pack One · [A-Z][a-z]{2} \d{1,2}$/);
    assert.deepEqual(lines.slice(1, 4).map((line) => line.split(' ').slice(0, -1).join(' ')), ['Draft Run 70', 'Powered Cube 70', 'Latest Set 70']);
    assert.equal(lines[4], `https://packone.pro/d/?d=${TODAY}`, 'the day shares the regular Daily link');
    await screen.press('Share just this Daily');
    assert.match(screen.text(), /Share your result/);
    await screen.press('Share Pack One result');
    assert.ok(screen.calls.share[1].endsWith(`https://packone.pro/d/l/?d=${TODAY}`));
    assert.match(screen.calls.share[1], /Pack One Latest Set Daily/);
  } finally { await screen.close(); }
});

test('the primary action offers the next unfinished Daily only from today’s authoritative status', async () => {
  const screen = await fixture({ dailyStatus: status(['mixed']) });
  try {
    await screen.press('Play Daily Powered Cube');
    assert.deepEqual(screen.calls.replace, [{ pathname: '/draft-run', params: { environment: 'powered-cube' } }]);
    assert.ok(screen.find('All Dailies'));
  } finally { await screen.close(); }
  const stale = await fixture({ day: '2000-01-01', dailyStatus: status(['mixed']) });
  try {
    assert.ok(stale.find('Back to Dailies'), 'a previous day keeps the safe fallback');
    assert.equal(stale.find('Play Daily Powered Cube'), undefined);
  } finally { await stale.close(); }
});

test('a guest sees the sign-in handoff only once all three Dailies are complete', async () => {
  const partial = await fixture({ guest: true, dailyStatus: status(['mixed', 'latest']) });
  try {
    assert.doesNotMatch(partial.text(), /Finished today's Dailies/);
  } finally { await partial.close(); }
  const done = await fixture({ guest: true, dailyStatus: status(['mixed', 'powered-cube', 'latest']) });
  try {
    assert.match(done.text(), /FINISHED ALL 3 FREE DAILIES/);
    await done.press('Sign in for unlimited runs');
    assert.deepEqual(done.calls.push.at(-1), { pathname: '/account', params: { validateDailyRunId: IDS.mixed, environment: 'mixed' } });
  } finally { await done.close(); }
  const member = await fixture({ dailyStatus: status(['mixed', 'powered-cube', 'latest']) });
  try {
    assert.doesNotMatch(member.text(), /FINISHED ALL 3 FREE DAILIES/, 'signed-in players never see the guest handoff');
  } finally { await member.close(); }
});
