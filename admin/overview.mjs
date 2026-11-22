import {gameDateKey} from '../game-date.mjs';

const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const number=value=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?null:Number(value);
const count=value=>number(value)===null?'Unavailable':number(value).toLocaleString();
const percent=value=>number(value)===null?'Not enough data':`${number(value).toLocaleString(undefined,{maximumFractionDigits:1})}%`;
const yes=value=>value===true||value==='t';

export const ADMIN_AREAS=Object.freeze({
  insights:'Puzzle Performance',reports:'Player Feedback',corpus:'Sets & Data',users:'Users',
  players:'Players & Retention',growth:'Marketing & Growth',publishing:'Publishing',
  'campaign-links':'Campaign Links','creator-challenges':'Creator Challenges','puzzle-review':'Puzzle Review',team:'Settings',
  patreon:'Patreon Publishing',
});
export function adminArea(search='') {
  const area=new URLSearchParams(search).get('area');
  return Object.hasOwn(ADMIN_AREAS,area)?area:'overview';
}
export function overviewWindow(now=new Date()) {
  const day=gameDateKey(now),start=new Date(day+'T12:00:00Z');
  start.setUTCDate(start.getUTCDate()-29);
  return {day,from:start.toISOString().slice(0,10)};
}
export function cohortRate(rows,prefix) {
  if(!Array.isArray(rows))return {rate:null,returned:null,mature:null};
  let returned=0,mature=0;
  for(const row of rows) {
    const n=number(row[prefix+'_returned']),d=number(row[prefix+'_mature']);
    if(n===null||d===null||n<0||d<0||n>d)return {rate:null,returned:null,mature:null};
    returned+=n;mature+=d;
  }
  return {rate:mature?100*returned/mature:null,returned,mature};
}
export function servingSummary(status) {
  if(status?.ready===true&&status?.current===true)return {text:'Serving verified',kind:'ready'};
  if(status?.current===false)return {text:'Current serving readiness not confirmed',kind:'unknown'};
  if(['failed','retry_wait'].includes(status?.state))return {text:'Serving readiness needs attention',kind:'warning'};
  if(['submitting','queued','warming','verifying'].includes(status?.state))return {text:'Serving verification in progress',kind:'pending'};
  return {text:'Serving readiness not confirmed',kind:'unknown'};
}
const metric=(label,value,href,note='')=>`<a class="overview-metric" href="${href}"><span>${escape(label)}</span><strong>${escape(value)}</strong>${note?`<small>${escape(note)}</small>`:''}</a>`;
const tool=(area,description)=>`<a class="overview-tool" href="?area=${area}" aria-label="${escape(ADMIN_AREAS[area])}"${area==='team'?' id="admin-team-link"':''}><h3>${escape(ADMIN_AREAS[area])}<span aria-hidden="true">&#8594;</span></h3><p>${escape(description)}</p></a>`;
const loading=label=>`<p class="muted" role="status">Loading ${label}...</p>`;


