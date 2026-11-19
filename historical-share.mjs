// Old links remain understandable without fetching data or reviving a grader.
export async function installHistoricalShare() {
  const app = document.querySelector('#app');
  if (app) app.innerHTML = `<section class="growth-page"><header><p class="eyebrow">Older Pack One link</p><h1>This game mode has been retired.</h1><p>Full Pack and Top 3 are no longer available.</p></header><div class="account-actions"><a class="button primary" href="./?game=draft-run&daily=1">Play the Daily</a><a class="button secondary" href="./practice/">Practice Draft Run</a></div></section>`;
}
