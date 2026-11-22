import {bindResultsInvitation} from './results-settings.mjs?v=3';
import {applyStoreBadges} from './store-badges.mjs';
import { loadDailyStatus } from './growth-api.mjs';
import { todayStatus, gameDateKey } from './today-status.mjs';
import { dailyResetCue } from './game-date.mjs';

let generation = 0;
let installed = false;
let lastDay;
const games = [
  { key: 'draftRun', number: '01', label: 'A mix of sets', environment: 'mixed', title: 'Daily Draft Run', description: 'Eight picks from real trophy drafts.', href: '?game=draft-run&daily=1' },
  { key: 'cube', number: '02', label: 'Powered Cube picks', environment: 'powered-cube', title: 'Daily Powered Cube', description: 'Eight picks from Powered Cube trophy drafts.', href: '?game=draft-run&set=powered-cube&daily=1' },
  { key: 'latest', number: '03', label: 'Only the newest set', environment: 'latest', title: 'Daily Latest Set', description: 'Eight picks from trophy drafts in the latest set.', href: '?game=draft-run&set=latest&daily=1' },
];

export function dailyHomeMarkup(profile, day = gameDateKey(), state = 'ready') {
  const checking=state==='checking',unavailable=state==='unavailable',ready=!checking&&!unavailable;
  const status = todayStatus(profile, day);
  const dailyDate=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));
  const claimed=ready&&Boolean(profile?.player?.claimed);
  const rankingReason=ready?profile?.ranking_identity?.reason:null;
  const displayNameAttention=['username_taken','username_required','name_not_allowed'].includes(rankingReason);
  const dailyStreak=ready?Number(profile?.daily_streak||0):0;
  // Reset and streak are post-completion information, not pre-play prompts.
  const showHomeStatus=ready&&claimed&&status.completed===3;
  return `<section class="daily-home${showHomeStatus?' has-home-status':''}" data-daily-home data-home-state="${state}" data-completed="${ready?status.completed:'pending'}">
    <header class="daily-home-heading"><h1>Eight picks. What would you take?</h1><p>These picks come from real trophy drafts.<br>Make your pick. See what the trophy drafter chose.</p><time datetime="${day}">${dailyDate}’s Daily Runs</time></header>
    ${showHomeStatus?`<div class="daily-home-status" role="status" aria-label="Daily reset and streak"><strong data-daily-reset>${dailyResetCue()}</strong>${dailyStreak>0?`<span class="daily-home-streak">${dailyStreak}-day streak</span>`:''}</div>`:''}
    ${displayNameAttention?`<aside class="daily-home-identity-warning" role="alert"><div><strong>${rankingReason==='name_not_allowed'?'That display name is not allowed. Choose another to join Daily leaderboards.':rankingReason==='username_taken'?'Choose a different display name. That one is already taken.':'Choose a display name before playing a Daily.'}</strong><p>Pick a display name that isn’t taken, or your Daily scores won’t show on the leaderboard.</p></div><button class="button secondary" type="button" data-home-username>Change display name</button></aside>`:''}
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
      ? `<div><p class="eyebrow">Dailies complete</p><h2>Want another eight picks?</h2><p>Keep playing regular Draft Runs, or any sets with Pack One Elite.</p></div><a class="button primary" href="/practice/">Go to Practice</a>`
      : `<p class="eyebrow">Dailies complete</p><h2>Want another eight picks?</h2><p>A free account adds unlimited regular Draft Runs.</p><button class="button primary" data-home-account>Create a free account</button>`}</section>` : ''}
    <aside class="daily-home-store-links" aria-label="Pack One mobile apps" data-store-links>
      <span data-store-label>Also on iPhone and Android</span>
      <div class="daily-home-store-badges">
        <a data-store-badge="ios" href="https://apps.apple.com/app/id6814318676" target="_blank" rel="noopener noreferrer" aria-label="Download Pack One on the App Store"><img src="/assets/store-badges/app-store-en-black.svg" alt="Download on the App Store" width="120" height="40" loading="lazy"></a>
        <a data-store-badge="android" href="https://play.google.com/store/apps/details?id=pro.packone.app" target="_blank" rel="noopener noreferrer" aria-label="Get Pack One on Google Play"><img class="google-play-badge" src="/assets/store-badges/google-play-en.png" alt="Get it on Google Play" width="155" height="60" loading="lazy"></a>
      </div>
    </aside>
    ${unavailable ? '<div class="daily-home-unavailable" role="status"><span>Couldn’t load your Daily progress. Play now will still pick up where you left off.</span><button class="text-button" type="button" data-home-retry>Retry</button></div>' : ''}
    <aside data-results-ui data-results-invitation hidden></aside>
  </section>`;
}

export function renderDailyHome(profile = null, state = 'ready') {
  if (!document.querySelector('[data-daily-home-style]')) {
    const link = document.createElement('link'); link.rel = 'stylesheet';
    link.href = './daily-home.css?v=16'; link.dataset.dailyHomeStyle = '1'; document.head.append(link);
  }
  lastDay = gameDateKey();
  document.querySelector('#app').innerHTML = dailyHomeMarkup(profile, lastDay, state);
  applyStoreBadges(document.querySelector('#app'),globalThis.navigator);
  void bindResultsInvitation();
  document.querySelector('[data-home-account]')?.addEventListener('click', async () => (await import('./growth.mjs?v=36')).renderAccount());
  document.querySelector('[data-home-username]')?.addEventListener('click', async () => {
    if(!profile?.player?.claimed){await (await import('./growth.mjs?v=36')).renderAccount({notice:'Choose a display name to join Daily leaderboards.'});return;}
    const profiles=await import('./profile-product.mjs?v=26');
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
