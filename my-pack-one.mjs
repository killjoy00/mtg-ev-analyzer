import {escapeHtml as esc} from './html.mjs';
import {achievementMark} from './achievement-icons.mjs';
import {environmentProgress,formatChallengeRecord,modeName,unlockedAchievements} from './profile-core.mjs';
import {PATREON_POLICY} from './patreon-policy.mjs';

let activeTab='stats';

const num=value=>Number(value||0);

function catalogNames(catalog) {
  return new Map((catalog?.sets||[]).map(entry=>[String(entry.id||'').toLowerCase(),String(entry.name||entry.id||'').trim()]));
}

function environmentName(names,id) {
  if(id==='powered-cube')return 'Powered Cube';
  if(id==='latest')return 'Latest Set';
  return names.get(String(id||'').toLowerCase())||String(id||'').toUpperCase();
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
    '<li><strong>'+esc(seasonEnvironmentName(row.environment))+'</strong><span>#'+num(row.rank)+' · '+num(row.average).toFixed(1)+' · '+num(row.days)+' '+(num(row.days)===1?'day':'days')+'</span></li>'
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
  if(!rows.length)return '<p class="my-pack-empty">Complete a game to start your recent-performance chart.</p>';
  const bars=rows.map(row=>{
    const score=Math.max(0,Math.min(100,num(row.score)));
    return '<div class="my-performance-bar"><strong>'+score+'</strong><span aria-hidden="true"><i style="height:'+Math.max(8,score)+'%"></i></span><small>'+esc(shortDate(row.played_at))+'</small></div>';
  }).join('');
  return '<div class="my-performance-scroll"><div class="my-performance-bars" role="img" aria-label="Recent performance scores">'+bars+'</div></div>';
}

function bestEnvironmentRows(profile,names) {
  const rows=(profile.best_environments||[]).slice(0,5);
  if(!rows.length)return '<p class="my-pack-empty">Play at least three games in an environment to qualify it here.</p>';
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
  return '<li><span>'+esc(date)+'</span><strong>'+esc(environmentName(names,row.set_id))+'</strong><b>'+num(row.score)+'</b><small>'+esc(modeName(row.mode,{cube:row.set_id==='powered-cube'}))+(row.is_daily?' · Daily':'')+'</small></li>';
}

function historyRow(row,names) {
  const date=row.played_at?new Date(row.played_at).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'';
  return '<li data-history-cursor="'+esc(row.cursor||'')+'"><div><strong>'+esc(environmentName(names,row.set_id))+'</strong><span>'+esc(modeName(row.mode,{cube:row.set_id==='powered-cube'}))+(row.is_daily?' · Daily':'')+(date?' · '+esc(date):'')+'</span></div><b>'+num(row.score)+'</b><em>'+esc(row.grade||'')+(row.outcome?' · '+esc(row.outcome):'')+'</em></li>';
}

function dailyPreviewRow(row,names) {
  const pct=num(row.percentile);
  return '<li><span>'+esc(row.date||'')+'</span><strong>'+esc(environmentName(names,row.set_id))+'</strong><b>'+num(row.score)+'</b><small>'+(pct?'Top '+pct+'%':'#'+num(row.rank)+' of '+num(row.total))+'</small></li>';
}

function dailyDetailRow(row,names,index) {
  const pct=num(row.percentile);
  return '<li><div><strong>'+esc(environmentName(names,row.set_id))+' · '+esc(modeName(row.mode,{cube:row.set_id==='powered-cube'}))+'</strong><span>'+esc(row.date||'')+(row.final===false?' · Still open':'')+'</span></div><b>'+num(row.score)+'</b><em>'+(pct?'Top '+pct+'%'+(row.final===false?' so far':'')+' · #'+num(row.rank)+' of '+num(row.total):num(row.total)+' ranked players')+'</em><button type="button" class="text-button" data-share-daily="'+index+'">Share</button></li>';
}

function archiveMarkup(progress) {
  const pct=progress.total?Math.round((progress.played/progress.total)*100):0;
  return '<div class="my-archive-summary"><div><strong>'+progress.played+'/'+progress.total+'</strong><span>environments played</span></div><b>'+pct+'%</b></div>'+
    '<div class="my-archive-track" role="progressbar" aria-label="Archive progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+pct+'"><i style="width:'+pct+'%"></i></div>'+
    '<details class="my-pack-details" data-profile-section="archive"><summary>View full archive progress</summary><div class="my-archive-grid">'+progress.environments.map(entry=>
      '<a class="my-archive-item '+(entry.played?'is-played':'is-unplayed')+'" data-environment-id="'+esc(entry.id)+'" href="/sets/#'+encodeURIComponent(entry.id)+'"><strong>'+esc(entry.name)+'</strong><span>'+(entry.played?entry.games+' games · '+entry.averageScore.toFixed(1)+' avg':'Not played yet')+'</span></a>'
    ).join('')+'</div></details>';
}

