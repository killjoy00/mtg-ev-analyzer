import { onAppRender } from './render-lifecycle.mjs';

function currentParams() {
  return new URLSearchParams(window.location.search);
}

function setHidden(selector, hidden) {
  document.querySelectorAll(selector).forEach((node) => {
    if (node.hidden !== hidden) node.hidden = hidden;
  });
}

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function ensureTabs(home, moreModes) {
  let tabs = document.querySelector('[data-home-mode-tabs="1"]');
  if (!tabs) {
    home.insertAdjacentHTML('afterend', `
      <nav class="home-mode-tabs" data-home-mode-tabs="1" aria-label="Pack One game modes">
        <a href="./" data-home-tab="primary">Draft Run + Cube</a>
        <a href="?modes=1" data-home-tab="more">More modes</a>
      </nav>`);
    tabs = document.querySelector('[data-home-mode-tabs="1"]');
  }
  tabs?.querySelector('[data-home-tab="primary"]')?.classList.toggle('active', !moreModes);
  tabs?.querySelector('[data-home-tab="more"]')?.classList.toggle('active', moreModes);
  tabs?.querySelector('[data-home-tab="primary"]')?.setAttribute('aria-current', moreModes ? 'false' : 'page');
  tabs?.querySelector('[data-home-tab="more"]')?.setAttribute('aria-current', moreModes ? 'page' : 'false');
}

function normalizePracticeModeOrder() {
  const grid = document.querySelector('.mode-grid[aria-label="Opening pack practice"]');
  const fullPack = grid?.querySelector('[data-mode="full"]')?.closest('.mode-card');
  const topThree = grid?.querySelector('[data-mode="top3"]')?.closest('.mode-card');
  if (grid && fullPack && topThree && grid.firstElementChild !== fullPack) {
    grid.insertBefore(fullPack, topThree);
  }
}

function normalizeResultActions() {
  const challenge = document.querySelector('.result-actions .result-challenge');
  if (!challenge) return;
  challenge.classList.remove('primary');
  challenge.classList.add('secondary');
}

function enhanceHome() {
  // Result surfaces render through the same lifecycle. Keep one primary action:
  // New pack. Challenge/replay/home remain clearly available but secondary.
  normalizeResultActions();

  const home = document.querySelector('.home-intro');
  if (!home) return;

  const moreModes = currentParams().get('modes') === '1';
  document.querySelector('#app')?.classList.toggle('more-modes-home', moreModes);
  ensureTabs(home, moreModes);
  normalizePracticeModeOrder();

  // The landing page is deliberately focused: Draft Run and Powered Cube only.
  // More Modes is the set-by-set opening-pack Top 3 and Full Pack practice surface.
  setHidden('.set-bar', !moreModes);
  setHidden('.mode-section:not(.cube-mode-section)', !moreModes);
  setHidden('.data-note', !moreModes);
  setHidden('.draft-run-feature', moreModes);
  setHidden('.cube-mode-section', moreModes);

  const editorial = document.querySelector('#home-editorial');
  if (editorial && editorial.hidden !== !moreModes) editorial.hidden = !moreModes;

  setText(
    home.querySelector('.lede'),
    moreModes
      ? 'Play Top 3 or draft the full first pack across every supported set.'
      : 'Ten pack one choices for you to make across real trophy drafts.',
  );
}

export function installHomeProductLayer() {
  if (!document.querySelector('[data-home-product-style]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './home-product.css';
    link.dataset.homeProductStyle = '1';
    document.head.appendChild(link);
  }
  onAppRender(enhanceHome);
}
