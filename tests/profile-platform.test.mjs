import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [migration, worker, bootstrap, api, product, growth, myPack] = await Promise.all([
  readFile(new URL('../migrations/0003_player_profiles.sql', import.meta.url), 'utf8'),
  readFile(new URL('../worker/growth-function.js', import.meta.url), 'utf8'),
  readFile(new URL('../bootstrap.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../growth-api.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../profile-product.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../growth.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../my-pack-one.mjs', import.meta.url), 'utf8'),
]);

test('identity merge preserves authoritative Daily attempt and moves guest history', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION merge_pack1_player/);
  assert.match(migration, /ON CONFLICT \(player_id, challenge_date, set_id, mode\) DO NOTHING/);
  assert.match(migration, /DELETE FROM game_results WHERE player_id = source_player/);
  assert.match(migration, /UPDATE share_challenges SET player_id = target_player/);
  assert.match(migration, /UPDATE analytics_events SET player_id = target_player/);
  assert.match(worker, /SELECT merge_pack1_player\(\$1::uuid,\$2::uuid\)/);
  assert.match(worker, /merged = true/);
});

test('public profile is opt-in and profile API supports history and lookup', () => {
  assert.match(migration, /profile_public boolean NOT NULL DEFAULT false/);
  assert.match(migration, /profile_key text/);
  assert.match(worker, /\/v1\/profile\/me/);
  assert.match(worker, /\/v1\/profile\/history/);
  assert.match(worker, /\/v1\/profile-lookup/);
  assert.match(worker, /profile_public=true/);
  assert.match(api, /loadPublicProfile/);
  assert.match(api, /loadProfileHistory/);
  assert.match(api, /lookupPublicProfiles/);
  assert.match(api, /displayName/);
  assert.match(worker, /leaderboard_name_changed/);
  assert.match(product, /Display name/);
});

test('linked accounts with no owned display name get a persistent actionable warning', () => {
  assert.match(worker, /username_owned/);
  assert.match(myPack, /Display name needs attention/);
  assert.match(myPack, /Choose a display name to join Daily leaderboards/);
  assert.match(myPack, /profile-username-fix/);
  assert.match(product, /Shown on Daily leaderboards and your public profile/);
});

test('signed-in progression uses My Pack One Stats, Insights and Settings tabs', () => {
  assert.match(bootstrap, /renderAccount\(\{source:'nav'\}\)/);
  assert.match(product, /myPackOneMarkup/);
  assert.match(product, /id = 'account-nav'/);
  assert.doesNotMatch(product, /id = 'profile-nav'/);
  assert.doesNotMatch(growth, /id='stats-nav'/);
  assert.match(myPack, /My Pack One/);
  assert.match(myPack, /profile-stats-tab/);
  assert.match(myPack, /profile-account-tab/);
  assert.match(myPack, /my-pack-one-grid/);
  assert.match(myPack, /data-profile-panel="account"/);
  assert.match(myPack, /liveEnvironmentProgress/);
  assert.match(product, /liveEnvironmentProgress/);
  assert.doesNotMatch(myPack, /environmentProgress\(catalog/);
  assert.match(worker, /SELECT set_id FROM draft_run_environment_policy WHERE status='Live'/);
  assert.doesNotMatch(worker, /loadCatalog\(/);
  assert.match(worker, /by_set: visibleBySet/);
  assert.match(worker, /environment_total: environmentTotal/);
  assert.match(myPack, /data-share-achievement/);
  assert.match(myPack, /data-share-daily/);
  assert.match(product, /profile-account/);
  assert.match(myPack, />Settings<\/button><\/div>/);
  assert.doesNotMatch(myPack, />Account settings<\/button>/);
  assert.match(product, /Shared challenges played/);
  assert.match(myPack, /Your results from playing other people’s shared runs/);
  assert.match(product, /Results from playing other people’s shared runs/);
  assert.match(worker, /Beat the target score in five challenges/);
  assert.match(worker, /Beat the target score in twenty-five challenges/);
  assert.match(myPack, /Welcome to My Pack One/);
  assert.match(myPack, /Play a Daily to get started/);
  assert.doesNotMatch(myPack, /Empty data is not treated as a zero score/);
  // Elite from any source is shown even when Patreon itself is unavailable.
  assert.match(myPack, /membershipLabel=elite\?'Elite':patreon\?\.configured!==true\?'Status unavailable'/);
  assert.doesNotMatch(myPack, /elite\?'Elite':'Free'/);
  assert.match(product, /Play your first Daily to start your record/);
  assert.doesNotMatch(product, /One account prompt is enough|instead of filling an empty record with zeroes/);
  assert.match(product, /Sign in or create account/);
  assert.doesNotMatch(product, /Back to game/);
});

test('Your record leads with four numbers and older record sections are one click away', async () => {
  const { myPackOneMarkup } = await import('../my-pack-one.mjs');
  const profile = (summary) => ({
    player:{display_name:'Player',claimed:true}, achievements:[], by_set:[], recent:[], daily_history:[], trend:[],
    summary:{games:3,average_score:70,best_score:90,current_streak:1,...summary},
  });
  const many = myPackOneMarkup(profile({challenge_wins:8,challenge_losses:3,challenge_ties:1}), {sets:[]}, {settingsMarkup:''});
  assert.match(many, /<h2>Your record<\/h2>/);
  assert.doesNotMatch(many, /Career Snapshot|Recent Performance|Environments<\/span>/);
  const metrics = many.match(/<div class="my-career-metrics">([\s\S]*?)<\/div><\/section>/)[1];
  assert.deepEqual([...metrics.matchAll(/<span>([^<]+)<\/span>/g)].map(m=>m[1]), ['Games','Average','Best','Daily streak']);
  assert.ok(many.indexOf('<h2>Recent scores</h2>') < many.indexOf('<h2>Recent games</h2>'));
  assert.ok(many.indexOf('<h2>Recent games</h2>') < many.indexOf('Sets where you&#39;ve scored best'));
  assert.ok(many.indexOf('Sets where you&#39;ve scored best') < many.indexOf('More from your record'));
  for (const section of ['achievements-summary','daily-history','sets-played','shared-challenges'])
    assert.match(many, new RegExp('<details class="my-pack-details my-record-section" data-profile-section="'+section+'">'));
  assert.match(many, /<summary>Shared challenges <span>12 played<\/span><\/summary>/);
  assert.match(many, /<strong>8<\/strong><span>Beaten<\/span><\/div><div><strong>3<\/strong><span>Below target<\/span><\/div><div><strong>1<\/strong><span>Tied<\/span>/);
  const none = myPackOneMarkup(profile({}), {sets:[]}, {settingsMarkup:''});
  assert.match(none, /<summary>Shared challenges <span>0 played<\/span><\/summary>/);
  assert.match(none, /Play someone’s shared run to start your record\./);
  assert.doesNotMatch(none, /my-challenge-record/);
});