function profileAside(profile,progress,account,patreon) {
  const favorite=progress.environments.find(entry=>entry.id===profile.player.favorite_set_id);
  const showcased=(profile.achievements||[]).find(item=>item.id===profile.player.showcase_achievement&&item.unlocked);
  const elite=patreon?.capabilities?.includes('custom_corpus')&&patreon?.capabilities?.includes('unlimited_cube_practice');
  const email=account?.user?.email||'';
  return '<section class="my-side-card my-profile-card" aria-labelledby="my-profile-card-title">'+
    '<div class="my-profile-head"><div class="my-avatar" aria-hidden="true">'+esc(initials(profile.player.display_name))+'</div><div><h2 id="my-profile-card-title" class="profile-name-line">'+esc(profile.player.display_name)+(showcased?achievementMark(showcased.id,{compact:true}):'')+'</h2>'+(email?'<p>'+esc(email)+'</p>':'')+'</div></div>'+
    '<ul class="my-profile-facts"><li><span>Membership</span><strong>'+(elite?'Elite':'Free')+'</strong></li><li><span>Public profile</span><strong>'+(profile.player.profile_public?'On':'Off')+'</strong></li>'+(favorite?'<li><span>Favorite environment</span><strong>'+esc(favorite.name)+'</strong></li>':'')+(showcased?'<li><span>Showcase</span><strong class="profile-showcase-label">'+achievementMark(showcased.id,{decorative:true,compact:true})+esc(showcased.label)+'</strong></li>':'')+'</ul>'+
  '</section>';
}

function membershipAside(patreon) {
  const elite=patreon?.capabilities?.includes('custom_corpus')&&patreon?.capabilities?.includes('unlimited_cube_practice');
  const supportUrl=esc(patreon?.support_url||PATREON_POLICY.supportUrl);
  const connected=patreon?.connected===true;
  const title=patreon?.configured!==true?'Membership status unavailable':elite?'You&rsquo;re an Elite Member':connected?'Patreon connected':'Free member';
  const copy=patreon?.configured!==true?'Open Patreon to review membership options.':elite?'Thanks for supporting Pack One.':connected?'Your Patreon account is linked. Upgrade to Elite for expanded practice.':'Elite unlocks Powered Cube and custom-set practice.';
  const label=elite?'Manage membership':connected?'Upgrade to Elite':'Become Elite';
  return '<section class="my-side-card my-membership-card"><div><span class="my-card-icon" aria-hidden="true">♛</span><h2>'+title+'</h2><p>'+copy+'</p></div><a class="button primary" href="'+supportUrl+'" rel="noopener noreferrer">'+label+'</a></section>';
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

function statsMarkup(profile,catalog,account,patreon) {
  const names=catalogNames(catalog);
  const progress=environmentProgress(catalog,profile.by_set||[]);
  const summary=profile.summary||{};
  const recent=(profile.recent||[]).slice(0,20);
  const daily=(profile.daily_history||[]).slice(0,12);
  const unlocked=unlockedAchievements(profile).length;
  const totalAchievements=(profile.achievements||[]).length;
  const metrics=[
    ['Games',num(summary.games)],
    ['Average',num(summary.average_score).toFixed(1)],
    ['Best',num(summary.best_score)],
    ['Daily streak',num(summary.current_streak)],
    ['Shared runs',esc(formatChallengeRecord(summary))],
    ['Environments',progress.played+'/'+progress.total],
  ];
  const metricHtml=metrics.map(([label,value])=>'<div><strong>'+value+'</strong><span>'+label+'</span></div>').join('');
  const recentPreview=recent.slice(0,5).map(row=>gamePreviewRow(row,names)).join('');
  const dailyPreview=daily.slice(0,5).map(row=>dailyPreviewRow(row,names)).join('');
  return '<div class="my-pack-one-grid"><main class="my-pack-one-main">'+
    '<section class="my-pack-card my-career-card"><div class="my-card-heading"><h2>Career Snapshot</h2></div><div class="my-career-metrics">'+metricHtml+'</div></section>'+currentSeasonMarkup(profile)+
    '<section class="my-pack-card"><div class="my-card-heading"><h2>Recent Performance</h2><span>Last '+Math.min(10,(profile.trend||[]).length)+' games</span></div>'+performanceBars(profile)+'</section>'+
    '<div class="my-two-up"><section class="my-pack-card"><div class="my-card-heading"><h2>Best Environments</h2></div>'+bestEnvironmentRows(profile,names)+'</section>'+
    '<section class="my-pack-card"><div class="my-card-heading"><h2>Achievements</h2><span>'+unlocked+' / '+totalAchievements+' unlocked</span></div>'+achievementPreview(profile)+achievementDetails(profile)+'</section></div>'+
    '<section class="my-pack-card"><div class="my-card-heading"><h2>Recent Games</h2></div>'+(recentPreview?'<ol class="my-game-preview">'+recentPreview+'</ol>':'<p class="my-pack-empty">No scored games yet.</p>')+
      (recent.length?'<details class="my-pack-details"><summary>View all game history</summary><ol class="profile-history-list" id="profile-history-list">'+recent.map(row=>historyRow(row,names)).join('')+'</ol><button type="button" class="button secondary" id="profile-load-more" '+(recent.length<20?'hidden':'')+'>Load more</button></details>':'')+'</section>'+
    '<div class="my-two-up"><section class="my-pack-card"><div class="my-card-heading"><h2>Daily History</h2></div>'+(dailyPreview?'<ol class="my-daily-preview">'+dailyPreview+'</ol>':'<p class="my-pack-empty">No ranked Daily history yet.</p>')+
      (daily.length?'<details class="my-pack-details"><summary>View Daily finishes</summary><ol class="profile-daily-list">'+daily.map((row,index)=>dailyDetailRow(row,names,index)).join('')+'</ol></details>':'')+'</section>'+
    '<section class="my-pack-card"><div class="my-card-heading"><h2>Archive Progress</h2></div>'+archiveMarkup(progress)+'</section></div>'+
  '</main><aside class="my-pack-one-aside">'+profileAside(profile,progress,account,patreon)+membershipAside(patreon)+shareAside(profile)+'</aside></div>';
}

function usernameAttentionMarkup(profile) {
  if(!profile?.player?.claimed||profile.player.username_owned!==false)return '';
  return '<aside class="profile-claim profile-username-attention" role="alert"><div><span>Username needs attention</span><strong>Choose a unique username to join Daily leaderboards.</strong><p>Your account is linked, but this name cannot be used as your ranked public identity yet.</p></div><button type="button" class="button secondary" id="profile-username-fix">Change username</button></aside>';
}

export function resetMyPackOneTab() {
  activeTab='stats';
}

function selectTab(tab,{focus=false}={}) {
  activeTab=tab==='account'?'account':'stats';
  const statsButton=document.querySelector('#profile-stats-tab');
  const accountButton=document.querySelector('#profile-account-tab');
  const stats=document.querySelector('[data-profile-panel="stats"]');
  const account=document.querySelector('[data-profile-panel="account"]');
  if(statsButton){statsButton.setAttribute('aria-selected',String(activeTab==='stats'));statsButton.tabIndex=activeTab==='stats'?0:-1;}
  if(accountButton){accountButton.setAttribute('aria-selected',String(activeTab==='account'));accountButton.tabIndex=activeTab==='account'?0:-1;}
  if(stats)stats.hidden=activeTab!=='stats';
  if(account)account.hidden=activeTab!=='account';
  if(focus)(activeTab==='stats'?statsButton:accountButton)?.focus();
  window.scrollTo?.({top:0,behavior:'smooth'});
}

export function bindMyPackOneTabs() {
  const statsButton=document.querySelector('#profile-stats-tab');
  const accountButton=document.querySelector('#profile-account-tab');
  if(!statsButton||!accountButton)return;
  statsButton.addEventListener('click',()=>selectTab('stats'));
  accountButton.addEventListener('click',()=>selectTab('account'));
  for(const button of [statsButton,accountButton]) {
    button.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
      event.preventDefault();
      selectTab(button===statsButton?'account':'stats',{focus:true});
    });
  }
  document.querySelector('#profile-edit')?.addEventListener('click',()=>selectTab('account',{focus:true}));
  document.querySelector('#profile-username-fix')?.addEventListener('click',()=>{
    selectTab('account',{focus:true});
    document.querySelector('#profile-account input[name="displayName"]')?.focus();
  });
}

