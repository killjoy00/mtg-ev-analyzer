const EASTERN_TIME_ZONE = 'America/New_York';

export function easternDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function completedDaily(profile, environment, dateKey) {
  return (profile?.daily_history || []).find((row) => (
    String(row?.date || '') === dateKey
    && String(row?.mode || '') === 'draft_run'
    && String(row?.set_id || '') === environment
  )) || null;
}

function statusFor(profile, environment, dateKey) {
  const row = completedDaily(profile, environment, dateKey);
  if (!row) return { complete: false, score: null, rank: null, total: null, percentile: null };
  return {
    complete: true,
    score: Number(row.score || 0),
    rank: Number(row.rank || 0) || null,
    total: Number(row.total || 0) || null,
    percentile: Number(row.percentile || 0) || null,
  };
}

export function todayStatus(profile, dateKey = easternDateKey()) {
  const draftRun = statusFor(profile, 'mixed', dateKey);
  const cube = statusFor(profile, 'powered-cube', dateKey);
  return {
    dateKey,
    draftRun,
    cube,
    completed: Number(draftRun.complete) + Number(cube.complete),
    streak: Number(profile?.summary?.current_streak || 0),
  };
}