export function trendChange(current,previous){
  if(current==null||previous==null)return 'Unavailable';
  const now=Number(current),before=Number(previous);
  if(!Number.isFinite(now)||!Number.isFinite(before))return 'Unavailable';
  if(before===0)return now===0?'No change':'New activity';
  const delta=100*(now-before)/before;
  return (delta>0?'+':'')+delta.toFixed(1)+'%';
}
const trendRow=(name,key,current,previous,{ratio=false}={})=>{
  const curr=ratio?(Number(current.answers)>0?100*Number(current.trophy_matches)/Number(current.answers):null):Number(current[key]??0);
  const prev=ratio?(Number(previous.answers)>0?100*Number(previous.trophy_matches)/Number(previous.answers):null):Number(previous[key]??0);
  const change=ratio&&curr!=null&&prev!=null?((curr-prev)>=0?'+':'')+(curr-prev).toFixed(1)+' pp':trendChange(curr,prev);
  return '<tr><th>'+escape(name)+'</th><td>'+escape(ratio?percent(curr):count(curr))+'</td><td>'+escape(ratio?percent(prev):count(prev))+'</td><td>'+escape(change)+'</td></tr>';
};
export function trendsMarkup(data){
  const weekly=data?.weekly||[],current=weekly.find(x=>x.label==='current'),previous=weekly.find(x=>x.label==='previous');
  if(!current||!previous)return '<p class="muted">Weekly activity is unavailable.</p>';
  const days=(data.daily||[]).slice().sort((a,b)=>String(a.label).localeCompare(String(b.label)));
  const max=Math.max(1,...days.map(x=>Number(x.daily_players)||0));
  const bars='<div class="overview-trend-bars" role="img" aria-label="Players who completed a Daily, last 14 Pacific dates">'+
    days.map(x=>'<span title="'+escape(x.label)+': '+escape(count(x.daily_players))+' Daily players" style="height:'+Math.max(3,Math.round(100*(Number(x.daily_players)||0)/max))+'%"></span>').join('')+'</div>';
  const labels='<div class="overview-chart-labels"><span>'+escape(days[0]?.label||'')+'</span><span>'+escape(days[days.length-1]?.label||'')+'</span></div>';
  const diff=trendChange(current.daily_players,previous.daily_players);
  const summary='<div class="overview-metrics">'+
    metric('Daily players · 7 days',count(current.daily_players),'?area=players',diff+' vs previous week')+
    metric('Completed Dailies · 7 days',count(current.daily_completions),'?area=players',trendChange(current.daily_completions,previous.daily_completions)+' vs previous week')+
    metric('New accounts · 7 days',count(current.new_accounts),'?area=users',trendChange(current.new_accounts,previous.new_accounts)+' vs previous week')+
    '</div>';
  return summary+bars+labels+
    '<details class="admin-method"><summary>Weekly breakdown and definitions</summary>'+
    '<p class="subpage-help">The last seven Pacific dates versus the seven before. Each player counts once per week. A trophy match means agreeing with the trophy drafter, not necessarily making the best pick.</p>'+
    '<div class="scroll"><table><thead><tr><th>Metric</th><th>Latest 7 days</th><th>Previous 7</th><th>Change</th></tr></thead><tbody>'+
    [['Players who viewed a pick','observed_players'],['Completed runs','completed_runs'],['Daily players','daily_players'],['Completed Dailies','daily_completions'],['New accounts','new_accounts']].map(([name,key])=>trendRow(name,key,current,previous)).join('')+
    trendRow('Matched trophy drafter','',current,previous,{ratio:true})+'</tbody></table></div></details>';
}
export function healthMarkup(data,serviceRelease=null){
 const day=data?.day||'unknown',daily=data?.dailies||[],cache=data?.serving||{},attention=data?.attention||{};
 const check=(name,ok,detail,href)=>'<li><span class="overview-status '+(ok===true?'ready':ok===false?'warning':'unknown')+'">'+escape(ok===true?'Pass':ok===false?'Needs attention':'Unknown')+'</span> <strong>'+escape(name)+'</strong> · '+escape(detail)+(href?' · <a href="'+href+'">Inspect</a>':'')+'</li>';
 const links=daily.map(x=>check('Daily: '+(x.environment==='mixed'?'Regular':x.environment==='latest'?'Latest Set':'Powered Cube'),x.scheduled===true||x.scheduled==='t',x.scheduled?'Eight-pick schedule present':'Schedule missing','/?game=draft-run&daily=1'+(x.environment==='mixed'?'':'&set='+encodeURIComponent(x.environment==='latest'?'latest':'powered-cube'))));
 const bad=Number(attention.urgent_reports||0),failed=Number(attention.failed_publications||0);
 const versions=serviceRelease?
   check('Admin release',serviceRelease.frontendVersion===serviceRelease.backendVersion&&
     (serviceRelease.gatewayVersion===serviceRelease.frontendVersion||serviceRelease.gatewayVersion==null),
     'UI/API contract v'+String(serviceRelease.frontendVersion)+' / v'+String(serviceRelease.backendVersion)+
     ' · backend revision '+String(serviceRelease.releaseCommit||'unavailable').slice(0,12),''):
   '';

 return '<p class="muted">Checks for '+escape(day)+' (Pacific). A successful API response does not mean the site was monitored all day.</p><ul class="overview-health-checks">'+
 check('Admin API',true,'Authorized endpoint responded','')+versions+
 check('Serving cache',cache.cache_current===true||cache.cache_current==='t','Revision '+(cache.revision??'unavailable'),'?area=corpus')+
 links.join('')+
 [check('Creator publications',failed===0,failed+' failed or unverified retirements','?area=creator-challenges'),check('Critical player reports',bad===0,bad+' open broken-puzzle reports','?area=reports')].join('')+'</ul>';
}
export function overviewMarkup({role='admin',now=new Date()}={}) {
  const {day,from}=overviewWindow(now);
  return '<section class="admin-overview" id="admin-overview">'+
    '<header class="overview-heading"><div><h1>Overview</h1><p>How Pack One is doing, and what needs a look.</p></div><button type="button" class="secondary" id="overview-refresh">Refresh overview</button></header>'+
    '<section aria-labelledby="overview-retention-heading" class="overview-priority"><div class="overview-section-heading"><h2 id="overview-retention-heading">Are players coming back?</h2><span class="overview-date-note">First Daily completed: '+escape(from)+' to '+escape(day)+'</span></div><div id="overview-retention">'+loading('return rates')+'</div><p><a href="?area=players">Explore Players &amp; Retention</a></p></section>'+
    '<section aria-labelledby="overview-trends-heading" class="overview-panel"><h2 id="overview-trends-heading">This week vs last week</h2><div id="overview-trends">'+loading('player trends')+'</div></section>'+
    '<section aria-labelledby="overview-campaigns-heading" class="overview-panel"><div class="overview-section-heading"><h2 id="overview-campaigns-heading">Where players came from</h2><a href="?area=growth">Marketing &amp; Growth</a></div><div id="overview-campaigns">'+loading('campaign results')+'</div></section>'+
    '<section aria-labelledby="overview-attention-heading"><h2 id="overview-attention-heading">Needs attention</h2><div class="overview-attention-grid">'+
      '<article class="overview-panel"><h3>Player reports</h3><div id="overview-reports">'+loading('reports')+'</div><a href="?area=reports" id="admin-reports-link">Review reports</a></article>'+
      '<article class="overview-panel"><h3>Game data</h3><div id="overview-operations">'+loading('set status')+'</div><a href="?area=corpus">Open Sets &amp; Data</a></article>'+
      '<article class="overview-panel"><h3>Publishing</h3><div id="overview-creators">'+loading('publication status')+'</div><a href="?area=publishing">Open Publishing</a></article>'+
    '</div></section>'+
    '<details class="overview-more"><summary>Site checks and technical details</summary>'+
      '<section aria-labelledby="overview-health-heading" class="overview-panel"><h2 id="overview-health-heading">Site health</h2><div id="overview-health">'+loading('site checks')+'</div></section>'+
      '<section aria-labelledby="overview-today-heading" class="overview-panel"><h2 id="overview-today-heading">Today at a glance</h2><time datetime="'+day+'">'+day+' · Pacific</time><div id="overview-activity">'+loading('today activity')+'</div></section>'+
      '<section aria-labelledby="overview-accounts-heading" class="overview-panel"><h2 id="overview-accounts-heading">Account totals</h2><div id="overview-accounts">'+loading('accounts')+'</div><a href="?area=users">Open Users</a></section>'+
      '<section aria-labelledby="overview-dailies-heading" class="overview-panel"><h2 id="overview-dailies-heading">Current Dailies</h2><div class="overview-dailies"><a href="/?game=draft-run&daily=1">Regular Daily</a><a href="/?game=draft-run&set=powered-cube&daily=1">Powered Cube</a><a href="/?game=draft-run&set=latest&daily=1">Latest Set</a></div></section>'+
    '</details>'+
    '<details class="overview-more"><summary>Other admin tools</summary><div class="overview-tools">'+
      tool('insights','Check difficulty, scoring and puzzle quality.')+
      tool('users','Search accounts, public usernames and access.')+
      tool('campaign-links','Create and reuse tracked links.')+
      tool('creator-challenges','Publish and review creator runs.')+
      (role==='owner'?tool('patreon','Check Patreon connection and post verification.'):'')+
      tool('puzzle-review','Earlier selection research and manual review history.')+
      (role==='owner'?tool('team','Administrator access and audit history.'):'')+
    '</div></details>'+
    '<p class="overview-footnote">Reports use Pacific game dates. Unavailable values are not zero. Select a section for full definitions.</p>'+
  '</section>';
}

