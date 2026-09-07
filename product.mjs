import { gameShareUrl, makeGameSeed, seededRandom, cleanSeed } from './gameplay.mjs';

const SHARE_ORIGIN = 'https://magic.planitnow.us/';
let autoStarting = false;
let autoStarted = false;
let observer = null;

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
  const seed = freshSeed();
  seedGameRandom(seed);
  setGameUrl({ seed, mode, setId: currentSet() });
  return seed;
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

function resultCardsMarkup() {
  const cards = [...document.querySelectorAll('.opening-pack .card-choice')]
    .map((button) => ({
      rank: Number(button.querySelector('.user-rank-badge')?.textContent || 0),
      name: button.querySelector('.card-footer strong')?.textContent || '',
      image: button.querySelector('img')?.src || '',
    }))
    .filter((card) => card.rank)
    .sort((a, b) => a.rank - b.rank);
  if (!cards.length) return '';
  return `<section class="result-picks"><p class="result-label">Your three</p><div>${cards.map((card) => `<figure><span>${card.rank}</span>${card.image ? `<img src="${esc(card.image)}" alt="${esc(card.name)}">` : '<div class="result-card-blank"></div>'}<figcaption>${esc(card.name)}</figcaption></figure>`).join('')}</div></section>`;
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
  const text = `Pack 1 · ${mode === 'full' ? 'Full Pack' : 'Top 3'}\n${score}/100${grade ? ` (${grade})` : ''}\nPlay the exact same pack and beat me.`;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Making challenge…';
  try {
    const blob = await scoreImage({ score, grade, mode, setId: currentSet() });
    const file = blob ? new File([blob], 'pack1-result.png', { type: 'image/png' }) : null;
    if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ title: 'Pack 1', text, url, files: [file] });
    else if (navigator.share) await navigator.share({ title: 'Pack 1', text, url });
    else {
      await copyText(`${text}\n${url}`);
      button.textContent = 'Challenge copied';
    }
  } catch (error) {
    if (error?.name !== 'AbortError') {
      await copyText(`${text}\n${url}`).catch(() => null);
      button.textContent = 'Challenge copied';
    }
  }
  setTimeout(() => { button.disabled = false; button.textContent = original; }, 1300);
}

