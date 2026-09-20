import { escapeHtml as esc } from './html.mjs';
import { completeGoogleSignIn, firstPartyAuthEnabled, getAuthSession, linkAccount, signInAccount, signOutAccount, signUpAccount, startGoogleSignIn } from './growth-api.mjs';
import { PATREON_POLICY } from './patreon-policy.mjs';
import { trackEvent as event } from './retention-events.mjs';

let currentAccount = null;
let pendingDailyRunValidation = null;
const AUTH_FLOW_KEY='pack1-auth-flow-v1';

function saveAuthFlow(intent,source) {
  try {sessionStorage.setItem(AUTH_FLOW_KEY,JSON.stringify({intent,source,validateDailyRunId:pendingDailyRunValidation||null}));} catch {}
}
function takeAuthFlow() {
  try {const raw=sessionStorage.getItem(AUTH_FLOW_KEY);sessionStorage.removeItem(AUTH_FLOW_KEY);return raw?JSON.parse(raw):null;} catch {return null;}
}
function authCompleted(data) {return firstPartyAuthEnabled()?Boolean(data?.user):Boolean(data?.token);}

function formMarkup(kind) {
  return `<form class="account-form" id="account-${kind}"><label>Email<input required type="email" name="email" autocomplete="email"></label>${kind==='signup'?'<label>Display name<input required name="name" minlength="2" maxlength="24" autocomplete="nickname"></label>':''}<label>Password<input required type="password" name="password" minlength="8" maxlength="128" autocomplete="${kind==='signup'?'new-password':'current-password'}"></label><button class="button primary" type="submit">${kind==='signup'?'Create account':'Sign in'}</button><p class="form-error" aria-live="polite"></p></form>`;
}

function handoffToPatreon(source='account') {
  event('elite_upgrade_handoff',{source});
  location.assign(PATREON_POLICY.supportUrl);
}

function renderAccountError(app, error, retry=()=>renderAccount()) {
  document.body.classList.remove('is-game');
  app.innerHTML=`<section class="message-card"><p class="eyebrow">Account</p><h1>Account access is temporarily unavailable.</h1><p>${esc(error?.message||'Please try again.')}</p><button class="button primary" id="account-retry">Try again</button><a class="button secondary" href="./">Back to Dailies</a></section>`;
  document.querySelector('#account-retry')?.addEventListener('click',()=>void retry());
}

async function claimCurrentSession() {
  const session=await getAuthSession(); if(!session?.user) return null;
  const validationRunId=pendingDailyRunValidation;
  const linked=await linkAccount(undefined,{validateDailyRunId:validationRunId});
  pendingDailyRunValidation=null; currentAccount=session; return linked;
}

export async function beginEliteUpgrade({ source='unknown' } = {}) {
  event('elite_upgrade_clicked',{source});
  return renderAccount({intent:'elite',source});
}

