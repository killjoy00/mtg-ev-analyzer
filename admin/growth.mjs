// Read-only marketing report; excludes account emails and exact player identities.
import {gameDateKey} from '../game-date.mjs';
import {compareCampaigns,sortCampaigns,sevenDayReturn,MIN_RETURN_SAMPLE} from './campaign-retention.mjs';
import {youtubeReportMarkup} from './youtube-details.mjs?v=20261122-copy';
import {shareFunnelMarkup} from './share-funnel-view.mjs?v=20261122-copy';
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const fmt=value=>value==null||!Number.isFinite(Number(value))?'Unavailable':Number(value).toLocaleString();
const range=days=>{const to=gameDateKey(),d=new Date(to+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-days+1);return {from:d.toISOString().slice(0,10),to};};
const total=(rows,key)=>rows.reduce((sum,row)=>sum+Number(row[key]||0),0);
const card=(label,value,note)=>'<div class="card"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></div>';
const source=row=>String(row.source||'direct')+(row.campaign&&row.campaign!=='(none)'?' / '+row.campaign:'');

export async function renderGrowth(root,request){
  let generation=0;
  root.innerHTML='<section class="admin-growth">'+
    '<header class="subpage-heading"><h1>Marketing &amp; Growth</h1><p class="muted">Where players came from, and whether they returned.</p></header>'+
    '<div class="actions admin-quick-links"><a href="?area=campaign-links">Create a tracked link</a><a href="?area=creator-challenges">Creator challenges</a><a href="?area=publishing">Publishing</a></div>'+
    '<div class="filters admin-report-filters"><label>Period <select id="growth-days"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option></select></label><button type="button" class="secondary" id="growth-refresh">Refresh</button></div>'+
    '<section class="subpage-section"><h2>Campaign activity</h2><div id="growth-summary" class="cards">Loading campaign activity…</div><p class="subpage-help" id="growth-coverage">Showing up to 80 campaigns.</p>'+
      '<details class="admin-method"><summary>How these numbers are counted</summary><p>First-time players finished their first Daily during this period. A return means they came back on another day within a week. We compare return rates only when at least '+MIN_RETURN_SAMPLE+' people have had a full week to return.</p><p>Tracked link visits and completed Dailies are counted separately. The two reports may assign different sources after a guest signs in. They do not establish a conversion rate.</p></details>'+
      '<div class="filters"><label>Show campaigns by <select id="growth-order"><option value="first">Most first-time players</option><option value="completions">Most completed Dailies</option><option value="returns">Highest 7-day return (20+ players)</option></select></label></div>'+      '<div id="growth-sources">Loading campaigns…</div><p class="subpage-help">Campaigns are credited to the first promotion Pack One recorded. The table cannot tell us how many people who clicked a link became players.</p></section>'+
    '<section class="subpage-section"><h2>Sharing Daily results</h2><p class="subpage-help">How often players share a finished Daily, and whether those links bring other players back.</p><details class="admin-method" id="growth-share-details"><summary>Show sharing and referral results</summary><label>Daily type <select id="growth-share-environment"><option value="all">All Dailies</option><option value="mixed">Regular</option><option value="powered-cube">Powered Cube</option><option value="latest">Latest Set</option></select></label><div id="growth-share-report">Open this report to load sharing results.</div></details></section>'+
    '<section class="subpage-section"><h2>YouTube Shorts</h2><div id="growth-youtube">Loading Shorts…</div></section>'+
    '<details class="admin-method"><summary>What is not counted</summary><p>Only visits recorded by Pack One appear here. App-store installs and untracked clicks are not included.</p></details>'+
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
      }).join('')+'</tbody></table></div>'+      '<p class="subpage-help">Up to 25 campaigns shown. Return rates with fewer than '+MIN_RETURN_SAMPLE+' eligible players are too small to rank.</p>':
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
      coverage.textContent=rows.length>=80?'Showing the first 80 campaign groups; others may not be included.':'Showing '+rows.length+' campaign '+(rows.length===1?'group':'groups')+' (maximum 80). A player may appear under more than one campaign.';
      sum.innerHTML=[
        card('Visits from tracked links',fmt(total(rows,'tracked_arrivals')),'Visits Pack One recorded'),
        card('Players on tracked links',fmt(total(rows,'arriving_players')),'Counted separately for each campaign'),
        card('New tracked players',fmt(total(rows,'new_tracked_players')),'First activity recorded near a link visit'),
        card('Dailies completed',fmt(total(rows,'daily_completions')),'Credited to first recorded promotion')
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
