// Read-only marketing report; excludes account emails and exact player identities.
import {gameDateKey} from '../game-date.mjs';
import {compareCampaigns,sortCampaigns,sevenDayReturn,MIN_RETURN_SAMPLE} from './campaign-retention.mjs';
import {youtubeReportMarkup} from './youtube-details.mjs';
import {shareFunnelMarkup} from './share-funnel-view.mjs';
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
    '<section class="subpage-section"><h2>Campaign activity</h2><div id="growth-summary" class="cards">Loading campaign activity…</div><p class="subpage-help" id="growth-coverage">Totals cover up to 80 campaign groups.</p>'+
      '<p class="subpage-help">A first-time player completed their first Daily during this period. A return means they played on another day within the next week. We only compare return rates when at least '+MIN_RETURN_SAMPLE+' players have had a full week.</p>'+      '<p class="subpage-help">Tracked visits are recorded separately. They do not tell us how many visitors became players.</p>'+
      '<div class="filters"><label>Sort campaigns <select id="growth-order"><option value="first">Most first-time players</option><option value="completions">Most completed Dailies</option><option value="returns">Highest 7-day return (20+ players)</option></select></label></div>'+      '<div id="growth-sources">Loading campaigns…</div><p class="subpage-help">First-time players are grouped across linked accounts. Daily starts and finishes follow the player identity used for each game. When a guest later signs in, the two reports may show different sources. Don’t use the columns to calculate conversion rates.</p></section>'+
    '<section class="subpage-section"><h2>Sharing Daily results</h2><p class="subpage-help">How often players share a finished Daily, and whether those links bring other players back.</p><details class="admin-method" id="growth-share-details"><summary>Show sharing and referral results</summary><label>Daily type <select id="growth-share-environment"><option value="all">All Dailies</option><option value="mixed">Regular</option><option value="powered-cube">Powered Cube</option><option value="latest">Latest Set</option></select></label><div id="growth-share-report">Open this report to load sharing results.</div></details></section>'+ 
    '<section class="subpage-section"><h2>YouTube Shorts</h2><div id="growth-youtube">Loading Shorts…</div></section>'+
    '<section class="subpage-section"><h2>Promotion tools</h2><div class="admin-shortcuts">'+
      '<a href="?area=campaign-links"><strong>Tracked links</strong><small>Create or reuse campaign URLs</small></a>'+
      '<a href="?area=creator-challenges"><strong>Creator challenges</strong><small>Publish real runs and review attempts</small></a>'+
      '<a href="?area=publishing"><strong>Publishing</strong><small>News emails, Patreon and automated posts</small></a>'+
      '</div></section>'+
    '<details class="admin-method"><summary>Reporting limits</summary><p>We count visits Pack One can track, not every click or app-store install. Each player is credited to the first promotion we recorded, even if they follow a different link later. A player needs a full week after their first Daily before we include them in the seven-day return rate.</p></details>'+
    '</section>';
  const sum=root.querySelector('#growth-summary'),sourcePanel=root.querySelector('#growth-sources'),youtubePanel=root.querySelector('#growth-youtube');
  const order=root.querySelector('#growth-order');
  const shareDetails=root.querySelector('#growth-share-details'),sharePanel=root.querySelector('#growth-share-report');
  let shareSerial=0;
  const loadShares=async()=>{
    const serial=++shareSerial,{from,to}=range(Number(root.querySelector('#growth-days').value));
    const environment=root.querySelector('#growth-share-environment').value;
    sharePanel.textContent='Loading sharing results…';
    try{
      const data=await request('/v1/admin/measurements?'+new URLSearchParams({from,to,environment,corpus:'all'}));
      if(serial!==shareSerial||!root.isConnected||!shareDetails.open)return;
      sharePanel.innerHTML=shareFunnelMarkup(data);
    }catch{
      if(serial===shareSerial&&root.isConnected)sharePanel.textContent='Sharing results are unavailable.';
    }
  };
  shareDetails.addEventListener('toggle',()=>{if(shareDetails.open)void loadShares();else shareSerial++;});
  root.querySelector('#growth-share-environment').onchange=()=>{if(shareDetails.open)void loadShares();};
  const coverage=root.querySelector('#growth-coverage');
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
    coverage.textContent='Checking campaign coverage…';
    sum.textContent='Loading campaign activity…';sourcePanel.textContent='Loading campaigns…';
    try {
      const [performance,habits]=await Promise.all([
        request('/v1/admin/campaign-performance?'+qs),
        request('/v1/admin/measurements/habits?'+qs).catch(()=>null)
      ]);
      if(serial!==generation||!root.isConnected)return;
      const rows=performance?.rows;
      if(!Array.isArray(rows))throw Error('Missing campaign performance');
      coverage.textContent=rows.length>=80?'Totals include the first 80 campaign groups. More campaigns may be missing.':'Totals cover '+rows.length+' campaign '+(rows.length===1?'group':'groups')+' returned by the report (maximum 80). The same player can appear in more than one campaign.';
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
      coverage.textContent='Campaign totals unavailable.';
      sourcePanel.textContent=error?.status===401||error?.status===403?'Administrator access expired.':'Could not load campaigns. Try Refresh.';
    }
  };
  const youtube=async()=>{
    try{
      const data=await request('/v1/admin/youtube');
      if(!root.isConnected)return;
      youtubePanel.innerHTML=youtubeReportMarkup(data);
    }catch{
      if(root.isConnected)youtubePanel.textContent='YouTube results are unavailable.';
    }
  };
  order.onchange=showCampaigns;
  root.querySelector('#growth-days').onchange=()=>{void load();if(shareDetails.open)void loadShares();};
  root.querySelector('#growth-refresh').onclick=()=>{void load();if(shareDetails.open)void loadShares();};
  await Promise.allSettled([load(),youtube()]);
}
