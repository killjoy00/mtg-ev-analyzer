// Admin-only decision and public-profile report inbox.
// All user-supplied text is inserted with textContent, never innerHTML.
const DECISION_REASONS={all:'All reasons',draft_context:'Draft context',card_or_image:'Card or image',score_recommendation:'Score / recommendation',broken:'Something broken',other:'Other'};
const PROFILE_REASONS={all:'All reasons',offensive_name:'Offensive name',harassment:'Harassment',impersonation:'Impersonation',spam:'Spam',other:'Other'};
const DECISION_STATUSES={open:'Open',reviewed:'Reviewed',dismissed:'Dismissed',all:'All statuses'};
const PROFILE_STATUSES={open:'Open',resolved:'Resolved',dismissed:'Dismissed',all:'All statuses'};
const n=(tag,className,text)=>{
  const el=document.createElement(tag);
  if(className)el.className=className;
  if(text!==undefined&&text!==null)el.textContent=String(text);
  return el;
};
const value=value=>value==null||value===''?'N/A':String(value);
const time=value=>{
  if(!value)return 'Unknown date';
  const date=new Date(value);
  return Number.isFinite(date.getTime())?date.toLocaleString():String(value);
};
const format=value=>Number(value||0).toLocaleString();
const field=(label,content)=>{
  const wrap=n('div','player-report-field');
  wrap.append(n('dt',null,label),n('dd',null,value(content)));
  return wrap;
};
const choose=(name,items,current)=>{
  const label=n('label','player-report-filter',name);
  const select=n('select');
  select.name=name.toLowerCase();
  for(const [id,title] of Object.entries(items)) {
    const option=n('option',null,title);
    option.value=id;
    option.selected=id===current;
    select.append(option);
  }
  label.append(select);
  return label;
};
const button=(label,action,className='secondary')=>{
  const b=n('button',className,label);
  b.type='button';
  b.dataset.action=action;
  return b;
};

