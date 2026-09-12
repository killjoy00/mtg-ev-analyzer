import { gradePick, gradeTopThree, rankCandidates, summarizeResults } from './scoring.mjs';
import { challengeIndex, computeStreak, unlockedMilestones, utcDateKey } from './engagement.mjs';
import { isLeaderboardConfigured, loadLeaderboard, submitLeaderboardScore, updateLeaderboardDisplayName } from './leaderboard.mjs';
import { loadReplayJson } from './replay-data.mjs';
import { tcgplayerUrl } from './tcgplayer.mjs';
import { conditionCandidatesForPath, pathHasDiverged } from './path-model.mjs';

const app = document.querySelector('#app');
const brandHome = document.querySelector('#brand-home');
const dailyNav = document.querySelector('#daily-nav');
const leaderboardNav = document.querySelector('#leaderboard-nav');
const SHARE_URL = 'https://packone.pro/';
const HISTORY_KEY = 'pack1-daily-history-v1';
const NAME_KEY = 'pack1-player-name-v1';

const state = {
  catalog: null,
  selectedSetId: null,
  setData: null,
  replay: null,
  pathModel: null,
  mode: null,
  packPicks: [],
  pickIndex: 0,
  selectedCardId: null,
  topThreeIds: [],
  revealed: false,
  results: [],
  quickResult: null,
  scoreMeta: null,
  isDailyChallenge: false,
  challengeDate: null,
  challengeRanked: false,
  challengeSubmitStatus: null,
  challengeRank: null,
};

brandHome?.addEventListener('click', goHome);
dailyNav?.addEventListener('click', () => {
  if (!state.catalog?.sets?.length) return;
  renderHome();
  document.querySelector('#daily-challenge')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
leaderboardNav?.addEventListener('click', () => renderLeaderboards());

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function pct(value, digits = 0) {
  return `${(Number(value || 0) * 100).toFixed(digits)}%`;
}

function goHome() {
  if (window.location.search) window.history.replaceState({}, '', window.location.pathname);
  renderHome();
}

function resetSession() {
  state.setData = null;
  state.replay = null;
  state.pathModel = null;
  state.mode = null;
  state.packPicks = [];
  state.pickIndex = 0;
  state.selectedCardId = null;
  state.topThreeIds = [];
  state.revealed = false;
  state.results = [];
  state.quickResult = null;
  state.scoreMeta = null;
  state.isDailyChallenge = false;
  state.challengeDate = null;
  state.challengeRanked = false;
  state.challengeSubmitStatus = null;
  state.challengeRank = null;
}

async function loadJson(path, label = 'data') {
  return loadReplayJson(path, label);
}

async function loadCatalog() {
  return loadJson('./data/catalog.json', 'catalog');
}

async function loadSet(setEntry) {
  const path = setEntry.manifest_path || setEntry.data_path;
  if (!path) throw new Error(`${setEntry.name} has no data path.`);
  return loadJson(path, setEntry.name);
}

const pathModelCache = new Map();

async function loadPathModel(setEntry) {
  const setId = String(setEntry?.id || '').toLowerCase();
  if (!setId) return null;
  if (pathModelCache.has(setId)) return pathModelCache.get(setId);
  const path = setEntry.path_model_path || `./data/${setId}/path-model.json`;
  try {
    const model = await loadJson(path, `${setEntry.name} path model`);
    if (model?.model_version !== 'strong-player-counterfactual-path-v3') {
      throw new Error(`Unsupported path model for ${setEntry.name}.`);
    }
    pathModelCache.set(setId, model);
    return model;
  } catch (error) {
    pathModelCache.delete(setId);
    console.error('Counterfactual path model unavailable.', error);
    throw new Error(`Path-aware Full Pack data for ${setEntry.name} is unavailable. Try again shortly.`);
  }
}

function chooseWeightedShard(shards) {
  const valid = (shards || []).filter((shard) => Number(shard.replay_count) > 0 && shard.path);
  const total = valid.reduce((sum, shard) => sum + Number(shard.replay_count), 0);
  if (!total) return null;
  let ticket = Math.floor(Math.random() * total);
  for (const shard of valid) {
    ticket -= Number(shard.replay_count);
    if (ticket < 0) return shard;
  }
  return valid[valid.length - 1];
}

async function loadRandomReplay(setEntry) {
  const setData = await loadSet(setEntry);
  if (Array.isArray(setData.shards) && setData.shards.length) {
    const shardMeta = chooseWeightedShard(setData.shards);
    if (!shardMeta) throw new Error('This set has no replay shards.');
    const shard = await loadJson(shardMeta.path, `${setEntry.name} replay shard`);
    if (!shard.replays?.length) throw new Error('The selected replay shard is empty.');
    return { setData, replay: shard.replays[Math.floor(Math.random() * shard.replays.length)] };
  }
  if (!setData.replays?.length) throw new Error('This set has no replay drafts.');
  return { setData, replay: setData.replays[Math.floor(Math.random() * setData.replays.length)] };
}

async function loadChallengeReplay(setEntry, dateKey, mode) {
  const setData = await loadSet(setEntry);
  const replayCount = Number(setData.replay_count || setEntry.replay_count || 0);
  if (Array.isArray(setData.shards) && setData.shards.length) {
    const total = setData.shards.reduce((sum, shard) => sum + Number(shard.replay_count || 0), 0);
    if (!total) throw new Error('This set has no replay shards.');
    let replayIndex = challengeIndex(dateKey, setEntry.id, mode, total);
    for (const shardMeta of setData.shards) {
      const count = Number(shardMeta.replay_count || 0);
      if (replayIndex < count) {
        const shard = await loadJson(shardMeta.path, `${setEntry.name} Daily Challenge`);
        if (!shard.replays?.[replayIndex]) throw new Error('Daily Challenge replay is unavailable.');
        return { setData, replay: shard.replays[replayIndex] };
      }
      replayIndex -= count;
    }
  }
  if (!setData.replays?.length) throw new Error('This set has no replay drafts.');
  const index = challengeIndex(dateKey, setEntry.id, mode, replayCount || setData.replays.length);
  return { setData, replay: setData.replays[index % setData.replays.length] };
}

function firstPackPicks(replay) {
  const picks = replay?.picks || [];
  if (!picks.length) return [];
  const packNumbers = picks.map((pick) => Number(pick.pack_number)).filter(Number.isFinite);
  const firstPackNumber = packNumbers.length ? Math.min(...packNumbers) : picks[0].pack_number;
  return picks
    .filter((pick) => Number(pick.pack_number) === Number(firstPackNumber))
    .sort((a, b) => Number(a.pick_number) - Number(b.pick_number));
}

function renderError(error) {
  app.innerHTML = `
    <section class="message-card">
      <p class="eyebrow">Something went wrong</p>
      <h1>We couldn't open this pack.</h1>
      <p class="lede">${esc(error.message)}</p>
      <div class="button-row"><button class="button secondary" id="retry">Try again</button></div>
    </section>`;
  document.querySelector('#retry')?.addEventListener('click', init);
}

function selectedSetEntry() {
  return state.catalog.sets.find((set) => set.id === state.selectedSetId) || state.catalog.sets[0];
}

function setMetaLine(entry) {
  const replays = Number(entry.replay_count || 0).toLocaleString();
  const cutoff = entry.win_rate_cutoff ? ` · ${pct(entry.win_rate_cutoff, 0)}+ WR bucket` : '';
  return `${replays} replay drafts${cutoff} · ${esc(entry.data_date || '')}`;
}

function bestKey(mode) {
  const scoringVersion = mode === 'full' ? 'path-v3' : 'classic';
  return `pack1-best:${scoringVersion}:${state.selectedSetId}:${mode}`;
}

function getBestScore(mode) {
  try {
    const value = window.localStorage.getItem(bestKey(mode));
    return value === null ? null : Number(value);
  } catch {
    return null;
  }
}

// A first game has nothing to beat, and celebrating a weak score reads as
// mockery. Only call it a personal best once there is a real score to improve
// on and the new one is worth showing off.
const BEST_CELEBRATION_FLOOR = 75;

function recordBestScore(mode, score) {
  const previous = getBestScore(mode);
  const best = previous === null ? score : Math.max(previous, score);
  try { window.localStorage.setItem(bestKey(mode), String(best)); } catch { /* optional */ }
  const improved = previous === null || score > previous;
  return {
    best,
    previous,
    improved,
    isNewBest: improved && previous !== null && score >= BEST_CELEBRATION_FLOOR,
  };
}

function bestChip(mode) {
  const best = getBestScore(mode);
  return best === null ? '' : `<span class="best-chip">Personal best <strong>${best}</strong></span>`;
}

function readChallengeHistory() {
  try {
    const value = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeChallengeHistory(history) {
  try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-500))); } catch { /* optional */ }
}

