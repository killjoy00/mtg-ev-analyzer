import { loadDailyStatus } from './growth-api.mjs';
import { todayStatus, gameDateKey } from './today-status.mjs';
import { dailyResetCue } from './game-date.mjs';

let generation = 0;
let installed = false;
let lastDay;
const games = [
  { key: 'draftRun', number: '01', label: 'The daily challenge', environment: 'mixed', title: 'Daily Draft Run', description: 'Eight decisions from real trophy drafts.', href: '?game=draft-run&daily=1' },
  { key: 'cube', number: '02', label: 'The powered table', environment: 'powered-cube', title: 'Daily Powered Cube', description: 'Eight decisions from Powered Cube trophy drafts.', href: '?game=draft-run&set=powered-cube&daily=1' },
  { key: 'latest', number: '03', label: 'The newest release', environment: 'latest', title: 'Daily Latest Set', description: 'Eight decisions from trophy drafts in the latest set.', href: '?game=draft-run&set=latest&daily=1' },
];

export function dailyHomeMarkup(profile, day = gameDateKey(), unavailable = false) {
  const status = todayStatus(profile, day);
  const dailyDate=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));
  const claimed=Boolean(profile?.player?.claimed);
  const rankingReason=profile?.ranking_identity?.reason;
  const usernameAttention=rankingReason==='username_taken'||rankingReason==='username_required';
  const dailyStreak=Number(profile?.daily_streak||0);
  const nextDailyCue=`${dailyResetCue()}${dailyStreak>=2?` · ${dailyStreak}-day streak`:''}`;
  const ordered = [...games].sort((a, b) => Number(status[a.key].complete) - Number(status[b.key].complete));
  return `<section class="daily-home" data-daily-home data-completed="${status.completed}">
    <header class="daily-home-heading"><p class="eyebrow">The daily draft</p><h1>Eight picks. Your call.</h1><p>Make your pick, then see what the trophy drafter chose and how strong your pick was.</p><time datetime="${day}">${dailyDate}’s Daily Runs</time></header>
    ${usernameAttention?'<aside class="daily-home-identity-warning" role="alert"><div><strong>Choose a unique username before playing a Daily.</strong><p>Your account still needs a unique username. Until you choose one, Daily results will not appear on the leaderboard.</p></div><button class="button secondary" type="button" data-home-username>Change username</button></aside>':''}
    <div class="daily-home-games">${ordered.map(game => {
      const result = status[game.key];
      const startHere=status.completed===0&&game.key==='draftRun'&&!claimed;
      return `<article class="daily-home-game ${result.complete ? 'is-complete' : 'is-unplayed'}${startHere ? ' is-start-here' : ''}" data-environment="${game.environment}">
        <span class="daily-home-number" aria-hidden="true">${game.number}</span>
        <div class="daily-home-game-copy"><p class="daily-home-label">${startHere?'<span class="daily-home-start">Start here</span>':game.label}</p><h2>${game.title}</h2><p>${result.complete ? `Complete · <strong>${result.score}/100</strong>` : game.description}</p></div>
        <div class="daily-home-mark" aria-hidden="true"><span class="p1-card p1-card-back"><span>P<sup>1</sup></span></span><span class="p1-card p1-card-mid"><span>P<sup>1</sup></span></span><span class="p1-card p1-card-front"><span>P<sup>1</sup></span></span></div>
        <div class="daily-home-action"><a class="button ${result.complete ? 'secondary' : 'primary'}" href="${game.href}">${result.complete ? 'View result' : 'Play now'}</a>${startHere?'<small class="daily-home-free">Free · No account required</small>':''}</div>
      </article>`;
    }).join('')}</div>
    ${status.completed === 3 ? `<section class="daily-home-practice${claimed?' is-practice-handoff':''}">${claimed
      ? `<div><p class="eyebrow">Dailies complete</p><h2>Keep drafting.</h2><p>Your practice options are all in one place.</p><p class="daily-home-next-cue">${nextDailyCue}</p></div><a class="button primary" href="/practice/">Go to Practice</a>`
      : `<p class="eyebrow">Dailies complete</p><h2>Keep drafting.</h2><p>A free account adds unlimited regular Draft Runs.</p><p class="daily-home-next-cue">${nextDailyCue}</p><button class="button primary" data-home-account>Create a free account</button>`}</section>` : ''}
    ${unavailable ? '<p role="status">Daily progress is unavailable. Play now still resumes your saved attempt.</p>' : ''}
  </section>`;
}

export function renderDailyHome(profile = null, unavailable = false) {
  if (!document.querySelector('[data-daily-home-style]')) {
    const link = document.createElement('link'); link.rel = 'stylesheet';
    link.href = './daily-home.css?v=8'; link.dataset.dailyHomeStyle = '1'; document.head.append(link);
  }
  lastDay = gameDateKey();
  document.querySelector('#app').innerHTML = dailyHomeMarkup(profile, lastDay, unavailable);
  document.querySelector('[data-home-account]')?.addEventListener('click', async () => (await import('./growth.mjs?v=6')).renderAccount());
  document.querySelector('[data-home-username]')?.addEventListener('click', async () => {
    if(!profile?.player?.claimed){await (await import('./growth.mjs?v=6')).renderAccount({notice:'Choose a unique username to join Daily leaderboards.'});return;}
    const profiles=await import('./profile-product.mjs?v=6');
    await profiles.renderMyProfile();
    document.querySelector('#profile-account-tab')?.click();
    document.querySelector('#profile-account input[name="displayName"]')?.focus();
  });
}

export function installDailyHome(identityReady = Promise.resolve()) {
  if (installed) return; installed = true;
  async function refresh() {
    if (!document.querySelector('[data-daily-home]')) return;
    const version = ++generation, day = gameDateKey();
    await identityReady;
    const profile = await loadDailyStatus().catch(() => null);
    if (version !== generation || day !== gameDateKey() || !document.querySelector('[data-daily-home]')) return;
    renderDailyHome(profile, !profile);
  }
  document.addEventListener('pack1:result-completed', refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  setInterval(() => { if (lastDay !== gameDateKey()) void refresh(); }, 60000);
  void refresh();
}
