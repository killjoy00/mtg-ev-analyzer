// Owner-only Patreon operations view. GitHub's public workflow metadata contains
// no credentials. Never accept Patreon passwords, cookies or tokens in this UI.
const REPO='killjoy00/mtg-ev-analyzer';
const RUNS='https://api.github.com/repos/'+REPO+'/actions/workflows/patreon-desktop-feed.yml/runs?per_page=15';
const CONNECTION_RUNS='https://api.github.com/repos/'+REPO+'/actions/workflows/patreon-publishing.yml/runs?branch=main&per_page=5';
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function summarizePatreonRuns(runs=[]) {
 const relevant=runs.filter(r=>r.head_branch==='main'&&['schedule','workflow_dispatch','repository_dispatch','push'].includes(r.event));
 return relevant.slice(0,5).map(r=>({id:r.id,when:r.created_at,status:r.conclusion||r.status,url:r.html_url}));
}
export function summarizePatreonConnection(jobs=[]) {
 const connection=jobs.find(j=>j.name==='connection');
 const publish=jobs.find(j=>j.name==='canary-publish');
 const status=job=>job?(job.conclusion||job.status||'unknown'):'not run';
 return {connection:status(connection),publication:status(publish),
  verified:publish?.conclusion==='success'&&publish.steps?.some(s=>
   s.name==='Publish and independently verify Patreon'&&s.conclusion==='success')===true};
}
export async function renderPatreonPublishing(root,{fetchImpl=fetch}={}) {
 root.innerHTML=`<section class="subpage-section" aria-labelledby="patreon-title">
 <h1 id="patreon-title">Patreon</h1>
 <p class="subpage-help">Check whether Patreon actually received the post. A successful job alone is not proof.</p>
 <h2>Latest Patreon check</h2>
 <details><summary>If posting stops working</summary>
 <p>Check the connection and posting verification here. This page never asks for your Patreon password.</p>
 <p><a href="https://github.com/killjoy00/mtg-ev-analyzer/actions/workflows/patreon-publishing.yml" target="_blank" rel="noopener noreferrer">Open Patreon publishing workflow</a></p>
 </details>
 <div id="patreon-connection-status" role="status" aria-live="polite">Checking the latest connection test…</div>
 <h2>Posting history</h2>
 <p>A post counts as published only when the public page was checked.</p>
 <p class="subpage-help">If posting stops, check the connection above and the recent jobs below.</p>
 <div class="actions"><button type="button" class="secondary" id="patreon-refresh">Refresh workflow history</button>
 <a href="https://github.com/${REPO}/pull/1367" target="_blank" rel="noopener noreferrer">Review publisher implementation</a></div>
 <h2>Recent posting jobs</h2><div id="patreon-runs" role="status" aria-live="polite">Checking GitHub workflow history…</div>
 <p class="subpage-help">These jobs prepare or refresh Pick of the Week on Wednesday and Thursday. Only a verified public post confirms publication.</p>
 </section>`;
 const panel=root.querySelector('#patreon-runs'),refresh=root.querySelector('#patreon-refresh');
 const connectionPanel=root.querySelector('#patreon-connection-status');
 const load=async()=>{
  refresh.disabled=true;panel.textContent='Checking GitHub workflow history…';
  const json=async url=>{
   const r=await fetchImpl(url,{headers:{accept:'application/vnd.github+json'},cache:'no-store',signal:AbortSignal.timeout(12000)});
   if(!r.ok)throw Error('GitHub status unavailable.');
   return r.json();
  };
  const connectionCheck=(async()=>{
   try {
    const data=await json(CONNECTION_RUNS);
    const run=data.workflow_runs?.find(r=>r.head_branch==='main'&&
     ['push','workflow_dispatch'].includes(r.event)&&Number.isSafeInteger(r.id));
    if(!run){connectionPanel.textContent='No connection check has run yet.';return;}
    const jobs=await json('https://api.github.com/repos/'+REPO+'/actions/runs/'+run.id+'/jobs?per_page=100');
    const status=summarizePatreonConnection(jobs.jobs||[]);
    connectionPanel.textContent='Connection check: '+status.connection+'. Post check: '+status.publication+'. '+
     (status.verified?'Public image and text independently verified in the latest check.':'No public post was independently verified by this check. That does not prove publication failed.');
   } catch {connectionPanel.textContent='Could not check Patreon. Open the publishing job for details.';}
  })();
  try{
   const response=await fetchImpl(RUNS,{headers:{accept:'application/vnd.github+json'},cache:'no-store',signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error('GitHub workflow history unavailable ('+response.status+').');
   const data=await response.json();if(!Array.isArray(data.workflow_runs))throw Error('Unexpected GitHub response.');
   const rows=summarizePatreonRuns(data.workflow_runs);
   panel.innerHTML=rows.length?'<ul>'+rows.map(r=>'<li><a href="'+esc(r.url)+'" target="_blank" rel="noopener noreferrer">'+esc(new Date(r.when).toLocaleString())+'</a> — '+esc(r.status)+'</li>').join('')+'</ul>':'No recent main-branch weekly pick runs were found.';
  }catch(error){panel.textContent='Could not load workflow history. '+String(error?.message||'Try again.');}
  finally{await connectionCheck;refresh.disabled=false;}
 };
 refresh.onclick=()=>void load();
 await load();
}
