import { escapeHtml as esc } from './html.mjs';
import { completeGoogleSignIn, firstPartyAuthEnabled, getAuthSession, linkAccount, requestPasswordReset, signInAccount, signOutAccount, signUpAccount, startGoogleSignIn } from './growth-api.mjs';
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

function syncAccountNav(signedIn=Boolean(currentAccount?.user)) {
  const nav=document.querySelector('#account-nav');
  if(nav)nav.textContent=signedIn?'My Pack One':'Sign in';
}
export function accountSignedIn() {return Boolean(currentAccount?.user);}

function formMarkup(kind) {
  return `<form class="account-form" id="account-${kind}"><label>Email<input required type="email" name="email" autocomplete="email"></label>${kind==='signup'?'<label>Display name<input required name="name" minlength="2" maxlength="24" autocomplete="nickname"></label>':''}<label>Password<input required type="password" name="password" minlength="8" maxlength="128" autocomplete="${kind==='signup'?'new-password':'current-password'}"></label><button class="button primary" type="submit">${kind==='signup'?'Create account':'Sign in'}</button>${kind==='signin'?'<button class="text-button" id="account-forgot" type="button">Forgot password?</button>':''}<p class="form-error" aria-live="polite"></p></form>`;
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
  pendingDailyRunValidation=null;
  currentAccount=session;
  syncAccountNav(true);
  return {linked,validationRunId};
}

export async function beginEliteUpgrade({ source='unknown' } = {}) {
  event('elite_upgrade_clicked',{source});
  return renderAccount({intent:'elite',source});
}

export async function renderForgotPassword() {
  document.body.classList.remove('is-game');
  const app=document.querySelector('#app');if(!app)return;
  app.innerHTML=`<section class="account-page growth-page"><header><p class="eyebrow">Account recovery</p><h1>Reset your password.</h1><p>Enter your account email. We’ll send a reset link if a password account exists.</p></header><div class="account-columns"><div><form class="account-form" id="account-recovery-request"><label>Email<input required type="email" name="email" autocomplete="email"></label><button class="button primary" type="submit">Send reset link</button><p class="form-error" aria-live="polite"></p></form></div></div><div class="account-actions"><button class="button secondary" id="account-recovery-back" type="button">Back to sign in</button></div></section>`;
  document.querySelector('#account-recovery-back')?.addEventListener('click',()=>void renderAccount());
  document.querySelector('#account-recovery-request')?.addEventListener('submit',async e=>{
    e.preventDefault();const form=e.currentTarget,button=form.querySelector('button[type="submit"]'),status=form.querySelector('.form-error');
    status.textContent='';button.disabled=true;
    try {
      const {email}=Object.fromEntries(new FormData(form));
      const result=await requestPasswordReset(email);
      form.innerHTML=`<p class="form-success" role="status">${esc(result?.message||"If an account exists for that email, we've sent a password reset link.")}</p>`;
    } catch(error) {
      status.textContent=error?.message||'Password recovery is temporarily unavailable.';
      button.disabled=false;
    }
  });
}

function googleError(message='') {
  const target=document.querySelector('#account-google-error');
  if(target)target.textContent=message;
}

function setFormPending(form,pending,label) {
  const button=form?.querySelector('button[type="submit"]');
  if(!button)return false;
  if(pending) {
    if(form.dataset.pending==='1')return false;
    form.dataset.pending='1';
    button.dataset.idleLabel=button.textContent;
    button.disabled=true;
    button.textContent=label;
    return true;
  }
  delete form.dataset.pending;
  button.disabled=false;
  button.textContent=button.dataset.idleLabel||button.textContent;
  delete button.dataset.idleLabel;
  return true;
}

async function returnToValidatedDaily(validationRunId,linked,source) {
  event('daily_score_validated',{source});
  const draft=await import('./draft-run-product.mjs');
  await draft.returnToValidatedDaily(validationRunId,{standing:linked?.standing||null});
}

