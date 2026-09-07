import { gameShareUrl, makeGameSeed, seededRandom, cleanSeed } from './gameplay.mjs';
import { onAppRender } from './render-lifecycle.mjs';
import { preloadSeededReplay } from './replay-data.mjs';

const SHARE_ORIGIN = 'https://magic.planitnow.us/';
let autoStarting = false;
let autoStarted = false;
let preparedNextGame = null;

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function params() { return new URLSearchParams(window.location.search); }
function currentSeed() { return cleanSeed(params().get('seed')); }
function currentMode() { return ['top3', 'full'].includes(params().get('mode')) ? params().get('mode') : null; }
function currentSet() { return params().get('set') || document.querySelector('#set-select')?.value || ''; }
function playerName() {
  try { return localStorage.getItem('pack1-player-name-v1') || 'Pack Player'; } catch { return 'Pack Player'; }
}

export function seedGameRandom(seed) {
  const cleaned = cleanSeed(seed);
  if (!cleaned) return null;
  window.PACK1_GAME_SEED = cleaned;
  Math.random = seededRandom(cleaned);
  return cleaned;
}

function freshSeed() {
  return makeGameSeed(globalThis.crypto?.randomUUID ? () => crypto.randomUUID() : null);
}

function setGameUrl({ seed, mode, setId, score = null, name = null, replace = true }) {
  const url = new URL(gameShareUrl({ origin: SHARE_ORIGIN, setId, mode, seed, score, name }));
  const method = replace ? 'replaceState' : 'pushState';
  history[method]({}, '', `${url.pathname}${url.search}`);
  return url.toString();
}

function beginFreshGame(mode) {
  const setId = currentSet();
  const prepared = preparedNextGame?.mode === mode && preparedNextGame?.setId === setId ? preparedNextGame : null;
  const seed = prepared?.seed || freshSeed();
  preparedNextGame = null;
  seedGameRandom(seed);
  setGameUrl({ seed, mode, setId });
  return seed;
}

function prepareNextGame(mode) {
  const setId = currentSet();
  const sourceSeed = currentSeed();
  if (!setId || !sourceSeed || !mode) return;
  const key = `${setId}:${mode}:${sourceSeed}`;
  if (preparedNextGame?.key === key) return;
  const seed = freshSeed();
  preparedNextGame = { key, setId, mode, seed };
  void preloadSeededReplay({ setId, seed }).catch(() => null);
}

function emitShareCompleted(method, context = 'challenge') {
  document.dispatchEvent(new CustomEvent('pack1:share-completed', {
    detail: { method, context, challenge: true },
  }));
}

function resultScore(root = document) {
  return Number(root.querySelector('.score-orb strong')?.textContent || 0);
}

function isDailyResult(root) {
  const text = root.querySelector('.eyebrow')?.textContent || '';
  return /daily challenge/i.test(text);
}

function friendComparisonMarkup(score) {
  const query = params();
  if (!query.has('vs')) return '';
  const target = Number(query.get('vs'));
  if (!Number.isFinite(target)) return '';
  const by = query.get('by') || 'Your friend';
  const result = score > target ? 'You beat it.' : score === target ? 'Dead even.' : `${target - score} points short.`;
  return `<section class="friend-comparison"><span>Friend challenge</span><div><strong>${esc(by)}</strong><b>${target}</b><i>vs</i><strong>You</strong><b>${score}</b></div><p>${esc(result)}</p></section>`;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const field = document.createElement('textarea');
  field.value = text;
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  document.execCommand('copy');
  field.remove();
}

async function scoreImage({ score, grade, mode, setId }) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f7f7f5';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#171918';
  ctx.fillRect(0, 0, 1200, 16);
  ctx.font = '800 30px Arial, sans-serif';
  ctx.fillText('PACK 1', 58, 74);
  ctx.font = '800 126px Arial, sans-serif';
  ctx.fillText(String(score), 54, 225);
  ctx.font = '800 32px Arial, sans-serif';
  ctx.fillText(`/ 100   ${grade}`, 60, 278);
  ctx.font = '800 44px Arial, sans-serif';
  ctx.fillText(mode === 'full' ? 'Full Pack' : 'Top 3', 60, 372);
  ctx.font = '600 24px Arial, sans-serif';
  ctx.fillText(String(setId || '').toUpperCase(), 62, 416);
  ctx.strokeStyle = '#171918';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(60, 470);
  ctx.lineTo(1140, 470);
  ctx.stroke();
  ctx.font = '700 26px Arial, sans-serif';
  ctx.fillText('Same pack. Your picks. Beat my score.', 60, 532);
  ctx.font = '600 20px Arial, sans-serif';
  ctx.fillText('magic.planitnow.us', 60, 576);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', .94));
}

