const fs = require('node:fs');
const path = require('node:path');
const { compileModule: compileNativeModule } = require('./support/compile-module.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');

const { act } = TestRenderer;

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

function compileModule(relativePath, mocks) {
  return compileNativeModule(relativePath, mocks, { resolve: (request) => {
    if (request === '@/src/storage/session') return { readSession: () => mocks['@/src/api/guest'].ensureGuestSession(), subscribeSession: () => () => {}, ...mocks[request] };
    if (request === '@/src/navigation/session' && !mocks[request]) return { useNavigationSession: () => ({ session: { accountToken: 'member' } }) };
  } });
}

function compileScreen(relativePath, mocks) {
  return compileModule(relativePath, mocks).default;
}

function renderedText(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(renderedText).join(' ');
  return renderedText(node.children || []);
}

function focusControl() {
  let callback = null;
  return {
    useFocusEffect(next) {
      callback = next;
      React.useEffect(() => next(), [next]);
    },
    trigger() {
      if (!callback) throw new Error('focus callback not mounted');
      return callback();
    },
  };
}

const theme = {
  colors: new Proxy({}, { get: () => '#000' }),
  spacing: new Proxy({}, { get: () => 8 }),
};

function dailyStatus(day, complete = false) {
  return {
    day,
    capabilities: [],
    player: { claimed: false },
    ranking_identity: { eligible: true },
    daily_streak: complete ? 2 : 0,
    daily_history: complete ? [{
      date: day,
      set_id: 'mixed',
      mode: 'draft_run',
      score: 87,
      rank: 1,
      total: 10,
    }] : [],
  };
}