export async function renderAccount({ validateDailyRunId = null, intent = null, source = 'account' } = {}) {
  if(validateDailyRunId) pendingDailyRunValidation=validateDailyRunId;
  document.body.classList.remove('is-game');
  const app=document.querySelector('#app'); if(!app) return;
  try {
    currentAccount=await getAuthSession();
  } catch(error) {
    renderAccountError(app,error,()=>renderAccount({intent,source}));
    return;
  }
  if(currentAccount?.user) {
    const validationRunId=pendingDailyRunValidation;
    try {
      await linkAccount(undefined,{validateDailyRunId:validationRunId});
    } catch(error) {
      renderAccountError(app,error,()=>renderAccount({intent,source}));
      return;
    }
    pendingDailyRunValidation=null;
    if(intent==='elite') { handoffToPatreon(source); return; }
    const profiles=await import('./profile-product.mjs');
    profiles.installProfileProductLayer();
    (await import('./profile-polish.mjs')).installProfilePolish();
    await profiles.renderMyProfile();
    return;
  }
  const validatingDaily=Boolean(pendingDailyRunValidation);
  const upgradingElite=intent==='elite';
  const heading=validatingDaily?'Add your score to the leaderboard.':upgradingElite?'Unlock Elite practice.':'Save your progress.';
  const intro=validatingDaily
    ? 'Sign in or create a free account to validate this Daily score and add it to today’s leaderboard.'
    : upgradingElite
      ? 'Create or sign in to your free Pack One account first. Then we’ll send you to Patreon to choose Elite.'
      : 'All three Dailies are free without an account. A free account saves your record, enables leaderboard participation, and adds unlimited regular Draft Runs.';
  const google=firstPartyAuthEnabled()?'<div class="account-social"><button class="button primary" id="account-google" type="button">Continue with Google</button><p class="account-divider"><span>or use email</span></p></div>':'';
  app.innerHTML=`<section class="account-page growth-page"><header><p class="eyebrow">Account access</p><h1>${heading}</h1><p>${intro}</p></header>${google}<div class="account-columns"><div><h2>Create account</h2>${formMarkup('signup')}</div><div><h2>Sign in</h2>${formMarkup('signin')}</div></div><div class="account-actions">${new URLSearchParams(location.search).get('game')==='draft-run'&&!upgradingElite?`<a class="button primary" href="${esc(location.href)}">Continue to your run</a>`:''}<button class="button secondary" id="account-career">Back to my career</button><button class="text-button" id="account-home">${upgradingElite?'Not now — keep playing':'Keep playing as guest'}</button></div></section>`;
  document.querySelector('#account-google')?.addEventListener('click',async e=>{
    const button=e.currentTarget;button.disabled=true;
    try {saveAuthFlow(intent,source);event('auth_google_started',{source});await startGoogleSignIn();}
    catch(error){button.disabled=false;const target=document.querySelector('#account-signin .form-error');if(target)target.textContent=error.message;}
  });
  document.querySelector('#account-career')?.addEventListener('click',async()=>{pendingDailyRunValidation=null;await (await import('./profile-product.mjs')).renderMyProfile();});
  document.querySelector('#account-home')?.addEventListener('click',()=>{pendingDailyRunValidation=null;document.querySelector('#brand-home')?.click();});
  document.querySelector('#account-signup')?.addEventListener('submit',async(e)=>{e.preventDefault();const form=e.currentTarget,err=form.querySelector('.form-error');err.textContent='';try{const data=Object.fromEntries(new FormData(form));const auth=await signUpAccount(data);event('auth_sign_up');if(!authCompleted(auth)){err.textContent='Account created. Check your email to finish verification, then sign in.';return;}await claimCurrentSession();if(upgradingElite){handoffToPatreon(source);return;}await renderAccount();}catch(error){err.textContent=error.message;}});
  document.querySelector('#account-signin')?.addEventListener('submit',async(e)=>{e.preventDefault();const form=e.currentTarget,err=form.querySelector('.form-error');err.textContent='';try{const data=Object.fromEntries(new FormData(form));const auth=await signInAccount(data);if(!authCompleted(auth))throw Error('Sign in did not return an account session.');await claimCurrentSession();event('auth_sign_in');if(upgradingElite){handoffToPatreon(source);return;}await renderAccount();}catch(error){err.textContent=error.message;}});
}

function shareCompletedAnalytics(eventObject) {
  const detail=eventObject.detail||{};
  event('share_completed',{ method:String(detail.method||'unknown').slice(0,40), context:String(detail.context||'unknown').slice(0,40), challenge:Boolean(detail.challenge) });
}

export async function resumeAccountAuth(status) {
  const flow=takeAuthFlow()||{};
  if(status==='google') {
    try {
      await completeGoogleSignIn();
      event('auth_google_completed',{source:flow.source||'unknown'});
    } catch(error) {
      event('auth_google_failed',{source:flow.source||'unknown'});
      const clean=new URL(location.href);
      clean.searchParams.delete('auth');
      clean.searchParams.delete('neon_auth_session_verifier');
      history.replaceState({},'',clean.pathname+(clean.searchParams.size?'?'+clean.searchParams:''));
      await renderAccount({validateDailyRunId:flow.validateDailyRunId||null,intent:flow.intent||null,source:flow.source||'account'});
      const target=document.querySelector('#account-signin .form-error');
      if(target)target.textContent=error?.message||'Google sign in did not finish. Please try again.';
      return;
    }
  } else {
    event('auth_google_failed',{source:flow.source||'unknown'});
  }
  const clean=new URL(location.href);
  clean.searchParams.delete('auth');
  clean.searchParams.delete('neon_auth_session_verifier');
  history.replaceState({},'',clean.pathname+(clean.searchParams.size?'?'+clean.searchParams:''));
  if(status!=='google') {
    await renderAccount({validateDailyRunId:flow.validateDailyRunId||null,intent:flow.intent||null,source:flow.source||'account'});
    const error=document.querySelector('#account-signin .form-error');
    if(error)error.textContent='Google sign in did not finish. Please try again.';
    return;
  }
  return renderAccount({validateDailyRunId:flow.validateDailyRunId||null,intent:flow.intent||null,source:flow.source||'account'});
}

export async function installGrowthLayer() {
  currentAccount = await getAuthSession().catch(()=>null);
  if (currentAccount?.user) await linkAccount().catch(() => null);
  event('page_view', { account:Boolean(currentAccount?.user) });
  document.addEventListener('pack1:share-completed', shareCompletedAnalytics);
  document.addEventListener('click', e => {
    if (e.target.closest?.('#leaderboard-nav')) event('leaderboard_view');
  }, true);
}