// Read-only composition of existing endpoints. Never fetch Team membership or
// publish, activate, retry, or moderate anything from the dashboard.
export async function renderOverview(root,request,{role='admin',isCurrent=()=>true,onRefresh,now=new Date(),serviceRelease=null}={}) {
  root.innerHTML=overviewMarkup({role,now});
  const overview=root.querySelector('#admin-overview');
  const active=()=>isCurrent()&&root.querySelector('#admin-overview')===overview;
  const refresh=root.querySelector('#overview-refresh');
  refresh.onclick=()=>{if(active())onRefresh?.();};
  const {day,from}=overviewWindow(now);
  const today=new URLSearchParams({from:day,to:day});
  const recent=new URLSearchParams({from,to:day});
  const section=async(id,path,render,{optional=false}={})=>{
    const target=root.querySelector('#'+id);
    try {
      const data=await request(path);
      if(active())target.innerHTML=render(data);
    } catch(error) {
      if(!active())return;
      if(!optional&&(error?.status===401||error?.status===403))throw error;
      target.innerHTML='<p class="overview-status unknown" role="status">Temporarily unavailable. Refresh or open the full section.</p>';
    }
  };
  await Promise.all([
    section('overview-trends','/v1/admin/overview/trends',trendsMarkup,{optional:true}),
    section('overview-health','/v1/admin/overview/health',data=>healthMarkup(data,serviceRelease),{optional:true}),
    section('overview-campaigns','/v1/admin/campaign-performance?'+recent,data=>{
      const rows=data?.rows;
      if(!Array.isArray(rows))throw Error('Missing campaign summary');
      const top=rows.filter(row=>Number(row.daily_completions)>0).sort((a,b)=>Number(b.daily_completions)-Number(a.daily_completions)).slice(0,5);
      return top.length?'<div class="scroll"><table><thead><tr><th>Source / campaign</th><th>Daily completions</th></tr></thead><tbody>'+
        top.map(row=>'<tr><th>'+escape(String(row.source||'direct')+(row.campaign&&row.campaign!=='(none)'?' / '+row.campaign:''))+'</th><td>'+count(row.daily_completions)+'</td></tr>').join('')+
        '</tbody></table></div><p class="subpage-help">Dailies credited to each player's first recorded promotion. This does not show how many visitors became players.</p>':
        '<p>No Dailies credited to tracked promotions in the last 30 days.</p>';
    },{optional:true}),
    section('overview-activity','/v1/admin/measurements?'+today+'&corpus=all',data=>{
      if(!data.summary)throw Error('Missing activity summary');
      const s=data.summary,f=data.share_funnel||{},href='?area=insights&'+today;
      return `<div class="overview-metrics">${metric('Observed players',count(s.players),href,'Viewed at least one draft decision')}${metric('Completed / observed runs',`${count(s.completed_runs)} / ${count(s.runs)}`,href)}${metric('Share-link arrivals',count(f.arrivals),href,'Best-effort client analytics')}${metric('Share arrival to Daily start',percent(f.start_pct),href,`${count(f.starts)} attributed starts`)}</div><p class="overview-footnote">Today\'s first-encounter decision viewers on every corpus version, with QA excluded, including unfinished runs. These are neither site visitors nor the Users page\'s completed-run players: identity grouping and Daily date attribution also differ. Do not subtract the counts to estimate abandonment. Open Insights for detailed filters or Users for completed-run activity.</p>`;
    }),
    section('overview-reports','/v1/admin/player-reports/summary',data=>{
      const d=data.summary?.decisions,p=data.summary?.profiles;
      if(!d||!p||number(d.open)===null||number(p.open)===null)throw Error('Missing report summary');
      const total=number(d.open)+number(p.open),broken=number(d.broken_open);
      return `<p class="overview-status ${total?'warning':'ready'}">${count(total)} open reports</p><p>${count(d.open)} decision reports &middot; <a href="?area=reports&kind=profiles">${count(p.open)} profile reports</a></p><p>${broken===null?'Urgent report count unavailable':`${count(broken)} marked something broken`}</p>`;
    }),
    section('overview-operations','/v1/admin/corpus',data=>{
      if(!Array.isArray(data.sets))throw Error('Missing corpus summary');
      const status=servingSummary(data.readiness),live=data.sets.filter(s=>s.status==='Live');
      const newest=live.filter(s=>yes(s.regular_run)&&s.release_date&&s.release_date<=day).sort((a,b)=>b.release_date.localeCompare(a.release_date)||a.set_id.localeCompare(b.set_id))[0];
      return `<p class="overview-status ${status.kind}">${escape(status.text)}</p><p>${count(live.length)} live ${live.length===1?'set':'sets'} &middot; ${count(data.sets.filter(s=>s.status==='Candidate').length)} candidates</p>${newest?`<p>Newest live set: <strong>${escape(newest.set_name||newest.set_id)}</strong></p>`:''}<p class="muted">Making a set Live does not change today's Dailies.</p>`;
    }),
    section('overview-creators','/v1/admin/creator-challenges?limit=100',data=>{
      if(!Array.isArray(data.challenges))throw Error('Missing creator summary');
      const challenges=data.challenges,failed=challenges.filter(c=>c.status==='failed'||c.status==='retired'&&c.publication_detail?.live_verified!==true).length;
      const pending=challenges.filter(c=>['draft','publishing'].includes(c.status)).length;
      return `<p class="overview-status ${failed?'warning':'ready'}">${failed?`${count(failed)} publication ${failed===1?'operation needs':'operations need'} attention`:'No failed publication operations'}</p><p>${count(challenges.filter(c=>c.status==='published').length)} published &middot; ${count(pending)} draft or publishing</p><p class="muted">Most recent 100 challenges.</p>`;
    }),
    section('overview-accounts','/v1/admin/users?summary_only=1',data=>{
      const s=data.summary;if(!s)throw Error('Missing account summary');
      return `<dl class="overview-facts"><dt>Accounts</dt><dd>${count(s.total)}</dd><dt>New in 30 days</dt><dd>${count(s.new_30d)}</dd><dt>Active in 30 days</dt><dd>${count(s.active_30d)}</dd><dt>Premium access</dt><dd>${count(s.paid)}</dd><dt>Username attention</dt><dd>${count(s.username_attention)}</dd></dl>`;
    }),
    section('overview-retention','/v1/admin/measurements/habits?'+recent,data=>{
      const rows=data.habit_metrics?.cohorts;if(!Array.isArray(rows))throw Error('Missing cohort summary');
      const first=rows.length&&rows.every(row=>number(row.cohort_people)!==null)?rows.reduce((sum,row)=>sum+number(row.cohort_people),0):null;
      const next=cohortRate(rows,'next_day'),seven=cohortRate(rows,'seven_day');
      return '<div class="overview-metrics">'+
        metric('First-time Daily players',first===null?'Unavailable':count(first),'?area=players','First completed Daily in 30 days')+
        metric('Next-day return',percent(next.rate),'?area=players',count(next.returned)+' / '+count(next.mature)+' eligible players')+
        metric('7-day return',percent(seven.rate),'?area=players',count(seven.returned)+' / '+count(seven.mature)+' eligible players')+
        '</div><details class="admin-method"><summary>How returns are counted</summary><p>Return rates count only players who have had enough time to come back. Linked accounts count as one person; guests count by browser. Test and admin play is excluded.</p></details>';
    }),
  ]);
}
