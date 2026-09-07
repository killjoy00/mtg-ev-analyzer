import { computeStreak, utcDateKey } from './engagement.mjs';
import { ensurePackSession, loadAccountDailyDates, saveGameResult } from './growth-api.mjs';

const GAME_HISTORY_KEY = 'pack1-game-history-v2';
const DAILY_HISTORY_KEY = 'pack1-daily-history-v1';
let observer = null;
let enhancing = false;

function readArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

async function syncLocalResults() {
  await ensurePackSession().catch(() => null);
  const results = readArray(GAME_HISTORY_KEY);
  for (const result of results.slice(-500)) await saveGameResult(result);
}

async function dailyDates() {
  const local = readArray(DAILY_HISTORY_KEY).map((item) => item?.date).filter(Boolean);
  const remote = await loadAccountDailyDates();
  return [...new Set([...local, ...remote])];
}

async function enhanceStats() {
  if (enhancing) return;
  const board = document.querySelector('.stats-page .stat-scoreboard');
  if (!board || board.querySelector('[data-daily-streak]')) return;
  enhancing = true;
  try {
    const dates = await dailyDates();
    const streak = computeStreak(dates, utcDateKey());
    const item = document.createElement('div');
    item.dataset.dailyStreak = '1';
    item.innerHTML = `<span>Daily streak</span><strong>${streak}</strong>`;
    board.appendChild(item);
  } finally { enhancing = false; }
}

export function installRetentionLayer() {
  void syncLocalResults();
  observer = new MutationObserver(() => void enhanceStats());
  const app = document.querySelector('#app');
  if (app) observer.observe(app, { childList:true, subtree:true });
  void enhanceStats();
}
