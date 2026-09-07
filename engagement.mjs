export function utcDateKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  return value.toISOString().slice(0, 10);
}

function hashText(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function challengeIndex(dateKey, setId, mode, replayCount) {
  const count = Math.max(0, Number(replayCount) || 0);
  if (!count) return 0;
  return hashText(`${dateKey}|${setId}|${mode}|pack1-daily-v1`) % count;
}

export function previousUtcDateKey(dateKey, days = 1) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return utcDateKey(date);
}

export function computeStreak(completedDateKeys, todayKey = utcDateKey()) {
  const completed = new Set((completedDateKeys || []).filter(Boolean));
  if (!completed.size) return 0;
  const start = completed.has(todayKey) ? todayKey : previousUtcDateKey(todayKey);
  if (!completed.has(start)) return 0;
  let streak = 0;
  let cursor = start;
  while (completed.has(cursor)) {
    streak += 1;
    cursor = previousUtcDateKey(cursor);
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
