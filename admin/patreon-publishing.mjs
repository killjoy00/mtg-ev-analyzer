// Owner-only Patreon operations view. GitHub's public workflow metadata contains
// no credentials. Never accept Patreon passwords, cookies or tokens in this UI.
const REPO='killjoy00/mtg-ev-analyzer';
const RUNS='https://api.github.com/repos/'+REPO+'/actions/workflows/daily-social-post.yml/runs?per_page=15';
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function summarizePatreonRuns(runs=[]) {
 const relevant=runs.filter(r=>r.head_branch==='main'&&['schedule','workflow_dispatch','repository_dispatch','push'].includes(r.event));
 return relevant.slice(0,5).map(r=>({id:r.id,when:r.created_at,status:r.conclusion||r.status,url:r.html_url}));
}
export async function renderPatreonPublishing(root,{fetchImpl=fetch}={}) {
 root.innerHTML=`<section class="subpage-section" aria-labelledby="patreon-title">
 <h1 id="patreon-title">Patreon publishing</h1>
 <p class="subpage-help">Daily featured picks. The real trophy pick must be one of the displayed choices.</p>
 <h2>Patreon connection</h2>
 <p role="status"><strong>Not configured through Pack One</strong></p>
 <p>A secure, owner-authorized connection service is not deployed. Patreon does not offer a supported API for publishing these posts, so browser-based publication still needs an authenticated session. This admin page never requests your password or cookies.</p>
 <h2>Publishing</h2>
 <p role="status"><strong>Not activated</strong> — this admin page cannot turn on publication. The proposed publisher remains in an unmerged pull request.</p>
 <p>When verified, the existing morning job will post the image and text, verify public visibility, and prevent duplicates. No posts are initiated by opening this page.</p>
 <div class="actions"><button type="button" class="secondary" id="patreon-refresh">Refresh workflow history</button>
 <a href="https://github.com/${REPO}/pull/1367" target="_blank" rel="noopener noreferrer">Review implementation</a></div>
 <h2>Recent morning workflows</h2><div id="patreon-runs" role="status" aria-live="polite">Checking GitHub workflow history…</div>
 <p class="subpage-help">These are overall morning workflow runs, <strong>not</strong> proof of Patreon publication. Patreon publication requires a separately verified job and public post.</p>
 </section>`;
 const panel=root.querySelector('#patreon-runs'),refresh=root.querySelector('#patreon-refresh');
 const load=async()=>{
  refresh.disabled=true;panel.textContent='Checking GitHub workflow history…';
  try{
   const response=await fetchImpl(RUNS,{headers:{accept:'application/vnd.github+json'},cache:'no-store',signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error('GitHub workflow history unavailable ('+response.status+').');
   const data=await response.json();if(!Array.isArray(data.workflow_runs))throw Error('Unexpected GitHub response.');
   const rows=summarizePatreonRuns(data.workflow_runs);
   panel.innerHTML=rows.length?'<ul>'+rows.map(r=>'<li><a href="'+esc(r.url)+'" target="_blank" rel="noopener noreferrer">'+esc(new Date(r.when).toLocaleString())+'</a> — '+esc(r.status)+'</li>').join('')+'</ul>':'No recent main-branch morning runs were found.';
  }catch(error){panel.textContent='Could not load workflow history. '+String(error?.message||'Try again.');}
  finally{refresh.disabled=false;}
 };
 refresh.onclick=()=>void load();
 await load();
}
