import { installRenderLifecycle } from './render-lifecycle.mjs';

// Authentication cookies are first-party to packone.pro. Treat the GitHub Pages
// hostname as a publishing mirror, never as a second account origin.
if (location.hostname === 'killjoy00.github.io') {
  location.replace('https://packone.pro' + location.pathname + location.search + location.hash);
} else {

const params = new URLSearchParams(location.search);
// Only previously published stored links load the historical game reader.
const historicalShare = params.has('challenge') && params.get('game') !== 'draft-run';
if (!historicalShare && (params.has('legacy-board') || params.has('mode') || params.has('seed') || (params.get('set') === 'powered-cube' && params.get('game') !== 'draft-run'))) {
  const cube = params.get('set') === 'powered-cube', legacyBoard = params.has('legacy-board');
  for (const key of ['legacy-board', 'mode', 'seed', 'vs', 'by', 'modes']) params.delete(key);
  params.set('game', 'draft-run');
  if(legacyBoard)params.set('board','daily');else params.set('daily','1');
  if (!cube) params.delete('set');
  history.replaceState({}, '', `${location.pathname}?${params}`);
} else if (params.has('modes')) {
  params.delete('modes');
  history.replaceState({}, '', `${location.pathname}${params.size ? '?' + params : ''}`);
}
installRenderLifecycle();
document.querySelector('#brand-home').onclick = () => location.href = './';
document.querySelector('#daily-nav').onclick = () => location.href = '?game=draft-run&daily=1';
document.querySelector('#leaderboard-nav').onclick = () => location.href = '?game=draft-run&board=daily';

if (historicalShare) {
  const { installHistoricalShare } = await import('./historical-share.mjs');
  await installHistoricalShare();
} else {
  // Paint play links before identity/profile requests. Profiles load on demand.
  const home = params.get('game') !== 'draft-run' && !params.has('profile') && !params.has('account')
    ? await import('./daily-home.mjs') : null;
  home?.renderDailyHome();
  const growthReady = import('./growth.mjs');
  const identityReady = growthReady.then(m => m.installGrowthLayer());
  const account = document.createElement('button');
  account.id = 'account-nav'; account.type = 'button';
  account.className = 'top-nav-button'; account.textContent = 'Account';
  account.onclick = async () => {
    await identityReady;
    const profiles = await import('./profile-product.mjs');
    profiles.installProfileProductLayer();
    (await import('./profile-polish.mjs')).installProfilePolish();
    await profiles.renderMyProfile();
  };
  document.querySelector('.top-actions').append(account);
  if (params.has('auth')) {
    await identityReady;
    await (await growthReady).resumeAccountAuth(params.get('auth'));
  } else if (params.has('patreon')) {
    await identityReady;
    const profiles=await import('./profile-product.mjs');
    profiles.installProfileProductLayer();
    (await import('./profile-polish.mjs')).installProfilePolish();
    await profiles.renderMyProfile();
    const clean=new URL(location.href);clean.searchParams.delete('patreon');
    history.replaceState({},'',clean.pathname+(clean.searchParams.size?'?'+clean.searchParams:''));
  } else if (home) home.installDailyHome(identityReady);
  else if (params.has('account')) {
    await identityReady;
    const profiles=await import('./profile-product.mjs');
    profiles.installProfileProductLayer();
    (await import('./profile-polish.mjs')).installProfilePolish();
    await profiles.renderMyProfile();
  } else if (params.has('profile')) {
    await identityReady;
    (await import('./profile-product.mjs')).installProfileProductLayer();
  } else {
    const game = await import('./draft-run-product.mjs');
    await identityReady;
    await game.installDraftRunPage();
  }
}

}
