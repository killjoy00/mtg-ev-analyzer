import { gradePick, gradeTopThree, rankCandidates, summarizeResults } from './scoring.mjs';

const app = document.querySelector('#app');
const brandHome = document.querySelector('#brand-home');
const SHARE_URL = 'https://magic.planitnow.us/';

const state = {
  catalog: null,
  selectedSetId: null,
  setData: null,
  replay: null,
  mode: null,
  packPicks: [],
  pickIndex: 0,
  selectedCardId: null,
  topThreeIds: [],
  revealed: false,
  results: [],
  quickResult: null,
  scoreMeta: null,
};

brandHome.addEventListener('click', renderHome);

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

function resetSession() {
  state.setData = null;
  state.replay = null;
  state.mode = null;
  state.packPicks = [];
  state.pickIndex = 0;
  state.selectedCardId = null;
  state.topThreeIds = [];
  state.revealed = false;
  state.results = [];
  state.quickResult = null;
  state.scoreMeta = null;
}

async function loadJson(path, label = 'data') {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load ${label} (${response.status}).`);
  return response.json();
}

async function loadCatalog() {
  return loadJson('./data/catalog.json', 'catalog');
}

async function loadSet(setEntry) {
  const path = setEntry.manifest_path || setEntry.data_path;
  if (!path) throw new Error(`${setEntry.name} has no data path.`);
  return loadJson(path, setEntry.name);
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
  return `pack1-best:${state.selectedSetId}:${mode}`;
}

function getBestScore(mode) {
  try {
    const value = window.localStorage.getItem(bestKey(mode));
    return value === null ? null : Number(value);
  } catch {
    return null;
  }
}

function recordBestScore(mode, score) {
  const previous = getBestScore(mode);
  const best = previous === null ? score : Math.max(previous, score);
  try { window.localStorage.setItem(bestKey(mode), String(best)); } catch { /* local storage is optional */ }
  return { best, previous, isNewBest: previous === null || score > previous };
}

function bestChip(mode) {
  const best = getBestScore(mode);
  return best === null ? '' : `<span class="best-chip">Personal best <strong>${best}</strong></span>`;
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

async function shareScore(button, text) {
  const original = button.textContent;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Pack 1', text, url: SHARE_URL });
      return;
    }
    await copyText(`${text}\n${SHARE_URL}`);
    button.textContent = 'Copied!';
    setTimeout(() => { button.textContent = original; }, 1600);
  } catch (error) {
    if (error?.name !== 'AbortError') {
      try {
        await copyText(`${text}\n${SHARE_URL}`);
        button.textContent = 'Copied!';
        setTimeout(() => { button.textContent = original; }, 1600);
      } catch { /* keep the game usable if sharing is unavailable */ }
    }
  }
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

  app.innerHTML = `
    <section class="home-intro">
      <p class="eyebrow">Limited draft training</p>
      <h1>How good is your Pack 1?</h1>
      <p class="lede">Real draft seats. Strong-player consensus. Play a quick opening-pack challenge or draft the whole first pack and get a score out of 100.</p>
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

    <section class="mode-grid" aria-label="Choose a game mode">
      <article class="mode-card">
        <div class="mode-number">01</div>
        <div class="mode-topline"><p class="eyebrow">Fast game</p>${bestChip('top3')}</div>
        <h2>Top 3</h2>
        <p>See one fresh opening pack and rank the three cards you'd most want to start with. Score your card evaluation and ordering against consensus.</p>
        <ul class="mode-points"><li>One opening pack</li><li>100-point score</li><li>Easy to share</li></ul>
        <button class="button primary mode-button" data-mode="top3">Play Top 3</button>
      </article>

      <article class="mode-card featured">
        <div class="mode-number">02</div>
        <div class="mode-topline"><p class="eyebrow">Deeper game</p>${bestChip('full')}</div>
        <h2>Full Pack</h2>
        <p>Work through every pick in the first pack of a real draft seat. Every decision gets a score, then the whole pack gets a grade.</p>
        <ul class="mode-points"><li>Every Pack 1 decision</li><li>Live pick scores</li><li>Final grade + share card</li></ul>
        <button class="button primary mode-button" data-mode="full">Draft Pack 1</button>
      </article>
    </section>

    <section class="data-note">
      <strong>How scoring works</strong>
      <span>Scores measure how much strong-player model support your choices had relative to the consensus choice. They are training-game scores, not claims that a draft pick is objectively right or wrong.</span>
    </section>`;

  document.querySelector('#set-select').addEventListener('change', (event) => {
    state.selectedSetId = event.target.value;
    renderHome();
  });
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => startMode(button.dataset.mode));
  });
}

async function startMode(mode) {
  const entry = selectedSetEntry();
  document.querySelectorAll('.mode-button').forEach((button) => {
    button.disabled = true;
    if (button.dataset.mode === mode) button.textContent = 'Shuffling…';
  });

  try {
    const loaded = await loadRandomReplay(entry);
    const packPicks = firstPackPicks(loaded.replay);
    if (!packPicks.length) throw new Error('This replay does not contain a first pack.');
    state.setData = loaded.setData;
    state.replay = loaded.replay;
    state.mode = mode;
    state.packPicks = packPicks;
    state.pickIndex = 0;
    state.selectedCardId = null;
    state.topThreeIds = [];
    state.revealed = false;
    state.results = [];
    state.quickResult = null;
    state.scoreMeta = null;
    if (mode === 'top3') renderTopThree();
    else renderFullPack();
  } catch (error) {
    renderError(error);
  }
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

  return `
    <button class="${classes}" type="button" data-card-id="${esc(card.id)}" ${reveal ? 'disabled' : ''}>
      <div class="card-image-wrap">
        <div class="card-art-placeholder">${esc(card.name)}</div>
        ${card.image_url ? `<img class="card-image" src="${esc(card.image_url)}" alt="${esc(card.name)}" loading="lazy" />` : ''}
        ${userRank ? `<span class="user-rank-badge">${userRank}</span>` : ''}
        ${reveal && consensusRank <= 3 ? `<span class="consensus-badge">C${consensusRank}</span>` : ''}
      </div>
      <div class="card-footer">
        <strong>${esc(card.name)}</strong>
        ${reveal ? `<span>${pct(card.model_probability, 1)} · consensus #${consensusRank}${isHistorical ? ' · drafter pick' : ''}</span>` : '<span>Choose this card</span>'}
      </div>
    </button>`;
}

function attachCardImageFallbacks() {
  document.querySelectorAll('.card-image').forEach((image) => {
    image.addEventListener('error', () => image.remove(), { once: true });
  });
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
  return `Pack 1 · Top 3 · ${state.setData.name}\n${result.score}/100 (${result.grade}) · ${result.overlap}/3 consensus cards · ${result.exactPositions} exact positions\nCan you beat it?`;
}

function renderScoreHero(score, grade, label, meta) {
  return `
    <div class="score-hero ${scoreTone(score)}">
      <div class="score-orb"><strong>${score}</strong><span>/100</span></div>
      <div class="score-copy">
        <div class="grade-row"><span class="grade-badge">${esc(grade)}</span>${meta?.isNewBest ? '<span class="new-best">New personal best</span>' : ''}</div>
        <h2>${esc(label)}</h2>
        ${meta ? `<p>Personal best: <strong>${meta.best}</strong></p>` : ''}
      </div>
    </div>`;
}

function renderTopThreeReveal() {
  if (!state.revealed || !state.quickResult) return '';
  const result = state.quickResult;
  return `
    <section class="reveal-panel">
      <p class="eyebrow">Pack revealed</p>
      ${renderScoreHero(result.score, result.grade, topThreeResultCopy(result), state.scoreMeta)}
      <div class="top3-comparison">
        <div>
          <h3>Your ranking</h3>
          ${result.selected.map((card, index) => `<div class="rank-row"><span>${index + 1}</span><strong>${esc(card.name)}</strong></div>`).join('')}
        </div>
        <div>
          <h3>Consensus</h3>
          ${result.consensusTop.map((card, index) => `<div class="rank-row"><span>${index + 1}</span><strong>${esc(card.name)}</strong><small>${pct(card.model_probability, 1)}</small></div>`).join('')}
        </div>
      </div>
      <p class="reveal-note">${result.overlap}/3 consensus cards · ${result.exactPositions} exact ${result.exactPositions === 1 ? 'position' : 'positions'}. ${result.historicalRank ? `The historical drafter's first pick was #${result.historicalRank} on your list.` : `The historical drafter's first pick was outside your top three.`}</p>
      <div class="button-row result-actions">
        <button class="button primary" id="another-top3">Play another</button>
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
      <div><p class="eyebrow">Top 3 · ${esc(state.setData.name)}</p><h1>Rank your three best starts.</h1><p class="game-instruction">Click your first choice, then second, then third. Click a ranked card again to remove it.</p></div>
      <button class="text-button" id="quit-game">Exit</button>
    </section>
    <div class="pack-grid opening-pack">${pick.candidates.map((card) => renderCard(card, pick, { mode: 'top3', reveal: state.revealed })).join('')}</div>
    ${renderTopThreeReveal()}
    ${state.revealed ? '' : `
      <div class="action-dock">
        <div><strong>${count === 0 ? 'Pick your #1.' : count === 1 ? 'Now pick #2.' : count === 2 ? 'One more: pick #3.' : 'Ranking ready.'}</strong><span>${count}/3 selected</span></div>
        <button class="button primary" id="reveal-top3" ${count === 3 ? '' : 'disabled'}>Reveal score</button>
      </div>`}`;

  attachCardImageFallbacks();
  if (!state.revealed) document.querySelectorAll('[data-card-id]').forEach((button) => button.addEventListener('click', () => toggleTopThree(button.dataset.cardId)));
  document.querySelector('#reveal-top3')?.addEventListener('click', submitTopThree);
  document.querySelector('#another-top3')?.addEventListener('click', () => startMode('top3'));
  document.querySelector('#share-top3')?.addEventListener('click', (event) => shareScore(event.currentTarget, topThreeShareText(state.quickResult)));
  document.querySelector('#top3-home')?.addEventListener('click', renderHome);
  document.querySelector('#quit-game')?.addEventListener('click', renderHome);
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
  renderTopThree();
  document.querySelector('.reveal-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPool(pool) {
  const entries = Object.entries(pool || {}).filter(([, count]) => Number(count) > 0);
  if (!entries.length) return '<p class="empty-note">Opening pick. The replay pool is empty.</p>';
  return `<div class="pool-list">${entries.map(([name, count]) => `<div class="pool-item"><span>${esc(name)}</span><span>${Number(count) > 1 ? `×${esc(count)}` : ''}</span></div>`).join('')}</div>`;
}

function currentPick() {
  return state.packPicks[state.pickIndex];
}

function renderPickFeedback(pick) {
  if (!state.revealed) return '';
  const result = state.results[state.results.length - 1];
  const historical = pick.candidates.find((card) => card.id === pick.historical_pick_id);
  return `
    <section class="pick-feedback">
      <div class="feedback-title">
        <div><p class="eyebrow">Pick ${state.pickIndex + 1}</p><h2>${esc(result.verdict)}</h2></div>
        <div class="pick-score ${scoreTone(result.score)}"><strong>${result.score}</strong><span>/100</span></div>
      </div>
      <div class="feedback-grid">
        <div><span>You took</span><strong>${esc(result.selectedName)}</strong></div>
        <div><span>Consensus</span><strong>${esc(result.bestName)}</strong></div>
        <div><span>Consensus rank</span><strong>#${esc(result.rank)}</strong></div>
        <div><span>Consensus gap</span><strong>${result.gap ? `${(result.gap * 100).toFixed(1)} pts` : '—'}</strong></div>
        <div><span>Real drafter</span><strong>${esc(historical?.name || 'Unknown')}${result.historicalMatch ? ' ✓' : ''}</strong></div>
      </div>
    </section>`;
}

function renderFullPack() {
  const pick = currentPick();
  const total = state.packPicks.length;
  const progress = ((state.pickIndex + (state.revealed ? 1 : 0)) / total) * 100;
  const selected = pick.candidates.find((card) => card.id === state.selectedCardId);
  app.innerHTML = `
    <section class="game-heading compact">
      <div><p class="eyebrow">Full Pack · ${esc(state.setData.name)}</p><h1>Pick ${state.pickIndex + 1} of ${total}</h1><p class="game-instruction">Choose the card you'd take from this seat.</p></div>
      <button class="text-button" id="quit-game">Exit</button>
    </section>
    <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
    <section class="full-pack-layout">
      <div class="study-main">
        <div class="pack-grid">${pick.candidates.map((card) => renderCard(card, pick, { mode: 'full', reveal: state.revealed })).join('')}</div>
        ${renderPickFeedback(pick)}
        <div class="action-dock inline-dock">
          <div><strong>${selected ? esc(selected.name) : 'Choose a card.'}</strong><span>${state.revealed ? 'Your pick score is above.' : 'Lock it in when you are ready.'}</span></div>
          ${state.revealed ? `<button class="button primary" id="next-pick">${state.pickIndex === total - 1 ? 'See final score' : 'Next pick'}</button>` : `<button class="button primary" id="submit-pick" ${selected ? '' : 'disabled'}>Lock in pick</button>`}
        </div>
      </div>
      <aside class="replay-sidebar">
        <section class="sidebar-card"><p class="eyebrow">Replay pool</p><h3>Cards entering this pick</h3>${renderPool(pick.pool)}</section>
        <section class="sidebar-card quiet"><h3>Why the pool is fixed</h3><p>This is a replay, not a draft simulator. Later decisions and consensus stay tied to the original seat, even when your picks differ.</p></section>
      </aside>
    </section>`;

  attachCardImageFallbacks();
  if (!state.revealed) document.querySelectorAll('[data-card-id]').forEach((button) => button.addEventListener('click', () => { state.selectedCardId = button.dataset.cardId; renderFullPack(); }));
  document.querySelector('#submit-pick')?.addEventListener('click', submitPick);
  document.querySelector('#next-pick')?.addEventListener('click', nextPick);
  document.querySelector('#quit-game')?.addEventListener('click', renderHome);
}

function submitPick() {
  if (!state.selectedCardId || state.revealed) return;
  const pick = currentPick();
  const grade = gradePick(pick.candidates, state.selectedCardId, pick.historical_pick_id);
  state.results.push({ ...grade, pack_number: 1, pick_number: state.pickIndex + 1 });
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
  return `Generated offline from ${state.setData.source?.provider || '17Lands'} public draft data. ${Number(cohort.training_drafts || 0).toLocaleString()} high-win-rate drafts train the consensus model with ${model.holdout || 'draft-level holdout'}. Pick scores compare your card's model support with the top-supported card in that pack. Probabilities are comparative, not calibrated odds that a choice is objectively correct.`;
}

