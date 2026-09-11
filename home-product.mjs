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

function enhanceHome() {
  const home = document.querySelector('.home-intro');
  if (!home) return;

  const moreModes = currentParams().get('modes') === '1';
  ensureTabs(home, moreModes);

  // The landing page is deliberately focused: Draft Run and Powered Cube only.
  // The existing opening-pack Daily, Top 3, Full Pack, and Set Practice UI is
  // preserved intact behind the secondary tab rather than deleted or forked.
  setHidden('.set-bar', !moreModes);
  setHidden('.daily-feature', !moreModes);
  setHidden('.mode-section:not(.cube-mode-section)', !moreModes);
  setHidden('.data-note', !moreModes);
  setHidden('.draft-run-feature', moreModes);
  setHidden('.cube-mode-section', moreModes);

  const editorial = document.querySelector('#home-editorial');
  if (editorial && editorial.hidden !== !moreModes) editorial.hidden = !moreModes;

  setText(
    home.querySelector('.lede'),
    moreModes
      ? 'Daily opening-pack play, Top 3, Full Pack, and set-by-set practice live here.'
      : 'Choose a ten-decision Draft Run across real trophy drafts, or stay inside Powered Cube.',
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
