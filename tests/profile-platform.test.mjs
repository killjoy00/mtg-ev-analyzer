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
  assert.match(product, /profile-account/);
  assert.match(growth, /Back to my career/);
  assert.match(product, /environmentProgress/);
  assert.match(product, /data-share-achievement/);
  assert.match(product, /data-share-daily/);
});

// "Become Elite" used to open a page that never said Elite: a guest landed on
// the generic "Save your progress" signup, and a signed-in free account was
// dropped at the top of its own profile to hunt for the Patreon section.
test('an Elite call to action still says Elite at its destination', async () => {
  const [home, run] = await Promise.all([
    readFile(new URL('../daily-home.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../draft-run-product.mjs', import.meta.url), 'utf8'),
  ]);

  // Every Elite entry point declares the intent.
  assert.match(home, /data-home-elite[\s\S]*?renderAccount\(\{ intent: 'elite' \}\)/);
  assert.match(run, /#practice-membership[\s\S]*?renderAccount\(\{intent:'elite'\}\)/);
  // The free-account prompt is a different ask and must not claim Elite.
  assert.match(home, /data-home-account[\s\S]*?renderAccount\(\)/);

  assert.match(growth, /renderAccount\(\{ validateDailyRunId = null, intent = null \} = \{\}\)/);

  // A guest sees why an account is the first step, not a generic pitch.
  assert.match(growth, /Elite starts with an account\./);
  assert.match(growth, /Elite adds unlimited Powered Cube and custom-set drafts\./);
  assert.match(growth, /then connect Patreon to unlock them\./);
  // Validating a Daily score is time sensitive and keeps precedence.
  assert.match(growth, /seekingElite=!validatingDaily&&pendingIntent==='elite'/);

  // A signed-in arrival lands on the membership section itself.
  assert.match(growth, /function revealMembership\(\)/);
  assert.match(growth, /querySelector\('\.profile-membership'\)/);
  assert.match(growth, /arrivingIntent==='elite'\)revealMembership\(\)/);

  // The intent survives sign-up, because that round trip re-enters
  // renderAccount and only then reaches the signed-in branch.
  const guestBranch = growth.slice(growth.indexOf('const validatingDaily='));
  assert.match(guestBranch, /const onward=seekingElite\?\{intent:'elite'\}:\{\}/);
  assert.equal((guestBranch.match(/renderAccount\(onward\)/g) || []).length, 2,
    'both the sign-up and sign-in handlers must carry the intent forward');

  // It is consumed on render, so it cannot leak onto a later unrelated prompt.
  assert.match(guestBranch, /pendingIntent=null/);
  const signedInBranch = growth.slice(growth.indexOf('const validationRunId=pendingDailyRunValidation,arrivingIntent'),
    growth.indexOf('const validatingDaily='));
  assert.match(signedInBranch, /pendingIntent=null/);
});
