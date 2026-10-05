import { escapeHtml as esc } from './html.mjs';
import { accountAuthCompleted, completeAppleDeletion, completeAppleSignIn, completeEmailVerification, completeGoogleSignIn, firstPartyAuthEnabled, getAuthSession, linkAccount, loadMyProfile, requestPasswordReset, requestVerificationEmail, signInAccount, signOutAccount, signUpAccount, startAppleSignIn, startGoogleSignIn, updateProfile } from './growth-api.mjs';
import { clearPatreonActivation, hasPatreonActivationIntent, rememberPatreonActivation, renderPatreonActivation as renderPatreonActivationPage } from './patreon-activation.mjs?v=2';
import { flushEvents, trackEvent as event } from './retention-events.mjs';

let currentAccount = null;
let currentAccountState = 'checking';
let currentAccountError = null;
let pendingDailyRunValidation = null;
let pendingSignupNamePrompt = null;
const AUTH_FLOW_KEY='pack1-auth-flow-v1';
const PROFILE_SAFETY_KEY='pack1-profile-safety-intent-v1';

function saveAuthFlow(intent,source) {
  try {sessionStorage.setItem(AUTH_FLOW_KEY,JSON.stringify({intent,source,validateDailyRunId:pendingDailyRunValidation||null}));} catch {}
}
function takeAuthFlow() {
  try {const raw=sessionStorage.getItem(AUTH_FLOW_KEY);sessionStorage.removeItem(AUTH_FLOW_KEY);return raw?JSON.parse(raw):null;} catch {return null;}
}

function takeProfileSafetyIntent() {
  try {
    const raw=sessionStorage.getItem(PROFILE_SAFETY_KEY);
    sessionStorage.removeItem(PROFILE_SAFETY_KEY);
    const value=raw?JSON.parse(raw):null;
    return value&&/^[a-f0-9]{16}$/.test(String(value.profileKey||''))?value:null;
  } catch {return null;}
}

async function resumeProfileSafetyIntent() {
  const pending=takeProfileSafetyIntent();
  if(!pending)return false;
  const profiles=await import('./profile-product.mjs?v=9');
  profiles.installProfileProductLayer();
  (await import('./profile-polish.mjs?v=6')).installProfilePolish();
  await profiles.renderPublicProfile(pending.profileKey);
  const reason=document.querySelector('#profile-report-reason');
  if(reason&&pending.reason)reason.value=pending.reason;
  const action=pending.action==='block'?'block':'report';
  const status=document.querySelector('#profile-safety-status');
  if(status)status.textContent=action==='block'
    ? 'Signed in. Review this profile, then choose Block profile to continue.'
    : 'Signed in. Review the reason, then choose Report profile to continue.';
  document.querySelector('#profile-'+action)?.focus();
  return true;
}

async function renderSignedInHome(source='account') {
  if(source==='profile_safety'&&await resumeProfileSafetyIntent())return;
  const profiles=await import('./profile-product.mjs?v=9');
  profiles.installProfileProductLayer();
  (await import('./profile-polish.mjs?v=6')).installProfilePolish();
  await profiles.renderMyProfile();
}

function syncAccountNav() {
  const nav=document.querySelector('#account-nav');
  if(!nav)return;
  nav.dataset.accountState=currentAccountState;
  nav.toggleAttribute('aria-busy',currentAccountState==='checking');
  nav.textContent=currentAccountState==='signed-in'?'My Pack One'
    :currentAccountState==='signed-out'?'Sign in'
      :currentAccountState==='unavailable'?'Retry account':'Account';
}
export function accountSignedIn() {return currentAccountState==='signed-in'&&Boolean(currentAccount?.user);}
export function accountState() {return currentAccountState;}
export function accountError() {return currentAccountError;}
export async function refreshAccountSession() {
  currentAccountState='checking';
  currentAccountError=null;
  syncAccountNav();
  try {
    currentAccount=await getAuthSession();
    currentAccountState=currentAccount?.user?'signed-in':'signed-out';
  } catch(error) {
    currentAccount=null;
    currentAccountState='unavailable';
    currentAccountError=error;
  }
  syncAccountNav();
  return {state:currentAccountState,account:currentAccount,error:currentAccountError};
}
export { hasPatreonActivationIntent };
export async function renderPatreonActivation(options={}) {
  const source=options.source||'welcome_note';
  return renderPatreonActivationPage({...options,source,onSignedOut:()=>renderAccount({intent:'patreon-activate',source})});
}

