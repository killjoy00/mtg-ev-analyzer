import {getAuthSession,loadResultsPreferences,saveResultsPreferences,ACCOUNT_SIGNAL_KEY} from './growth-api.mjs';
import copy from './results-copy.json' with {type:'json'};
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
let epoch=0,invitation=null,pending=null;
function clear(){epoch++;invitation=null;pending=null;document.querySelectorAll('[data-results-ui]').forEach(el=>el.replaceChildren());}
globalThis.addEventListener?.('packone-account-changed',clear);
globalThis.addEventListener?.('storage',e=>{if(e.key===ACCOUNT_SIGNAL_KEY||e.key===null)clear();});
export const resultsSettingsMarkup=()=>'<section data-results-ui id="results-settings" hidden></section>';
async function owner(){return (await getAuthSession())?.user?.id;}
async function save(id,action,version){
 if(version!==epoch||await owner()!==id)throw Error('Account changed. Reload Account settings.');
 const result=await saveResultsPreferences({expectedAccountId:id,action});
 if(version!==epoch||await owner()!==id)throw Error('Account changed. Reload Account settings.');
 return result;
}
function bindActions(mount,id,version,onSaved){
 mount.querySelectorAll('[data-results-action]').forEach(button=>button.addEventListener('click',async()=>{
  mount.querySelectorAll('button,input').forEach(el=>el.disabled=true);
  try{const value=await save(id,button.dataset.resultsAction,version);if(mount.isConnected)onSaved(value,button.dataset.resultsAction);}
  catch(error){if(version===epoch&&mount.isConnected){mount.querySelector('[role="status"]').textContent=error.message;mount.querySelectorAll('button,input').forEach(el=>el.disabled=false);}}
 }));
}
export async function bindResultsSettings(){
 const mount=document.querySelector('#results-settings'),version=epoch;if(!mount)return;
 try{
  const id=await owner();if(!id)return;
  const state=await loadResultsPreferences();if(version!==epoch||!mount.isConnected||await owner()!==id||!state.active)return;
  let kind=invitation?.id===id?invitation.kind:(await save(id,'present',version)).presentation;
  if(version!==epoch||!mount.isConnected)return;
  mount.hidden=false;
  const render=value=>{
   mount.innerHTML=(kind?'<aside>'+invitationMarkup(kind)+'</aside>':'')+'<h3>'+copy.emailTitle+'</h3><h4>'+copy.emailLabel+'</h4><p>'+copy.emailBody+'</p><div role="group" aria-label="Results and news">'+
    ['on','off'].map(v=>'<button type="button" class="button secondary" data-results-action="settings:'+v+'" aria-pressed="'+(v==='on'?value.emailState==='on':value.emailState!=='on')+'">'+(v==='on'?'On':'Off')+'</button>').join(' ')+'</div><p>'+copy.emailFoot+'</p><h3>'+copy.publishedTitle+'</h3><label><input type="checkbox" id="results-exclude" '+(value.excludePublications?'checked':'')+'> '+copy.exclude+'</label><p>'+copy.publishedFoot+'</p><p role="status" aria-live="polite"></p>';
   bindActions(mount,id,version,(updated,action)=>{if(/^(prompt|notice|settings):/.test(action)){kind=null;invitation={id,kind:null};}render(updated);});
   mount.querySelector('#results-exclude').addEventListener('change',async e=>{
    const box=e.currentTarget,previous=!box.checked;box.disabled=true;
    try{render(await save(id,'exclude:'+(box.checked?'on':'off'),version));}
    catch(error){if(version===epoch&&mount.isConnected){box.checked=previous;box.disabled=false;mount.querySelector('[role="status"]').textContent=error.message;}}
   });
  };render(state);
 }catch{if(version===epoch&&mount.isConnected){mount.hidden=false;mount.innerHTML='<p role="status">Could not load results preferences.</p><button type="button" class="button secondary">Retry</button>';mount.querySelector('button').onclick=()=>void bindResultsSettings();}}
}
function invitationMarkup(kind){
 const prompt=kind==='prompt';
 return '<h2>'+esc(prompt?copy.promptTitle:copy.noticeTitle)+'</h2>'+
  (prompt?'<p>'+esc(copy.promptBody)+'</p>':copy.noticeBody.map(p=>'<p>'+esc(p)+'</p>').join(''))+
  '<div><button type="button" class="button secondary" data-results-action="'+(prompt?'prompt:on':'notice:on')+'">'+esc(prompt?copy.yes:copy.noticeButton)+'</button> '+
  '<button type="button" class="button secondary" data-results-action="'+(prompt?'prompt:off':'notice:dismiss')+'">'+esc(prompt?copy.no:'Dismiss')+'</button></div><p>'+esc(prompt?copy.promptFoot:copy.noticeFoot)+'</p>'+
  (!prompt?'<p><a href="/privacy/">Privacy Policy</a> · <a href="/terms/">Terms</a></p>':'')+'<p role="status" aria-live="polite"></p>';
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
