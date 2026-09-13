import { gameShareUrl, makeGameSeed, seededRandom, cleanSeed } from './gameplay.mjs';
import { onAppRender } from './render-lifecycle.mjs';
import { preloadSeededReplay } from './replay-data.mjs';

const SHARE_ORIGIN = 'https://packone.pro/';
const LOW_SUPPORT_THRESHOLD = 0.08;
const LOW_SUPPORT_COPY = 'Low support: under 8% modeled strong-player support. A card can still sit near the top when support below the leader is thin.';
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

function supportPercent(text) {
  const match = String(text || '').match(/([0-9]+(?:\.[0-9]+)?)%/);
  return match ? Number(match[1]) : null;
}

function isLowSupport(percent) {
  return Number.isFinite(percent) && percent < LOW_SUPPORT_THRESHOLD * 100;
}

function makeLowSupportFlag(percent) {
  const flag = document.createElement('span');
  flag.className = 'best-chip support-outlier-flag';
  flag.textContent = 'Low support';
  flag.title = LOW_SUPPORT_COPY;
  flag.setAttribute('aria-label', `${Number(percent).toFixed(1)}% support. ${LOW_SUPPORT_COPY}`);
  return flag;
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
  ctx.fillText('packone.pro', 60, 576);
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

function replaySeededGame() {
  const url = new URL(window.location.href);
  url.searchParams.delete('vs');
  url.searchParams.delete('by');
  window.location.href = url.toString();
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

function enhanceFullPickFeedback() {
  const feedback = document.querySelector('.pick-feedback');
  if (!feedback || feedback.dataset.supportPresentation === '1') return;
  feedback.dataset.supportPresentation = '1';

  const selectedFooter = document.querySelector('.study-main .card-choice.selected .card-footer span');
  const selectedPercent = supportPercent(selectedFooter?.textContent || '');
  const cells = [...feedback.querySelectorAll('.feedback-grid > div')];

  const leaderCell = cells.find((cell) => /^Consensus$/i.test(cell.querySelector('span')?.textContent || ''));
  if (leaderCell) leaderCell.querySelector('span').textContent = 'Strong-player leader';

  const rankCell = cells.find((cell) => /Consensus rank/i.test(cell.querySelector('span')?.textContent || ''));
  if (rankCell && Number.isFinite(selectedPercent)) {
    const label = rankCell.querySelector('span');
    const value = rankCell.querySelector('strong');
    if (label) label.textContent = 'Your support';
    if (value) {
      value.textContent = `${selectedPercent.toFixed(1)}%`;
      if (isLowSupport(selectedPercent) && !value.querySelector('.support-outlier-flag')) {
        value.append(' ', makeLowSupportFlag(selectedPercent));
      }
    }
  }

  const gapCell = cells.find((cell) => /Consensus gap/i.test(cell.querySelector('span')?.textContent || ''));
  if (gapCell) gapCell.querySelector('span').textContent = 'Support gap';
}

function enhanceFullPickDock() {
  const dock = document.querySelector('.study-main .action-dock.inline-dock');
  const next = dock?.querySelector('#next-pick');
  const feedback = document.querySelector('.pick-feedback');
  if (!dock || !next || !feedback || dock.dataset.floatingScore === '1') return;
  dock.dataset.floatingScore = '1';

  const score = feedback.querySelector('.pick-score strong')?.textContent?.trim();
  const verdict = feedback.querySelector('.feedback-title h2')?.textContent?.trim();
  const selected = feedback.querySelector('.feedback-grid > div:first-child strong')?.textContent?.trim();
  const info = dock.firstElementChild;
  const strong = info?.querySelector('strong');
  const span = info?.querySelector('span');

  if (strong && score) strong.textContent = `${score}/100${verdict ? ` · ${verdict}` : ''}`;
  if (span) span.textContent = selected ? `You took ${selected}` : 'Pick scored.';
}

function enhanceConsensusPresentation() {
  const note = document.querySelector('.data-note span');
  if (note && note.dataset.compactCopy !== '1') {
    note.dataset.compactCopy = '1';
    note.textContent = 'Consensus is a model of experienced, high-win-rate 17Lands drafters. Opening-pack support starts from the current pack; in Full Pack, later support also follows the cards you actually chose. Only Daily Challenge scores rank.';
  }

  const scoreContext = document.querySelector('.score-context');
  if (scoreContext && scoreContext.textContent !== 'Consensus alignment score.') {
    scoreContext.textContent = 'Consensus alignment score.';
  }

  document.querySelectorAll('.card-choice .card-footer span').forEach((footer) => {
    const text = footer.textContent || '';
    const match = text.match(/^([0-9.]+%)\s*·\s*consensus #\d+(.*)$/i);
    if (match) footer.textContent = `${match[1]} consensus support${match[2] || ''}`;

    const percent = supportPercent(footer.textContent || '');
    if (isLowSupport(percent) && footer.dataset.lowSupport !== '1') {
      footer.dataset.lowSupport = '1';
      footer.textContent = `${footer.textContent} · Low support`;
      footer.title = LOW_SUPPORT_COPY;
      footer.setAttribute('aria-label', `${Number(percent).toFixed(1)}% consensus support. ${LOW_SUPPORT_COPY}`);
    }
  });

  document.querySelectorAll('.card-choice').forEach((button) => {
    const footer = button.querySelector('.card-footer span')?.textContent || '';
    const support = footer.match(/([0-9.]+%)/)?.[1];
    const percent = supportPercent(footer);
    const badge = button.querySelector('.consensus-badge');
    if (badge && support && badge.textContent !== support) badge.textContent = support;
    if (badge && isLowSupport(percent)) {
      badge.title = LOW_SUPPORT_COPY;
      badge.setAttribute('aria-label', `${Number(percent).toFixed(1)}% support. ${LOW_SUPPORT_COPY}`);
    }
  });

  const supportColumn = document.querySelector('.top3-comparison > div:nth-child(2)');
  if (supportColumn) {
    const heading = supportColumn.querySelector('h3');
    if (heading && heading.textContent !== 'Strong-player support') heading.textContent = 'Strong-player support';
    supportColumn.querySelectorAll('.rank-row > span').forEach((rank) => {
      if (!rank.hidden) rank.hidden = true;
    });
    supportColumn.querySelectorAll('.rank-row').forEach((row) => {
      const support = supportPercent(row.querySelector('small')?.textContent || '');
      const name = row.querySelector('strong');
      if (name && isLowSupport(support) && !name.querySelector('.support-outlier-flag')) {
        name.append(' ', makeLowSupportFlag(support));
      }
    });
  }

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
  enhanceFullPickFeedback();
  enhanceFullPickDock();
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
    return;
  }

  const replay = event.target.closest?.('[data-replay-seed]');
  if (replay && currentSeed()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    replaySeededGame();
    return;
  }

  const copy = event.target.closest?.('[data-copy-challenge-link]');
  if (copy && currentSeed()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const mode = copy.dataset.copyChallengeLink;
    if (mode === 'top3' || mode === 'full') void copySeededLink(copy, mode);
  }
}

export function installProductLayer() {
  document.body.classList.add('pack1-redesign');
  document.addEventListener('click', captureGameClicks, true);
  onAppRender(enhance);
}
