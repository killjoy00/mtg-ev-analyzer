import { onAppRender } from './render-lifecycle.mjs';

const CUBE = 'powered-cube';

function cubeHref(daily = false) {
  const suffix = daily ? '&daily=1' : '';
  return `?game=draft-run&set=${CUBE}${suffix}`;
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

function enhanceHome() {
  const home = document.querySelector('.home-intro');
  const select = document.querySelector('#set-select');
  if (!home || !select) return;
  const option = [...select.options].find((item) => item.value === CUBE);
  option?.remove();

  let section = document.querySelector('[data-powered-cube-section="1"]');
  if (!section) {
    const modes = document.querySelector('.mode-section');
    if (!modes) return;
    modes.insertAdjacentHTML('beforebegin', `<section class="draft-run-feature cube-run-feature mode-section cube-mode-section" data-powered-cube-section="1" aria-labelledby="powered-cube-heading"><div><p class="eyebrow">Powered Cube</p><h2 id="powered-cube-heading">Ten cube picks.<br>Your call.</h2><p>Real trophy drafts. Two pack rerolls, with every decision staying inside Powered Cube.</p></div><div class="draft-run-feature-actions" aria-label="Powered Cube runs"><button class="button primary" type="button" data-cube-href="${cubeHref(true)}">Play today’s Cube</button><button class="button secondary" type="button" data-cube-href="${cubeHref(false)}">Practice a Cube Run</button><small>Starts at P1P2 with the trophy drafter’s real first pick visible</small></div></section>`);
    section = document.querySelector('[data-powered-cube-section="1"]');
  }

  bindCubeLaunchers(section || document);
}

export function installCubeHome() {
  onAppRender(enhanceHome);
}
