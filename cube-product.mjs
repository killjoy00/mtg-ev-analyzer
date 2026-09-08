import { makeGameSeed } from './gameplay.mjs';
import { utcDateKey } from './engagement.mjs';
import { onAppRender } from './render-lifecycle.mjs';

export const POWERED_CUBE_ID = 'powered-cube';
const MODES = new Set(['top3', 'full']);

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function freshSeed() {
  return makeGameSeed(globalThis.crypto?.randomUUID ? () => crypto.randomUUID() : null);
}

export function poweredCubeUrl({
  origin = 'https://magic.planitnow.us/',
  mode = 'top3',
  daily = null,
  seed = null,
} = {}) {
  if (!MODES.has(mode)) throw new Error(`Unsupported Powered Cube mode: ${mode}`);
  const url = new URL(origin);
  url.searchParams.set('set', POWERED_CUBE_ID);
  url.searchParams.set('mode', mode);
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
  const top3 = poweredCubeUrl({ origin, mode: 'top3' });
  const full = poweredCubeUrl({ origin, mode: 'full' });
  const dailyTop3 = poweredCubeUrl({ origin, mode: 'top3', daily: today });
  const dailyFull = poweredCubeUrl({ origin, mode: 'full', daily: today });

  return `
    <section class="mode-section cube-mode-section" data-powered-cube-section="1" aria-labelledby="powered-cube-heading">
      <div class="mode-section-heading">
        <div><p class="eyebrow">Special format</p><h2 id="powered-cube-heading">Powered Cube</h2></div>
        <p>Vintage power, broken mana, and one real 17Lands Cube seat. Powered Cube has its own games and its own leaderboard filter; it is not part of the expansion-set picker.</p>
      </div>
      <div class="mode-grid" aria-label="Powered Cube modes">
        <article class="mode-card game-mode-row cube-mode-card">
          <div class="mode-topline"><p class="eyebrow">Opening pack</p><span class="best-chip">Powered Cube</span></div>
          <h3>Cube Top 3</h3>
          <p>Rank the three cards you would start with from a complete Powered Cube P1P1.</p>
          <div class="button-row">
            <a class="button primary" href="${esc(dailyTop3)}">Today’s Cube</a>
            <a class="button secondary" href="${esc(top3)}">New Top 3</a>
          </div>
        </article>
        <article class="mode-card game-mode-row cube-mode-card">
          <div class="mode-topline"><p class="eyebrow">Full first pack</p><span class="best-chip">Powered Cube</span></div>
          <h3>Cube Full Pack</h3>
          <p>Make every Pack One pick from a real Cube seat, with later support adapting to the cards you take.</p>
          <div class="button-row">
            <a class="button primary" href="${esc(dailyFull)}">Today’s Full Pack</a>
            <a class="button secondary" href="${esc(full)}">New Full Pack</a>
          </div>
        </article>
      </div>
      <p class="set-meta">Powered Cube Daily scores use the Powered Cube board under Leaders. Practice games remain unlimited.</p>
    </section>`;
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
    // Returning Home from a Cube game leaves app.js pointed at the Cube dataset.
    // Fire the existing set-change handler once so ordinary Set Draft buttons
    // cannot accidentally start another Cube game.
    if (wasCubeSelected && select.options.length) {
      select.value = select.options[0].value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
  }

  if (document.querySelector('[data-powered-cube-section="1"]')) return;
  const standardModes = document.querySelector('.mode-section');
  if (!standardModes) return;
  standardModes.insertAdjacentHTML('beforebegin', cubeSectionMarkup());
}

function enhanceLeaderboard() {
  const select = document.querySelector('#leader-set');
  if (!select) return;
  const cube = [...select.options].find((option) => option.value === POWERED_CUBE_ID);
  if (!cube) return;
  const label = select.closest('label')?.querySelector('span');
  if (label) label.textContent = 'Environment';
  const all = [...select.options].find((option) => option.value === 'all');
  if (all) all.textContent = 'All standard sets';
  cube.textContent = 'Powered Cube';
}

function enhance() {
  enhanceHome();
  enhanceLeaderboard();
}

export function installPoweredCubeLayer() {
  onAppRender(enhance);
}
