import { gameDateKey } from './engagement.mjs';
import { gameShareUrl, makeGameSeed } from './gameplay.mjs';

const SHARE_ORIGIN = 'https://magic.planitnow.us/';

function currentSet() {
  const params = new URLSearchParams(window.location.search);
  return params.get('set') || document.querySelector('#set-select')?.value || '';
}

function freshSeed() {
  return makeGameSeed(globalThis.crypto?.randomUUID ? () => crypto.randomUUID() : null);
}

function setDailyUrl(mode) {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('daily', gameDateKey());
  url.searchParams.set('set', currentSet());
  url.searchParams.set('mode', mode);
  history.replaceState({}, '', `${url.pathname}${url.search}`);
}

function freshGameUrl(mode) {
  return gameShareUrl({
    origin: SHARE_ORIGIN,
    setId: currentSet(),
    mode,
    seed: freshSeed(),
  });
}

function replaceTextNodes(root = document) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (!node.nodeValue) continue;
    node.nodeValue = node.nodeValue
      .replace(/Practice run\./g, 'Replay.')
      .replace(/practice replay/gi, 'replay')
      .replace(/practice attempt/gi, 'replay')
      .replace(/Practice runs never count\./g, 'Only Daily Challenge runs count toward the board.');
  }
}

function captureFlow(event) {
  const daily = event.target.closest?.('[data-daily-mode]');
  if (daily) setDailyUrl(daily.dataset.dailyMode);

  const another = event.target.closest?.('#another-top3, #another-full');
  if (!another) return;
  const params = new URLSearchParams(window.location.search);
  if (!params.get('daily') || params.get('seed')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const mode = another.id.includes('top3') ? 'top3' : 'full';
  window.location.href = freshGameUrl(mode);
}

export function installFlowFixes() {
  document.addEventListener('click', captureFlow, true);
  const app = document.querySelector('#app');
  if (app) new MutationObserver(() => replaceTextNodes(app)).observe(app, { childList: true, subtree: true });
  replaceTextNodes(app || document);
}