function fullPackShareText(summary) {
  return `Pack 1 · Full Pack · ${state.setData.name}\n${summary.score}/100 (${summary.grade}) · ${summary.consensusAgreement.toFixed(0)}% consensus · ${summary.topThreeAgreement.toFixed(0)}% top 3\nCan you beat it?`;
}

function renderSummary() {
  const summary = summarizeResults(state.results);
  state.scoreMeta ||= recordBestScore('full', summary.score);
  app.innerHTML = `
    <section class="scorecard">
      <p class="eyebrow">Full Pack complete</p>
      ${renderScoreHero(summary.score, summary.grade, summary.gradeLabel, state.scoreMeta)}
      <p class="lede result-lede">You made ${summary.total} decisions. Here's where your instincts lined up with the strong-player consensus.</p>

      <div class="summary-grid">
        <div class="summary-stat"><strong>${summary.consensusAgreement.toFixed(0)}%</strong><span>Consensus picks</span></div>
        <div class="summary-stat"><strong>${summary.topThreeAgreement.toFixed(0)}%</strong><span>Top-3 picks</span></div>
        <div class="summary-stat"><strong>${summary.historicalAgreement.toFixed(0)}%</strong><span>Matched drafter</span></div>
        <div class="summary-stat"><strong>${(summary.averageGap * 100).toFixed(1)}</strong><span>Avg. gap, pts</span></div>
      </div>

      <section class="review-section">
        <h2>Worth another look</h2>
        <div class="miss-list">
          ${summary.biggestMisses.length ? summary.biggestMisses.map((result) => `
            <div class="miss-row"><span class="pick-number">Pick ${esc(result.pick_number)}</span><div><strong>${esc(result.selectedName)}</strong><small>Consensus: ${esc(result.bestName)}</small></div><span class="gap-number">${result.score}</span></div>`).join('') : '<p class="empty-note">Nothing major. Your picks stayed close to consensus all pack.</p>'}
        </div>
      </section>

      <details class="method-details"><summary>About the grading</summary><p>${esc(methodNote())}</p></details>
      <div class="button-row result-actions">
        <button class="button primary" id="another-full">Draft another Pack 1</button>
        <button class="button share-button" id="share-full">Share score</button>
        <button class="button secondary" id="summary-home">Choose a mode</button>
      </div>
    </section>`;

  document.querySelector('#another-full').addEventListener('click', () => startMode('full'));
  document.querySelector('#share-full').addEventListener('click', (event) => shareScore(event.currentTarget, fullPackShareText(summary)));
  document.querySelector('#summary-home').addEventListener('click', renderHome);
}

async function init() {
  app.innerHTML = document.querySelector('#loading-template').innerHTML;
  try {
    state.catalog = await loadCatalog();
    state.selectedSetId = state.catalog.sets?.[0]?.id || null;
    renderHome();
  } catch (error) {
    renderError(error);
  }
}

init();
