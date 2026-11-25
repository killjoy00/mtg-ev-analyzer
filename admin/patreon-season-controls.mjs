// Owner-only season controls within the authenticated Patreon panel.
import {seasonGuideReviewMarkup} from './patreon-season-review.mjs';
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const path='/v1/admin/patreon-weekly';
export async function renderSeasonControls(root,{ownerRequest}={}){
 if(!root||!ownerRequest)return;
 const call=(action,data={})=>ownerRequest(path,{action:'season-admin-'+action,...data},'POST');
 const message=root.querySelector('[data-season-status]'),content=root.querySelector('[data-season-content]');
 let busy=false;
 async function refresh(){
  if(busy)return;
  try{
   const data=await call('status');
   if(data.status!=='available'){message.textContent='Season publisher is not deployed yet.';content.replaceChildren();return;}
   message.textContent='Season results: '+(data.resultsEnabledFrom?'enabled since '+data.resultsEnabledFrom:'paused')+'.';
   const s=data.current,p=data.plan,d=data.draft,latest=data.latest||[];
   content.innerHTML='<p class="subpage-help">Enable season results only after approving the template and checking the persisted close trigger. Midseason guides are saved as private drafts and require separate approval.</p>'+
    '<label><input type="checkbox" data-season-verified> I have reviewed the season-results template and verified the real close trigger.</label>'+
    '<div class="actions"><button type="button" data-season-enable '+(data.resultsEnabledFrom?'disabled':'')+'>Enable season results</button><button class="secondary" type="button" data-season-disable '+(!data.resultsEnabledFrom?'disabled':'')+'>Pause season results</button></div>'+
    (s?'<h3>Midseason guide · '+esc(s.set_name)+'</h3><p>Season started '+esc(s.start_date)+'.</p>':'<p>No active season is recorded.</p>')+
    (s&&!d?'<form data-season-plan><label>Next set code <input required pattern="[a-z0-9-]{1,120}" name="nextSet" value="'+esc(p?.nextSetId||'')+'"></label> <label>Planned next-season start (Pacific date) <input required type="date" name="nextStart" value="'+esc(p?.nextStart||'')+'"></label><label>Deck colors <select name="colors"><option value="2" '+(p?.colorCount!==3?'selected':'')+'>Two-color</option><option value="3" '+(p?.colorCount===3?'selected':'')+'>Three-color</option></select></label><p class="subpage-help">Confirm the reviewed release/activation calendar. The midpoint draft is generated automatically from completed Latest Set days and a fresh 17Lands snapshot. Do not guess a date.</p><button type="submit">Save reviewed midpoint plan</button></form>'+
     (p?'<p>'+ (p.sourceAttempted?'Automatic source retrieval attempted.':'Source retrieval is scheduled for the midpoint.')+'</p><details><summary>Register a refreshed source snapshot if needed</summary><p>Use only a reviewed Pack One set-guide JSON containing the matching 17Lands results. No player data.</p><form data-season-source><label>Reviewed guide JSON <textarea required rows="5" name="snapshot"></textarea></label><button type="submit">Save aggregate snapshot</button></form></details>':''):'')+
    (d?'<h3>Midseason draft · '+esc(d.state)+'</h3><div data-season-preview></div>'+(d.state==='draft'?'<div class="actions"><button type="button" data-season-approve>Approve this exact guide for public Patreon</button><button type="button" class="secondary" data-season-reject>Reject this guide</button></div>':''):'')+
    '<h3>Season publishing history</h3>'+(latest.length?'<ul>'+latest.map(r=>'<li>'+esc(r.kind)+' · '+esc(r.season_id)+' · '+esc(r.state)+(typeof r.public_url==='string'&&/^https:\/\/www\.patreon\.com\/posts\/\d+$/.test(r.public_url)?' · <a href="'+esc(r.public_url)+'" target="_blank" rel="noopener noreferrer">Public post</a>':'')+'</li>').join('')+'</ul>':'<p>No season posts recorded.</p>');
   const btn=(selector,fn)=>{const el=content.querySelector(selector);if(el)el.onclick=fn;};
   async function mutate(action,data){
    if(busy)return;busy=true;
    for(const b of content.querySelectorAll('button'))b.disabled=true;
    try{const result=await call(action,data);message.textContent=String(result.status).replaceAll('-',' ');}
    catch{message.textContent='Change rejected. Check the season date, reviewed evidence and current draft.';}
    finally{busy=false;await refresh();}
   }
   btn('[data-season-enable]',()=>{if(content.querySelector('[data-season-verified]').checked)void mutate('results',{enabled:true,templateAndTriggerVerified:true});else message.textContent='Confirm the template and real trigger before enabling.';});
   btn('[data-season-disable]',()=>void mutate('results',{enabled:false}));
   const form=content.querySelector('[data-season-plan]');
   if(form)form.onsubmit=e=>{e.preventDefault();const fd=new FormData(form);void mutate('plan',{seasonId:s.id,nextSetId:String(fd.get('nextSet')).trim(),nextStart:String(fd.get('nextStart')),colorCount:Number(fd.get('colors'))});};
   const source=content.querySelector('[data-season-source]');
   if(source)source.onsubmit=e=>{e.preventDefault();try{const snapshot=JSON.parse(String(new FormData(source).get('snapshot')));void mutate('snapshot',{seasonId:s.id,snapshot});}catch{message.textContent='Invalid JSON snapshot.';}};
   if(d){
    content.querySelector('[data-season-preview]').innerHTML=seasonGuideReviewMarkup(d);
    btn('[data-season-approve]',()=>{if(window.confirm('Approve the exact displayed guide for automatic public publication while this season is active?'))void mutate('approve',{seasonId:d.seasonId,hash:d.hash});});
    btn('[data-season-reject]',()=>{if(window.confirm('Reject this frozen guide? It will not be regenerated automatically.'))void mutate('reject',{seasonId:d.seasonId,hash:d.hash});});
   }
  }catch{message.textContent='Season controls unavailable. Existing weekly posts are unchanged.';}
 }
 root.querySelector('[data-season-refresh]').onclick=()=>void refresh();
 await refresh();
}
