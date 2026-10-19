import {getAuthSession,loadDailyReminders,saveDailyReminders,requestVerificationEmail,ACCOUNT_SIGNAL_KEY} from './growth-api.mjs?v=2';

const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const safe=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const browserZone=()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'Etc/UTC';}catch{return 'Etc/UTC';}};
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
  return '<section class="profile-settings-group" aria-labelledby="daily-reminder-heading" id="daily-reminder-settings">'+
    '<div class="profile-settings-heading-row"><div><p class="eyebrow">Reminders</p>'+
    '<h3 id="daily-reminder-heading">Daily reminders</h3>'+
    '<p class="profile-settings-intro">Opt in to a reminder to play. Emails and device push are separate choices, both off by default.</p></div></div>'+
    (signedIn?'<div id="daily-reminder-content" aria-live="polite"><p class="profile-empty">Loading reminder settings…</p></div>':
      '<p class="profile-empty">Sign in and verify your account email to enable email reminders.</p>')+
    '</section>';
}
function scheduleInputs(schedule) {
  const selected=new Set(schedule.weekdays||[1]);
  return '<label>Repeat<select class="select" name="frequency" required>'+
    [['daily','Every day'],['weekly','Once weekly'],['custom','Selected weekdays']]
      .map(([v,l])=>'<option value="'+v+'"'+(schedule.frequency===v?' selected':'')+'>'+l+'</option>').join('')+
    '</select></label>'+
    '<fieldset class="reminder-days" style="border:0;padding:0;margin:0"><legend>Weekdays</legend>'+
    '<div style="display:flex;gap:.5rem;flex-wrap:wrap">'+DAYS.map((label,i)=>'<label class="profile-toggle" style="min-width:4rem">'+
      '<input type="checkbox" name="weekdays" value="'+i+'"'+(selected.has(i)?' checked':'')+'><span>'+label+'</span></label>').join('')+'</div>'+
    '<small>For once weekly, select one day. For custom, select one or more. Every day ignores this selection.</small></fieldset>'+
    '<label>Local time<input class="select" type="time" name="localTime" required value="'+safe(schedule.localTime||'09:00')+'"></label>'+
    '<label>Timezone (IANA)<input class="select" type="text" name="timeZone" required maxlength="80" spellcheck="false" '+
      'value="'+safe(schedule.timeZone||browserZone())+'" aria-describedby="daily-reminder-zone-help"></label>'+
    '<small id="daily-reminder-zone-help">For example, America/Chicago. Daily games still reset on Pacific time.</small>';
}
function statusDate(value,missing='No confirmed delivery yet') {
  if(!value)return missing;
  const time=new Date(value);
  return Number.isNaN(time.getTime())?'Delivery date unavailable':time.toLocaleString();
}
function renderSetting(mount,state) {
  const email=state.email||{},push=state.push||{},schedule=state.schedule||{};
  const verified=email.eligible===true;
  mount.innerHTML=
    '<p role="status"><strong>Email:</strong> '+(email.enabled?'On':'Off')+
    ' · <strong>Push:</strong> '+(push.enabled?'On':'Off')+
    (state.nextAt?' · Next scheduled: '+safe(statusDate(state.nextAt)):'')+'</p>'+
    '<p>Saved: '+safe(schedule.frequency==='daily'?'Every day':(schedule.weekdays||[]).map(day=>DAYS[day]).join(', '))+' at '+safe(schedule.localTime)+' ('+safe(schedule.timeZone)+').</p>'+
    (email.deliveryActive===false?'<p class="profile-empty">Email delivery is not active yet. Your saved email choice will not send reminders until activation.</p>':'')+
    (email.addressChanged?'<p role="alert">Your account email changed. Save email reminders again to consent to the new verified address.</p>':'')+
    (email.suppressed?'<p role="alert">Email paused due to a bounce or complaint. Contact support before opting in again.</p>':'')+
    '<p><small>Latest email attempt: '+safe(email.lastAttempt?.state||'none')+
      '; latest push attempt: '+safe(push.lastAttempt?.state||'none')+
      (push.lastAttempt?.platformReceipt?' ('+safe(push.lastAttempt.platformReceipt)+' at platform, not device display)':'')+'.</small></p>'+
    '<p><small>Last confirmed email delivery: '+safe(statusDate(email.deliveredAt))+
      '. Last push provider acceptance: '+safe(statusDate(push.providerAcceptedAt,'None recorded'))+' (not device delivery).</small></p>'+
    '<form id="daily-reminder-form" class="profile-settings-form">'+
      scheduleInputs(schedule)+
      '<label class="profile-toggle"><input type="checkbox" name="emailEnabled"'+(email.enabled?' checked':'')+
        (!verified||email.suppressed?' disabled':'')+'><span><strong>Email Daily reminders</strong> <small>Only to your verified sign-in email. No other address can be entered.</small></span></label>'+
      (!verified?'<p class="profile-empty">Verify your sign-in email first.</p><button class="button secondary" type="button" id="daily-reminder-verify">Send verification email</button>':'')+
      '<div class="profile-settings-actions">'+
        '<button class="button primary" type="submit"'+(!verified||email.suppressed?' disabled':'')+'>Save email reminders</button>'+
        (email.enabled?'<button class="button secondary" type="button" id="daily-reminder-optout">Turn off email now</button>':'')+
        '<span id="daily-reminder-status" class="profile-settings-status" role="status" aria-live="polite"></span></div>'+
    '</form>'+
    '<p class="profile-settings-intro">Push notifications: '+(push.enabled?'enabled':'off')+
      '. To manage device permissions and push consent, open Account settings in the Pack One iOS or Android app.</p>';
}
export async function bindDailyReminderSettings() {
  installOwnerIsolation();
  const mount=document.querySelector('#daily-reminder-content');
  if(!mount)return;
  const generation=++ownerGeneration;
  try {
    const before=await getAuthSession();
    if(!before?.user?.id){if(generation===ownerGeneration&&mount.isConnected)mount.innerHTML='<p>Sign in and verify your account email to manage Daily reminders.</p>';return;}
    const accountId=before.user.id;
    const current=await loadDailyReminders();
    if(generation!==ownerGeneration||!mount.isConnected)return;
    const after=await getAuthSession();
    if(after?.user?.id!==accountId)return;
    // Device timezone is only the initial suggestion for a never-configured schedule.
    if(!current.email?.consentedAt&&!current.push?.consentedAt&&!current.nextAt)
      current.schedule.timeZone=browserZone();
    renderSetting(mount,current);
    const form=mount.querySelector('#daily-reminder-form');
    const feedback=()=>mount.querySelector('#daily-reminder-status');
    const snapshot=()=>{
      const fd=new FormData(form);
      const weekdays=fd.get('frequency')==='daily'?[0,1,2,3,4,5,6]:fd.getAll('weekdays').map(Number);
      return {frequency:String(fd.get('frequency')),weekdays,localTime:String(fd.get('localTime')),
        timeZone:String(fd.get('timeZone')).trim(),channel:'email',enabled:fd.get('emailEnabled')==='on'};
    };
    const send=async value=>{
      const field=feedback();
      if(field)field.textContent='Saving…';
      for(const button of form.querySelectorAll('button'))button.disabled=true;
      try {
        if((await getAuthSession())?.user?.id!==accountId)throw Error('Account changed. Reload Account settings.');
        const updated=await saveDailyReminders({...value,expectedAccountId:accountId});
        if(generation!==ownerGeneration||!mount.isConnected)return;
        if((await getAuthSession())?.user?.id!==accountId||generation!==ownerGeneration||!mount.isConnected)return;
        renderSetting(mount,updated);
        const rebound=await bindDailyReminderSettings();
        if(rebound?.accountId!==accountId||rebound.generation!==ownerGeneration||!mount.isConnected)return;
        const updatedFeedback=mount.querySelector('#daily-reminder-status');
        if(updatedFeedback)updatedFeedback.textContent=value.enabled?'Email reminder schedule saved.':'Email reminders turned off.';
      }catch(error){
        if(generation!==ownerGeneration||!mount.isConnected)return;
        if(field)field.textContent=error?.message||'Reminder settings could not be saved.';
        for(const button of form.querySelectorAll('button'))button.disabled=false;
      }
    };
    form.addEventListener('submit',event=>{
      event.preventDefault();
      const value=snapshot();
      if(value.frequency==='weekly'&&value.weekdays.length!==1) {
        const field=feedback();if(field)field.textContent='Select exactly one day for weekly reminders.';return;
      }
      if(value.weekdays.length===0) {
        const field=feedback();if(field)field.textContent='Select at least one weekday.';return;
      }
      void send(value);
    });
    mount.querySelector('#daily-reminder-optout')?.addEventListener('click',()=>void send({...current.schedule,channel:'email',enabled:false}));
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
