const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const when=value=>value?new Date(value).toLocaleString():'—';
export async function renderAdminTeam(root,request){
  const data=await request('/v1/admin/team');
  const invitations=data.invitations||[],members=data.members||[],audit=data.audit||[];
  const state=item=>item.accepted_at?'Accepted':item.revoked_at?'Revoked':new Date(item.expires_at).getTime()<=Date.now()?'Expired':'Pending';
  root.innerHTML=`<section class="admin-team">
    <h1>Administrator access</h1>
    <p class="muted">Owner-only: invitations grant Admin access, never Owner access. Invitees must sign in with the exact verified recipient email.</p>
    <h2>Invite an administrator</h2>
    <form id="admin-invite-form" class="filters"><label>Verified account email
      <input name="email" type="email" autocomplete="off" required maxlength="254" placeholder="person@example.com"></label>
      <button type="submit">Create invitation</button></form>
    <p class="muted">No invitation email is sent. The link is displayed once; copy it using a private channel.</p>
    <div id="admin-invite-result" aria-live="polite"></div>
    <h2>Administrators</h2>
    <div class="scroll"><table><thead><tr><th>Account</th><th>Role</th><th>Action</th></tr></thead>
      <tbody>${members.map(member=>`<tr><th>${esc(member.email)}<small>${esc(member.name||'')}</small></th>
        <td>${esc(member.role==='owner'?'Owner':'Admin')}</td>
        <td>${member.role==='owner'?'Protected':`<button type="button" class="secondary" data-revoke-member="${esc(member.id)}" data-email="${esc(member.email)}">Revoke access</button>`}</td></tr>`).join('')}</tbody></table></div>
    <h2>Invitations</h2>
    <div class="scroll"><table><thead><tr><th>Recipient</th><th>Status</th><th>Expires</th><th>Action</th></tr></thead>
      <tbody>${invitations.map(inv=>`<tr><th>${esc(inv.recipient_email)}</th><td>${esc(state(inv))}</td><td>${esc(when(inv.expires_at))}</td>
        <td>${state(inv)==='Pending'?`<button type="button" class="secondary" data-revoke-invite="${esc(inv.id)}">Revoke</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="4">No invitations yet.</td></tr>'}</tbody></table></div>
    <h2>Access audit</h2><div class="scroll"><table><thead><tr><th>When</th><th>Event</th><th>Recipient</th><th>Actor</th></tr></thead>
      <tbody>${audit.map(a=>`<tr><td>${esc(when(a.created_at))}</td><td>${esc(a.event_type)}</td><td>${esc(a.recipient_email||a.target_auth_user_id||'—')}</td><td>${esc(a.actor_auth_user_id)}</td></tr>`).join('')||'<tr><td colspan="4">No access events yet.</td></tr>'}</tbody></table></div>
    <p id="team-status" role="status"></p>
  </section>`;
  const status=root.querySelector('#team-status'),form=root.querySelector('#admin-invite-form'),result=root.querySelector('#admin-invite-result');
  form.onsubmit=async event=>{
    event.preventDefault();
    const button=form.querySelector('button'),email=String(new FormData(form).get('email')||'');
    button.disabled=true;status.textContent='';result.replaceChildren();
    try{
      const created=await request('/v1/admin/team/invitations',{email});
      const url='https://packone.pro/admin/#invite='+encodeURIComponent(created.token);
      result.innerHTML=`<div class="note"><strong>Invitation created for ${esc(created.invitation.email)}</strong><p>Expires ${esc(when(created.invitation.expires_at))}. Copy this link now; it cannot be recovered later.</p>
        <label>One-time invitation link<input id="admin-invite-link" readonly value="${esc(url)}"></label>
        <button type="button" id="admin-copy-invite">Copy invitation link</button></div>`;
      result.querySelector('#admin-copy-invite').onclick=async()=>{
        try{await navigator.clipboard.writeText(url);status.textContent='Invitation link copied.';}
        catch{status.textContent='Select and copy the link manually.';}
      };
      form.reset();
      status.textContent='Invitation created. No email was sent.';
    }catch(error){status.textContent=error?.message||'Invitation could not be created.';}
    finally{button.disabled=false;}
  };
  root.querySelectorAll('[data-revoke-invite]').forEach(button=>button.onclick=async()=>{
    if(!confirm('Revoke this pending invitation?'))return;
    button.disabled=true;
    try{await request('/v1/admin/team/invitations/'+encodeURIComponent(button.dataset.revokeInvite)+'/revoke',{});await renderAdminTeam(root,request);}
    catch(error){status.textContent=error?.message||'Revocation failed.';button.disabled=false;}
  });
  root.querySelectorAll('[data-revoke-member]').forEach(button=>button.onclick=async()=>{
    if(!confirm('Revoke administrator access for '+button.dataset.email+'?'))return;
    button.disabled=true;
    try{await request('/v1/admin/team/members/'+encodeURIComponent(button.dataset.revokeMember)+'/revoke',{});await renderAdminTeam(root,request);}
    catch(error){status.textContent=error?.message||'Access revocation failed.';button.disabled=false;}
  });
}
