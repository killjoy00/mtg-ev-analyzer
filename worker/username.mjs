// Pack One usernames. `players.display_name` serves two roles: an owned public
// username for an account-linked player, and a throwaway local nickname that an
// anonymous browser replays on every session call. Only the first is unique.
//
// Uniqueness is enforced by Postgres through `players_username_uq`, a partial
// unique index over `pack1_username_key(display_name)` restricted to rows with
// `username_owned`. The SQL key function and `usernameKey` below must agree, or
// the application and the database would disagree about what counts as the same
// name. Keep them in step (migrations/0033_unique_usernames.sql).

export const PLACEHOLDER_USERNAME = 'Pack Player';
export const USERNAME_TAKEN_MESSAGE = 'That username is already taken.';
export const USERNAME_INDEX = 'players_username_uq';

// Existing normalization: trim, collapse runs of whitespace, cap at 24 chars,
// require 2. The trailing trim is new: slicing a collapsed name at 24 could cut
// mid-space and store a name ending in whitespace, which would read as the same
// username to a person while indexing as a distinct one.
export function normalizeDisplayName(value) {
  const cleaned = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24).trim();
  if (cleaned.length < 2) throw Object.assign(new Error('Display name must be 2-24 characters.'), { status: 400 });
  return cleaned;
}

// Mirror of pack1_username_key(text). Case and whitespace never distinguish
// two usernames.
export function usernameKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isPlaceholderUsername(value) {
  return usernameKey(value) === usernameKey(PLACEHOLDER_USERNAME);
}

// A unique violation on the username index is the authoritative answer to "is
// this name free", so it is translated rather than surfaced. Any other database
// error keeps its own identity.
export function isUsernameConflict(error) {
  return error?.pgCode === '23505'
    && (error?.pgConstraint === USERNAME_INDEX || String(error?.message || '').includes(USERNAME_INDEX));
}

export function usernameConflictError() {
  return Object.assign(new Error(USERNAME_TAKEN_MESSAGE), { status: 409, code: 'USERNAME_TAKEN' });
}

// Rethrow as a friendly 409, or pass the original error through untouched.
export function rethrowUsernameConflict(error) {
  throw isUsernameConflict(error) ? usernameConflictError() : error;
}
