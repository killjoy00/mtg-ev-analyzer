const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
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

function compileScreen(relativePath, mocks) {
  const filename = path.join(process.cwd(), relativePath);
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
    'expo-router': {
      router: { push() {} },
      useFocusEffect: focus.useFocusEffect,
    },
    'react-native': {
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
        return calls === 1 ? dailyStatus('2000-01-01', false) : dailyStatus('2026-09-26', true);
      },
    },
    '@/src/api/guest': { ensureGuestSession: async () => guest },
    '@/src/hooks/useAppResume': { useAppResume() {} },
    '@/src/theme': theme,
  };

  let root;
  try {
    const HomeScreen = compileScreen('app/index.tsx', mocks);
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
      (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'View Draft Run Daily',
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
    'react-native': {
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
    '@/src/components/ProfileOverview': { ProfileOverview: host('ProfileOverview') },
    '@/src/hooks/useAppResume': { useAppResume() {} },
    '@/src/theme': theme,
  };

  const CareerScreen = compileScreen('app/career.tsx', mocks);
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
        replace(value) { replaced.push(value); },
        push() {},
      },
      useLocalSearchParams: () => ({ returnTo: 'practice' }),
    },
    'expo-web-browser': {
      maybeCompleteAuthSession() {},
      openAuthSessionAsync: async () => ({ type: 'cancel' }),
    },
    'react-native': {
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
