import { getAuthSession, loadPatreonStatus } from '/growth-api.mjs';
import { startPatreonOAuth } from '/patreon-activation.mjs?v=3';
import {trackEvent,flushEvents} from '/retention-events.mjs';
import { eliteSource } from '/membership-source.mjs';

const statusNode=document.querySelector('[data-patreon-status]');
const action=document.querySelector('[data-patreon-connect]');
const card=document.querySelector('[data-patreon-connect-card]');
const title=document.querySelector('[data-patreon-title]');
const offsite=document.querySelector('[data-patreon-offsite]');

function setStatus(message,{state=null,heading=null,showPatreon=false,patreonLabel='View Patreon membership'}={}) {
  if(statusNode)statusNode.textContent=message;
  if(card&&state)card.dataset.state=state;
  if(title&&heading)title.textContent=heading;
  if(offsite){
    offsite.hidden=!showPatreon;
    offsite.textContent=patreonLabel;
  }
}

async function openPatreonConnection() {
  if(!action)return;
  action.disabled=true;
  setStatus('Opening Patreon…');
  try {
    await startPatreonOAuth('patreon_landing');
  } catch(error) {
    action.disabled=false;
    setStatus(error?.message||'Patreon could not be opened. Please try again.',{state:'error',heading:'Patreon connection needs attention',showPatreon:true});
  }
}

async function renderMembershipState() {
  if(!action)return;
  action.disabled=true;
  let account;
  try {
    account=await getAuthSession();
  } catch(error) {
    action.textContent='Try again';
    action.disabled=false;
    action.onclick=()=>void renderMembershipState();
    setStatus(error?.message||'Pack One could not check your account right now.',{state:'error',heading:'Account status unavailable'});
    return;
  }

  if(!account?.user) {
    action.textContent='Sign in to Pack One';
    action.disabled=false;
    action.onclick=async()=>{
      action.disabled=true;
      location.assign('/?patreon=activate');
    };
    setStatus('Sign in to the Pack One account you want to use, then connect your existing Patreon membership.',{state:'signed-out',heading:'Sign in to check your access'});
    return;
  }

  let patreon;
  try {
    patreon=await loadPatreonStatus();
  } catch(error) {
    action.textContent='Try again';
    action.disabled=false;
    action.onclick=()=>void renderMembershipState();
    setStatus(error?.message||'Pack One could not check Patreon right now.',{state:'error',heading:'Patreon status unavailable',showPatreon:true});
    return;
  }

  const source=eliteSource(patreon);
  document.querySelectorAll('[data-membership-purchase]').forEach(button=>{
    button.hidden=Boolean(source)||(button.dataset.membershipPurchase==='supporter'&&patreon?.ad_free===true);
  });
  if(source) {
    action.textContent='Open Practice';
    action.disabled=false;
    action.onclick=()=>location.assign('/practice/');
    // Only Patreon-sourced Elite is managed on Patreon; an Apple subscriber is not sent there.
    setStatus(source==='apple'
      ? 'Elite is active through Apple, including ad-free browsing. Use the same Pack One account in the app. Manage billing in Apple subscription settings.'
      : 'Your choice of sets, Powered Cube practice, and ad-free browsing are unlocked on this Pack One account.',source==='patreon'
      ? {state:'elite',heading:'Elite is active',showPatreon:true,patreonLabel:'Manage Patreon membership'}
      : {state:'elite',heading:'Elite is active'});
    return;
  }

  if(patreon?.connected && patreon?.ad_free===true) {
    action.textContent='Open Practice';action.disabled=false;
    action.onclick=()=>location.assign('/practice/');
    setStatus('Display ads and TCGplayer promotions are hidden while you are signed in. Elite adds Powered Cube and your choice of sets.',
      {state:'supporter',heading:'Supporter is active',showPatreon:true,patreonLabel:'Manage Patreon membership'});
    return;
  }

  if(patreon?.configured!==true) {
    action.textContent='Connect Patreon';
    action.disabled=true;
    action.onclick=null;
    setStatus('Pack One cannot verify Patreon right now. Existing access is unchanged; try again later.',{state:'error',heading:'Patreon connection unavailable',showPatreon:true});
    return;
  }

  action.textContent=patreon?.connected?'Refresh Patreon access':'Connect Patreon';
  action.disabled=false;
  action.onclick=()=>void openPatreonConnection();
  setStatus(patreon?.connected
    ? 'Your Patreon account is connected. If you changed your membership, refresh here and Pack One will check your access.'
    : 'No Patreon account is connected to this Pack One account. Connect the Patreon account you use for Pack One membership.',patreon?.connected
      ? {state:'connected',heading:'Patreon connected',showPatreon:true,patreonLabel:'Manage Patreon membership'}
      : {state:'unconnected',heading:'Connect Patreon to check your membership benefits',showPatreon:true});
}

// This module and site-nav load independently. If this one starts first,
// getAuthSession() would otherwise take the legacy/no-config path and render
// a misleading signed-out page without checking the first-party session.
// Await the shared config import before making an account decision.
async function bootMembershipState() {
  if (!globalThis.PACK1_API) {
    try { await import('/leaderboard-config.js'); } catch {}
  }
  const origin=String(globalThis.PACK1_API?.growthUrl||globalThis.PACK1_API?.url||'');
  if (!origin.startsWith('https://')) {
    if(action) {
      action.textContent='Try again';
      action.disabled=false;
      action.onclick=()=>location.reload();
    }
    setStatus('Pack One could not load its account service configuration. Please try again.',
      {state:'error',heading:'Account status unavailable'});
    return;
  }
  await renderMembershipState();
}

document.querySelectorAll('[data-membership-purchase]').forEach(button=>button.addEventListener('click',async()=>{
  button.disabled=true;
  const status=document.querySelector('[data-membership-purchase-status]');
  try {
    if(!globalThis.PACK1_API)await import('/leaderboard-config.js');
    const {beginMembershipPurchase}=await import('/growth.mjs?v=33');
    await beginMembershipPurchase(button.dataset.membershipPurchase);
  } catch(error) {if(status)status.textContent=error?.message||'Could not open membership. Please try again.';}
  finally {button.disabled=false;}
}));
offsite?.addEventListener('click',()=>{
  trackEvent('membership_provider_opened',{source:'patreon',context:'manage'});
  void flushEvents();
});
void bootMembershipState().then(()=>trackEvent('membership_offer_viewed',{source:'membership_page',context:'web'}));
