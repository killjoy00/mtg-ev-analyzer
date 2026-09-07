function replaceText(selector, from, to) {
  document.querySelectorAll(selector).forEach((node) => {
    if (node.textContent.includes(from)) node.textContent = node.textContent.replace(from, to);
  });
}

function applyHumanCopy() {
  const intro = document.querySelector('.home-intro');
  if (intro) {
    const eyebrow = intro.querySelector('.eyebrow');
    const heading = intro.querySelector('h1');
    const lede = intro.querySelector('.lede');
    if (eyebrow) eyebrow.textContent = 'LIMITED DRAFT GAME';
    if (heading) heading.textContent = 'Pack One';
    if (lede) lede.textContent = 'Draft real opening packs from 17Lands. Rank your Top 3 or play the full first pack, then compare your choices with the strong-player consensus.';
  }

  const dailyHeading = document.querySelector('.daily-copy h2');
  if (dailyHeading) dailyHeading.textContent = 'One pack. One ranked shot.';
  const dailyCopy = document.querySelector('.daily-copy > p');
  if (dailyCopy) dailyCopy.textContent = 'Everyone sees the same draft seat today. Your first Top 3 and Full Pack scores are the ones that go on the board.';

  document.querySelectorAll('.mode-topline .eyebrow').forEach((node) => {
    if (node.textContent.trim() === 'Practice') node.textContent = 'Unlimited game';
  });
  replaceText('.mode-points li', 'Unlimited practice', 'Play again anytime');
  replaceText('.data-note span', 'random practice runs', 'unlimited games');
  replaceText('.stats-page h1, .stats-page p, .account-page p', 'Pack 1', 'Pack One');

  const note = document.querySelector('.data-note');
  if (note) {
    const title = note.querySelector('strong');
    const copy = note.querySelector('span');
    if (title) title.textContent = 'What “consensus” means';
    if (copy) copy.textContent = 'Consensus is a model of experienced, high-win-rate 17Lands drafters. It compares how much support each card gets in the current pack and historical pool. The percentages are relative model support—not win rates, card grades, or objective truth. Your score measures how closely your choices track that model; only Daily Challenge scores rank.';
  }

  document.querySelectorAll('.consensus-box p, .consensus-explanation').forEach((node) => {
    node.textContent = 'Model-implied support among experienced, high-win-rate 17Lands drafters for this pack and historical pool. These percentages are comparative—not win rates or objective card grades.';
  });

  document.querySelectorAll('.score-copy').forEach((copy) => {
    if (copy.querySelector('.score-context')) return;
    const context = document.createElement('p');
    context.className = 'score-context';
    context.textContent = 'Consensus alignment score — not win probability or an objective card grade.';
    copy.appendChild(context);
  });

  document.querySelectorAll('.opening-pack .card-image').forEach((image, index) => {
    image.loading = 'eager';
    if (index < 8) image.fetchPriority = 'high';
  });

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
