import { gameDateKey } from './engagement.mjs';
import { gameShareUrl, makeGameSeed } from './gameplay.mjs';

const SHARE_ORIGIN = 'https://packone.pro/';
const HISTORY_KEY = 'pack1-daily-history-v1';
const DAILY_MIGRATION_KEY = 'pack1-daily-selector-v2-migrated';

function currentSet() {
  const params = new URLSearchParams(window.location.search);
  return params.get('set') || document.querySelector('#set-select')?.value || '';
}

function freshSeed() {
  return makeGameSeed(globalThis.crypto?.randomUUID ? () => crypto.randomUUID() : null);
}

function migrateDailyHistory() {
  try {
    if (localStorage.getItem(DAILY_MIGRATION_KEY)) return;
    const today = gameDateKey();
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (Array.isArray(history)) {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.filter((item) => item?.date !== today)));
    }
    localStorage.setItem(DAILY_MIGRATION_KEY, '1');
  } catch { /* local persistence is optional */ }
}

function setDailyUrl(mode) {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('daily', gameDateKey());
  url.searchParams.set('set', currentSet());
  url.searchParams.set('mode', mode);
  history.replaceState({}, '', `${url.pathname}${url.search}`);
}

function freshGameUrl(mode) {
  return gameShareUrl({
    origin: SHARE_ORIGIN,
    setId: currentSet(),
    mode,
    seed: freshSeed(),
  });
}

function captureFlow(event) {
  const daily = event.target.closest?.('[data-daily-mode]');
  if (daily) setDailyUrl(daily.dataset.dailyMode);

  const another = event.target.closest?.('#another-top3, #another-full');
  if (!another) return;
  const params = new URLSearchParams(window.location.search);
  if (!params.get('daily') || params.get('seed')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const mode = another.id.includes('top3') ? 'top3' : 'full';
  window.location.href = freshGameUrl(mode);
}

export function installFlowFixes() {
  migrateDailyHistory();
  document.addEventListener('click', captureFlow, true);
}
