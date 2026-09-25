import { installRenderLifecycle } from './render-lifecycle.mjs';
import { signalAccountChange } from './growth-api.mjs';
import { normalizeAcquisitionValue as acquisitionValue } from './campaign-links.mjs';

// Authentication cookies are first-party to packone.pro. Treat the GitHub Pages
// hostname as a publishing mirror, never as a second account origin.
if (location.hostname === 'killjoy00.github.io') {
  location.replace('https://packone.pro' + location.pathname + location.search + location.hash);
} else {

const params = new URLSearchParams(location.search);
const resultShare=params.get('ref')==='result_share'&&params.get('game')==='draft-run'&&params.get('daily')==='1';
const utmSource=acquisitionValue(params.get('utm_source'));
const campaign=acquisitionValue(params.get('utm_campaign'));
const medium=acquisitionValue(params.get('utm_medium'));
let referrerHost=null;
if(!utmSource&&!resultShare&&document.referrer) {
  try {
    const referrer=new URL(document.referrer);
    if(referrer.hostname&&referrer.hostname!==location.hostname)referrerHost=referrer.hostname.toLowerCase().replace(/\.$/,'');
  } catch {}
}
const hadAttributionParams=['utm_source','utm_campaign','utm_medium'].some(key=>params.has(key));
for(const key of ['utm_source','utm_campaign','utm_medium'])params.delete(key);
if(resultShare) {
  window.PACK1_ENTRY_SOURCE='result_share';
  params.delete('ref');
}
if(hadAttributionParams||resultShare)history.replaceState({},'',`${location.pathname}${params.size?'?'+params:''}${location.hash}`);
const {trackEvent:trackArrivalEvent}=await import('./retention-events.mjs');
trackArrivalEvent('acquisition_touch',{
  source:resultShare?'result_share':utmSource||referrerHost||'direct',
  ...(campaign?{campaign}:{}),
  ...(medium?{medium}:{}),
  ...(referrerHost?{referrer_host:referrerHost}:{})
});
if(resultShare)trackArrivalEvent('daily_share_arrival',{source:'result_share',daily:true});
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
    ? await import('./daily-home.mjs?v=7') : null;
  home?.renderDailyHome();
  const growthReady = import('./growth.mjs?v=6');
  const identityReady = growthReady.then(m => m.installGrowthLayer());
  const topActions=document.querySelector('.top-actions');
  const howNav=document.querySelector('#how-nav');
  const account = document.createElement('button');
  account.id = 'account-nav'; account.type = 'button';
  account.className = 'top-nav-button'; account.textContent = 'Sign in';
  account.onclick = async () => {
    await identityReady;
    await (await growthReady).renderAccount({source:'nav'});
  };
  topActions.append(account);
  const dynamicNavIds=['practice-nav','leaderboard-nav','learn-nav'];
  function syncPrimaryNav(signed) {
    for(const id of dynamicNavIds)document.querySelector('#'+id)?.remove();
    if(howNav)howNav.hidden=signed;
    topActions.classList.toggle('is-signed-nav',signed);
    if(!signed)return;
    const items=[
      ['practice-nav','/practice/','Practice'],
      ['leaderboard-nav','?game=draft-run&board=daily','Leaders'],
      ['learn-nav','/learn/','Learn'],
    ];
    for(const [id,href,label] of items){
      const link=document.createElement('a');
      link.id=id;link.className='top-nav-button';link.href=href;link.textContent=label;
      topActions.insertBefore(link,account);
    }
  }
  async function refreshPrimaryNav(){
    await identityReady;
    const signed=(await growthReady).accountSignedIn();
    account.textContent=signed?'My Pack One':'Sign in';
    syncPrimaryNav(signed);
  }
  void refreshPrimaryNav();
  window.addEventListener('packone-account-changed',()=>void refreshPrimaryNav());
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
    const game = await import('./draft-run-product.mjs?v=7');
    await identityReady;
    await refreshPrimaryNav();
    await game.installDraftRunPage();
  }
}

}
