import { makeGameSeed } from './gameplay.mjs';
import { utcDateKey } from './engagement.mjs';
import { onAppRender } from './render-lifecycle.mjs';

export const POWERED_CUBE_ID = 'powered-cube';
const MODES = new Set(['full']);

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function freshSeed() {
  return makeGameSeed(globalThis.crypto?.randomUUID ? () => crypto.randomUUID() : null);
}

export function poweredCubeUrl({
  origin = 'https://packone.pro/',
  mode = 'full',
  daily = null,
  seed = null,
} = {}) {
  if (!MODES.has(mode)) throw new Error(`Unsupported Powered Cube mode: ${mode}`);
  const url = new URL(origin);
  url.searchParams.set('set', POWERED_CUBE_ID);
  url.searchParams.set('game', 'draft-run');
  if (daily) url.searchParams.set('daily', String(daily));
  else url.searchParams.set('seed', seed || freshSeed());
  return url.toString();
}

function currentParams() {
  return new URLSearchParams(window.location.search);
}

function isLaunchingCube() {
  const query = currentParams();
  return query.get('set') === POWERED_CUBE_ID && MODES.has(query.get('mode'));
}

function homeOrigin() {
  return `${window.location.origin}/`;
}

function cubeSectionMarkup() {
  const today = utcDateKey();
  const origin = homeOrigin();
  const run = poweredCubeUrl({ origin, mode: 'full' });
  const daily = poweredCubeUrl({ origin, mode: 'full', daily: today });

  return `
    <section class="draft-run-feature cube-run-feature mode-section cube-mode-section" data-powered-cube-section="1" aria-labelledby="powered-cube-heading">
      <div>
        <p class="eyebrow">Powered Cube</p>
        <h2 id="powered-cube-heading">Ten cube picks.<br>Your call.</h2>
        <p>Real trophy drafts. Two pack rerolls, with every decision staying inside Powered Cube.</p>
      </div>
      <div class="draft-run-feature-actions" aria-label="Powered Cube runs">
        <button class="button primary" type="button" data-cube-href="${esc(daily)}">Play today’s Cube</button>
        <button class="button secondary" type="button" data-cube-href="${esc(run)}">Practice a Cube Run</button>
        <small>Starts at P1P2 with the trophy drafter’s real first pick visible</small>
      </div>
    </section>`;
}

function bindCubeLaunchers(root = document) {
  root.querySelectorAll('[data-cube-href]').forEach((button) => {
    if (button.dataset.cubeBound === '1') return;
    button.dataset.cubeBound = '1';
    button.addEventListener('click', () => {
      window.location.href = button.dataset.cubeHref;
    });
  });
}

function redirectUnsupportedCubeMode() {
  const query = currentParams();
  if (query.get('set') !== POWERED_CUBE_ID) return false;
  const mode = query.get('mode');
  if (!mode || MODES.has(mode)) return false;
  query.set('mode', 'full');
  window.location.replace(`${window.location.pathname}?${query.toString()}`);
  return true;
}

function enhanceHome() {
  const home = document.querySelector('.home-intro');
  const select = document.querySelector('#set-select');
  if (!home || !select) return;

  const cubeOption = [...select.options].find((option) => option.value === POWERED_CUBE_ID);
  if (!cubeOption) return; // Data build has not published the mode yet.

  const wasCubeSelected = select.value === POWERED_CUBE_ID;
  if (!isLaunchingCube()) {
    cubeOption.remove();
    // A Cube result can return through app.js with its dataset still selected.
    // Reconstruct Home from a clean URL instead of mutating the practice-only
    // set control; the clean load restores the featured expansion deterministically.
    if (wasCubeSelected) {
      window.location.replace(homeOrigin());
      return;
    }
  }

  if (!document.querySelector('[data-powered-cube-section="1"]')) {
    const standardModes = document.querySelector('.mode-section');
    if (!standardModes) return;
    standardModes.insertAdjacentHTML('beforebegin', cubeSectionMarkup());
  }
  bindCubeLaunchers();
}

function enhanceCubeGame() {
  if (!isLaunchingCube()) return;
  const heading = document.querySelector('.game-heading');
  if (heading) {
    const eyebrow = heading.querySelector('.eyebrow');
    const daily = currentParams().has('daily');
    setText(eyebrow, daily ? 'Powered Cube Daily · Pack Run' : 'Powered Cube · Pack Run');

    const instruction = heading.querySelector('.game-instruction');
    if (instruction && !instruction.dataset.cubeExplained) {
      instruction.dataset.cubeExplained = '1';
      instruction.textContent = `${instruction.textContent} Your pool begins with the real drafter’s P1P1 because Arena does not expose that opening pack’s full contents.`;
    }
  }

  const poolHeading = document.querySelector('.replay-sidebar .sidebar-card h3');
  setText(poolHeading, 'Your pool · inherited P1P1 included');

  const fixedCard = document.querySelector('.replay-sidebar .sidebar-card.quiet');
  if (fixedCard) {
    setText(fixedCard.querySelector('h3'), 'Why Cube starts at P1P2');
    setText(fixedCard.querySelector('p'), 'Arena’s Powered Cube logs omit the complete P1P1 pack. Pack One uses the historical first card as your starting pool, then gives you every real, fully observed pack from P1P2 onward. Wheel picks are feedback-only after your path diverges.');
  }

  const summaryEyebrow = document.querySelector('.scorecard > .eyebrow');
  setText(summaryEyebrow, 'Powered Cube Pack Run complete');
}

function enhanceLeaderboard() {
  const select = document.querySelector('#leader-set');
  if (!select) return;
  const cube = [...select.options].find((option) => option.value === POWERED_CUBE_ID);
  if (!cube) return;
  setText(select.closest('label')?.querySelector('span'), 'Environment');
  setText(cube, 'Powered Cube');
}

function enhance() {
  enhanceHome();
  enhanceCubeGame();
  enhanceLeaderboard();
}

export function installPoweredCubeLayer() {
  if (redirectUnsupportedCubeMode()) return;
  onAppRender(enhance);
}