function challengeRecord(date, setId, mode) {
  return readChallengeHistory().find((item) => item.date === date && item.setId === setId && item.mode === mode) || null;
}

function recordChallengeCompletion({ date, setId, mode, score, grade }) {
  const history = readChallengeHistory();
  const existing = history.find((item) => item.date === date && item.setId === setId && item.mode === mode);
  if (existing) return existing;
  const entry = { date, setId, mode, score, grade, completedAt: new Date().toISOString() };
  history.push(entry);
  writeChallengeHistory(history);
  return entry;
}

function challengeStats() {
  const history = readChallengeHistory();
  const dates = [...new Set(history.map((item) => item.date))];
  const streak = computeStreak(dates, utcDateKey());
  const bestScore = history.reduce((best, item) => Math.max(best, Number(item.score || 0)), 0);
  return { history, streak, bestScore, milestones: unlockedMilestones({ completedRuns: history, streak, bestScore }) };
}

function randomPlayerName() {
  const first = ['Copper', 'Quiet', 'Clever', 'Mossy', 'Bright', 'Swift', 'Lucky', 'Patient', 'Bold', 'Wandering'];
  const second = ['Fox', 'Owl', 'Drake', 'Badger', 'Heron', 'Moth', 'Raven', 'Stag', 'Otter', 'Lynx'];
  return `${first[Math.floor(Math.random() * first.length)]} ${second[Math.floor(Math.random() * second.length)]} ${Math.floor(10 + Math.random() * 90)}`;
}

function getDisplayName() {
  try {
    const saved = window.localStorage.getItem(NAME_KEY);
    if (saved) return saved;
    const generated = randomPlayerName();
    window.localStorage.setItem(NAME_KEY, generated);
    return generated;
  } catch {
    return 'Pack Player';
  }
}

function saveDisplayName(value) {
  const cleaned = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  if (cleaned.length < 2) throw new Error('Use at least 2 characters.');
  try { window.localStorage.setItem(NAME_KEY, cleaned); } catch { /* optional */ }
  return cleaned;
}

function scoreTone(score) {
  if (score >= 85) return 'score-high';
  if (score >= 70) return 'score-mid';
  return 'score-low';
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function reportShareCompleted(method, url, context = 'score') {
  let challenge = false;
  try {
    const parsed = new URL(url, SHARE_URL);
    challenge = parsed.searchParams.has('seed') || parsed.searchParams.has('daily');
  } catch { /* analytics is optional */ }
  document.dispatchEvent(new CustomEvent('pack1:share-completed', { detail: { method, context, challenge } }));
}

async function shareScore(button, text, url = SHARE_URL) {
  const original = button.textContent;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Pack One', text, url });
      reportShareCompleted('native', url);
      return;
    }
    await copyText(`${text}\n${url}`);
    reportShareCompleted('copy_fallback', url);
    button.textContent = 'Copied!';
    setTimeout(() => { button.textContent = original; }, 1600);
  } catch (error) {
    if (error?.name !== 'AbortError') {
      try {
        await copyText(`${text}\n${url}`);
        reportShareCompleted('copy_fallback', url);
        button.textContent = 'Copied!';
        setTimeout(() => { button.textContent = original; }, 1600);
      } catch { /* sharing is optional */ }
    }
  }
}

function challengeShareUrl(mode) {
  const url = new URL(SHARE_URL);
  url.searchParams.set('daily', state.challengeDate || utcDateKey());
  url.searchParams.set('set', state.selectedSetId);
  url.searchParams.set('mode', mode);
  return url.toString();
}

function dailyModeStatus(mode, setId = state.selectedSetId) {
  const record = challengeRecord(utcDateKey(), setId, mode);
  if (!record) return 'Not played';
  return `${record.score}/100 · ${record.grade}`;
}

function milestoneMarkup() {
  const { milestones } = challengeStats();
  if (!milestones.length) return '';
  return `<div class="milestone-row" aria-label="Unlocked milestones">${milestones.slice(-4).map((item) => `<span class="milestone-chip">${esc(item.label)}</span>`).join('')}</div>`;
}

