// Read-only player and retention report. All values come from the existing
// authorized measurement endpoints; identity and cohort rules are unchanged.
import {gameDateKey} from '../game-date.mjs';
import {habitsDetailsMarkup} from './habits-details.mjs';

const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const fmt=value=>value==null||!Number.isFinite(Number(value))?'Unavailable':Number(value).toLocaleString();
const pct=(numerator,denominator)=>denominator>0?(100*numerator/denominator).toFixed(1)+'%':'Not enough data';
const range=days=>{
  const to=gameDateKey(),start=new Date(to+'T12:00:00Z');
  start.setUTCDate(start.getUTCDate()-(days-1));
  return {from:start.toISOString().slice(0,10),to};
};
const countRows=(rows,key)=>rows.reduce((sum,row)=>sum+(Number(row[key])||0),0);
const returnStat=(rows,prefix)=>({
  returned:countRows(rows,prefix+'_returned'),
  mature:countRows(rows,prefix+'_mature')
});
const card=(title,value,note)=>'<div class="card"><span>'+esc(title)+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></div>';
const displaySource=row=>String(row.source||'Direct')+(row.campaign&&row.campaign!=='(none)'?' / '+row.campaign:'');

export async function renderPlayers(root,request){
  let generation=0;
  root.innerHTML='<section class="admin-players">'+
    '<header class="subpage-heading"><h1>Players &amp; Retention</h1><p class="muted">Who started playing, and who came back?</p></header>'+
    '<div class="filters admin-report-filters"><label>First Daily in <select id="players-days"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option></select></label><button type="button" class="secondary" id="players-refresh">Refresh</button></div>'+
    '<section class="subpage-section"><h2>First-time players and returns</h2><div id="players-cohorts" class="cards">Loading retention…</div>'+
      '<details class="admin-method"><summary>How are returns counted?</summary><p>First-time players completed their first-ever Daily during the selected dates. Next-day and seven-day rates count only people with a fully elapsed follow-up window. Signed-in browser identities are linked; guests count per browser. Test and admin players are excluded.</p></details></section>'+
    '<section class="subpage-section"><h2>This week vs last week</h2><div id="players-trends">Loading trends…</div></section>'+
    '<section class="subpage-section"><details class="admin-method" id="players-habit-details"><summary>More on Daily habits: rolling weeks and first-Daily cohorts</summary><div id="players-habit-history">Loading Daily history…</div></details></section>'+ 
    '<section class="subpage-section"><h2>Where first-time players came from</h2><p class="subpage-help">Acquisition is based on the earliest captured source; direct and older untracked players appear separately.</p><div id="players-sources">Loading sources…</div></section>'+
    '<section class="subpage-section"><h2>Accounts and activity</h2><div id="players-accounts">Loading accounts…</div><p><a href="?area=users">Find or manage an account</a></p></section>'+
    '<p class="subpage-help">Platform-specific players, one-and-done accounts and signup-to-first-Daily conversion need additional reporting. This page does not estimate them from incompatible counts.</p>'+
    '</section>';
  const cohorts=root.querySelector('#players-cohorts');
  const trends=root.querySelector('#players-trends');
  const sources=root.querySelector('#players-sources');
  const accounts=root.querySelector('#players-accounts');
  const history=root.querySelector('#players-habit-history');
  const load=async()=>{
    const serial=++generation,days=Number(root.querySelector('#players-days').value);
    const {from,to}=range(days),qs=new URLSearchParams({from,to});
    cohorts.textContent='Loading retention…';
    history.textContent='Loading Daily history…';
    trends.textContent='Loading trends…';
    sources.textContent='Loading sources…';
    accounts.textContent='Loading accounts…';
    const renderUnavailable=(element,error)=>{element.textContent=error?.status===401||error?.status===403?'Access expired. Sign in again.':'This report is temporarily unavailable.';};
    const jobs=[
      request('/v1/admin/measurements/habits?'+qs).then(data=>{
        if(serial!==generation||!root.isConnected)return;
        const rows=data?.habit_metrics?.cohorts;
        if(!Array.isArray(rows))throw Error('Missing first-Daily cohorts');
        const next=returnStat(rows,'next_day'),seven=returnStat(rows,'seven_day'),three={
          returned:countRows(rows,'three_in_seven_reached'),
          mature:countRows(rows,'three_in_seven_mature')
        };
        cohorts.innerHTML=[
          card('First-time Daily players',fmt(countRows(rows,'cohort_people')),'First completed Daily in this period'),
          card('Next-day return',pct(next.returned,next.mature),fmt(next.returned)+' of '+fmt(next.mature)+' eligible'),
          card('7-day return',pct(seven.returned,seven.mature),fmt(seven.returned)+' of '+fmt(seven.mature)+' eligible'),
          card('3 days in the first week',pct(three.returned,three.mature),fmt(three.returned)+' of '+fmt(three.mature)+' eligible')
        ].join('');
        history.innerHTML=habitsDetailsMarkup(data.habit_metrics);
        const top=rows.slice().sort((a,b)=>Number(b.cohort_people||0)-Number(a.cohort_people||0)).slice(0,12);
        sources.innerHTML=top.length?'<div class="scroll"><table><thead><tr><th>First source / campaign</th><th>First Daily players</th><th>7-day return</th></tr></thead><tbody>'+
          top.map(row=>'<tr><th>'+esc(displaySource(row))+'</th><td>'+fmt(row.cohort_people)+'</td><td>'+pct(Number(row.seven_day_returned)||0,Number(row.seven_day_mature)||0)+'</td></tr>').join('')+'</tbody></table></div>':
          '<p>No first-time Daily players in this period.</p>';
      }).catch(error=>{if(serial!==generation)return;renderUnavailable(cohorts,error);renderUnavailable(sources,error);renderUnavailable(history,error);}),
      request('/v1/admin/overview/trends').then(data=>{
        if(serial!==generation||!root.isConnected)return;
        const weekly=data?.weekly||[],current=weekly.find(row=>row.label==='current'),previous=weekly.find(row=>row.label==='previous');
        if(!current||!previous)throw Error('Missing weekly trends');
        const items=[
          ['Distinct Daily players',current.daily_players,previous.daily_players],
          ['Completed Dailies',current.daily_completions,previous.daily_completions],
          ['All completed runs',current.completed_runs,previous.completed_runs],
          ['New accounts',current.new_accounts,previous.new_accounts]
        ];
        trends.innerHTML='<div class="scroll"><table><thead><tr><th>Metric</th><th>Latest 7 days</th><th>Previous 7</th></tr></thead><tbody>'+
          items.map(item=>'<tr><th>'+esc(item[0])+'</th><td>'+fmt(item[1])+'</td><td>'+fmt(item[2])+'</td></tr>').join('')+'</tbody></table></div>'+
          '<p class="subpage-help">Weekly players are deduplicated within each week. Weekly trends always cover the most recent 14 Pacific dates, regardless of the cohort filter above.</p>';
      }).catch(error=>{if(serial===generation)renderUnavailable(trends,error);}),
      request('/v1/admin/users?summary_only=1').then(data=>{
        if(serial!==generation||!root.isConnected)return;
        const summary=data?.summary||{};
        accounts.innerHTML='<div class="cards">'+
          card('Accounts',fmt(summary.total),'Registered accounts, all time')+
          card('New accounts',fmt(summary.new_30d),'Last 30 days')+
          card('Active accounts',fmt(summary.active_30d),'Last 30 days')+
          card('Premium access',fmt(summary.paid),'Current entitlements')+'</div>';
      }).catch(error=>{if(serial===generation)renderUnavailable(accounts,error);})
    ];
    await Promise.allSettled(jobs);
  };
  root.querySelector('#players-days').onchange=()=>void load();
  root.querySelector('#players-refresh').onclick=()=>void load();
  await load();
}
