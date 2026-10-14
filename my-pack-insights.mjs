import {escapeHtml as esc} from './html.mjs';
import {safeCardImageUrl} from './card-image-policy.mjs';
import {loadMyInsights,firstPartyAuthEnabled,ensurePackSession,storedAccountToken} from './growth-api.mjs';

let generation=0;
const mounted=new WeakMap();
const ENVIRONMENTS=[['mixed','Mixed sets'],['latest','Latest Set'],['powered-cube','Powered Cube']];
const PERIODS=[['all','All available'],['90d','Last 90 days'],['365d','Last year']];
const score=v=>v===null||v===undefined?'Not enough to average':Number(v).toFixed(1);
const number=v=>Number(v||0).toLocaleString('en-US');
const INSIGHTS_SET_NAMES=Object.freeze({"stx":"Strixhaven: School of Mages","mid":"Innistrad: Midnight Hunt","vow":"Innistrad: Crimson Vow","neo":"Kamigawa: Neon Dynasty","snc":"Streets of New Capenna","hbg":"Alchemy Horizons: Baldur's Gate","dmu":"Dominaria United","bro":"The Brothers' War","one":"Phyrexia: All Will Be One","sir":"Shadows over Innistrad Remastered","mom":"March of the Machine","ltr":"The Lord of the Rings: Tales of Middle-earth","woe":"Wilds of Eldraine","lci":"The Lost Caverns of Ixalan","ktk":"Khans of Tarkir","mkm":"Murders at Karlov Manor","otj":"Outlaws of Thunder Junction","mh3":"Modern Horizons 3","blb":"Bloomburrow","sos":"Secrets of Strixhaven","dsk":"Duskmourn: House of Horror","fdn":"Foundations","pio":"Pioneer Masters","dft":"Aetherdrift","tdm":"Tarkir: Dragonstorm","fin":"Final Fantasy","eoe":"Edge of Eternities","tla":"Avatar: The Last Airbender","hob":"The Hobbit","msh":"Marvel Super Heroes","tmt":"Teenage Mutant Ninja Turtles","ecl":"Lorwyn Eclipsed","fra":"Reality Fracture","powered-cube":"Powered Cube"});
const readableSet=id=>INSIGHTS_SET_NAMES[String(id||'').toLowerCase()]||String(id||'Unknown set').toUpperCase();
function highlightExplanation(row) {
  if(row.trophy_match)return 'You matched the trophy pick.';
  const evidence=row.reason_evidence||{};
  if(row.reason_code==='saved-support-gap'&&typeof evidence.leader_id==='string'&&
    typeof evidence.leader_name==='string'&&evidence.leader_name.trim()&&
    evidence.leader_id!==(row.preview?.selected?.id||'')){
    return evidence.leader_id===(row.preview?.trophy?.id||row.historical_id)
      ?'The saved model supported the trophy pick more strongly than your choice.'
      :'The saved model favored '+evidence.leader_name+' — a different card from the trophy pick.';
  }
  return 'You chose a different card.';
}
function safeFinding(data) {
  const finding=data.leading_finding;
  if(!['progress','pick-depth'].includes(finding?.id))return null;
  const examples=[...(data.highlights?.best||[]).slice(0,3),...(data.highlights?.misses||[]).slice(0,3)];
  return examples.some(row=>row.finding_context)?finding:null;
}
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

