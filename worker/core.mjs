import {gameDateKey} from '../game-date.mjs';
export {gameDateKey,GAME_TIME_ZONE} from '../game-date.mjs';

export function hashText(value) {
  let hash = 2166136261;
  for (let i = 0; i < String(value).length; i += 1) {
    hash ^= String(value).charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function dateOrdinal(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

export function challengeIndex(dateKey, setId, mode, replayCount) {
  const count = Math.max(0, Number(replayCount) || 0);
  if (!count) return 0;
  if (count === 1) return 0;
  const base = hashText(`${setId}|${mode}|pack1-daily-base-v2`) % count;
  const step = 1 + (hashText(`${setId}|${mode}|pack1-daily-step-v2`) % (count - 1));
  return (base + (dateOrdinal(dateKey) * step)) % count;
}

export function featuredSetId(catalog) {
  const sets = [...(catalog?.sets || [])].filter((set) => set?.id);
  if (!sets.length) return null;
  sets.sort((a, b) => String(b.data_date || '').localeCompare(String(a.data_date || '')) || String(a.id).localeCompare(String(b.id)));
  return sets[0].id;
}

export function periodStart(period, date = new Date()) {
  if (period === 'all') return '1970-01-01';
  const key = gameDateKey(date);
  const value = new Date(`${key}T12:00:00Z`);
  const y = value.getUTCFullYear();
  const m = value.getUTCMonth();
  const d = value.getUTCDate();
  if (period === 'monthly') return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  if (period === 'weekly') {
    const copy = new Date(Date.UTC(y, m, d));
    const day = copy.getUTCDay();
    const back = day === 0 ? 6 : day - 1;
    copy.setUTCDate(copy.getUTCDate() - back);
    return copy.toISOString().slice(0, 10);
  }
  return key;
}
