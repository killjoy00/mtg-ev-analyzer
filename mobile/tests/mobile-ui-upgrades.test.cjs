'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const React = require('react');
const Renderer = require('react-test-renderer');
const { compileModule } = require('./support/compile-module.cjs');
const { act } = Renderer;

const read = path => fs.readFileSync(path, 'utf8');
const fixture = () => {
  let mode = 'light';
  const observers = new Set();
  const appearance = {
    getColorScheme: () => mode,
    addChangeListener: callback => {
      observers.add(callback);
      return { remove: () => observers.delete(callback) };
    },
  };
  const theme = compileModule('src/appearance.ts', { 'react-native': { Appearance: appearance } });
  return { theme, change: value => { mode = value; observers.forEach(notify => notify()); } };
};

test('system appearance recolors native panels without losing a mounted screen', async () => {
  const { theme, change } = fixture();
  const styles = theme.themedStyles({
    panel: { backgroundColor: '#ffffff', borderColor: '#d5dbe1', color: '#101820' },
    action: { backgroundColor: '#1e4d7a', color: '#ffffff' },
  });
  let mounts = 0;
  function Example() {
    const [mounted] = React.useState(() => ++mounts);
    return React.createElement('View', { mounted, style: styles.panel });
  }
  const Screen = theme.withAppTheme(Example);
  let root;
  try {
    await act(async () => { root = Renderer.create(React.createElement(Screen)); });
    assert.equal(root.root.findByType('View').props.style.backgroundColor, '#ffffff');
    await act(async () => change('dark'));
    assert.equal(root.root.findByType('View').props.style.backgroundColor, theme.darkColors.surface);
    assert.equal(root.root.findByType('View').props.style.borderColor, theme.darkColors.line);
    assert.equal(root.root.findByType('View').props.style.color, theme.darkColors.ink);
    assert.equal(styles.action.color, '#ffffff', 'filled controls retain readable white text');
    assert.equal(mounts, 1, 'theme changes must not restart a draft run');
    await act(async () => change('light'));
    assert.equal(root.root.findByType('View').props.style.backgroundColor, '#ffffff');
  } finally { if (root) await act(async () => root.unmount()); }
});

test('both native builds follow system theme, including status bar and tab shell', () => {
  const app = JSON.parse(read('app.json'));
  assert.equal(app.expo.userInterfaceStyle, 'automatic');
  const root = read('app/_layout.tsx');
  assert.match(root, /appearance === 'dark' \? 'light' : 'dark'/);
  assert.match(root, /themeColor\('surface'\)/);
  const tabs = read('app/(tabs)/_layout.tsx');
  assert.match(tabs, /themeColor\('accentDark'\)/);
  const viewer = read('src/components/CardFaceViewer.tsx');
  assert.match(viewer, /testID="card-viewer-header"/);
  assert.match(viewer, /hitSlop=\{12\}/);
  assert.match(viewer, /styles\.dismissArea/);
});

test('compact, standard, and large cards respect platform width and larger fonts', async () => {
  const values = new Map();
  const storage = {
    getItemAsync: async key => values.get(key) || null,
    setItemAsync: async (key, value) => { values.set(key, value); },
  };
  const size = compileModule('src/cardSize.ts', {
    '@/src/config': { config: { screenshots: { fixtures: true } } },
    '@/src/screenshots/storage': storage,
  });
  assert.equal(await size.readCardSize(), 'standard');
  for (const option of size.CARD_SIZES) {
    await size.writeCardSize(option);
    assert.equal(await size.readCardSize(), option);
  }
  assert.equal(size.normalizeCardSize('enormous'), 'standard');
  assert.deepEqual(size.CARD_SIZES, ['compact', 'standard', 'large']);
  assert.deepEqual([size.cardColumnCount('compact', false, false), size.cardColumnCount('standard', false, false), size.cardColumnCount('large', false, false)], [3, 2, 1]);
  assert.deepEqual([size.cardColumnCount('compact', true, false), size.cardColumnCount('standard', true, false), size.cardColumnCount('large', true, false)], [4, 3, 2]);
  assert.equal(size.cardColumnCount('compact', false, true), 2, 'large font readers need wider labels');
});

