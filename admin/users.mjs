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

export async function renderUsers(root,request) {
  let data=null,filters={search:'',status:'all'};
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
        <label>Find a user<input type="search" name="search" value="${esc(filters.search)}" placeholder="Name or email"></label>
        <label>Status<select name="status"><option value="all" ${filters.status==='all'?'selected':''}>All accounts</option><option value="paid" ${filters.status==='paid'?'selected':''}>Paid</option><option value="patreon" ${filters.status==='patreon'?'selected':''}>Patreon connected</option><option value="admin" ${filters.status==='admin'?'selected':''}>Admins</option></select></label>
        <button>Refresh</button>
      </form>
      <p class="muted users-count">Showing ${fmt(data.users.length)} of ${fmt(data.total_matching)} matching accounts${data.truncated?' · refine the search to see more':''}.</p>
      <div class="scroll"><table class="user-table"><thead><tr><th>User</th><th>Created</th><th>Last active</th><th>Runs</th><th>Avg.</th><th>Access</th><th>Admin</th></tr></thead><tbody id="user-rows">
        ${data.users.map(user=>`<tr>
          <th><button type="button" class="user-open" data-user="${esc(user.id)}">${esc(user.name||'Unnamed account')}<small>${esc(user.email||'No email')}</small></button></th>
          <td>${esc(dateOnly(user.created_at))}</td><td>${esc(dateTime(user.last_active))}</td><td class="corpus-number">${fmt(user.runs)}</td><td class="corpus-number">${fmt(user.average_score)}</td>
          <td class="user-access">${access(user)}</td><td>${user.is_admin?badge('Admin','candidate'):'N/A'}</td>
        </tr>`).join('')||'<tr><td colspan="7">No authenticated accounts match these filters.</td></tr>'}
      </tbody></table></div>
      <dialog id="user-detail" aria-label="User details"><div id="user-detail-body"></div></dialog>
      <p id="status" role="status"></p>
    </section>`;
    document.querySelector('#user-filters').onsubmit=async event=>{
      event.preventDefault();const form=new FormData(event.currentTarget);filters={search:String(form.get('search')||'').trim(),status:String(form.get('status')||'all')};await load();
    };
    document.querySelector('#users-signout').onclick=()=>document.dispatchEvent(new CustomEvent('pack1:admin-signout'));
    document.querySelectorAll('[data-user]').forEach(button=>button.onclick=()=>openDetail(button.dataset.user));
  }
  async function openDetail(id) {
    const dialog=document.querySelector('#user-detail'),body=document.querySelector('#user-detail-body');
    body.innerHTML='<p>Loading user…</p>';dialog.showModal();
    try {
      const detail=await request('/v1/admin/users/'+encodeURIComponent(id)),u=detail.user,stats=detail.stats;
      const entitlements=detail.entitlements||[],providers=detail.providers||[],runs=detail.recent_runs||[],events=detail.recent_events||[];
      body.innerHTML=`<div class="user-detail-heading"><div><p class="muted">Authenticated account</p><h2>${esc(u.name||'Unnamed account')}</h2><p>${esc(u.email||'No email')}</p></div><button type="button" class="secondary" id="user-detail-close">Close</button></div>
        <dl class="user-metrics">
          <dt>Email verified</dt><dd>${u.email_verified?'Yes':'No'}</dd>
          <dt>Created</dt><dd>${esc(dateTime(u.created_at))}</dd>
          <dt>Last active</dt><dd>${esc(dateTime(u.last_active))}</dd>
          <dt>Gameplay history</dt><dd>${u.linked?'Linked to this account':'Not linked yet'}</dd>
          <dt>Profile</dt><dd>${esc(u.profile_name||'N/A')}${u.profile_public?' · public':''}${u.linked&&!u.username_owned?' · username needs attention':''}</dd>
          <dt>Admin access</dt><dd>${u.is_admin?'Yes':'No'}</dd>
          ${u.banned?`<dt>Account status</dt><dd>${badge('Banned','blocked')} ${esc(u.ban_reason||'')}</dd>`:''}
        </dl>
        <div class="cards user-detail-cards">
          ${[['Runs',stats.runs],['Completed',stats.completed_runs],['Dailies',stats.dailies],['Practice',stats.practice_runs],['Avg. score',stats.average_score],['Best',stats.best_score]].map(([label,value])=>`<div class="card"><span>${esc(label)}</span><strong>${fmt(value)}</strong></div>`).join('')}
        </div>
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
    } catch(error) {
      body.innerHTML=`<div class="user-detail-heading"><h2>User unavailable</h2><button type="button" class="secondary" id="user-detail-close">Close</button></div><p class="error">${esc(error.message)}</p>`;
      document.querySelector('#user-detail-close').onclick=()=>dialog.close();
    }
  }
  await load();
}
