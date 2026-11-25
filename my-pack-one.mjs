import {escapeHtml as esc} from './html.mjs';
import {achievementMark} from './achievement-icons.mjs';
import {liveEnvironmentProgress,challengeOutcomeLabel,modeName,unlockedAchievements} from './profile-core.mjs';
import {PATREON_POLICY} from './patreon-policy.mjs';
import {invalidateMyPackInsights,mountMyPackInsights} from './my-pack-insights.mjs?v=7';
import {eliteSource} from './membership-source.mjs';

let activeTab='stats';
let previousOwner=null;
// The open Settings panel survives a re-render (for example after Save profile)
// so its confirmation stays visible.
let openPanel=null;

const num=value=>Number(value||0);

function catalogNames(catalog) {
  return new Map((catalog?.sets||[]).map(entry=>[String(entry.set_id||'').toLowerCase(),String(entry.set_name||entry.set_id||'').trim()]));
}

export function environmentName(names,id) {
  const key=String(id||'').toLowerCase();
  if(key==='mixed')return 'Draft Run';
  if(key==='powered-cube')return 'Powered Cube';
  if(key==='latest')return 'Latest Set';
  return names.get(key)||key.toUpperCase();
}

// A mixed Draft Run already has its game type in the environment name.
export function historyModeName(id,mode) {
  return String(id||'').toLowerCase()==='mixed'&&mode==='draft_run'
    ? ''
    : modeName(mode,{cube:String(id||'').toLowerCase()==='powered-cube'});
}

function seasonEnvironmentName(id) {
  if(id==='mixed')return 'Draft Run';
  if(id==='powered-cube')return 'Cube';
  if(id==='latest')return 'Latest Set';
  return String(id||'').toUpperCase();
}

export function currentSeasonMarkup(profile,{surface='my-pack'}={}) {
  const season=profile?.current_season,rows=season?.standings||[];
  if(!season||!rows.length)return '';
  const cls=surface==='public'?'profile-section profile-current-season':'my-pack-card profile-current-season';
  return '<section class="'+cls+'" aria-labelledby="current-season-title"><div class="current-season-heading"><p class="eyebrow">Current season</p><h2 id="current-season-title">'+esc(season.name)+' Season <span>· Current</span></h2></div><ol class="current-season-standings">'+rows.map(row=>
    '<li><strong>'+esc(seasonEnvironmentName(row.environment))+'</strong><span>#'+num(row.rank)+' · '+(row.rating==null?num(row.average).toFixed(1):num(row.rating).toFixed(1)+' rating · '+num(row.average_score).toFixed(1)+' avg')+' · '+num(row.days)+' '+(num(row.days)===1?'day':'days')+'</span></li>'
  ).join('')+'</ol></section>';
}

function shortDate(value) {
  if(!value)return '';
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return String(value).slice(0,10);
  return date.toLocaleDateString(undefined,{month:'short',day:'numeric'});
}

function initials(name) {
  const parts=String(name||'Pack Player').trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0,2).map(part=>part[0]).join('')||'P1').toUpperCase();
}

function performanceBars(profile) {
  const rows=(profile.trend||[]).slice(-10);
  if(!rows.length)return '<p class="my-pack-empty">Play a game to see your recent scores here.</p>';
  const bars=rows.map(row=>{
    const score=Math.max(0,Math.min(100,num(row.score)));
    return '<div class="my-performance-bar"><strong>'+score+'</strong><span aria-hidden="true"><i style="height:'+Math.max(8,score)+'%"></i></span><small>'+esc(shortDate(row.played_at))+'</small></div>';
  }).join('');
  return '<div class="my-performance-scroll"><div class="my-performance-bars" role="img" aria-label="Recent performance scores">'+bars+'</div></div>';
}

function bestEnvironmentRows(profile,names,progress) {
  if(!progress)return '<p class="my-pack-empty">Couldn’t load the sets.</p>';
  const rows=(profile.best_environments||[]).filter(row=>progress.ids.has(row.set_id)).slice(0,5);
  if(!rows.length)return '<p class="my-pack-empty">Play at least three games in a set to see it here.</p>';
  return '<ol class="my-best-list">'+rows.map((row,index)=>
    '<li><span class="my-rank">'+(index+1)+'</span><strong>'+esc(environmentName(names,row.set_id))+'</strong><b>'+num(row.average_score).toFixed(1)+'</b><small>avg</small></li>'
  ).join('')+'</ol>';
}

