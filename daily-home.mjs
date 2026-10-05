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

export function dailyHomeMarkup(profile, day = gameDateKey(), state = 'ready') {
  const checking=state==='checking',unavailable=state==='unavailable',ready=!checking&&!unavailable;
  const status = todayStatus(profile, day);
  const dailyDate=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));
  const claimed=ready&&Boolean(profile?.player?.claimed);
  const rankingReason=ready?profile?.ranking_identity?.reason:null;
  const displayNameAttention=['username_taken','username_required','name_not_allowed'].includes(rankingReason);
  const dailyStreak=ready?Number(profile?.daily_streak||0):0;
  return `<section class="daily-home" data-daily-home data-home-state="${state}" data-completed="${ready?status.completed:'pending'}">
    <header class="daily-home-heading"><p class="eyebrow">The daily draft</p><h1>Eight picks. Your call.</h1><p>Make your pick, then see what the trophy drafter chose and how strong your pick was.</p><time datetime="${day}">${dailyDate}’s Daily Runs</time></header>
    <div class="daily-home-status" role="status" aria-label="Daily reset and streak"><strong data-daily-reset>${dailyResetCue()}</strong>${ready&&dailyStreak>0?`<span class="daily-home-streak">${dailyStreak}-day streak</span>`:checking?'<span class="daily-home-streak is-loading">Checking streak…</span>':''}</div>
    ${displayNameAttention?`<aside class="daily-home-identity-warning" role="alert"><div><strong>${rankingReason==='name_not_allowed'?'That display name is not allowed. Choose another to join Daily leaderboards.':rankingReason==='username_taken'?'Choose a different display name. That one is already taken.':'Choose a display name before playing a Daily.'}</strong><p>Until you choose an available display name, Daily results will not appear on the leaderboard.</p></div><button class="button secondary" type="button" data-home-username>Change display name</button></aside>`:''}
    <div class="daily-home-games">${games.map(game => {
      const result = status[game.key];
      const complete=ready&&result.complete;
      const startHere=ready&&status.completed===0&&game.key==='draftRun'&&!claimed;
      const stateClass=complete?'is-complete':ready?'is-unplayed':'is-pending';
      return `<article class="daily-home-game ${stateClass}${startHere ? ' is-start-here' : ''}" data-environment="${game.environment}">
        <span class="daily-home-number" aria-hidden="true">${game.number}</span>
        <div class="daily-home-game-copy"><p class="daily-home-label">${startHere?'<span class="daily-home-start">Start here</span>':game.label}</p><h2>${game.title}</h2><p>${complete ? `Complete · <strong>${result.score}/100</strong>` : game.description}</p></div>
        <div class="daily-home-mark" aria-hidden="true"><span class="p1-card p1-card-back"><span>P<sup>1</sup></span></span><span class="p1-card p1-card-mid"><span>P<sup>1</sup></span></span><span class="p1-card p1-card-front"><span>P<sup>1</sup></span></span></div>
        <div class="daily-home-action"><a class="button ${complete ? 'secondary' : 'primary'}" href="${game.href}">${complete ? 'View result' : 'Play now'}</a>${startHere?'<small class="daily-home-free">Free · No account required</small>':''}</div>
      </article>`;
    }).join('')}</div>
    ${ready&&status.completed === 3 ? `<section class="daily-home-practice${claimed?' is-practice-handoff':''}">${claimed
      ? `<div><p class="eyebrow">Dailies complete</p><h2>Keep drafting.</h2><p>Your practice options are all in one place.</p></div><a class="button primary" href="/practice/">Go to Practice</a>`
      : `<p class="eyebrow">Dailies complete</p><h2>Keep drafting.</h2><p>A free account adds unlimited regular Draft Runs.</p><button class="button primary" data-home-account>Create a free account</button>`}</section>` : ''}
    ${unavailable ? '<div class="daily-home-unavailable" role="status"><span>Daily progress is temporarily unavailable. Play now still resumes your saved attempt.</span><button class="text-button" type="button" data-home-retry>Retry</button></div>' : ''}
  </section>`;
}

export function renderDailyHome(profile = null, state = 'ready') {
  if (!document.querySelector('[data-daily-home-style]')) {
    const link = document.createElement('link'); link.rel = 'stylesheet';
    link.href = './daily-home.css?v=9'; link.dataset.dailyHomeStyle = '1'; document.head.append(link);
  }
  lastDay = gameDateKey();
  document.querySelector('#app').innerHTML = dailyHomeMarkup(profile, lastDay, state);
  document.querySelector('[data-home-account]')?.addEventListener('click', async () => (await import('./growth.mjs?v=9')).renderAccount());
  document.querySelector('[data-home-username]')?.addEventListener('click', async () => {
    if(!profile?.player?.claimed){await (await import('./growth.mjs?v=9')).renderAccount({notice:'Choose a display name to join Daily leaderboards.'});return;}
    const profiles=await import('./profile-product.mjs?v=9');
    await profiles.renderMyProfile();
    document.querySelector('#profile-account-tab')?.click();
    document.querySelector('#profile-account input[name="displayName"]')?.focus();
  });
  document.querySelector('[data-home-retry]')?.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('pack1:daily-home-retry')));
}

export function installDailyHome(identityReady = Promise.resolve()) {
  if (installed) return; installed = true;
  async function refresh() {
    if (!document.querySelector('[data-daily-home]')) return;
    const version = ++generation, day = gameDateKey();
    // Start Daily hydration immediately. getAuthSession() and loadDailyStatus()
    // both share ensureMigrations(), so this overlaps their post-migration reads
    // without racing account/player setup.
    const profilePromise=loadDailyStatus().then(
      profile=>({profile,error:null}),
      error=>({profile:null,error}),
    );
    await identityReady;
    const result=await profilePromise;
    const profile=result.profile,state=result.error?'unavailable':'ready';
    if (version !== generation || day !== gameDateKey() || !document.querySelector('[data-daily-home]')) return;
    renderDailyHome(profile, state);
  }
  document.addEventListener('pack1:result-completed', refresh);
  document.addEventListener('pack1:daily-home-retry', refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  setInterval(() => {
    const reset=document.querySelector('[data-daily-reset]');
    if(reset)reset.textContent=dailyResetCue();
    if (lastDay !== gameDateKey()) void refresh();
  }, 60000);
  void refresh();
}
