import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLACEHOLDER_USERNAME,
  USERNAME_INDEX,
  USERNAME_TAKEN_MESSAGE,
  isPlaceholderUsername,
  isUsernameConflict,
  normalizeDisplayName,
  rethrowUsernameConflict,
  usernameConflictError,
  usernameKey,
} from '../worker/username.mjs';

test('display name normalization trims, collapses, and bounds length', () => {
  assert.equal(normalizeDisplayName('  Ryan  '), 'Ryan');
  assert.equal(normalizeDisplayName('Ryan   the   Drafter'), 'Ryan the Drafter');
  assert.equal(normalizeDisplayName('R'.repeat(40)), 'R'.repeat(24));
  assert.throws(() => normalizeDisplayName('R'), { status: 400 });
  assert.throws(() => normalizeDisplayName('   '), { status: 400 });
  assert.throws(() => normalizeDisplayName(null), { status: 400 });
});

test('a name cut at the length cap never keeps trailing whitespace', () => {
  // Slicing a collapsed name at 24 can land on a space. Storing that would
  // index as a username distinct from the one a person sees.
  const cut = normalizeDisplayName('a'.repeat(23) + ' bcdef');
  assert.equal(cut, 'a'.repeat(23));
  assert.equal(cut, cut.trim());
});

test('usernames collide across case and whitespace', () => {
  const key = usernameKey('Ryan');
  assert.equal(usernameKey('ryan'), key);
  assert.equal(usernameKey('RYAN'), key);
  assert.equal(usernameKey('  Ryan '), key);
  assert.equal(usernameKey('Ryan Two') === key, false);
  assert.equal(usernameKey('Ryan  Two'), usernameKey('ryan two'));
});

test('the application key matches the normalization the workers store', () => {
  for (const raw of ['  Ryan   Draft  ', 'RYAN draft', 'ryan Draft']) {
    assert.equal(usernameKey(normalizeDisplayName(raw)), usernameKey(raw));
  }
});

test('every casing of the placeholder stays a placeholder', () => {
  assert.equal(isPlaceholderUsername(PLACEHOLDER_USERNAME), true);
  assert.equal(isPlaceholderUsername('pack player'), true);
  assert.equal(isPlaceholderUsername('PACK PLAYER'), true);
  assert.equal(isPlaceholderUsername(' Pack  Player '), true);
  assert.equal(isPlaceholderUsername('Pack Players'), false);
  assert.equal(isPlaceholderUsername('Ryan'), false);
});

test('only a username unique violation becomes a user-facing conflict', () => {
  assert.equal(isUsernameConflict({ pgCode: '23505', pgConstraint: USERNAME_INDEX }), true);
  assert.equal(
    isUsernameConflict({ pgCode: '23505', message: `duplicate key value violates unique constraint "${USERNAME_INDEX}"` }),
    true,
    'the constraint name in the message is enough when the field is absent',
  );
  assert.equal(isUsernameConflict({ pgCode: '23505', pgConstraint: 'players_profile_key_uq' }), false);
  assert.equal(isUsernameConflict({ pgCode: '23503', pgConstraint: USERNAME_INDEX }), false);
  assert.equal(isUsernameConflict(new Error('Database query failed (500): timeout')), false);
  assert.equal(isUsernameConflict(null), false);
});

test('the conflict surfaces a 409 and never the Postgres error', () => {
  const error = usernameConflictError();
  assert.equal(error.status, 409);
  assert.equal(error.code, 'USERNAME_TAKEN');
  assert.equal(error.message, USERNAME_TAKEN_MESSAGE);
  assert.equal(error.message, 'That username is already taken.');

  assert.throws(
    () => rethrowUsernameConflict(Object.assign(new Error('duplicate key'), { pgCode: '23505', pgConstraint: USERNAME_INDEX })),
    (thrown) => thrown.status === 409 && thrown.message === USERNAME_TAKEN_MESSAGE && !/duplicate key/.test(thrown.message),
  );

  const unrelated = Object.assign(new Error('Database query failed (503): unavailable'), { pgCode: null });
  assert.throws(() => rethrowUsernameConflict(unrelated), (thrown) => thrown === unrelated);
});