export async function renderAccount({ validateDailyRunId = null, intent = null, source = 'account', notice = '', mode = null } = {}) {
  if(validateDailyRunId) pendingDailyRunValidation=validateDailyRunId;
  document.body.classList.remove('is-game');
  const app=document.querySelector('#app'); if(!app) return;
  try {
    currentAccount=await getAuthSession();
    syncAccountNav(Boolean(currentAccount?.user));
  } catch(error) {
    renderAccountError(app,error,()=>renderAccount({validateDailyRunId:pendingDailyRunValidation,intent,source,mode}));
    return;
  }
  if(currentAccount?.user) {
    const validationRunId=pendingDailyRunValidation;
    let linked=null;
    try {
      linked=await linkAccount(undefined,{validateDailyRunId:validationRunId});
    } catch(error) {
      renderAccountError(app,error,()=>renderAccount({validateDailyRunId:validationRunId,intent,source,mode}));
      return;
    }
    pendingDailyRunValidation=null;
    if(validationRunId) {
      try {await returnToValidatedDaily(validationRunId,linked,source);}
      catch(error) {renderAccountError(app,error,()=>void (async()=>{await returnToValidatedDaily(validationRunId,linked,source);})());}
      return;
    }
    if(intent==='elite') { handoffToPatreon(source); return; }
    const profiles=await import('./profile-product.mjs');
    profiles.installProfileProductLayer();
    (await import('./profile-polish.mjs')).installProfilePolish();
    await profiles.renderMyProfile();
    return;
  }

  const validatingDaily=Boolean(pendingDailyRunValidation);
  const upgradingElite=intent==='elite';
  const authMode=mode==='signup'||mode==='signin'?mode:(validatingDaily||upgradingElite?'signup':'signin');
  const heading=validatingDaily?'Add your score to the leaderboard.':upgradingElite?'Unlock Elite practice.':authMode==='signup'?'Create Account':'Sign In';
  const intro=validatingDaily
    ? 'Sign in or create a free account to validate this Daily score and add it to today’s leaderboard.'
    : upgradingElite
      ? 'Create or sign in to your free Pack One account first. Then we’ll send you to Patreon to choose Elite.'
      : '';
  const google=firstPartyAuthEnabled()
    ? '<div class="account-social"><button class="button primary" id="account-google" type="button">Sign in with Google</button><p class="form-error" id="account-google-error" aria-live="polite"></p></div>'
    : '';
  const toggleCopy=authMode==='signup'
    ? 'Already have an account? <button class="text-button" id="account-mode-toggle" type="button">Sign in</button>'
    : 'New to Pack One? <button class="text-button" id="account-mode-toggle" type="button">Create account</button>';
  const accountNote=authMode==='signin'?'<small>A free account saves your record and enables leaderboard participation.</small>':'';
  app.innerHTML=`<section class="account-page growth-page"><header><p class="eyebrow">Account Access</p><h1>${heading}</h1>${intro?`<p>${intro}</p>`:''}${notice?`<p class="form-success" role="status">${esc(notice)}</p>`:""}</header><div class="account-auth-card">${formMarkup(authMode)}</div>${google}<div class="account-new-user"><p>${toggleCopy}</p>${accountNote}</div><div class="account-actions">${new URLSearchParams(location.search).get('game')==='draft-run'&&!upgradingElite?`<a class="button primary" href="${esc(location.href)}">Continue to your run</a>`:''}<button class="button secondary" id="account-career">Back to my career</button><button class="text-button" id="account-home">${upgradingElite?'Not now — keep playing':'Keep playing as guest'}</button></div></section>`;

  document.querySelector('#account-mode-toggle')?.addEventListener('click',()=>void renderAccount({
    validateDailyRunId:pendingDailyRunValidation,
    intent,source,
    mode:authMode==='signin'?'signup':'signin',
  }));
  document.querySelector('#account-google')?.addEventListener('click',async e=>{
    const button=e.currentTarget;
    if(button.disabled)return;
    googleError('');
    button.disabled=true;
    const idle=button.textContent;
    button.textContent='Connecting…';
    try {
      saveAuthFlow(intent,source);
      event('auth_google_started',{source});
      await startGoogleSignIn();
    } catch(error) {
      button.disabled=false;
      button.textContent=idle;
      googleError(error?.message||'Google sign in did not finish. Please try again.');
    }
  });
  document.querySelector('#account-forgot')?.addEventListener('click',()=>void renderForgotPassword());
  document.querySelector('#account-career')?.addEventListener('click',async()=>{pendingDailyRunValidation=null;await (await import('./profile-product.mjs')).renderMyProfile();});
  document.querySelector('#account-home')?.addEventListener('click',()=>{pendingDailyRunValidation=null;document.querySelector('#brand-home')?.click();});

  const signup=document.querySelector('#account-signup');
  signup?.addEventListener('submit',async e=>{
    e.preventDefault();
    const form=e.currentTarget,err=form.querySelector('.form-error');
    if(!setFormPending(form,true,'Creating account…'))return;
    err.textContent='';
    try {
      const data=Object.fromEntries(new FormData(form));
      const auth=await signUpAccount(data);
      event('auth_sign_up',{source});
      if(!authCompleted(auth)) {
        const card=document.querySelector('.account-auth-card');
        if(card)card.innerHTML=`<div class="form-success account-verification-success" role="status"><h2>Check your email</h2><p>Check your email — we sent a verification link to ${esc(data.email)}. Open it to finish creating your Pack One account.</p></div><button class="button secondary" id="account-verification-signin" type="button">Back to sign in</button>`;
        document.querySelector('#account-verification-signin')?.addEventListener('click',()=>void renderAccount({validateDailyRunId:pendingDailyRunValidation,intent,source,mode:'signin'}));
        return;
      }
      const claimed=await claimCurrentSession();
      if(claimed?.validationRunId){await returnToValidatedDaily(claimed.validationRunId,claimed.linked,source);return;}
      if(upgradingElite){handoffToPatreon(source);return;}
      await renderAccount({intent,source});
    } catch(error) {
      err.textContent=error?.message||'Account creation failed.';
      setFormPending(form,false);
    }
  });

  const signin=document.querySelector('#account-signin');
  signin?.addEventListener('submit',async e=>{
    e.preventDefault();
    const form=e.currentTarget,err=form.querySelector('.form-error');
    if(!setFormPending(form,true,'Signing in…'))return;
    err.textContent='';
    try {
      const data=Object.fromEntries(new FormData(form));
      const auth=await signInAccount(data);
      if(!authCompleted(auth))throw Error('Sign in did not return an account session.');
      const claimed=await claimCurrentSession();
      event('auth_sign_in',{source});
      if(claimed?.validationRunId){await returnToValidatedDaily(claimed.validationRunId,claimed.linked,source);return;}
      if(upgradingElite){handoffToPatreon(source);return;}
      await renderAccount({intent,source});
    } catch(error) {
      err.textContent=error?.message||'Sign in failed.';
      setFormPending(form,false);
    }
  });
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
      googleError(error?.message||'Google sign in did not finish. Please try again.');
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
    googleError('Google sign in did not finish. Please try again.');
    return;
  }
  return renderAccount({validateDailyRunId:flow.validateDailyRunId||null,intent:flow.intent||null,source:flow.source||'account'});
}