export async function renderPlayerReports(root,request) {
  const initial=new URLSearchParams(location.search).get('kind');
  const state={kind:initial==='profiles'?'profiles':'decisions',status:'open',reason:'all',page:1};
  let generation=0;

  async function refresh() {
    const current=++generation;
    root.replaceChildren(n('p','muted','Loading player reports…'));
    try {
      const params=new URLSearchParams(state);
      const data=await request('/v1/admin/player-reports?'+params.toString());
      if(current!==generation)return;
      render(data);
    } catch(error) {
      if(current!==generation)return;
      root.replaceChildren(n('h1',null,'Player reports'),n('p','error',error.message||'Reports could not be loaded.'));
      const retry=button('Try again','retry');
      retry.addEventListener('click',refresh);
      root.append(retry);
    }
  }

  async function takeAction(report,action,card,statusNode) {
    const prior=report.status;
    const note=card.querySelector('textarea')?.value.trim()||'';
    let path,body;
    if(state.kind==='decisions') {
      path='/v1/admin/player-reports/decisions/'+encodeURIComponent(report.id);
      body={expected_status:prior,status:action==='reopen'?'open':action,note:action==='reopen'?'':note};
    } else if(action==='hide') {
      if(!report.target_auth_user_id) {
        statusNode.textContent='No linked account was found. Review this profile manually.';
        return;
      }
      if(!note) {
        statusNode.textContent='Enter a reason before hiding this public identity.';
        return;
      }
      if(!window.confirm('Hide this public identity and remove it from leaderboards and shared identity?'))return;
      path='/v1/admin/users/'+encodeURIComponent(report.target_auth_user_id)+'/public-identity';
      body={action:'hide',reason:note};
    } else {
      path='/v1/admin/player-reports/profiles/'+encodeURIComponent(report.id);
      body={expected_status:prior,status:action==='reopen'?'open':'dismissed'};
    }
    const controls=[...card.querySelectorAll('button')];
    controls.forEach(control=>control.disabled=true);
    statusNode.textContent='Saving…';
    try {
      await request(path,body,'POST');
      await refresh();
    } catch(error) {
      statusNode.textContent=error.message||'Could not update this report.';
      controls.forEach(control=>control.disabled=false);
    }
  }

  function decisionCard(report) {
    const card=n('article','player-report-card'+(report.reason==='broken'&&report.status==='open'?' player-report-urgent':''));
    const top=n('div','player-report-card-header');
    const heading=n('div');
    const h=n('h3',null,value(report.set_id).toUpperCase()+' · P1P'+value(report.pick_number));
    heading.append(h,n('p','muted',time(report.created_at)+' · '+value(report.environment)));
    const badge=n('span','player-report-status',report.status==='open'&&report.reason==='broken'?'Broken · needs review':value(report.status));
    top.append(heading,badge);card.append(top);
    card.append(n('p','player-report-reason',DECISION_REASONS[report.reason]||value(report.reason)));
    if(report.comment)card.append(n('p','player-report-comment',report.comment));
    const details=n('dl','player-report-details');
    details.append(
      field('Player picked',report.selected_card_name),
      field('Model recommended',report.recommended_card_name),
      field('Model score',report.recommended_card_score),
      field('Same decision reports',format(report.reports_on_decision)+' ('+format(report.independent_reporters)+' players)'),
      field('Draft pick ID',report.puzzle_id),
      field('Round',report.round_number),
      field('Platform',report.client_platform),
      field('App version',report.client_version),
      field('App build',report.client_build),
      field('Corpus / model',value(report.corpus_version)+' / '+value(report.model_version)),
      field('Scoring version',report.scoring_version),
      field('Backend release',report.backend_release)
    );
    card.append(details);
    if(report.status!=='open'&&report.reviewed_at)
      card.append(n('p','muted','Last reviewed '+time(report.reviewed_at)));
    if(report.review_note)card.append(n('p','player-report-note','Review note: '+report.review_note));
    const actions=n('div','player-report-actions');
    if(report.status==='open') {
      const textarea=n('textarea','player-report-note-input');
      textarea.rows=2;textarea.maxLength=500;
      textarea.placeholder='Private review note (optional)';
      textarea.setAttribute('aria-label','Private review note for '+value(report.puzzle_id));
      card.append(textarea);
      actions.append(button('Mark reviewed','reviewed'),button('Dismiss','dismissed'));
    } else actions.append(button('Reopen report','reopen'));
    const result=n('p','player-report-action-status');
    result.setAttribute('role','status');
    for(const b of actions.querySelectorAll('button'))b.addEventListener('click',()=>takeAction(report,b.dataset.action,card,result));
    card.append(actions,result);
    return card;
  }

  function profileCard(report) {
    const card=n('article','player-report-card');
    const top=n('div','player-report-card-header');
    const heading=n('div');
    heading.append(n('h3',null,'Reported profile: '+value(report.target_name)),
      n('p','muted',time(report.created_at)));
    top.append(heading,n('span','player-report-status',value(report.status)));
    card.append(top,n('p','player-report-reason',PROFILE_REASONS[report.reason]||value(report.reason)));
    if(report.details)card.append(n('p','player-report-comment',report.details));
    if(report.public_identity_hidden_at)
      card.append(n('p','muted','This public identity is already hidden.'));
    const search=new URLSearchParams({area:'users',search:value(report.target_name)});
    const link=n('a','player-report-profile-link','Find account in Users');
    link.href='?'+search.toString();
    card.append(link);
    const actions=n('div','player-report-actions');
    if(report.status==='open') {
      const textarea=n('textarea','player-report-note-input');
      textarea.rows=2;textarea.maxLength=500;
      textarea.placeholder='Reason required to hide this identity';
      textarea.setAttribute('aria-label','Moderation reason for '+value(report.target_name));
      card.append(textarea);
      actions.append(button('Dismiss report','dismissed'));
      if(report.target_auth_user_id&&!report.public_identity_hidden_at)
        actions.append(button('Hide public identity','hide','player-report-danger'));
    } else if(report.status==='dismissed')actions.append(button('Reopen report','reopen'));
    const result=n('p','player-report-action-status');
    result.setAttribute('role','status');
    for(const b of actions.querySelectorAll('button'))b.addEventListener('click',()=>takeAction(report,b.dataset.action,card,result));
    card.append(actions,result);
    return card;
  }

  function render(data) {
    const page=n('section','player-reports');
    page.append(n('h1',null,'Player reports'),n('p','muted','Private admin inbox for player-submitted decision and profile reports. Reports remain saved when reviewed.'));
    const counts=n('div','player-report-counts');
    const reportSummary=data.summary||{};
    const d=reportSummary.decisions||{},p=reportSummary.profiles||{};
    for(const [name,count,kind] of [
      ['Open decision reports',d.open,'decisions'],
      ['Broken / urgent',d.broken_open,'urgent'],
      ['Open profile reports',p.open,'profiles']
    ]) {
      const tile=n('div','player-report-count'+(kind==='urgent'&&Number(count)>0?' player-report-alert':''));
      tile.append(n('span',null,name),n('strong',null,format(count)));
      counts.append(tile);
    }
    page.append(counts);
    const tabs=n('div','player-report-tabs');
    for(const [kind,title] of [['decisions','Draft decisions'],['profiles','Player profiles']]) {
      const tab=button(title,'tab',state.kind===kind?'player-report-tab active':'player-report-tab');
      tab.dataset.kind=kind;tab.setAttribute('aria-pressed',String(kind===state.kind));
      tab.addEventListener('click',()=>{if(state.kind===kind)return;state.kind=kind;state.status='open';state.reason='all';state.page=1;void refresh();});
      tabs.append(tab);
    }
    page.append(tabs);
    const filters=n('form','player-report-filters');
    const statuses=state.kind==='decisions'?DECISION_STATUSES:PROFILE_STATUSES;
    const reasons=state.kind==='decisions'?DECISION_REASONS:PROFILE_REASONS;
    filters.append(choose('Status',statuses,state.status),choose('Reason',reasons,state.reason));
    const apply=n('button',null,'Apply filters');apply.type='submit';filters.append(apply);
    filters.addEventListener('submit',event=>{
      event.preventDefault();
      const form=new FormData(filters);
      state.status=String(form.get('status')||'open');
      state.reason=String(form.get('reason')||'all');
      state.page=1;void refresh();
    });
    page.append(filters);
    const total=Number(data.total)||0;
    const start=total===0?0:(state.page-1)*data.page_size+1;
    const end=Math.min(total,state.page*data.page_size);
    page.append(n('p','muted','Showing '+format(start)+'–'+format(end)+' of '+format(total)+' matching reports.'));
    const list=n('div','player-report-list');
    if(!(data.rows||[]).length)list.append(n('p','muted','No reports match these filters.'));
    for(const report of data.rows||[])list.append(state.kind==='decisions'?decisionCard(report):profileCard(report));
    page.append(list);
    const pages=n('div','player-report-pages');
    const previous=button('Previous page','prev');
    const next=button('Next page','next');
    previous.disabled=state.page<=1;next.disabled=end>=total;
    previous.addEventListener('click',()=>{state.page--;void refresh();});
    next.addEventListener('click',()=>{state.page++;void refresh();});
    pages.append(previous,n('span',null,'Page '+format(state.page)),next);
    page.append(pages);
    root.replaceChildren(page);
  }

  await refresh();
}