function seededChallengeUrl(score, mode = currentMode()) {
  const seed = currentSeed();
  if (!seed || !mode) return SHARE_ORIGIN;
  return gameShareUrl({
    origin: SHARE_ORIGIN,
    setId: currentSet(),
    mode,
    seed,
    score,
    name: playerName(),
  });
}

async function shareSeededGame(button, mode) {
  const score = resultScore();
  const grade = document.querySelector('.grade-badge')?.textContent || '';
  const url = seededChallengeUrl(score, mode);
  const challenger = playerName();
  const text = `${challenger} scored ${score}/100 in Pack One ${mode === 'full' ? 'Full Pack' : 'Top 3'}${grade ? ` (${grade})` : ''}.
Same exact pack. Can you beat that?`;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Making challenge…';
  try {
    const blob = await scoreImage({ score, grade, mode, setId: currentSet() });
    const file = blob ? new File([blob], 'pack1-result.png', { type: 'image/png' }) : null;
    if (file && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title: 'Pack One challenge', text, url, files: [file] });
      emitShareCompleted('native_file', 'result_challenge');
    } else if (navigator.share) {
      await navigator.share({ title: 'Pack One challenge', text, url });
      emitShareCompleted('native', 'result_challenge');
    } else {
      await copyText(`${text}
${url}`);
      button.textContent = 'Challenge copied';
      emitShareCompleted('copy_fallback', 'result_challenge');
    }
  } catch (error) {
    if (error?.name !== 'AbortError') {
      await copyText(`${text}
${url}`).catch(() => null);
      button.textContent = 'Challenge copied';
      emitShareCompleted('copy_fallback', 'result_challenge');
    }
  }
  setTimeout(() => { button.disabled = false; button.textContent = original; }, 1300);
}

async function copySeededLink(button, mode) {
  const score = resultScore();
  await copyText(seededChallengeUrl(score, mode));
  emitShareCompleted('copy_link', 'result_challenge');
  const original = button.textContent;
  button.textContent = 'Link copied';
  setTimeout(() => { button.textContent = original; }, 1200);
}

function prioritizeResultActions(actions, share, another) {
  if (!actions || !share || !another) return;

  another.textContent = 'New pack';
  another.classList.remove('secondary');
  another.classList.add('primary', 'result-new-pack');

  share.textContent = 'Challenge a friend';
  share.classList.remove('share-button', 'secondary', 'challenge-primary');
  share.classList.add('primary', 'result-challenge');

  const leaderboard = actions.querySelector('#challenge-leaders');
  if (leaderboard) {
    leaderboard.classList.remove('primary');
    leaderboard.classList.add('secondary');
  }

  // The two obvious next steps are deliberately first, in this order.
  actions.prepend(share);
  actions.prepend(another);
}

function addReplayButton(actions, mode) {
  if (!currentSeed() || actions.querySelector('[data-replay-seed]')) return;
  const replay = document.createElement('button');
  replay.type = 'button';
  replay.className = 'button secondary result-replay-button';
  replay.dataset.replaySeed = '1';
  replay.textContent = 'Replay this pack';
  replay.addEventListener('click', () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('vs');
    url.searchParams.delete('by');
    window.location.href = url.toString();
  });
  actions.appendChild(replay);

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'text-button result-copy-link';
  copy.textContent = 'Copy challenge link';
  copy.addEventListener('click', () => void copySeededLink(copy, mode));
  actions.appendChild(copy);
}

function enhanceTopThreeResult() {
  const reveal = document.querySelector('.reveal-panel');
  if (!reveal || reveal.dataset.dedicatedResult === '1') return;
  reveal.dataset.dedicatedResult = '1';
  reveal.classList.add('result-page', 'top3-result-page');
  document.querySelector('.game-heading')?.classList.add('result-hidden-source');
  document.querySelector('.opening-pack')?.classList.add('result-hidden-source');
  document.querySelector('.action-dock')?.classList.add('result-hidden-source');

  const eyebrow = reveal.querySelector(':scope > .eyebrow');
  if (eyebrow) eyebrow.textContent = isDailyResult(reveal) ? 'Today’s result' : 'Game result';

  const hero = reveal.querySelector('.score-hero');
  const score = resultScore(reveal);
  if (!reveal.querySelector('.friend-comparison')) {
    const comparison = friendComparisonMarkup(score);
    if (comparison) hero?.insertAdjacentHTML('afterend', comparison);
  }

  const actions = reveal.querySelector('.result-actions');
  const another = reveal.querySelector('#another-top3');
  const share = reveal.querySelector('#share-top3');
  const home = reveal.querySelector('#top3-home');
  if (home) home.textContent = 'Home';
  prioritizeResultActions(actions, share, another);
  if (actions && currentSeed()) addReplayButton(actions, 'top3');
  prepareNextGame('top3');

  window.scrollTo({ top: 0, behavior: 'auto' });
}

