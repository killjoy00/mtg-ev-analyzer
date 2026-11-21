import {getAuthSession,loadResultsPreferences,saveResultsPreferences,ACCOUNT_SIGNAL_KEY} from './growth-api.mjs';
import copy from './results-copy.json' with {type:'json'};
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
let epoch=0,invitation=null,pending=null;
function clear(){epoch++;invitation=null;pending=null;document.querySelectorAll('[data-results-ui]').forEach(el=>el.replaceChildren());}
globalThis.addEventListener?.('packone-account-changed',clear);
globalThis.addEventListener?.('storage',e=>{if(e.key===ACCOUNT_SIGNAL_KEY||e.key===null)clear();});
export const emailPreferencesMarkup=content=>'<section class="profile-email-preferences" aria-labelledby="email-preferences-heading"><h2 id="email-preferences-heading">'+esc(copy.emailTitle)+'</h2>'+content+'</section>';
export const resultsSettingsMarkup=()=>'<section class="settings-row profile-settings-group" data-results-ui id="results-settings" aria-labelledby="results-email-heading" hidden></section>';
export const resultsPublicationsMarkup=()=>'<section class="settings-row profile-settings-group" data-results-ui id="results-publications-settings" aria-labelledby="results-publications-heading" hidden></section>';
async function owner(){return (await getAuthSession())?.user?.id;}
async function save(id,action,version){
 if(version!==epoch||await owner()!==id)throw Error('Account changed. Reload Account settings.');
 const result=await saveResultsPreferences({expectedAccountId:id,action});
 if(version!==epoch||await owner()!==id)throw Error('Account changed. Reload Account settings.');
 return result;
}
function disableControls(roots,disabled){for(const root of roots)root?.querySelectorAll('button,input').forEach(el=>el.disabled=disabled);}
function bindActions(mount,id,version,onSaved,related=[]){
 const choiceForm=mount.querySelector('[data-results-choice-form]');
 choiceForm?.addEventListener('submit',async event=>{
  event.preventDefault();
  const data=new FormData(choiceForm),news=data.get('newsEmail');
  if(!['on','off'].includes(news)){choiceForm.querySelector('[role="status"]').textContent='Choose Yes or No.';return;}
  disableControls([mount,...related],true);
  try {
   const action='signup:'+news+':'+(data.has('weeklyEmail')?'on':'off');
   const value=await save(id,action,version);
   if(mount.isConnected)onSaved(value,action);
  }catch(error){
   if(version===epoch&&mount.isConnected){choiceForm.querySelector('[role="status"]').textContent=error.message;disableControls([mount,...related],false);}
  }
 });
 mount.querySelectorAll('[data-results-action]').forEach(button=>button.addEventListener('click',async()=>{
  disableControls([mount,...related],true);
  const feedback=mount.querySelector('[role="status"]');if(feedback)feedback.textContent='Saving…';
  try{const value=await save(id,button.dataset.resultsAction,version);if(mount.isConnected)onSaved(value,button.dataset.resultsAction);}
  catch(error){if(version===epoch&&mount.isConnected){mount.querySelector('[role="status"]').textContent=error.message;disableControls([mount,...related],false);}}
 }));
}
export async function bindResultsSettings(){
 const mount=document.querySelector('#results-settings'),publications=document.querySelector('#results-publications-settings'),version=epoch;if(!mount)return;
 let launched=false;
 try{
  const id=await owner();if(!id)return;
  const state=await loadResultsPreferences();if(version!==epoch||!mount.isConnected||await owner()!==id||!state.active)return;
  launched=true;
  let kind=invitation?.id===id?invitation.kind:(await save(id,'present',version)).presentation;
  if(version!==epoch||!mount.isConnected)return;
  mount.hidden=false;
  const render=value=>{
   const enabled=value.emailState==='on',newsEnabled=value.newsEmailState==='on';
   mount.innerHTML='<div class="settings-row-label"><h3 id="results-email-heading">Email preferences</h3><p class="profile-settings-intro">'+esc(copy.emailOptional)+'</p></div><div class="settings-row-body">'+
    (kind?'<aside class="results-invitation">'+invitationMarkup(kind)+'</aside>':'')+
    '<div class="reminder-summary"><strong>'+esc(copy.newSetLabel)+'</strong><p>'+esc(copy.newSetBody)+'</p><p class="reminder-status"><span class="reminder-state'+(newsEnabled?' is-on':'')+'">'+(newsEnabled?'On':'Off')+'</span></p><div class="reminder-actions"><button type="button" class="button secondary" data-results-action="news:'+(newsEnabled?'off':'on')+'">'+(newsEnabled?'Turn off':'Turn on')+'</button></div></div>'+
    '<div class="reminder-summary"><strong>'+esc(copy.weeklyLabel)+'</strong><p>'+esc(copy.weeklyBody)+'</p><p class="reminder-status"><span class="reminder-state'+(enabled?' is-on':'')+'">'+(enabled?'On':'Off')+'</span></p><div class="reminder-actions"><button type="button" class="button secondary" data-results-action="settings:'+(enabled?'off':'on')+'">'+(enabled?'Turn off':'Turn on')+'</button></div></div>'+
    '<p class="reminder-note">'+esc(copy.emailFoot)+'</p><p class="profile-settings-status" role="status" aria-live="polite"></p></div>';
   bindActions(mount,id,version,(updated,action)=>{if(/^(signup|prompt|notice|settings|news):/.test(action)){kind=null;invitation={id,kind:null};}render(updated);if(action.startsWith('settings:')||action.startsWith('news:'))mount.querySelector('.profile-settings-status').textContent='Email choices updated.';},[publications]);
   if(!publications?.isConnected)return;
   publications.hidden=false;
   publications.innerHTML='<div class="settings-row-label"><h3 id="results-publications-heading">'+esc(copy.publishedTitle)+'</h3></div><div class="settings-row-body"><label class="profile-toggle"><input type="checkbox" id="results-exclude" '+(value.excludePublications?'checked':'')+'><span>'+esc(copy.exclude)+'</span></label><p class="reminder-note">'+esc(copy.publishedFoot)+'</p><p class="profile-settings-status" role="status" aria-live="polite"></p></div>';
   publications.querySelector('#results-exclude').addEventListener('change',async e=>{
    const box=e.currentTarget,previous=!box.checked;disableControls([mount,publications],true);
    try{render(await save(id,'exclude:'+(box.checked?'on':'off'),version));}
    catch(error){if(version===epoch&&publications.isConnected){box.checked=previous;disableControls([mount,publications],false);publications.querySelector('[role="status"]').textContent=error.message;}}
   });
  };render(state);
 }catch{if(launched&&version===epoch&&mount.isConnected){mount.hidden=false;mount.innerHTML='<div class="settings-row-label"><h3 id="results-email-heading">'+esc(copy.emailLabel)+'</h3></div><div class="settings-row-body"><p role="status">Could not load results preferences.</p><button type="button" class="button secondary">Retry</button></div>';mount.querySelector('button').onclick=()=>void bindResultsSettings();}}
}
function invitationMarkup(kind){
 if(kind==='prompt')return '<form data-results-choice-form class="results-choice-form"><h2>'+esc(copy.newSetTitle)+'</h2><p>'+esc(copy.newSetBody)+'</p>'+
  '<label><input type="radio" name="newsEmail" value="on" required> '+esc(copy.newSetYes)+'</label>'+
  '<label><input type="radio" name="newsEmail" value="off"> '+esc(copy.newSetNo)+'</label>'+
  '<label><input type="checkbox" name="weeklyEmail" value="on"> '+esc(copy.weeklyOptIn)+'</label>'+
  '<div><button class="button primary" type="submit">Save choices</button></div><p>'+esc(copy.emailOptional)+'</p><p role="status" aria-live="polite"></p></form>';
 return '<h2>'+esc(copy.noticeTitle)+'</h2>'+copy.noticeBody.map(p=>'<p>'+esc(p)+'</p>').join('')+
  '<div><button type="button" class="button secondary" data-results-action="notice:on">'+esc(copy.noticeButton)+'</button> '+
  '<button type="button" class="button secondary" data-results-action="notice:dismiss">Dismiss</button></div><p>'+esc(copy.noticeFoot)+'</p>'+
  '<p><a href="/privacy/">Privacy Policy</a> · <a href="/terms/">Terms</a></p><p role="status"></p>';
}
// Only called by the home renderer. No dialog, focus capture, or gameplay hook.
export async function bindResultsInvitation(){
 const mount=document.querySelector('[data-results-invitation]'),version=epoch;if(!mount)return;
 try{
  const id=await owner();if(!id||version!==epoch||!mount.isConnected)return;
  if(!invitation||invitation.id!==id){
   if(!pending)pending=(async()=>{
    const state=await loadResultsPreferences();
    if(!state.active||version!==epoch||await owner()!==id||!document.querySelector('[data-results-invitation]'))return null;
    const result=await save(id,'present',version);return {id,kind:result.presentation};
   })();
   const result=await pending;if(version!==epoch)return;invitation=result;pending=null;
  }
  const current=document.querySelector('[data-results-invitation]');
  if(!current||version!==epoch||await owner()!==id||!invitation?.kind)return;
  current.hidden=false;current.innerHTML=invitationMarkup(invitation.kind);
  bindActions(current,id,version,()=>{invitation={id,kind:null};current.replaceChildren();current.hidden=true;});
 }catch{pending=null;/* An unavailable preference service never blocks play. */}
}
