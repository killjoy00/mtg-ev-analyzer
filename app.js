import { gradePick, rankCandidates, summarizeResults } from './scoring.mjs';

const app = document.querySelector('#app');
const brandHome = document.querySelector('#brand-home');

const state = {
  catalog: null,
  selectedSetId: null,
  setData: null,
  replay: null,
  pickIndex: 0,
  selectedCardId: null,
  revealed: false,
  results: [],
};

brandHome.addEventListener('click', () => renderHome());

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

function routeHomeReset() {
  state.setData = null;
  state.replay = null;
  state.pickIndex = 0;
  state.selectedCardId = null;
  state.revealed = false;
  state.results = [];
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
    return {
      setData,
      replay: shard.replays[Math.floor(Math.random() * shard.replays.length)],
    };
  }
  if (!setData.replays?.length) throw new Error('This set has no replay drafts.');
  return {
    setData,
    replay: setData.replays[Math.floor(Math.random() * setData.replays.length)],
  };
}

function renderError(error) {
  app.innerHTML = `
    <section class="center-card">
      <p class="eyebrow">Data error</p>
      <h1>Replay data could not be loaded.</h1>
      <p class="lede">${esc(error.message)}</p>
      <div class="button-row"><button class="secondary" id="retry">Retry</button></div>
    </section>`;
  document.querySelector('#retry')?.addEventListener('click', init);
}

function selectedSetEntry() {
  return state.catalog.sets.find((set) => set.id === state.selectedSetId) || state.catalog.sets[0];
}

function renderHome() {
  routeHomeReset();
  const sets = state.catalog?.sets || [];
  if (!sets.length) {
    app.innerHTML = '<section class="center-card"><h1>No replay sets are available yet.</h1></section>';
    return;
  }

  state.selectedSetId ||= sets[0].id;
  const active = selectedSetEntry();

  app.innerHTML = `
    <section class="hero-card">
      <p class="eyebrow">Historical decision replay</p>
      <h1>Draft the pick. Then see what strong players would do.</h1>
      <p class="lede">Follow a historical draft path one decision at a time. Your pick is graded against an offline, pool-conditioned strong-player consensus model; matching the historical drafter is tracked separately.</p>

      <div class="home-grid">
        <div class="option-card">
          <label class="option-label" for="set-select">Training set</label>
          <select class="select" id="set-select">
            ${sets.map((set) => `<option value="${esc(set.id)}" ${set.id === active.id ? 'selected' : ''}>${esc(set.name)}</option>`).join('')}
          </select>
          <div class="meta-list" id="set-meta"></div>
          <div id="fixture-slot"></div>
        </div>

        <div class="option-card">
          <span class="option-label">Study rules</span>
          <div class="meta-list">
            <div class="meta-row"><span>Mode</span><span>Replay study</span></div>
            <div class="meta-row"><span>Skill cohort</span><span>High 17Lands WR</span></div>
            <div class="meta-row"><span>Primary grade</span><span>Consensus likelihood</span></div>
            <div class="meta-row"><span>Historical pick</span><span>Secondary metric</span></div>
            <div class="meta-row"><span>Runtime model/API</span><span>None</span></div>
          </div>
          <div class="button-row">
            <button class="primary" id="start-study">Start replay</button>
          </div>
        </div>
      </div>
    </section>`;

  const updateSetMeta = () => {
    const entry = selectedSetEntry();
    const cohortRows = entry.win_rate_cutoff
      ? `<div class="meta-row"><span>WR bucket midpoint ≥</span><span>${pct(entry.win_rate_cutoff, 1)}</span></div>`
      : '';
    const trainingRows = entry.training_drafts
      ? `<div class="meta-row"><span>Training drafts</span><span>${Number(entry.training_drafts).toLocaleString()}</span></div>`
      : '';
    document.querySelector('#set-meta').innerHTML = `
      <div class="meta-row"><span>Format</span><span>${esc(entry.format)}</span></div>
      <div class="meta-row"><span>Replays</span><span>${Number(entry.replay_count || 0).toLocaleString()}</span></div>
      ${cohortRows}
      ${trainingRows}
      <div class="meta-row"><span>Model</span><span>${esc(entry.model_version)}</span></div>
      <div class="meta-row"><span>Data date</span><span>${esc(entry.data_date)}</span></div>`;
    document.querySelector('#fixture-slot').innerHTML = entry.is_fixture
      ? '<div class="fixture-warning">Interface fixture only: these choices and probabilities are synthetic, not 17Lands training data.</div>'
      : '';
  };

  updateSetMeta();
  document.querySelector('#set-select').addEventListener('change', (event) => {
    state.selectedSetId = event.target.value;
    updateSetMeta();
  });
  document.querySelector('#start-study').addEventListener('click', startStudy);
}