function achievementPreview(profile) {
  const rows=[...(profile.achievements||[])].sort((a,b)=>Number(b.unlocked)-Number(a.unlocked)).slice(0,6);
  if(!rows.length)return '<p class="my-pack-empty">Your achievements will appear here as you play.</p>';
  return '<div class="my-achievement-preview">'+rows.map(item=>
    '<div class="my-achievement-badge '+(item.unlocked?'is-unlocked':'is-locked')+'">'+achievementMark(item.id,{decorative:true,locked:!item.unlocked})+'<strong>'+esc(item.label)+'</strong><small>'+esc(item.progress_text||'')+'</small></div>'
  ).join('')+'</div>';
}

function achievementDetails(profile) {
  const rows=[...(profile.achievements||[])].sort((a,b)=>Number(b.unlocked)-Number(a.unlocked));
  if(!rows.length)return '';
  return '<details class="my-pack-details" data-profile-section="achievements"><summary>View all achievements</summary><div class="my-achievement-list">'+rows.map(item=>{
    const actions=item.unlocked
      ? '<div class="my-achievement-actions"><button type="button" class="text-button" data-showcase-achievement="'+esc(item.id)+'">Showcase</button><button type="button" class="text-button" data-share-achievement="'+esc(item.id)+'">Share</button></div>'
      : '';
    return '<article class="my-achievement-row '+(item.unlocked?'is-unlocked':'is-locked')+'">'+achievementMark(item.id,{decorative:true,locked:!item.unlocked})+'<div><strong>'+esc(item.label)+'</strong><p>'+esc(item.description)+'</p></div><span>'+esc(item.progress_text||'')+'</span>'+actions+'</article>';
  }).join('')+'</div></details>';
}

function gamePreviewRow(row,names) {
  const date=row.played_at?shortDate(row.played_at):'';
  return '<li><span>'+esc(date)+'</span><strong>'+esc(environmentName(names,row.set_id))+'</strong><b>'+num(row.score)+'</b><small>'+esc([historyModeName(row.set_id,row.mode),row.is_daily?'Daily':''].filter(Boolean).join(' · '))+'</small></li>';
}

function historyRow(row,names) {
  const date=row.played_at?new Date(row.played_at).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'';
  return '<li data-history-cursor="'+esc(row.cursor||'')+'"><div><strong>'+esc(environmentName(names,row.set_id))+'</strong><span>'+esc([historyModeName(row.set_id,row.mode),row.is_daily?'Daily':'',date,row.outcome?challengeOutcomeLabel(row.outcome):''].filter(Boolean).join(' · '))+'</span></div><b>'+num(row.score)+'</b></li>';
}

function dailyPreviewRow(row,names) {
  const pct=num(row.percentile);
  return '<li><span>'+esc(row.date||'')+'</span><strong>'+esc(environmentName(names,row.set_id))+'</strong><b>'+num(row.score)+'</b><small>'+(pct?'Top '+pct+'%':'#'+num(row.rank)+' of '+num(row.total))+'</small></li>';
}

function dailyDetailRow(row,names,index) {
  const pct=num(row.percentile);
  return '<li><div><strong>'+esc([environmentName(names,row.set_id),historyModeName(row.set_id,row.mode)].filter(Boolean).join(' · '))+'</strong><span>'+esc(row.date||'')+(row.final===false?' · Still open':'')+'</span></div><b>'+num(row.score)+'</b><em>'+(pct?'Top '+pct+'%'+(row.final===false?' so far':'')+' · #'+num(row.rank)+' of '+num(row.total):num(row.total)+' ranked players')+'</em><button type="button" class="text-button" data-share-daily="'+index+'">Share</button></li>';
}

