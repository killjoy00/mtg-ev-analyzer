import {gameDateKey} from './game-date.mjs';
export {gameDateKey,GAME_TIME_ZONE} from './game-date.mjs';
// Compatibility for previously cached clients; all current callers use gameDateKey.
export {gameDateKey as utcDateKey} from './game-date.mjs';

function hashText(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function dateOrdinal(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

export function previousGameDateKey(dateKey, days = 1) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function challengeIndex(dateKey, setId, mode, replayCount) {
  const count = Math.max(0, Number(replayCount) || 0);
  if (!count) return 0;
  if (count === 1) return 0;
  const base = hashText(`${setId}|${mode}|pack1-daily-base-v2`) % count;
  const step = 1 + (hashText(`${setId}|${mode}|pack1-daily-step-v2`) % (count - 1));
  return (base + (dateOrdinal(dateKey) * step)) % count;
}

// Compatibility alias for existing imports/tests.
export const previousUtcDateKey = previousGameDateKey;

export function computeStreak(completedDateKeys, todayKey = gameDateKey()) {
  const completed = new Set((completedDateKeys || []).filter(Boolean));
  if (!completed.size) return 0;
  const start = completed.has(todayKey) ? todayKey : previousGameDateKey(todayKey);
  if (!completed.has(start)) return 0;
  let streak = 0;
  let cursor = start;
  while (completed.has(cursor)) {
    streak += 1;
    cursor = previousGameDateKey(cursor);
  }
  return streak;
}

export function unlockedMilestones({ completedRuns = [], streak = 0, bestScore = 0 } = {}) {
  const runs = completedRuns.length;
  const dates = new Set(completedRuns.map((run) => run.date).filter(Boolean));
  const doubleHeader = Array.from(dates).some((date) => {
    const modes = new Set(completedRuns.filter((run) => run.date === date).map((run) => run.mode));
    return modes.has('top3') && modes.has('full');
  });
  return [
    runs >= 1 ? { id: 'first', label: 'First challenge' } : null,
    bestScore >= 100 ? { id: 'perfect', label: 'Perfect 100' } : null,
    streak >= 3 ? { id: 'streak3', label: '3-day streak' } : null,
    streak >= 7 ? { id: 'streak7', label: '7-day streak' } : null,
    runs >= 10 ? { id: 'ten', label: '10 challenges' } : null,
    doubleHeader ? { id: 'double', label: 'Double header' } : null,
  ].filter(Boolean);
}
