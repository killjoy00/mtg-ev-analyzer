function setText(selector, from, to) {
  const node = document.querySelector(selector);
  if (node && node.textContent.trim() === from) node.textContent = to;
}

function replaceText(selector, from, to) {
  document.querySelectorAll(selector).forEach((node) => {
    if (node.textContent.includes(from)) node.textContent = node.textContent.replace(from, to);
  });
}

function applyHumanCopy() {
  setText('.home-intro .eyebrow', 'Limited draft training', 'Pack 1 / Limited');
  setText('.home-intro h1', 'How good is your Pack 1?', 'Make the pick.');
  setText(
    '.home-intro .lede',
    'Real draft seats. Strong-player consensus. Play a quick opening-pack challenge or draft the whole first pack and get a score out of 100.',
    'Real opening packs from 17Lands drafts. Rank your Top 3 or play the whole first pack. Then see where you stood against strong-player consensus.'
  );

  setText('.daily-copy h2', 'Same challenge. Same day. Global board.', 'One pack. One ranked shot.');
  setText(
    '.daily-copy > p',
    'Everyone gets the same replay for each mode, so the score is actually comparable. Your first attempt today is the ranked one.',
    'Everyone sees the same draft seat today. Your first Top 3 and Full Pack scores are the ones that go on the board.'
  );

  document.querySelectorAll('.mode-topline .eyebrow').forEach((node) => {
    if (node.textContent.trim() === 'Practice') node.textContent = 'Unlimited game';
  });
  replaceText('.mode-points li', 'Unlimited practice', 'Play again anytime');
  replaceText('.data-note span', 'random practice runs', 'unlimited games');

  const modeGrid = document.querySelector('.mode-grid');
  if (modeGrid?.getAttribute('aria-label') === 'Choose a practice mode') {
    modeGrid.setAttribute('aria-label', 'Choose a game mode');
  }
}

export function installHumanCopy() {
  applyHumanCopy();
  const observer = new MutationObserver(() => applyHumanCopy());
  const app = document.querySelector('#app');
  if (app) observer.observe(app, { childList: true, subtree: true });
  return () => observer.disconnect();
}