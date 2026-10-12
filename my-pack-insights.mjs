import {escapeHtml as esc} from './html.mjs';
import {safeCardImageUrl} from './card-image-policy.mjs';
import {loadMyInsights,firstPartyAuthEnabled,ensurePackSession,storedAccountToken} from './growth-api.mjs';

let generation=0;
const mounted=new WeakMap();
const ENVIRONMENTS=[['mixed','Mixed'],['latest','Latest Set'],['powered-cube','Powered Cube']];
const PERIODS=[['all','All available'],['90d','Last 90 days'],['365d','Last year']];
const score=v=>v===null||v===undefined?'Not enough to average':Number(v).toFixed(1);
const number=v=>Number(v||0).toLocaleString('en-US');
export function insightLocalRange(value,legacyFrom=value?.from,legacyTo=value?.to) {
  const format=iso=>{
    if(typeof iso!=='string')return null;
    const dt=new Date(iso);
    return Number.isFinite(dt.getTime())?dt.toLocaleString(undefined,
      {year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):null;
  };
  const first=format(value?.from_at),last=format(value?.to_at);
  return first&&last?first+' to '+last:
    legacyFrom&&legacyTo?(legacyFrom===legacyTo?legacyTo:legacyFrom+' to '+legacyTo):
    String(legacyTo||legacyFrom||value?.date||'');
}

export function invalidateMyPackInsights(){generation+=1;}

function periodLabel(key){return PERIODS.find(x=>x[0]===key)?.[1]||'All available';}
function labelOf(env){return ENVIRONMENTS.find(x=>x[0]===env)?.[1]||env;}
function rowText(row,label) {
  return label+': '+row.count+' eligible decisions; '+(row.average_score===null?'not enough to average':row.average_score.toFixed(1)+' average points');
}
function barRows(rows,{labelKey='label',valueLabel='picks'}={}) {
  if(!rows.length)return '<p class="my-pack-empty">There are no qualifying decisions in this group yet.</p>';
  return '<div class="my-insights-bars">'+rows.map(row=>{
    const label=String(row[labelKey]||row.value||row.band||'');
    const avg=row.average_score;
    const pct=avg===null?0:Math.max(0,Math.min(100,Number(avg)));
    return '<div class="my-insights-bar" aria-label="'+esc(rowText(row,label))+'">'+
      '<div class="my-insights-bar-head"><strong>'+esc(label)+'</strong><span>'+
      (avg===null?'<em>Need 5 picks</em>':score(avg)+' / 100')+'</span></div>'+
      '<div class="my-insights-track" aria-hidden="true"><i style="width:'+pct+'%"></i></div>'+
      '<small>'+number(row.count)+' '+esc(valueLabel)+'</small></div>';
  }).join('')+'</div>';
}

function formatsMarkup(rows,current) {
  return '<div class="my-insights-formats">'+rows.map(row=>'<article class="my-insights-format'+
    (row.environment===current?' is-current':'')+'" aria-label="'+esc(rowText(row,row.label))+'">'+
    '<span>'+esc(row.label)+'</span><strong>'+(row.average_score===null?'—':score(row.average_score))+'</strong>'+
    '<small>'+number(row.count)+' decisions'+(row.average_score===null?' · need 5 to average':' · average / 100')+'</small></article>').join('')+
    '</div><p class="my-insights-note">Formats use different card pools; these are recorded averages, not comparable skill rankings.</p>';
}

function progressMarkup(result) {
  if(!result.progress)return '<p class="my-pack-empty">A progress comparison needs 80 eligible decisions in this environment: the latest 40 and the previous 40. You have '+number(result.eligible_decisions)+'.</p>';
  const p=result.progress;
  return '<div class="my-insights-progress">'+
    '<div><span>Previous 40 picks</span><strong>'+score(p.previous.average_score)+'</strong><small>'+esc(p.previous.from)+' to '+esc(p.previous.to)+'</small></div>'+
    '<div><span>Most recent 40 picks</span><strong>'+score(p.recent.average_score)+'</strong><small>'+esc(p.recent.from)+' to '+esc(p.recent.to)+'</small></div></div>'+
    '<p class="my-insights-note">Recorded difference: '+(p.delta>0?'+':'')+Number(p.delta).toFixed(1)+' points. This describes different picks and does not prove improvement or decline.</p>';
}
function monthMarkup(rows) {
  if(!rows.length)return '<p class="my-pack-empty">Monthly trends become available after 10 eligible decisions in a Pacific calendar month.</p>';
  return '<div class="my-insights-months">'+rows.map(row=>
    '<div class="my-insights-month"><span>'+esc(row.month)+'</span><strong>'+
    (row.average_score===null?'—':score(row.average_score))+'</strong><small>'+
    number(row.count)+' decisions'+(row.average_score===null?' · fewer than 10':'')+'</small></div>'
  ).join('')+'</div>';
}
// Standout claims come only from the API's conservative 40-per-side / 10-point
// comparisons. If none qualify, report factual snapshots from already-authorized
// aggregates instead of incorrectly telling an experienced player they lack data.
function descriptivePatternRows(data) {
  const rows=[];
  const summary=data.formats?.find(row=>row.environment===data.environment);
  if(summary?.count>=5&&Number.isFinite(summary.average_score)) {
    const matched=Number.isFinite(summary.trophy_match_pct)
      ? ' Trophy-drafter pick match: '+score(summary.trophy_match_pct)+'%.':'';
    rows.push('Across '+number(summary.count)+' eligible '+labelOf(data.environment)+
      ' decisions, your average originally awarded score was '+score(summary.average_score)+'/100.'+matched);
  }
  const progress=data.progress;
  if(progress?.recent?.count>=40&&progress?.previous?.count>=40&&
    Number.isFinite(progress.recent.average_score)&&Number.isFinite(progress.previous.average_score)) {
    rows.push('Your most recent 40 picks averaged '+score(progress.recent.average_score)+
      '/100; the preceding 40 averaged '+score(progress.previous.average_score)+
      '/100. These are recorded scores, not a proven change in skill.');
  }
  const depth=[...(data.pick_depth||[])]
    .filter(row=>row.count>=5&&Number.isFinite(row.average_score))
    .sort((a,b)=>b.count-a.count||a.pick_number-b.pick_number)[0];
  if(depth)rows.push('Your most-recorded source pick position is '+depth.label+
    ': '+number(depth.count)+' decisions averaging '+score(depth.average_score)+'/100.');
  return rows.slice(0,3);
}

function observationsMarkup(data) {
  if(data.observations?.length)
    return '<ul class="my-insights-observations">'+data.observations.map(row=>'<li>'+esc(row.text)+'</li>').join('')+'</ul>';
  const snapshots=descriptivePatternRows(data);
  return '<p class="my-insights-note">No standout comparison met both thresholds: at least 40 decisions on each side and a 10-point average difference. Your recorded history still provides these descriptive snapshots:</p>'+
    (snapshots.length
      ? '<ul class="my-insights-observations">'+snapshots.map(text=>'<li>'+esc(text)+'</li>').join('')+'</ul>'
      : '<p class="my-pack-empty">The pick, difficulty and progress charts below show every supported group as you collect more decisions.</p>');
}

// The private API owns the identity and evidence rules; the browser is purely
// a presenter. Unknown/older API revisions retain the original Insights UI.
function dnaMarkup(data) {
  const dna=data.drafting_dna;
  if(!dna)return '';
  const trait=(v,primary=false)=>v?.status==='qualified'
    ?'<article class="my-insights-trait'+(primary?' is-primary':'')+'"><strong>'+esc(v.title)+'</strong>'+
      '<p>'+esc(v.summary)+'</p><details><summary>Why this fits · '+number(v.supporting_decisions)+' decisions</summary>'+
      '<ul>'+((v.evidence||[]).map(e=>'<li>'+esc(e.label)+': <strong>'+esc(String(e.value))+'</strong></li>').join(''))+
      '</ul></details></article>'
    :'<article class="my-insights-trait is-emerging"><strong>'+(primary?'Your Drafting DNA is taking shape':'Trait still developing')+
      '</strong><p>'+((v?.picks_needed??dna.picks_needed)!=null
        ?number(v?.picks_needed??dna.picks_needed)+' more eligible decisions to reach the provisional sample floor.'
        :esc(v?.reason||dna.reason||'No additional supported trait passed the evidence gates yet.'))+
      '</p></article>';
  return '<section class="my-pack-card my-insights-wide my-insights-dna">'+
    '<div class="my-card-heading"><h2>Your Drafting DNA</h2><span>All eligible first-time decisions</span></div>'+
    '<div class="my-insights-trait-hero">'+trait(dna.primary||dna.primary_emerging,true)+'</div>'+
    '<div class="my-insights-trait-secondary">'+(dna.secondary||[]).slice(0,2).map(v=>trait(v)).join('')+'</div>'+
    '<p class="my-insights-note">'+esc(dna.note||'Traits describe your recorded choices, not your innate abilities.')+'</p></section>';
}
export function safeCardImage(url) {return safeCardImageUrl(url);}
function cardVisual(card,label) {
  const safe=safeCardImage(card?.image_url);
  return '<div class="my-insights-art">'+(safe
    ?'<img src="'+esc(safe)+'" alt="'+esc(card?.name||label)+'" loading="lazy">'
    :'<span role="img" aria-label="Card image unavailable">'+esc(card?.name||label)+'</span>')+'</div>';
}
function highlightCards(rows,kind) {
  if(!rows?.length)return '<p class="my-pack-empty">No qualifying saved picks in this group yet.</p>';
  return '<div class="my-insights-card-row">'+rows.map(row=>{
    const pick=row.preview?.selected,trophy=row.preview?.trophy;
    return '<article class="my-insights-pick">'+
      '<div class="my-insights-pick-art">'+cardVisual(pick,pick?.name||'Your saved card')+
        (trophy&&trophy.id!==pick?.id?cardVisual(trophy,'Trophy pick'):'')+'</div>'+
      '<div class="my-insights-pick-info"><strong>'+esc(pick?.name||'Your saved pick')+'</strong>'+
        '<small>'+esc(row.set_id)+' · P1P'+Number(row.pick_number)+' · '+esc(row.date)+'</small>'+
        '<span>'+number(row.score)+'/100 · '+esc(row.trophy_match?'Matched the trophy pick':'Alternative selection')+'</span>'+
        '<button type="button" class="button secondary" data-insights-review data-session="'+esc(row.session_id)+'"'+
        ' data-round="'+Number(row.round)+'" data-puzzle="'+esc(row.puzzle_id)+'">Review original pack</button></div></article>';
  }).join('')+'</div>';
}
function highlightsMarkup(data) {
  if(!data.highlights)return '';
  const more=kind=>data.highlights.has_more?.[kind]?
    '<button type="button" class="button secondary" data-insights-more="'+kind+'">Load more '+
      (kind==='best'?'Best Calls':'Biggest Misses')+'</button>':'';
  return '<section class="my-pack-card my-insights-wide my-insights-highlights"><div class="my-card-heading">'+
    '<h2>Your Best Calls & Biggest Misses</h2><span>Actual decisions · original scored picks</span></div>'+
    '<p class="my-insights-note">Scores follow Pack One’s historical model and trophy-pick objective. An alternative pick is not necessarily wrong.</p>'+
    '<div role="tablist" aria-label="Saved decision highlights" class="my-insights-highlight-tabs">'+
      '<button type="button" role="tab" id="my-insights-best-tab" aria-selected="true" aria-controls="my-insights-best-panel" data-insights-tab="best">Best Calls</button>'+
      '<button type="button" role="tab" id="my-insights-misses-tab" aria-selected="false" aria-controls="my-insights-misses-panel" data-insights-tab="misses">Biggest Misses</button></div>'+
    '<div id="my-insights-best-panel" role="tabpanel" aria-labelledby="my-insights-best-tab">'+highlightCards(data.highlights.best,'best')+more('best')+'</div>'+
    '<div id="my-insights-misses-panel" role="tabpanel" aria-labelledby="my-insights-misses-tab" hidden>'+
      highlightCards(data.highlights.misses,'misses')+more('misses')+'</div>'+
    '<div id="my-insights-decision" aria-live="polite"></div></section>';
}
function journeyMarkup(data) {
  const journey=data.journey;
  if(!journey)return '<section class="my-pack-card my-insights-wide">'+
    '<div class="my-card-heading"><h2>Progress over time</h2><span>Most recent vs earlier picks</span></div>'+
    progressMarkup(data)+'<h3 class="my-insights-subheading">Pacific calendar months</h3>'+monthMarkup(data.months)+'</section>';
  const windows=journey.windows||[];
  const chart=windows.length?'<div class="my-insights-journey-timeline" role="list" aria-label="Recorded score windows">'+
    windows.map(w=>'<div class="my-insights-journey-point" role="listitem" aria-label="'+
      esc(insightLocalRange(w)+', '+w.count+' decisions, average '+(w.average_score??'unavailable')+' points'+
      (w.complete?'':' incomplete window'))+'">'+
      '<strong>'+esc(w.average_score==null?'—':score(w.average_score))+'</strong>'+
      '<div class="my-insights-journey-track" aria-hidden="true"><i style="height:'+
      Math.max(0,Math.min(100,Number(w.average_score||0)))+'%"></i></div>'+
      '<small>'+esc(insightLocalRange(w))+'<span>'+w.count+(w.complete?'':'*')+' picks</span></small></div>').join('')+
    '</div>':'<p class="my-pack-empty">Your timeline will grow as you record first-time decisions.</p>';
  const milestone=(journey.milestones||[]).map(m=>'<li><strong>'+esc(m.text)+'</strong> · '+
    esc(insightLocalRange(m,m.date,m.date))+(m.average_score!=null?' · '+score(m.average_score)+'/100':'')+'</li>').join('');
  return '<section class="my-pack-card my-insights-wide my-insights-journey">'+
    '<div class="my-card-heading"><h2>Your Drafting Journey</h2><span>Original scores · dated decisions</span></div>'+
    '<p class="my-insights-note">Each complete window contains 40 first-encounter decisions. An asterisk marks a partial window.</p>'+
    chart+
    (journey.total_windows>windows.length?'<p class="my-insights-note">Showing the latest '+
      windows.length+' of '+journey.total_windows+' windows.</p>':'')+
    '<h3 class="my-insights-subheading">Recent vs previous 40 picks</h3>'+
    (journey.progress_compatible!==false?progressMarkup(data):
      '<p class="my-insights-note">Recorded windows span incompatible source/scoring versions; a progress comparison is unavailable.</p>')+
    (milestone?'<h3 class="my-insights-subheading">Your milestones</h3><ol class="my-insights-milestones">'+milestone+'</ol>':'')+
    '<p class="my-insights-note">'+esc(journey.note||'Historical model and card-pool versions may differ.')+'</p>'+
    '<h3 class="my-insights-subheading">Pacific calendar months</h3>'+monthMarkup(data.months)+'</section>';
}
function lockedDecisionMarkup(value) {
  const chosen=value.selected,trophy=value.trophy,other=trophy?.id!==chosen?.id;
  const pack=value.candidates||[];
  return '<section class="my-insights-locked-pack" aria-label="Original saved draft pack">'+
    '<div class="my-card-heading"><h3>Review original pack</h3><button type="button" class="button secondary" data-insights-close>Close</button></div>'+
    '<p>'+esc(value.set_id)+' · P1P'+Number(value.pick_number)+' · '+number(value.score)+'/100 · '+
      esc(value.answered_at?.slice(0,10)||'')+'</p>'+
    '<div class="my-insights-locked-choices"><figure>'+cardVisual(chosen,'Your pick')+
      '<figcaption>Your pick: '+esc(chosen?.name||'Unknown')+'</figcaption></figure>'+
      (other?'<figure>'+cardVisual(trophy,'Trophy pick')+'<figcaption>Trophy pick: '+
        esc(trophy?.name||'Unknown')+'</figcaption></figure>':'')+'</div>'+
    '<h4>The original pack</h4><div class="my-insights-original-pack">'+pack.map(c=>
      '<figure>'+cardVisual(c,c.name)+'<figcaption>'+esc(c.name)+
      (c.id===chosen?.id?' · Your pick':'')+(c.id===trophy?.id?' · Trophy pick':'')+'</figcaption></figure>'
    ).join('')+'</div>'+
    (value.prior_picks?.length?'<h4>Original drafter’s previous selections</h4><div class="my-insights-original-pool">'+
      value.prior_picks.map(c=>'<span>'+esc(c.name)+'</span>').join('')+'</div>':'')+
    '<details class="my-insights-original-analysis"><summary>Why this score? Saved alternatives</summary>'+
      '<ol>'+((value.ranking||[]).filter(r=>r.score!=null).map(r=>'<li>'+esc(r.name)+
      ': '+number(r.score)+'/100'+(r.id===chosen?.id?' · Your pick':'')+
      (r.id===trophy?.id?' · Trophy pick':'')+'</li>').join(''))+'</ol></details>'+
    '<p class="my-insights-note">This is a read-only record of your original selection. Its awarded score is unchanged.</p>'+
    (value.trophy_drafter?.record?'<p class="my-insights-note">The verified source trophy draft finished '+esc(value.trophy_drafter.record)+'.</p>':'')+
    (value.trophy_drafter?.win_rate!=null?'<p class="my-insights-note">The archived drafter’s overall game win rate was about '+
      esc(String(value.trophy_drafter.win_rate))+'%; that is not this card’s win rate.</p>':'')+'</section>';
}
async function loadSavedInsightDecision({session_id,round,puzzle_id}) {
  const base=String(window.PACK1_API?.growthUrl||window.PACK1_API?.url||'').replace(/\/$/,'');
  if(!/^https:\/\//.test(base))throw Error('Insights server is unavailable.');
  const params=new URLSearchParams({session_id,round:String(round),puzzle_id});
  const headers={};
  if(!firstPartyAuthEnabled()){
    headers.authorization='Bearer '+await ensurePackSession();
    const auth=storedAccountToken();
    if(auth)headers['x-pack1-auth-session']=auth;
  }
  const response=await fetch(base+'/v1/profile/insights/decision?'+params.toString(),{
    method:'GET',headers,credentials:firstPartyAuthEnabled()?'include':'omit',signal:AbortSignal.timeout(20000),
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||'Saved decision is unavailable.');
  return result;
}
function bindInsightCards(root,state,ticket,gen) {
  const current=()=>gen===generation&&ticket===state.ticket&&root.isConnected;
  root.querySelectorAll('[data-insights-tab]').forEach(button=>button.addEventListener('click',()=>{
    const chosen=button.dataset.insightsTab;
    for(const other of root.querySelectorAll('[data-insights-tab]')){
      other.setAttribute('aria-selected',String(other.dataset.insightsTab===chosen));
    }
    for(const panel of ['best','misses']){
      const el=root.querySelector('#my-insights-'+panel+'-panel');
      if(el)el.hidden=panel!==chosen;
    }
    state.viewTicket=(state.viewTicket||0)+1;
    const detail=root.querySelector('#my-insights-decision');if(detail)detail.innerHTML='';
  }));
  const bindReviews=scope=>scope.querySelectorAll('[data-insights-review]').forEach(button=>{
    if(button.dataset.insightsBound)return;
    button.dataset.insightsBound='1';
    button.addEventListener('click',async()=>{
      const detail=root.querySelector('#my-insights-decision');if(!detail)return;
      const viewTicket=(state.viewTicket=(state.viewTicket||0)+1);
      detail.innerHTML='<p role="status">Loading your original pack…</p>';
      try{
        const response=await loadSavedInsightDecision({session_id:button.dataset.session,
          round:Number(button.dataset.round),puzzle_id:button.dataset.puzzle});
        if(!current()||viewTicket!==state.viewTicket)return;
        detail.innerHTML=lockedDecisionMarkup(response);
        detail.querySelector('[data-insights-close]')?.addEventListener('click',()=>{
          detail.innerHTML='';button.focus();
        });
        detail.querySelector('[data-insights-close]')?.focus({preventScroll:true});
      }catch{
        if(current()&&viewTicket===state.viewTicket)
          detail.innerHTML='<p role="alert">That original pack could not be loaded. Try again.</p>';
      }
    });
  });
  bindReviews(root);
  root.querySelectorAll('[data-insights-more]').forEach(button=>button.addEventListener('click',async()=>{
    if(button.disabled||!current())return;
    button.disabled=true;button.textContent='Loading more saved picks…';
    const kind=button.dataset.insightsMore;
    try{
      const response=await loadMyInsights({environment:state.environment,period:state.period,page:2});
      if(!current())return;
      const rows=response.highlights?.[kind]||[];
      if(rows.length){button.insertAdjacentHTML('beforebegin',highlightCards(rows,kind));
        bindReviews(button.parentElement);}
      button.remove();
    }catch{
      if(current()){button.disabled=false;button.textContent='Retry loading more saved picks';}
    }
  }));
}

function insightsContent(data) {
  if(data.unlocked!==true)return '<div class="my-insights-grid">'+dnaMarkup(data)+'<section class="my-pack-card" aria-live="polite"><div class="my-card-heading"><h2>Unlock your Drafting Insights</h2></div>'+
    '<p>Play a few more runs in '+esc(data.environment_label)+'. You have <strong>'+number(data.eligible_decisions)+
    ' of '+data.unlock_at+'</strong> eligible, first-time draft decisions in this period.</p>'+
    '<a class="button primary" href="/?game=draft-run&daily=1">Play today’s Daily</a></section></div>';
  return '<div class="my-insights-grid">'+
    dnaMarkup(data)+highlightsMarkup(data)+journeyMarkup(data)+
    '<section class="my-pack-card my-insights-wide"><div class="my-card-heading"><h2>Your patterns</h2><span>Rules-based observations</span></div>'+observationsMarkup(data)+'</section>'+
    '<section class="my-pack-card"><div class="my-card-heading"><h2>Pick-by-pick strengths</h2><span>Actual source picks</span></div>'+
      '<p class="my-insights-note">Average awarded score by real P1P pick number, not the eight-game-decision order. Each displayed average needs at least five picks.</p>'+
      barRows(data.pick_depth)+'</section>'+
    '<section class="my-pack-card"><div class="my-card-heading"><h2>Difficulty context</h2></div>'+
      '<p class="my-insights-note">Puzzle difficulty groups can contain different decisions. There is no difficulty-adjusted skill grade.</p>'+
      barRows(data.difficulty.map(row=>({...row,label:row.band==='unknown'?'Unknown':row.band[0].toUpperCase()+row.band.slice(1)})))+
      (data.unknown_difficulty?'<p class="my-insights-note">'+number(data.unknown_difficulty)+' decisions have no verified historical difficulty band.</p>':'')+
      '</section>'+

    '<section class="my-pack-card my-insights-wide"><div class="my-card-heading"><h2>Format patterns</h2><span>Different card pools</span></div>'+
      formatsMarkup(data.formats,data.environment)+'</section>'+
    '</div>';
}

function shell(root,state) {
  root.innerHTML='<div class="my-insights-page">'+
    '<header class="my-insights-heading"><p class="eyebrow">Your game, examined</p><h2>Your Drafting Insights</h2>'+
    '<p>Explore how your real draft decisions vary by pick, format and difficulty.</p></header>'+
    '<div class="my-insights-controls" aria-label="Filter your Insights">'+
      '<label for="my-insights-environment">Environment<select id="my-insights-environment">'+ENVIRONMENTS.map(([key,label])=>
        '<option value="'+key+'"'+(state.environment===key?' selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
      '<label for="my-insights-period">Time period<select id="my-insights-period">'+PERIODS.map(([key,label])=>
        '<option value="'+key+'"'+(state.period===key?' selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
      '<button class="button secondary" type="button" id="my-insights-refresh">Refresh</button></div>'+
    '<div id="my-insights-result" aria-live="polite"><section class="my-pack-card"><p>Loading your private drafting decisions…</p></section></div>'+
    '<details class="my-pack-card my-insights-method"><summary>How these insights are calculated</summary>'+
      '<p>Only your first recorded answer to each puzzle counts, from up to 1,000 recent non-QA eight-pick runs. Historical scores are never changed. Rerolls, repeated puzzles and ten-pick runs do not count. Each pick is dated when it was locked. Averages require five decisions per group, monthly averages ten, and written comparisons at least forty in each group with a ten-point gap. Different card pools and historical model versions can affect results.</p></details></div>';
  root.querySelector('#my-insights-environment')?.addEventListener('change',event=>{
    state.environment=event.target.value;void refresh(root,state);
  });
  root.querySelector('#my-insights-period')?.addEventListener('change',event=>{
    state.period=event.target.value;void refresh(root,state);
  });
  root.querySelector('#my-insights-refresh')?.addEventListener('click',()=>void refresh(root,state));
}

async function refresh(root,state) {
  const ticket=++state.ticket,gen=generation;
  // Preserve keyboard focus in filters rather than replacing the whole panel.
  const result=root.querySelector('#my-insights-result');
  if(result)result.innerHTML='<section class="my-pack-card"><p role="status">Loading your private drafting decisions…</p></section>';
  try {
    const response=await loadMyInsights({environment:state.environment,period:state.period});
    if(gen!==generation||ticket!==state.ticket||!root.isConnected)return;
    const target=root.querySelector('#my-insights-result');
    if(target)target.innerHTML='<p class="my-insights-sample">'+number(response.eligible_decisions)+' eligible decisions · '+
      esc(labelOf(response.environment))+' · '+esc(periodLabel(response.period))+'</p>'+insightsContent(response);
    if(target)bindInsightCards(root,state,ticket,gen);
  } catch {
    if(gen!==generation||ticket!==state.ticket||!root.isConnected)return;
    const target=root.querySelector('#my-insights-result');
    if(target)target.innerHTML='<section class="my-pack-card" role="alert"><h2>Insights unavailable</h2>'+
      '<p>Your Stats and Account settings are still available. Try again to load the private analysis.</p>'+
      '<button class="button secondary" type="button" id="my-insights-retry">Retry Insights</button></section>';
    root.querySelector('#my-insights-retry')?.addEventListener('click',()=>void refresh(root,state));
  }
}

export function mountMyPackInsights(root){
  if(!root||mounted.has(root))return;
  const state={environment:'mixed',period:'all',ticket:0};
  mounted.set(root,state);
  shell(root,state);
  void refresh(root,state);
}