test('Home refreshes loaded Daily state on focus and Pacific rollover without blanking it', async () => {
  const focus = focusControl();
  const guest = { playerToken: 'guest-token' };
  let calls = 0;
  let intervalCallback = null;
  const priorSetInterval = globalThis.setInterval;
  const priorClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (callback) => {
    intervalCallback = callback;
    return 1;
  };
  globalThis.clearInterval = () => {};

  const mocks = {
    'expo-image': { Image: host('Image') },
    'expo-router': {
      router: { push() {} },
      useFocusEffect: focus.useFocusEffect,
    },
    'react-native': { useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
      Pressable: host('Pressable'),
      ScrollView,
      StyleSheet: { create: (value) => value },
      Text: host('Text'),
      View: host('View'),
    },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/api/draftRun': {
      DAILY_ENVIRONMENT_META: {
        mixed: { title: 'Draft Run', eyebrow: 'DAILY DRAFT RUN', description: '' },
        'powered-cube': { title: 'Powered Cube', eyebrow: 'POWERED CUBE DAILY', description: '' },
        latest: { title: 'Latest Set', eyebrow: 'LATEST SET DAILY', description: '' },
      },
      loadDailyStatus: async () => {
        calls += 1;
        return calls === 1 ? dailyStatus('2000-01-01', false) : dailyStatus(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()), true);
      },
    },
    '@/src/api/guest': { ensureGuestSession: async () => guest },
    '@/src/api/patreon': { loadNativePatreonStatus: async () => ({ ads_allowed: false }) },
    '@/src/hooks/useAppResume': { useAppResume() {} },
    '@/src/tcgplayer': { tcgplayerMagicUrl: () => 'https://example.invalid/magic' },
    '@/src/theme': theme,
  };

  let root;
  try {
    const HomeScreen = compileScreen('src/screens/index.tsx', mocks);
    await act(async () => {
      root = TestRenderer.create(React.createElement(HomeScreen));
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.equal(calls, 1);
    assert.equal(root.root.findAll(
      (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Play Draft Run Daily',
    ).length, 1);

    await act(async () => {
      intervalCallback();
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.equal(calls, 2, 'Pacific day mismatch should refresh');
    assert.equal(root.root.findAll(
      (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'View result for Draft Run Daily',
    ).length, 1);

    await act(async () => {
      focus.trigger();
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(calls, 3, 'returning focus should revalidate Daily completion');

    await act(async () => root.unmount());
  } finally {
    globalThis.setInterval = priorSetInterval;
    globalThis.clearInterval = priorClearInterval;
  }
});

function profile(name) {
  return {
    player: { display_name: name, profile_public: false },
    summary: {
      games: 1,
      average_score: 80,
      best_score: 80,
      challenge_wins: 0,
      challenge_losses: 0,
      challenge_ties: 0,
      daily_games: 1,
      environments_played: 1,
      current_streak: 1,
      best_streak: 1,
    },
    environment_total: 1,
    by_set: [],
    by_mode: [],
    best_environments: [],
    current_season: null,
    daily_history: [],
    recent: [],
    trend: [],
    achievements: [],
  };
}

function historyRow(cursor, score) {
  return {
    cursor,
    played_at: '2026-09-26T12:00:00Z',
    set_id: 'mixed',
    mode: 'draft_run',
    score,
    is_daily: true,
  };
}

test('Career rejects a stale pagination page after account identity changes', async () => {
  const focus = focusControl();
  const pageA = deferred();
  const sessionA = { playerToken: 'player-a', accountToken: 'account-a' };
  const sessionB = { playerToken: 'player-b', accountToken: 'account-b' };
  let sessionCalls = 0;

  const mocks = {
    'expo-router': { router: { push() {} }, useFocusEffect: focus.useFocusEffect },
    'react-native': { useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
      ActivityIndicator: host('ActivityIndicator'),
      FlatList: host('FlatList'),
      Pressable: host('Pressable'),
      Share: { share: async () => {} },
      StyleSheet: { create: (value) => value },
      Text: host('Text'),
      View: host('View'),
    },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/api/career': {
      loadMobileCareer: async (session) => profile(session === sessionA ? 'Player A' : 'Player B'),
      loadMobileCareerHistory: async (session, cursor) => {
        if (session === sessionA && cursor === 'a-next') return pageA.promise;
        if (session === sessionA) return { rows: [historyRow('a-1', 70)], next_cursor: 'a-next' };
        return { rows: [historyRow('b-1', 91)], next_cursor: null };
      },
    },
    '@/src/api/client': {
      ApiError: class ApiError extends Error {
        constructor(message, status) {
          super(message);
          this.status = status;
        }
      },
    },
    '@/src/api/draftRun': {
      DAILY_ENVIRONMENT_META: { mixed: { title: 'Draft Run' } },
      isDailyEnvironment: (value) => value === 'mixed',
    },
    '@/src/api/guest': {
      ensureGuestSession: async () => {
        sessionCalls += 1;
        return sessionCalls === 1 ? sessionA : sessionB;
      },
    },
    '@/src/storage/session': {
      readSession: async () => sessionCalls <= 1 ? sessionA : sessionB,
      subscribeSession: () => () => {},
    },
    '@/src/components/ProfileOverview': { ProfileOverview: host('ProfileOverview') },
    '@/src/hooks/useAppResume': { useAppResume() {} },
    '@/src/theme': theme,
  };

  const CareerScreen = compileScreen('src/screens/career.tsx', mocks);
  let root;
  await act(async () => {
    root = TestRenderer.create(React.createElement(CareerScreen));
    await Promise.resolve();
    await Promise.resolve();
  });

  let list = root.root.findByType('FlatList');
  assert.deepEqual(list.props.data.map((row) => row.cursor), ['a-1']);

  await act(async () => {
    list.props.onEndReached();
    await Promise.resolve();
  });

  await act(async () => {
    focus.trigger();
    await Promise.resolve();
    await Promise.resolve();
  });

  list = root.root.findByType('FlatList');
  assert.deepEqual(list.props.data.map((row) => row.cursor), ['b-1']);

  await act(async () => {
    pageA.resolve({ rows: [historyRow('a-2', 72)], next_cursor: null });
    await pageA.promise;
    await Promise.resolve();
  });

  list = root.root.findByType('FlatList');
  assert.deepEqual(
    list.props.data.map((row) => row.cursor),
    ['b-1'],
    'old account pagination must not append into the new identity',
  );

  await act(async () => root.unmount());
});

test('successful authentication returns to Practice even when optional profile/catalog enrichment fails', async () => {
  const guest = { playerToken: 'guest-token' };
  const signed = {
    playerToken: 'linked-player',
    accountToken: 'account-token',
    accountUser: { id: 'user-1', email: 'player@example.com' },
  };
  const replaced = [];
  const result = {
    user: { id: 'user-1', email: 'player@example.com' },
    session: { token: 'account-token' },
    linked: {
      ok: true,
      merged: false,
      validatedDailyScore: false,
      playerId: 'player-1',
      token: 'linked-player',
      displayName: 'Player',
      rankingIdentity: { eligible: true },
    },
  };
  const accountState = {
    user: result.user,
    session: {},
    credentials: { password: true, google: false, apple: false },
    deletion: { enabled: true, available: true, googleOnly: false, method: 'password' },
  };

  const mocks = {
    'expo-apple-authentication': {
      isAvailableAsync: async () => true,
      signInAsync: async () => { throw new Error('not used'); },
      AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
      AppleAuthenticationButton: host('AppleAuthenticationButton'),
      AppleAuthenticationButtonType: { SIGN_IN: 0 },
      AppleAuthenticationButtonStyle: { BLACK: 0 },
    },
    'expo-router': {
      router: {
        dismissTo(value) { replaced.push(value); },
        push() {},
      },
      useLocalSearchParams: () => ({ returnTo: 'practice' }),
    },
    'expo-web-browser': {
      maybeCompleteAuthSession() {},
      openAuthSessionAsync: async () => ({ type: 'cancel' }),
    },
    'react-native': { useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
      ActivityIndicator: host('ActivityIndicator'),
      Alert: { alert() {} },
      Platform: { OS: 'ios' },
      Pressable: host('Pressable'),
      ScrollView,
      StyleSheet: { create: (value) => value },
      Text: host('Text'),
      TextInput: host('TextInput'),
      View: host('View'),
    },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/api/client': {
      ApiError: class ApiError extends Error {
        constructor(message, status) {
          super(message);
          this.status = status;
        }
      },
    },
    '@/src/api/account': {
      changeMobilePassword: async () => ({ ok: true }),
      deleteMobileAccount: async () => ({ ok: true }),
      finishAppleDeletion: async () => ({ ok: true }),
      finishAppleSignIn: async () => ({ result, session: signed }),
      finishGoogleSignIn: async () => ({ result, session: signed }),
      finishNativeAppleSignIn: async () => ({ result, session: signed }),
      forgetAccountLocally: async (session) => session,
      loadMobileAccount: async () => accountState,
      requestMobilePasswordReset: async () => ({ ok: true, message: 'sent' }),
      requestMobileVerificationEmail: async () => ({ ok: true, message: 'sent' }),
      signInWithEmail: async () => ({ result, session: signed }),
      signOutMobileAccount: async () => guest,
      signUpWithEmail: async () => ({ result, session: signed }),
      startAppleDeletionVerification: async () => ({ flowToken: 'x', url: 'https://example.invalid' }),
      startAppleSignIn: async () => ({ flowToken: 'x', url: 'https://example.invalid' }),
      startDeletionVerification: async () => ({ ok: true, verification: 'email', expiresInSeconds: 600 }),
      startGoogleSignIn: async () => ({ url: 'https://example.invalid' }),
    },
    '@/src/api/career': {
      loadMobileCareer: async () => { throw new Error('profile enrichment offline'); },
      updateMobileProfile: async () => profile('Player'),
    },
    '@/src/api/draftRun': {
      isDailyEnvironment: (value) => value === 'mixed',
      loadSetCatalog: async () => { throw new Error('catalog enrichment offline'); },
    },
    '@/src/api/guest': { ensureGuestSession: async () => guest },
    '@/src/hooks/useAccountState': {
      useAccountState: () => {
        const [current, setCurrent] = React.useState(guest);
        const [hookMessage, setHookMessage] = React.useState(null);
        return {
          session: current,
          account: null,
          busy: false,
          message: hookMessage,
          enrichmentWarning: 'Some profile details could not refresh. Try again.',
          setMessage: setHookMessage,
          adoptSession: async (next) => { setCurrent(next); return accountState; },
          clearAccount: (next) => setCurrent(next),
        };
      },
    },
    '@/src/theme': theme,
  };

  const AccountScreen = compileScreen('app/account.tsx', mocks);
  let root;
  await act(async () => {
    root = TestRenderer.create(React.createElement(AccountScreen));
    await Promise.resolve();
    await Promise.resolve();
  });

  const email = root.root.findAll(
    (node) => node.type === 'TextInput' && node.props.accessibilityLabel === 'Email',
  )[0];
  const password = root.root.findAll(
    (node) => node.type === 'TextInput' && node.props.accessibilityLabel === 'Password',
  )[0];

  await act(async () => {
    email.props.onChangeText('player@example.com');
    password.props.onChangeText('password123');
  });

  const signIn = root.root.findAll((node) => (
    node.type === 'Pressable'
    && Object.prototype.hasOwnProperty.call(node.props, 'disabled')
    && node.findAll((child) => child.type === 'Text' && child.props.children === 'Sign in').length > 0
  ))[0];
  assert.ok(signIn, 'sign-in submit button should be mounted');

  await act(async () => {
    signIn.props.onPress();
    await Promise.resolve();
    await Promise.resolve();
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });

  assert.ok(replaced.includes('/practice'), 'auth return must not wait for optional enrichment');
  assert.match(renderedText(root.toJSON()), /Signed in to your Pack One account/);
  assert.match(renderedText(root.toJSON()), /profile details could not refresh/i);

  await act(async () => root.unmount());
});


test('Profile visibility toggles an initially public profile off on the first tap', async () => {
  const currentProfile = {
    ...profile('Public Player'),
    player: {
      ...profile('Public Player').player,
      profile_public: true,
      favorite_set_id: null,
      showcase_achievement: null,
      public_identity_hidden: false,
      username_owned: true,
    },
  };
  const writes = [];
  const mocks = {
    'expo-router': { router: { push() {} } },
    'expo-web-browser': { openBrowserAsync: async () => ({ type: 'cancel' }) },
    'react-native': { useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
      ActivityIndicator: host('ActivityIndicator'),
      Pressable: host('Pressable'),
      ScrollView,
      StyleSheet: { create: (value) => value },
      Text: host('Text'),
      TextInput: host('TextInput'),
      View: host('View'),
    },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/api/client': { ApiError: class ApiError extends Error {} },
    '@/src/api/career': {
      updateMobileProfile: async (_session, body) => {
        writes.push(body);
        return {
          ...currentProfile,
          player: { ...currentProfile.player, profile_public: body.profilePublic },
        };
      },
    },
    '@/src/hooks/useAccountState': {
      useAccountState: () => ({
        session: { playerToken: 'player', accountToken: 'account', accountUser: { id: 'account-id' } },
        account: { user: { id: 'account-id' } },
        profile: currentProfile,
        catalogSets: [],
        busy: false,
        enrichmentBusy: false,
        enrichmentWarning: null,
        refresh: async () => null,
        adoptProfile: () => null,
      }),
    },
    '@/src/theme': theme,
  };

  const Screen = compileScreen('app/account-profile.tsx', mocks);
  let root;
  await act(async () => { root = TestRenderer.create(React.createElement(Screen)); });
  let toggle = root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityRole === 'switch')[0];
  assert.equal(toggle.props.accessibilityState.checked, true);
  await act(async () => { toggle.props.onPress(); });
  toggle = root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityRole === 'switch')[0];
  assert.equal(toggle.props.accessibilityState.checked, false);

  const save = root.root.findAll((node) => node.type === 'Pressable'
    && renderedText(node).includes('Save profile'))[0];
  await act(async () => { await save.props.onPress(); });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].profilePublic, false);
  assert.equal(writes[0].acceptPublicIdentityTerms, true);
  await act(async () => root.unmount());
});