function archiveMarkup(progress) {
  if(!progress)return '<p class="my-pack-empty">Couldn’t load the sets. Refresh to try again.</p>';
  const pct=progress.total?Math.round((progress.played/progress.total)*100):0;
  return '<div class="my-archive-summary"><div><strong>'+progress.played+'/'+progress.total+'</strong><span>sets played</span></div><b>'+pct+'%</b></div>'+
    '<div class="my-archive-track" role="progressbar" aria-label="Archive progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+pct+'"><i style="width:'+pct+'%"></i></div>'+
    '<details class="my-pack-details" data-profile-section="archive"><summary>See all sets</summary><div class="my-archive-grid">'+progress.environments.map(entry=>
      '<a class="my-archive-item '+(entry.played?'is-played':'is-unplayed')+'" data-environment-id="'+esc(entry.id)+'" href="/sets/#'+encodeURIComponent(entry.id)+'"><strong>'+esc(entry.name)+'</strong><span>'+(entry.played?entry.games+' games · '+entry.averageScore.toFixed(1)+' avg':'Not played yet')+'</span></a>'
    ).join('')+'</div></details>';
}

function challengeRecordMarkup(summary) {
  const record=[['Beaten',summary.challenge_wins],['Below target',summary.challenge_losses],['Tied',summary.challenge_ties]];
  const played=record.some(([,value])=>num(value)>0);
  return '<div class="my-challenge-card"><p class="my-pack-note">Your results from playing other people’s shared runs.</p>'+
    (played
      ? '<div class="my-challenge-record">'+record.map(([label,value])=>'<div><strong>'+num(value)+'</strong><span>'+label+'</span></div>').join('')+'</div>'
      : '<p class="my-pack-empty">Play someone’s shared run to start your record.</p>')+'</div>';
}

function profileAside(profile,progress,account,patreon) {
  const favorite=progress?.environments.find(entry=>entry.id===profile.player.favorite_set_id);
  const showcased=(profile.achievements||[]).find(item=>item.id===profile.player.showcase_achievement&&item.unlocked);
  const elite=Boolean(eliteSource(patreon));
  const membershipLabel=elite?'Elite':patreon?.configured!==true?'Status unavailable':patreon?.connected?'Patreon connected':'Free';
  const email=account?.user?.email||'';
  return '<section class="my-side-card my-profile-card" aria-labelledby="my-profile-card-title">'+
    '<div class="my-profile-head"><div class="my-avatar" aria-hidden="true">'+esc(initials(profile.player.display_name))+'</div><div><h2 id="my-profile-card-title" class="profile-name-line">'+esc(profile.player.display_name)+(showcased?achievementMark(showcased.id,{compact:true}):'')+'</h2>'+(email?'<p>'+esc(email)+'</p>':'')+'</div></div>'+
    '<ul class="my-profile-facts"><li><span>Membership</span><strong>'+membershipLabel+'</strong></li><li><span>Public profile</span><strong>'+(profile.player.profile_public?'On':'Off')+'</strong></li>'+(favorite?'<li><span>Favorite set or format</span><strong>'+esc(favorite.name)+'</strong></li>':'')+(showcased?'<li><span>Showcase</span><strong class="profile-showcase-label">'+achievementMark(showcased.id,{decorative:true,compact:true})+esc(showcased.label)+'</strong></li>':'')+'</ul>'+
  '</section>';
}

function membershipAside(patreon) {
  const source=eliteSource(patreon);
  // Elite from the Apple subscription or a manual grant: no Patreon purchase or management link.
  if(source==='apple'||source==='other') {
    const copy=source==='apple'
      ?'Your Elite access comes from your Apple App Store subscription. Manage it in your Apple subscription settings.'
      :'Powered Cube and custom-set practice are unlocked on this account.';
    return '<section class="my-side-card my-membership-card"><div><span class="my-card-icon" aria-hidden="true">♛</span><h2>You&rsquo;re an Elite Member</h2><p>'+copy+'</p></div></section>';
  }
  const elite=source==='patreon';
  const supportUrl=esc(patreon?.support_url||PATREON_POLICY.supportUrl);
  const membershipUrl=elite?supportUrl:'/patreon/';
  const connected=patreon?.connected===true;
  const title=patreon?.configured!==true?'Membership status unavailable':elite?'You&rsquo;re an Elite Member':connected?'Patreon connected':'Free member';
  const copy=patreon?.configured!==true?'Review Elite benefits and Patreon setup.':elite?'Thanks for supporting Pack One.':connected?'Your Patreon account is linked. Upgrade to Elite for expanded practice.':'Elite unlocks Powered Cube and custom-set practice.';
  const label=elite?'Manage membership':connected?'Upgrade to Elite':'Become Elite';
  return '<section class="my-side-card my-membership-card"><div><span class="my-card-icon" aria-hidden="true">♛</span><h2>'+title+'</h2><p>'+copy+'</p></div><a class="button primary" href="'+membershipUrl+'"'+(elite?' rel="noopener noreferrer"':'')+'>'+label+'</a></section>';
}

