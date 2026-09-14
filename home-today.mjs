import { loadMyProfile } from './growth-api.mjs';
import { todayStatus } from './today-status.mjs';

let observer = null;
let profilePromise = null;

function ensureStyles() {
  if (document.querySelector('link[data-home-today-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './home-today.css';
  link.dataset.homeTodayCss = '1';
  document.head.appendChild(link);
}

function standing(status) {
  if (!status.complete) return 'Not finished';
  if (status.rank && status.total) return `#${status.rank} of ${status.total}`;
  if (status.percentile) return `Top ${status.percentile}%`;
  return 'Daily complete';
}

function gameCard({ label, description, status, playHref, boardHref }) {
  return `<article class="today-game ${status.complete ? 'complete' : ''}">
    <div class="today-game-name"><span>${label}</span><small>${description}</small></div>
    <div class="today-game-score"><strong>${status.complete ? status.score : '—'}</strong><small>${standing(status)}</small></div>
    <a class="button ${status.complete ? 'secondary' : 'primary'}" href="${status.complete ? boardHref : playHref}">${status.complete ? 'View board' : 'Play / continue'}</a>
  </article>`;
}

function markup(status) {
  const progress = status.completed * 50;
  const streak = status.streak > 0 ? `${status.streak}-day Daily streak` : 'Start your Daily streak';
  return `<div class="today-status-heading">
      <div><p class="eyebrow">Today</p><h2>Your Daily board</h2><p>Finish Draft Run and Cube. That’s the whole check-in.</p></div>
      <div class="today-complete"><strong>${status.completed}/2</strong><span>complete</span></div>
    </div>
    <div class="today-progress" aria-label="${status.completed} of 2 Daily games complete"><i style="width:${progress}%"></i></div>
    <div class="today-games">
      ${gameCard({label:'Draft Run',description:'Ten trophy-draft decisions',status:status.draftRun,playHref:'?game=draft-run&daily=1',boardHref:'?game=draft-run&board=daily'})}
      ${gameCard({label:'Powered Cube',description:'Ten Cube decisions · two pack rerolls',status:status.cube,playHref:'?game=draft-run&set=powered-cube&daily=1',boardHref:'?game=draft-run&set=powered-cube&board=daily'})}
    </div>
    <footer><strong>${streak}</strong><button class="text-button" type="button" data-today-career>View career</button></footer>`;
}

async function hydrate(section) {
  if (section.dataset.todayHydrated === 'loading' || section.dataset.todayHydrated === '1') return;
  section.dataset.todayHydrated = 'loading';
  if (!profilePromise) profilePromise = loadMyProfile().catch(() => null);
  const profile = await profilePromise;
  if (!section.isConnected) return;
  section.innerHTML = markup(todayStatus(profile));
  section.dataset.todayHydrated = '1';
  section.querySelector('[data-today-career]')?.addEventListener('click', () => document.querySelector('#account-nav')?.click());
}

function scan() {
  const home = document.querySelector('.home-intro');
  if (!home) return;
  const moreModes = new URLSearchParams(location.search).get('modes') === '1';
  let section = document.querySelector('[data-today-status="1"]');
  if (!section) {
    section = document.createElement('section');
    section.className = 'today-status';
    section.dataset.todayStatus = '1';
    const tabs = document.querySelector('[data-home-mode-tabs="1"]');
    (tabs || home).insertAdjacentElement('afterend', section);
  }
  section.hidden = moreModes;
  if (!moreModes) void hydrate(section);
}

export function installHomeToday() {
  ensureStyles();
  scan();
  const root = document.querySelector('#app');
  if (!root || observer) return;
  observer = new MutationObserver(scan);
  observer.observe(root, { childList: true, subtree: true });
}
