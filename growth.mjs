import { escapeHtml as esc } from './html.mjs';
import { getAuthSession, linkAccount, signInAccount, signOutAccount, signUpAccount } from './growth-api.mjs';
import { trackEvent as event } from './retention-events.mjs';

let currentAccount = null;
let pendingDailyRunValidation = null;
// A CTA that promises Elite has to still be promising it at the destination.
// This survives the sign-up round trip below, so a guest who arrives from
// "Become Elite" lands on the membership section rather than a bare profile.
let pendingIntent = null;

function formMarkup(kind) {
  return `<form class="account-form" id="account-${kind}"><label>Email<input required type="email" name="email" autocomplete="email"></label>${kind==='signup'?'<label>Display name<input required name="name" minlength="2" maxlength="24" autocomplete="nickname"></label>':''}<label>Password<input required type="password" name="password" minlength="8" maxlength="128" autocomplete="${kind==='signup'?'new-password':'current-password'}"></label><button class="button primary" type="submit">${kind==='signup'?'Create account':'Sign in'}</button><p class="form-error" aria-live="polite"></p></form>`;
}
async function claimCurrentSession() {
  const session=await getAuthSession(); if(!session?.session?.token || !session?.user) return null;
  const validationRunId=pendingDailyRunValidation;
  const linked=await linkAccount(session.session.token,{validateDailyRunId:validationRunId}); pendingDailyRunValidation=null; currentAccount=session; return linked;
}
// The membership section only exists on your own profile, and only once an
// account exists, so this is best effort by design.
function revealMembership() {
  const section=document.querySelector('.profile-membership'); if(!section) return false;
  section.setAttribute('tabindex','-1');
  section.scrollIntoView({block:'start'});
  section.focus({preventScroll:true});
  return true;
}

export async function renderAccount({ validateDailyRunId = null, intent = null } = {}) {
  if(validateDailyRunId) pendingDailyRunValidation=validateDailyRunId;
  if(intent) pendingIntent=intent;
  document.body.classList.remove('is-game');
  const app=document.querySelector('#app'); if(!app) return;
  currentAccount=await getAuthSession();
  if(currentAccount?.session?.token && currentAccount?.user) {
    const validationRunId=pendingDailyRunValidation,arrivingIntent=pendingIntent;
    await linkAccount(currentAccount.session.token,{validateDailyRunId:validationRunId}).catch(()=>null);
    pendingDailyRunValidation=null;pendingIntent=null;
    await (await import('./profile-product.mjs')).renderMyProfile();
    if(arrivingIntent==='elite')revealMembership();
    return;
  }
  const validatingDaily=Boolean(pendingDailyRunValidation),seekingElite=!validatingDaily&&pendingIntent==='elite';
  // Consumed here, then carried forward explicitly by the forms below. Left
  // pending it would outlive this render and put Elite copy on an unrelated
  // later prompt, such as claiming progress from a result screen.
  pendingIntent=null;
  const heading=validatingDaily?'Add your score to the leaderboard.':seekingElite?'Elite starts with an account.':'Save your progress.';
  const lede=validatingDaily?'Sign in or create a free account to validate this Daily score and add it to today’s leaderboard.'
    :seekingElite?'Elite adds unlimited Powered Cube and custom-set drafts. Create a free account or sign in, then connect Patreon to unlock them.'
    :'All three Dailies are free without an account. A free account saves your record, enables leaderboard participation, and adds unlimited regular Draft Runs.';
  app.innerHTML=`<section class="account-page growth-page"><header><p class="eyebrow">Account access</p><h1>${heading}</h1><p>${lede}</p></header><div class="account-columns"><div><h2>Create account</h2>${formMarkup('signup')}</div><div><h2>Sign in</h2>${formMarkup('signin')}</div></div><div class="account-actions">${new URLSearchParams(location.search).get('game')==='draft-run'?`<a class="button primary" href="${esc(location.href)}">Continue to your run</a>`:''}<button class="button secondary" id="account-career">Back to my career</button><button class="text-button" id="account-home">Keep playing as guest</button></div></section>`;
  document.querySelector('#account-career')?.addEventListener('click',()=>document.querySelector('#account-nav')?.click());
  document.querySelector('#account-home')?.addEventListener('click',()=>document.querySelector('#brand-home')?.click());
  const onward=seekingElite?{intent:'elite'}:{};
  document.querySelector('#account-signup')?.addEventListener('submit',async(e)=>{e.preventDefault();const f=e.currentTarget,err=f.querySelector('.form-error');err.textContent='';try{const data=Object.fromEntries(new FormData(f));await signUpAccount(data);await claimCurrentSession();event('auth_sign_up');await renderAccount(onward);}catch(x){err.textContent=x.message;}});
  document.querySelector('#account-signin')?.addEventListener('submit',async(e)=>{e.preventDefault();const f=e.currentTarget,err=f.querySelector('.form-error');err.textContent='';try{const data=Object.fromEntries(new FormData(f));await signInAccount(data);await claimCurrentSession();event('auth_sign_in');await renderAccount(onward);}catch(x){err.textContent=x.message;}});
}
function shareCompletedAnalytics(eventObject) {
  const detail=eventObject.detail||{};
  event('share_completed',{ method:String(detail.method||'unknown').slice(0,40), context:String(detail.context||'unknown').slice(0,40), challenge:Boolean(detail.challenge) });
}

export async function installGrowthLayer() {
  currentAccount = await getAuthSession();
  if (currentAccount?.session?.token) await linkAccount(currentAccount.session.token).catch(() => null);
  event('page_view', { account:Boolean(currentAccount?.user) });
  document.addEventListener('pack1:share-completed', shareCompletedAnalytics);
  document.addEventListener('click', e => {
    if (e.target.closest?.('#leaderboard-nav')) event('leaderboard_view');
  }, true);
}