function shareAside(profile) {
  const publicUrl=profile.player.profile_public&&profile.player.profile_key
    ? location.origin+location.pathname+'?profile='+encodeURIComponent(profile.player.profile_key)
    : '';
  return '<section class="my-side-card my-share-card"><h2>Share Your Profile</h2><p>'+(publicUrl?'Let others see your stats and achievements.':'Your profile is private. You can still share your record, or turn on Public profile in Account.')+'</p>'+
    (publicUrl?'<div class="my-share-url"><span>'+esc(publicUrl)+'</span><button type="button" class="text-button" id="profile-copy-link">Copy</button></div>':'')+
    '<button type="button" class="button secondary" id="profile-share">'+(publicUrl?'Share profile':'Share my record')+'</button>'+
  '</section>';
}


const RANKING_NAMES=[['mixed','Draft Run'],['latest','Latest Set'],['powered-cube','Powered Cube']];
function rankingDateRange(start,end) {
  const left=new Date(start+'T12:00:00Z'),right=new Date(end+'T12:00:00Z');
  if(!Number.isFinite(left.getTime())||!Number.isFinite(right.getTime()))return '';
  const short=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
  const full=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
  return (left.getUTCFullYear()===right.getUTCFullYear()?short:full).format(left)+' – '+full.format(right);
}

export function pastRankingsRowsMarkup(rows,period) {
  return rows.map(row=>{
    const range=rankingDateRange(row.start_date,row.end_date);
    const standings=new Map((row.standings||[]).map(item=>[item.environment,item]));
    return '<li class="my-past-ranking"><div class="my-past-ranking-heading"><strong>'+
      esc(period==='season'?(row.name||'Season'):range)+'</strong>'+
      (period==='season'?'<small>'+esc(range)+'</small>':'')+'</div>'+
      '<div class="my-past-ranking-grid">'+RANKING_NAMES.map(([environment,label])=>{
        const rank=standings.get(environment);
        const valid=Number.isSafeInteger(rank?.rank)&&rank.rank>0;
        return '<div><strong'+(!valid?' aria-label="'+(rank?.unavailable?'Rank unavailable':'Not ranked')+'"':'')+'>'+
          (valid?'#'+rank.rank:'—')+'</strong><span>'+label+'</span></div>';
      }).join('')+'</div></li>';
  }).join('');
}

function pastRankingsMarkup() {
  return '<section class="my-pack-card my-past-rankings" aria-labelledby="my-past-rankings-title">'+
    '<div class="my-card-heading"><h2 id="my-past-rankings-title">Past rankings</h2></div>'+
    '<div class="my-past-ranking-periods" role="group" aria-label="Ranking period">'+
    '<button type="button" data-ranking-period="season" aria-pressed="true">Seasons</button>'+
    '<button type="button" data-ranking-period="week" aria-pressed="false">Weeks</button></div>'+
    '<ol class="my-past-ranking-list"></ol><p class="my-pack-empty" data-ranking-status role="status"></p>'+
    '<button type="button" class="text-button my-past-ranking-more" data-ranking-more>View rankings</button>'+
    '<p class="my-past-ranking-note">Rankings are recalculated from saved Daily results.</p></section>';
}

