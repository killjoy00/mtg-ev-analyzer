import { escapeHtml as esc } from './html.mjs';
import { connectPatreon, getAuthSession, loadPatreonStatus, signalAccountChange } from './growth-api.mjs';
import { PATREON_POLICY } from './patreon-policy.mjs';
import { flushEvents, trackEvent as event } from './retention-events.mjs';

const ACTIVATION_KEY='pack1-patreon-activation-v1';

function activationIntent() {
  try {const raw=sessionStorage.getItem(ACTIVATION_KEY);return raw?JSON.parse(raw):null;} catch {return null;}
}
function activationSource(fallback='activation') {
  return String(activationIntent()?.source||fallback||'activation').slice(0,80);
}
export function rememberPatreonActivation(source='welcome_note') {
  try {
    const existing=activationIntent();
    if(existing)return existing;
    const intent={source:String(source||'activation').slice(0,80)};
    sessionStorage.setItem(ACTIVATION_KEY,JSON.stringify(intent));
    event('patreon_activation_started',{source:intent.source});
    return intent;
  } catch {return null;}
}
export function hasPatreonActivationIntent() {
  try {return Boolean(sessionStorage.getItem(ACTIVATION_KEY));} catch {return false;}
}
export function clearPatreonActivation() {
  try {sessionStorage.removeItem(ACTIVATION_KEY);} catch {}
}

function shell(body,actions='') {
  document.body.classList.remove('is-game');
  const app=document.querySelector('#app');if(!app)return;
  app.innerHTML=`<section class="account-page growth-page patreon-activation-page"><header><p class="eyebrow">Membership</p><h1>Activate Pack One Elite</h1><p>Pack One verifies Elite directly with Patreon before unlocking premium practice.</p></header><div class="message-card">${body}${actions?`<div class="account-actions">${actions}</div>`:''}</div></section>`;
  document.querySelectorAll('[data-patreon-activation-exit]').forEach(link=>link.addEventListener('click',clearPatreonActivation));
}

async function startOAuth(source) {
  rememberPatreonActivation(source);
  event('patreon_activation_oauth_started',{source:activationSource(source)});
  const result=await connectPatreon();
  let target=null;
  try {target=new URL(String(result?.url||''));} catch {}
  if(!target||target.protocol!=='https:'||target.hostname!=='www.patreon.com')throw Error('Patreon did not return a valid authorization URL.');
  await flushEvents().catch(()=>{});
  location.assign(target.toString());
}

function bindOAuth(source) {
  document.querySelector('#patreon-activation-oauth')?.addEventListener('click',async e=>{
    const button=e.currentTarget,status=document.querySelector('#patreon-activation-status');
    button.disabled=true;if(status)status.textContent='Opening Patreon…';
    try {await startOAuth(source);}
    catch(error){button.disabled=false;if(status)status.textContent=error?.message||'Patreon could not be opened. Please try again.';}
  });
}

