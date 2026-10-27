// Owner-only Patreon operations view. GitHub's public workflow metadata contains
// no credentials. Never accept Patreon passwords, cookies or tokens in this UI.
const REPO='killjoy00/mtg-ev-analyzer';
const RUNS='https://api.github.com/repos/'+REPO+'/actions/workflows/daily-social-post.yml/runs?per_page=15';
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
 <h1 id="patreon-title">Patreon publishing</h1>
 <p class="subpage-help">Daily featured picks. The real trophy pick must be one of the displayed choices.</p>
 <h2>Patreon connection</h2>
 <p role="status"><strong>Automatic publishing is blocked by Patreon browser security verification.</strong> A saved login has not passed a fresh-session check. Repeating sign-in is not a verified fix, and no live post has been confirmed.</p>
 <details><summary>Connection setup reference</summary>
 <p>Connect once using Browserless's secure saved-login screen. Your Patreon login stays there; this page never receives your password or cookies.</p>
 <ol>
 <li><a href="https://www.browserless.io/account/profiles" target="_blank" rel="noopener noreferrer">Connect Patreon in Browserless</a>. Sign in to your existing Browserless account, open <strong>Profiles</strong>, then <strong>New Profile</strong>.</li>
 <li>Name it <strong>packone-patreon</strong>, choose <strong>Sign in via remote browser</strong>, and enter <strong>https://www.patreon.com/</strong>. Tap <strong>Continue</strong>, then <strong>Open auth flow in new tab</strong>.</li>
 <li>Sign in to Patreon, switch to the <strong>Pack One creator</strong> profile, finish any verification, and tap <strong>Save profile</strong>. On Browserless Free the browser closes after two minutes; have your sign-in details ready.</li>
 <li>After the browser verification problem is resolved, the morning job can use the saved login. For an optional immediate test, <a href="https://github.com/${REPO}/actions/workflows/patreon-publishing.yml" target="_blank" rel="noopener noreferrer">verify Patreon publishing</a>: tap <strong>Run workflow</strong>, keep <strong>main</strong>, check <strong>publish_once</strong>, then tap the green <strong>Run workflow</strong>.</li>
 </ol>
 </details>
 <div id="patreon-connection-status" role="status" aria-live="polite">Checking the latest connection test…</div>
 <h2>Publishing</h2>
 <p>Automatic Patreon attempts are paused pending a verified reuse of the saved login and a real public post. Other morning destinations run independently. A connection check alone is not proof of publication.</p>
 <p>If Patreon expires the saved login, reconnect using the same profile name. An explicit repository pause still stops morning posts.</p>
 <div class="actions"><button type="button" class="secondary" id="patreon-refresh">Refresh workflow history</button>
 <a href="https://github.com/${REPO}/pull/1367" target="_blank" rel="noopener noreferrer">Review publisher implementation</a></div>
 <h2>Recent morning workflows</h2><div id="patreon-runs" role="status" aria-live="polite">Checking GitHub workflow history…</div>
 <p class="subpage-help">These are overall morning workflow runs, <strong>not</strong> proof of Patreon publication. Patreon publication requires a separately verified job and public post.</p>
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
    connectionPanel.textContent='Latest connection check: '+status.connection+
     '. Latest first-post test: '+status.publication+'.'+
     (status.verified?' Public image and text verified in this run.':'');
   } catch {connectionPanel.textContent='Could not check the Patreon connection. Open verify Patreon publishing for details.';}
  })();
  try{
   const response=await fetchImpl(RUNS,{headers:{accept:'application/vnd.github+json'},cache:'no-store',signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error('GitHub workflow history unavailable ('+response.status+').');
   const data=await response.json();if(!Array.isArray(data.workflow_runs))throw Error('Unexpected GitHub response.');
   const rows=summarizePatreonRuns(data.workflow_runs);
   panel.innerHTML=rows.length?'<ul>'+rows.map(r=>'<li><a href="'+esc(r.url)+'" target="_blank" rel="noopener noreferrer">'+esc(new Date(r.when).toLocaleString())+'</a> — '+esc(r.status)+'</li>').join('')+'</ul>':'No recent main-branch morning runs were found.';
  }catch(error){panel.textContent='Could not load workflow history. '+String(error?.message||'Try again.');}
  finally{await connectionCheck;refresh.disabled=false;}
 };
 refresh.onclick=()=>void load();
 await load();
}