function formMarkup(kind) {
  return `<form class="account-form" id="account-${kind}"><label>Email<input required type="email" name="email" autocomplete="username"></label><label>Password<input required type="password" name="password" minlength="8" maxlength="128" autocomplete="${kind==='signup'?'new-password':'current-password'}"></label><button class="button primary" type="submit">${kind==='signup'?'Create account':'Sign in'}</button>${kind==='signin'?'<button class="text-button" id="account-forgot" type="button">Forgot password?</button>':''}<p class="form-error" aria-live="polite"></p></form>`;
}

async function openEliteLanding(source='account') {
  event('elite_upgrade_handoff',{source});
  await flushEvents().catch(()=>{});
  location.assign('/patreon/');
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
  const displayNameAttention=Boolean(validationRunId&&linked?.rankingIdentity?.eligible===false&&['username_taken','username_required','name_not_allowed'].includes(linked?.rankingIdentity?.reason));
  if(!displayNameAttention)pendingDailyRunValidation=null;
  currentAccount=session;
  currentAccountState='signed-in';
  currentAccountError=null;
  syncAccountNav();
  return {
    linked,
    validationRunId:linked?.validatedDailyScore?validationRunId:null,
    pendingValidationRunId:validationRunId,
  };
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

export async function renderVerificationRecovery(message='This verification link has expired or is no longer valid. Request a new link.') {
  document.body.classList.remove('is-game');
  const app=document.querySelector('#app');if(!app)return;
  app.innerHTML=`<section class="account-page growth-page"><header><p class="eyebrow">Email verification</p><h1>Get a new verification link.</h1><p>${esc(message)}</p><p>Verification links expire after 15 minutes.</p></header><div class="account-columns"><div><form class="account-form" id="account-verification-resend-form"><label>Email<input required type="email" name="email" autocomplete="email"></label><button class="button primary" type="submit">Send a new verification link</button><p class="form-error" aria-live="polite"></p></form></div></div><div class="account-actions"><button class="button secondary" id="account-verification-back" type="button">Back to sign in</button></div></section>`;
  document.querySelector('#account-verification-back')?.addEventListener('click',()=>void renderAccount({mode:'signin'}));
  document.querySelector('#account-verification-resend-form')?.addEventListener('submit',async e=>{
    e.preventDefault();const form=e.currentTarget,status=form.querySelector('.form-error');
    if(!setFormPending(form,true,'Sending…'))return;
    status.textContent='';
    try {
      const {email}=Object.fromEntries(new FormData(form));
      const result=await requestVerificationEmail(email);
      form.innerHTML=`<p class="form-success" role="status">${esc(result?.message||"If an unverified account exists for that email, we've sent a verification link.")}</p>`;
    } catch(error) {
      status.textContent=error?.message||'Email verification is temporarily unavailable.';
      setFormPending(form,false);
    }
  });
}

function googleError(message='') {
  const target=document.querySelector('#account-google-error');
  if(target)target.textContent=message;
}
function appleError(message='') {
  const target=document.querySelector('#account-apple-error');
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

async function returnToValidatedDaily(validationRunId,linked,source,{confirmed=true}={}) {
  if(confirmed)event('daily_score_validated',{source});
  const draft=await import('./draft-run-product.mjs?v=10');
  await draft.returnToValidatedDaily(validationRunId,{standing:linked?.standing||null,confirmed});
}

async function continueAfterSignupNamePrompt({skip=false}={}) {
  const context=pendingSignupNamePrompt;
  if(!context)return;
  pendingSignupNamePrompt=null;
  document.querySelector('#account-ready')?.remove();
  if(context.validationRunId) {
    let linked=context.linked;
    if(!skip&&!linked?.validatedDailyScore)linked=await linkAccount(undefined,{validateDailyRunId:context.validationRunId});
    const confirmed=Boolean(linked?.validatedDailyScore);
    pendingDailyRunValidation=null;
    await returnToValidatedDaily(context.validationRunId,linked,context.source,{confirmed});
    return;
  }
  if(context.intent==='patreon-activate'){await renderPatreonActivation({source:context.source});return;}
  if(context.intent==='elite'){await openEliteLanding(context.source);return;}
  await renderSignedInHome(context.source);
}

async function openSignupNamePrompt({linked,validationRunId=null,intent=null,source='account'}={}) {
  pendingSignupNamePrompt={linked,validationRunId,intent,source};
  if(validationRunId)pendingDailyRunValidation=validationRunId;
  const app=document.querySelector('#app');if(!app)return;
  let profile=null;
  try {profile=await loadMyProfile();} catch {}
  const initialReason=profile?.player?.display_name_reason||profile?.ranking_identity?.reason||linked?.rankingIdentity?.reason||null;
  const storedInitial=String(profile?.player?.display_name||linked?.displayName||'').trim();
  const initial=initialReason==='username_required'?'':storedInitial;
  const initialWarning=initialReason==='name_not_allowed'
    ? 'That display name is not allowed. Choose another to join Daily leaderboards.'
    : initialReason==='username_taken'
      ? 'Choose a different display name. That one is already taken.'
      : '';
  const initialHelper=initialReason==='username_required'
    ? 'Optional. Choose a display name if you want to join Daily leaderboards. Shown on Daily leaderboards and your public profile.'
    : 'Shown on Daily leaderboards and your public profile.';
  app.innerHTML=`<section class="account-page growth-page" id="account-ready"><header><p class="eyebrow">Account ready</p><h1>Your account is ready.</h1><p>Your progress is saved across devices.</p></header><div class="account-auth-card"><form class="account-form" id="account-ready-form"><label>Display name<input type="text" name="displayName" minlength="2" maxlength="24" autocomplete="nickname" value="${esc(initial)}" placeholder="Display name"></label><small id="account-ready-name-help">${esc(initialHelper)}</small><p class="account-identity-rules"><small>Display names and public profiles follow the <a href="/terms/#public-identity-rules">Public Identity rules</a>.</small></p><button class="button primary" type="submit">Continue</button><button class="text-button" id="account-ready-skip" type="button">Skip for now</button><p class="form-error" aria-live="polite">${esc(initialWarning)}</p></form></div></section>`;
  const form=document.querySelector('#account-ready-form');
  const input=form?.querySelector('input[name="displayName"]');
  const status=form?.querySelector('.form-error');
  input?.addEventListener('input',()=>{if(status)status.textContent='';});
  input?.focus();
  document.querySelector('#account-ready-skip')?.addEventListener('click',()=>void continueAfterSignupNamePrompt({skip:true}));
  form?.addEventListener('submit',async eventObject=>{
    eventObject.preventDefault();
    const status=form.querySelector('.form-error');
    const next=String(new FormData(form).get('displayName')||'').trim();
    if(next===initial){await continueAfterSignupNamePrompt({skip:true});return;}
    if(!setFormPending(form,true,'Saving…'))return;
    status.textContent='';
    try {
      const updated=await updateProfile({displayName:next,acceptPublicIdentityTerms:true});
      document.dispatchEvent(new CustomEvent('pack1:profile-updated',{detail:{usernameOwned:updated.player?.username_owned===true}}));
      if(updated.player?.username_owned!==true) {
        status.textContent=updated.player?.display_name_reason==='name_not_allowed'
          ? 'That display name is not allowed. Choose another to join Daily leaderboards.'
          : 'Choose a different display name. That one is already taken.';
        setFormPending(form,false);
      }
    } catch(error) {
      status.textContent=error?.message||'Could not save your display name.';
      setFormPending(form,false);
    }
  });
}

document.addEventListener('pack1:profile-updated',async eventObject=>{
  if(eventObject.detail?.usernameOwned!==true)return;
  if(pendingSignupNamePrompt) {
    try {await continueAfterSignupNamePrompt();} catch {}
    return;
  }
  if(!pendingDailyRunValidation)return;
  const validationRunId=pendingDailyRunValidation;
  try {
    const linked=await linkAccount(undefined,{validateDailyRunId:validationRunId});
    if(!linked?.validatedDailyScore)return;
    pendingDailyRunValidation=null;
    await returnToValidatedDaily(validationRunId,linked,'username_fix');
  } catch {}
});

export async function renderAccount({ validateDailyRunId = null, intent = null, source = 'account', notice = '', mode = null } = {}) {
  if(!intent&&hasPatreonActivationIntent())intent='patreon-activate';
  if(intent==='patreon-activate')rememberPatreonActivation(source);
  if(validateDailyRunId) pendingDailyRunValidation=validateDailyRunId;
  document.body.classList.remove('is-game');
  const app=document.querySelector('#app'); if(!app) return;
  try {
    currentAccount=await getAuthSession();
    currentAccountState=currentAccount?.user?'signed-in':'signed-out';
    currentAccountError=null;
    syncAccountNav();
  } catch(error) {
    currentAccount=null;
    currentAccountState='unavailable';
    currentAccountError=error;
    syncAccountNav();
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
    if(linked?.newlyClaimed) {
      await openSignupNamePrompt({linked,validationRunId,intent,source});
      return;
    }
    const displayNameAttention=Boolean(validationRunId&&linked?.rankingIdentity?.eligible===false&&['username_taken','username_required','name_not_allowed'].includes(linked?.rankingIdentity?.reason));
    if(displayNameAttention) {
      pendingDailyRunValidation=validationRunId;
      const profiles=await import('./profile-product.mjs?v=9');
      profiles.installProfileProductLayer();
      (await import('./profile-polish.mjs?v=6')).installProfilePolish();
      await profiles.renderMyProfile();
      document.querySelector('#profile-account-tab')?.click();
      document.querySelector('#profile-account input[name="displayName"]')?.focus();
      return;
    }
    pendingDailyRunValidation=null;
    if(validationRunId) {
      try {await returnToValidatedDaily(validationRunId,linked,source);}
      catch(error) {renderAccountError(app,error,()=>void (async()=>{await returnToValidatedDaily(validationRunId,linked,source);})());}
      return;
    }
    if(intent==='patreon-activate') { await renderPatreonActivation({source}); return; }
    if(intent==='elite') { await openEliteLanding(source); return; }
    await renderSignedInHome(source);
    return;
  }

  const validatingDaily=Boolean(pendingDailyRunValidation);
  const upgradingElite=intent==='elite';
  const activatingPatreon=intent==='patreon-activate';
  const authMode=mode==='signup'||mode==='signin'?mode:(validatingDaily||upgradingElite||activatingPatreon?'signup':'signin');
  const heading=validatingDaily?'Add your score to the leaderboard.':activatingPatreon?'Activate Pack One Elite':upgradingElite?'Unlock Elite practice.':authMode==='signup'?'Create Account':'Sign In';
  const intro=validatingDaily
    ? 'Sign in or create a free account to validate this Daily score and add it to today’s leaderboard.'
    : activatingPatreon
      ? 'Sign in or create your free Pack One account. Then authorize Patreon so Pack One can verify and activate Elite.'
      : upgradingElite
        ? 'Create or sign in to your free Pack One account first. Then we’ll show you the Elite benefits and Patreon connection steps.'
        : '';
  const providerVerb=authMode==='signup'?'Create':'Sign in';
  const social=firstPartyAuthEnabled()
    ? `<div class="account-social"><button class="button primary provider-button" id="account-apple" type="button">${providerVerb} with Apple</button><p class="form-error" id="account-apple-error" aria-live="polite"></p><button class="button secondary provider-button" id="account-google" type="button">${providerVerb} with Google</button><p class="form-error" id="account-google-error" aria-live="polite"></p></div>`
    : '';
  const toggleCopy=authMode==='signup'
    ? 'Already have an account? <button class="text-button" id="account-mode-toggle" type="button">Sign in</button>'
    : 'New to Pack One? <button class="text-button" id="account-mode-toggle" type="button">Create account</button>';
  const accountNote=authMode==='signin'?'<small>A free account saves your record and enables leaderboard participation.</small>':'';
  const accountConsent=authMode==='signup'
    ? '<p class="account-identity-rules account-creation-consent"><small>By creating an account, you agree to the <a href="https://packone.pro/terms/">Pack One Terms</a>.</small></p>'
    : '';
  const divider=social?'<div class="account-divider" aria-hidden="true"><span>or</span></div>':'';
  app.innerHTML=`<section class="account-page growth-page"><header><p class="eyebrow">Account Access</p><h1>${heading}</h1>${intro?`<p>${intro}</p>`:''}${notice?`<p class="form-success" role="status">${esc(notice)}</p>`:""}</header><div class="account-auth-card">${social}${divider}${formMarkup(authMode)}${accountConsent}<div class="account-mode-toggle"><p>${toggleCopy}</p>${accountNote}</div></div><div class="account-actions">${new URLSearchParams(location.search).get('game')==='draft-run'&&!upgradingElite&&!activatingPatreon?`<a class="button primary" href="${esc(location.href)}">Continue to your run</a>`:''}<button class="button secondary" id="account-career">My Pack One</button><button class="text-button" id="account-home">${upgradingElite||activatingPatreon?'Not now, keep playing':'Keep playing as guest'}</button></div></section>`;

  document.querySelector('#account-mode-toggle')?.addEventListener('click',()=>void renderAccount({
    validateDailyRunId:pendingDailyRunValidation,
    intent,source,
    mode:authMode==='signin'?'signup':'signin',
  }));
  document.querySelector('#account-apple')?.addEventListener('click',async e=>{
    const button=e.currentTarget;
    if(button.disabled)return;
    appleError('');
    button.disabled=true;
    const idle=button.textContent;
    button.textContent='Connecting…';
    try {
      saveAuthFlow(intent,source);
      event('auth_apple_started',{source});
      await startAppleSignIn();
    } catch(error) {
      button.disabled=false;
      button.textContent=idle;
      appleError(error?.message||'Apple sign in did not finish. Please try again.');
    }
  });
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
  document.querySelector('#account-career')?.addEventListener('click',async()=>{pendingDailyRunValidation=null;if(activatingPatreon)clearPatreonActivation();await (await import('./profile-product.mjs?v=9')).renderMyProfile();});
  document.querySelector('#account-home')?.addEventListener('click',()=>{pendingDailyRunValidation=null;if(activatingPatreon)clearPatreonActivation();document.querySelector('#brand-home')?.click();});

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
      if(!accountAuthCompleted(auth)) {
        saveAuthFlow(intent,source);
        const card=document.querySelector('.account-auth-card');
        if(card)card.innerHTML=`<div class="form-success account-verification-success" role="status"><h2>Check your email</h2><p>We sent a verification link to ${esc(data.email)}. Open it to finish creating your Pack One account.</p><p>Verification links expire after 15 minutes.</p></div><button class="button secondary" id="account-verification-resend" type="button">Send a new verification link</button><button class="button secondary" id="account-verification-signin" type="button">Back to sign in</button><p id="account-verification-status" aria-live="polite"></p>`;
        document.querySelector('#account-verification-resend')?.addEventListener('click',async e=>{
          const button=e.currentTarget,status=document.querySelector('#account-verification-status');
          button.disabled=true;if(status){status.className='';status.textContent='';}
          try {
            const result=await requestVerificationEmail(data.email);
            if(status){status.className='form-success';status.textContent=result?.message||"If an unverified account exists for that email, we've sent a verification link.";}
          } catch(error) {
            if(status){status.className='form-error';status.textContent=error?.message||'Email verification is temporarily unavailable.';}
          } finally {button.disabled=false;}
        });
        document.querySelector('#account-verification-signin')?.addEventListener('click',()=>void renderAccount({validateDailyRunId:pendingDailyRunValidation,intent,source,mode:'signin'}));
        return;
      }
      const claimed=await claimCurrentSession();
      if(claimed?.linked?.newlyClaimed) {
        await openSignupNamePrompt({
          linked:claimed.linked,
          validationRunId:claimed.pendingValidationRunId,
          intent,source,
        });
        return;
      }
      if(claimed?.validationRunId){await returnToValidatedDaily(claimed.validationRunId,claimed.linked,source);return;}
      if(activatingPatreon){await renderPatreonActivation({source});return;}
      if(upgradingElite){await openEliteLanding(source);return;}
      await renderSignedInHome(source);
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
      if(!accountAuthCompleted(auth))throw Error('Sign in did not finish. Please try again.');
      const claimed=await claimCurrentSession();
      event('auth_sign_in',{source});
      if(claimed?.linked?.newlyClaimed) {
        await openSignupNamePrompt({
          linked:claimed.linked,
          validationRunId:claimed.pendingValidationRunId,
          intent,source,
        });
        return;
      }
      if(claimed?.validationRunId){await returnToValidatedDaily(claimed.validationRunId,claimed.linked,source);return;}
      if(activatingPatreon){await renderPatreonActivation({source});return;}
      if(upgradingElite){await openEliteLanding(source);return;}
      await renderSignedInHome(source);
    } catch(error) {
      err.textContent=error?.message||'Sign in failed.';
      if(error?.code==='EMAIL_NOT_VERIFIED') {
        let resend=form.querySelector('#account-signin-verification-resend');
        if(!resend) {
          resend=document.createElement('button');
          resend.className='button secondary';
          resend.id='account-signin-verification-resend';
          resend.type='button';
          resend.textContent='Send a new verification link';
          form.insertBefore(resend,err);
          resend.addEventListener('click',async()=>{
            resend.disabled=true;
            try {
              const result=await requestVerificationEmail(String(new FormData(form).get('email')||''));
              err.textContent=result?.message||"If an unverified account exists for that email, we've sent a verification link.";
            } catch(resendError) {
              err.textContent=resendError?.message||'Email verification is temporarily unavailable.';
            } finally {resend.disabled=false;}
          });
        }
      }
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
  if(status==='verify') {
    const current=new URL(location.href);
    const error=current.searchParams.get('error');
    const nativeReturn=current.searchParams.get('native')==='1';
    if(error) {
      current.searchParams.delete('auth');
      current.searchParams.delete('error');
      current.searchParams.delete('error_description');
      current.searchParams.delete('native');
      current.searchParams.delete('neon_auth_session_verifier');
      history.replaceState({},'',current.pathname+(current.searchParams.size?'?'+current.searchParams:''));
      event('auth_verification_failed',{source:flow.source||'unknown'});
      return renderVerificationRecovery('This verification link has expired or is no longer valid. Request a new link.');
    }
    if(nativeReturn) {
      current.searchParams.delete('auth');
      current.searchParams.delete('native');
      current.searchParams.delete('neon_auth_session_verifier');
      history.replaceState({},'',current.pathname+(current.searchParams.size?'?'+current.searchParams:''));
      event('auth_verification_completed',{source:'native'});
      const app=document.querySelector('#app');
      if(app)app.innerHTML='<section class="account-page growth-page"><header><p class="eyebrow">Email verified</p><h1>Your email is verified.</h1><p>Return to Pack One on your phone or tablet to finish setting up this account and keep the progress already on that device.</p></header><div class="account-actions"><a class="button primary" href="packone://account?emailVerified=1">Return to Pack One app</a><a class="button secondary" href="?account=signin">Continue on web</a></div></section>';
      return;
    }
    let verifiedSession=null;
    let verificationSessionError=null;
    try {verifiedSession=await completeEmailVerification();}
    catch(sessionError){verificationSessionError=sessionError;}
    current.searchParams.delete('auth');
    current.searchParams.delete('error');
    current.searchParams.delete('error_description');
    current.searchParams.delete('neon_auth_session_verifier');
    history.replaceState({},'',current.pathname+(current.searchParams.size?'?'+current.searchParams:''));
    event('auth_verification_completed',{source:flow.source||'unknown'});
    if(!verifiedSession) {
      return renderAccount({
        validateDailyRunId:flow.validateDailyRunId||null,
        intent:flow.intent||null,
        source:flow.source||'account',
        mode:'signin',
        notice:verificationSessionError
          ? 'Email verified. Sign in to finish setting up your account.'
          : 'Email verified. Sign in to continue on this browser.',
      });
    }
    if(Object.prototype.hasOwnProperty.call(flow,'validateDailyRunId'))pendingDailyRunValidation=flow.validateDailyRunId||null;
    const claimed=await claimCurrentSession();
    if(claimed?.linked?.newlyClaimed) {
      return openSignupNamePrompt({
        linked:claimed.linked,
        validationRunId:claimed.pendingValidationRunId,
        intent:flow.intent||null,
        source:flow.source||'account',
      });
    }
    if(claimed?.validationRunId)return returnToValidatedDaily(claimed.validationRunId,claimed.linked,flow.source||'account');
    if(flow.intent==='patreon-activate')return renderPatreonActivation({source:flow.source||'account'});
    if(flow.intent==='elite')return openEliteLanding(flow.source||'account');
    return renderSignedInHome(flow.source||'account');
  }

  if(status==='apple-delete'||status==='apple-delete-error') {
    if(status==='apple-delete-error') {
      const clean=new URL(location.href);
      clean.searchParams.delete('auth');
      clean.searchParams.delete('appleDeleteHandoff');
  clean.searchParams.delete('appleErrorCode');
      history.replaceState({},'',clean.pathname+(clean.searchParams.size?'?'+clean.searchParams:''));
      event('account_delete_apple_verification_failed',{source:flow.source||'account'});
      return renderAccount({source:flow.source||'account',notice:'Apple verification did not finish. Your account was not deleted.'});
    }
    try {
      const result=await completeAppleDeletion();
      const clean=new URL(location.href);
      clean.searchParams.delete('auth');
      clean.searchParams.delete('appleDeleteHandoff');
      history.replaceState({},'',clean.pathname+(clean.searchParams.size?'?'+clean.searchParams:''));
      event('account_delete_apple_verified',{source:flow.source||'account'});
      return renderDeletionState(result?.deletion==='complete'?'deleted':'deleting');
    } catch(error) {
      const clean=new URL(location.href);
      clean.searchParams.delete('auth');
      clean.searchParams.delete('appleDeleteHandoff');
      history.replaceState({},'',clean.pathname+(clean.searchParams.size?'?'+clean.searchParams:''));
      event('account_delete_apple_verification_failed',{source:flow.source||'account'});
      return renderAccount({source:flow.source||'account',notice:error?.message||'Apple verification could not be completed. Your account was not deleted.'});
    }
  }

  const source=flow.source||'unknown';
  let failure=null;
  if(status==='google') {
    try {
      await completeGoogleSignIn();
      event('auth_google_completed',{source});
    } catch(error) {
      event('auth_google_failed',{source});
      failure={provider:'google',message:error?.message||'Google sign in did not finish. Please try again.'};
    }
  } else if(status==='apple') {
    try {
      await completeAppleSignIn();
      event('auth_apple_completed',{source});
    } catch(error) {
      event('auth_apple_failed',{source});
      failure={provider:'apple',message:error?.message||'Apple sign in did not finish. Please try again.'};
    }
  } else if(status==='apple-error') {
    event('auth_apple_failed',{source});
    const appleErrorCode=new URL(location.href).searchParams.get('appleErrorCode');
    failure={provider:'apple',message:appleErrorCode==='APPLE_EXISTING_ACCOUNT_UNVERIFIED'
      ? 'An unverified Pack One account already uses this email. Reset its password from that inbox, then try Apple again.'
      : 'Apple sign in did not finish. Please try again.'};
  } else {
    event('auth_google_failed',{source});
    failure={provider:'google',message:'Google sign in did not finish. Please try again.'};
  }

  const clean=new URL(location.href);
  clean.searchParams.delete('auth');
  clean.searchParams.delete('neon_auth_session_verifier');
  clean.searchParams.delete('appleHandoff');
  clean.searchParams.delete('appleDeleteHandoff');
  history.replaceState({},'',clean.pathname+(clean.searchParams.size?'?'+clean.searchParams:''));

  await renderAccount({validateDailyRunId:flow.validateDailyRunId||null,intent:flow.intent||null,source:flow.source||'account'});
  if(failure?.provider==='apple')appleError(failure.message);
  if(failure?.provider==='google')googleError(failure.message);
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
  if(renderDeletionState(deletionState))return {state:'signed-out',account:null,error:null};
  const result=await refreshAccountSession();
  // Authentication/account-establishment flows link explicitly. Ordinary page
  // bootstrap must only observe the existing account session: calling
  // link-browser here rotates identity cookies and defeats session stability.
  if(result.state!=='unavailable')event('page_view', { account:result.state==='signed-in' });
  document.addEventListener('pack1:share-completed', shareCompletedAnalytics);
  document.addEventListener('click', e => {
    if (e.target.closest?.('#leaderboard-nav')) event('leaderboard_view');
  }, true);
  return result;
}
