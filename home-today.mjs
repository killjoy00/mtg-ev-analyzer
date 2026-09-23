import { loadMyProfile } from './growth-api.mjs';
import { todayStatus, gameDateKey } from './today-status.mjs';
import { onAppRender } from './render-lifecycle.mjs';

let installed = false;
let generation = 0;
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

function displayDate(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function gameCard({ label, description, status, playHref, boardHref }) {
  const actionHref = status.complete ? boardHref : playHref;
  const actionLabel = status.complete ? 'View board' : 'Play / continue';
  return `<article class="today-game ${status.complete ? 'complete' : ''}">
    <span class="today-game-state" aria-hidden="true">${status.complete ? '✓' : ''}</span>
    <div class="today-game-name"><span>${label}</span><small>${description}</small></div>
    <div class="today-game-score"><strong>${status.complete ? status.score : '—'}</strong><small>${standing(status)}</small></div>
    <a class="button ${status.complete ? 'secondary' : 'primary'}" href="${actionHref}">${actionLabel}<span aria-hidden="true">›</span></a>
  </article>`;
}

function markup(status) {
  const progress = status.completed * 50;
  const streak = status.streak > 0 ? `${status.streak}-day Daily streak` : 'Start your Daily streak';
  const dailyDate = displayDate(status.dateKey);
  return `<div class="today-status-heading">
      <div><p class="eyebrow">Today</p><h2>Your Daily board</h2><p>Finish Draft Run and Cube. That’s the whole check-in.</p></div>
      <time datetime="${status.dateKey}">${dailyDate}</time>
    </div>
    <div class="today-progress-label"><strong>${status.completed}/2 complete</strong><span>${progress}%</span></div>
    <div class="today-progress" role="progressbar" aria-valuemin="0" aria-valuemax="2" aria-valuenow="${status.completed}" aria-label="${status.completed} of 2 Daily games complete"><i style="width:${progress}%"></i></div>
    <div class="today-games">
      ${gameCard({label:'Draft Run',description:'Eight trophy-draft decisions',status:status.draftRun,playHref:'?game=draft-run&daily=1',boardHref:'?game=draft-run&board=daily'})}
      ${gameCard({label:'Powered Cube',description:'Eight Cube decisions · two pack rerolls',status:status.cube,playHref:'?game=draft-run&set=powered-cube&daily=1',boardHref:'?game=draft-run&set=powered-cube&board=daily'})}
    </div>
    <footer>
      <strong class="today-streak"><span aria-hidden="true">◆</span>${streak}</strong>
      <button class="text-button" type="button" data-today-career>View career <span aria-hidden="true">›</span></button>
    </footer>`;
}

async function hydrate(section) {
  const day=gameDateKey(),version=generation;
  if (section.dataset.todayDate===day && (section.dataset.todayHydrated==='loading'||section.dataset.todayHydrated==='1')) return;
  section.dataset.todayDate=day;
  section.dataset.todayHydrated = 'loading';
  if (!profilePromise) profilePromise = loadMyProfile().catch(() => null);
  const profile = await profilePromise;
  if (!section.isConnected || version!==generation || day!==gameDateKey()) return;
  section.innerHTML = markup(todayStatus(profile,day))+(profile?'':'<p role="status">Daily progress is unavailable. Play / continue still resumes your saved attempt.</p>');
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

function refresh() {
  profilePromise=null;generation++;
  const section=document.querySelector('[data-today-status="1"]');
  if(section)section.dataset.todayHydrated='';
  scan();
}
export function installHomeToday() {
  if(installed)return;installed=true;
  ensureStyles();onAppRender(scan);
  document.addEventListener('pack1:result-completed',refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  window.addEventListener('focus',refresh);
  setInterval(()=>{const section=document.querySelector('[data-today-status="1"]');if(section&&section.dataset.todayDate!==gameDateKey())refresh();},60000);
}
