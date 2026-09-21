import { escapeHtml as esc } from './html.mjs';
import {
  loadMyProfile,
  getAuthSession,
  loadPatreonStatus,
  connectPatreon,
  changeAccountPassword,
  deleteAccount,
  disconnectPatreon,
  signOutAccount,
  loadProfileHistory,
  loadPublicProfile,
  lookupPublicProfiles,
  sendEvents,
  updateProfile,
} from './growth-api.mjs';
import { loadReplayJson } from './replay-data.mjs';
import { onAppRender } from './render-lifecycle.mjs';
import { trackEvent } from './retention-events.mjs';
import { nextMilestones } from './progression.mjs';
import { PATREON_POLICY } from './patreon-policy.mjs';
import { renderAccount } from './growth.mjs';
import {
  bestPercentile,
  environmentProgress,
  formatChallengeRecord,
  modeName,
  recentForm,
  unlockedAchievements,
} from './profile-core.mjs';
import {
  shareAchievementCard,
  shareProfileCard,
  shareResultCard,
} from './share-cards.mjs';

let catalogPromise = null;
let profileRendering = false;
let navInstalled = false;
let routeRendered = false;


function track(name, props = {}) {
  trackEvent(name,props);
}

function ensureProfileStyles() {
  if (document.querySelector('link[data-pack1-profile-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./profile.css?v=3', import.meta.url).href;
  link.dataset.pack1ProfileCss = '1';
  document.head.appendChild(link);
}

async function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = loadReplayJson('./data/catalog.json', 'catalog').catch(() => {catalogPromise=null;return {sets:[]};});
  }
  return catalogPromise;
}

function catalogNames(catalog) {
  return new Map((catalog?.sets || []).map((entry) => [String(entry.id || '').toLowerCase(), String(entry.name || entry.id || '').trim()]));
}

