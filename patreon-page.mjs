import { getAuthSession, loadPatreonStatus } from '/growth-api.mjs';
import { startPatreonOAuth } from '/patreon-activation.mjs?v=2';
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
      const { beginEliteUpgrade }=await import('/growth.mjs?v=7');
      await beginEliteUpgrade({source:'patreon_landing'});
    };
    setStatus('Sign in or create a free Pack One account to connect membership and keep Elite access with the right player record.',{state:'signed-out',heading:'Sign in to check your access'});
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
  if(source) {
    action.textContent='Open Practice';
    action.disabled=false;
    action.onclick=()=>location.assign('/practice/');
    // Only Patreon-sourced Elite is managed on Patreon; an Apple subscriber is not sent there.
    setStatus(source==='apple'
      ? 'Powered Cube and custom-set practice are unlocked through your Apple App Store subscription. Manage it in your Apple subscription settings.'
      : 'Powered Cube and custom-set practice are unlocked on this Pack One account.',source==='patreon'
      ? {state:'elite',heading:'Elite is active',showPatreon:true,patreonLabel:'Manage Patreon membership'}
      : {state:'elite',heading:'Elite is active'});
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
    ? 'Patreon is connected. Refresh access after a membership change; a requested refresh is not confirmation until Pack One verifies the updated entitlement.'
    : 'No Patreon account is connected to this Pack One account. Connect the Patreon account you use for Pack One membership.',patreon?.connected
      ? {state:'connected',heading:'Patreon connected',showPatreon:true,patreonLabel:'Manage Patreon membership'}
      : {state:'unconnected',heading:'Connect Patreon to activate Elite',showPatreon:true});
}

void renderMembershipState();