function renderHome() {
  resetSession();
  const sets = state.catalog?.sets || [];
  if (!sets.length) {
    app.innerHTML = '<section class="message-card"><h1>No sets are ready yet.</h1></section>';
    return;
  }

  state.selectedSetId ||= sets[0].id;
  const active = selectedSetEntry();
  const { streak, history } = challengeStats();
  const todayRuns = history.filter((item) => item.date === utcDateKey()).length;

  app.innerHTML = `
    <section class="home-intro">
      <p class="eyebrow">LIMITED DRAFT GAME</p>
      <h1>Pack One</h1>
      <p class="lede">One real opening pack. Make your picks, see how you line up with strong-player consensus, then put the same pack in front of a friend.</p>
    </section>

    <section class="set-bar" aria-label="Set selection">
      <div>
        <label class="field-label" for="set-select">Set</label>
        <select class="select" id="set-select">
          ${sets.map((set) => `<option value="${esc(set.id)}" ${set.id === active.id ? 'selected' : ''}>${esc(set.name)}</option>`).join('')}
        </select>
      </div>
      <p class="set-meta" id="set-meta">${setMetaLine(active)}</p>
    </section>

    <section class="daily-card daily-feature" id="daily-challenge">
      <div class="daily-copy">
        <div class="daily-kicker"><span class="live-dot"></span><span>Daily Challenge</span><span class="streak-chip">${streak ? `${streak}-day streak` : 'Start a streak'}</span></div>
        <h2>Today’s opening pack</h2>
        <p>Everyone gets the same draft seat. Top 3 is the fastest way in; your first score is the one that reaches today’s board.</p>
        ${milestoneMarkup()}
      </div>
      <div class="daily-actions">
        <button class="button primary daily-mode daily-main" data-daily-mode="top3"><span>Play today’s Top 3</span><strong>${esc(dailyModeStatus('top3', active.id))}</strong></button>
        <button class="button secondary daily-mode daily-secondary" data-daily-mode="full"><span>Play the full pack</span><strong>${esc(dailyModeStatus('full', active.id))}</strong></button>
        <button class="text-button daily-leader-link" id="daily-leaders">See today’s leaderboard</button>
        <small>${todayRuns ? `${todayRuns} challenge ${todayRuns === 1 ? 'run' : 'runs'} completed today` : 'Nothing on the board yet today'}</small>
      </div>
    </section>

    <section class="mode-section" aria-labelledby="more-pack-one">
      <div class="mode-section-heading">
        <div><p class="eyebrow">More Pack One</p><h2 id="more-pack-one">Play another pack</h2></div>
        <p>Unlimited practice. These scores stay personal; Daily Challenge is the ranked game.</p>
      </div>
      <div class="mode-grid" aria-label="Choose a practice mode">
        <article class="mode-card game-mode-row">
          <div class="mode-topline"><p class="eyebrow">Opening pack</p>${bestChip('top3')}</div>
          <h3>Top 3</h3>
          <p>Rank your three best starts from a fresh opening pack.</p>
          <button class="button secondary mode-button" data-mode="top3">New Top 3</button>
        </article>
        <article class="mode-card game-mode-row">
          <div class="mode-topline"><p class="eyebrow">Full first pack</p>${bestChip('full')}</div>
          <h3>Full Pack</h3>
          <p>Make every pick in Pack One. Later choices adapt to the cards you actually took.</p>
          <button class="button secondary mode-button" data-mode="full">New Full Pack</button>
        </article>
      </div>
    </section>

    <section class="data-note">
      <strong>What “consensus” means</strong>
      <span>Consensus is a model of experienced, high-win-rate 17Lands drafters. Opening-pack support starts from the current pack; in Full Pack, later support also follows the cards you actually chose. Your score measures how closely your choices track that model; only Daily Challenge scores rank.</span>
    </section>`;

  document.querySelector('#set-select').addEventListener('change', (event) => {
    state.selectedSetId = event.target.value;
    renderHome();
  });
  document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => startMode(button.dataset.mode)));
  document.querySelectorAll('[data-daily-mode]').forEach((button) => button.addEventListener('click', () => startMode(button.dataset.dailyMode, { daily: true })));
  document.querySelector('#daily-leaders')?.addEventListener('click', () => renderLeaderboards({ setId: active.id }));
}

async function startMode(mode, options = {}) {
  const entry = selectedSetEntry();
  document.querySelectorAll('.mode-button, .daily-mode').forEach((button) => { button.disabled = true; });
  try {
    const daily = Boolean(options.daily);
    const date = options.date || utcDateKey();
    const [loaded, pathModel] = await Promise.all([
      daily ? loadChallengeReplay(entry, date, mode) : loadRandomReplay(entry),
      mode === 'full' ? loadPathModel(entry) : Promise.resolve(null),
    ]);
    const packPicks = firstPackPicks(loaded.replay);
    if (!packPicks.length) throw new Error('This replay does not contain a first pack.');
    state.setData = loaded.setData;
    state.replay = loaded.replay;
    state.pathModel = pathModel;
    state.mode = mode;
    state.packPicks = packPicks;
    state.pickIndex = 0;
    state.selectedCardId = null;
    state.topThreeIds = [];
    state.revealed = false;
    state.results = [];
    state.quickResult = null;
    state.scoreMeta = null;
    state.isDailyChallenge = daily;
    state.challengeDate = daily ? date : null;
    state.challengeRanked = daily && date === utcDateKey() && !challengeRecord(date, entry.id, mode);
    state.challengeSubmitStatus = null;
    state.challengeRank = null;
    if (mode === 'top3') {
      restoreTopThreeReveal();
      renderTopThree();
    } else renderFullPack();
  } catch (error) {
    renderError(error);
  }
}

// The reveal is a distinct step, so it gets its own history entry: Back returns
// to the player's picks instead of leaving the site, and a reload on the reveal
// URL restores the score instead of resetting the pack.
function revealStorageKey() {
  const url = new URL(window.location.href);
  url.searchParams.delete('reveal');
  return `pack1-reveal:${url.pathname}${url.search}`;
}

function isRevealUrl() {
  return new URLSearchParams(window.location.search).get('reveal') === '1';
}

