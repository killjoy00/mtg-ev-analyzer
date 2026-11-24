import {renderLab} from './lab.mjs?v=2';
import {renderResultsEmailCampaigns} from './results-email-campaigns.mjs?v=1';
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const fmt=value=>value==null||!Number.isFinite(Number(value))?'Unavailable':Number(value).toLocaleString();

export async function renderPublishing(root,request,growthRequest,{owner=false}={}){
  root.innerHTML='<section class="admin-publishing">'+
    '<header class="subpage-heading"><h1>Publishing</h1><p class="muted">Email, creator runs and scheduled posts.</p></header>'+
    '<section class="subpage-section"><h2>Posting status</h2><p class="subpage-help">A completed job does not prove the post appeared. Check the published link or independent verification.</p>'+
      '<div class="admin-shortcuts">'+
      '<a href="?area=creator-challenges"><strong>Creator challenges</strong><small>Publish a run and check attempts</small></a>'+
      (owner?'<a href="?area=patreon"><strong>Patreon</strong><small>Connection and public-post checks</small></a>':'')+
      '<a href="https://github.com/killjoy00/mtg-ev-analyzer/actions/workflows/daily-social-post.yml" target="_blank" rel="noopener noreferrer"><strong>Daily social posts</strong><small>View posting jobs for Bluesky, Discord and other channels</small></a>'+
      '</div><div id="publishing-creators">Loading creator publication status…</div></section>'+
    (owner?'<section id="pack-one-lab" class="subpage-section"></section><section class="subpage-section"><h2>Email subscriptions</h2><div id="publishing-optins">Loading preferences…</div><p class="subpage-help">These show saved email choices, not guaranteed recipients. Delivery eligibility is shown below.</p></section>'+
      '<section class="subpage-section" id="publishing-emails"><div id="publishing-email-controls">Loading email controls…</div></section>':'')+
    '</section>';
  const jobs=[
    request('/v1/admin/creator-challenges?limit=100').then(data=>{
      const mount=root.querySelector('#publishing-creators');
      if(!root.isConnected||!mount)return;
      const values=data?.challenges;
      if(!Array.isArray(values))throw Error('Unavailable');
      const failed=values.filter(x=>x.status==='failed'||x.status==='retired'&&x.publication_detail?.live_verified!==true).length;
      const publishing=values.filter(x=>x.status==='publishing').length;
      const published=values.filter(x=>x.status==='published').length;
      mount.innerHTML='<p><strong>'+fmt(published)+'</strong> published · <strong>'+fmt(publishing)+'</strong> publishing · <strong>'+fmt(failed)+'</strong> failures or unverified removals <small>(latest 100)</small></p>';
    }).catch(()=>{const mount=root.querySelector('#publishing-creators');if(mount)mount.textContent='Creator status is unavailable.';})
  ];
  if(owner){
    jobs.push(renderLab(root.querySelector('#pack-one-lab'),request));
    jobs.push(growthRequest('/v1/admin/results').then(data=>{
      if(!root.isConnected)return;
      const counts=data?.counts||{},mount=root.querySelector('#publishing-optins');
      if(mount)mount.innerHTML='<div class="cards">'+
        '<div class="card"><span>Pack One news on</span><strong>'+fmt(counts.news_on)+'</strong></div>'+
        '<div class="card"><span>News off</span><strong>'+fmt(counts.news_off)+'</strong></div>'+
        '<div class="card"><span>Weekly results on</span><strong>'+fmt(counts.on)+'</strong></div>'+
        '<div class="card"><span>Weekly results off</span><strong>'+fmt(counts.off)+'</strong></div></div>';
    }).catch(()=>{const mount=root.querySelector('#publishing-optins');if(mount)mount.textContent='Email preference counts are unavailable.';}));
    jobs.push(renderResultsEmailCampaigns(root.querySelector('#publishing-email-controls'),{owner:true,growthRequest}));
  }
  await Promise.allSettled(jobs);
  if(owner&&new URLSearchParams(location.search).get('kind')==='lab')root.querySelector('#pack-one-lab')?.scrollIntoView({block:'start'});
}
