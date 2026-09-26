import { requestJson } from '@/src/api/client';
import type { CareerHistoryPage, CareerHistoryRow, CareerProfile } from '@/src/api/career';

export class InvalidPublicProfileError extends Error {
  constructor() { super('This public profile could not be verified. Reload the profile.'); this.name = 'InvalidPublicProfileError'; }
}

export function publicProfileKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{16}$/.test(value)) throw new InvalidPublicProfileError();
  return value;
}

export function publicProfileUrl(key: string) {
  return `https://packone.pro/?profile=${publicProfileKey(key)}`;
}

function checkedProfile(value: unknown, key: string): CareerProfile {
  if (!value || typeof value !== 'object') throw new InvalidPublicProfileError();
  const profile = value as Partial<CareerProfile>;
  if (profile.player?.profile_key !== key || profile.player.profile_public !== true
    || typeof profile.player.display_name !== 'string' || !profile.summary
    || !Number.isFinite(profile.summary.games) || !Number.isFinite(profile.summary.average_score)
    || !Number.isFinite(profile.summary.best_score)
    || !['by_set', 'by_mode', 'best_environments', 'daily_history', 'recent', 'trend', 'achievements']
      .every((field) => Array.isArray((value as Record<string, unknown>)[field]))) throw new InvalidPublicProfileError();
  return profile as CareerProfile;
}

function checkedHistory(value: unknown): CareerHistoryPage {
  if (!value || typeof value !== 'object') throw new InvalidPublicProfileError();
  const page = value as Partial<CareerHistoryPage>;
  if (!Array.isArray(page.rows) || page.rows.length > 50
    || !(page.next_cursor === null || (typeof page.next_cursor === 'string' && /^\d{1,30}$/.test(page.next_cursor)))
    || !page.rows.every((row: CareerHistoryRow) => row && typeof row.cursor === 'string' && /^\d{1,30}$/.test(row.cursor)
      && typeof row.played_at === 'string' && typeof row.set_id === 'string'
      && typeof row.mode === 'string' && Number.isFinite(row.score) && typeof row.is_daily === 'boolean')) {
    throw new InvalidPublicProfileError();
  }
  return page as CareerHistoryPage;
}

// These already-public routes enforce the subject's opt-in on the server.
// Never create a guest, send a native account token, or inherit browser cookies
// just to view someone else's public record.
export async function loadPublicProfile(key: string) {
  const id = publicProfileKey(key);
  const value = await requestJson<unknown>(`/growth/v1/profile/${id}`, { timeoutMs: 20_000, credentials: 'omit' });
  return checkedProfile(value, id);
}

export async function loadPublicProfileHistory(key: string, cursor: string | null = null) {
  const id = publicProfileKey(key);
  if (cursor !== null && !/^\d{1,30}$/.test(cursor)) throw new InvalidPublicProfileError();
  const query = new URLSearchParams({ limit: '25' });
  if (cursor !== null) query.set('cursor', cursor);
  const value = await requestJson<unknown>(`/growth/v1/profile/${id}/history?${query.toString()}`, {
    timeoutMs: 20_000, credentials: 'omit',
  });
  return checkedHistory(value);
}