function pushRevealState(selectedIds) {
  try {
    window.sessionStorage.setItem(revealStorageKey(), JSON.stringify(selectedIds));
  } catch { /* optional */ }
  if (isRevealUrl()) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('reveal', '1');
    window.history.pushState({ packOneReveal: true }, '', url);
  } catch { /* optional */ }
}

function restoreTopThreeReveal() {
  if (!isRevealUrl()) return;
  let stored = null;
  try { stored = JSON.parse(window.sessionStorage.getItem(revealStorageKey()) || 'null'); } catch { /* optional */ }
  if (!Array.isArray(stored) || stored.length !== 3) return;
  const pick = openingPick();
  const available = new Set((pick?.candidates || []).map((card) => card.id));
  if (!stored.every((id) => available.has(id))) return;
  state.topThreeIds = [...stored];
  state.quickResult = gradeTopThree(pick.candidates, state.topThreeIds, pick.historical_pick_id);
  state.scoreMeta = recordBestScore('top3', state.quickResult.score);
  state.revealed = true;
}

function handleRevealPopState() {
  if (state.mode !== 'top3' || !state.packPicks.length) return;
  if (isRevealUrl()) {
    if (state.revealed) return;
    restoreTopThreeReveal();
    if (state.revealed) renderTopThree();
    return;
  }
  if (!state.revealed) return;
  state.revealed = false;
  state.quickResult = null;
  state.scoreMeta = null;
  renderTopThree();
}

function rankedInfo(pick, cardId) {
  const ranked = rankCandidates(pick.candidates);
  return { rank: ranked.findIndex((card) => card.id === cardId) + 1, ranked };
}

function renderCard(card, pick, context = {}) {
  const { mode = 'full', reveal = false } = context;
  const fullSelected = mode === 'full' && state.selectedCardId === card.id;
  const userRank = mode === 'top3' ? state.topThreeIds.indexOf(card.id) + 1 : 0;
  const { rank: consensusRank } = rankedInfo(pick, card.id);
  const isConsensus = reveal && consensusRank <= (mode === 'top3' ? 3 : 1);
  const isHistorical = reveal && card.id === pick.historical_pick_id;
  const classes = ['card-choice', fullSelected ? 'selected' : '', userRank ? 'ranked-choice' : '', isConsensus ? 'consensus' : ''].filter(Boolean).join(' ');
  const chosen = fullSelected || userRank > 0;
  // The tile is a toggle: clicking a chosen card removes it. Say so in the
  // caption and in ARIA so the state is not carried by the badge alone.
  const action = userRank
    ? `Ranked #${userRank} · choose again to remove`
    : fullSelected
      ? 'Selected · choose again to remove'
      : 'Choose this card';

  return `
    <button class="${classes}" type="button" data-card-id="${esc(card.id)}"${reveal ? ' disabled' : ` aria-pressed="${chosen}"`}>
      <div class="card-image-wrap">
        <div class="card-art-placeholder" aria-hidden="true">${esc(card.name)}</div>
        ${card.image_url ? `<img class="card-image" src="${esc(card.image_url)}" alt="" loading="lazy" />` : ''}
        ${userRank ? `<span class="user-rank-badge" aria-hidden="true">${userRank}</span>` : ''}
        ${reveal && consensusRank <= 3 ? `<span class="consensus-badge" aria-hidden="true">C${consensusRank}</span>` : ''}
      </div>
      <div class="card-footer">
        <strong>${esc(card.name)}</strong>
        ${reveal ? `<span>${pct(card.model_probability, 1)} · consensus #${consensusRank}${isHistorical ? ' · drafter pick' : ''}</span>` : `<span>${action}</span>`}
      </div>
    </button>`;
}

// Cards are visual objects; a reveal that only lists names loses the thing the
// player was actually reading. The name is already beside it, so the art is
// decorative to assistive tech.
function rankThumb(card) {
  return card?.image_url
    ? `<img class="rank-thumb" src="${esc(card.image_url)}" alt="" loading="lazy" />`
    : '<span class="rank-thumb rank-thumb-blank" aria-hidden="true"></span>';
}

function attachCardImageFallbacks() {
  document.querySelectorAll('.card-image').forEach((image) => image.addEventListener('error', () => image.remove(), { once: true }));
  // Reveal rows are a fixed grid: a thumbnail that fails leaves its slot empty
  // rather than disappearing, so the rows stay aligned.
  document.querySelectorAll('img.rank-thumb').forEach((image) => image.addEventListener('error', () => {
    image.replaceWith(Object.assign(document.createElement('span'), { className: 'rank-thumb rank-thumb-blank' }));
  }, { once: true }));
}

function openingPick() {
  return state.packPicks[0];
}

function topThreeResultCopy(result) {
  if (result.score === 100) return 'Perfect pack.';
  if (result.overlap === 3) return 'You found the cards.';
  if (result.overlap === 2) return 'Strong read.';
  if (result.overlap === 1) return 'One big hit.';
  return 'Run this one back.';
}

function topThreeShareText(result) {
  const prefix = state.isDailyChallenge ? 'Pack 1 Daily · Top 3' : 'Pack 1 · Top 3';
  const challenge = state.isDailyChallenge ? '\nSame pack for everyone. Beat my score.' : '\nCan you beat it?';
  return `${prefix} · ${state.setData.name}\n${result.score}/100 (${result.grade}) · ${result.overlap}/3 consensus cards · ${result.exactPositions} exact positions${challenge}`;
}

function renderScoreHero(score, grade, label, meta) {
  return `
    <div class="score-hero ${scoreTone(score)}">
      <div class="score-orb"><strong>${score}</strong><span>/100</span></div>
      <div class="score-copy">
        <div class="grade-row"><span class="grade-badge">${esc(grade)}</span>${meta?.isNewBest ? '<span class="new-best">New personal best</span>' : ''}</div>
        <h2>${esc(label)}</h2>
        ${meta && !meta.isNewBest && meta.previous !== null ? `<p>Personal best: <strong>${meta.best}</strong></p>` : ''}
        <p class="score-context">Consensus alignment score — not win probability or an objective card grade.</p>
      </div>
    </div>`;
}

function dailySubmissionMarkup() {
  if (!state.isDailyChallenge) return '';
  const existing = challengeRecord(state.challengeDate, state.selectedSetId, state.mode);
  if (!state.challengeRanked && existing) return `<div class="challenge-status practice">Replay. Today's ranked score is already locked at <strong>${existing.score}/100</strong>.</div>`;
  if (state.challengeDate !== utcDateKey()) return '<div class="challenge-status practice">Shared challenge replay. Only today’s challenge can enter the live board.</div>';
  if (state.challengeSubmitStatus === 'saved') return `<div class="challenge-status saved">On the board${state.challengeRank ? ` · <strong>#${state.challengeRank} today</strong>` : ''}.</div>`;
  if (state.challengeSubmitStatus === 'local') return '<div class="challenge-status practice">Ranked score saved on this device. Global sync is not configured yet.</div>';
  if (state.challengeSubmitStatus === 'error') return '<div class="challenge-status practice">Your ranked score is saved locally; global sync did not complete.</div>';
  return '<div class="challenge-status pending">Saving your ranked score…</div>';
}