export async function renderPatreonActivation({result=null,source='welcome_note',onSignedOut=null}={}) {
  rememberPatreonActivation(source);
  let account;
  try {account=await getAuthSession();}
  catch(error) {
    shell(`<h2>Account access is temporarily unavailable.</h2><p>${esc(error?.message||'Please try again.')}</p>`,
      '<button class="button primary" id="patreon-activation-retry" type="button">Try again</button><a class="button secondary" data-patreon-activation-exit href="./">Back to Pack One</a>');
    document.querySelector('#patreon-activation-retry')?.addEventListener('click',()=>void renderPatreonActivation({result,source,onSignedOut}));
    return;
  }
  if(!account?.user){if(onSignedOut)return onSignedOut();return;}

  let patreon;
  try {patreon=await loadPatreonStatus();}
  catch(error) {
    shell(`<h2>Patreon is temporarily unavailable.</h2><p>${esc(error?.message||'Pack One could not check your membership.')}</p><p id="patreon-activation-status" aria-live="polite"></p>`,
      '<button class="button primary" id="patreon-activation-oauth" type="button">Try Patreon again</button><a class="button secondary" data-patreon-activation-exit href="./">Back to Pack One</a>');
    bindOAuth(source);return;
  }

  const elite=patreon?.capabilities?.includes('custom_corpus')&&patreon?.capabilities?.includes('unlimited_cube_practice');
  if(elite) {
    signalAccountChange();
    event('patreon_activation_succeeded',{source:activationSource(source)});
    clearPatreonActivation();
    shell('<h2>Elite is active.</h2><p>Powered Cube practice and custom-set practice are unlocked.</p>',
      '<a class="button primary" href="?game=draft-run&custom=1">Choose your sets</a><a class="button secondary" href="?game=draft-run&set=powered-cube">Start Powered Cube practice</a>');
    return;
  }

  const retry='<button class="button primary" id="patreon-activation-oauth" type="button">Check Patreon again</button>';
  const support=`<a class="button secondary" href="${esc(patreon?.support_url||PATREON_POLICY.supportUrl)}" rel="noopener noreferrer">Review membership on Patreon</a>`;
  if(result==='conflict') {
    clearPatreonActivation();
    shell('<h2>This Patreon account is already connected to another Pack One account.</h2><p>Sign in to the Pack One account previously connected to this Patreon identity, or disconnect Patreon from that account first. Pack One does not expose details about the other account.</p>',
      '<a class="button primary" data-patreon-activation-exit href="?account=signin">Open account access</a><a class="button secondary" data-patreon-activation-exit href="./">Back to Pack One</a>');
    return;
  }
  if(result==='identity-mismatch') {
    clearPatreonActivation();
    shell('<h2>This Pack One account is already connected to a different Patreon account.</h2><p>To switch Patreon identities, disconnect Patreon from My Pack One first, then start activation again.</p>',
      '<a class="button primary" data-patreon-activation-exit href="?account=patreon">Open My Pack One</a><a class="button secondary" data-patreon-activation-exit href="./">Back to Pack One</a>');
    return;
  }
  if(result==='expired') {
    shell('<h2>Your Patreon authorization expired.</h2><p>Nothing was activated from the expired request. Start Patreon authorization again.</p><p id="patreon-activation-status" aria-live="polite"></p>',retry+'<a class="button secondary" data-patreon-activation-exit href="./">Back to Pack One</a>');
    bindOAuth(source);return;
  }
  if(result==='unavailable') {
    shell('<h2>Patreon linking is temporarily unavailable.</h2><p>Your Pack One account is unchanged. Try the authorization again.</p><p id="patreon-activation-status" aria-live="polite"></p>',retry+'<a class="button secondary" data-patreon-activation-exit href="./">Back to Pack One</a>');
    bindOAuth(source);return;
  }
  if(result==='error') {
    shell('<h2>Patreon could not be connected.</h2><p>Your Pack One account is unchanged. Try Patreon again.</p><p id="patreon-activation-status" aria-live="polite"></p>',retry+'<a class="button secondary" data-patreon-activation-exit href="./">Back to Pack One</a>');
    bindOAuth(source);return;
  }
  if(patreon?.configured!==true) {
    shell('<h2>Patreon linking is temporarily unavailable.</h2><p>Pack One cannot verify a new Patreon authorization right now.</p>',
      '<a class="button primary" href="./">Back to Pack One</a>');
    return;
  }
  if(!patreon?.connected) {
    shell('<h2>Authorize Patreon to activate Elite.</h2><p>You are signed in to Pack One. Patreon authorization is the remaining step.</p><p id="patreon-activation-status" aria-live="polite">Opening Patreon…</p>',
      '<button class="button primary" id="patreon-activation-oauth" type="button">Activate Elite</button><a class="button secondary" data-patreon-activation-exit href="./">Not now</a>');
    bindOAuth(source);
    try {await startOAuth(source);} catch(error) {
      const status=document.querySelector('#patreon-activation-status');if(status)status.textContent=error?.message||'Use Activate Elite to try again.';
      const button=document.querySelector('#patreon-activation-oauth');if(button)button.disabled=false;
    }
    return;
  }

  const state=patreon?.membership?.effective_state||'unknown';
  if(patreon?.membership?.sync_pending||(result==='connected'&&state==='unknown')) {
    shell('<h2>Your Patreon account is connected.</h2><p>We’re waiting for the latest membership update.</p><p id="patreon-activation-status" aria-live="polite"></p>',retry+'<a class="button secondary" data-patreon-activation-exit href="./">Back to Pack One</a>');
    bindOAuth(source);return;
  }
  if(state==='active_non_elite') {
    shell('<h2>Patreon is connected, but Elite is not active.</h2><p>Pack One currently sees a non-Elite Patreon membership. If you just upgraded, check Patreon again.</p><p id="patreon-activation-status" aria-live="polite"></p>',
      retry+`<a class="button secondary" href="${esc(patreon?.support_url||PATREON_POLICY.supportUrl)}" rel="noopener noreferrer">Upgrade to Elite on Patreon</a>`);
    bindOAuth(source);return;
  }
  if(state==='not_entitled') {
    shell('<h2>Patreon is connected, but Pack One does not currently see an active Elite entitlement.</h2><p>Review the membership on Patreon or authorize again to check the latest provider state.</p><p id="patreon-activation-status" aria-live="polite"></p>',support+retry);
    bindOAuth(source);return;
  }
  shell('<h2>Patreon is connected.</h2><p>Pack One could not classify the latest membership state yet. Check Patreon again.</p><p id="patreon-activation-status" aria-live="polite"></p>',retry+'<a class="button secondary" data-patreon-activation-exit href="./">Back to Pack One</a>');
  bindOAuth(source);
}