function shortInsightDate(iso) {
  if(typeof iso!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(iso))return String(iso||'');
  const month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(iso.slice(5,7))-1];
  return month?month+' '+Number(iso.slice(8,10)):'';
}
function shortInsightRange(value) {
  const local=stamp=>{
    const date=new Date(stamp);
    return Number.isFinite(date.getTime())?
      date.toLocaleDateString(undefined,{month:'short',day:'numeric'}):null;
  };
  const from=(value?.from_at&&local(value.from_at))||shortInsightDate(value?.from);
  const to=(value?.to_at&&local(value.to_at))||shortInsightDate(value?.to);
  return from===to?from:from+'–'+to;
}
function periodLabel(key){return PERIODS.find(x=>x[0]===key)?.[1]||'All available';}
function labelOf(env){return ENVIRONMENTS.find(x=>x[0]===env)?.[1]||env;}
function rowText(row,label) {
  return label+': '+row.count+' picks included; '+(row.average_score===null?'not enough to average':row.average_score.toFixed(1)+' average points');
}
function barRows(rows,{labelKey='label',valueLabel='picks'}={}) {
  if(!rows.length)return '<p class="my-pack-empty">No picks to show in this group yet.</p>';
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
// The private API owns the identity and evidence rules; the browser is purely
// a presenter. Unknown/older API revisions retain the original Insights UI.
function dnaMarkup(data) {
  const dna=data.drafting_dna;
  if(!dna)return '<section class="my-pack-card my-insights-wide my-insights-dna"><h2>Your pick patterns</h2>'+
    '<p class="my-insights-note">Pattern details aren’t available from this version yet.</p></section>';
  const traits=[dna.primary,...(dna.secondary||[])].filter(t=>t?.status==='qualified');
  const distinct=[...new Map(traits.map(t=>[t.id,t])).values()];
  const traitHtml=distinct.length?'<div class="my-insights-qualified-traits">'+distinct.map(trait=>
    '<div class="my-insights-qualified-trait"><strong>'+esc(trait.title)+'</strong><p>'+esc(trait.summary)+'</p>'+
    '<details><summary>Why this fits</summary><p>'+number(trait.supporting_decisions)+' picks included in this pattern.</p>'+
    '<ul>'+(trait.evidence||[]).map(e=>'<li>'+esc(e.label)+': '+esc(String(e.value))+'</li>').join('')+
    '</ul></details></div>').join('')+'</div>':
    '<p class="my-insights-note">No clear pick pattern to show yet.</p>';
  const choices=(data.card_choices?.choices||[]).filter(c=>c.status==='ready');
  const choiceHtml=choices.length?'<details class="my-insights-choice-disclosure"><summary>Card type and rarity counts</summary>'+
    '<p class="my-insights-note">These counts only include packs where both categories had competitive model support, with known card details and one compatible scoring version. They are not rates for all your picks or proof of preference.</p>'+
    choices.map(v=>{
      const isType=v.id==='card-type',count=number(v.selected?.[isType?'creature':'rare-mythic']||0);
      return '<div class="my-insights-choice-fact"><span>'+esc(isType?'Creature choices':'Rare or mythic choices')+
        '</span><strong>'+count+' of '+number(v.opportunities)+' qualifying picks</strong>'+
        '<details><summary>Examples and counts</summary><p>'+esc(v.summary||'')+'</p>'+
        '<p>Competitive options: '+Object.entries(v.availability||{}).map(([k,n])=>esc(k)+': '+number(n)).join(' · ')+
        '. Your picks: '+Object.entries(v.selected||{}).map(([k,n])=>esc(k)+': '+number(n)).join(' · ')+'.</p>'+
        (v.examples||[]).map(e=>'<button type="button" class="my-insights-example" data-insights-review data-session="'+
          esc(e.session_id)+'" data-round="'+Number(e.round)+'" data-puzzle="'+esc(e.puzzle_id)+'">'+
          esc(e.selected_name||'Pick')+' · '+esc(readableSet(e.set_id))+' P1P'+Number(e.pick_number)+
          ' · '+esc(shortInsightDate(e.date))+'</button>').join('')+'</details></div>';
    }).join('')+'</details>':'';
  return '<section class="my-pack-card my-insights-wide my-insights-dna">'+
    '<div class="my-card-heading"><h2>Your pick patterns</h2><span>Across formats · All available history</span></div>'+
    traitHtml+choiceHtml+
    '<details class="my-insights-dna-method"><summary>How this works</summary>'+
    '<p class="my-insights-note">'+number(dna.eligible_decisions)+' picks included, regardless of the Format and time filters. Only the first included answer per puzzle counts. History is bounded to recent eligible runs, so older picks may not appear.</p>'+
    '<p class="my-insights-note">Traits describe patterns in your picks, not measured skill. '+esc(dna.note||'')+'</p>'+
    (data.card_choices?'<p class="my-insights-note">'+esc(data.card_choices.note||'')+'</p>':'')+
    '</details></section>';
}
export function safeCardImage(url) {return safeCardImageUrl(url);}
function cardVisual(card,label) {
  const safe=safeCardImage(card?.image_url);
  return '<div class="my-insights-art">'+(safe
    ?'<img src="'+esc(safe)+'" alt="'+esc(card?.name||label)+'" loading="lazy">'
    :'<span role="img" aria-label="Artwork unavailable for '+esc(card?.name||label)+'">No art</span>')+'</div>';
}
function highlightCards(rows,kind,expanded=false) {
  if(!rows?.length)return '<p class="my-pack-empty">No '+(kind==='misses'?'picks to revisit':'high-scoring picks')+
    ' in this view. This doesn’t mean you drafted badly.</p>';
  return '<div class="my-insights-card-row">'+rows.map((row,index)=>{
    const pick=row.preview?.selected,trophy=row.preview?.trophy,featured=index===0&&!expanded;
    const name=pick?.name||row.selected_name||'Card name unavailable';
    const trophyName=trophy?.name||row.historical_name||'Card name unavailable';
    const art='<div class="my-insights-pick-art"><div><strong>Your pick</strong>'+cardVisual(pick,name)+'</div>'+
      '<div><strong>Trophy pick</strong>'+cardVisual(trophy,trophyName)+'</div></div>';
    return '<article class="my-insights-pick'+(featured?' is-featured':' is-compact')+'"'+
      (index>=3&&!expanded?' hidden data-insights-extra="'+kind+'"':'')+'>'+
      art+'<div class="my-insights-pick-info"><div class="my-insights-pick-names">'+
      '<span>Your pick: <strong>'+esc(name)+'</strong></span>'+
      '<span>Trophy pick: <strong>'+esc(trophyName)+'</strong></span></div>'+
      '<small>'+esc(readableSet(row.set_id))+' · Source P1P'+Number(row.pick_number)+' · '+
       esc(shortInsightDate(row.date))+' · Score '+number(row.score)+'/100</small>'+
      (row.finding_context?'<small class="my-insights-context">'+esc(row.finding_context)+'</small>':'')+
      '<p class="my-insights-reason">'+esc(highlightExplanation(row))+'</p>'+
      '<button type="button" class="button secondary" data-insights-review data-session="'+esc(row.session_id)+'"'+
      ' data-round="'+Number(row.round)+'" data-puzzle="'+esc(row.puzzle_id)+'">Review pick</button></div></article>';
  }).join('')+'</div>';
}
function highlightsMarkup(data) {
  if(!data.highlights)return '<section class="my-pack-card my-insights-wide my-insights-highlights">'+
    '<h2>Picks to review</h2><p class="my-insights-note">Pick examples aren’t available from this version yet.</p></section>';
  const selected=data.highlights.misses?.length?'misses':'best';
  const more=kind=>data.highlights?.[kind]?.length>3||data.highlights.has_more?.[kind]
    ?'<button type="button" class="button secondary" data-insights-more="'+kind+'" data-insights-page2="'+String(Boolean(data.highlights.has_more?.[kind]))+'">See more picks</button>':'';
  const finding=safeFinding(data);
  const lead=finding?'<p class="my-insights-leading">'+esc(finding.text)+
    ' <small>These examples illustrate the comparison; they don’t prove its cause.</small></p>':
    '<p class="my-insights-note">Open a pick to see the full pack and the trophy drafter’s earlier picks.</p>';
  return '<section class="my-pack-card my-insights-wide my-insights-highlights"><div class="my-card-heading">'+
    '<h2>Picks to review</h2><span>'+number(data.eligible_decisions)+' picks included in this view</span></div>'+
    lead+'<div role="tablist" aria-label="Pick examples" class="my-insights-highlight-tabs">'+
      '<button type="button" role="tab" id="my-insights-misses-tab" aria-selected="'+(selected==='misses')+
      '" aria-controls="my-insights-misses-panel" tabindex="'+(selected==='misses'?0:-1)+
      '" data-insights-tab="misses">Picks to revisit</button>'+
      '<button type="button" role="tab" id="my-insights-best-tab" aria-selected="'+(selected==='best')+
      '" aria-controls="my-insights-best-panel" tabindex="'+(selected==='best'?0:-1)+
      '" data-insights-tab="best">High-scoring picks</button></div>'+
    '<div id="my-insights-misses-panel" role="tabpanel" aria-labelledby="my-insights-misses-tab"'+
      (selected==='misses'?'':' hidden')+'>'+
      highlightCards(data.highlights.misses,'misses')+more('misses')+'</div>'+
    '<div id="my-insights-best-panel" role="tabpanel" aria-labelledby="my-insights-best-tab"'+
      (selected==='best'?'':' hidden')+'>'+
      highlightCards(data.highlights.best,'best')+more('best')+'</div>'+
    '<p class="my-insights-note">100 means you matched the trophy pick. Other picks earn up to 95 based on the model.</p>'+
    '<details class="my-insights-how"><summary>How this works</summary>'+
    '<p>Only the first included answer to each puzzle counts. Scores describe picks, not drafting skill.</p></details></section>';
}
function journeyMarkup(data) {
  const journey=data.journey;
  if(!journey)return '<section class="my-pack-card my-insights-wide">'+
    '<div class="my-card-heading"><h2>Your Drafting Journey</h2></div>'+
    progressMarkup(data)+'<details><summary>View journey details</summary>'+
    '<h3>Pacific calendar months</h3>'+monthMarkup(data.months)+'</details></section>';
  const windows=journey.windows||[];
  const chart=windows.length?'<div class="my-insights-journey-timeline" role="list" aria-label="Recorded score windows">'+
    windows.map(w=>'<div class="my-insights-journey-point" role="listitem" aria-label="'+
      esc(insightLocalRange(w)+', '+w.count+' decisions, average '+(w.average_score??'unavailable')+
      (w.complete?'':' incomplete'))+'">'+
      '<strong>'+esc(w.average_score==null?'—':score(w.average_score))+'</strong>'+
      '<div class="my-insights-journey-track" aria-hidden="true"><i style="height:'+
      Math.max(0,Math.min(100,Number(w.average_score||0)))+'%"></i></div>'+
      '<small>'+esc(shortInsightRange(w))+'<span>'+w.count+(w.complete?'':'*')+' picks</span></small></div>').join('')+
    '</div>':'<p class="my-pack-empty">Your timeline will grow with original scored decisions.</p>';
  const milestone=(journey.milestones||[]).map(m=>'<li><strong>'+esc(m.text)+'</strong> · '+
    esc(insightLocalRange(m,m.date,m.date))+(m.average_score!=null?' · '+score(m.average_score)+'/100':'')+'</li>').join('');
  const compatible=journey.progress_compatible!==false;
  const versionBoundary=new Set((journey.windows||[]).map(w=>w.cohort)).size>1;
  const boundaryWarning=!compatible||versionBoundary?
    '<p class="my-insights-journey-warning" role="note">These saved picks cross different scoring or card-pool versions. The windows are not a continuous progress trend.</p>':'';
  const progress=compatible&&data.progress?'<p class="my-insights-journey-summary">Recent 40: '+
    score(data.progress.recent.average_score)+'/100 · Previous 40: '+
    score(data.progress.previous.average_score)+'/100 · Difference '+
    (data.progress.delta>0?'+':'')+score(data.progress.delta)+' points (descriptive, not proof of improvement).</p>':'';
  return '<section class="my-pack-card my-insights-wide my-insights-journey">'+
    '<div class="my-card-heading"><h2>Your Drafting Journey</h2><span>Original scores · 40-pick windows</span></div>'+
    chart+boundaryWarning+progress+
    '<details class="my-insights-journey-details"><summary>View journey details</summary>'+
    '<p class="my-insights-note">'+esc(journey.note||'Historical versions may differ.')+
    ' Incomplete windows are marked with an asterisk.</p>'+
    (journey.total_windows>windows.length?'<p class="my-insights-note">Latest '+windows.length+
       ' of '+journey.total_windows+' windows shown.</p>':'')+
    '<ol>'+windows.map(w=>'<li>'+esc(insightLocalRange(w))+' · '+w.count+' picks · '+
      (w.complete?'complete':'incomplete')+' · '+score(w.average_score)+'/100</li>').join('')+'</ol>'+
    (!compatible?'<p>Historical model and card-pool versions differ; recent-versus-previous comparison unavailable.</p>':
      '<h3>Previous and recent pick windows</h3>'+progressMarkup(data))+
    (milestone?'<h3>Your milestones</h3><ol class="my-insights-milestones">'+milestone+'</ol>':'')+
    '<h3>Pacific calendar months</h3>'+monthMarkup(data.months)+'</details></section>';
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
  const dialog=root.querySelector('#my-insights-decision-dialog');
  const dialogBody=dialog?.querySelector('[data-insights-dialog-body]');
  root.querySelectorAll('[data-insights-tab]').forEach(button=>button.addEventListener('click',()=>{
    const chosen=button.dataset.insightsTab;
    root.querySelectorAll('[data-insights-tab]').forEach(other=>
      other.setAttribute('aria-selected',String(other.dataset.insightsTab===chosen)));
    for(const panel of ['best','misses']){
      const el=root.querySelector('#my-insights-'+panel+'-panel');
      if(el)el.hidden=panel!==chosen;
    }
    state.viewTicket=(state.viewTicket||0)+1;
    if(dialog?.open)dialog.close();
  }));
  const bindReviews=scope=>scope.querySelectorAll('[data-insights-review]').forEach(button=>{
    if(button.dataset.insightsBound)return;
    button.dataset.insightsBound='1';
    button.addEventListener('click',async()=>{
      if(!dialog||!dialogBody||!current())return;
      state.returnFocus=button;
      const viewTicket=(state.viewTicket=(state.viewTicket||0)+1);
      dialogBody.innerHTML='<p role="status">Loading your saved pack…</p>'+
        '<button type="button" class="button secondary" data-insights-close>Close</button>';
      dialogBody.querySelector('[data-insights-close]')?.addEventListener('click',()=>dialog.close());
      if(typeof dialog.showModal==='function')dialog.showModal();
      else dialog.setAttribute('open','');
      try{
        const response=await loadSavedInsightDecision({session_id:button.dataset.session,
          round:Number(button.dataset.round),puzzle_id:button.dataset.puzzle});
        if(!current()||viewTicket!==state.viewTicket||!dialog.open)return;
        dialogBody.innerHTML=lockedDecisionMarkup(response);
        dialogBody.querySelector('[data-insights-close]')?.addEventListener('click',()=>dialog.close());
        dialogBody.querySelector('[data-insights-close]')?.focus({preventScroll:true});
      }catch{
        if(current()&&viewTicket===state.viewTicket&&dialog.open)
          dialogBody.innerHTML='<p role="alert">That original pack could not be loaded. Close and try again.</p>'+
            '<button type="button" class="button secondary" data-insights-close>Close</button>';
        dialogBody.querySelector('[data-insights-close]')?.addEventListener('click',()=>dialog.close());
      }
    });
  });
  bindReviews(root);
  root.querySelectorAll('[data-insights-more]').forEach(button=>button.addEventListener('click',async()=>{
    if(button.disabled||!current())return;
    const kind=button.dataset.insightsMore;
    const panel=root.querySelector('#my-insights-'+kind+'-panel');
    panel?.querySelectorAll('[data-insights-extra]').forEach(el=>{el.hidden=false;});
    if(button.dataset.insightsPage2!=='true'){button.remove();return;}
    button.disabled=true;button.textContent='Loading more saved picks…';
    try{
      const response=await loadMyInsights({environment:state.environment,period:state.period,page:2});
      if(!current())return;
      const rows=response.highlights?.[kind]||[];
      if(rows.length&&panel){
        button.insertAdjacentHTML('beforebegin',highlightCards(rows,kind,true));
        bindReviews(panel);
      }
      button.remove();
    }catch{
      if(current()){button.disabled=false;button.textContent='Retry seeing more picks';}
    }
  }));
}

function insightsContent(data) {
  if(data.unlocked!==true)return '<div class="my-insights-grid"><section class="my-pack-card my-insights-wide">'+
    '<h2>Unlock your Drafting Insights</h2><p>Play a few more runs in '+esc(data.environment_label)+
    '. You have '+number(data.eligible_decisions)+' of '+number(data.unlock_at)+
    ' eligible first-time decisions in this period.</p>'+
    '<a class="button primary" href="/?game=draft-run&daily=1">Play today’s Daily</a></section></div>';
  const extras=data.observations?.slice(1)||[];
  return '<div class="my-insights-grid">'+highlightsMarkup(data)+journeyMarkup(data)+
    '<details class="my-pack-card my-insights-wide my-insights-explore"><summary>Explore your data</summary>'+
    '<div class="my-insights-explore-content">'+
    '<section><h3>Pick-by-pick breakdown</h3><p class="my-insights-note">Actual source P1P positions; averages require 5 picks.</p>'+
      barRows(data.pick_depth||[])+'</section>'+
    '<section><h3>Difficulty breakdown</h3>'+
      barRows((data.difficulty||[]).map(row=>({...row,label:row.band==='unknown'?'Unknown':row.band[0].toUpperCase()+row.band.slice(1)})))+
      (data.unknown_difficulty?'<p class="my-insights-note">'+number(data.unknown_difficulty)+' unknown difficulty ratings.</p>':'')+
      '</section>'+
    '<section><h3>Format breakdown</h3>'+formatsMarkup(data.formats||[],data.environment)+'</section>'+
    '<section><h3>Additional observations</h3>'+
      (extras.length?'<ul class="my-insights-observations">'+extras.map(x=>'<li>'+esc(x.text)+'</li>').join('')+'</ul>':
      '<p class="my-insights-note">No other comparison cleared the minimum sample and score-gap rules.</p>')+
      '</section>'+
    '<section><h3>Methodology</h3><p class="my-insights-note">'+
       esc(data.methodology||'Original first-encounter scored decisions only.')+'</p></section>'+
    '</div></details></div>';
}

function shell(root,state) {
  root.innerHTML='<div class="my-insights-page">'+
    '<header class="my-insights-heading"><p class="eyebrow">Your game, examined</p><h2>Your Drafting Insights</h2></header>'+
    '<div id="my-insights-dna"></div>'+
    '<div class="my-insights-controls" aria-label="Filter the decision report and Journey">'+
      '<label for="my-insights-environment">Environment<select id="my-insights-environment">'+ENVIRONMENTS.map(([key,label])=>
        '<option value="'+key+'"'+(state.environment===key?' selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
      '<label for="my-insights-period">Time period<select id="my-insights-period">'+PERIODS.map(([key,label])=>
        '<option value="'+key+'"'+(state.period===key?' selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
      '<button class="button secondary" type="button" id="my-insights-refresh">Refresh</button></div>'+
    '<div id="my-insights-result" aria-live="polite"><section class="my-pack-card"><p>Loading your private drafting decisions…</p></section></div>'+
    '<dialog id="my-insights-decision-dialog" class="my-insights-dialog" aria-label="Original saved pack">'+
      '<div data-insights-dialog-body></div></dialog></div>';
  const dialog=root.querySelector('#my-insights-decision-dialog');
  dialog?.addEventListener('close',()=>{
    state.viewTicket=(state.viewTicket||0)+1;
    const body=dialog.querySelector('[data-insights-dialog-body]');if(body)body.innerHTML='';
    const prior=state.returnFocus;
    if(prior?.isConnected)prior.focus({preventScroll:true});
    state.returnFocus=null;
  });
  root.querySelector('#my-insights-environment')?.addEventListener('change',event=>{
    state.environment=event.target.value;state.userFiltered=true;void refresh(root,state);
  });
  root.querySelector('#my-insights-period')?.addEventListener('change',event=>{
    state.period=event.target.value;state.userFiltered=true;void refresh(root,state);
  });
  root.querySelector('#my-insights-refresh')?.addEventListener('click',()=>void refresh(root,state));
}

async function refresh(root,state) {
  const ticket=++state.ticket,gen=generation;
  const dialog=root.querySelector('#my-insights-decision-dialog');
  if(dialog?.open)dialog.close();
  // Fail closed on owner/session transitions and rejected requests; never retain
  // private DNA from an earlier successfully loaded account.
  const previousDna=root.querySelector('#my-insights-dna');if(previousDna)previousDna.innerHTML='';
  if(state.lastGen!==gen){const node=root.querySelector('#my-insights-dna');if(node)node.innerHTML='';state.lastGen=gen;state.autoMatched=false;}
  // Preserve keyboard focus in filters rather than replacing the whole panel.
  const result=root.querySelector('#my-insights-result');
  if(result)result.innerHTML='<section class="my-pack-card"><p role="status">Loading your private drafting decisions…</p></section>';
  try {
    const response=await loadMyInsights({environment:state.environment,period:state.period});
    if(gen!==generation||ticket!==state.ticket||!root.isConnected)return;
    if(!state.userFiltered&&!state.autoMatched&&ENVIRONMENTS.some(x=>x[0]===response.default_environment)&&
       response.default_environment!==state.environment){
      state.autoMatched=true;state.environment=response.default_environment;
      const picker=root.querySelector('#my-insights-environment');if(picker)picker.value=state.environment;
      void refresh(root,state);return;
    }
    const dna=root.querySelector('#my-insights-dna');if(dna)dna.innerHTML=dnaMarkup(response);
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
  const state={environment:'mixed',period:'all',ticket:0,userFiltered:false,autoMatched:false,lastGen:generation,viewTicket:0,returnFocus:null};
  mounted.set(root,state);
  shell(root,state);
  void refresh(root,state);
}
