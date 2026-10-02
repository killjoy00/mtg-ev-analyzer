const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const fmt=value=>value==null?'N/A':Number(value).toLocaleString(undefined,{maximumFractionDigits:1});
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

export async function renderUsers(root,request,growthRequest=request) {
  let data=null,filters={search:'',status:'all'},detailLoadSerial=0;

  async function load() {
    root.innerHTML='<p>Loading users…</p>';
    const query=new URLSearchParams();
    if(filters.search)query.set('search',filters.search);
    if(filters.status!=='all')query.set('status',filters.status);
    data=await request('/v1/admin/users?'+query);
    render();
  }

  function access(user) {
    if(user.banned)return badge('Banned','blocked');
    const items=[];
    if(user.linked&&!user.username_owned)items.push(badge('Username attention','blocked'));
    if(user.public_identity_hidden_at)items.push(badge('Identity hidden','blocked'));
    if(user.patreon_connected)items.push(badge('Patreon','candidate'));
    if(user.active_entitlements>0)items.push(badge('Paid','live'),...(user.capabilities||[]).map(value=>badge(capabilityLabel(value))));
    if(!items.length)items.push(badge('Free account'));
    return items.join(' ');
  }

  function render() {
    const s=data.summary||{};
    root.innerHTML=`<section class="users-page">
      <div class="users-heading"><div><h1>Users</h1><p class="muted">Authenticated Pack One accounts only. Anonymous and guest gameplay identities are intentionally not listed here.</p></div><button type="button" class="secondary" id="users-signout">Sign out</button></div>
      <div class="cards user-cards">
        ${[['Accounts',s.total],['New · 30d',s.new_30d],['Active · 30d',s.active_30d],['Username attention',s.username_attention],['Patreon',s.patreon],['Paid',s.paid],['Admins',s.admins]].map(([label,value])=>`<div class="card"><span>${esc(label)}</span><strong>${fmt(value)}</strong></div>`).join('')}
      </div>
      <form id="user-filters" class="filters user-filters">
        <label>Find a user<input type="search" name="search" value="${esc(filters.search)}" placeholder="Account name, email, or public username"></label>
        <label>Status<select name="status"><option value="all" ${filters.status==='all'?'selected':''}>All accounts</option><option value="paid" ${filters.status==='paid'?'selected':''}>Paid</option><option value="patreon" ${filters.status==='patreon'?'selected':''}>Patreon connected</option><option value="admin" ${filters.status==='admin'?'selected':''}>Admins</option></select></label>
        <button>Refresh</button>
      </form>
      <p class="muted users-count">Showing ${fmt(data.users.length)} of ${fmt(data.total_matching)} matching accounts${data.truncated?' · refine the search to see more':''}.</p>
      <div class="scroll"><table class="user-table"><thead><tr><th>Account</th><th>Public username</th><th>Created</th><th>Last active</th><th>Runs</th><th>Avg.</th><th>Access</th><th>Admin</th></tr></thead><tbody id="user-rows">
        ${data.users.map(user=>`<tr>
          <th><button type="button" class="user-open" data-user="${esc(user.id)}">${esc(user.name||'Unnamed account')}<small>${esc(user.email||'No email')}</small></button></th>
          <td>${user.linked?esc(user.profile_name||'Pack Player'):'N/A'}${user.linked&&!user.username_owned?' · unowned':''}</td>
          <td>${esc(dateOnly(user.created_at))}</td><td>${esc(dateTime(user.last_active))}</td><td class="corpus-number">${fmt(user.runs)}</td><td class="corpus-number">${fmt(user.average_score)}</td>
          <td class="user-access">${access(user)}</td><td>${user.is_admin?badge('Admin','candidate'):'N/A'}</td>
        </tr>`).join('')||'<tr><td colspan="8">No authenticated accounts match these filters.</td></tr>'}
      </tbody></table></div>
      <dialog id="user-detail" aria-label="User details"><div id="user-detail-body"></div></dialog>
      <p id="status" role="status"></p>
    </section>`;
    document.querySelector('#user-filters').onsubmit=async event=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      filters={search:String(form.get('search')||'').trim(),status:String(form.get('status')||'all')};
      await load();
    };
    document.querySelector('#users-signout').onclick=()=>document.dispatchEvent(new CustomEvent('pack1:admin-signout'));
    document.querySelectorAll('[data-user]').forEach(button=>button.onclick=()=>openDetail(button.dataset.user));
  }

  async function deletionStatus(id) {
    try {
      return (await growthRequest('/v1/admin/users/'+encodeURIComponent(id)+'/deletion')).deletion||null;
    } catch(error) {
      if(error.status===404)return null;
      throw error;
    }
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
    return `<form id="delete-account-form">
      <p><strong>This permanently deletes the selected Pack One account.</strong> Attributable profile, leaderboard, gameplay, and career data are removed under the existing account-deletion contract. Retained opponent/shared results are de-identified. Once the deletion state is committed, it cannot be canceled.</p>
      <p class="muted">Deleting Pack One does not cancel Apple subscriptions or Patreon memberships.</p>
      <label>Type DELETE to confirm<input name="confirm" autocomplete="off" spellcheck="false" required></label>
      <label>Reason (optional)<input name="reason" maxlength="200" autocomplete="off"></label>
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
            <label>Reason (optional)<input name="reason" maxlength="200" autocomplete="off" ${renameBlocked?'disabled':''}></label>
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
      document.querySelector('#user-detail-close').onclick=()=>dialog.close();

      const renameForm=document.querySelector('#change-username-form');
      if(renameForm&&!renameBlocked)renameForm.onsubmit=async event=>{
        event.preventDefault();
        const form=event.currentTarget,status=form.querySelector('#username-status');
        const values=new FormData(form),buttons=form.querySelectorAll('button,input');
        buttons.forEach(control=>control.disabled=true);status.textContent='Saving username…';
        try {
          await request('/v1/admin/users/'+encodeURIComponent(id)+'/username',{
            displayName:String(values.get('displayName')||''),
            reason:String(values.get('reason')||''),
          },'PATCH');
          await load();
          await openDetail(id);
        } catch(error) {
          status.textContent=error.message;
          buttons.forEach(control=>control.disabled=false);
        }
      };

      const deleteForm=document.querySelector('#delete-account-form');
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
          },'POST');
          if(result.deletion==='complete') {
            dialog.close();
            await load();
            const globalStatus=document.querySelector('#status');
            if(globalStatus)globalStatus.textContent='Account deletion completed.';
            return;
          }
          await openDetail(id);
        } catch(error) {
          try {
            const recovered=await deletionStatus(id);
            if(recovered) {
              status.textContent='Deletion started. Reloading its persisted status…';
              await openDetail(id);
              return;
            }
          } catch {}
          status.textContent=error.message;
          controls.forEach(control=>control.disabled=false);
        }
      };

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
        } catch(error) {
          const target=document.querySelector('#deletion-status');
          if(target)target.insertAdjacentHTML('beforeend',`<p class="error">${esc(error.message)}</p>`);
          refresh.disabled=false;
        }
      };
    } catch(error) {
      body.innerHTML=`<div class="user-detail-heading"><h2>User unavailable</h2><button type="button" class="secondary" id="user-detail-close">Close</button></div><p class="error">${esc(error.message)}</p>`;
      document.querySelector('#user-detail-close').onclick=()=>dialog.close();
    }
  }

  await load();
}
