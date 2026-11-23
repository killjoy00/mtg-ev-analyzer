const { compileModule } = require('./support/compile-module.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');

const { act } = TestRenderer;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// My Pack One leads with four record numbers; shared challenges have their own
// card with an empty state, as on the web (#1297, design reference 2026-11-23).
const host = (name) => function Host(props) { return React.createElement(name, props, props.children); };
const rendered = (node) => node == null ? '' : typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(rendered).join(' ') : rendered(node.children || []);

const { ProfileOverview } = compileModule('src/components/ProfileOverview.tsx', {
  'expo-router': { router: { push() {} } },
  'react-native': { Pressable: host('Pressable'), StyleSheet: { create: (value) => value }, View: host('View'), Text: host('Text') },
  'react-native-safe-area-context': { SafeAreaView: host('SafeAreaView') },
  '@/src/api/draftRun': { DAILY_ENVIRONMENT_META: {}, isDailyEnvironment: () => false },
  '@/src/theme': { colors: new Proxy({}, { get: () => '#000' }), spacing: new Proxy({}, { get: () => 8 }) },
});

function profile(summary) {
  return { player: { display_name: 'Drafter', profile_public: false }, environment_total: 10,
    summary: { games: 4, average_score: 70, best_score: 90, daily_games: 2, current_streak: 1, best_streak: 2, environments_played: 2, ...summary },
    trend: [], best_environments: [], achievements: [], daily_history: [], recent: [] };
}
async function render(value, publicView = false) {
  let root;
  await act(async () => { root = TestRenderer.create(React.createElement(ProfileOverview, { profile: value, publicView })); });
  const text = rendered(root.toJSON());
  await act(async () => root.unmount());
  return text;
}

test('My Pack One shows the shared challenge record card with counts', async () => {
  const text = await render(profile({ challenge_wins: 2, challenge_losses: 1, challenge_ties: 0 }));
  assert.match(text, /Your record\s+4\s+Games\s+70\.0\s+Average\s+90\s+Best\s+1\s+Daily streak\s/);
  assert.doesNotMatch(text, /Shared challenges played|Career Snapshot|Recent Performance/);
  assert.match(text, /Shared challenges\s+Your results from playing other people’s shared runs\.\s+2\s+Beaten\s+1\s+Below target\s+0\s+Tied/);
});

test('one shared challenge shows its record, and none shows the empty state', async () => {
  assert.match(await render(profile({ challenge_wins: 0, challenge_losses: 0, challenge_ties: 1 })), /0\s+Below target\s+1\s+Tied/);
  const none = await render(profile({ challenge_wins: 0, challenge_losses: 0, challenge_ties: 0 }));
  assert.match(none, /Play someone’s shared run to start your record\./);
});

test('public profiles keep the record line and no personal empty-state card', async () => {
  const text = await render(profile({ challenge_wins: 0, challenge_losses: 0, challenge_ties: 0 }), true);
  assert.doesNotMatch(text, /Shared challenges\s+Your results|Play someone’s shared run/);
});