async function copySeededLink(button, mode) {
  const score = resultScore();
  await copyText(seededChallengeUrl(score, mode));
  const original = button.textContent;
  button.textContent = 'Link copied';
  setTimeout(() => { button.textContent = original; }, 1200);
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
  if (hero && !reveal.querySelector('.result-picks')) hero.insertAdjacentHTML('afterend', resultCardsMarkup());
  const score = resultScore(reveal);
  if (!reveal.querySelector('.friend-comparison')) {
    const comparison = friendComparisonMarkup(score);
    if (comparison) hero?.insertAdjacentHTML('afterend', comparison);
  }

  const actions = reveal.querySelector('.result-actions');
  const another = reveal.querySelector('#another-top3');
  const share = reveal.querySelector('#share-top3');
  const home = reveal.querySelector('#top3-home');
  if (another) another.textContent = isDailyResult(reveal) ? 'Play another game' : 'New pack';
  if (share) share.textContent = 'Challenge a friend';
  if (home) home.textContent = 'Home';
  if (actions && currentSeed()) addReplayButton(actions, 'top3');

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
  if (another) another.textContent = isDailyResult(scorecard) ? 'Play another game' : 'New pack';
  if (share) share.textContent = currentSeed() ? 'Challenge a friend' : 'Share score';
  if (home) home.textContent = 'Home';
  const actions = scorecard.querySelector('.result-actions');
  if (actions && currentSeed()) addReplayButton(actions, 'full');
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function replacePracticeLanguage(root = document) {
  const selectors = ['.game-instruction', '.action-dock span', '.challenge-status', '.leaderboard-note'];
  for (const node of root.querySelectorAll(selectors.join(','))) {
    const next = node.textContent
      .replace(/practice replay/gi, 'replay')
      .replace(/practice attempt/gi, 'replay')
      .replace(/Practice run\./g, 'Replay.')
      .replace(/Practice runs never count\./g, 'Only Daily Challenge runs count toward the board.');
    if (next !== node.textContent && !node.children.length) node.textContent = next;
  }
}

function enhanceHome() {
  const intro = document.querySelector('.home-intro');
  if (!intro || intro.dataset.redesigned === '1') return;
  intro.dataset.redesigned = '1';
  document.querySelector('#app')?.classList.add('home-page');
  const eyebrow = intro.querySelector('.eyebrow');
  const heading = intro.querySelector('h1');
  const lede = intro.querySelector('.lede');
  if (eyebrow) eyebrow.textContent = 'PACK 1';
  if (heading) heading.textContent = 'Make the pick. Defend it.';
  if (lede) lede.textContent = 'Real opening packs from strong drafts. Get a score, see where you disagreed, then send the exact same pack to somebody who thinks they can do better.';

  const daily = document.querySelector('.daily-card');
  if (daily) {
    daily.classList.add('daily-feature');
    const dailyHeading = daily.querySelector('h2');
    const dailyCopy = daily.querySelector('.daily-copy > p');
    if (dailyHeading) dailyHeading.textContent = 'Today’s Pack 1 is live.';
    if (dailyCopy) dailyCopy.textContent = 'One shared challenge, one ranked score. Everyone sees the same cards, so the leaderboard actually means something.';
  }

  const cards = [...document.querySelectorAll('.mode-card')];
  const labels = ['Opening pack', 'Full first pack'];
  const copy = [
    'Rank your top three from one fresh opening pack. Fast, opinionated, and built to argue about.',
    'Play every pick in Pack 1. Your choices get scored as the seat develops.',
  ];
  const points = [
    ['One pack', 'Top-three score', 'Share the exact seed'],
    ['Every first-pack pick', '100-point finish', 'Share the exact seed'],
  ];
  cards.forEach((card, index) => {
    card.classList.add('game-mode-row');
    const label = card.querySelector('.mode-topline .eyebrow');
    if (label) label.textContent = labels[index] || 'Game';
    const p = card.querySelector('p:not(.eyebrow)');
    if (p && copy[index]) p.textContent = copy[index];
    const list = card.querySelector('.mode-points');
    if (list && points[index]) list.innerHTML = points[index].map((item) => `<li>${esc(item)}</li>`).join('');
  });
  const top3Button = document.querySelector('[data-mode="top3"]');
  const fullButton = document.querySelector('[data-mode="full"]');
  if (top3Button) top3Button.textContent = 'Play Top 3';
  if (fullButton) fullButton.textContent = 'Play Full Pack';

  const note = document.querySelector('.data-note');
  if (note) {
    note.querySelector('strong').textContent = 'What counts';
    note.querySelector('span').textContent = 'Daily Challenge is the ranked competition. Top 3 and Full Pack are unlimited games: play as many as you want, chase your best score, and challenge friends on the exact same seeded pack.';
  }
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
  replacePracticeLanguage();
  autoStartSeededGame();
}

function captureGameClicks(event) {
  const modeButton = event.target.closest?.('[data-mode]');
  if (modeButton && !autoStarting) beginFreshGame(modeButton.dataset.mode);

  const another = event.target.closest?.('#another-top3, #another-full');
  if (another && currentSeed()) beginFreshGame(another.id.includes('top3') ? 'top3' : 'full');

  const shareFull = event.target.closest?.('#share-full');
  if (shareFull && currentSeed()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void shareSeededGame(shareFull, 'full');
  }
}

function finishGameClicks(event) {
  const wasTopThreeReveal = event.target?.id === 'reveal-top3' || event.target?.closest?.('#reveal-top3');
  const wasFinalFullPick = event.target?.id === 'next-pick' && /final score/i.test(event.target.textContent || '');
  if (!wasTopThreeReveal && !wasFinalFullPick) return;
  setTimeout(() => {
    if (wasTopThreeReveal) enhanceTopThreeResult();
    if (wasFinalFullPick) enhanceFullResult();
  }, 0);
}

export function installProductLayer() {
  document.body.classList.add('pack1-redesign');
  document.addEventListener('click', captureGameClicks, true);
  document.addEventListener('click', finishGameClicks, false);
  observer = new MutationObserver(enhance);
  const app = document.querySelector('#app');
  if (app) observer.observe(app, { childList: true, subtree: true });
  enhance();
}
