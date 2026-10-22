// Private pick moderation. Use textContent for all source, player and audit text.
const n=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=String(text);return e;};
const button=text=>{const e=n('button','secondary',text);e.type='button';return e;};
const date=value=>new Date(value).toLocaleString();
export function addPickReview(card,report,request) {
 let generation=0;
 const open=button('Review pick / removal');open.classList.add('player-report-pick-open');
 const panel=n('section','player-report-pick-review');panel.hidden=true;panel.setAttribute('aria-label','Pick review and removal');
 open.setAttribute('aria-expanded','false');
 async function load() {
  const current=++generation;
  panel.hidden=false;open.setAttribute('aria-expanded','true');open.disabled=true;
  panel.replaceChildren(n('p',null,'Loading original pick and removal history…'));
  try {const data=await request('/v1/admin/player-reports/decisions/'+encodeURIComponent(report.id)+'/pick');if(current===generation)render(data);}
  catch(error){panel.replaceChildren(n('p','error',error.message||'Could not load the pick.'));const retry=button('Refresh pick');retry.onclick=load;panel.append(retry);}
  finally {open.disabled=false;}
 }
 open.onclick=()=>{if(!panel.hidden){panel.hidden=true;open.setAttribute('aria-expanded','false');}else void load();};
 function render(data) {
  panel.replaceChildren();
  if(!data.available){panel.append(n('p','error',data.message));return;}
  const {puzzle,moderation}=data;
  panel.append(n('h4',null,moderation.removed?'Removed from future games':'Available under normal eligibility rules'));
  panel.append(n('p','muted','This action applies to this decision and identical copies across imports. Past results, existing runs, fixed Dailies and shared replays stay available. Restoring does not bypass other eligibility rules. Report review status is managed separately.'));
  if(moderation.reason)panel.append(n('p','player-report-note','Last action: '+moderation.reason+' · '+date(moderation.updated_at)+' · '+moderation.copies+' stored copies'));
  const heading=n('h4',null,'Pack · scores and model support');panel.append(heading);
  const grid=n('div','player-report-pick-grid');
  for(const c of data.ranking) {
   const item=n('div','player-report-pick-card');
   if(/^https:\/\/cards\.scryfall\.io\//.test(c.image_url||'')) {const img=n('img');img.src=c.image_url;img.alt=c.name;img.loading='lazy';item.append(img);}
   item.append(n('strong',null,c.name),n('span',null,c.score+' / 100 · model '+(Number(c.model_probability)*100).toFixed(1)+'%'));
   if(c.id===puzzle.historical_pick_id)item.append(n('span','player-report-pick-label','Trophy pick'));
   if(c.id===data.selected_card_id)item.append(n('span','player-report-pick-label','Player pick'));
   grid.append(item);
  }
  panel.append(grid,n('h4',null,'Prior pool ('+puzzle.prior_picks.length+')'));
  const pool=n('ul','player-report-pool');
  for(const c of puzzle.prior_picks)pool.append(n('li',null,c.name));
  if(!puzzle.prior_picks.length)pool.append(n('li',null,'No prior picks.'));
  panel.append(pool);
  const form=n('form','player-report-removal-form');
  const label=n('label',null,'Reason required for '+(moderation.removed?'restoration':'removal'));
  const reason=n('textarea','player-report-note-input');reason.required=true;reason.maxLength=500;reason.rows=2;label.append(reason);
  const save=button(moderation.removed?'Restore pick':'Remove from future games');save.type='submit';save.className=moderation.removed?'secondary':'player-report-danger';
  const refresh=button('Refresh pick');refresh.onclick=load;
  const status=n('p','player-report-action-status');status.setAttribute('role','status');
  form.append(label,save,refresh,status);panel.append(form);
  const readiness=data.readiness;
  if(moderation.revision>0&&readiness?.ready!==true) {
   panel.append(n('p','error','Removal state is saved. Serving inventory is '+(readiness?.state||'unavailable')+'; warmup and verification are not yet complete.'));
   const link=n('a',null,'Inspect or retry serving readiness');link.href='?area=corpus';panel.append(link);
  }
  form.onsubmit=async event=>{
   event.preventDefault();const text=reason.value.trim();if(!text){status.textContent='Enter a reason.';reason.focus();return;}
   if(!window.confirm(moderation.removed?'Restore this decision for future games, subject to normal eligibility rules?':'Remove this decision and identical copies from future games? Past games and shared replays will remain available.'))return;
   save.disabled=true;refresh.disabled=true;status.textContent='Saving removal state…';
   try {
    const result=await request('/v1/admin/player-reports/decisions/'+encodeURIComponent(report.id)+'/pick',
     {action:moderation.removed?'restore':'remove',expected_revision:moderation.revision,reason:text},'POST');
    await load();
    if(result.moderation_committed&&!result.readiness?.ready) {
     const current=generation;
     const warmStatus=n('p','muted','Change saved. Warming and verifying serving inventory…');warmStatus.setAttribute('role','status');panel.prepend(warmStatus);
     // A separate bounded request can time out without obscuring the committed
     // moderation. The durable readiness job also has scheduled recovery.
     try {
      const warm=await request('/v1/admin/player-reports/serving/warmup',{},'POST');
      if(current===generation)warmStatus.textContent=warm.readiness?.ready?'Change saved. Serving inventory is verified and ready.':'Change saved. Inventory verification is pending; refresh or inspect serving readiness.';
     } catch {if(current===generation)warmStatus.textContent='Change saved. Inventory verification is pending; refresh or inspect serving readiness.';}
    }
   } catch(error) {
    status.textContent=(error.message||'The response was interrupted.')+' Refresh the pick to confirm its state before repeating an action.';
    save.disabled=false;refresh.disabled=false;
   }
  };
  const history=n('details','player-report-removal-history');history.append(n('summary',null,'Removal / restoration history ('+moderation.history.length+')'));
  const list=n('ol');
  for(const e of moderation.history)list.append(n('li',null,(e.removed?'Removed':'Restored')+' · '+date(e.created_at)+' · '+e.reason+' · Admin '+e.actor_id+' · Report '+e.report_id));
  if(!moderation.history.length)list.append(n('li',null,'No removal actions.'));
  history.append(list);panel.append(history);
 }
 card.append(open,panel);
}