function bindPastRankings() {
  const root=document.querySelector('.my-past-rankings');
  if(!root||root.dataset.bound)return;
  root.dataset.bound='true';
  const tabs=[...root.querySelectorAll('[data-ranking-period]')];
  const list=root.querySelector('.my-past-ranking-list');
  const status=root.querySelector('[data-ranking-status]');
  const more=root.querySelector('[data-ranking-more]');
  const states=new Map(['season','week'].map(period=>[period,{rows:[],next:null,loaded:false,loading:false,error:false}]));
  let active='season';
  function draw() {
    const state=states.get(active);
    tabs.forEach(tab=>tab.setAttribute('aria-pressed',String(tab.dataset.rankingPeriod===active)));
    list.innerHTML=pastRankingsRowsMarkup(state.rows,active);
    root.setAttribute('aria-busy',String(state.loading));
    status.textContent=state.loading?(state.rows.length?'Loading older results…':'Loading rankings…'):
      state.error?'Couldn’t load rankings. Try again.':
      state.loaded&&!state.rows.length?(active==='season'?'No past season rankings yet.':'No past weekly rankings yet.'):'';
    status.hidden=!status.textContent;
    more.hidden=state.loading||(state.loaded&&!state.next&&!state.error);
    more.textContent=state.error?'Try again':state.loaded?'View older results':'View rankings';
  }
  async function load(period,older=false) {
    const state=states.get(period);
    if(state.loading||(older?!state.next:state.loaded))return;
    const before=older?state.next:null;
    state.loading=true;
    state.error=false;
    if(active===period)draw();
    try {
      const {loadMyPastRankings}=await import('./growth-api.mjs');
      const data=await loadMyPastRankings({period,before});
      if(data?.period!==period||!Array.isArray(data.rows))throw Error('Rankings unavailable.');
      if(!root.isConnected)return;
      state.rows=older?[...state.rows,...data.rows]:data.rows;
      state.next=typeof data.next_before==='string'&&data.next_before!==before?data.next_before:null;
      state.loaded=true;
    } catch {
      state.error=true;
    } finally {
      state.loading=false;
      if(root.isConnected&&active===period)draw();
    }
  }
  tabs.forEach(tab=>tab.addEventListener('click',()=>{
    active=tab.dataset.rankingPeriod;
    draw();
    void load(active);
  }));
  more.addEventListener('click',()=>void load(active,states.get(active).loaded));
  draw();
  // Never make the ordinary profile wait for historical leaderboard scans.
  // Fetch when the card becomes visible, with a manual button as fallback.
  if(typeof IntersectionObserver==='function') {
    const observer=new IntersectionObserver(entries=>{
      if(!root.isConnected){observer.disconnect();return;}
      if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();void load(active);}
    });
    observer.observe(root);
  }
}

