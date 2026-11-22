// Owner-facing launch status: uses existing corpus evidence and today's pinned
// Daily schedules. Never generates, selects, or reviews individual puzzles.
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const yes=value=>value===true||value==='t';
const n=value=>Number(value||0);
const card=(title,headline,detail)=>'<div class="card"><span>'+esc(title)+'</span><strong>'+esc(headline)+'</strong><small>'+esc(detail)+'</small></div>';

export function setLaunchSummary({set=null,corpus={},daily=null}={}){
 const loaded=Boolean(set&&(set.manifest||set.active_snapshot_id||['Candidate','Live','Paused'].includes(set.status)));
 const archive=set?.archive_available==null?null:yes(set.archive_available);
 const source=loaded?['Imported','Source data has been loaded into the corpus']:archive===true?
  ['Found','17Lands archive detected; a verified import is still needed']:archive===false?
  ['Waiting','Archive is not available yet']:['Not confirmed','No source import evidence for this set yet'];
 const verified=yes(set?.ready)&&yes(set?.health_current)?
  ['Passed','Current corpus quality check passed']:yes(set?.ready)?
  ['Previously passed','A fresh check is needed before a new activation']:set?.report?
  ['Blocked','Quality check has not passed']:['Not checked','No passing health report recorded'];
 const servingAvailable=corpus.serving_cache_current!==false&&n(set?.serving_count)>0;
 const servingReady=yes(corpus?.readiness?.ready)&&yes(corpus?.readiness?.current);
 const published=set?.status==='Live'&&servingAvailable&&servingReady?
  ['Live and serving','Current serving revision is verified']:set?.status==='Live'?
  ['Live; check serving','Set is Live, but current serving readiness is not verified']:set?.status==='Candidate'?
  ['Candidate','Verified set needs an explicit activation']:['Not live','This set is not available for new starts'];
 const environments=['latest','mixed','powered-cube'];
 const results=Object.fromEntries(environments.map(e=>{
  const s=daily?.schedules?.find(x=>x.environment===e);
  if(!s)return [e,{label:'Not scheduled',detail:'No pinned schedule for this Pacific date',ok:false}];
  if(n(s.picks)!==8||n(s.resolved)!==8)
   return [e,{label:'Check needed',detail:n(s.resolved)+' of '+n(s.picks)+' scheduled decisions resolve',ok:false}];
  if(e==='powered-cube')return [e,{label:'Ready',detail:'Eight pinned decisions; Cube is independent of the new set',ok:true}];
  if(e==='latest')
   return [e,n(s.setPicks)===8?{label:'Includes set',detail:'All eight pinned picks use this set',ok:true}:
     {label:'Other set pinned',detail:n(s.setPicks)+' of eight picks use this set',ok:false}];
  return [e,n(s.setPicks)>=2?{label:'Includes set',detail:n(s.setPicks)+' of eight picks use this set',ok:true}:
    {label:'Not featured yet',detail:n(s.setPicks)+' of eight picks use this set; at least two expected after launch',ok:false}];
 }));
 return {source,verified,published,results,day:daily?.day||null,
  firstPublicDayReady:environments.every(e=>results[e].ok)&&published[0]==='Live and serving'};
}

export function setLaunchMarkup({setId,setName,corpus,daily}={}){
 const target=(corpus?.sets||[]).find(x=>x.set_id===setId)||null;
 const v=setLaunchSummary({set:target,corpus,daily});
 return '<div class="cards">'+
   card('Source data',v.source[0],v.source[1])+
   card('Quality checks',v.verified[0],v.verified[1])+
   card('Live serving',v.published[0],v.published[1])+
   card('First public Daily',v.firstPublicDayReady?'Ready':'Not yet confirmed',
     v.firstPublicDayReady?'Latest, Mixed, and Cube are all pinned correctly':'Check the three pinned schedules below')+'</div>'+
  '<h3>Current Pacific Dailies'+(v.day?' — '+esc(v.day):'')+'</h3>'+
  '<div class="cards">'+
   card('Latest Set Daily',v.results.latest.label,v.results.latest.detail)+
   card('Regular Daily',v.results.mixed.label,v.results.mixed.detail)+
   card('Powered Cube Daily',v.results['powered-cube'].label,v.results['powered-cube'].detail)+'</div>'+
  '<p class="subpage-help">A set activated during the day does not change already pinned puzzles. The next Daily is generated shortly after Pacific midnight. Cube has its own puzzles and does not need to contain '+esc(setName||setId)+'.</p>'+
  '<details class="admin-method"><summary>What this check does and does not prove</summary>'+
    '<p>This reads set import records, quality status, the current serving revision and saved Daily schedules. It checks that all eight scheduled decisions still exist. It does not import data, choose new puzzles, change a Daily, review cards, or prove that an external workflow or store listing was published. The regular Daily should include at least two picks from the new set on its first public day.</p>'+
    (target?.last_error?'<p>Latest import error: '+esc(target.last_error)+'</p>':'')+
    '</details>';
}

export async function renderSetLaunchStatus(root,request,corpus){
 if(!root)return;
 let names={};
 try {
  const response=await fetch(new URL('../data/set-display-names.json',import.meta.url));
  if(response.ok)names=(await response.json())?.names||{};
 }catch{} // The ordinary Sets & Data page must keep working offline.
 const registered=Object.entries(names).filter(([id])=>id!=='powered-cube'&&/^[a-z0-9-]{2,40}$/.test(id));
 const fallback=(corpus.sets||[]).filter(s=>s.set_id!=='powered-cube').sort((a,b)=>String(b.release_date||'').localeCompare(String(a.release_date||'')))[0];
 const options=registered.length?registered:((corpus.sets||[]).filter(s=>s.set_id!=='powered-cube').map(s=>[s.set_id,s.set_name||s.set_id]));
 const preferred=registered.at(-1)?.[0]||fallback?.set_id;
 const override=new URLSearchParams(location.search).get('launchSet');
 const chosen=options.some(([id])=>id===override)?override:preferred;
 root.innerHTML='<div class="filters admin-report-filters"><label>Set <select id="launch-set-choice">'+
   options.slice().reverse().map(([id,label])=>'<option value="'+esc(id)+'"'+(id===chosen?' selected':'')+'>'+esc(label)+' ('+esc(id.toUpperCase())+')</option>').join('')+
   '</select></label><button type="button" class="secondary" id="launch-set-refresh">Refresh</button></div>'+
   '<div id="launch-set-status" role="status">Checking set status…</div>';
 let generation=0;
 const load=async()=>{
  const serial=++generation,id=root.querySelector('#launch-set-choice')?.value,panel=root.querySelector('#launch-set-status');
  if(!id){panel.textContent='No draft sets registered.';return;}
  panel.textContent='Checking set status…';
  try{
   const data=await request('/v1/admin/corpus/launch-dailies?'+new URLSearchParams({set:id}));
   if(serial!==generation||!root.isConnected)return;
   const name=names[id]||(corpus.sets||[]).find(x=>x.set_id===id)?.set_name||id.toUpperCase();
   panel.innerHTML=setLaunchMarkup({setId:id,setName:name,corpus,daily:data});
  }catch{
   if(serial===generation&&root.isConnected)panel.textContent='Daily launch status is unavailable. Existing set details below still work.';
  }
 };
 root.querySelector('#launch-set-choice').onchange=()=>void load();
 root.querySelector('#launch-set-refresh').onclick=()=>void load();
 void load();
}
