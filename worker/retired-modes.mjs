// Shared tombstones for retired Full Pack and Top 3 API routes only.
// Draft Run has its own leaderboard and challenge routes; never match by suffix.
export const RETIRED_MODES_MESSAGE = 'Full Pack and Top 3 have been retired. Play the Daily or practice Draft Run.';

export function isRetiredLegacyRoute(path, method) {
  return (method === 'POST' && ['/v1/scores', '/v1/challenges'].includes(path)) ||
    (method === 'GET' && (['/v1/leaderboard', '/v1/distribution'].includes(path) ||
      /^\/v1\/challenges\/[a-f0-9]{12}$/.test(path)));
}