function statsMarkup(profile,liveCatalog,account,patreon) {
  const names=catalogNames(liveCatalog);
  const progress=liveEnvironmentProgress(liveCatalog,profile.by_set||[]);
  const summary=profile.summary||{};
  const recent=(profile.recent||[]).slice(0,20);
  const daily=(profile.daily_history||[]).slice(0,12);
  const unlocked=unlockedAchievements(profile).length;
  const totalAchievements=(profile.achievements||[]).length;
  if(num(summary.games)===0) {
    return '<div class="my-pack-one-grid is-first-run"><main class="my-pack-one-main">'+
      '<section class="my-pack-card my-first-run-card"><p class="eyebrow">Welcome to My Pack One</p><h2>Start with today’s Daily.</h2><p>No scores yet. Play a Daily to start your record.</p><a class="button primary" href="/?game=draft-run&daily=1">Play Daily</a></section>'+
      '</main><aside class="my-pack-one-aside">'+profileAside(profile,progress,account,patreon)+membershipAside(patreon)+'</aside></div>';
  }
  // Your record leads with four numbers; shared challenges and sets played
  // have their own sections under "Career details".
  const metrics=[
    ['Games',num(summary.games)],
    ['Average',num(summary.average_score).toFixed(1)],
    ['Best',num(summary.best_score)],
    ['Daily streak',num(summary.current_streak)],
  ];
  const metricHtml=metrics.map(([label,value])=>'<div><strong>'+value+'</strong><span>'+label+'</span></div>').join('');
  const recentPreview=recent.slice(0,5).map(row=>gamePreviewRow(row,names)).join('');
  const dailyPreview=daily.slice(0,5).map(row=>dailyPreviewRow(row,names)).join('');
  const challengesPlayed=num(summary.challenge_wins)+num(summary.challenge_losses)+num(summary.challenge_ties);
  return '<div class="my-pack-one-grid"><main class="my-pack-one-main">'+
    '<section class="my-pack-card my-career-card"><div class="my-card-heading"><h2>Your record</h2></div><div class="my-career-metrics">'+metricHtml+'</div></section>'+currentSeasonMarkup(profile)+pastRankingsMarkup()+
    '<section class="my-pack-card"><div class="my-card-heading"><h2>Recent scores</h2><span>Last '+Math.min(10,(profile.trend||[]).length)+' games</span></div>'+performanceBars(profile)+'</section>'+
    '<div class="my-two-up"><section class="my-pack-card"><div class="my-card-heading"><h2>Recent games</h2></div>'+(recentPreview?'<ol class="my-game-preview">'+recentPreview+'</ol>':'<p class="my-pack-empty">No scored games yet.</p>')+
      (recent.length?'<details class="my-pack-details"><summary>View all game history</summary><ol class="profile-history-list" id="profile-history-list">'+recent.map(row=>historyRow(row,names)).join('')+'</ol><button type="button" class="button secondary" id="profile-load-more" '+(recent.length<20?'hidden':'')+'>Load more</button></details>':'')+'</section>'+
    '<section class="my-pack-card"><div class="my-card-heading"><h2>Best sets</h2></div>'+bestEnvironmentRows(profile,names,progress)+'</section></div>'+
    '<section class="my-pack-card" data-profile-section="achievements-summary" aria-labelledby="my-achievements-title"><div class="my-card-heading"><h2 id="my-achievements-title">Achievements</h2><span>'+unlocked+' of '+totalAchievements+' unlocked</span></div>'+achievementPreview(profile)+achievementDetails(profile)+'</section>'+
    '<section class="my-pack-card" data-profile-section="daily-history" aria-labelledby="my-daily-finishes-title"><div class="my-card-heading"><h2 id="my-daily-finishes-title">Daily finishes</h2></div>'+(dailyPreview?'<ol class="my-daily-preview">'+dailyPreview+'</ol>':'<p class="my-pack-empty">No ranked Daily history yet.</p>')+
      (daily.length?'<details class="my-pack-details"><summary>'+ (daily.length>5?'View last '+daily.length+' Daily finishes':'View Daily details') +'</summary><ol class="profile-daily-list">'+daily.map((row,index)=>dailyDetailRow(row,names,index)).join('')+'</ol></details>':'')+'</section>'+
    '<section class="my-pack-card my-record-more" aria-labelledby="my-record-more-title"><div class="my-card-heading"><h2 id="my-record-more-title">Career details</h2></div>'+
      '<div class="my-career-detail-row"><span>Dailies played</span><b>'+ (summary.daily_games==null?'—':num(summary.daily_games).toLocaleString('en-US')) +'</b></div>'+
      '<div class="my-career-detail-row"><span>Longest daily streak</span><b>'+ (summary.best_streak==null?'—':num(summary.best_streak).toLocaleString('en-US')+(num(summary.best_streak)===1?' day':' days')) +'</b></div>'+
      '<details class="my-pack-details my-record-section" data-profile-section="sets-played"><summary>Sets played'+(progress?' <span>'+progress.played+' of '+progress.total+'</span>':'')+'</summary>'+archiveMarkup(progress)+'</details>'+
      '<details class="my-pack-details my-record-section" data-profile-section="shared-challenges"><summary>Shared challenges <span>'+challengesPlayed+' played</span></summary>'+challengeRecordMarkup(summary)+'</details>'+
    '</section>'+
  '</main><aside class="my-pack-one-aside">'+profileAside(profile,progress,account,patreon)+membershipAside(patreon)+shareAside(profile)+'</aside></div>';
}

