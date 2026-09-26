import type { CareerProfile, DailyHistoryRow, ProfileAchievement } from '@/src/api/career';
import type { MobileSession } from '@/src/storage/session';

export type ActivityTab = 'archive' | 'achievements' | 'daily';
export type ActivityScope = { kind: 'private' } | { kind: 'public'; key: string };
export type ActivityTarget = { kind: 'achievement'; id: string } | { kind: 'daily'; date: string; set: string; mode: string };
export type ArchiveEntry = { id: string; name: string; dataDate: string | null };
export type ArchiveFilter = 'all' | 'played' | 'unplayed';
const SET = /^[a-z0-9][a-z0-9-]{1,39}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function activityScope(value: unknown): ActivityScope {
  if (value === undefined) return { kind: 'private' };
  if (typeof value !== 'string' || !/^[a-f0-9]{16}$/.test(value)) throw new Error('This public profile link is invalid.');
  return { kind: 'public', key: value };
}

export function activitySessionKey(session: MobileSession | null) {
  if (!session || typeof session.playerToken !== 'string' || typeof session.accountToken !== 'string'
    || !/^[A-Za-z0-9_-]{43}$/.test(session.accountToken)) return null;
  const player = session.playerToken.match(/^p1_([a-f0-9-]{36})\.[A-Za-z0-9_-]{43}$/i)?.[1];
  const account = session.accountUser?.id;
  if (!player || !UUID.test(player) || typeof account !== 'string' || !UUID.test(account)) return null;
  if (session.subjectId !== undefined && (typeof session.subjectId !== 'string' || session.subjectId.toLowerCase() !== player.toLowerCase())) return null;
  return JSON.stringify([player.toLowerCase(), account.toLowerCase(), session.playerToken, session.accountToken]);
}

export function checkedArchive(value: unknown): ArchiveEntry[] {
  const sets = value && typeof value === 'object' ? (value as { sets?: unknown }).sets : null;
  if (!Array.isArray(sets) || sets.length > 500) throw new Error('The published archive catalog is unavailable.');
  const seen = new Set<string>();
  return sets.filter((entry) => entry?.is_fixture !== true).map((entry) => {
    if (!entry || typeof entry.id !== 'string' || !SET.test(entry.id) || seen.has(entry.id)
      || (entry.name != null && typeof entry.name !== 'string')) throw new Error('The published archive catalog could not be verified.');
    seen.add(entry.id);
    return { id: entry.id, name: entry.name?.trim() || entry.id.toUpperCase(),
      dataDate: typeof entry.data_date === 'string' ? entry.data_date : null };
  });
}

export function archiveProgress(entries: ArchiveEntry[], profile: CareerProfile) {
  const rows = new Map(profile.by_set.map((row) => [row.set_id.toLowerCase(), row]));
  return entries.map((entry) => {
    const record = rows.get(entry.id);
    return { ...entry, record, played: Boolean(record && record.games > 0),
      favorite: entry.id === profile.player.favorite_set_id, cube: entry.id === 'powered-cube' };
  });
}

export function filterArchive(entries: ReturnType<typeof archiveProgress>, filter: ArchiveFilter, search: string) {
  const term = search.trim().toLowerCase();
  return entries.filter((entry) => (filter === 'all' || entry.played === (filter === 'played'))
    && (!term || `${entry.id} ${entry.name}`.toLowerCase().includes(term)));
}

export function environmentName(id: string) {
  return ({ mixed: 'Draft Run', latest: 'Latest Set', 'powered-cube': 'Powered Cube' } as Record<string, string>)[id] ?? id.toUpperCase();
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function dailyKey(row: Pick<DailyHistoryRow, 'date' | 'set_id' | 'mode'>) {
  return JSON.stringify([row.date, row.set_id, row.mode]);
}

export function dailyStanding(row: DailyHistoryRow) {
  const state = row.final === true ? 'Final' : row.final === false ? 'Live, so far' : 'Standing not marked final';
  const rank = Number.isInteger(row.rank) && row.rank > 0 && Number.isInteger(row.total) && row.total >= row.rank
    ? `#${row.rank} of ${row.total}` : 'Ranking unavailable';
  const percentile = typeof row.percentile === 'number' && row.percentile > 0 && row.percentile <= 100
    ? `Top ${row.percentile}%` : null;
  return [state, percentile, rank].filter(Boolean).join(' \u00b7 ');
}

export function checkedActivityProfile(profile: CareerProfile, scope: ActivityScope) {
  if (!profile?.player || typeof profile.player.display_name !== 'string'
    || !Array.isArray(profile.by_set) || !Array.isArray(profile.achievements) || !Array.isArray(profile.daily_history)
    || profile.by_set.some((row) => !row || typeof row.set_id !== 'string' || !SET.test(row.set_id)
      || ![row.games, row.average_score, row.best_score].every(Number.isFinite)
      || (row.daily_games != null && !Number.isFinite(row.daily_games))
      || (row.last_played_at != null && typeof row.last_played_at !== 'string'))
    || profile.achievements.some((row) => !row || typeof row.id !== 'string' || typeof row.label !== 'string' || typeof row.unlocked !== 'boolean'
      || [row.description, row.progress_text, row.earned_at].some((value) => value != null && typeof value !== 'string'))
    || profile.daily_history.some((row) => !row || typeof row.date !== 'string' || !validDate(row.date)
      || typeof row.set_id !== 'string' || !SET.test(row.set_id)
      || typeof row.mode !== 'string' || !Number.isFinite(row.score) || row.score < 0 || row.score > 100
      || (row.grade != null && typeof row.grade !== 'string'))) {
    throw new Error('The profile activity could not be verified. Refresh the record.');
  }
  if (scope.kind === 'public' && (profile.player.profile_public !== true || profile.player.profile_key !== scope.key)) {
    throw new Error('This profile is no longer publicly available.');
  }
  return profile;
}

/** Only identifiers from a tap are accepted. All shared facts come from a fresh server profile. */
export function activityShareMessage(profile: CareerProfile, target: ActivityTarget) {
  const name = profile.player.display_name;
  const key = profile.player.profile_key;
  const url = profile.player.profile_public === true && typeof key === 'string' && /^[a-f0-9]{16}$/.test(key)
    ? `https://packone.pro/?profile=${key}` : 'https://packone.pro/';
  if (target.kind === 'achievement') {
    const rows = profile.achievements.filter((item) => item.id === target.id && item.unlocked === true);
    if (rows.length !== 1) throw new Error('This achievement is not currently available to share.');
    return `${name} unlocked \u201c${rows[0]!.label}\u201d on Pack One.\n${url}`;
  }
  const rows = profile.daily_history.filter((row) => row.date === target.date && row.set_id === target.set && row.mode === target.mode);
  if (rows.length !== 1) throw new Error('This Daily finish is no longer in the returned history. Refresh the record.');
  const row = rows[0]!;
  const mode = ({ draft_run: 'Draft Run', cube: 'Powered Cube Run', top3: 'Top 3', full: 'Full Pack' } as Record<string, string>)[row.mode] ?? row.mode;
  return `${name} scored ${row.score}/100${row.grade ? ` (${row.grade})` : ''} on Pack One.\n${environmentName(row.set_id)} \u00b7 ${mode} \u00b7 Daily ${row.date}\n${dailyStanding(row)}\n${url}`;
}

export function achievementProgress(row: ProfileAchievement) {
  return typeof row.current === 'number' && Number.isFinite(row.current) && typeof row.target === 'number'
    && Number.isFinite(row.target) && row.target > 0 ? Math.max(0, Math.min(100, 100 * row.current / row.target)) : null;
}
