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

const DAILY_NEXT_ORDER = [
  {environment:'mixed',key:'draftRun',label:'Play Daily Draft Run',href:'?game=draft-run&daily=1'},
  {environment:'powered-cube',key:'cube',label:'Play Daily Powered Cube',href:'?game=draft-run&set=powered-cube&daily=1'},
  {environment:'latest',key:'latest',label:'Play Daily Latest Set',href:'?game=draft-run&set=latest&daily=1'},
];

// Used only after a completed real Daily. Never infer an unfinished game from
// missing/failed status, a stale Pacific date, or a different player's history.
function completedDailyStatus(profile,{completedDay,completedEnvironment,now=new Date()}={}) {
  const day=gameDateKey(now);
  if(completedDay!==day
    || !DAILY_NEXT_ORDER.some(item=>item.environment===completedEnvironment)
    || !Array.isArray(profile?.daily_history)
    || (profile.day&&profile.day!==day))return null;
  const status=todayStatus(profile,day);
  // The result currently on screen is complete even if the history endpoint
  // is briefly behind its final write.
  return DAILY_NEXT_ORDER.map(item=>({item,complete:item.environment===completedEnvironment||status[item.key].complete}));
}

export function nextUnfinishedDaily(profile,options) {
  return completedDailyStatus(profile,options)?.find(entry=>!entry.complete)?.item||null;
}

export function completedAllDailies(profile,options) {
  return completedDailyStatus(profile,options)?.every(entry=>entry.complete)===true;
}