function renderTopThreeReveal() {
  if (!state.revealed || !state.quickResult) return '';
  const result = state.quickResult;
  return `
    <section class="reveal-panel">
      <p class="eyebrow">${state.isDailyChallenge ? 'Daily Challenge revealed' : 'Pack revealed'}</p>
      ${renderScoreHero(result.score, result.grade, topThreeResultCopy(result), state.scoreMeta)}
      ${dailySubmissionMarkup()}
      <div class="top3-comparison">
        <div><h3>Your ranking</h3>${result.selected.map((card, index) => `<div class="rank-row"><span>${index + 1}</span>${rankThumb(card)}<strong>${esc(card.name)}</strong></div>`).join('')}</div>
        <div><h3>Consensus</h3>${result.consensusTop.map((card, index) => `<div class="rank-row"><span>${index + 1}</span>${rankThumb(card)}<strong>${esc(card.name)}</strong><small>${pct(card.model_probability, 1)}</small><a class="market-link" href="${esc(tcgplayerUrl(card.name))}" target="_blank" rel="sponsored noopener" data-tcgplayer-link="1" data-tcgplayer-card="${esc(card.name)}" data-tcgplayer-set="${esc(state.selectedSetId)}" data-tcgplayer-surface="top3_consensus">TCGplayer</a></div>`).join('')}</div>
      </div>
      <p class="reveal-note">${result.overlap}/3 consensus cards · ${result.exactPositions} exact ${result.exactPositions === 1 ? 'position' : 'positions'}. ${result.historicalRank ? `The historical drafter's first pick was #${result.historicalRank} on your list.` : `The historical drafter's first pick was outside your top three.`}</p>
      <div class="button-row result-actions">
        ${state.isDailyChallenge ? '<button class="button primary" id="challenge-leaders">Today’s leaderboard</button><button class="button secondary" id="another-top3">Play another game</button>' : '<button class="button primary" id="another-top3">Play another</button>'}
        <button class="button share-button" id="share-top3">Share score</button>
        <button class="button secondary" id="top3-home">Choose a mode</button>
      </div>
    </section>`;
}

function renderTopThree() {
  const pick = openingPick();
  const count = state.topThreeIds.length;
  app.innerHTML = `
    <section class="game-heading">
      <div><p class="eyebrow">${state.isDailyChallenge ? `Daily Challenge · ${state.challengeDate}` : 'Top 3'} · ${esc(state.setData.name)}</p><h1>Rank your three best starts.</h1><p class="game-instruction">Click your first choice, then second, then third. Click a ranked card again to remove it.</p></div>
      <button class="text-button" id="quit-game">Exit</button>
    </section>
    <div class="pack-grid opening-pack">${pick.candidates.map((card) => renderCard(card, pick, { mode: 'top3', reveal: state.revealed })).join('')}</div>
    ${renderTopThreeReveal()}
    ${state.revealed ? '' : `<div class="action-dock"><div><strong>${count === 0 ? 'Pick your #1.' : count === 1 ? 'Now pick #2.' : count === 2 ? 'One more: pick #3.' : 'Ranking ready.'}</strong><span>${count}/3 selected${state.isDailyChallenge && !state.challengeRanked ? ' · replay' : ''}</span></div><button class="button primary" id="reveal-top3" ${count === 3 ? '' : 'disabled'}>Reveal score</button></div>`}`;

  attachCardImageFallbacks();
  if (!state.revealed) document.querySelectorAll('[data-card-id]').forEach((button) => button.addEventListener('click', () => toggleTopThree(button.dataset.cardId)));
  document.querySelector('#reveal-top3')?.addEventListener('click', submitTopThree);
  document.querySelector('#another-top3')?.addEventListener('click', () => startMode('top3', state.isDailyChallenge ? { daily: true, date: state.challengeDate } : {}));
  document.querySelector('#share-top3')?.addEventListener('click', (event) => shareScore(event.currentTarget, topThreeShareText(state.quickResult), state.isDailyChallenge ? challengeShareUrl('top3') : SHARE_URL));
  document.querySelector('#challenge-leaders')?.addEventListener('click', () => renderLeaderboards({ period: 'daily', setId: state.selectedSetId, mode: 'top3' }));
  document.querySelector('#top3-home')?.addEventListener('click', goHome);
  document.querySelector('#quit-game')?.addEventListener('click', goHome);
}

function toggleTopThree(cardId) {
  if (state.revealed) return;
  const existing = state.topThreeIds.indexOf(cardId);
  if (existing >= 0) state.topThreeIds.splice(existing, 1);
  else if (state.topThreeIds.length < 3) state.topThreeIds.push(cardId);
  renderTopThree();
}

