import { loadDailyStatus } from './growth-api.mjs';
import { todayStatus, easternDateKey } from './today-status.mjs';

let generation = 0;
let installed = false;
let lastDay;
const games = [
  { key: 'draftRun', environment: 'mixed', title: 'Daily Draft Run', description: 'Eight decisions from real trophy drafts.', href: '?game=draft-run&daily=1' },
  { key: 'cube', environment: 'powered-cube', title: 'Daily Powered Cube', description: 'Eight decisions. Magic’s most powerful cards.', href: '?game=draft-run&set=powered-cube&daily=1' },
];

export function dailyHomeMarkup(profile, day = easternDateKey(), unavailable = false) {
  const status = todayStatus(profile, day);
  const capabilities=profile?.capabilities||[];
  const ordered = [...games].sort((a, b) => Number(status[a.key].complete) - Number(status[b.key].complete));
  return `<section class="daily-home" data-daily-home data-completed="${status.completed}">
    <header class="daily-home-heading"><p class="eyebrow">Pack One</p><h1>Eight picks. Your call.</h1><p>Match a trophy drafter. See how your choices compare.</p><time datetime="${day}">${day}</time></header>
    <div class="daily-home-games">${ordered.map(game => {
      const result = status[game.key];
      return `<article class="daily-home-game ${result.complete ? 'is-complete' : 'is-unplayed'}" data-environment="${game.environment}">
        <div><h2>${game.title}</h2><p>${result.complete ? `Complete · <strong>${result.score}/100</strong>` : game.description}</p></div>
        <a class="button ${result.complete ? 'secondary' : 'primary'}" href="${game.href}">${result.complete ? 'View result' : 'Play now'}</a>
      </article>`;
    }).join('')}</div>
    ${status.completed === 2 ? `<section class="daily-home-practice"><h2>Keep drafting.</h2>${profile?.player?.claimed
      ? `<a class="button primary" href="?game=draft-run">Start Another Draft Run</a>${capabilities.includes('unlimited_cube_practice')?'<a class="button secondary" href="?game=draft-run&set=powered-cube">Powered Cube Practice</a>':''}${capabilities.includes('custom_corpus')?'<a class="button secondary" href="?game=draft-run&custom=1">Choose Your Sets</a>':''}`
      : '<p>A free account adds unlimited regular Draft Runs.</p><button class="button primary" data-home-account>Create a free account</button>'}</section>` : ''}
    <p class="daily-home-scoring">100 = you matched the trophy drafter.<br>Other choices receive partial credit based on how strongly the model supports them.</p>
    ${unavailable ? '<p role="status">Daily progress is unavailable. Play now still resumes your saved attempt.</p>' : ''}
  </section>`;
}

export function renderDailyHome(profile = null, unavailable = false) {
  if (!document.querySelector('[data-daily-home-style]')) {
    const link = document.createElement('link'); link.rel = 'stylesheet';
    link.href = './daily-home.css'; link.dataset.dailyHomeStyle = '1'; document.head.append(link);
  }
  lastDay = easternDateKey();
  document.querySelector('#app').innerHTML = dailyHomeMarkup(profile, lastDay, unavailable);
  document.querySelector('[data-home-account]')?.addEventListener('click', async () => (await import('./growth.mjs')).renderAccount());
}

export function installDailyHome(identityReady = Promise.resolve()) {
  if (installed) return; installed = true;
  async function refresh() {
    if (!document.querySelector('[data-daily-home]')) return;
    const version = ++generation, day = easternDateKey();
    await identityReady;
    const profile = await loadDailyStatus().catch(() => null);
    if (version !== generation || day !== easternDateKey() || !document.querySelector('[data-daily-home]')) return;
    renderDailyHome(profile, !profile);
  }
  document.addEventListener('pack1:result-completed', refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  setInterval(() => { if (lastDay !== easternDateKey()) void refresh(); }, 60000);
  void refresh();
}
