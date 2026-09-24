import { getAuthSession, loadPatreonStatus } from '/growth-api.mjs';
import { startPatreonOAuth } from '/patreon-activation.mjs';

const statusNode=document.querySelector('[data-patreon-status]');
const action=document.querySelector('[data-patreon-connect]');

function setStatus(message) {
  if(statusNode)statusNode.textContent=message;
}

async function openPatreonConnection() {
  if(!action)return;
  action.disabled=true;
  setStatus('Opening Patreon…');
  try {
    await startPatreonOAuth('patreon_landing');
  } catch(error) {
    action.disabled=false;
    setStatus(error?.message||'Patreon could not be opened. Please try again.');
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
    setStatus(error?.message||'Pack One could not check your account right now.');
    return;
  }

  if(!account?.user) {
    action.textContent='Sign in to Pack One';
    action.disabled=false;
    action.onclick=async()=>{
      action.disabled=true;
      const { beginEliteUpgrade }=await import('/growth.mjs?v=6');
      await beginEliteUpgrade({source:'patreon_landing'});
    };
    setStatus('Sign in or create a free Pack One account first. Elite benefits need a Pack One account to attach to.');
    return;
  }

  let patreon;
  try {
    patreon=await loadPatreonStatus();
  } catch(error) {
    action.textContent='Try again';
    action.disabled=false;
    action.onclick=()=>void renderMembershipState();
    setStatus(error?.message||'Pack One could not check Patreon right now.');
    return;
  }

  const elite=patreon?.capabilities?.includes('custom_corpus')&&patreon?.capabilities?.includes('unlimited_cube_practice');
  if(elite) {
    action.textContent='Open Practice';
    action.disabled=false;
    action.onclick=()=>location.assign('/practice/');
    setStatus('Elite is active on this Pack One account. Powered Cube and custom-set practice are unlocked.');
    return;
  }

  if(patreon?.configured!==true) {
    action.textContent='Connect Patreon';
    action.disabled=true;
    action.onclick=null;
    setStatus('Patreon linking is temporarily unavailable. You can still review Elite on Patreon and connect when linking is available again.');
    return;
  }

  action.textContent=patreon?.connected?'Check Patreon again':'Connect Patreon';
  action.disabled=false;
  action.onclick=()=>void openPatreonConnection();
  setStatus(patreon?.connected
    ? 'Patreon is connected, but Elite is not active yet. If you just upgraded on Patreon, check Patreon again so Pack One can verify the latest membership.'
    : 'You are signed in to Pack One. After joining Elite on Patreon, connect the Patreon account you used so Pack One can verify and activate the membership.');
}

void renderMembershipState();