test('saved card size is shared across screens without a default-size flash', async () => {
  const values = new Map([['packone.mobile.card-size.v1', 'large']]);
  let diskReads = 0;
  const storage = {
    async getItemAsync(key) { diskReads++; return values.get(key) ?? null; },
    async setItemAsync(key, value) { values.set(key, value); },
  };
  const preference = compileModule('src/cardSize.ts', {
    '@/src/config': { config: { screenshots: { fixtures: true } } },
    '@/src/screenshots/storage': storage,
  });
  const observed = [];
  function Reader({ label }) {
    const value = preference.useCardSizePreference();
    observed.push({ label, ...value });
    return React.createElement('View', { label, ready: value.ready, size: value.size });
  }
  let root;
  try {
    await act(async () => {
      root = Renderer.create(React.createElement(React.Fragment, null,
        React.createElement(Reader, { label: 'game' }),
        React.createElement(Reader, { label: 'account' }),
      ));
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    assert.equal(observed[0].ready, false, 'first cold-start render is not mistaken for a loaded preference');
    assert.ok(observed.some(value => value.ready && value.size === 'large'));
    assert.ok(!observed.some(value => value.ready && value.size === 'standard'),
      'a saved Large preference never visibly renders a ready Standard grid');
    assert.equal(diskReads, 1, 'account and game share the same storage read');
    await act(async () => { await preference.writeCardSize('compact'); });
    const readers = root.root.findAllByType('View');
    assert.deepEqual(readers.map(node => [node.props.label, node.props.size]), [
      ['game', 'compact'], ['account', 'compact'],
    ]);
    assert.equal(values.get('packone.mobile.card-size.v1'), 'compact');
    await act(async () => { root.unmount(); });
    root = null;
    observed.length = 0;
    await act(async () => { root = Renderer.create(React.createElement(Reader, { label: 'reopened' })); });
    assert.deepEqual(observed[0], { label: 'reopened', size: 'compact', ready: true });
    assert.equal(diskReads, 1, 'subsequent runs do not reload the preference');
  } finally { if (root) await act(async () => { root.unmount(); }); }
});

test('a stalled secure-store read falls back without blocking or changing a visible grid', { timeout: 5000 }, async () => {
  let finishStorage;
  const storage = {
    getItemAsync: () => new Promise(resolve => { finishStorage = resolve; }),
    setItemAsync: async () => {},
  };
  const preference = compileModule('src/cardSize.ts', {
    '@/src/config': { config: { screenshots: { fixtures: true } } },
    '@/src/screenshots/storage': storage,
  });
  assert.equal(await preference.readCardSize(), 'standard', 'a stalled Keychain/Keystore read falls back');
  assert.equal(await preference.readCardSize(), 'standard', 'fallback is cached');
  finishStorage('large');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(await preference.readCardSize(), 'standard', 'late reads must not reflow cards');
  await preference.writeCardSize('large');
  assert.equal(await preference.readCardSize(), 'large', 'a player can still change size after fallback');
});

test('score strip shows scores without dots and does not push cards down', () => {
  const src = read('app/draft-run.tsx');
  assert.match(src, /const answer = run\.answers\[index\]/);
  assert.match(src, /answer \? <Text style=/);
  assert.doesNotMatch(src, /answer \? answer\.score : '·'/);
  assert.match(src, /Pick \$\{index \+ 1\}: \$\{answer\.score\} points/);
  assert.match(src, /accessibilityRole="progressbar"/);
  assert.match(src, /styles\.progressScore/);
  assert.match(src, /appearance === 'dark' \? themeColor\('accentDark'\) : themeColor\('accent'\)/);
  assert.match(src, /progressScore: \{[^}]*fontSize: 11/);
  assert.doesNotMatch(src, /themeColor\('positive'\)/);
  assert.match(src, /progressStep: \{[^}]*minHeight: 36/);
  assert.match(src, /inlineProgress \? <Progress run=\{run\} tablet/);
});
test('card-size controls are shared between guest account and game', () => {
  const src = read('app/draft-run.tsx');
  const account = read('app/account.tsx');
  const preferences = read('src/components/ResultsPreferences.tsx');
  const controls = read('src/components/CardDisplaySettings.tsx');
  assert.match(src, /testID="cycle-card-size"/);
  assert.match(src, /Cards: \{cardSize === 'standard'/);
  assert.match(src, /run\.answers\.length === 0 \? <Text style=\{styles\.pickHint\}/);
  assert.match(src, /!cardSizeReady && !run\.complete/);
  assert.match(src, /useCardSizePreference\(\)/);
  assert.doesNotMatch(src, /styles\.sizeControls/);
  assert.match(account, /\{!account \? <CardDisplaySettings \/> : null\}/);
  assert.equal((account.match(/<CardDisplaySettings \/>/g) || []).length, 2, 'both guest and signed-in account show card size');
  assert.doesNotMatch(preferences, /CardDisplaySettings|useCardSizePreference/, 'email/results settings stay separate');
  assert.match(controls, /export function CardDisplaySettings/);
  assert.match(controls, /useCardSizePreference\(\)/);
  assert.match(controls, /writeCardSize\(option\)/);
});

test('About is available to guests in Learn, not inserted into gameplay or Daily home', () => {
  const guest = read('src/screens/how-to.tsx');
  const signedIn = read('src/screens/learn.tsx');
  const daily = read('src/screens/index.tsx');
  const draft = read('app/draft-run.tsx');
  assert.match(guest, /accessibilityLabel="About Pack One"/);
  assert.match(signedIn, /accessibilityLabel="About Pack One"/);
  assert.match(signedIn, /style=\{styles\.aboutRow\}/);
  assert.doesNotMatch(daily, /About Pack One/);
  assert.doesNotMatch(draft, /About Pack One/);
});
