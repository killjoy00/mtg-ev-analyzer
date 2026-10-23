import {gameDateKey} from '../game-date.mjs';

const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const fmt=value=>value==null?'N/A':Number(value).toLocaleString(undefined,{maximumFractionDigits:1});
const pct=value=>value==null?'N/A':`${fmt(value)}%`;
const dateTime=value=>value?new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value)):'N/A';
const dateOnly=value=>value?new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric'}).format(new Date(value)):'N/A';
const capabilityLabel=value=>({unlimited_cube_practice:'Cube practice',custom_corpus:'Custom sets'})[value]||value;
const badge=(label,kind='')=>`<span class="user-badge ${esc(kind)}">${esc(label)}</span>`;
const props=value=>{
  const entries=Object.entries(value||{}).slice(0,4);
  return entries.length?entries.map(([key,item])=>`${esc(key)}=${esc(typeof item==='object'?JSON.stringify(item):item)}`).join(' · '):'N/A';
};
const deletionStateLabel=value=>({
  pending:'Started',
  app_cleanup_complete:'Pack One cleanup complete',
  provider_delete_pending:'Provider deletion pending',
  provider_deleted:'Provider deleted',
  operator_review:'Operator review',
  complete:'Complete',
})[value]||value||'Unknown';

export async function renderUsers(root,request,growthRequest=request,viewerRole='admin') {
  const prefill=new URLSearchParams(location.search).get('search')||'';
  let data=null,filters={search:prefill.length<=100?prefill:'',status:'all'},
    activityWindow={from:'',to:''},page=1,detailLoadSerial=0,loadSerial=0;

  async function load() {
    const serial=++loadSerial;
    if(!data)root.innerHTML='<p role="status">Loading users…</p>';
    else {
      const indicator=root.querySelector('#users-loading');
      if(indicator)indicator.textContent='Updating users…';
    }
    const query=new URLSearchParams();
    if(filters.search)query.set('search',filters.search);
    if(filters.status!=='all')query.set('status',filters.status);
    if(page>1)query.set('page',String(page));
    if(activityWindow.from)query.set('activity_from',activityWindow.from);
    if(activityWindow.to)query.set('activity_to',activityWindow.to);
    try {
      const next=await request('/v1/admin/users?'+query);
      if(serial!==loadSerial)return;
      // Search results may have shrunk between page requests.
      if(page>1&&!next.users.length) {
        page=Math.max(1,Math.ceil(Number(next.total_matching)/(Number(next.page_size)||100))||1);
        return load();
      }
      data=next;
      render();
    } catch(error) {
      if(serial!==loadSerial)return;
      if(!data)throw error;
      const indicator=root.querySelector('#users-loading');
      if(indicator){indicator.classList.add('error');indicator.textContent=error.message||'Unable to refresh users. Try again.';}
    }
  }

  function activityPreset(days) {
    const to=gameDateKey(new Date()),start=new Date(to+'T12:00:00Z');
    start.setUTCDate(start.getUTCDate()-(days-1));
    return {from:start.toISOString().slice(0,10),to};
  }

  function playActivity() {
    const activity=data.play_activity;
    const heading='<div class="users-section-heading"><div><p class="users-kicker">PLAYER ACTIVITY</p><h2 id="play-activity-heading">Signed out vs signed in</h2><p class="muted">People who completed at least one run in this period. Unlike Overview’s observed players, these counts exclude people who only viewed decisions.</p></div></div>';
    if(!activity)return `${heading}<p class="muted">Activity is not available from this backend version.</p>`;
    const form=`<form id="play-activity-filters" class="filters activity-filters"><label>From<input type="date" name="from" value="${esc(activity.start)}" required></label><label>Through<input type="date" name="to" value="${esc(activity.end)}" required></label><button>Update dates</button><div class="activity-presets" role="group" aria-label="Quick date ranges"><button type="button" class="secondary" data-activity-days="1">Today</button><button type="button" class="secondary" data-activity-days="7">7 days</button><button type="button" class="secondary" data-activity-days="14">14 days</button></div></form><p id="activity-error" class="error" role="alert" hidden></p>`;
    if(activity.unavailable)return `${heading}${form}<p class="error" role="alert">Completed-run activity is temporarily unavailable. Account search remains available.</p>`;
    const rows=activity.groups||[],signedOut=rows.find(row=>row.group==='signed_out'),
      signedIn=rows.find(row=>row.group==='signed_in');
    const out=Number(signedOut?.players)||0,inside=Number(signedIn?.players)||0,total=out+inside;
    const runs=rows.reduce((sum,row)=>sum+(Number(row.completed_runs)||0),0);
    const cards=[['Completed-run players',total],['Signed out',out],['Signed in',inside],['Completed runs',runs]];
    const labels={signed_out:'Signed out',signed_in:'Signed in'};
    return `${heading}${form}
      <div class="cards user-activity-cards">
        ${cards.map(([label,value])=>`<div class="card"><span>${esc(label)}</span><strong>${fmt(value)}</strong></div>`).join('')}
      </div>
      <div class="scroll"><table class="play-activity-table"><thead><tr><th>Status</th><th>Players</th><th>Completed runs</th><th>First Daily in range</th><th>Next-day return</th></tr></thead><tbody>
        ${rows.map(row=>`<tr><th>${esc(labels[row.group]||row.group)}</th><td>${fmt(row.players)}</td><td>${fmt(row.completed_runs)}</td><td>${fmt(row.first_daily_people)}</td><td>${pct(row.next_day_rate)}<br><small>${fmt(row.next_day_returned)} / ${fmt(row.next_day_mature)} returned · ${fmt(row.next_day_immature)} too new</small></td></tr>`).join('')||'<tr><td colspan="5">No completed runs in this range.</td></tr>'}
      </tbody></table></div>
      <p class="users-activity-note">Pacific dates; current-corpus completed Daily and practice runs only, with QA and admin players excluded. Dailies use their assigned Daily date; practice uses the run creation date. Guests count per browser; linked players count by account, including earlier runs. These totals are not directly subtractable from Overview’s first-encounter observations. Next-day return counts first-ever Daily players who completed another Daily the next day; “too new” means that next day is not fully over.</p>`;
  }

  function access(user) {
    if(user.banned)return badge('Banned','blocked');
    const items=[];
    if(user.linked&&!user.username_owned)items.push(badge('Username attention','blocked'));
    if(user.public_identity_hidden_at)items.push(badge('Identity hidden','blocked'));
    if(user.active_entitlements>0)items.push(badge('Paid','live'),...(user.capabilities||[]).map(value=>badge(capabilityLabel(value))));
    if(!user.active_entitlements)items.push(badge('Free account'));
    return items.join(' ');
  }

function render() {
    const summary=data.summary||{},size=Number(data.page_size)||100,total=Number(data.total_matching)||0,
      lastPage=Math.max(1,Math.ceil(total/size)),currentPage=Number(data.page)||page,
      first=total?((currentPage-1)*size+1):0,last=total?Math.min(total,(currentPage-1)*size+data.users.length):0;
    root.innerHTML=`<section class="users-page">
      <header class="users-heading"><div><p class="users-kicker">PACK ONE ADMINISTRATION</p><h1>Users</h1><p class="muted">Authenticated Pack One accounts only. Anonymous and guest gameplay identities are intentionally not listed here.</p></div></header>
      <section class="play-activity" aria-labelledby="play-activity-heading">${playActivity()}</section>
      <section class="user-directory" aria-labelledby="user-directory-heading">
        <div class="users-section-heading"><div><p class="users-kicker">ACCOUNT MANAGEMENT</p><h2 id="user-directory-heading">Account directory</h2><p class="muted">Search and account status filters apply only to this directory, not to the activity report above. Totals below describe all authenticated accounts.</p></div></div>
        <div class="cards user-cards">
          ${[['Accounts',summary.total],['New · 30d',summary.new_30d],['Active · 30d',summary.active_30d],['Username attention',summary.username_attention],['Patreon linked',summary.patreon],['Paid',summary.paid],['Admins',summary.admins]].map(([label,value])=>`<div class="card"><span>${esc(label)}</span><strong>${fmt(value)}</strong></div>`).join('')}
        </div>
        <form id="user-filters" class="filters user-filters">
          <label>Find a user<input type="search" name="search" value="${esc(filters.search)}" maxlength="100" placeholder="Account name, email, or public username"></label>
          <label>Status<select name="status"><option value="all" ${filters.status==='all'?'selected':''}>All accounts</option><option value="paid" ${filters.status==='paid'?'selected':''}>Paid</option><option value="patreon" ${filters.status==='patreon'?'selected':''}>Patreon connected</option><option value="admin" ${filters.status==='admin'?'selected':''}>Admins</option></select></label>
          <button>Refresh</button>
        </form>
        <div class="users-list-meta">
          <p class="muted users-count">Showing ${fmt(first)}–${fmt(last)} of ${fmt(total)} matching accounts · most recently active first.</p>
          <div class="users-pagination" role="group" aria-label="Account pages">
            <button type="button" class="secondary" data-user-page="previous" ${currentPage<=1?'disabled':''}>Previous</button>
            <span>Page ${fmt(currentPage)} of ${fmt(lastPage)}</span>
            <button type="button" class="secondary" data-user-page="next" ${currentPage>=lastPage?'disabled':''}>Next</button>
          </div>
        </div>
        <div class="scroll"><table class="user-table"><thead><tr><th>Account</th><th>Public username</th><th>Created</th><th>Last active</th><th>Runs</th><th>Avg. score</th><th>Access</th><th>Connections</th><th>Admin</th></tr></thead><tbody id="user-rows">
          ${data.users.map(user=>`<tr>
            <th><button type="button" class="user-open" data-user="${esc(user.id)}">${esc(user.name||'Unnamed account')}<small>${esc(user.email||'No email')}</small></button></th>
            <td>${user.linked?esc(user.profile_name||'Pack Player'):'N/A'}${user.linked&&!user.username_owned?' · unowned':''}</td>
            <td>${esc(dateOnly(user.created_at))}</td><td>${esc(dateTime(user.last_active))}</td><td class="corpus-number">${fmt(user.runs)}</td><td class="corpus-number">${fmt(user.average_score)}</td>
            <td class="user-access">${access(user)}</td><td class="user-connections">${user.patreon_connected?badge('Patreon linked'):'N/A'}</td><td>${user.is_admin?badge('Admin','candidate'):'N/A'}</td>
          </tr>`).join('')||'<tr><td colspan="9">No authenticated accounts match these filters.</td></tr>'}
        </tbody></table></div>
        <p id="users-loading" role="status" aria-live="polite"></p>
      </section>
      <dialog id="user-detail" aria-label="User details"><div id="user-detail-body"></div></dialog>
      <p id="status" role="status"></p>
    </section>`;
    root.querySelector('#user-filters').onsubmit=async event=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      filters={search:String(form.get('search')||'').trim(),status:String(form.get('status')||'all')};
      page=1;
      await load();
    };
    const activityForm=root.querySelector('#play-activity-filters');
    if(activityForm)activityForm.onsubmit=async event=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      const next={from:String(form.get('from')||''),to:String(form.get('to')||'')};
      const error=root.querySelector('#activity-error');
      if(!next.from||!next.to||next.to<next.from||(Date.parse(next.to)-Date.parse(next.from))/86400000>365){
        if(error){error.hidden=false;error.textContent='Choose a range of up to one year, with Through on or after From.';}
        return;
      }
      activityWindow=next;
      await load();
    };
    root.querySelectorAll('[data-activity-days]').forEach(button=>button.onclick=async()=>{
      activityWindow=activityPreset(Number(button.dataset.activityDays));
      await load();
    });
    root.querySelectorAll('[data-user-page]').forEach(button=>button.onclick=async()=>{
      page+=button.dataset.userPage==='next'?1:-1;
      page=Math.max(1,Math.min(page,lastPage));
      await load();
    });
    root.querySelectorAll('[data-user]').forEach(button=>button.onclick=()=>openDetail(button.dataset.user));
  }

  async function deletionStatus(id) {
    try {
      return (await growthRequest('/v1/admin/users/'+encodeURIComponent(id)+'/deletion')).deletion||null;
    } catch(error) {
      if(error.status===404)return null;
      throw error;
    }
  }

  function notifyControl(user,action) {
    return `<label><input type="checkbox" name="notifyUser" value="yes" checked> Email the user about this ${action}</label>
      ${user.email_verified?'':'<p class="muted">This account has no verified email address, so no email will be sent.</p>'}`;
  }

  function notificationText(notification) {
    if(!notification)return '';
    if(notification.status==='sent')return 'The user was emailed.';
    if(notification.status==='failed')return 'The user email could not be sent.';
    if(notification.reason==='not_requested')return 'No email sent: notification was turned off.';
    if(notification.reason==='no_verified_email')return 'No email sent: the account has no verified email address.';
    if(notification.reason==='not_configured')return 'No email sent: account email is not configured in this environment.';
    if(notification.reason==='unchanged')return 'Username unchanged; no email sent.';
    return 'No email sent.';
  }

  function identityHistory(actions) {
    return actions.length?`<div class="scroll"><table><thead><tr><th>When</th><th>Action</th><th>Change</th><th>Reason</th><th>Admin</th></tr></thead><tbody>
      ${actions.map(action=>`<tr>
        <td>${esc(dateTime(action.created_at))}</td>
        <td>${esc(action.action)}</td>
        <td>${action.action==='rename'?`${esc(action.previous_display_name||'redacted')} → ${esc(action.new_display_name||'redacted')}`:'N/A'}</td>
        <td>${esc(action.reason||'N/A')}</td>
        <td><small>${esc(action.admin_auth_user_id||'N/A')}</small></td>
      </tr>`).join('')}
    </tbody></table></div>`:'<p class="muted">No public-identity admin actions recorded.</p>';
  }

  function deletionPanel(user,id,deletion,{statusUnavailable=false,statusLoading=false}={}) {
    if(statusLoading) {
      return `<div id="deletion-status">
        <p class="muted">Checking deletion status… Permanent deletion is disabled until this check completes.</p>
      </div>`;
    }
    if(statusUnavailable) {
      return `<div id="deletion-status">
        <p class="error">Deletion status is temporarily unavailable. Other user-management controls remain available, but permanent deletion is disabled until the deletion service responds.</p>
        <button type="button" class="secondary" id="deletion-refresh">Retry deletion status</button>
      </div>`;
    }
    if(deletion) {
      return `<div id="deletion-status">
        <p><strong>${esc(deletionStateLabel(deletion.state))}</strong> · ${esc(deletion.message||'')}</p>
        <p class="muted">Operation ${esc(deletion.operation_id)} · attempts ${fmt(deletion.attempts)} · source ${esc(deletion.initiation_source||'self_service')}${deletion.error_code?' · '+esc(deletion.error_code):''}</p>
        ${deletion.initiated_by_admin_auth_user_id?`<p class="muted">Initiating admin: <code>${esc(deletion.initiated_by_admin_auth_user_id)}</code></p>`:''}
        ${deletion.state!=='complete'?'<button type="button" class="secondary" id="deletion-refresh">Refresh deletion status</button>':''}
      </div>`;
    }
    if(user.is_self)return '<p class="muted">Self-deletion is not available from Admin Users. Use the normal account settings deletion flow for your own account.</p>';
    if(user.is_admin&&viewerRole!=='owner')
      return '<p class="muted">Only the Owner may permanently delete another administrator account. Ask the Owner to manage access in the Team console.</p>';
    return `<form id="delete-account-form">
      <p><strong>This permanently deletes the selected Pack One account.</strong> Attributable profile, leaderboard, gameplay, and career data are removed under the existing account-deletion contract. Retained opponent/shared results are de-identified. Once the deletion state is committed, it cannot be canceled.</p>
      <p class="muted">Deleting Pack One does not cancel Apple subscriptions or Patreon memberships.</p>
      <label>Type DELETE to confirm<input name="confirm" autocomplete="off" spellcheck="false" required></label>
      <label>Reason (optional), included in the email to the user<input name="reason" maxlength="200" autocomplete="off"></label>
      ${notifyControl(user,'deletion')}
      ${user.is_admin?'<label><input type="checkbox" name="acknowledgeAdmin" value="yes" required> I understand this permanently deletes another Pack One administrator account.</label>':''}
      <div class="actions"><button type="submit" class="danger">Delete account</button></div>
      <p id="delete-account-status" role="status"></p>
    </form>`;
  }

  async function openDetail(id) {
    const dialog=document.querySelector('#user-detail'),body=document.querySelector('#user-detail-body');
    const detailSerial=++detailLoadSerial;
    body.innerHTML='<p>Loading user…</p>';
    if(!dialog.open)dialog.showModal();
    try {
      const deletionPromise=deletionStatus(id).then(
        value=>({ok:true,value}),
        error=>({ok:false,error}),
      );
      let detail;
      try {
        detail=await request('/v1/admin/users/'+encodeURIComponent(id));
      } catch(error) {
        const deletionResult=await deletionPromise;
        const deletion=deletionResult.ok?deletionResult.value:null;
        if(error.status===404&&deletion) {
          body.innerHTML=`<div class="user-detail-heading"><div><p class="muted">Deleted / deleting account</p><h2>Deletion status</h2><p><code>${esc(id)}</code></p></div><button type="button" class="secondary" id="user-detail-close">Close</button></div>
            <section class="user-section"><h3>Permanent account deletion</h3>${deletionPanel({is_self:false,is_admin:Boolean(deletion.target_was_admin)},id,deletion)}</section>`;
          document.querySelector('#user-detail-close').onclick=()=>{detailLoadSerial++;dialog.close();};
          const refresh=document.querySelector('#deletion-refresh');
          if(refresh)refresh.onclick=async()=>{
            refresh.disabled=true;
            try {
              const current=await deletionStatus(id);
              if(current?.state==='complete') {
                dialog.close();
                await load();
                const globalStatus=document.querySelector('#status');
                if(globalStatus)globalStatus.textContent='Account deletion completed.';
              } else {
                await openDetail(id);
              }
            } catch(refreshError) {
              const target=document.querySelector('#deletion-status');
              if(target)target.insertAdjacentHTML('beforeend',`<p class="error">${esc(refreshError.message)}</p>`);
              refresh.disabled=false;
            }
          };
          return;
        }
        throw error;
      }
      const u=detail.user,stats=detail.stats;
      const entitlements=detail.entitlements||[],providers=detail.providers||[],runs=detail.recent_runs||[],events=detail.recent_events||[];
      const actions=detail.moderation_actions||[];
      const renameBlocked=Boolean(u.public_identity_hidden_at);
      body.innerHTML=`<div class="user-detail-heading"><div><p class="muted">Authenticated account</p><h2>${esc(u.name||'Unnamed account')}</h2><p>${esc(u.email||'No email')}</p></div><button type="button" class="secondary" id="user-detail-close">Close</button></div>
        <dl class="user-metrics">
          <dt>Auth account name</dt><dd>${esc(u.name||'N/A')}</dd>
          <dt>Public username</dt><dd>${u.linked?esc(u.profile_name||'Pack Player'):'N/A'}${u.profile_public?' · public profile':''}${u.linked&&!u.username_owned?' · unowned':''}</dd>
          <dt>Email verified</dt><dd>${u.email_verified?'Yes':'No'}</dd>
          <dt>Created</dt><dd>${esc(dateTime(u.created_at))}</dd>
          <dt>Last active</dt><dd>${esc(dateTime(u.last_active))}</dd>
          <dt>Gameplay history</dt><dd>${u.linked?'Linked to this account':'Not linked yet'}</dd>
          <dt>Admin access</dt><dd>${u.is_admin?'Yes':'No'}</dd>
          ${u.banned?`<dt>Account status</dt><dd>${badge('Banned','blocked')} ${esc(u.ban_reason||'')}</dd>`:''}
        </dl>
        <div class="cards user-detail-cards">
          ${[['Runs',stats.runs],['Completed',stats.completed_runs],['Dailies',stats.dailies],['Practice',stats.practice_runs],['Avg. score',stats.average_score],['Best',stats.best_score]].map(([label,value])=>`<div class="card"><span>${esc(label)}</span><strong>${fmt(value)}</strong></div>`).join('')}
        </div>
        <section class="user-section"><h3>Public username</h3>
          ${u.linked?`<form id="change-username-form">
            <p class="muted">Changes the public Pack One / leaderboard identity only. It does not change the auth account name, email, credentials, profile key, or Public Identity terms acceptance.</p>
            ${u.public_identity_hidden_at?'<p class="error">This public identity is moderated. Use the existing audited restore action before renaming; restore does not republish or re-own the identity.</p>':''}
            <label>Public username<input name="displayName" value="${esc(u.profile_name||'Pack Player')}" minlength="2" maxlength="24" required ${renameBlocked?'disabled':''}></label>
            <p class="muted">2–24 characters. Whitespace/case equivalence, prohibited-name checks, placeholder release behavior, and database uniqueness are the same as the normal profile flow.</p>
            <label>Reason (optional), included in the email to the user<input name="reason" maxlength="200" autocomplete="off" ${renameBlocked?'disabled':''}></label>
            ${renameBlocked?'':notifyControl(u,'change')}
            <div class="actions"><button type="submit" ${renameBlocked?'disabled':''}>Save username</button></div>
            <p id="username-status" role="status"></p>
          </form>`:'<p class="muted">This account has no linked Pack One player, so it has no public username to change.</p>'}
        </section>
        <section class="user-section"><h3>Public identity action history</h3>${identityHistory(actions)}</section>
        <section class="user-section" id="permanent-deletion-section"><h3>Permanent account deletion</h3>${deletionPanel(u,id,null,{statusLoading:true})}</section>
        <section class="user-section"><h3>Connected providers</h3>
          ${providers.length?`<div class="scroll"><table><thead><tr><th>Provider</th><th>Membership</th><th>Access</th><th>Last synced</th></tr></thead><tbody>${providers.map(item=>`<tr><td>${esc(item.provider)}</td><td>${esc(item.membership_status||'Connected')}</td><td>${item.is_gifted?'Gifted':item.is_free_trial?'Free trial':item.currently_entitled_amount_cents?'Paid':'Free'}</td><td>${esc(dateTime(item.last_synced_at))}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No external membership provider is connected.</p>'}
        </section>
        <section class="user-section"><h3>Access</h3>
          ${entitlements.length?`<div class="scroll"><table><thead><tr><th>Capability</th><th>Provider</th><th>Status</th><th>Granted</th><th>Expires</th></tr></thead><tbody>${entitlements.map(item=>`<tr><td>${esc(capabilityLabel(item.capability))}</td><td>${esc(item.provider)}</td><td>${item.active?badge('Active','live'):badge('Inactive','blocked')}</td><td>${esc(dateOnly(item.granted_at))}</td><td>${esc(dateOnly(item.expires_at))}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No paid entitlements. Regular practice is included with the account.</p>'}
        </section>
        <section class="user-section"><h3>Recent runs</h3>
          ${runs.length?`<div class="scroll"><table class="user-runs"><thead><tr><th>When</th><th>Type</th><th>Environment</th><th>Progress</th><th>Score</th></tr></thead><tbody>${runs.map(run=>`<tr><td>${esc(dateTime(run.updated_at))}</td><td>${esc(run.run_type)}</td><td>${esc(run.environment==='powered-cube'?'Powered Cube':'Regular')}</td><td>${fmt(run.answered)}/${fmt(run.total)}</td><td>${fmt(run.score)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No Draft Runs linked to this account yet.</p>'}
        </section>
        <section class="user-section"><h3>Recent activity</h3>
          ${events.length?`<div class="scroll"><table class="user-events"><thead><tr><th>When</th><th>Event</th><th>Context</th></tr></thead><tbody>${events.map(event=>`<tr><td>${esc(dateTime(event.created_at))}</td><td>${esc(event.event_name)}</td><td><small>${props(event.event_props)}</small></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No recent tracked activity for this account.</p>'}
        </section>`;
      document.querySelector('#user-detail-close').onclick=()=>{detailLoadSerial++;dialog.close();};

      function disableRenameForDeletion() {
        const form=body.querySelector('#change-username-form');
        if(!form)return;
        if(!form.querySelector('[data-deletion-blocked]'))
          form.insertAdjacentHTML('afterbegin','<p class="error" data-deletion-blocked="true">Username changes are disabled because account deletion has already started.</p>');
        form.querySelectorAll('button,input').forEach(control=>control.disabled=true);
      }

      function renderDeletionState(deletion,{statusUnavailable=false,recoveryMessage=null,notice=''}={}) {
        if(detailSerial!==detailLoadSerial||!dialog.open)return;
        const section=body.querySelector('#permanent-deletion-section');
        if(!section)return;
        section.innerHTML=`<h3>Permanent account deletion</h3>${deletionPanel(u,id,deletion,{statusUnavailable})}`;
        if(deletion)disableRenameForDeletion();
        if(recoveryMessage) {
          const target=section.querySelector('#deletion-status');
          if(target)target.insertAdjacentHTML('beforeend',`<p class="error">${esc(recoveryMessage)}</p>`);
        }
        if(notice) {
          const target=section.querySelector('#deletion-status');
          if(target)target.insertAdjacentHTML('beforeend',`<p class="muted" role="status">${esc(notice)}</p>`);
        }
        wireDeletionControls();
      }

      function wireDeletionControls() {
        const deleteForm=body.querySelector('#delete-account-form');
        if(deleteForm)deleteForm.onsubmit=async event=>{
          event.preventDefault();
          const form=event.currentTarget,status=form.querySelector('#delete-account-status'),values=new FormData(form);
          const controls=form.querySelectorAll('button,input');
          controls.forEach(control=>control.disabled=true);status.textContent='Starting permanent deletion…';
          try {
            const result=await growthRequest('/v1/admin/users/'+encodeURIComponent(id)+'/delete',{
              confirm:String(values.get('confirm')||''),
              reason:String(values.get('reason')||''),
              acknowledgeAdmin:values.get('acknowledgeAdmin')==='yes',
              notifyUser:values.get('notifyUser')==='yes',
            },'POST');
            if(result.deletion==='complete') {
              detailLoadSerial++;
              dialog.close();
              await load();
              const globalStatus=document.querySelector('#status');
              if(globalStatus)globalStatus.textContent=['Account deletion completed.',notificationText(result.notification)].filter(Boolean).join(' ');
              return;
            }
            if(result.operation) {
              renderDeletionState(result.operation,{notice:notificationText(result.notification)});
              return;
            }
            const recovered=await deletionStatus(id);
            renderDeletionState(recovered);
          } catch(error) {
            const committed=error.data?.deletionCommitted&&error.data?.deletion?error.data.deletion:null;
            if(committed) {
              renderDeletionState(committed,{
                recoveryMessage:'The request was interrupted after permanent deletion committed. The account remains in deletion; refresh status to continue monitoring it.',
                notice:notificationText(error.data?.notification),
              });
              return;
            }
            try {
              const recovered=await deletionStatus(id);
              if(recovered) {
                renderDeletionState(recovered,{
                  recoveryMessage:'Deletion started even though the initiating request did not finish cleanly. Refresh status to continue monitoring it.',
                });
                return;
              }
            } catch {}
            status.textContent=error.message;
            controls.forEach(control=>control.disabled=false);
          }
        };

        const refresh=body.querySelector('#deletion-refresh');
        if(refresh)refresh.onclick=async()=>{
          refresh.disabled=true;
          try {
            const current=await deletionStatus(id);
            if(current?.state==='complete') {
              detailLoadSerial++;
              dialog.close();
              await load();
              const globalStatus=document.querySelector('#status');
              if(globalStatus)globalStatus.textContent='Account deletion completed.';
            } else {
              renderDeletionState(current);
            }
          } catch(error) {
            const target=body.querySelector('#deletion-status');
            if(target)target.insertAdjacentHTML('beforeend',`<p class="error">${esc(error.message)}</p>`);
            refresh.disabled=false;
          }
        };
      }

      const renameForm=document.querySelector('#change-username-form');
      if(renameForm&&!renameBlocked)renameForm.onsubmit=async event=>{
        event.preventDefault();
        const form=event.currentTarget,status=form.querySelector('#username-status');
        const values=new FormData(form),buttons=form.querySelectorAll('button,input');
        buttons.forEach(control=>control.disabled=true);status.textContent='Saving username…';
        try {
          const result=await growthRequest('/v1/admin/users/'+encodeURIComponent(id)+'/username',{
            displayName:String(values.get('displayName')||''),
            reason:String(values.get('reason')||''),
            notifyUser:values.get('notifyUser')==='yes',
          },'PATCH');
          await load();
          await openDetail(id);
          const saved=document.querySelector('#username-status');
          if(saved)saved.textContent=['Username saved.',notificationText(result.notification)].filter(Boolean).join(' ');
        } catch(error) {
          status.textContent=error.message;
          buttons.forEach(control=>control.disabled=false);
        }
      };

      wireDeletionControls();
      void deletionPromise.then(result=>{
        if(detailSerial!==detailLoadSerial||!dialog.open)return;
        renderDeletionState(result.ok?result.value:null,{statusUnavailable:!result.ok});
      });
    } catch(error) {
      body.innerHTML=`<div class="user-detail-heading"><h2>User unavailable</h2><button type="button" class="secondary" id="user-detail-close">Close</button></div><p class="error">${esc(error.message)}</p>`;
      document.querySelector('#user-detail-close').onclick=()=>{detailLoadSerial++;dialog.close();};
    }
  }

  await load();
}
