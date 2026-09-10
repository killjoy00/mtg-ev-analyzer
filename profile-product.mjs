import {
  loadMyProfile,
  loadProfileHistory,
  loadPublicProfile,
  lookupPublicProfiles,
  sendEvents,
  updateProfile,
} from './growth-api.mjs';
import { loadReplayJson } from './replay-data.mjs';
import { onAppRender } from './render-lifecycle.mjs';
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
  shareProgressCard,
  shareResultCard,
} from './share-cards.mjs';

let catalogPromise = null;
let profileRendering = false;
let navInstalled = false;
let routeRendered = false;

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function track(name, props = {}) {
  void sendEvents([{ name, props }]);
}

function ensureProfileStyles() {
  if (document.querySelector('link[data-pack1-profile-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './profile.css';
  link.dataset.pack1ProfileCss = '1';
  document.head.appendChild(link);
}

async function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = loadReplayJson('./data/catalog.json', 'catalog').catch(() => ({ sets: [] }));
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
  return `<article class="${classes.join(' ')}" data-environment-id="${esc(entry.id)}">
    <div><span>${entry.isCube ? 'Special' : entry.played ? 'Played' : 'Unplayed'}</span>${entry.id === favoriteId ? '<b>Favorite</b>' : ''}</div>
    <h3>${esc(entry.name)}</h3>
    ${entry.played
      ? `<p><strong>${entry.games}</strong> games · <strong>${entry.averageScore.toFixed(1)}</strong> avg · <strong>${entry.bestScore}</strong> best</p>`
      : '<p>Open this environment in Set Practice to add it to your archive.</p>'}
  </article>`;
}

function modeCards(profile) {
  const rows = profile.by_mode || [];
  const wanted = ['top3', 'full'];
  return wanted.map((mode) => {
    const row = rows.find((item) => item.mode === mode) || { games: 0, average_score: 0, best_score: 0 };
    return `<article class="profile-mode-card"><span>${modeName(mode)}</span><strong>${Number(row.average_score || 0).toFixed(1)}</strong><small>${Number(row.games || 0)} games · ${Number(row.best_score || 0)} best</small></article>`;
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
  const setName = names.get(String(row.set_id || '').toLowerCase()) || String(row.set_id || '').toUpperCase();
  const date = row.played_at ? new Date(row.played_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  return `<li data-history-cursor="${esc(row.cursor || '')}"><div><strong>${esc(setName)}</strong><span>${esc(modeName(row.mode, { cube: row.set_id === 'powered-cube' }))}${row.is_daily ? ' · Daily' : ''}${date ? ` · ${esc(date)}` : ''}</span></div><b>${Number(row.score || 0)}</b><em>${esc(row.grade || '')}${row.outcome ? ` · ${esc(row.outcome)}` : ''}</em></li>`;
}

function dailyRow(row, names, index) {
  const setName = names.get(String(row.set_id || '').toLowerCase()) || String(row.set_id || '').toUpperCase();
  const pct = Number(row.percentile);
  return `<li><div><strong>${esc(setName)} · ${esc(modeName(row.mode, { cube: row.set_id === 'powered-cube' }))}</strong><span>${esc(row.date || '')}</span></div><b>${Number(row.score || 0)}</b><em>${pct ? `Top ${pct}% · #${Number(row.rank || 0)} of ${Number(row.total || 0)}` : `${Number(row.total || 0)} ranked players`}</em><button type="button" class="text-button" data-share-daily="${index}">Share</button></li>`;
}

function settingsMarkup(profile, progress) {
  if (!profile.player.claimed) {
    return `<aside class="profile-claim"><div><span>Private guest profile</span><strong>Claim an account to publish this profile.</strong><p>Your games already count here. Claiming makes the identity portable and lets you share a stable public profile URL.</p></div><button type="button" class="button primary" id="profile-claim-account">Claim account</button></aside>`;
  }
  const unlocked = unlockedAchievements(profile);
  return `<details class="profile-settings">
    <summary>Profile settings</summary>
    <form id="profile-settings-form">
      <label class="profile-toggle"><input type="checkbox" name="profilePublic" ${profile.player.profile_public ? 'checked' : ''}><span><strong>Public profile</strong><small>Allows leaderboard visitors and shared links to open your Pack One record.</small></span></label>
      <label><span>Favorite environment</span><select class="select" name="favoriteSetId"><option value="">No favorite selected</option>${progress.environments.map((entry) => `<option value="${esc(entry.id)}" ${entry.id === profile.player.favorite_set_id ? 'selected' : ''}>${esc(entry.name)}</option>`).join('')}</select></label>
      <label><span>Showcase achievement</span><select class="select" name="showcaseAchievement"><option value="">No showcase selected</option>${unlocked.map((item) => `<option value="${esc(item.id)}" ${item.id === profile.player.showcase_achievement ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label>
      <div class="profile-settings-actions"><button class="button primary" type="submit">Save profile</button><span class="profile-settings-status" aria-live="polite"></span></div>
    </form>
  </details>`;
}

function profileMarkup(profile, catalog, { own = false, publicKey = null } = {}) {
  const names = catalogNames(catalog);
  const progress = environmentProgress(catalog, profile.by_set || []);
  const summary = profile.summary || {};
  const favorite = progress.environments.find((entry) => entry.id === profile.player.favorite_set_id);
  const showcased = (profile.achievements || []).find((item) => item.id === profile.player.showcase_achievement && item.unlocked);
  const bestPct = bestPercentile(profile);
  const form = recentForm(profile);
  const bestRows = (profile.best_environments || []).slice(0, 5);
  const daily = (profile.daily_history || []).slice(0, 12);
  const recent = (profile.recent || []).slice(0, 20);
  const publicUrl = profile.player.profile_public && profile.player.profile_key ? `${location.origin}${location.pathname}?profile=${encodeURIComponent(profile.player.profile_key)}` : '';

  return `<section class="player-profile-page growth-page" data-profile-key="${esc(publicKey || profile.player.profile_key || '')}">
    <header class="profile-hero">
      <div><p class="eyebrow">${own ? 'My Profile' : 'Player Profile'}</p><h1>${esc(profile.player.display_name)}</h1><p>${own ? 'Your Pack One career across the Limited archive.' : 'A public Pack One career across the Limited archive.'}</p></div>
      <div class="profile-hero-actions">
        <button type="button" class="button primary" id="profile-share" ${profile.player.profile_public ? '' : 'disabled'}>${profile.player.profile_public ? 'Share profile' : 'Publish to share'}</button>
        <button type="button" class="button secondary" id="profile-share-progress">Share ${progress.played}/${progress.total}</button>
        ${own ? '<button type="button" class="button secondary" id="profile-home">Back to game</button>' : '<a class="button secondary" href="./">Play Pack One</a>'}
      </div>
    </header>

    <div class="profile-scoreboard">
      <div><span>Games</span><strong>${Number(summary.games || 0)}</strong></div>
      <div><span>Average</span><strong>${Number(summary.average_score || 0).toFixed(1)}</strong></div>
      <div><span>Best</span><strong>${Number(summary.best_score || 0)}</strong></div>
      <div><span>Daily streak</span><strong>${Number(summary.current_streak || 0)}</strong></div>
      <div><span>Challenges</span><strong>${esc(formatChallengeRecord(summary))}</strong></div>
      <div><span>Environments</span><strong>${progress.played}/${progress.total}</strong></div>
    </div>

    ${favorite || showcased || bestPct ? `<section class="profile-identity-strip">
      ${favorite ? `<div><span>Favorite environment</span><strong>${esc(favorite.name)}</strong></div>` : ''}
      ${showcased ? `<div><span>Showcase</span><strong>${esc(showcased.label)}</strong></div>` : ''}
      ${bestPct ? `<div><span>Best Daily finish</span><strong>Top ${bestPct}%</strong></div>` : ''}
      ${form != null ? `<div><span>Last 10 average</span><strong>${form.toFixed(1)}</strong></div>` : ''}
    </section>` : ''}

    ${own ? settingsMarkup(profile, progress) : ''}
    ${publicUrl ? `<p class="profile-public-url">Public profile: <button type="button" class="text-button" id="profile-copy-link">Copy link</button></p>` : ''}

    <section class="profile-section archive-progress-section">
      <div class="profile-section-heading"><div><p class="eyebrow">Archive progress</p><h2>${progress.played}/${progress.total} environments played</h2></div><strong>${progress.total ? Math.round((progress.played / progress.total) * 100) : 0}%</strong></div>
      <div class="archive-progress-track"><i style="width:${progress.total ? (progress.played / progress.total) * 100 : 0}%"></i></div>
      <div class="environment-progress-grid">${progress.environments.map((entry) => environmentCard(entry, profile.player.favorite_set_id)).join('')}</div>
    </section>

    <section class="profile-grid-two">
      <div class="profile-section"><p class="eyebrow">Best environments</p><h2>Where you draft best</h2>${bestRows.length ? `<ol class="best-environment-list">${bestRows.map((row, index) => `<li><b>#${index + 1}</b><div><strong>${esc(names.get(String(row.set_id || '').toLowerCase()) || String(row.set_id || '').toUpperCase())}</strong><span>${Number(row.games || 0)} games</span></div><em>${Number(row.average_score || 0).toFixed(1)} avg</em></li>`).join('')}</ol>` : '<p class="profile-empty">Play at least three games in an environment to qualify it here.</p>'}</div>
      <div class="profile-section"><p class="eyebrow">Mode split</p><h2>How you play</h2><div class="profile-mode-grid">${modeCards(profile)}</div>${profile.cube ? `<div class="cube-profile-callout"><span>Powered Cube</span><strong>${Number(profile.cube.average_score || 0).toFixed(1)} avg</strong><small>${Number(profile.cube.games || 0)} runs · ${Number(profile.cube.best_score || 0)} best</small></div>` : ''}</div>
    </section>

    <section class="profile-grid-two">
      <div class="profile-section"><p class="eyebrow">Recent form</p><h2>Your score trend</h2>${sparkline((profile.trend || []).map((row) => row.score), { empty: 'Complete two games to start a score trend.' })}</div>
      <div class="profile-section"><p class="eyebrow">Ranked history</p><h2>Daily percentile trend</h2>${sparkline((profile.daily_history || []).filter((row) => row.percentile).slice(0, 30).reverse().map((row) => 101 - Number(row.percentile)), { empty: 'A Daily leaderboard needs at least 10 players before percentile is shown.' })}<small class="profile-chart-note">Higher on the line is a stronger final percentile.</small></div>
    </section>

    <section class="profile-section achievements-section"><div class="profile-section-heading"><div><p class="eyebrow">Progression</p><h2>Achievements</h2></div><strong>${unlockedAchievements(profile).length}/${(profile.achievements || []).length}</strong></div><div class="achievement-grid">${(profile.achievements || []).map((item) => achievementCard(item, { own, showcaseId: profile.player.showcase_achievement })).join('')}</div></section>

    <section class="profile-grid-two">
      <div class="profile-section"><p class="eyebrow">Daily history</p><h2>Final percentiles</h2>${daily.length ? `<ol class="profile-daily-list">${daily.map((row, index) => dailyRow(row, names, index)).join('')}</ol>` : '<p class="profile-empty">No ranked Daily history yet.</p>'}</div>
      <div class="profile-section"><p class="eyebrow">Game history</p><h2>Recent games</h2>${recent.length ? `<ol class="profile-history-list" id="profile-history-list">${recent.map((row) => historyRow(row, names)).join('')}</ol><button type="button" class="button secondary" id="profile-load-more" ${recent.length < 20 ? 'hidden' : ''}>Load more</button>` : '<p class="profile-empty">No scored games yet.</p>'}</div>
    </section>
  </section>`;
}

async function bindProfile(profile, catalog, { own = false, publicKey = null } = {}) {
  const progress = environmentProgress(catalog, profile.by_set || []);
  const names = catalogNames(catalog);
  const profileKey = publicKey || profile.player.profile_key || null;

  document.querySelector('#profile-home')?.addEventListener('click', () => { window.location.href = './'; });
  document.querySelector('#profile-claim-account')?.addEventListener('click', () => document.querySelector('#account-nav')?.click());
  document.querySelector('#profile-copy-link')?.addEventListener('click', async (event) => {
    const url = `${location.origin}${location.pathname}?profile=${encodeURIComponent(profile.player.profile_key)}`;
    try { await navigator.clipboard.writeText(url); event.currentTarget.textContent = 'Copied'; } catch {}
  });
  document.querySelector('#profile-share')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Making card…';
    await shareProfileCard(profile, progress, names);
    track('profile_share', { public: profile.player.profile_public, environments: progress.played });
    button.disabled = false;
    button.textContent = original;
  });
  document.querySelector('#profile-share-progress')?.addEventListener('click', async () => {
    await shareProgressCard(profile, progress);
    track('profile_progress_share', { environments: progress.played, total: progress.total });
  });

  document.querySelector('#profile-settings-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector('.profile-settings-status');
    const data = new FormData(form);
    status.textContent = 'Saving…';
    try {
      const updated = await updateProfile({
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
    const id = button.dataset.showcaseAchievement;
    const updated = await updateProfile({ showcaseAchievement: id });
    track('achievement_showcase', { achievement: id });
    await renderProfile(updated, { own: true });
  }));
  document.querySelectorAll('[data-share-achievement]').forEach((button) => button.addEventListener('click', async () => {
    const achievement = (profile.achievements || []).find((item) => item.id === button.dataset.shareAchievement);
    if (!achievement?.unlocked) return;
    await shareAchievementCard(profile, achievement);
    track('achievement_share', { achievement: achievement.id });
  }));
  document.querySelectorAll('[data-share-daily]').forEach((button) => button.addEventListener('click', async () => {
    const row = (profile.daily_history || [])[Number(button.dataset.shareDaily)];
    if (!row) return;
    await shareResultCard(profile, row, names.get(String(row.set_id || '').toLowerCase()));
    track('daily_result_share', { set: row.set_id, mode: row.mode, percentile: row.percentile || undefined });
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
    ensureProfileStyles();
    const catalog = await loadCatalog();
    const app = document.querySelector('#app');
    if (!app) return;
    app.innerHTML = profileMarkup(profile, catalog, { own, publicKey });
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
  if (app) app.innerHTML = '<section class="message-card"><p class="eyebrow">Profile</p><h1>Loading your record…</h1></section>';
  try {
    const profile = await loadMyProfile();
    await renderProfile(profile, { own: true });
  } catch (error) {
    if (app) app.innerHTML = `<section class="message-card"><p class="eyebrow">Profile</p><h1>Couldn’t load your profile.</h1><p>${esc(error.message)}</p><button class="button primary" id="profile-retry">Try again</button></section>`;
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
  if (!top || top.querySelector('#profile-nav')) return;
  const button = document.createElement('button');
  button.className = 'top-nav-button';
  button.id = 'profile-nav';
  button.type = 'button';
  button.textContent = 'Profile';
  button.addEventListener('click', () => void renderMyProfile());
  const account = top.querySelector('#account-nav');
  top.insertBefore(button, account || top.querySelector('.source-note'));
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
