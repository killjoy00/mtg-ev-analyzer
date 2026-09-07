export const GAME_TIME_ZONE = 'America/New_York';

export function gameDateKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: GAME_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

// Kept as a compatibility alias while the app migrates away from the old UTC name.
export const utcDateKey = gameDateKey;

function hashText(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rawChallengeIndex(dateKey, setId, mode, count) {
  return hashText(`${dateKey}|${setId}|${mode}|pack1-daily-v1`) % count;
}

export function previousGameDateKey(dateKey, days = 1) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function challengeIndex(dateKey, setId, mode, replayCount) {
  const count = Math.max(0, Number(replayCount) || 0);
  if (!count) return 0;
  const today = rawChallengeIndex(dateKey, setId, mode, count);
  if (count === 1) return today;
  const yesterday = rawChallengeIndex(previousGameDateKey(dateKey), setId, mode, count);
  return today === yesterday ? (today + 1) % count : today;
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