function enhanceFullResult() {
  const scorecard = document.querySelector('.scorecard');
  if (!scorecard || scorecard.dataset.dedicatedResult === '1') return;
  scorecard.dataset.dedicatedResult = '1';
  scorecard.classList.add('result-page', 'full-result-page');
  const eyebrow = scorecard.querySelector(':scope > .eyebrow');
  if (eyebrow) eyebrow.textContent = isDailyResult(scorecard) ? 'Today’s result' : 'Game result';
  const score = resultScore(scorecard);
  const hero = scorecard.querySelector('.score-hero');
  if (!scorecard.querySelector('.friend-comparison')) {
    const comparison = friendComparisonMarkup(score);
    if (comparison) hero?.insertAdjacentHTML('afterend', comparison);
  }
  const another = scorecard.querySelector('#another-full');
  const share = scorecard.querySelector('#share-full');
  const home = scorecard.querySelector('#summary-home');
  if (home) home.textContent = 'Home';
  const actions = scorecard.querySelector('.result-actions');
  prioritizeResultActions(actions, share, another);
  if (actions && currentSeed()) addReplayButton(actions, 'full');
  prepareNextGame('full');
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function enhanceHome() {
  const app = document.querySelector('#app');
  const intro = document.querySelector('.home-intro');
  const isHome = Boolean(intro);
  app?.classList.toggle('home-page', isHome);
  document.body.classList.toggle('is-game', !isHome);
}

function enhanceConsensusPresentation() {
  const note = document.querySelector('.data-note span');
  if (note && note.dataset.compactCopy !== '1') {
    note.dataset.compactCopy = '1';
    note.textContent = 'Consensus is a model of experienced, high-win-rate 17Lands drafters. It compares how much support each card gets in the current pack and historical pool. Your score measures how closely your choices track that model; only Daily Challenge scores rank.';
  }

  document.querySelectorAll('.opening-pack .card-footer span').forEach((footer) => {
    const text = footer.textContent || '';
    const match = text.match(/^([0-9.]+%)\s*·\s*consensus #\d+(.*)$/i);
    if (!match) return;
    footer.textContent = `${match[1]} consensus support${match[2] || ''}`;
  });

  // Ordinal ranks can overstate a tiny tail of support (for example, a 4% #2
  // behind an 82% #1). If the social layer adds a bold-take note, show the
  // actual support rather than repeating the ordinal rank.
  const boldTake = document.querySelector('.bold-take small');
  if (boldTake) {
    const firstChoice = [...document.querySelectorAll('.opening-pack .card-choice')]
      .find((button) => button.querySelector('.user-rank-badge')?.textContent?.trim() === '1');
    const footer = firstChoice?.querySelector('.card-footer span')?.textContent || '';
    const support = footer.match(/([0-9.]+%)/)?.[1];
    const copy = support ? `${support} strong-player support.` : '';
    if (copy && boldTake.textContent !== copy) boldTake.textContent = copy;
  }

  document.querySelectorAll('.opening-pack .card-image').forEach((image, index) => {
    image.loading = 'eager';
    if (index < 8) image.fetchPriority = 'high';
  });
}

function autoStartSeededGame() {
  if (autoStarted) return;
  const seed = currentSeed();
  const mode = currentMode();
  if (!seed || !mode) return;
  const button = document.querySelector(`[data-mode="${mode}"]`);
  if (!button) return;
  autoStarted = true;
  autoStarting = true;
  seedGameRandom(seed);
  button.click();
  autoStarting = false;
}

function enhance() {
  enhanceHome();
  enhanceTopThreeResult();
  enhanceFullResult();
  enhanceConsensusPresentation();
  autoStartSeededGame();
}

function captureGameClicks(event) {
  const modeButton = event.target.closest?.('[data-mode]');
  if (modeButton && !autoStarting) beginFreshGame(modeButton.dataset.mode);

  const another = event.target.closest?.('#another-top3, #another-full');
  if (another && currentSeed()) beginFreshGame(another.id.includes('top3') ? 'top3' : 'full');

  const share = event.target.closest?.('#share-top3, #share-full');
  if (share && currentSeed()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void shareSeededGame(share, share.id === 'share-full' ? 'full' : 'top3');
  }
}

export function installProductLayer() {
  document.body.classList.add('pack1-redesign');
  document.addEventListener('click', captureGameClicks, true);
  onAppRender(enhance);
}