test('shared account state hook stops loading and exposes account fetch failures', async () => {
  const focus = focusControl();
  const session = { playerToken: 'player', accountToken: 'account', accountUser: { id: 'account-id' } };
  const hook = compileModule('src/hooks/useAccountState.ts', {
    'expo-router': { router: { replace() {} }, useFocusEffect: focus.useFocusEffect },
    '@/src/api/client': { ApiError: class ApiError extends Error {} },
    '@/src/api/account': {
      forgetAccountLocally: async (value) => value,
      loadMobileAccount: async () => { throw new Error('account offline'); },
    },
    '@/src/api/career': { loadMobileCareer: async () => profile('Never loaded') },
    '@/src/api/draftRun': { loadSetCatalog: async () => ({ sets: [] }) },
    '@/src/api/guest': { ensureGuestSession: async () => session },
  }).useAccountState;

  function Harness() {
    const state = hook({ loadProfile: true, loadCatalog: true });
    return React.createElement('Text', null, `${state.busy}:${state.enrichmentBusy}:${state.message || 'none'}`);
  }

  let root;
  await act(async () => {
    root = TestRenderer.create(React.createElement(Harness));
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  assert.match(renderedText(root.toJSON()), /false:false:account offline/);
  await act(async () => root.unmount());
});


test('shared account state hook keeps focus refreshes ordered and rejects late enrichment', async () => {
  const focus = focusControl();
  const oldProfile = deferred();
  const sessionA = { playerToken: 'player-a', accountToken: 'account-a', accountUser: { id: 'a' } };
  const sessionB = { playerToken: 'player-b', accountToken: 'account-b', accountUser: { id: 'b' } };
  let sessionReads = 0;
  const hook = compileModule('src/hooks/useAccountState.ts', {
    'expo-router': { router: { replace() {} }, useFocusEffect: focus.useFocusEffect },
    '@/src/api/client': { ApiError: class ApiError extends Error {} },
    '@/src/api/account': {
      forgetAccountLocally: async (value) => value,
      loadMobileAccount: async (value) => ({
        user: value.accountUser,
        session: {},
        credentials: { password: true, google: false, apple: false },
        deletion: { enabled: true, available: true, googleOnly: false, method: 'password' },
      }),
    },
    '@/src/api/career': {
      loadMobileCareer: async (value) => value === sessionA ? oldProfile.promise : profile('Player B'),
    },
    '@/src/api/draftRun': {
      loadSetCatalog: async () => ({ sets: [] }),
    },
    '@/src/api/guest': {
      ensureGuestSession: async () => (++sessionReads === 1 ? sessionA : sessionB),
    },
  }).useAccountState;

  function Harness() {
    const state = hook({ loadProfile: true, loadCatalog: true });
    return React.createElement('Text', null, state.profile?.player.display_name || 'none');
  }

  let root;
  await act(async () => {
    root = TestRenderer.create(React.createElement(Harness));
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    await focus.trigger();
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.match(renderedText(root.toJSON()), /Player B/);
  await act(async () => {
    oldProfile.resolve(profile('Player A'));
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.match(renderedText(root.toJSON()), /Player B/);
  assert.doesNotMatch(renderedText(root.toJSON()), /Player A/);
  await act(async () => root.unmount());
});


test('Learn keeps core education native and opens each selected drafting guide directly', async () => {
  const pushed = [];
  const opened = [];
  const mocks = {
    'expo-router': { router: { push(value) { pushed.push(value); } } },
    'expo-web-browser': { openBrowserAsync: async (url) => { opened.push(url); } },
    'react-native': { useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
      Pressable: host('Pressable'), ScrollView, StyleSheet: { create: (value) => value },
      Text: host('Text'), View: host('View'),
    },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/contentLinks': {
      canonicalContentUrl: (key) => ({
        firstPick: 'https://packone.pro/learn/first-pick-discipline/', consensus: 'https://packone.pro/learn/reading-consensus/', stayingOpen: 'https://packone.pro/learn/staying-open/', deckFit: 'https://packone.pro/learn/card-strength-vs-fit/', learn: 'https://packone.pro/learn/', about: 'https://packone.pro/about/', contact: 'https://packone.pro/contact/',
        privacy: 'https://packone.pro/privacy/', terms: 'https://packone.pro/terms/',
      })[key],
    },
    '@/src/theme': theme,
  };
  const Screen = compileScreen('src/screens/learn.tsx', mocks);
  let root;
  await act(async () => { root = TestRenderer.create(React.createElement(Screen)); await Promise.resolve(); });
  const press = async (label) => {
    const node = root.root.findAll((item) => item.type === 'Pressable' && item.props.accessibilityLabel === label)[0];
    assert.ok(node, label); await act(async () => { node.props.onPress(); await Promise.resolve(); });
  };
  await press('Open How to Play');
  assert.deepEqual(pushed, ['/how-to']);
  await press('Open First-pick discipline: commit before the reveal on packone.pro');
  await press('Open How to read consensus without treating it as truth on packone.pro');
  await press('Open Staying open is not the same as avoiding commitment on packone.pro');
  await press('Open Card strength vs. deck fit: know what changed on packone.pro');
  assert.deepEqual(opened, [
    'https://packone.pro/learn/first-pick-discipline/', 'https://packone.pro/learn/reading-consensus/',
    'https://packone.pro/learn/staying-open/', 'https://packone.pro/learn/card-strength-vs-fit/',
  ]);
  assert.doesNotMatch(renderedText(root.toJSON()), /canonical|single-source|credential|native rules/);
  await act(async () => root.unmount());
});

test('Learn exposes a visible retry message when the canonical browser handoff fails', async () => {
  const mocks = {
    'expo-router': { router: { push() {} } },
    'expo-web-browser': { openBrowserAsync: async () => { throw new Error('browser unavailable'); } },
    'react-native': { useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
      Pressable: host('Pressable'), ScrollView, StyleSheet: { create: (value) => value },
      Text: host('Text'), View: host('View'),
    },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/contentLinks': { canonicalContentUrl: () => 'https://packone.pro/contact/' },
    '@/src/theme': theme,
  };
  const Screen = compileScreen('src/screens/learn.tsx', mocks);
  let root;
  await act(async () => { root = TestRenderer.create(React.createElement(Screen)); await Promise.resolve(); });
  const contact = root.root.findAll((item) => item.type === 'Pressable' && item.props.accessibilityLabel === 'Open First-pick discipline: commit before the reveal on packone.pro')[0];
  await act(async () => { contact.props.onPress(); await Promise.resolve(); await Promise.resolve(); });
  assert.match(renderedText(root.toJSON()), /Could not open First-pick discipline: commit before the reveal\. Try again when your browser is available\./);
  await act(async () => root.unmount());
});


test('published set archive renders current editorial evidence and exact disclosed TCGplayer links', async () => {
  const opened = [];
  const archive = {
    setId: 'msh', replaySeats: 300, trainingDrafts: 5000, trainingPicks: 209999,
    experiencedCohortDrafts: 40480, winRateCutoff: '60%', averageTopSupport: '48.8%',
    withinTenPoints: '24%', historicalTopMatch: '68%', averageGap: '27.9%', thirtyPointGap: '42%',
    topCards: [{ name: 'Cosmic Cube', imageUrl: 'https://cards.example/cube.jpg' }],
    closeDecisions: [{ first: 'Cosmic Cube', second: 'The Mighty Thor, Jane Foster', firstSupport: '37.7%', secondSupport: '37.6%', gap: '0.1%' }],
  };
  const mocks = {
    'expo-image': { Image: host('Image') },
    'expo-router': { router: { replace() {}, push() {} }, useLocalSearchParams: () => ({ setId: 'msh' }) },
    'react-native': { useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
      Linking: { openURL: async (url) => { opened.push(url); } },
      Pressable: host('Pressable'), ScrollView, StyleSheet: { create: (value) => value },
      Text: host('Text'), View: host('View'),
    },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/content/setArchives': { setArchive: () => archive },
    '@/src/tcgplayer': { tcgplayerUrl: (name) => `https://partner.example/?card=${encodeURIComponent(name)}` },
    '@/src/theme': theme,
  };
  const Screen = compileScreen('app/set-archive.tsx', mocks);
  let root;
  await act(async () => { root = TestRenderer.create(React.createElement(Screen)); await Promise.resolve(); });
  const text = renderedText(root.toJSON());
  assert.match(text, /300\s+historical replay seats/);
  assert.match(text, /209,999\s+picks/);
  assert.match(text, /48.8%/);
  assert.match(text, /Cosmic Cube/);
  assert.match(text, /37\.7%\s+support/);
  assert.match(text, /Affiliate disclosure/);
  const link = root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Find Cosmic Cube on TCGplayer, affiliate link')[0];
  assert.ok(link);
  await act(async () => { link.props.onPress(); await Promise.resolve(); });
  assert.deepEqual(opened, ['https://partner.example/?card=Cosmic%20Cube']);
  await act(async () => root.unmount());
});

test('published set archive keeps the analysis mounted when affiliate browser handoff fails', async () => {
  const archive = {
    setId: 'msh', replaySeats: 300, trainingDrafts: 5000, trainingPicks: 209999,
    experiencedCohortDrafts: 40480, winRateCutoff: '60%', averageTopSupport: '48.8%',
    withinTenPoints: '24%', historicalTopMatch: '68%', averageGap: '27.9%', thirtyPointGap: '42%',
    topCards: [{ name: 'Cosmic Cube', imageUrl: 'https://cards.example/cube.jpg' }], closeDecisions: [],
  };
  const mocks = {
    'expo-image': { Image: host('Image') },
    'expo-router': { router: { replace() {}, push() {} }, useLocalSearchParams: () => ({ setId: 'msh' }) },
    'react-native': { useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
      Linking: { openURL: async () => { throw new Error('no browser'); } },
      Pressable: host('Pressable'), ScrollView, StyleSheet: { create: (value) => value },
      Text: host('Text'), View: host('View'),
    },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/content/setArchives': { setArchive: () => archive },
    '@/src/tcgplayer': { tcgplayerUrl: () => 'https://partner.example/card' },
    '@/src/theme': theme,
  };
  const Screen = compileScreen('app/set-archive.tsx', mocks);
  let root;
  await act(async () => { root = TestRenderer.create(React.createElement(Screen)); await Promise.resolve(); });
  const link = root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityRole === 'link')[0];
  await act(async () => { link.props.onPress(); await Promise.resolve(); await Promise.resolve(); });
  assert.match(renderedText(root.toJSON()), /Could not open TCGplayer for Cosmic Cube\. Try the affiliate link again\./);
  assert.match(renderedText(root.toJSON()), /MSH\s+Pack One archive/);
  await act(async () => root.unmount());
});

test('published set web URLs rewrite only the four reviewed archives into native detail routes', () => {
  const compiled = { exports: compileNativeModule('src/linking.ts', {}) };
  for (const setId of ['msh', 'ecl', 'tmt', 'sos']) {
    assert.equal(compiled.exports.rewriteIncomingPath(`https://packone.pro/sets/${setId}/`), `/set-archive?setId=${setId}`);
  }
  assert.equal(compiled.exports.rewriteIncomingPath('https://packone.pro/sets/unknown/'), '/');
});


test('Daily home shows the disclosed TCGplayer fallback to guests without a membership lookup', async () => {
  const focus = focusControl();
  let membershipCalls = 0;
  const opened = [];
  const mocks = {
    'expo-image': { Image: host('Image') },
    'expo-router': { router: { push() {} }, useFocusEffect: focus.useFocusEffect },
    'react-native': { useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
      Linking: { openURL: async (url) => { opened.push(url); } },
      Pressable: host('Pressable'), ScrollView, StyleSheet: { create: (value) => value },
      Text: host('Text'), View: host('View'),
    },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/api/draftRun': {
      DAILY_ENVIRONMENT_META: {
        mixed: { title: 'Draft Run', eyebrow: 'DAILY DRAFT RUN', description: '' },
        'powered-cube': { title: 'Powered Cube', eyebrow: 'POWERED CUBE DAILY', description: '' },
        latest: { title: 'Latest Set', eyebrow: 'LATEST SET DAILY', description: '' },
      },
      loadDailyStatus: async () => dailyStatus('2026-09-26', false),
    },
    '@/src/api/guest': { ensureGuestSession: async () => ({ playerToken: 'guest-token' }) },
    '@/src/api/patreon': { loadNativePatreonStatus: async () => { membershipCalls += 1; return { ads_allowed: false }; } },
    '@/src/hooks/useAppResume': { useAppResume() {} },
    '@/src/tcgplayer': { tcgplayerMagicUrl: () => 'https://partner.example/magic' },
    '@/src/theme': theme,
  };
  const Screen = compileScreen('src/screens/index.tsx', mocks);
  let root;
  await act(async () => { root = TestRenderer.create(React.createElement(Screen)); await Promise.resolve(); await Promise.resolve(); });
  assert.equal(membershipCalls, 0);
  const promo = root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Shop Magic on TCGplayer, affiliate link')[0];
  assert.ok(promo);
  assert.match(renderedText(root.toJSON()), /Affiliate link\. Pack One may earn a commission/);
  await act(async () => { promo.props.onPress(); await Promise.resolve(); });
  assert.deepEqual(opened, ['https://partner.example/magic']);
  await act(async () => root.unmount());
});

test('Daily home hides promotion for signed-in ad-free, failed, or unverified membership status', async () => {
  for (const membership of [
    async () => ({ ads_allowed: false }),
    async () => { throw new Error('offline'); },
    async () => ({ ads_allowed: null }),
  ]) {
    const focus = focusControl();
    const mocks = {
      'expo-image': { Image: host('Image') },
      'expo-router': { router: { push() {} }, useFocusEffect: focus.useFocusEffect },
      'react-native': { useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
        Linking: { openURL: async () => {} }, Pressable: host('Pressable'), ScrollView,
        StyleSheet: { create: (value) => value }, Text: host('Text'), View: host('View'),
      },
      'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
      '@/src/api/draftRun': {
        DAILY_ENVIRONMENT_META: {
          mixed: { title: 'Draft Run', eyebrow: 'DAILY DRAFT RUN', description: '' },
          'powered-cube': { title: 'Powered Cube', eyebrow: 'POWERED CUBE DAILY', description: '' },
          latest: { title: 'Latest Set', eyebrow: 'LATEST SET DAILY', description: '' },
        },
        loadDailyStatus: async () => dailyStatus('2026-09-26', false),
      },
      '@/src/api/guest': { ensureGuestSession: async () => ({ playerToken: 'player', accountToken: 'account' }) },
      '@/src/api/patreon': { loadNativePatreonStatus: membership },
      '@/src/hooks/useAppResume': { useAppResume() {} },
      '@/src/tcgplayer': { tcgplayerMagicUrl: () => 'https://partner.example/magic' },
      '@/src/theme': theme,
    };
    const Screen = compileScreen('src/screens/index.tsx', mocks);
    let root;
    await act(async () => { root = TestRenderer.create(React.createElement(Screen)); await Promise.resolve(); await Promise.resolve(); });
    assert.equal(root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Shop Magic on TCGplayer, affiliate link').length, 0);
    await act(async () => root.unmount());
  }
});

test('Daily home rejects late promotion eligibility from a previous signed-in account', async () => {
  const focus = focusControl();
  const firstMembership = deferred();
  let sessions = 0;
  const accountA = { playerToken: 'player-a', accountToken: 'account-a' };
  const accountB = { playerToken: 'player-b', accountToken: 'account-b' };
  const mocks = {
    'expo-image': { Image: host('Image') },
    'expo-router': { router: { push() {} }, useFocusEffect: focus.useFocusEffect },
    'react-native': { useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
      Linking: { openURL: async () => {} }, Pressable: host('Pressable'), ScrollView,
      StyleSheet: { create: (value) => value }, Text: host('Text'), View: host('View'),
    },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/api/draftRun': {
      DAILY_ENVIRONMENT_META: {
        mixed: { title: 'Draft Run', eyebrow: 'DAILY DRAFT RUN', description: '' },
        'powered-cube': { title: 'Powered Cube', eyebrow: 'POWERED CUBE DAILY', description: '' },
        latest: { title: 'Latest Set', eyebrow: 'LATEST SET DAILY', description: '' },
      },
      loadDailyStatus: async () => dailyStatus('2026-09-26', false),
    },
    '@/src/api/guest': { ensureGuestSession: async () => (++sessions === 1 ? accountA : accountB) },
    '@/src/api/patreon': {
      loadNativePatreonStatus: async (session) => session === accountA ? firstMembership.promise : { ads_allowed: false },
    },
    '@/src/hooks/useAppResume': { useAppResume() {} },
    '@/src/tcgplayer': { tcgplayerMagicUrl: () => 'https://partner.example/magic' },
    '@/src/theme': theme,
  };
  const Screen = compileScreen('src/screens/index.tsx', mocks);
  let root;
  await act(async () => { root = TestRenderer.create(React.createElement(Screen)); await Promise.resolve(); });
  await act(async () => { focus.trigger(); await Promise.resolve(); await Promise.resolve(); });
  assert.equal(root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Shop Magic on TCGplayer, affiliate link').length, 0);
  await act(async () => { firstMembership.resolve({ ads_allowed: true }); await firstMembership.promise; await Promise.resolve(); });
  assert.equal(root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Shop Magic on TCGplayer, affiliate link').length, 0);
  await act(async () => root.unmount());
});

test('Daily home keeps the promo mounted and reports a retryable error when TCGplayer handoff fails', async () => {
  const focus = focusControl();
  const mocks = {
    'expo-image': { Image: host('Image') },
    'expo-router': { router: { push() {} }, useFocusEffect: focus.useFocusEffect },
    'react-native': { useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
      Linking: { openURL: async () => { throw new Error('no browser'); } }, Pressable: host('Pressable'), ScrollView,
      StyleSheet: { create: (value) => value }, Text: host('Text'), View: host('View'),
    },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/api/draftRun': {
      DAILY_ENVIRONMENT_META: {
        mixed: { title: 'Draft Run', eyebrow: 'DAILY DRAFT RUN', description: '' },
        'powered-cube': { title: 'Powered Cube', eyebrow: 'POWERED CUBE DAILY', description: '' },
        latest: { title: 'Latest Set', eyebrow: 'LATEST SET DAILY', description: '' },
      },
      loadDailyStatus: async () => dailyStatus('2026-09-26', false),
    },
    '@/src/api/guest': { ensureGuestSession: async () => ({ playerToken: 'guest-token' }) },
    '@/src/api/patreon': { loadNativePatreonStatus: async () => ({ ads_allowed: false }) },
    '@/src/hooks/useAppResume': { useAppResume() {} },
    '@/src/tcgplayer': { tcgplayerMagicUrl: () => 'https://partner.example/magic' },
    '@/src/theme': theme,
  };
  const Screen = compileScreen('src/screens/index.tsx', mocks);
  let root;
  await act(async () => { root = TestRenderer.create(React.createElement(Screen)); await Promise.resolve(); await Promise.resolve(); });
  const promo = root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Shop Magic on TCGplayer, affiliate link')[0];
  await act(async () => { promo.props.onPress(); await Promise.resolve(); await Promise.resolve(); });
  assert.match(renderedText(root.toJSON()), /Could not open TCGplayer\. Try the affiliate link again\./);
  assert.equal(root.root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Shop Magic on TCGplayer, affiliate link').length, 1);
  await act(async () => root.unmount());
});


test('first-class tablet content stays bounded on Practice, Draft Run/results, and article screens', () => {
  const article = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'ArticleScreen.tsx'), 'utf8');
  const practice = fs.readFileSync(path.join(process.cwd(), 'src', 'screens', 'practice.tsx'), 'utf8');
  const draft = fs.readFileSync(path.join(process.cwd(), 'app', 'draft-run.tsx'), 'utf8');
  assert.match(article, /maxWidth: 840/);
  assert.match(article, /alignSelf: 'center'/);
  assert.match(practice, /maxWidth: 860/);
  assert.match(practice, /alignSelf: 'center'/);
  assert.ok((draft.match(/maxWidth: 980/g) || []).length >= 2, 'Draft Run play and result surfaces should both be bounded');
  assert.ok((draft.match(/alignSelf: 'center'/g) || []).length >= 2, 'Draft Run play and result surfaces should both be centered');
});
