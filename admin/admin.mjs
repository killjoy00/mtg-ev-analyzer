import {renderCorpus} from './corpus.mjs';
import {renderUsers} from './users.mjs';
import {renderAdminTeam} from './team.mjs';
import {renderCampaignLinks} from './campaign-links.mjs?v=20261009-delete';
import {ADMIN_API_VERSION} from '../admin-api-contract.mjs';
import {accountCsrfToken,firstPartyAuthEnabled,getAuthSession,storedAccountToken,signOutAccount} from '../growth-api.mjs';
import {sanitizeAdminDestination} from './admin-return.mjs';
const root=document.querySelector('#admin');
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const fmt=x=>x==null?'N/A':Number(x).toLocaleString(undefined,{maximumFractionDigits:1});
const pct=x=>x==null?'N/A':`${fmt(x)}%`;
const draftBase=window.PACK1_API.draftRunUrl;
const growthBase=window.PACK1_API.growthUrl;
let report,params=new URLSearchParams(),deferredLoad=0,adminContractVerified=false,switching=false;
const INVITE_STORAGE='pack1-pending-admin-invite-v2';
const INVITE_TTL_MS=15*60*1000;
function pendingInvitation(){
  try{const saved=JSON.parse(sessionStorage.getItem(INVITE_STORAGE)||'null');
    if(saved&&Date.now()>=saved.at&&Date.now()-saved.at<INVITE_TTL_MS&&/^[A-Za-z0-9_-]{43}$/.test(saved.token))return saved.token;
  }catch{}
  sessionStorage.removeItem(INVITE_STORAGE);return null;
}
const invitationHash=new URLSearchParams(location.hash.slice(1));
if(invitationHash.has('invite')){
  const token=invitationHash.get('invite');
  if(/^[A-Za-z0-9_-]{43}$/.test(token))sessionStorage.setItem(INVITE_STORAGE,JSON.stringify({token,at:Date.now()}));
  history.replaceState({},'',location.pathname+location.search);
}
const areaNavigation=document.querySelector('#admin-area-nav');
function setAuthorized(authorized,role='admin'){
  areaNavigation.hidden=!authorized;
  document.querySelector('#admin-team-link').hidden=!authorized||role!=='owner';
}
async function requestAt(base,path,body,method=body?'POST':'GET') {
  const headers={'content-type':'application/json'};
  if(firstPartyAuthEnabled()){const csrf=accountCsrfToken();if(!['GET','HEAD'].includes(method)&&csrf)headers['x-pack1-csrf']=csrf;}
  else headers['x-pack1-auth-session']=storedAccountToken()||'';
  try {
    const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:firstPartyAuthEnabled()?'include':'omit',cache:'no-store',signal:AbortSignal.timeout(45000)});
    const d=await r.json();if(!r.ok)throw Object.assign(Error(d.error||'Report unavailable.'),{status:r.status,code:d.code||null,data:d});return d;
  } catch(error){if(error?.name==='TimeoutError'||error?.name==='AbortError')throw Object.assign(Error('This admin request exceeded the 45-second load limit.'),{status:0,code:'admin_timeout'});throw error;}
}
const request=(path,body,method)=>requestAt(draftBase,path,body,method);
const growthRequest=(path,body,method)=>requestAt(growthBase,path,body,method);
async function verifyAdminContract() {
  if(adminContractVerified)return;
  let response,data;
  try {
    response=await fetch(draftBase+'/health?quick=1',{credentials:firstPartyAuthEnabled()?'include':'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});
    data=await response.json();
  } catch(error) {
    if(error?.name==='TimeoutError'||error?.name==='AbortError')throw Object.assign(Error('The admin API compatibility check timed out. Refresh and try again.'),{status:0,code:'admin_contract_timeout'});
    throw error;
  }
  const backendVersion=Number(data?.admin_api_version),gatewayVersion=Number(response.headers.get('x-pack1-admin-api-version'));
  const gatewayMatches=!firstPartyAuthEnabled()||gatewayVersion===ADMIN_API_VERSION;
  if(!response.ok||backendVersion!==ADMIN_API_VERSION||!gatewayMatches)throw Object.assign(
    Error('Pack One administration is updating. The admin page, gateway, and backend are on different releases; refresh after deployment completes.'),
    {status:503,code:'admin_release_mismatch',data:{required:ADMIN_API_VERSION,backend:backendVersion||null,gateway:gatewayVersion||null}}
  );
  adminContractVerified=true;
}
const reportQuery=f=>new URLSearchParams({from:f.start,to:f.end,environment:f.environment,type:f.type,set:f.set,version:f.version,difficulty:f.band,pick:f.pick}).toString();
function signInHref(){
  const destination=sanitizeAdminDestination(location.pathname+location.search,location.origin)||'/admin/';
  return '/?account=signin&admin_return='+encodeURIComponent(destination);
}
function login(message='') {
  setAuthorized(false);
  root.innerHTML=`<section class="login"><h1>Pack One administration</h1><p>Sign in using your existing Pack One account. Administrator access is checked after sign-in.</p><p><a class="admin-primary-link" href="${esc(signInHref())}">Sign in with Pack One</a></p>${message?`<p class="error" role="alert">${esc(message)}</p>`:''}<a href="/">Back to Pack One</a></section>`;
}
function denied(account,message='This account does not have administrator access.'){

  setAuthorized(false);
  root.innerHTML=`<section class="login"><h1>Administrator access required</h1><p>${esc(message)}</p><p class="muted">Signed in as ${esc(account?.email||'your current account')}.</p><button id="admin-switch" type="button">Switch account</button> <a href="/">Back to Pack One</a></section>`;
  document.querySelector('#admin-switch').onclick=()=>void switchAccount();
}
function unavailable(error){
  setAuthorized(false);
  const message=error?.message||'Administration is temporarily unavailable.';
  root.innerHTML=`<section class="login"><h1>Administration unavailable</h1><p class="error" role="alert">${esc(message)}</p><button type="button" id="retry">Retry</button> <a href="/">Back to Pack One</a></section>`;
  document.querySelector('#retry').onclick=()=>void load();
}
async function switchAccount(){
  if(switching)return;
  switching=true;++deferredLoad;adminContractVerified=false;setAuthorized(false);
  root.innerHTML='<section class="login"><h1>Signing out…</h1></section>';
  try {await signOutAccount();}finally{switching=false;login();}
}
function showInvitationPrompt(user,token,loadId){
  // Merely opening the URL, signing in or reloading never redeems a token.
  // This gate is intentionally before /v1/admin/access, so non-Admins can consent.
  setAuthorized(false);
  root.innerHTML=`<section class="login">
    <h1>Administrator invitation</h1>
    <p>Accepting gives this Pack One account administrator access. Only accept an invitation intended for you.</p>
    <p>Signed in as <strong id="admin-invite-account">${esc(user?.email||'Unknown account')}</strong>.</p>
    <p class="muted">The invited email must match your verified account email.</p>
    <div class="actions">
      <button type="button" id="accept-admin-invite">Accept admin invitation</button>
      <button type="button" class="secondary" id="cancel-admin-invite">Cancel</button>
      <button type="button" class="secondary" id="switch-admin-invite">Switch account</button>
    </div>
    <p id="admin-invite-status" role="status" aria-live="polite"></p>
  </section>`;
  const accept=root.querySelector('#accept-admin-invite');
  const cancel=root.querySelector('#cancel-admin-invite');
  const switchButton=root.querySelector('#switch-admin-invite');
  const status=root.querySelector('#admin-invite-status');
  const buttons=[accept,cancel,switchButton];
  accept.onclick=async()=>{
    if(loadId!==deferredLoad||accept.disabled)return;
    buttons.forEach(button=>button.disabled=true);
    status.textContent='Accepting invitation…';
    try{
      await request('/v1/admin/invitations/accept',{token});
      if(loadId!==deferredLoad)return;
      sessionStorage.removeItem(INVITE_STORAGE);
      await load();
    }catch(error){
      if(loadId!==deferredLoad)return;
      // Keep a mismatched-email or transiently failed invitation usable
      // after an account switch; an invalid/used token can no longer work.
      if(error?.code==='ADMIN_INVITATION_INVALID'||error?.code==='ALREADY_ADMIN')
        sessionStorage.removeItem(INVITE_STORAGE);
      status.textContent=error?.message||'Invitation could not be accepted.';
      buttons.forEach(button=>button.disabled=false);
    }
  };
  cancel.onclick=()=>{
    if(loadId!==deferredLoad)return;
    sessionStorage.removeItem(INVITE_STORAGE);
    location.assign('/');
  };
  switchButton.onclick=()=>{if(loadId===deferredLoad)void switchAccount();};
}
function options(values,current){return values.map(([v,label])=>`<option value="${esc(v)}" ${v===current?'selected':''}>${esc(label)}</option>`).join('');}
function table(rows,label) {
  return `<div class="scroll"><table><thead><tr><th>${label}</th><th>Answers</th><th>Trophy match</th><th>Avg. partial</th><th>Median time</th><th>Rerolls / views</th><th>Likely left / mature views</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.label)}${Number(r.answers)<30?' · early':''}</td><td>${fmt(r.answers)}</td><td>${pct(r.trophy_match_pct)}<div class="bar"><i style="width:${Math.max(0,Math.min(100,Number(r.trophy_match_pct)||0))}%"></i></div></td><td>${fmt(r.average_partial_credit)}</td><td>${r.median_seconds==null?'N/A':fmt(r.median_seconds)+'s'} <small>n=${fmt(r.timed_answers)}</small></td><td>${fmt(r.rerolls)} / ${fmt(r.exposures)}</td><td>${fmt(r.likely_abandoned)} / ${fmt(r.mature_exposures)}</td></tr>`).join('')||'<tr><td colspan="7">No player observations in this range yet.</td></tr>'}</tbody></table></div>`;
}
function habitTable(rows) {
  const rate=(value,n,d,immature)=>`${pct(value)}<br><small>${fmt(n)} / ${fmt(d)} mature · ${fmt(immature)} immature</small>`;
  return `<div class="scroll"><table><thead><tr><th>First touch</th><th>Campaign</th><th>First-Daily people</th><th>Next-day return</th><th>7-day return</th><th>3-in-7</th><th>Ever 3-in-7</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.source)}</td><td>${esc(r.campaign)}</td><td>${fmt(r.cohort_people)}</td><td>${rate(r.next_day_rate,r.next_day_returned,r.next_day_mature,r.next_day_immature)}</td><td>${rate(r.seven_day_rate,r.seven_day_returned,r.seven_day_mature,r.seven_day_immature)}</td><td>${rate(r.three_in_seven_rate,r.three_in_seven_reached,r.three_in_seven_mature,r.three_in_seven_immature)}</td><td>${pct(r.ever_three_in_seven_rate)}<br><small>${fmt(r.ever_three_in_seven_people)} / ${fmt(r.cohort_people)} observed</small></td></tr>`).join('')||'<tr><td colspan="7">No first-Daily cohorts in this range yet.</td></tr>'}</tbody></table></div>`;
}
function healthTable(rows) {
  return `<div class="scroll"><table><thead><tr><th>Date</th><th>People at 3+ Daily days in trailing 7</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.day)}</td><td>${fmt(r.people)}</td></tr>`).join('')||'<tr><td colspan="2">No Daily health dates in this range.</td></tr>'}</tbody></table></div>`;
}
function reviewMarkup(rows){return rows.map(r=>`<details class="review" data-puzzle="${esc(r.puzzle_id)}"><summary>${esc(r.set_id.toUpperCase())} · P1P${r.pick_number} · ${fmt(r.answers)} answers · ${pct(r.trophy_match_pct)} trophy matches${r.model_disagreement===true||r.model_disagreement==='t'?' · model disagreement':''}</summary><div class="detail"></div></details>`).join('')||'<p>No decisions have five qualifying answers yet.</p>';}
function bindReviewDetails(container,queryString){
  container.querySelectorAll('[data-puzzle]').forEach(el=>el.ontoggle=async()=>{if(!el.open||el.dataset.loaded)return;const target=el.querySelector('.detail');target.textContent='Loading decision…';try{const suffix=queryString?'?'+queryString:'';const data=await request(`/v1/admin/decisions/${el.dataset.puzzle}${suffix}`),p=data.puzzle;target.innerHTML=`<p>Earlier picks: ${esc(p.prior_picks.map(c=>c.name).join(', ')||'None')}</p><div class="decision-cards">${p.candidates.map(card=>{const count=data.choices.find(c=>c.selected_id===card.id);return `<article>${/^https:\/\//.test(card.image_url||'')?`<img src="${esc(card.image_url)}" alt="${esc(card.name)}" loading="lazy">`:''}<p><strong>${esc(card.name)}</strong>${card.id===p.historical_pick_id?' · Trophy pick':''}<br>${fmt(count?.answers||0)} choices · Model support ${pct(100*card.model_probability)}<br>Average awarded: ${fmt(count?.average_score)}</p></article>`;}).join('')}</div>`;el.dataset.loaded='1';}catch(err){target.textContent=err.message;}});
}
async function loadDeferredSections(loadId,queryString){
  const suffix=queryString?'?'+queryString:'';
  const habits=request('/v1/admin/measurements/habits'+suffix).then(data=>{
    if(loadId!==deferredLoad)return;
    const hm=data.habit_metrics||{cohorts:[],daily_health:[]},cohortTarget=document.querySelector('#habit-cohorts'),healthTarget=document.querySelector('#habit-health');
    if(cohortTarget)cohortTarget.innerHTML=habitTable(hm.cohorts||[]);
    if(healthTarget)healthTarget.innerHTML=healthTable(hm.daily_health||[]);
  }).catch(error=>{
    if(loadId!==deferredLoad)return;
    const message=esc(error?.message||'Daily habit cohorts are temporarily unavailable.'),cohortTarget=document.querySelector('#habit-cohorts'),healthTarget=document.querySelector('#habit-health');
    if(cohortTarget)cohortTarget.innerHTML=`<p class="error" role="alert">${message}</p>`;
    if(healthTarget)healthTarget.innerHTML='<p class="muted">Daily health is unavailable until the cohort query succeeds.</p>';
  });
  const reviews=request('/v1/admin/measurements/reviews'+suffix).then(data=>{
    if(loadId!==deferredLoad)return;
    const reviewTarget=document.querySelector('#reviews');
    if(reviewTarget){reviewTarget.innerHTML=reviewMarkup(data.reviews||[]);bindReviewDetails(reviewTarget,queryString);}
  }).catch(error=>{
    if(loadId!==deferredLoad)return;
    const reviewTarget=document.querySelector('#reviews');
    if(reviewTarget)reviewTarget.innerHTML=`<p class="error" role="alert">${esc(error?.message||'Review candidates are temporarily unavailable.')}</p>`;
  });
  await Promise.allSettled([habits,reviews]);
}
function render() {
  const s=report.summary,c=report.coverage,f=report.filters,sf=report.share_funnel||{};
  root.innerHTML=`<h1>How the decisions play</h1><p class="muted">Current corpus ${esc(report.corpus_version||'unknown')} · First encounters · QA excluded · Historical corpus measurements retained but excluded · Updated ${esc(new Date(report.generated_at).toLocaleString())}</p>
    <form id="filters" class="filters"><label>From<input type="date" name="from" value="${f.start}" required></label><label>Through<input type="date" name="to" value="${f.end}" required></label><label>Environment<select name="environment" aria-label="Environment">${options([['all','All'],['mixed','Regular'],['powered-cube','Powered Cube']],f.environment)}</select></label><label>Run type<select name="type" aria-label="Run type">${options([['all','All'],['daily','Daily'],['practice','Practice'],['challenge','Challenge']],f.type)}</select></label><label>Set<select name="set" aria-label="Set">${options([['all','All'],...report.sets.map(x=>[x,x==='powered-cube'?'Powered Cube':x.toUpperCase()])],f.set)}</select></label><label>Difficulty<select name="difficulty" aria-label="Difficulty">${options([['all','All'],['easy','Easy'],['medium','Medium'],['hard','Hard']],f.band)}</select></label><label>Draft pick<select name="pick" aria-label="Draft pick">${options([['all','All'],...Array.from({length:12},(_,i)=>[String(i+1),'P1P'+(i+1)])],f.pick)}</select></label><label>Selection version<select name="version" aria-label="Selection version">${options([['all','All'],...Array.from(new Set(report.groups.filter(r=>r.dimension==='version').map(r=>r.label.split(' / ')[0]))).map(x=>[x,x]),...(f.version!=='all'&&!report.groups.some(r=>r.dimension==='version'&&r.label.startsWith(f.version+' / '))?[[f.version,f.version]]:[])],f.version)}</select></label><button>Refresh</button><button type="button" class="secondary" id="csv">Export CSV</button></form>
    <div class="cards">${[['First-encounter answers',fmt(s.answers)],['Trophy match rate',pct(s.trophy_match_pct)],['Average alternative credit',fmt(s.average_partial_credit)],['Median foreground time',s.median_seconds==null?'N/A':fmt(s.median_seconds)+'s'],['Players',fmt(s.players)],['Completed / observed runs',`${fmt(s.completed_runs)} / ${fmt(s.runs)}`],['Rerolls / viewed choices',`${fmt(s.rerolls)} / ${fmt(s.exposures)}`],['Likely abandonment',fmt(s.likely_abandoned)]].map(([label,value])=>`<div class="card"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>
    <h2>Daily result-share funnel</h2>
    <div class="cards share-funnel">${[['Share-link arrivals',fmt(sf.arrivals)],['Unique visitors',fmt(sf.visitors)],['New Daily starts',fmt(sf.starts)],['Completed Dailies',fmt(sf.completions)]].map(([label,value])=>`<div class="card"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>
    <p class="note">Start conversion: <strong>${pct(sf.start_pct)}</strong> · Completion of attributed starts: <strong>${pct(sf.completion_pct)}</strong>. Uses the selected date range and environment inside the current-corpus baseline. Share-link arrivals are best-effort client analytics bounded to the current corpus epoch; starts and completions are authoritative current-corpus sessions. Other decision filters do not apply to this funnel.</p>
    <h2>Daily habit cohorts</h2>
    <p class="note">Current-corpus Dailies only · distinct Pacific Daily dates · first current-corpus Daily in the selected date range. Linked accounts collapse across merged browser identities; guests are counted per browser. QA sessions, QA-pattern names, and admin-linked players are excluded. Environment and decision filters do not change these habit metrics.</p>
    <div id="habit-cohorts"><p class="muted">Loading Daily habit cohorts…</p></div>
    <p class="note">Rates use only fully closed measurement windows; raw mature denominators and immature cohort counts are shown beside each rate. <code>pre_tracking</code> means product activity existed before acquisition tracking for that player. <code>direct</code> includes post-launch visits with no captured source. “Ever 3-in-7” is lifetime observed status, so it can rise after the cohort window.</p>
    <h2>3-in-7 daily health</h2>
    <div id="habit-health"><p class="muted">Loading 3-in-7 Daily health…</p></div>
    <p class="note">${Number(s.answers)<30?'Early data: wait for more player answers before drawing conclusions. ':''}Difficulty is a model estimate, not a measured human success probability. “Likely abandonment” means an unfinished choice with 24 hours of inactivity; returning players leave that count.</p>
    <p class="muted">Excluded: ${fmt(c.qa_excluded)} QA observations, ${fmt(c.repeats_excluded)} repeat encounters, ${fmt(c.unobserved_excluded)} outcomes without a recorded view. Pending choices: ${fmt(s.pending)}. Timing available for ${fmt(s.timed_answers)} answers; reloads and multiple tabs omit timing. P90: ${s.p90_seconds==null?'N/A':fmt(s.p90_seconds)+'s'}.</p>
    ${[['difficulty','By difficulty'],['pick','By real draft pick'],['round','By game position'],['set','By set'],['source_event','By source event'],['model_disagreement','When the model questions the trophy pick'],['version','By scoring and selection version']].map(([dimension,title])=>`<h2>${title}</h2>${table(report.groups.filter(r=>r.dimension===dimension).sort((a,b)=>dimension==='difficulty'?['easy','medium','hard','unrated'].indexOf(a.label)-['easy','medium','hard','unrated'].indexOf(b.label):a.label.localeCompare(b.label,undefined,{numeric:true})),dimension==='model_disagreement'?'Disagreement':'Group')}`).join('')}
    <h2>Alternative-credit distribution</h2><p>${[['0–24',s.partial_0_24],['25–49',s.partial_25_49],['50–74',s.partial_50_74],['75–95',s.partial_75_95]].map(([label,n])=>`${label} points: <strong>${fmt(n)}</strong>`).join(' · ')}</p>
    <h2>Decisions to review</h2><p class="muted">At least five first-encounter answers. Model disagreements appear first, then the largest samples. Small samples are exploratory.</p><div id="reviews"><p class="muted">Loading decisions to review…</p></div><p id="status" role="status"></p>`;
  document.querySelector('#filters').onsubmit=async e=>{e.preventDefault();params=new URLSearchParams(new FormData(e.currentTarget));await refreshReport();};
  document.querySelector('#csv').onclick=()=>{
    const rows=report.groups,keys=rows.length?Object.keys(rows[0]):['dimension','label','answers'];
    const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
    const blob=new Blob([[keys,...rows.map(r=>keys.map(k=>r[k]))].map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`pack-one-decisions-${f.start}-${f.end}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  };
}
// Report refresh does not reset the authorized shell or remove filters while a
// previous report request is in flight. In particular, a second refresh must
// be possible before the first response returns.
async function refreshReport() {
  const loadId=++deferredLoad;
  try {
    const queryString=params.toString();
    const nextReport=await request('/v1/admin/measurements'+(queryString?'?'+queryString:''));
    if(loadId!==deferredLoad)return;
    report=nextReport;render();void loadDeferredSections(loadId,reportQuery(report.filters));
  } catch(error) {
    if(loadId!==deferredLoad)return;
    if(error?.status===401||error?.status===403){await load();return;}
    const status=document.querySelector('#status');
    if(status)status.textContent=error?.message||'Report temporarily unavailable.';
  }
}

