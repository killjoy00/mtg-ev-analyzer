# Username identity and ranking

Pack One separates an anonymous/local nickname from an owned account username.

## Identity contract

- `players.display_name` may be reused by anonymous/guest players.
- `players.username_owned=true` marks an account-owned public username.
- Owned usernames are case-insensitively unique through `players_username_uq` and `pack1_username_key(display_name)`.
- `Pack Player` remains a shared placeholder and is never owned.
- Account linkage alone is not enough for public/ranked identity. Leaderboards, ranked Daily attachment/promotion, public profile identity and attributed challenge sharing require an owned username.
- A linked player whose current nickname is already owned remains linked successfully with `username_owned=false` until they choose a free username.

## Player-facing recovery

The unowned linked state must never be silent.

- Account linking returns `rankingIdentity.eligible=false` with `reason="username_taken"` or `reason="username_required"`.
- Daily status and Daily run responses expose the same reason.
- Daily home warns before play that the result will not be ranked and links to the username field.
- My Pack One keeps a persistent **Username needs attention** warning until the player saves a unique username.
- An already-started or completed Daily explains the username-specific exclusion rather than calling the player a guest.
- If a completed guest Daily is awaiting sign-in validation, that validation remains pending while the player fixes the username. Saving a unique username retries validation so the completed score can still be added when otherwise eligible.

The database unique index remains the authority. The client may guide the player, but it must not replace Postgres enforcement with a check-then-write flow.

## Admin observability

Admin → Users is the operational view for unresolved username identity.

- **Username attention** counts linked accounts whose player has `username_owned=false`.
- Affected accounts carry a **Username attention** badge and detail annotation.
- A newly changed account link that remains unowned records the server-only analytics event `username_ownership_conflict` with a reason.
- Individual collisions do **not** send admin email. A collision is a recoverable product state, not an outage.

If the Username attention count becomes nonzero, verify that the affected user can reach My Pack One, save a unique username, and then disappears from the count. Investigate repeated or growing unresolved counts before adding alerting; do not resolve them by manually stealing or rewriting another user's owned name.

## Verification

The regression contract covers:

1. Player A owns a username.
2. Player B uses the same local nickname and links an account.
3. B remains linked but unowned.
4. Link, profile and Daily APIs expose the explicit username-attention state.
5. Only A is visible under that username on public leaderboards.
6. B's unattributed challenge identity stays generic.
7. One structured `username_ownership_conflict` event is recorded for the changed link.
8. B renames to a free username.
9. The warning clears and B becomes eligible for ranked/public identity.
10. Existing eligible scores become visible under the newly owned username, and pending Daily validation can complete.

The isolated Neon backend gate is the authoritative integration check. Browser/unit coverage verifies the Daily-home warning, My Pack One recovery surface, result copy and module cache versioning.

## Deployment

Migration 0033 is already the schema prerequisite. This warning/observability release adds no migration.

Deploy the reviewed `main` SHA to development first, pass revision/schema and gameplay acceptance, then promote the exact same SHA to production. Do not deploy application code that reads `username_owned` to a database that lacks migration 0033.
