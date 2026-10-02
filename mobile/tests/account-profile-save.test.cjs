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

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

const session = {
  playerToken: 'p1_fixture',
  accountToken: 'A'.repeat(43),
  accountUser: { id: '11111111-1111-4111-8111-111111111111' },
};
const account = { user: { email: 'profile@example.invalid', name: 'Profile Player' } };

function makeProfile(overrides = {}) {
  const player = {
    display_name: 'Profile Player',
    profile_public: false,
    favorite_set_id: null,
    showcase_achievement: null,
    claimed: true,
    username_owned: true,
    display_name_reason: null,
    ...overrides.player,
  };
  return {
    player,
    ranking_identity: overrides.ranking_identity ?? { eligible: player.username_owned === true, reason: player.display_name_reason ?? null },
    summary: { games: 1, average_score: 80, best_score: 90 },
    achievements: [{ id: 'first_run', label: 'First Run', unlocked: true }],
    by_set: [],
    best_environments: [],
    daily_history: [],
    recent: [],
    trend: [],
    ...overrides,
    player,
  };
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const drain = () => new Promise((resolve) => setImmediate(resolve));
function text(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  return text(node.children || []);
}
const host = (name) => function Host(props) { return React.createElement(name, props, props.children); };

async function fixture(t, options = {}) {
  const mobile = path.resolve(__dirname, '..');
  const cache = new Map();
  const adopted = [];
  const calls = [];
  const pushes = [];
  const initialProfile = options.profile ?? makeProfile();

  const mocks = {
    'expo-router': { router: { push(value) { pushes.push(value); } } },
    'expo-web-browser': { openBrowserAsync: async () => ({ type: 'opened' }) },
    'react-native': {
      ActivityIndicator: host('ActivityIndicator'),
      Pressable: host('Pressable'),
      ScrollView: host('ScrollView'),
      StyleSheet: { create: (value) => value },
      Text: host('Text'),
      TextInput: host('TextInput'),
      View: host('View'),
    },
    'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
    '@/src/api/client': { ApiError },
    '@/src/api/career': {
      async updateMobileProfile(_session, payload) {
        calls.push(payload);
        if (options.update) return options.update(payload);
        return makeProfile();
      },
    },
    '@/src/hooks/useAccountState': {
      useAccountState() {
        const [profile, setProfile] = React.useState(initialProfile);
        return {
          session,
          account,
          profile,
          catalogSets: [{ set_id: 'msh', set_name: 'Modern Horizons', release_date: '2026-01-01' }],
          busy: false,
          enrichmentBusy: false,
          message: null,
          enrichmentWarning: null,
          refresh: async () => null,
          adoptProfile(next) {
            adopted.push(next);
            setProfile(next);
          },
        };
      },
    },
    '@/src/theme': {
      colors: new Proxy({}, { get: () => '#000' }),
      spacing: new Proxy({}, { get: () => 8 }),
    },
  };

  function compile(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = new Module(filename, module);
    mod.filename = filename;
    mod.paths = Module._nodeModulePaths(path.dirname(filename));
    cache.set(filename, mod);
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    const prior = Module._load;
    Module._load = function load(request, parent, main) {
      if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
      return prior.call(this, request, parent, main);
    };
    try { mod._compile(output, filename); } finally { Module._load = prior; }
    return mod.exports;
  }

  const Screen = compile(path.join(mobile, 'app', 'account-profile.tsx')).default;
  let root;
  await act(async () => { root = Renderer.create(React.createElement(Screen)); await drain(); });
  t.after(async () => { await act(async () => root.unmount()); });

  const displayNameInput = () => root.root.findByProps({ accessibilityLabel: 'Display name' });
  const saveButton = () => root.root.findAll((node) => node.type === 'Pressable' && text(node).includes('Save profile'))[0];

  return {
    root,
    calls,
    adopted,
    text: () => text(root.toJSON()),
    inputValue: () => displayNameInput().props.value,
    async changeName(value) {
      await act(async () => { displayNameInput().props.onChangeText(value); await drain(); });
    },
    async save() {
      const button = saveButton();
      assert.ok(button, 'Save profile button should exist');
      assert.notEqual(button.props.disabled, true, 'Save profile should be enabled');
      await act(async () => { button.props.onPress(); await drain(); });
    },
    async startSave() {
      const button = saveButton();
      assert.ok(button, 'Save profile button should exist');
      await act(async () => { button.props.onPress(); await Promise.resolve(); });
    },
  };
}

test('a successful placeholder-name profile PATCH is reported as saved', async (t) => {
  const placeholder = makeProfile({
    player: {
      display_name: 'Pack Player',
      username_owned: false,
      display_name_reason: 'username_required',
      profile_public: false,
    },
    ranking_identity: { eligible: false, reason: 'username_required' },
  });
  const f = await fixture(t, { profile: placeholder, update: async () => placeholder });
  await f.save();
  assert.match(f.text(), /Profile saved\./);
  assert.doesNotMatch(f.text(), /Profile not saved/);
  assert.equal(f.adopted.length, 1);
});

for (const [code, status, message] of [
  ['USERNAME_TAKEN', 409, 'That display name is already taken.'],
  ['USERNAME_NOT_ALLOWED', 400, 'That display name is not allowed.'],
]) {
  test(`real ${status} ${code} profile errors attach to the display-name field and preserve edits`, async (t) => {
    const f = await fixture(t, {
      update: async () => { throw new ApiError(message, status, { error: message, code }); },
    });
    const edit = code === 'USERNAME_TAKEN' ? 'Taken Name' : 'Pack One Support';
    await f.changeName(edit);
    await f.save();
    assert.equal(f.inputValue(), edit);
    assert.match(f.text(), new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(f.text(), /Profile not saved\. Fix the display name and try again\./);
    assert.equal(f.adopted.length, 0);
  });
}

test('a successful correction adopts the returned profile without overwriting a newer in-flight edit', async (t) => {
  const pending = deferred();
  const invalid = makeProfile({
    player: {
      display_name: 'Taken Name',
      username_owned: false,
      display_name_reason: 'username_taken',
      profile_public: false,
    },
    ranking_identity: { eligible: false, reason: 'username_taken' },
  });
  const saved = makeProfile({
    player: {
      display_name: 'Available Name',
      username_owned: true,
      display_name_reason: null,
      profile_public: false,
    },
    ranking_identity: { eligible: true, reason: null },
  });
  const f = await fixture(t, { profile: invalid, update: () => pending.promise });
  assert.match(f.text(), /Display name needs attention/);
  await f.changeName('Available Name');
  await f.startSave();
  await f.changeName('Newer Edit');
  await act(async () => { pending.resolve(saved); await drain(); });
  assert.equal(f.inputValue(), 'Newer Edit', 'a newer local edit must survive adoption of the saved response');
  assert.doesNotMatch(f.text(), /Display name needs attention/);
  assert.match(f.text(), /Profile saved\./);
  assert.equal(f.adopted.length, 1);
});