async function load() {
  const loadId=++deferredLoad;
  setAuthorized(false);
  root.innerHTML='<p>Checking administrator access…</p>';
  let session=null;
  try {
    session=await getAuthSession();
    if(loadId!==deferredLoad)return;
    if(!session?.user){login(pendingInvitation()?'Sign in to review your administrator invitation.':'Your session may have expired. Sign in to continue.');return;}
    await verifyAdminContract();
    if(loadId!==deferredLoad)return;
    const invitation=pendingInvitation();
    if(invitation){
      showInvitationPrompt(session.user,invitation,loadId);
      return;
    }
    const access=await request('/v1/admin/access');
    if(loadId!==deferredLoad)return;
    setAuthorized(true,access.role);
    const authorizedRequest=async (...args)=>{const data=await request(...args);if(loadId!==deferredLoad)throw Error('Administrator account changed.');return data;};
    const authorizedGrowthRequest=async (...args)=>{const data=await growthRequest(...args);if(loadId!==deferredLoad)throw Error('Administrator account changed.');return data;};
    const area=new URLSearchParams(location.search).get('area');
    if(area==='corpus'){await renderCorpus(root,authorizedRequest);return;}
    if(area==='users'){await renderUsers(root,authorizedRequest,authorizedGrowthRequest,access.role);return;}
    if(area==='team'){if(access.role!=='owner'){denied(session?.user);return;}await renderAdminTeam(root,authorizedRequest);return;}
    if(area==='campaign-links'){await renderCampaignLinks(root,authorizedGrowthRequest,authorizedRequest);return;}
    const queryString=params.toString();
    const nextReport=await authorizedRequest('/v1/admin/measurements'+(queryString?'?'+queryString:''));
    if(loadId!==deferredLoad)return;
    report=nextReport;render();void loadDeferredSections(loadId,reportQuery(report.filters));
  } catch(error) {
    if(loadId!==deferredLoad)return;
    if(error?.status===401){login('Your session expired. Sign in again to continue.');return;}
    if(error?.status===403){denied(session?.user);return;}
    unavailable(error);
  }
}
document.querySelector('#admin-signout').onclick=()=>void switchAccount();
document.addEventListener('pack1:admin-signout',()=>void switchAccount());
window.addEventListener('packone-account-changed',()=>{if(!switching)void load();});
await load();
