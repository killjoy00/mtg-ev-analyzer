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
  return '<section class="profile-settings-group profile-reminders" aria-labelledby="daily-reminder-heading" id="daily-reminder-settings">'+
    '<h3 id="daily-reminder-heading">Daily reminders</h3>'+
    (signedIn?'<div id="daily-reminder-content" aria-live="polite"><p class="profile-settings-intro">Loading reminder settings…</p></div>':
      '<p class="profile-settings-intro">Sign in and verify your account email to get email reminders.</p>')+
    '</section>';
}
function timeLabel(localTime) {
  const [hour,minute]=String(localTime||'09:00').split(':').map(Number);
  try {return new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',timeZone:'UTC'}).format(Date.UTC(2000,0,1,hour,minute));}
  catch {return String(localTime);}
}
const zoneLabel=zone=>String(zone||'').replaceAll('_',' ');
function scheduleText(schedule) {
  const days=schedule.frequency==='daily'?'Every day':(schedule.weekdays||[]).map(day=>DAYS[day]).join(', ');
  return days+' at '+timeLabel(schedule.localTime)+' ('+zoneLabel(schedule.timeZone)+')';
}
function nextText(value) {
  const time=new Date(value);
  if(!value||Number.isNaN(time.getTime()))return '';
  return time.toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
function zoneField(zone) {
  let zones=[];
  try {zones=Intl.supportedValuesOf('timeZone');} catch {}
  if(!zones.length)return '<label>Time zone<input class="select" type="text" name="timeZone" required maxlength="80" spellcheck="false" value="'+safe(zone)+'"></label>';
  if(!zones.includes(zone))zones=[zone,...zones];
  return '<label>Time zone<select class="select" name="timeZone" required>'+
    zones.map(value=>'<option value="'+safe(value)+'"'+(value===zone?' selected':'')+'>'+safe(zoneLabel(value))+'</option>').join('')+'</select></label>';
}
function editorMarkup(schedule) {
  const selected=new Set(schedule.weekdays||[1]);
  return '<form id="daily-reminder-form" class="reminder-editor" hidden>'+
    '<label>Repeat<select class="select" name="frequency" required>'+
      [['daily','Every day'],['weekly','Once a week'],['custom','Selected days']]
        .map(([v,l])=>'<option value="'+v+'"'+(schedule.frequency===v?' selected':'')+'>'+l+'</option>').join('')+
    '</select></label>'+
    '<label>Time<input class="select" type="time" name="localTime" required value="'+safe(schedule.localTime||'09:00')+'"></label>'+
    zoneField(schedule.timeZone||browserZone())+
    '<fieldset class="reminder-days"'+(schedule.frequency==='daily'?' hidden':'')+'><legend>Days</legend>'+
      DAYS.map((label,i)=>'<label class="reminder-day"><input type="checkbox" name="weekdays" value="'+i+'"'+(selected.has(i)?' checked':'')+'><span>'+label+'</span></label>').join('')+
    '</fieldset>'+
    '<div class="profile-settings-actions"><button class="button primary" type="submit">Save reminder</button>'+
      '<button class="button secondary" type="button" id="daily-reminder-cancel">Cancel</button></div>'+
  '</form>';
}
function renderSetting(mount,state) {
  const email=state.email||{},push=state.push||{},schedule=state.schedule||{};
  const verified=email.eligible===true,canEnable=verified&&!email.suppressed;
  const status=email.enabled
    ?'<p class="reminder-status"><strong>Email on</strong> · '+safe(scheduleText(schedule))+
      (state.nextAt?'<small>Next reminder: '+safe(nextText(state.nextAt))+'</small>':'')+'</p>'
    :'<p class="reminder-status"><strong>Off</strong> · Get an email reminder to play the Dailies.</p>';
  const actions=!canEnable?'':email.enabled
    ?'<button class="button secondary" type="button" id="daily-reminder-edit">Change</button><button class="button secondary" type="button" id="daily-reminder-optout">Turn off</button>'
    :'<button class="button secondary" type="button" id="daily-reminder-edit">Turn on</button>';
  mount.innerHTML=
    '<div class="reminder-summary">'+status+(actions?'<div class="reminder-actions">'+actions+'</div>':'')+'</div>'+
    (email.addressChanged?'<p class="reminder-note" role="alert">Your sign-in email changed. Save your reminder again to send it to the new address.</p>':'')+
    (email.suppressed?'<p class="reminder-note" role="alert">Email reminders are paused after a bounce or complaint. Contact support to turn them back on.</p>':'')+
    (!verified?'<p class="reminder-note">Verify your sign-in email to turn on email reminders. <button class="text-button" type="button" id="daily-reminder-verify">Send verification email</button></p>':'')+
    (email.enabled&&email.deliveryActive===false?'<p class="reminder-note">Email reminders aren’t being sent yet. Your choice is saved.</p>':'')+
    (push.enabled?'<p class="reminder-note">Push reminders are on in the Pack One app.</p>':'')+
    (canEnable?editorMarkup(schedule):'')+
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
    // Device timezone is only the initial suggestion for a never-configured schedule.
    if(!current.email?.consentedAt&&!current.push?.consentedAt&&!current.nextAt)
      current.schedule.timeZone=browserZone();
    renderSetting(mount,current);
    const form=mount.querySelector('#daily-reminder-form');
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
        if(updatedFeedback)updatedFeedback.textContent=value.enabled?'Reminder saved.':'Email reminders turned off.';
      }catch(error){
        if(generation!==ownerGeneration||!mount.isConnected)return;
        if(field)field.textContent=error?.message||'Reminder settings could not be saved.';
        for(const button of buttons())button.disabled=false;
      }
    };
    if(form) {
      const days=form.querySelector('.reminder-days');
      form.elements.frequency.addEventListener('change',()=>{days.hidden=form.elements.frequency.value==='daily';});
      mount.querySelector('#daily-reminder-edit')?.addEventListener('click',()=>{form.hidden=false;form.elements.frequency.focus();});
      mount.querySelector('#daily-reminder-cancel').addEventListener('click',()=>{form.reset();days.hidden=form.elements.frequency.value==='daily';form.hidden=true;mount.querySelector('#daily-reminder-edit')?.focus();});
      form.addEventListener('submit',event=>{
        event.preventDefault();
        const fd=new FormData(form);
        const frequency=String(fd.get('frequency'));
        const weekdays=frequency==='daily'?[0,1,2,3,4,5,6]:fd.getAll('weekdays').map(Number);
        const field=feedback();
        if(frequency==='weekly'&&weekdays.length!==1){if(field)field.textContent='Select exactly one day for a weekly reminder.';return;}
        if(weekdays.length===0){if(field)field.textContent='Select at least one day.';return;}
        void send({frequency,weekdays,localTime:String(fd.get('localTime')),timeZone:String(fd.get('timeZone')).trim(),channel:'email',enabled:true});
      });
    }
    // Opt-out sends the saved schedule, never unsaved editor values.
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
