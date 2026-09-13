import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [migration, worker, bootstrap, api, product, growth] = await Promise.all([
  readFile(new URL('../migrations/0003_player_profiles.sql', import.meta.url), 'utf8'),
  readFile(new URL('../worker/growth-function.js', import.meta.url), 'utf8'),
  readFile(new URL('../bootstrap.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../growth-api.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../profile-product.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../growth.mjs', import.meta.url), 'utf8'),
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
  assert.match(product, /Leaderboard name/);
});

test('progression UI keeps stats inside Account and preserves the career surface', () => {
  assert.match(bootstrap, /profile-product\.mjs/);
  assert.match(bootstrap, /installProfileProductLayer/);
  assert.match(product, /id = 'account-nav'/);
  assert.doesNotMatch(product, /id = 'profile-nav'/);
  assert.doesNotMatch(product, /stats-nav.*remove/);
  assert.doesNotMatch(growth, /id='stats-nav'/);
  assert.match(product, /profile-manage-account/);
  assert.match(growth, /Back to my career/);
  assert.match(product, /environmentProgress/);
  assert.match(product, /data-share-achievement/);
  assert.match(product, /data-share-daily/);
});
