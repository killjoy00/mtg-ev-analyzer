const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export async function renderResultsEmailCampaigns(mount,{owner=false,growthRequest}={}){
 if(!mount||!owner)return;
 try{
  const value=await growthRequest('/v1/admin/results-campaigns');if(!mount.isConnected)return;
  mount.innerHTML='<h2>Results and news emails</h2><p>'+esc(value.active?'Weekly personal results are active. Pack One news (new sets, new features, events and occasional offers) sends only after you preview and approve a campaign.':value.ready?'Send yourself a delivery check to finish setup. It requires Pack One news to be on for your verified account.':'Email delivery is paused. You can prepare a draft while sender setup is completed.')+'</p>'+
   (value.ready?'<button type="button" data-email-check>Send me a test email</button> <button type="button" data-email-refresh>Refresh delivery status</button><p>A successful delivery event completes sender verification. This does not change your email preferences.</p>':'')+
   '<p>Weekly results arrive Monday at 10 a.m. Central for the previous week. Season results follow a completed season. Weekly results and news announcements use separate opt-ins. Daily reminders are also separate.</p><p>Approved campaigns enter the next delivery run, usually within ten minutes. Cancelling stops messages that have not been handed off.</p>'+
   '<form data-email-draft><label>Subject<input name="subject" maxlength="160" required></label><label>Message<textarea name="body" rows="7" maxlength="10000" required></textarea></label><p>Use this for Pack One news: new sets, new features, events and occasional offers, which is what subscribers agreed to. Do not include player names or individual results.</p><button type="submit">Save draft</button></form>'+
   '<div data-email-campaigns>'+value.campaigns.map(c=>'<article class="card" data-campaign="'+esc(c.id)+'"><h3>'+esc(c.subject)+'</h3><p>'+esc(c.kind)+' · '+esc(c.state)+'</p>'+
    (c.kind==='news'?'<p style="white-space:pre-wrap">'+esc(c.body)+'</p><p>The email also includes your configured sender address, postal footer, preference link and unsubscribe link.</p>':'')+
    '<p>'+Number(c.accepted||0)+' accepted · '+Number(c.delivered||0)+' delivered · '+Number(c.uncertain||0)+' unconfirmed · '+Number(c.failed||0)+' failed or suppressed</p>'+
    (c.kind==='news'&&c.state==='draft'?'<button type="button" data-approve="'+esc(c.id)+'" '+(!value.active?'disabled':'')+'>Send this campaign to opted-in accounts</button>':'')+
    (c.state!=='cancelled'?'<button type="button" data-cancel="'+esc(c.id)+'">Cancel campaign</button>':'')+'</article>').join('')+'</div><p role="status" aria-live="polite"></p>';
  const send=async payload=>{
   const buttons=[...mount.querySelectorAll('button')].map(button=>({button,disabled:button.disabled}));buttons.forEach(({button})=>button.disabled=true);
   try{const result=await growthRequest('/v1/admin/results-campaigns',payload,'POST');await renderResultsEmailCampaigns(mount,{owner,growthRequest});if(result.check&&mount.isConnected)mount.querySelector('[role="status"]').textContent=result.check.state==='accepted'?'Test email accepted. Refresh delivery status after the delivery confirmation arrives.':'This delivery check is already recorded or could not be confirmed. Check its status before requesting another.';}
   catch(error){if(mount.isConnected){mount.querySelector('[role="status"]').textContent=error.message||'Could not update the campaign.';buttons.forEach(({button,disabled})=>button.disabled=disabled);}}
  };
  mount.querySelector('form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.currentTarget);void send({action:'draft',subject:f.get('subject'),body:f.get('body')});};
  mount.querySelector('[data-email-check]')?.addEventListener('click',()=>void send({action:'check',id:crypto.randomUUID()}));
  mount.querySelector('[data-email-refresh]')?.addEventListener('click',()=>void renderResultsEmailCampaigns(mount,{owner,growthRequest}));
  mount.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>void send({action:'approve',id:b.dataset.approve,previewHash:value.campaigns.find(c=>c.id===b.dataset.approve).previewHash}));
  mount.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>void send({action:'cancel',id:b.dataset.cancel}));
 }catch{if(mount.isConnected)mount.innerHTML='<h2>Results and news emails</h2><p>Delivery controls are not available from this backend revision.</p>';}
}