async function startStudy() {
  const entry = selectedSetEntry();
  const button = document.querySelector('#start-study') || document.querySelector('#another-replay');
  if (button) {
    button.disabled = true;
    button.textContent = 'Loading…';
  }

  try {
    const loaded = await loadRandomReplay(entry);
    state.setData = loaded.setData;
    state.replay = loaded.replay;
    state.pickIndex = 0;
    state.selectedCardId = null;
    state.revealed = false;
    state.results = [];
    renderStudy();
  } catch (error) {
    renderError(error);
  }
}

function renderPool(pool) {
  const entries = Object.entries(pool || {}).filter(([, count]) => Number(count) > 0);
  if (!entries.length) return '<p class="empty-note">No cards yet. This is the first decision of the draft.</p>';
  return `<div class="pool-list">${entries.map(([name, count]) => `
    <div class="pool-item"><span>${esc(name)}</span><span class="pool-count">${Number(count) > 1 ? `×${esc(count)}` : ''}</span></div>`).join('')}</div>`;
}

function renderCard(card, pick) {
  const selected = state.selectedCardId === card.id;
  const consensus = state.revealed && card.id === pick.consensus_pick_id;
  const historical = state.revealed && card.id === pick.historical_pick_id;
  const classes = ['card-choice', selected ? 'selected' : '', consensus ? 'consensus' : '', historical ? 'historical' : ''].filter(Boolean).join(' ');
  const ranked = state.revealed ? rankCandidates(pick.candidates) : [];
  const rank = state.revealed ? ranked.findIndex((item) => item.id === card.id) + 1 : null;
  return `
    <button class="${classes}" type="button" data-card-id="${esc(card.id)}" ${state.revealed ? 'disabled' : ''}>
      <div class="card-image-wrap">
        ${card.image_url
          ? `<img class="card-image" src="${esc(card.image_url)}" alt="${esc(card.name)}" loading="lazy" />`
          : `<div class="card-art-placeholder">${esc(card.name)}</div>`}
      </div>
      <div class="card-body">
        <div class="card-name">${esc(card.name)}</div>
        ${state.revealed ? `<div class="card-reveal"><span class="card-prob">${pct(card.model_probability, 1)}</span><span class="card-rank">model #${rank}</span></div>` : ''}
      </div>
    </button>`;
}

function currentPick() {
  return state.replay.picks[state.pickIndex];
}

function renderFeedback(pick) {
  if (!state.revealed) return '';
  const result = state.results[state.results.length - 1];
  const historical = pick.candidates.find((card) => card.id === pick.historical_pick_id);
  return `
    <section class="feedback">
      <div class="feedback-top">
        <div>
          <p class="eyebrow">Pick graded</p>
          <h3>${esc(result.selectedName)}</h3>
        </div>
        <span class="verdict ${esc(result.verdictClass)}">${esc(result.verdict)}</span>
      </div>
      <div class="feedback-grid">
        <div class="feedback-stat"><small>Your likelihood</small><strong>${pct(result.selectedProbability, 1)}</strong></div>
        <div class="feedback-stat"><small>Consensus</small><strong>${esc(result.bestName)} · ${pct(result.bestProbability, 1)}</strong></div>
        <div class="feedback-stat"><small>Model rank</small><strong>#${esc(result.rank)}</strong></div>
        <div class="feedback-stat"><small>Historical</small><strong>${esc(historical?.name || 'Unknown')}${result.historicalMatch ? ' ✓' : ''}</strong></div>
      </div>
    </section>`;
}

function renderStudy() {
  const pick = currentPick();
  const total = state.replay.picks.length;
  const progress = ((state.pickIndex + (state.revealed ? 1 : 0)) / total) * 100;
  const selected = pick.candidates.find((card) => card.id === state.selectedCardId);

  app.innerHTML = `
    <section class="study-layout">
      <div class="study-main">
        <div class="study-header">
          <div>
            <div class="pick-kicker">P${esc(pick.pack_number)}P${esc(pick.pick_number)}</div>
            <div class="pick-title">Choose your pick</div>
          </div>
          <div class="progress-copy">Decision ${state.pickIndex + 1} of ${total}</div>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>

        <div class="pack-grid">${pick.candidates.map((card) => renderCard(card, pick)).join('')}</div>
        ${renderFeedback(pick)}

        <div class="action-dock">
          <div class="selection-copy">${selected ? `Selected: <strong>${esc(selected.name)}</strong>` : 'Select a card from the pack.'}</div>
          ${state.revealed
            ? `<button class="primary" id="next-pick">${state.pickIndex === total - 1 ? 'Finish draft' : 'Next pick'}</button>`
            : `<button class="primary" id="submit-pick" ${selected ? '' : 'disabled'}>Lock in pick</button>`}
        </div>
      </div>

      <aside class="study-sidebar">
        <section class="sidebar-card">
          <p class="sidebar-title">Historical pool entering pick</p>
          ${renderPool(pick.pool)}
        </section>
        <section class="sidebar-card">
          <p class="sidebar-title">Session</p>
          <div class="meta-list">
            <div class="meta-row"><span>Set</span><span>${esc(state.setData.name)}</span></div>
            <div class="meta-row"><span>Format</span><span>${esc(state.setData.format)}</span></div>
            <div class="meta-row"><span>Model</span><span>${esc(state.setData.model.model_version)}</span></div>
            <div class="meta-row"><span>Pool conditioned</span><span>${state.setData.model.pool_conditioned ? 'Yes' : 'No'}</span></div>
          </div>
        </section>
      </aside>
    </section>`;

  document.querySelectorAll('[data-card-id]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedCardId = button.dataset.cardId;
      renderStudy();
    });
  });
  document.querySelector('#submit-pick')?.addEventListener('click', submitPick);
  document.querySelector('#next-pick')?.addEventListener('click', nextPick);
}

function submitPick() {
  if (!state.selectedCardId || state.revealed) return;
  const pick = currentPick();
  const grade = gradePick(pick.candidates, state.selectedCardId, pick.historical_pick_id);
  state.results.push({
    ...grade,
    pack_number: pick.pack_number,
    pick_number: pick.pick_number,
  });
  state.revealed = true;
  renderStudy();
}

function nextPick() {
  if (state.pickIndex >= state.replay.picks.length - 1) {
    renderSummary();
    return;
  }
  state.pickIndex += 1;
  state.selectedCardId = null;
  state.revealed = false;
  renderStudy();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function methodNote() {
  if (state.setData.is_fixture) {
    return 'This replay is an interface fixture and must not be interpreted as 17Lands training data.';
  }
  const cohort = state.setData.cohort || {};
  const model = state.setData.model || {};
  return `Generated offline from the ${esc(state.setData.source?.provider || '17Lands')} public draft dataset. The model trained on ${Number(cohort.training_drafts || 0).toLocaleString()} high-win-rate drafts and uses ${esc(model.holdout || 'draft-level holdout')} so the replay being graded does not train its own probabilities. No model or 17Lands API is called while you study.`;
}

function renderSummary() {
  const summary = summarizeResults(state.results);
  app.innerHTML = `
    <section class="summary-card">
      <p class="eyebrow">Replay complete</p>
      <h1>Decision report</h1>
      <p class="lede">Consensus is the primary signal. Historical agreement is shown separately because a strong drafter can make a defensible choice that is not the model's top-ranked option.</p>

      <div class="summary-grid">
        <div class="summary-stat"><span>Consensus agreement</span><strong>${summary.consensusAgreement.toFixed(0)}%</strong></div>
        <div class="summary-stat"><span>Top-3 agreement</span><strong>${summary.topThreeAgreement.toFixed(0)}%</strong></div>
        <div class="summary-stat"><span>Historical agreement</span><strong>${summary.historicalAgreement.toFixed(0)}%</strong></div>
        <div class="summary-stat"><span>Avg. likelihood gap</span><strong>${(summary.averageGap * 100).toFixed(1)}pp</strong></div>
      </div>

      <h3>Largest disagreements</h3>
      <div class="miss-list">
        ${summary.biggestMisses.length ? summary.biggestMisses.map((result) => `
          <div class="miss-row">
            <div class="miss-pick">P${esc(result.pack_number)}P${esc(result.pick_number)}</div>
            <div class="miss-choice"><strong>${esc(result.selectedName)}</strong> vs consensus ${esc(result.bestName)}</div>
            <div class="miss-gap">-${(result.gap * 100).toFixed(1)}pp</div>
          </div>`).join('') : '<p class="empty-note">No meaningful consensus gaps in this replay.</p>'}
      </div>

      <p class="method-note">${methodNote()}</p>
      <div class="button-row">
        <button class="primary" id="another-replay">Study another replay</button>
        <button class="secondary" id="back-home">Change set</button>
      </div>
    </section>`;

  document.querySelector('#another-replay').addEventListener('click', startStudy);
  document.querySelector('#back-home').addEventListener('click', renderHome);
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