function submitTopThree() {
  if (state.topThreeIds.length !== 3 || state.revealed) return;
  const pick = openingPick();
  state.quickResult = gradeTopThree(pick.candidates, state.topThreeIds, pick.historical_pick_id);
  state.scoreMeta = recordBestScore('top3', state.quickResult.score);
  state.revealed = true;
  pushRevealState(state.topThreeIds);
  if (state.isDailyChallenge && state.challengeRanked) {
    recordChallengeCompletion({ date: state.challengeDate, setId: state.selectedSetId, mode: 'top3', score: state.quickResult.score, grade: state.quickResult.grade });
    state.challengeSubmitStatus = 'pending';
  }
  renderTopThree();
  if (state.isDailyChallenge && state.challengeRanked) void syncDailyScore('top3', state.quickResult.score, state.quickResult.grade, { overlap: state.quickResult.overlap, exact_positions: state.quickResult.exactPositions });
  document.querySelector('.reveal-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPool(pool) {
  const entries = Object.entries(pool || {}).filter(([, count]) => Number(count) > 0);
  if (!entries.length) return '<p class="empty-note">No cards yet.</p>';
  return `<div class="pool-list">${entries.map(([name, count]) => `<div class="pool-item"><span>${esc(name)}</span><span>${Number(count) > 1 ? `×${esc(count)}` : ''}</span></div>`).join('')}</div>`;
}

function currentPick() {
  return state.packPicks[state.pickIndex];
}

function addPoolCard(pool, name) {
  if (!name) return pool;
  pool[name] = (Number(pool[name]) || 0) + 1;
  return pool;
}

function userPoolBeforePick(index = state.pickIndex) {
  // Some stored seats begin after P1P1. Unseen earlier cards are inherited from
  // the replay's starting pool; every decision the player actually makes then
  // replaces the historical drafter's choice in the counterfactual path.
  const pool = { ...(state.packPicks[0]?.pool || {}) };
  for (const result of state.results.slice(0, Math.max(0, index))) addPoolCard(pool, result.selectedName);
  return pool;
}

function conditionedPick(pick = currentPick()) {
  if (!pick) return pick;
  const userPool = userPoolBeforePick();
  const candidates = conditionCandidatesForPath(pick.candidates, {
    pickNumber: Number(pick.pick_number),
    historicalPool: pick.pool || {},
    userPool,
    pathModel: state.pathModel,
  });
  return {
    ...pick,
    candidates,
    user_pool: userPool,
    path_diverged: pathHasDiverged(pick.pool || {}, userPool),
  };
}

function renderPickFeedback(pick) {
  if (!state.revealed) return '';
  const result = state.results[state.results.length - 1];
  const historical = pick.candidates.find((card) => card.id === pick.historical_pick_id);
  return `
    <section class="pick-feedback">
      <div class="feedback-title"><div><p class="eyebrow">Pick ${state.pickIndex + 1}</p><h2>${esc(result.verdict)}</h2></div><div class="pick-score ${scoreTone(result.score)}"><strong>${result.score}</strong><span>/100</span></div></div>
      <div class="feedback-grid">
        <div><span>You took</span><strong>${esc(result.selectedName)}</strong></div>
        <div><span>${result.pathDiverged ? 'Your-path leader' : 'Strong-player leader'}</span><strong>${esc(result.bestName)}</strong><a class="market-link" href="${esc(tcgplayerUrl(result.bestName))}" target="_blank" rel="sponsored noopener" data-tcgplayer-link="1" data-tcgplayer-card="${esc(result.bestName)}" data-tcgplayer-set="${esc(state.selectedSetId)}" data-tcgplayer-surface="full_pick_consensus">TCGplayer</a></div>
        <div><span>Your support</span><strong>${pct(result.selectedProbability, 1)}</strong></div>
        <div><span>Support gap</span><strong>${result.gap ? `${(result.gap * 100).toFixed(1)} pts` : '—'}</strong></div>
        <div><span>Real drafter</span><strong>${esc(historical?.name || 'Unknown')}${result.historicalMatch ? ' ✓' : ''}</strong></div>
      </div>
      ${result.replayBoundWheel ? '<div class="challenge-status practice"><strong>Replay-bound wheel.</strong> Your earlier choices could have changed what came back around, so this pick gets feedback but does not count toward the final score.</div>' : ''}
    </section>`;
}

function renderFullPack() {
  const pick = conditionedPick();
  const total = state.packPicks.length;
  const progress = ((state.pickIndex + (state.revealed ? 1 : 0)) / total) * 100;
  const selected = pick.candidates.find((card) => card.id === state.selectedCardId);
  app.innerHTML = `
    <section class="game-heading compact">
      <div><p class="eyebrow">${state.isDailyChallenge ? `Daily Challenge · ${state.challengeDate}` : 'Full Pack'} · ${esc(state.setData.name)}</p><h1>Pick ${state.pickIndex + 1} of ${total}</h1><p class="game-instruction">Choose the card you'd take from this seat.${state.isDailyChallenge && !state.challengeRanked ? ' This is a replay of today’s challenge.' : ''}</p></div>
      <button class="text-button" id="quit-game">Exit</button>
    </section>
    <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
    <section class="full-pack-layout">
      <div class="study-main">
        <div class="pack-grid">${pick.candidates.map((card) => renderCard(card, pick, { mode: 'full', reveal: state.revealed })).join('')}</div>
        ${renderPickFeedback(pick)}
        <div class="action-dock inline-dock"><div><strong>${selected ? esc(selected.name) : 'Choose a card.'}</strong><span>${state.revealed ? 'Your pick score is above.' : 'Lock it in when you are ready.'}</span></div>${state.revealed ? `<button class="button primary" id="next-pick">${state.pickIndex === total - 1 ? 'See final score' : 'Next pick'}</button>` : `<button class="button primary" id="submit-pick" ${selected ? '' : 'disabled'}>Lock in pick</button>`}</div>
      </div>
      <aside class="replay-sidebar"><section class="sidebar-card"><p class="eyebrow">Your path</p><h3>Your pool so far</h3>${renderPool(pick.user_pool)}</section><section class="sidebar-card quiet"><h3>What stays fixed</h3><p>The available cards still come from the historical replay. Your later-pick support now reconditions on the cards you actually chose; Pack One does not simulate how seven other drafters might change what wheels.</p></section></aside>
    </section>`;

  attachCardImageFallbacks();
  if (!state.revealed) document.querySelectorAll('[data-card-id]').forEach((button) => button.addEventListener('click', () => { state.selectedCardId = button.dataset.cardId; renderFullPack(); }));
  document.querySelector('#submit-pick')?.addEventListener('click', submitPick);
  document.querySelector('#next-pick')?.addEventListener('click', nextPick);
  document.querySelector('#quit-game')?.addEventListener('click', goHome);
}

function submitPick() {
  if (!state.selectedCardId || state.revealed) return;
  const pick = conditionedPick();
  const grade = gradePick(pick.candidates, state.selectedCardId, pick.historical_pick_id);
  const actualPickNumber = Number(pick.pick_number) || state.pickIndex + 1;
  const firstPassDiverged = state.results.some((result) => Number(result.pick_number) <= 8 && !result.historicalMatch);
  const replayBoundWheel = actualPickNumber >= 9 && firstPassDiverged;
  state.results.push({
    ...grade,
    decisionWeight: replayBoundWheel ? 0 : grade.decisionWeight,
    pack_number: 1,
    pick_number: actualPickNumber,
    pathDiverged: Boolean(pick.path_diverged),
    replayBoundWheel,
  });
  state.revealed = true;
  renderFullPack();
}

function nextPick() {
  if (state.pickIndex >= state.packPicks.length - 1) {
    renderSummary();
    return;
  }
  state.pickIndex += 1;
  state.selectedCardId = null;
  state.revealed = false;
  renderFullPack();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function methodNote() {
  if (state.setData.is_fixture) return 'This is interface fixture data, not a real 17Lands-trained replay.';
  const cohort = state.setData.cohort || {};
  const model = state.setData.model || {};
  return `Generated offline from ${state.setData.source?.provider || '17Lands'} public draft data. ${Number(cohort.training_drafts || 0).toLocaleString()} high-win-rate drafts train the consensus model with ${model.holdout || 'draft-level holdout'}. In Full Pack, later support is reconditioned on the cards you actually selected using separate strong-player co-pick statistics that hold out the replay seats. Picks 2–8 keep the historical candidate packs because your own earlier choices cannot change which unopened packs reach you. Once packs wheel, a divergent first pass could change what survived, so replay-bound wheel decisions receive feedback but no final-score weight.`;
}

function fullPackShareText(summary) {
  const prefix = state.isDailyChallenge ? 'Pack 1 Daily · Full Pack' : 'Pack 1 · Full Pack';
  const challenge = state.isDailyChallenge ? '\nSame pack for everyone. Beat my score.' : '\nCan you beat it?';
  return `${prefix} · ${state.setData.name}\n${summary.score}/100 (${summary.grade}) · ${summary.consensusAgreement.toFixed(0)}% consensus · ${summary.topThreeAgreement.toFixed(0)}% top 3${challenge}`;
}

function renderSummary() {
  const summary = summarizeResults(state.results);
  state.scoreMeta ||= recordBestScore('full', summary.score);
  if (state.isDailyChallenge && state.challengeRanked && !challengeRecord(state.challengeDate, state.selectedSetId, 'full')) {
    recordChallengeCompletion({ date: state.challengeDate, setId: state.selectedSetId, mode: 'full', score: summary.score, grade: summary.grade });
    state.challengeSubmitStatus = 'pending';
    void syncDailyScore('full', summary.score, summary.grade, { consensus_agreement: summary.consensusAgreement, top_three_agreement: summary.topThreeAgreement });
  }
  app.innerHTML = `
    <section class="scorecard">
      <p class="eyebrow">${state.isDailyChallenge ? 'Daily Challenge complete' : 'Full Pack complete'}</p>
      ${renderScoreHero(summary.score, summary.grade, summary.gradeLabel, state.scoreMeta)}
      ${dailySubmissionMarkup()}
      <p class="lede result-lede">You made ${summary.total} decisions. ${summary.scoredDecisions < summary.total ? `${summary.scoredDecisions} had reliable replay context and counted toward the final score. ` : ''}Here's where your picks lined up with the strong-player model along the path you actually drafted.</p>
      <div class="summary-grid">
        <div class="summary-stat"><strong>${summary.consensusAgreement.toFixed(0)}%</strong><span>Path-leader picks</span></div>
        <div class="summary-stat"><strong>${summary.topThreeAgreement.toFixed(0)}%</strong><span>Path top-3 picks</span></div>
        <div class="summary-stat"><strong>${summary.historicalAgreement.toFixed(0)}%</strong><span>Matched drafter</span></div>
        <div class="summary-stat"><strong>${(summary.averageGap * 100).toFixed(1)}</strong><span>Avg. gap, pts</span></div>
      </div>
      <section class="review-section"><h2>Worth another look</h2><div class="miss-list">${summary.biggestMisses.length ? summary.biggestMisses.map((result) => `<div class="miss-row"><span class="pick-number">Pick ${esc(result.pick_number)}</span><div><strong>${esc(result.selectedName)}</strong><small>Consensus: ${esc(result.bestName)}</small></div><span class="gap-number">${result.score}</span></div>`).join('') : '<p class="empty-note">Nothing major. Your picks stayed close to consensus all pack.</p>'}</div></section>
      <details class="method-details"><summary>About the grading</summary><p>${esc(methodNote())}</p></details>
      <div class="button-row result-actions">
        ${state.isDailyChallenge ? '<button class="button primary" id="challenge-leaders">Today’s leaderboard</button><button class="button secondary" id="another-full">Play another game</button>' : '<button class="button primary" id="another-full">New pack</button>'}
        <button class="button share-button" id="share-full">Share score</button>
        <button class="button secondary" id="summary-home">Choose a mode</button>
      </div>
    </section>`;

  document.querySelector('#another-full').addEventListener('click', () => startMode('full', state.isDailyChallenge ? { daily: true, date: state.challengeDate } : {}));
  document.querySelector('#share-full').addEventListener('click', (event) => shareScore(event.currentTarget, fullPackShareText(summary), state.isDailyChallenge ? challengeShareUrl('full') : SHARE_URL));
  document.querySelector('#challenge-leaders')?.addEventListener('click', () => renderLeaderboards({ period: 'daily', setId: state.selectedSetId, mode: 'full' }));
  document.querySelector('#summary-home').addEventListener('click', goHome);
}

async function syncDailyScore(mode, score, grade, details) {
  if (!state.challengeRanked || state.challengeDate !== utcDateKey()) return;
  if (!isLeaderboardConfigured()) {
    state.challengeSubmitStatus = 'local';
    refreshChallengeStatus();
    return;
  }
  try {
    await submitLeaderboardScore({
      setId: state.selectedSetId,
      mode,
      score,
      grade,
      challengeDate: state.challengeDate,
      displayName: getDisplayName(),
      details,
    });
    state.challengeSubmitStatus = 'saved';
    const rows = await loadLeaderboard({ period: 'daily', setId: state.selectedSetId, mode, limit: 100 });
    state.challengeRank = rows.find((row) => row.is_me)?.rank || null;
  } catch (error) {
    console.warn('Daily leaderboard sync failed:', error);
    state.challengeSubmitStatus = 'error';
  }
  refreshChallengeStatus();
}

function refreshChallengeStatus() {
  const node = document.querySelector('.challenge-status');
  if (!node) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = dailySubmissionMarkup();
  node.replaceWith(wrapper.firstElementChild);
}

function leaderboardSetOptions(selected) {
  return `<option value="all" ${selected === 'all' ? 'selected' : ''}>All sets</option>${state.catalog.sets.map((set) => `<option value="${esc(set.id)}" ${selected === set.id ? 'selected' : ''}>${esc(set.name)}</option>`).join('')}`;
}

function leaderboardPeriodLabel(period, setFilter) {
  if (period === 'daily' && setFilter !== 'all') return 'Score';
  return 'Points';
}

async function renderLeaderboards(options = {}) {
  resetSession();
  const period = options.period || 'daily';
  const mode = options.mode || 'top3';
  const setFilter = options.setId || state.selectedSetId || state.catalog?.sets?.[0]?.id || 'all';
  const playerName = getDisplayName();
  app.innerHTML = `
    <section class="leaderboard-shell">
      <div class="leaderboard-heading"><div><p class="eyebrow">Global leaderboard</p><h1>Pack 1 standings</h1><p class="lede">Daily uses one shared challenge. Weekly, monthly, and all-time boards add up Daily Challenge points, rewarding both sharp picks and showing up.</p></div><button class="text-button" id="leaderboard-home">Back home</button></div>
      <div class="leaderboard-toolbar">
        <div class="period-tabs" role="tablist">${['daily', 'weekly', 'monthly', 'all'].map((item) => `<button class="period-tab ${item === period ? 'active' : ''}" data-period="${item}">${item === 'all' ? 'All-time' : item[0].toUpperCase() + item.slice(1)}</button>`).join('')}</div>
        <div class="leaderboard-filters"><label><span>Mode</span><select id="leader-mode" class="select"><option value="top3" ${mode === 'top3' ? 'selected' : ''}>Top 3</option><option value="full" ${mode === 'full' ? 'selected' : ''}>Full Pack</option></select></label><label><span>Set</span><select id="leader-set" class="select">${leaderboardSetOptions(setFilter)}</select></label></div>
      </div>
      <div class="player-card"><div><span>Your board name</span><strong>${esc(playerName)}</strong><small>No account required. This name stays on this device.</small></div><div class="player-name-edit"><input id="player-name" maxlength="24" value="${esc(playerName)}" aria-label="Leaderboard display name"><button class="button secondary" id="save-player-name">Save</button></div></div>
      <section id="leaderboard-content" class="leaderboard-content"><div class="leaderboard-loading">Loading standings…</div></section>
    </section>`;

  document.querySelector('#leaderboard-home').addEventListener('click', goHome);
  document.querySelectorAll('[data-period]').forEach((button) => button.addEventListener('click', () => renderLeaderboards({ period: button.dataset.period, mode, setId: setFilter })));
  document.querySelector('#leader-mode').addEventListener('change', (event) => renderLeaderboards({ period, mode: event.target.value, setId: setFilter }));
  document.querySelector('#leader-set').addEventListener('change', (event) => renderLeaderboards({ period, mode, setId: event.target.value }));
  document.querySelector('#save-player-name').addEventListener('click', async () => {
    const button = document.querySelector('#save-player-name');
    try {
      const saved = saveDisplayName(document.querySelector('#player-name').value);
      button.textContent = 'Saved';
      if (isLeaderboardConfigured()) await updateLeaderboardDisplayName(saved).catch(() => null);
      setTimeout(() => renderLeaderboards({ period, mode, setId: setFilter }), 500);
    } catch (error) {
      button.textContent = error.message;
      setTimeout(() => { button.textContent = 'Save'; }, 1600);
    }
  });

  const content = document.querySelector('#leaderboard-content');
  if (!isLeaderboardConfigured()) {
    content.innerHTML = '<div class="leaderboard-empty"><strong>Global standings are ready in the app, but the shared score database has not been connected to this deployment yet.</strong><span>Daily Challenge, streaks, milestones, and local ranked results still work.</span></div>';
    return;
  }
  try {
    const rows = await loadLeaderboard({ period, setId: setFilter === 'all' ? null : setFilter, mode, limit: 50 });
    if (!rows.length) {
      content.innerHTML = '<div class="leaderboard-empty"><strong>No scores yet.</strong><span>Be the first name on this board.</span></div>';
      return;
    }
    const valueLabel = leaderboardPeriodLabel(period, setFilter);
    content.innerHTML = `
      <div class="leaderboard-table-wrap"><table class="leaderboard-table"><thead><tr><th>Rank</th><th>Player</th><th>${valueLabel}</th><th>Avg</th><th>Played</th><th>100s</th></tr></thead><tbody>${rows.map((row) => `<tr class="${row.is_me ? 'is-me' : ''}"><td class="rank-cell">#${row.rank}</td><td><strong>${esc(row.display_name)}</strong>${row.is_me ? '<small>You</small>' : ''}</td><td class="points-cell">${row.points}</td><td>${Number(row.average_score).toFixed(1)}</td><td>${row.plays}</td><td>${row.perfects}</td></tr>`).join('')}</tbody></table></div>
      <p class="leaderboard-note">${period === 'daily' ? 'Daily rankings reset at midnight Eastern.' : 'Points are the sum of ranked Daily Challenge scores in this period.'} Only Daily Challenge runs count toward the board.</p>`;
  } catch (error) {
    console.warn('Leaderboard failed to load', error?.message);
    content.innerHTML = `<div class="leaderboard-empty"><strong>Couldn’t load the standings.</strong><span>We couldn’t reach Pack One’s servers. This is usually a brief hiccup.</span><button class="button secondary" type="button" id="leaderboard-retry">Try again</button></div>`;
    content.querySelector('#leaderboard-retry').onclick = () => renderLeaderboards({ period, mode, setId: setFilter });
  }
}

async function init() {
  window.addEventListener('popstate', handleRevealPopState);
  app.innerHTML = document.querySelector('#loading-template').innerHTML;
  try {
    state.catalog = await loadCatalog();
    const params = new URLSearchParams(window.location.search);
    const requestedSet = params.get('set');
    state.selectedSetId = state.catalog.sets?.some((set) => set.id === requestedSet) ? requestedSet : state.catalog.sets?.[0]?.id || null;
    const daily = params.get('daily');
    const mode = params.get('mode');
    if (daily && ['top3', 'full'].includes(mode)) await startMode(mode, { daily: true, date: daily });
    else renderHome();
  } catch (error) {
    renderError(error);
  }
}

init();
