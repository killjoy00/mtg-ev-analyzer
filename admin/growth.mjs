// Read-only marketing report; excludes account emails and exact player identities.
import {gameDateKey} from '../game-date.mjs';
import {compareCampaigns,sortCampaigns,sevenDayReturn,MIN_RETURN_SAMPLE} from './campaign-retention.mjs';
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const fmt=value=>value==null||!Number.isFinite(Number(value))?'Unavailable':Number(value).toLocaleString();
const range=days=>{const to=gameDateKey(),d=new Date(to+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-days+1);return {from:d.toISOString().slice(0,10),to};};
const total=(rows,key)=>rows.reduce((sum,row)=>sum+Number(row[key]||0),0);
const card=(label,value,note)=>'<div class="card"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></div>';
const source=row=>String(row.source||'direct')+(row.campaign&&row.campaign!=='(none)'?' / '+row.campaign:'');

export async function renderGrowth(root,request){
  let generation=0;
  root.innerHTML='<section class="admin-growth">'+
    '<header class="subpage-heading"><h1>Marketing &amp; Growth</h1><p class="muted">Which promotions bring people in, and do they come back?</p></header>'+
    '<div class="actions admin-quick-links"><a href="?area=campaign-links">Create a tracked link</a><a href="?area=creator-challenges">Creator challenges</a><a href="?area=publishing">Publishing</a></div>'+
    '<div class="filters admin-report-filters"><label>Period <select id="growth-days"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option></select></label><button type="button" class="secondary" id="growth-refresh">Refresh</button></div>'+
    '<section class="subpage-section"><h2>Campaign activity</h2><div id="growth-summary" class="cards">Loading campaign activity…</div>'+
      '<p class="subpage-help">A first-time player completed their first Daily during this period. A return means they played on another day within the next week. We only compare return rates when at least '+MIN_RETURN_SAMPLE+' players have had a full week.</p>'+      '<p class="subpage-help">Tracked visits are recorded separately. They do not tell us how many visitors became players.</p>'+
      '<div class="filters"><label>Sort campaigns <select id="growth-order"><option value="first">Most first-time players</option><option value="completions">Most completed Dailies</option><option value="returns">Highest 7-day return (20+ eligible)</option></select></label></div>'+      '<div id="growth-sources">Loading campaigns…</div></section>'+
    '<section class="subpage-section"><h2>YouTube Shorts</h2><div id="growth-youtube">Loading Shorts…</div></section>'+
    '<section class="subpage-section"><h2>Promotion tools</h2><div class="admin-shortcuts">'+
      '<a href="?area=campaign-links"><strong>Tracked links</strong><small>Create or reuse campaign URLs</small></a>'+
      '<a href="?area=creator-challenges"><strong>Creator challenges</strong><small>Publish real runs and review attempts</small></a>'+
      '<a href="?area=publishing"><strong>Publishing</strong><small>News emails, Patreon and automated posts</small></a>'+
      '</div></section>'+
    '<details class="admin-method"><summary>Reporting limits</summary><p>Website campaign attribution is a best-effort client measurement; app-store impressions, installs and native shares are not captured by this report. First-touch source stays fixed when someone returns from another campaign. Return rates include only first-Daily cohorts with a fully elapsed follow-up window.</p></details>'+
    '</section>';
  const sum=root.querySelector('#growth-summary'),sourcePanel=root.querySelector('#growth-sources'),youtubePanel=root.querySelector('#growth-youtube');
  const order=root.querySelector('#growth-order');
  let comparisons=null;
  const showCampaigns=()=>{
    if(!comparisons)return;
    const featured=sortCampaigns(comparisons,order.value).slice(0,25);
    sourcePanel.innerHTML=featured.length?'<div class="scroll"><table><thead><tr><th>Source / campaign</th><th>First-time Daily players</th><th>Completed Dailies</th><th>Tracked visits</th><th>Daily starts</th><th>Returned within 7 days</th></tr></thead><tbody>'+      featured.map(row=>{
        const seven=sevenDayReturn(row);
        return '<tr><th>'+esc(source(row))+'</th><td>'+fmt(row.firstDaily)+'</td><td>'+fmt(row.daily_completions)+'</td><td>'+fmt(row.tracked_arrivals)+'</td><td>'+fmt(row.daily_starts)+'</td><td class="campaign-return">'+esc(seven.value)+'<small>'+esc(seven.note)+'</small></td></tr>';
      }).join('')+'</tbody></table></div>'+      '<p class="subpage-help">Showing up to 25 campaigns from the 80 returned by the report. A small sample is fewer than '+MIN_RETURN_SAMPLE+' eligible players; these rates should not be used to rank promotions. Older visits and later returns can fall outside the selected dates.</p>':
      '<p>No campaign activity in this period.</p>';
  };
  const load=async()=>{
    const serial=++generation,{from,to}=range(Number(root.querySelector('#growth-days').value)),qs=new URLSearchParams({from,to});
    comparisons=null;
    sum.textContent='Loading campaign activity…';sourcePanel.textContent='Loading campaigns…';
    try {
      const [performance,habits]=await Promise.all([
        request('/v1/admin/campaign-performance?'+qs),
        request('/v1/admin/measurements/habits?'+qs).catch(()=>null)
      ]);
      if(serial!==generation||!root.isConnected)return;
      const rows=performance?.rows;
      if(!Array.isArray(rows))throw Error('Missing campaign performance');
      sum.innerHTML=[
        card('Tracked visits',fmt(total(rows,'tracked_arrivals')),'Client-side acquisition events'),
        card('Players from tracked visits',fmt(total(rows,'arriving_players')),'Unique per source and campaign; not global unique players'),
        card('First tracked players',fmt(total(rows,'new_tracked_players')),'First activity near an acquisition touch'),
        card('Daily completions',fmt(total(rows,'daily_completions')),'Attributed using first touch')
      ].join('');
      comparisons=compareCampaigns(rows,habits?.habit_metrics?.cohorts);
      showCampaigns();
    } catch(error){
      if(serial!==generation)return;
      sum.textContent='Campaign summary unavailable.';
      sourcePanel.textContent=error?.status===401||error?.status===403?'Administrator access expired.':'Could not load campaigns. Try Refresh.';
    }
  };
  const youtube=async()=>{
    try{
      const data=await request('/v1/admin/youtube');
      if(!root.isConnected)return;
      if(!data?.configured){youtubePanel.textContent='YouTube Analytics is not connected.';return;}
      if(data.error){youtubePanel.textContent=String(data.error);return;}
      const videos=(data.videos||[]).slice(0,15);
      youtubePanel.innerHTML=videos.length?'<div class="scroll"><table><thead><tr><th>Short</th><th>Views</th><th>Engaged views</th><th>Average viewed</th><th>Likes</th></tr></thead><tbody>'+
        videos.map(v=>'<tr><th>'+esc(v.title||String(v.published_at||'').slice(0,10))+'</th><td>'+fmt(v.views)+'</td><td>'+fmt(v.engaged_views)+'</td><td>'+esc(v.average_view_pct==null?'Unavailable':Number(v.average_view_pct).toFixed(1)+'%')+'</td><td>'+fmt(v.likes)+'</td></tr>').join('')+'</tbody></table></div><p class="subpage-help">Recent 15 uploads from the last 60 days; channel visits are attributed separately.</p>':
        '<p>No Shorts in the last 60 days.</p>';
    }catch{if(root.isConnected)youtubePanel.textContent='YouTube results are unavailable.';}
  };
  order.onchange=showCampaigns;
  root.querySelector('#growth-days').onchange=()=>void load();
  root.querySelector('#growth-refresh').onclick=()=>void load();
  await Promise.allSettled([load(),youtube()]);
}