function usernameAttentionMarkup(profile) {
  if(!profile?.player?.claimed||profile.player.username_owned!==false)return '';
  const reason=profile.player.display_name_reason||profile.ranking_identity?.reason||null;
  const message=reason==='name_not_allowed'
    ? 'That display name is not allowed. Choose another to join Daily leaderboards.'
    : reason==='username_taken'
      ? 'Choose a different display name. That one is already taken.'
      : 'Choose a display name to join Daily leaderboards.';
  return '<aside class="profile-claim profile-username-attention" role="alert"><div><span>Display name needs attention</span><strong>'+esc(message)+'</strong><p>Your account is linked, but this display name can’t show on Daily leaderboards yet.</p></div><button type="button" class="button secondary" id="profile-username-fix">Change display name</button></aside>';
}
export function resetMyPackOneTab() {
  // Entering My Pack One from account navigation or completing a new sign-in
  // must start in Stats, even when a claimed account has no profile key yet.
  // Saving an existing profile uses renderProfile directly and preserves its tab.
  activeTab='stats';
  previousOwner=null;
  openPanel=null;
  invalidateMyPackInsights();
}

function selectTab(tab,{focus=false}={}) {
  const choices=['stats','insights','account'];
  activeTab=choices.includes(tab)?tab:'stats';
  for(const choice of choices){
    const button=document.querySelector('#profile-'+choice+'-tab');
    const panel=document.querySelector('[data-profile-panel="'+choice+'"]');
    if(button){
      button.setAttribute('aria-selected',String(activeTab===choice));
      button.tabIndex=activeTab===choice?0:-1;
    }
    if(panel)panel.hidden=activeTab!==choice;
  }
  if(activeTab==='insights')mountMyPackInsights(document.querySelector('#profile-insights-panel'));
  if(focus)document.querySelector('#profile-'+activeTab+'-tab')?.focus();
  window.scrollTo?.({top:0,behavior:'smooth'});
}

// Settings opens as a short list. Each row shows one panel with the existing
// forms; Back returns to the list and restores focus to the row.
export function openSettingsPanel(name,{focus=true}={}) {
  const root=document.querySelector('#profile-account');
  const panel=root?.querySelector('[data-settings-panel="'+name+'"]');
  const overview=root?.querySelector('.settings-overview');
  if(!root||!panel||!overview)return false;
  root.querySelectorAll('[data-settings-panel]').forEach(el=>{el.hidden=el!==panel;});
  overview.hidden=true;
  root.dataset.settingsOpen=name;
  openPanel=name;
  const heading=panel.querySelector('h3,h2');
  heading?.setAttribute('tabindex','-1');
  if(focus)heading?.focus?.({preventScroll:true});
  if(focus)window.scrollTo?.({top:0,behavior:"smooth"});
  return true;
}

export function openMyPackSettings(name,{focus=true}={}){
  if(!document.querySelector('#profile-account-tab'))return false;
  selectTab('account',{focus:false});
  return openSettingsPanel(name,{focus});
}

function closeSettingsPanel() {
  const root=document.querySelector('#profile-account');
  const overview=root?.querySelector('.settings-overview');
  if(!root||!overview)return;
  const name=root.dataset.settingsOpen;
  root.querySelectorAll('[data-settings-panel]').forEach(el=>{el.hidden=true;});
  overview.hidden=false;
  delete root.dataset.settingsOpen;
  openPanel=null;
  root.querySelector('[data-settings-open="'+name+'"]')?.focus({preventScroll:true});
}

function bindSettingsNavigation() {
  const root=document.querySelector('#profile-account');
  if(!root||!root.querySelector('.settings-overview'))return;
  root.querySelectorAll('[data-settings-open]').forEach(button=>button.addEventListener('click',()=>openSettingsPanel(button.dataset.settingsOpen)));
  root.querySelectorAll('[data-settings-back]').forEach(button=>button.addEventListener('click',closeSettingsPanel));
  root.addEventListener('keydown',event=>{if(event.key==='Escape'&&root.dataset.settingsOpen)closeSettingsPanel();});
}