function sparkline(values, { invert = false, empty = 'Play more games to build this chart.' } = {}) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (nums.length < 2) return `<p class="profile-empty">${esc(empty)}</p>`;
  const width = 440;
  const height = 118;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = Math.max(1, max - min);
  const points = nums.map((value, index) => {
    const x = 10 + (index / Math.max(1, nums.length - 1)) * (width - 20);
    let y = 10 + ((value - min) / span) * (height - 20);
    if (!invert) y = height - y;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="profile-sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="Performance trend"><polyline points="${points}" /></svg>`;
}

function environmentCard(entry, favoriteId) {
  const classes = ['environment-progress-card', entry.played ? 'played' : 'unplayed'];
  if (entry.id === favoriteId) classes.push('favorite');
  if (entry.isCube) classes.push('cube');
  const coverageHref=`/sets/#${encodeURIComponent(entry.id)}`;
  return `<article class="${classes.join(' ')}" data-environment-id="${esc(entry.id)}">
    <div><span>${entry.isCube ? 'Special' : entry.played ? 'Played' : 'Unplayed'}</span>${entry.id === favoriteId ? '<b>Favorite</b>' : ''}</div>
    <h3>${esc(entry.name)}</h3>
    ${entry.played
      ? `<p><strong>${entry.games}</strong> games · <strong>${entry.averageScore.toFixed(1)}</strong> avg · <strong>${entry.bestScore}</strong> best</p>`
      : '<p>Ready for your first game.</p>'}
    <a class="text-button" href="${coverageHref}">View set details</a>
  </article>`;
}

function modeCards(profile) {
  const rows = profile.by_mode || [];
  const wanted = ['draft_run'];
  return wanted.map((mode) => {
    const row = rows.find((item) => item.mode === mode) || { games: 0, average_score: 0, best_score: 0 };
    return `<article class="profile-mode-card"><span>${modeName(mode)}</span><strong>${row.games?Number(row.average_score || 0).toFixed(1):'—'}</strong><small>${Number(row.games || 0)} games${row.games?` · ${Number(row.best_score || 0)} best`:''}</small></article>`;
  }).join('');
}

function achievementCard(achievement, { own = false, showcaseId = null } = {}) {
  const progress = Math.max(0, Math.min(100, (Number(achievement.current || 0) / Math.max(1, Number(achievement.target || 1))) * 100));
  return `<article class="achievement-card ${achievement.unlocked ? 'unlocked' : 'locked'} ${achievement.id === showcaseId ? 'showcase' : ''}" data-achievement-id="${esc(achievement.id)}">
    <div class="achievement-top"><span>${achievement.unlocked ? 'Unlocked' : 'In progress'}</span>${achievement.id === showcaseId ? '<b>Showcased</b>' : ''}</div>
    <h3>${esc(achievement.label)}</h3>
    <p>${esc(achievement.description)}</p>
    <div class="achievement-progress"><i style="width:${progress.toFixed(1)}%"></i></div>
    <small>${esc(achievement.progress_text || '')}</small>
    ${achievement.unlocked ? `<div class="achievement-actions">${own ? `<button type="button" class="text-button" data-showcase-achievement="${esc(achievement.id)}">Showcase</button>` : ''}<button type="button" class="text-button" data-share-achievement="${esc(achievement.id)}">Share</button></div>` : ''}
  </article>`;
}

function historyRow(row, names) {
  const setName = row.set_id==='latest'?'Latest Set':names.get(String(row.set_id || '').toLowerCase()) || String(row.set_id || '').toUpperCase();
  const date = row.played_at ? new Date(row.played_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  return `<li data-history-cursor="${esc(row.cursor || '')}"><div><strong>${esc(setName)}</strong><span>${esc(modeName(row.mode, { cube: row.set_id === 'powered-cube' }))}${row.is_daily ? ' · Daily' : ''}${date ? ` · ${esc(date)}` : ''}</span></div><b>${Number(row.score || 0)}</b><em>${esc(row.grade || '')}${row.outcome ? ` · ${esc(row.outcome)}` : ''}</em></li>`;
}

function dailyRow(row, names, index) {
  const setName = row.set_id==='latest'?'Latest Set':names.get(String(row.set_id || '').toLowerCase()) || String(row.set_id || '').toUpperCase();
  const pct = Number(row.percentile);
  return `<li><div><strong>${esc(setName)} · ${esc(modeName(row.mode, { cube: row.set_id === 'powered-cube' }))}</strong><span>${esc(row.date || '')}${row.final===false?' · Still open':''}</span></div><b>${Number(row.score || 0)}</b><em>${pct ? `Top ${pct}%${row.final===false?' so far':''} · #${Number(row.rank || 0)} of ${Number(row.total || 0)}` : `${Number(row.total || 0)} ranked players`}</em><button type="button" class="text-button" data-share-daily="${index}">Share</button></li>`;
}

function settingsMarkup(profile, progress, account, patreon) {
  if (!profile.player.claimed) {
    return `<aside class="profile-claim" id="profile-account"><div><span>Guest record</span><strong>Your progress is yours to keep.</strong><p>Save it across devices whenever you’re ready.</p></div></aside>`;
  }
  const unlocked = unlockedAchievements(profile);
  const elite=patreon?.capabilities?.includes('custom_corpus')&&patreon?.capabilities?.includes('unlimited_cube_practice');
  const supportUrl=esc(patreon?.support_url||PATREON_POLICY.supportUrl);
  return `<section class="profile-settings profile-account" id="profile-account" aria-labelledby="profile-account-title">
    <header><div><p class="eyebrow">Your account</p><h2 id="profile-account-title">Account & profile</h2><p>${account?.unavailable?'Account status is temporarily unavailable. Your career is still here.':account?.user?.email?`Signed in as <strong>${esc(account.user.email)}</strong>`:'Your saved profile and preferences.'}</p></div>${account?.unavailable?'<button type="button" class="button secondary" id="account-status-retry">Retry account</button>':account?.user?'<button type="button" class="button secondary" id="account-signout">Sign out</button>':'<button type="button" class="button secondary" id="profile-claim-account">Sign in</button>'}</header>
    ${account?.user?`<form id="profile-settings-form">
      <label><span>Leaderboard name</span><input class="select" type="text" name="displayName" minlength="2" maxlength="24" autocomplete="nickname" value="${esc(profile.player.display_name)}" required><small>Shown on all Daily leaderboards.</small></label>
      <label class="profile-toggle"><input type="checkbox" name="profilePublic" ${profile.player.profile_public ? 'checked' : ''}><span><strong>Public profile</strong><small>Allows leaderboard visitors and shared links to open your Pack One record.</small></span></label>
      <label><span>Favorite environment</span><select class="select" name="favoriteSetId"><option value="">No favorite selected</option>${progress.environments.map((entry) => `<option value="${esc(entry.id)}" ${entry.id === profile.player.favorite_set_id ? 'selected' : ''}>${esc(entry.name)}</option>`).join('')}</select></label>
      <label><span>Showcase achievement</span><select class="select" name="showcaseAchievement"><option value="">No showcase selected</option>${unlocked.map((item) => `<option value="${esc(item.id)}" ${item.id === profile.player.showcase_achievement ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label>
      <div class="profile-settings-actions"><button class="button primary" type="submit">Save profile</button><span class="profile-settings-status" aria-live="polite"></span></div>
    </form>`:`<p class="profile-empty">${account?.unavailable?'Profile settings are temporarily unavailable.':'Sign in to edit your profile settings.'}</p>`}
    ${account?.user?`<section class="profile-credentials" aria-labelledby="credential-settings-title">
      <div><p class="eyebrow">Security</p><h3 id="credential-settings-title">Sign-in credentials</h3>
        ${account?.credentials?.password
          ? `<p><strong>Change password</strong><br><span>Changing your password signs out every Pack One session, including this device.</span></p>
             <form class="account-form" id="account-password-change">
               <label>Current password<input required type="password" name="currentPassword" maxlength="256" autocomplete="current-password"></label>
               <label>New password<input required type="password" name="newPassword" minlength="8" maxlength="128" autocomplete="new-password"></label>
               <label>Confirm new password<input required type="password" name="confirmPassword" minlength="8" maxlength="128" autocomplete="new-password"></label>
               <button class="button secondary" type="submit">Change password</button>
               <span class="profile-settings-status" aria-live="polite"></span>
             </form>`
          : `<p><strong>Password</strong><br><span>${account?.credentials?.google?'This account signs in with Google and does not have a Pack One password to change.':'This account does not have a password credential to change.'}</span></p>`}
      </div>
    </section>`:''}
    ${account?.user?`<section class="profile-credentials profile-danger" aria-labelledby="delete-account-title">
      <div><p class="eyebrow">Danger zone</p><h3 id="delete-account-title">Delete account</h3>
        <p>Permanently deletes your Pack One account, public profile, leaderboard participation, individual gameplay/career history, and linked Patreon/account associations. You will be signed out on all devices. This cannot be undone.</p>
        <p><small>Deletion usually completes immediately. If identity-provider completion is temporarily unavailable after deletion commits, you will be signed out and server-side recovery finishes the irreversible operation; no further action is required and it cannot be canceled. Short-lived non-identifying security/OAuth verification records may remain until they expire; expired technical verification records are automatically swept afterward. Aggregate, non-attributable statistics may remain.</small></p>
        ${account?.deletion?.googleOnly
          ? `<p><strong>Deletion is temporarily unavailable for Google-only accounts.</strong><br><span>Pack One cannot yet safely perform the required fresh same-account Google verification. This control remains visible and disabled rather than weakening verification.</span></p>
             <button class="button secondary" type="button" disabled>Delete account</button>`
          : account?.deletion?.enabled===false
            ? `<p><strong>Account deletion is temporarily unavailable.</strong></p><button class="button secondary" type="button" disabled>Delete account</button>`
            : `<form class="account-form" id="account-delete">
                 <label>Current password<input required type="password" name="currentPassword" maxlength="256" autocomplete="current-password"></label>
                 <label class="profile-toggle"><input required type="checkbox" name="confirm"><span><strong>I understand this permanently deletes my account and cannot be undone.</strong></span></label>
                 <button class="button secondary" type="submit">Permanently delete account</button>
                 <span class="profile-settings-status" aria-live="polite"></span>
               </form>`}
      </div>
    </section>`:''}
    ${account?.user?`<section class="profile-membership" aria-labelledby="patreon-membership-title">
      <div><p class="eyebrow">Membership</p><h3 id="patreon-membership-title">Patreon</h3>
        ${patreon?.configured!==true
          ? `<p><strong>Membership status unavailable.</strong><br><span>Pack One can’t verify Patreon linking right now. Your current access is unchanged.</span></p>`
          : elite
            ? `<p><strong>Elite active</strong><br><span>Powered Cube practice and custom-set practice are unlocked.</span></p>${patreon?.ad_free?'<p>Ad-free browsing is included while your membership is connected.</p>':''}`
            : patreon?.connected
              ? `<p><strong>Patreon connected</strong><br><span>Elite unlocks Powered Cube practice and custom-set practice. If you just upgraded on Patreon, refresh your access here.</span></p>${patreon?.ad_free?'<p>Your current paid membership includes ad-free browsing.</p>':''}`
              : `<p><strong>Unlock Elite practice.</strong><br><span>Join on Patreon, then connect your Patreon account here so Pack One can activate the benefits.</span></p>`}
      </div>
      ${new URLSearchParams(location.search).has('patreon')?`<p role="status">${esc(({connected:'Patreon connected.',expired:'The connection expired. Please try again.',unavailable:'Patreon linking is not available yet.',error:'Patreon could not be connected. Please try again.'})[new URLSearchParams(location.search).get('patreon')]||'Patreon connection returned.')}</p>`:''}
      <div class="profile-membership-actions">
        <a class="button ${patreon?.configured===true&&!elite?'primary':'secondary'}" href="${supportUrl}" rel="noopener noreferrer">${patreon?.configured!==true?'Open Patreon':elite?'Open Patreon':patreon?.connected?'Upgrade to Elite on Patreon':'Become Elite on Patreon'}</a>
        ${!elite&&patreon?.configured===true?`<button type="button" class="button secondary" id="patreon-connect">${patreon?.connected?'Refresh Patreon access':'Already a member? Connect Patreon'}</button>`:''}
        ${patreon?.connected?'<button type="button" class="text-button" id="patreon-disconnect">Disconnect Patreon</button>':''}
        <span id="patreon-status" aria-live="polite"></span>
      </div>
    </section>`:''}
  </section>`;
}
function profileMarkup(profile, catalog, { own = false, publicKey = null, account = null, patreon = null } = {}) {
  const names = catalogNames(catalog);
  const progress = environmentProgress(catalog, profile.by_set || []);
  const summary = profile.summary || {};
  const favorite = progress.environments.find((entry) => entry.id === profile.player.favorite_set_id);
  const showcased = (profile.achievements || []).find((item) => item.id === profile.player.showcase_achievement && item.unlocked);
  const bestPct = bestPercentile(profile);
  const form = recentForm(profile);
  const showLeaderboardName = own && Boolean(profile.player.claimed);
  const next = nextMilestones(profile,2);
  const bestRows = (profile.best_environments || []).slice(0, 5);
  const daily = (profile.daily_history || []).slice(0, 12);
  const recent = (profile.recent || []).slice(0, 20);
  const publicUrl = profile.player.profile_public && profile.player.profile_key ? `${location.origin}${location.pathname}?profile=${encodeURIComponent(profile.player.profile_key)}` : '';
  const heroActions = own && !profile.player.claimed
    ? '<button type="button" class="button primary" id="profile-claim-account">Sign In</button><button type="button" class="button secondary" id="profile-share">Share my record</button><button type="button" class="button secondary" id="profile-home">Back to game</button>'
    : `<button type="button" class="button primary" id="profile-share">${profile.player.profile_public ? 'Share profile' : 'Share my record'}</button>${own ? '<a class="button secondary" href="#profile-account">Account settings</a><button type="button" class="button secondary" id="profile-home">Back to game</button>' : '<a class="button secondary" href="./">Play Pack One</a>'}`;

  return `<section class="player-profile-page growth-page" data-profile-key="${esc(publicKey || profile.player.profile_key || '')}">
    <header class="profile-hero">
      <div><p class="eyebrow">${own ? 'Account' : 'Player Profile'}</p><h1>${esc(profile.player.display_name)}</h1><p>${own ? 'Your Pack One career, achievements, and account in one place.' : 'A public Pack One career across the Limited archive.'}</p></div>
      <div class="profile-hero-actions">
        ${heroActions}
      </div>
    </header>

    <div class="profile-scoreboard">
      <div><span>Games</span><strong>${Number(summary.games || 0)}</strong></div>
      <div><span>Average</span><strong>${Number(summary.average_score || 0).toFixed(1)}</strong></div>
      <div><span>Best</span><strong>${Number(summary.best_score || 0)}</strong></div>
      <div><span>Daily streak</span><strong>${Number(summary.current_streak || 0)}</strong></div>
      <div><span>Shared runs</span><strong>${esc(formatChallengeRecord(summary))}</strong></div>
      <div><span>Environments</span><strong>${progress.played}/${progress.total}</strong></div>
    </div>

    ${Number(summary.games||0)===0?'<section class="profile-welcome"><h2>Your first eight picks start here.</h2><p>Play a Daily to begin your record.</p><a class="button primary" href="?game=draft-run&daily=1">Play Daily Draft Run</a></section>':''}
    ${own&&next.length?`<section class="profile-next"><h2>Within reach</h2>${next.map(a=>`<div><strong>${esc(a.label)}</strong><span>${esc(a.progress_text)}</span><p>${esc(a.description)}</p><progress value="${Number(a.current)}" max="${Number(a.target)}" aria-label="${esc(a.label)} progress"></progress></div>`).join('')}</section>`:''}

    ${showLeaderboardName || favorite || showcased || bestPct ? `<div class="profile-identity-strip">
      ${showLeaderboardName ? `<div><span>Leaderboard name</span><strong>${esc(profile.player.display_name)}</strong></div>` : ''}
      ${favorite ? `<div><span>Favorite environment</span><strong>${esc(favorite.name)}</strong></div>` : ''}
      ${showcased ? `<div><span>Showcase</span><strong>${esc(showcased.label)}</strong></div>` : ''}
      ${bestPct ? `<div><span>Best Daily finish</span><strong>Top ${bestPct}%</strong></div>` : ''}
      ${form != null ? `<div><span>Last 10 average</span><strong>${form.toFixed(1)}</strong></div>` : ''}
    </div>` : ''}

    ${own ? settingsMarkup(profile, progress, account, patreon) : ''}
    ${publicUrl ? `<p class="profile-public-url">Public profile: <button type="button" class="text-button" id="profile-copy-link">Copy link</button></p>` : ''}

    <section class="profile-section archive-progress-section">
      <div class="profile-section-heading"><div><p class="eyebrow">Archive progress</p><h2>${progress.played}/${progress.total} environments played</h2></div><strong>${progress.total ? Math.round((progress.played / progress.total) * 100) : 0}%</strong></div>
      <div class="archive-progress-track"><i style="width:${progress.total ? (progress.played / progress.total) * 100 : 0}%"></i></div>
      <details class="profile-disclosure" data-profile-section="archive"><summary>Explore the archive</summary><div class="environment-progress-grid">${progress.environments.map((entry) => environmentCard(entry, profile.player.favorite_set_id)).join('')}</div></details>
    </section>

    <section class="profile-grid-two">
      <div class="profile-section"><p class="eyebrow">Best environments</p><h2>Where you draft best</h2>${bestRows.length ? `<ol class="best-environment-list">${bestRows.map((row, index) => `<li><b>#${index + 1}</b><div><strong>${esc(names.get(String(row.set_id || '').toLowerCase()) || String(row.set_id || '').toUpperCase())}</strong><span>${Number(row.games || 0)} games</span></div><em>${Number(row.average_score || 0).toFixed(1)} avg</em></li>`).join('')}</ol>` : '<p class="profile-empty">Play at least three games in an environment to qualify it here.</p>'}</div>
      <div class="profile-section"><p class="eyebrow">Draft Run</p><h2>Your run record</h2><div class="profile-mode-grid">${modeCards(profile)}</div>${profile.cube ? `<div class="cube-profile-callout"><span>Powered Cube</span><strong>${Number(profile.cube.average_score || 0).toFixed(1)} avg</strong><small>${Number(profile.cube.games || 0)} runs · ${Number(profile.cube.best_score || 0)} best</small></div>` : ''}</div>
    </section>

    <section class="profile-grid-two">
      <div class="profile-section"><p class="eyebrow">Recent form</p><h2>Your score trend</h2>${sparkline((profile.trend || []).map((row) => row.score), { empty: 'Complete two games to start a score trend.' })}</div>
      <div class="profile-section"><p class="eyebrow">Ranked history</p><h2>Daily percentile trend</h2>${sparkline((profile.daily_history || []).filter((row) => row.percentile).slice(0, 30).reverse().map((row) => 101 - Number(row.percentile)), { empty: 'A Daily leaderboard needs at least 10 players before percentile is shown.' })}<small class="profile-chart-note">Higher on the line is a stronger final percentile.</small></div>
    </section>

    <section class="profile-section achievements-section"><div class="profile-section-heading"><div><p class="eyebrow">Progression</p><h2>Achievements</h2></div><strong>${unlockedAchievements(profile).length}/${(profile.achievements || []).length}</strong></div><details class="profile-disclosure" data-profile-section="achievements"><summary>View earned achievements and milestones</summary><div class="achievement-grid">${[...(profile.achievements || [])].sort((a,b)=>Number(b.unlocked)-Number(a.unlocked)).map((item) => achievementCard(item, { own:own&&profile.player.claimed, showcaseId: profile.player.showcase_achievement })).join('')}</div></details></section>

    <section class="profile-grid-two">
      <div class="profile-section"><p class="eyebrow">Daily history</p><h2>Your finishes</h2><p class="profile-chart-note">Open boards are provisional. Final percentiles include everyone tied at your score.</p>${daily.length ? `<ol class="profile-daily-list">${daily.map((row, index) => dailyRow(row, names, index)).join('')}</ol>` : '<p class="profile-empty">No ranked Daily history yet.</p>'}</div>
      <div class="profile-section"><p class="eyebrow">Game history</p><h2>Recent games</h2>${recent.length ? `<ol class="profile-history-list" id="profile-history-list">${recent.map((row) => historyRow(row, names)).join('')}</ol><button type="button" class="button secondary" id="profile-load-more" ${recent.length < 20 ? 'hidden' : ''}>Load more</button>` : '<p class="profile-empty">No scored games yet.</p>'}</div>
    </section>
  </section>`;
}

async function bindProfile(profile, catalog, { own = false, publicKey = null } = {}) {
  const progress = environmentProgress(catalog, profile.by_set || []);
  const names = catalogNames(catalog);
  const profileKey = publicKey || profile.player.profile_key || null;

  document.querySelector('#profile-home')?.addEventListener('click', () => { window.location.href = './'; });
  document.querySelector('#account-status-retry')?.addEventListener('click',()=>void renderMyProfile());
  document.querySelector('#account-signout')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;await signOutAccount();track('auth_sign_out');await renderAccount();});
  document.querySelector('#account-password-change')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const form=e.currentTarget,button=form.querySelector('button[type="submit"]'),status=form.querySelector('.profile-settings-status');
    const data=Object.fromEntries(new FormData(form));
    status.textContent='';
    if(data.newPassword!==data.confirmPassword){status.textContent='New passwords do not match.';return;}
    button.disabled=true;
    try {
      await changeAccountPassword({currentPassword:data.currentPassword,newPassword:data.newPassword});
      status.textContent='Password changed. You have been signed out.';
      track('account_password_changed');
      await renderAccount({notice:'Password changed. You have been signed out everywhere.'});
    } catch(error) {
      status.textContent=error?.message||'Password could not be changed.';
      button.disabled=false;
    } finally {
      form.reset();
    }
  });
  document.querySelector('#account-delete')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const form=e.currentTarget,button=form.querySelector('button[type="submit"]'),status=form.querySelector('.profile-settings-status');
    const data=Object.fromEntries(new FormData(form));
    if(data.confirm!=='on'){status.textContent='Confirm that you understand deletion is permanent.';return;}
    button.disabled=true;status.textContent='Deleting account…';
    try {
      const result=await deleteAccount({currentPassword:data.currentPassword});
      track('account_deletion_committed');
      const next=result?.deletion==='complete'?'deleted':'deleting';
      location.assign(`/?account=${next}`);
    } catch(error) {
      status.textContent=error?.message||'Account could not be deleted.';
      button.disabled=false;
    } finally {
      form.reset();
    }
  });
  document.querySelector('#patreon-connect')?.addEventListener('click',async e=>{
    const button=e.currentTarget,status=document.querySelector('#patreon-status');button.disabled=true;if(status)status.textContent='Opening Patreon…';
    try{const result=await connectPatreon();if(!result?.url)throw Error('Patreon did not return a connection URL.');track('patreon_connect_started');location.href=result.url;}
    catch(error){button.disabled=false;if(status)status.textContent=error.message;}
  });
  document.querySelector('#patreon-disconnect')?.addEventListener('click',async e=>{
    const button=e.currentTarget,status=document.querySelector('#patreon-status');button.disabled=true;if(status)status.textContent='Disconnecting…';
    try{await disconnectPatreon();track('patreon_disconnected');await renderMyProfile();}
    catch(error){button.disabled=false;if(status)status.textContent=error.message;}
  });
  document.querySelectorAll('[data-profile-section]').forEach(d=>d.addEventListener('toggle',()=>{if(d.open)track(d.dataset.profileSection==='achievements'?'achievement_viewed':'archive_viewed',{source:'profile'});}));
  document.querySelector('#profile-claim-account')?.addEventListener('click', () => void renderAccount());
  document.querySelector('#profile-copy-link')?.addEventListener('click', async (event) => {
    const url = `${location.origin}${location.pathname}?profile=${encodeURIComponent(profile.player.profile_key)}`;
    try { await navigator.clipboard.writeText(url); event.currentTarget.textContent = 'Copied'; } catch {}
  });
  document.querySelector('#profile-share')?.addEventListener('click', async (event) => {
    await performShare(event.currentTarget,()=>shareProfileCard(profile, progress, names),'profile_share',{public:profile.player.profile_public,environments:progress.played});
  });
  async function performShare(button,makeCard,name,props) {
    const original=button.textContent;button.disabled=true;button.textContent='Making card…';
    let status=document.querySelector('#profile-share-status');
    if(!status){status=document.createElement('p');status.id='profile-share-status';status.setAttribute('role','status');button.parentElement.after(status);}
    status.textContent='';
    try {
      const result=await makeCard();
      if(result?.failed) {
        status.textContent='Copy this link: ';const a=document.createElement('a');
        a.href=profile.player.profile_public?`${location.origin}${location.pathname}?profile=${encodeURIComponent(profile.player.profile_key)}`:`${location.origin}${location.pathname}`;
        a.textContent=a.href;status.append(a);
      } else if(!result?.cancelled) {track(name,{...props,method:result?.method});status.textContent=result?.method==='copy_fallback'?'Link copied.':'';}
    } catch {status.textContent='Couldn’t make the share card. Please try again.';}
    finally {button.disabled=false;button.textContent=original;}
  }

  document.querySelector('#profile-settings-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector('.profile-settings-status');
    const data = new FormData(form);
    status.textContent = 'Saving…';
    try {
      const updated = await updateProfile({
        displayName: data.get('displayName') || '',
        profilePublic: data.get('profilePublic') === 'on',
        favoriteSetId: data.get('favoriteSetId') || null,
        showcaseAchievement: data.get('showcaseAchievement') || null,
      });
      status.textContent = 'Saved';
      track('profile_settings_saved', { public: updated.player?.profile_public || false });
      await renderProfile(updated, { own: true });
    } catch (error) {
      status.textContent = error.message;
    }
  });

  document.querySelectorAll('[data-showcase-achievement]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled=true;
    const id = button.dataset.showcaseAchievement;
    try {
      const updated = await updateProfile({ showcaseAchievement: id });
      track('achievement_showcase', { achievement: id });
      await renderProfile(updated, { own: true });
    } catch {button.textContent='Try showcasing again';}
    finally {button.disabled=false;}
  }));
  document.querySelectorAll('[data-share-achievement]').forEach((button) => button.addEventListener('click', async () => {
    const achievement = (profile.achievements || []).find((item) => item.id === button.dataset.shareAchievement);
    if (!achievement?.unlocked) return;
    await performShare(button,()=>shareAchievementCard(profile, achievement),'achievement_share',{achievement:achievement.id});
  }));
  document.querySelectorAll('[data-share-daily]').forEach((button) => button.addEventListener('click', async () => {
    const row = (profile.daily_history || [])[Number(button.dataset.shareDaily)];
    if (!row) return;
    await performShare(button,()=>shareResultCard(profile, row, names.get(String(row.set_id || '').toLowerCase())),'daily_result_share',{set:row.set_id,mode:row.mode,percentile:row.percentile||undefined});
  }));

  const loadMore = document.querySelector('#profile-load-more');
  if (loadMore) {
    let cursor = (profile.recent || []).slice(0, 20).at(-1)?.cursor || null;
    loadMore.addEventListener('click', async () => {
      if (!cursor) { loadMore.hidden = true; return; }
      loadMore.disabled = true;
      loadMore.textContent = 'Loading…';
      try {
        const page = await loadProfileHistory({ profileKey: own ? null : profileKey, cursor, limit: 25 });
        const list = document.querySelector('#profile-history-list');
        list?.insertAdjacentHTML('beforeend', (page.rows || []).map((row) => historyRow(row, names)).join(''));
        cursor = page.next_cursor || null;
        loadMore.hidden = !cursor;
        track('profile_history_more', { public: !own });
      } catch (error) {
        loadMore.textContent = error.message;
      } finally {
        loadMore.disabled = false;
        if (!loadMore.hidden) loadMore.textContent = 'Load more';
      }
    });
  }
}

async function renderProfile(profile, { own = false, publicKey = null } = {}) {
  if (profileRendering) return;
  profileRendering = true;
  try {
    document.body.classList.remove('is-game');
    ensureProfileStyles();
    const [catalog,account,patreon] = await Promise.all([
      loadCatalog(),
      own?getAuthSession().catch(()=>({unavailable:true})):null,
      own?loadPatreonStatus().catch(()=>null):null,
    ]);
    const app = document.querySelector('#app');
    if (!app) return;
    app.innerHTML = profileMarkup(profile, catalog, { own, publicKey, account, patreon });
    window.PACK1_LAST_PROFILE = profile;
    await bindProfile(profile, catalog, { own, publicKey });
    track('profile_view', { own, public: profile.player?.profile_public || false });
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  } finally {
    profileRendering = false;
  }
}

export async function renderMyProfile() {
  ensureProfileStyles();
  const app = document.querySelector('#app');
  if (app) app.innerHTML = '<section class="message-card"><p class="eyebrow">Account</p><h1>Loading your record…</h1></section>';
  try {
    const profile = await loadMyProfile();
    await renderProfile(profile, { own: true });
  } catch (error) {
    if (app) app.innerHTML = `<section class="message-card"><p class="eyebrow">Account</p><h1>Couldn’t load your record.</h1><p>${esc(error.message)}</p><button class="button primary" id="profile-retry">Try again</button></section>`;
    document.querySelector('#profile-retry')?.addEventListener('click', () => void renderMyProfile());
  }
}

export async function renderPublicProfile(profileKey) {
  ensureProfileStyles();
  const app = document.querySelector('#app');
  if (app) app.innerHTML = '<section class="message-card"><p class="eyebrow">Player Profile</p><h1>Loading Pack One career…</h1></section>';
  try {
    const profile = await loadPublicProfile(profileKey);
    await renderProfile(profile, { own: false, publicKey: profileKey });
  } catch (error) {
    if (app) app.innerHTML = `<section class="message-card"><p class="eyebrow">Player Profile</p><h1>This profile isn’t public.</h1><p>${esc(error.message)}</p><a class="button primary" href="./">Play Pack One</a></section>`;
  }
}

function enhanceNav() {
  const top = document.querySelector('.top-actions');
  if (!top || top.querySelector('#account-nav')) return;
  const button = document.createElement('button');
  button.className = 'top-nav-button';
  button.id = 'account-nav';
  button.type = 'button';
  button.textContent = 'Account';
  button.addEventListener('click', () => { track('account_view'); void renderMyProfile(); });
  top.append(button);
}

async function enhanceLeaderboardProfiles() {
  const table = document.querySelector('.leaderboard-table');
  if (!table || table.dataset.profileLookup) return;
  table.dataset.profileLookup = 'loading';
  const cells = [...table.querySelectorAll('tbody tr td:nth-child(2) strong')];
  const names = cells.map((node) => node.textContent?.trim()).filter(Boolean);
  const profiles = await lookupPublicProfiles(names);
  for (const strong of cells) {
    if (strong.closest('.player-profile-link')) continue;
    const name = strong.textContent?.trim() || '';
    const match = profiles[name.toLowerCase()];
    if (!match?.profile_key) continue;
    const anchor = document.createElement('a');
    anchor.className = 'player-profile-link';
    anchor.href = `./?profile=${encodeURIComponent(match.profile_key)}`;
    anchor.title = `Open ${name}'s Pack One profile`;
    strong.replaceWith(anchor);
    anchor.appendChild(strong);
  }
  table.dataset.profileLookup = 'done';
}

function enhance() {
  enhanceNav();
  void enhanceLeaderboardProfiles();
}

export function installProfileProductLayer() {
  if (navInstalled) return;
  navInstalled = true;
  ensureProfileStyles();
  enhance();
  onAppRender(enhance);

  const params = new URLSearchParams(location.search);
  const profileKey = params.get('profile');
  if (!routeRendered && !params.has('challenge') && /^[a-f0-9]{16}$/.test(profileKey || '')) {
    routeRendered = true;
    queueMicrotask(() => void renderPublicProfile(profileKey));
  }
}