export function myPackOneMarkup(profile,catalog,{account=null,patreon=null,settingsMarkup}={}) {
  const progress=environmentProgress(catalog,profile.by_set||[]);
  const accountSelected=activeTab==='account';
  return '<section class="player-profile-page my-pack-one-page growth-page" data-profile-key="'+esc(profile.player.profile_key||'')+'">'+
    '<header class="my-pack-one-heading"><h1>My Pack One</h1><p>Your stats, settings, and everything in one place.</p></header>'+
    usernameAttentionMarkup(profile)+
    '<div class="my-pack-one-tabs" role="tablist" aria-label="My Pack One"><button type="button" role="tab" id="profile-stats-tab" aria-controls="profile-stats-panel" aria-selected="'+String(!accountSelected)+'" tabindex="'+(!accountSelected?'0':'-1')+'">Stats</button><button type="button" role="tab" id="profile-account-tab" aria-controls="profile-account-panel" aria-selected="'+String(accountSelected)+'" tabindex="'+(accountSelected?'0':'-1')+'">Account</button></div>'+
    '<section class="my-pack-one-panel" id="profile-stats-panel" role="tabpanel" aria-labelledby="profile-stats-tab" data-profile-panel="stats" '+(accountSelected?'hidden':'')+'>'+statsMarkup(profile,catalog,account,patreon)+'</section>'+
    '<section class="my-pack-one-panel my-pack-one-account-panel" id="profile-account-panel" role="tabpanel" aria-labelledby="profile-account-tab" data-profile-panel="account" '+(!accountSelected?'hidden':'')+'>'+
      '<div class="my-account-heading"><h2>Account</h2><p>Manage your profile, sign-in security, membership, and account lifecycle.</p></div>'+
      (typeof settingsMarkup==='function'?settingsMarkup(profile,progress,account,patreon):'')+
    '</section>'+
  '</section>';
}