export function bindMyPackOneTabs() {
  const choices=['stats','insights','account'];
  const buttons=choices.map(tab=>document.querySelector('#profile-'+tab+'-tab'));
  if(buttons.some(button=>!button))return;
  buttons.forEach((button,index)=>{
    button.addEventListener('click',()=>selectTab(choices[index]));
    button.addEventListener('keydown',event=>{
      const direction=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:null;
      const next=event.key==='Home'?0:event.key==='End'?choices.length-1:
        direction===null?null:(index+direction+choices.length)%choices.length;
      if(next===null)return;
      event.preventDefault();
      selectTab(choices[next],{focus:true});
    });
  });
  bindSettingsNavigation();
  bindPastRankings();
  if(openPanel&&activeTab==='account')openSettingsPanel(openPanel,{focus:false});
  const params=new URL(window.location.href).searchParams;
  if(activeTab==='stats'&&!openPanel){
    const destination=params.has('patreon')||params.get('account')==='patreon'?'membership':
      params.get('account')==='reminders'||params.get('reminders')==='1'?'emails':null;
    if(destination)openMyPackSettings(destination,{focus:false});
  }
  if(activeTab==='insights')mountMyPackInsights(document.querySelector('#profile-insights-panel'));
  document.querySelector('#profile-edit')?.addEventListener('click',()=>{selectTab('account',{focus:true});openSettingsPanel('profile',{focus:false});});
  document.querySelector('#profile-username-fix')?.addEventListener('click',()=>{
    selectTab('account',{focus:true});
    openSettingsPanel('profile',{focus:false});
    document.querySelector('#profile-account input[name="displayName"]')?.focus();
  });
}

export function myPackOneMarkup(profile,liveCatalog,{account=null,patreon=null,settingsMarkup}={}) {
  const owner=String(profile?.player?.profile_key||'unclaimed');
  if(previousOwner!==owner){activeTab='stats';previousOwner=owner;openPanel=null;invalidateMyPackInsights();}
  const progress=liveEnvironmentProgress(liveCatalog,profile.by_set||[]);
  const accountSelected=activeTab==='account';
  return '<section class="player-profile-page my-pack-one-page growth-page" data-profile-key="'+esc(profile.player.profile_key||'')+'">'+
    '<header class="my-pack-one-heading"><h1>My Pack One</h1></header>'+
    usernameAttentionMarkup(profile)+
    '<div class="my-pack-one-tabs" role="tablist" aria-label="My Pack One">'+
      '<button type="button" role="tab" id="profile-stats-tab" aria-controls="profile-stats-panel" aria-selected="'+String(activeTab==='stats')+'" tabindex="'+(activeTab==='stats'?'0':'-1')+'">Stats</button>'+
      '<button type="button" role="tab" id="profile-insights-tab" aria-controls="profile-insights-panel" aria-selected="'+String(activeTab==='insights')+'" tabindex="'+(activeTab==='insights'?'0':'-1')+'">Insights</button>'+
      '<button type="button" role="tab" id="profile-account-tab" aria-controls="profile-account-panel" aria-selected="'+String(activeTab==='account')+'" tabindex="'+(activeTab==='account'?'0':'-1')+'">Settings</button></div>'+
    '<section class="my-pack-one-panel" id="profile-stats-panel" role="tabpanel" tabindex="0" aria-labelledby="profile-stats-tab" data-profile-panel="stats" '+(activeTab==='stats'?'':'hidden')+'>'+statsMarkup(profile,liveCatalog,account,patreon)+'</section>'+
    '<section class="my-pack-one-panel" id="profile-insights-panel" role="tabpanel" tabindex="0" aria-labelledby="profile-insights-tab" data-profile-panel="insights" '+(activeTab==='insights'?'':'hidden')+'></section>'+
    '<section class="my-pack-one-panel my-pack-one-account-panel" id="profile-account-panel" role="tabpanel" aria-labelledby="profile-account-tab" data-profile-panel="account" '+(!accountSelected?'hidden':'')+'>'+
      '<h2 class="visually-hidden">Settings</h2>'+
      (typeof settingsMarkup==='function'?settingsMarkup(profile,progress,account,patreon):'')+
    '</section>'+
  '</section>';
}
