import { loadDailyStatus } from './growth-api.mjs';
import { todayStatus, easternDateKey } from './today-status.mjs';

let generation = 0;
let installed = false;
let lastDay;
const games = [
  { key: 'draftRun', number: '01', label: 'The daily challenge', environment: 'mixed', title: 'Daily Draft Run', description: 'Eight decisions from real trophy drafts.', href: '?game=draft-run&daily=1' },
  { key: 'cube', number: '02', label: 'The powered table', environment: 'powered-cube', title: 'Daily Powered Cube', description: 'Eight decisions. Magic’s most powerful cards.', href: '?game=draft-run&set=powered-cube&daily=1' },
  { key: 'latest', number: '03', label: 'The newest release', environment: 'latest', title: 'Daily Latest Set', description: 'Eight decisions. Only the latest set.', href: '?game=draft-run&set=latest&daily=1' },
];

export function dailyHomeMarkup(profile, day = easternDateKey(), unavailable = false) {
  const status = todayStatus(profile, day);
  const dailyDate=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));
  const capabilities=profile?.capabilities||[];
  const ordered = [...games].sort((a, b) => Number(status[a.key].complete) - Number(status[b.key].complete));
  return `<section class="daily-home" data-daily-home data-completed="${status.completed}">
    <header class="daily-home-heading"><p class="eyebrow">The daily draft</p><h1>Eight picks. Your call.</h1><p>Match a trophy drafter. See how your choices compare.</p><time datetime="${day}">${dailyDate}’s Daily Runs</time></header>
    <div class="daily-home-games">${ordered.map(game => {
      const result = status[game.key];
      return `<article class="daily-home-game ${result.complete ? 'is-complete' : 'is-unplayed'}" data-environment="${game.environment}">
        <span class="daily-home-number" aria-hidden="true">${game.number}</span><div class="daily-home-game-copy"><p class="daily-home-label">${game.label}</p><h2>${game.title}</h2><p>${result.complete ? `Complete · <strong>${result.score}/100</strong>` : game.description}</p></div>
        <a class="button ${result.complete ? 'secondary' : 'primary'}" href="${game.href}">${result.complete ? 'View result' : 'Play now'}</a>
      </article>`;
    }).join('')}</div>
    ${status.completed === 3 ? `<section class="daily-home-practice"><p class="eyebrow">Dailies complete</p><h2>Keep drafting.</h2>${profile?.player?.claimed
      ? `<a class="button primary" href="?game=draft-run">Start Another Draft Run</a>${capabilities.includes('custom_corpus')
        ? (capabilities.includes('unlimited_cube_practice')?'<a class="button secondary" href="?game=draft-run&set=powered-cube">Powered Cube Practice</a>':'')
        : '<button class="button secondary" data-home-elite>Become Elite</button><p>Elite adds unlimited Powered Cube and custom-set drafts.</p>'}`
      : '<p>A free account adds unlimited regular Draft Runs.</p><button class="button primary" data-home-account>Create a free account</button>'}</section>` : ''}
    ${profile?.player?.claimed && capabilities.includes('custom_corpus')
      ? '<section class="daily-home-custom"><div><p class="eyebrow">Elite practice</p><p>Build a random run from your favorite sets.</p></div><a class="button secondary" href="?game=draft-run&custom=1">Choose your sets</a></section>'
      : '<section class="daily-home-custom"><div><p class="eyebrow">Elite practice</p><p>Draft beyond the Dailies. Unlock unlimited Powered Cube and custom-set drafts.</p></div><button class="button secondary" data-home-elite>Become Elite</button></section>'}
    ${unavailable ? '<p role="status">Daily progress is unavailable. Play now still resumes your saved attempt.</p>' : ''}
  </section>`;
}

export function renderDailyHome(profile = null, unavailable = false) {
  if (!document.querySelector('[data-daily-home-style]')) {
    const link = document.createElement('link'); link.rel = 'stylesheet';
    link.href = './daily-home.css?v=2'; link.dataset.dailyHomeStyle = '1'; document.head.append(link);
  }
  lastDay = easternDateKey();
  document.querySelector('#app').innerHTML = dailyHomeMarkup(profile, lastDay, unavailable);
  document.querySelector('[data-home-account]')?.addEventListener('click', async () => (await import('./growth.mjs')).renderAccount());
  document.querySelectorAll('[data-home-elite]').forEach(button => button.addEventListener('click', async () => (await import('./growth.mjs')).beginEliteUpgrade({source:'home'})));
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
