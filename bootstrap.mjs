import { installRenderLifecycle } from './render-lifecycle.mjs';
import { signalAccountChange } from './growth-api.mjs';

// Authentication cookies are first-party to packone.pro. Treat the GitHub Pages
// hostname as a publishing mirror, never as a second account origin.
if (location.hostname === 'killjoy00.github.io') {
  location.replace('https://packone.pro' + location.pathname + location.search + location.hash);
} else {

const params = new URLSearchParams(location.search);
if (params.get('ref') === 'result_share' && params.get('game') === 'draft-run' && params.get('daily') === '1') {
  window.PACK1_ENTRY_SOURCE = 'result_share';
  params.delete('ref');
  history.replaceState({}, '', `${location.pathname}${params.size ? '?' + params : ''}${location.hash}`);
  const { trackEvent } = await import('./retention-events.mjs');
  trackEvent('daily_share_arrival', { source: 'result_share', daily: true });
}
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

const deletionState=params.get('account');
if (deletionState==='deleted'||deletionState==='deleting') {
  const app=document.querySelector('#app');
  if(app) {
    const complete=deletionState==='deleted';
    app.innerHTML=`<section class="account-page growth-page"><header><p class="eyebrow">Account deletion</p><h1>${complete?'Your Pack One account has been deleted.':'Your deletion request has been accepted.'}</h1><p>${complete?'This action cannot be undone.':'You have been signed out. Deletion is still being completed and cannot be cancelled. No further action is required.'}</p></header><div class="account-actions"><a class="button primary" href="./">Return to Pack One</a></div></section>`;
  }
} else if (historicalShare) {
  const { installHistoricalShare } = await import('./historical-share.mjs');
  await installHistoricalShare();
} else {
  // Paint play links before identity/profile requests. Profiles load on demand.
  const home = params.get('game') !== 'draft-run' && !params.has('profile') && !params.has('account') && !params.has('patreon')
    ? await import('./daily-home.mjs?v=6') : null;
  home?.renderDailyHome();
  const growthReady = import('./growth.mjs?v=6');
  const identityReady = growthReady.then(m => m.installGrowthLayer());
  const account = document.createElement('button');
  account.id = 'account-nav'; account.type = 'button';
  account.className = 'top-nav-button'; account.textContent = 'Sign in';
  account.onclick = async () => {
    await identityReady;
    await (await growthReady).renderAccount({source:'nav'});
  };
  document.querySelector('.top-actions').append(account);
  identityReady.then(async()=>{account.textContent=(await growthReady).accountSignedIn()?'My Pack One':'Sign in';});
  if (params.has('auth')) {
    await identityReady;
    await (await growthReady).resumeAccountAuth(params.get('auth'));
  } else if (params.has('patreon')) {
    await identityReady;
    const patreonResult=params.get('patreon');
    if(patreonResult==='connected')signalAccountChange();
    const growth=await growthReady;
    if(patreonResult==='activate'||growth.hasPatreonActivationIntent()) {
      await growth.renderPatreonActivation({result:patreonResult==='activate'?null:patreonResult,source:patreonResult==='activate'?'welcome_note':'oauth_return'});
    } else {
      const profiles=await import('./profile-product.mjs?v=6');
      profiles.installProfileProductLayer();
      (await import('./profile-polish.mjs?v=6')).installProfilePolish();
      await profiles.renderMyProfile();
    }
    const clean=new URL(location.href);clean.searchParams.delete('patreon');
    history.replaceState({},'',clean.pathname+(clean.searchParams.size?'?'+clean.searchParams:''));
  } else if (home) home.installDailyHome(identityReady);
  else if (params.has('account')) {
    await identityReady;
    if (!['deleted','deleting'].includes(params.get('account'))) {
      await (await growthReady).renderAccount({source:'route'});
      if(params.get('account')==='patreon')document.querySelector('#profile-account-tab')?.click();
    }
  } else if (params.has('profile')) {
    await identityReady;
    (await import('./profile-product.mjs?v=6')).installProfileProductLayer();
  } else {
    const game = await import('./draft-run-product.mjs?v=6');
    await identityReady;
    await game.installDraftRunPage();
  }
}

}
