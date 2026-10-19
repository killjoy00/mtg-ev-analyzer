import {getAuthSession,loadDailyReminders,saveDailyReminders,requestVerificationEmail,ACCOUNT_SIGNAL_KEY} from './growth-api.mjs?v=2';

const safe=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
let ownerGeneration=0;
let listenersInstalled=false;
function installOwnerIsolation() {
  if(listenersInstalled)return;
  listenersInstalled=true;
  const clear=()=>{ownerGeneration++;const mount=document.querySelector('#daily-reminder-content');if(mount){mount.replaceChildren();void bindDailyReminderSettings();}};
  window.addEventListener('packone-account-changed',clear);
  window.addEventListener('storage',event=>{if(event.key===ACCOUNT_SIGNAL_KEY)clear();});
}

export function dailyReminderSettingsMarkup({signedIn=false}={}) {
  return '<section class="settings-row profile-settings-group profile-reminders" aria-labelledby="daily-reminder-heading" id="daily-reminder-settings">'+
    '<div class="settings-row-label"><h3 id="daily-reminder-heading">Daily reminders</h3>'+
    '<p class="profile-settings-intro">One email a day while the Dailies are open. Skipped on days you’ve finished all three.</p></div>'+
    '<div class="settings-row-body">'+(signedIn?'<div id="daily-reminder-content" aria-live="polite"><p class="profile-settings-intro">Loading reminder settings…</p></div>':
      '<p class="profile-settings-intro">Sign in and verify your account email to get email reminders.</p>')+'</div>'+
    '</section>';
}
function nextText(value) {
  const time=new Date(value);
  if(!value||Number.isNaN(time.getTime()))return '';
  return time.toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
function renderSetting(mount,state) {
  const email=state.email||{};
  const verified=email.eligible===true,canEnable=verified&&!email.suppressed;
  const status=email.enabled
    ?'<p class="reminder-status"><span class="reminder-state is-on">On</span>'+
      (state.nextAt?'<span>Next email: '+safe(nextText(state.nextAt))+'</span>':'<span>Email reminders are on.</span>')+'</p>'
    :'<p class="reminder-status"><span class="reminder-state">Off</span><span>No reminder emails.</span></p>';
  const action=!canEnable?'':email.enabled
    ?'<button class="button secondary" type="button" id="daily-reminder-optout">Turn off</button>'
    :'<button class="button secondary" type="button" id="daily-reminder-enable">Turn on</button>';
  mount.innerHTML=
    '<div class="reminder-summary">'+status+(action?'<div class="reminder-actions">'+action+'</div>':'')+'</div>'+
    (email.addressChanged?'<p class="reminder-note" role="alert">Your sign-in email changed. Turn reminders off and on again to send them to the new address.</p>':'')+
    (email.suppressed?'<p class="reminder-note" role="alert">Email reminders are paused after a bounce or complaint. Contact support to turn them back on.</p>':'')+
    (!verified?'<p class="reminder-note">Verify your sign-in email to turn on email reminders. <button class="text-button" type="button" id="daily-reminder-verify">Send verification email</button></p>':'')+
    (email.enabled&&email.deliveryActive===false?'<p class="reminder-note">Email reminders aren’t being sent yet. Your choice is saved.</p>':'')+
    '<p id="daily-reminder-status" class="profile-settings-status" role="status" aria-live="polite"></p>';
}
export async function bindDailyReminderSettings() {
  installOwnerIsolation();
  const mount=document.querySelector('#daily-reminder-content');
  if(!mount)return;
  const generation=++ownerGeneration;
  try {
    const before=await getAuthSession();
    if(!before?.user?.id){if(generation===ownerGeneration&&mount.isConnected)mount.innerHTML='<p class="profile-settings-intro">Sign in and verify your account email to manage Daily reminders.</p>';return;}
    const accountId=before.user.id;
    const current=await loadDailyReminders();
    if(generation!==ownerGeneration||!mount.isConnected)return;
    const after=await getAuthSession();
    if(after?.user?.id!==accountId)return;
    renderSetting(mount,current);
    const feedback=()=>mount.querySelector('#daily-reminder-status');
    const buttons=()=>mount.querySelectorAll('button');
    const send=async value=>{
      const field=feedback();
      if(field)field.textContent='Saving…';
      for(const button of buttons())button.disabled=true;
      try {
        if((await getAuthSession())?.user?.id!==accountId)throw Error('Account changed. Reload Account settings.');
        const updated=await saveDailyReminders({...value,expectedAccountId:accountId});
        if(generation!==ownerGeneration||!mount.isConnected)return;
        if((await getAuthSession())?.user?.id!==accountId||generation!==ownerGeneration||!mount.isConnected)return;
        renderSetting(mount,updated);
        const rebound=await bindDailyReminderSettings();
        if(rebound?.accountId!==accountId||rebound.generation!==ownerGeneration||!mount.isConnected)return;
        const updatedFeedback=mount.querySelector('#daily-reminder-status');
        if(updatedFeedback)updatedFeedback.textContent=value.enabled?'Email reminders turned on.':'Email reminders turned off.';
      }catch(error){
        if(generation!==ownerGeneration||!mount.isConnected)return;
        if(field)field.textContent=error?.message||'Reminder settings could not be saved.';
        for(const button of buttons())button.disabled=false;
      }
    };
    mount.querySelector('#daily-reminder-enable')?.addEventListener('click',()=>void send({channel:'email',enabled:true}));
    mount.querySelector('#daily-reminder-optout')?.addEventListener('click',()=>void send({channel:'email',enabled:false}));
    mount.querySelector('#daily-reminder-verify')?.addEventListener('click',async event=>{
      const button=event.currentTarget,field=feedback();button.disabled=true;
      try {
        const signedIn=await getAuthSession();
        if(signedIn?.user?.id!==accountId||generation!==ownerGeneration)return;
        await requestVerificationEmail(signedIn.user.email);
        if(generation===ownerGeneration&&mount.isConnected&&field)field.textContent='Verification requested. Check your account email.';
      }catch(error){
        if(generation===ownerGeneration&&mount.isConnected&&field)field.textContent=error?.message||'Could not request verification.';
      }finally{if(generation===ownerGeneration&&button.isConnected)button.disabled=false;}
    });
    return {accountId,generation};
  }catch(error) {
    if(generation===ownerGeneration&&mount.isConnected)
      mount.innerHTML='<p role="alert">Could not load reminders. '+safe(error?.message||'Please try again.')+
        '</p><button type="button" class="button secondary" id="daily-reminder-retry">Retry</button>';
    mount.querySelector('#daily-reminder-retry')?.addEventListener('click',()=>void bindDailyReminderSettings());
  }
}
