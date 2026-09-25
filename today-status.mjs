import {gameDateKey} from './game-date.mjs';
export {gameDateKey} from './game-date.mjs';

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

export function todayStatus(profile, dateKey = gameDateKey()) {
  const draftRun = statusFor(profile, 'mixed', dateKey);
  const cube = statusFor(profile, 'powered-cube', dateKey);
  const latest = statusFor(profile, 'latest', dateKey);
  return {
    dateKey,
    draftRun,
    cube,
    latest,
    completed: Number(draftRun.complete) + Number(cube.complete) + Number(latest.complete),
    streak: Number(profile?.summary?.current_streak || 0),
  };
}
