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
    <section class="mode-section cube-mode-section" data-powered-cube-section="1" aria-labelledby="powered-cube-heading">
      <div class="mode-section-heading">
        <div><p class="eyebrow">Special format</p><h2 id="powered-cube-heading">Powered Cube</h2></div>
        <p>Ten decisions from high-quality drafters who trophied in Powered Cube. The source omits full P1P1 packs, so start at P1P2 with the drafter’s real first pick visible.</p>
      </div>
      <div class="mode-grid cube-single-mode" aria-label="Powered Cube mode">
        <article class="mode-card game-mode-row cube-mode-card">
          <div class="mode-topline"><p class="eyebrow">10 trophy decisions</p><span class="best-chip">Powered Cube</span></div>
          <h3>Powered Cube Run</h3>
          <p>Read a different trophy drafter’s pool at each decision. Match their pick for 100 points. You get two pack rerolls, both from other Powered Cube trophy runs.</p>
          <div class="button-row">
            <button class="button primary" type="button" data-cube-href="${esc(daily)}">Today’s Cube</button>
            <button class="button secondary" type="button" data-cube-href="${esc(run)}">New Cube Run</button>
          </div>
        </article>
      </div>
      <p class="set-meta">A separate Daily, leaderboard, and friend challenge flow. Every pack stays inside Powered Cube.</p>
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