export function renderDeletionState(deletionState) {
  if(deletionState!=='deleted'&&deletionState!=='deleting')return false;
  currentAccount=null;
  document.body.classList.remove('is-game');
  const app=document.querySelector('#app');
  if(app) {
    const complete=deletionState==='deleted';
    app.innerHTML=`<section class="account-page growth-page"><header><p class="eyebrow">Account deletion</p><h1>${complete?'Your Pack One account has been deleted.':'Your deletion request has been accepted.'}</h1><p>${complete?'This action cannot be undone.':'You have been signed out. Deletion is still being completed and cannot be cancelled. No further action is required.'}</p></header><div class="account-actions"><a class="button primary" href="./">Return to Pack One</a></div></section>`;
  }
  return true;
}

export async function installGrowthLayer() {
  const deletionState=new URLSearchParams(location.search).get('account');
  if(renderDeletionState(deletionState))return;
  currentAccount = await getAuthSession().catch(()=>null);
  syncAccountNav(Boolean(currentAccount?.user));
  // Authentication/account-establishment flows link explicitly. Ordinary page
  // bootstrap must only observe the existing account session: calling
  // link-browser here rotates identity cookies and defeats session stability.
  event('page_view', { account:Boolean(currentAccount?.user) });
  document.addEventListener('pack1:share-completed', shareCompletedAnalytics);
  document.addEventListener('click', e => {
    if (e.target.closest?.('#leaderboard-nav')) event('leaderboard_view');
  }, true);
}
