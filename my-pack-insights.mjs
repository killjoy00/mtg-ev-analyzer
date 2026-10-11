import {escapeHtml as esc} from './html.mjs';
import {loadMyInsights} from './growth-api.mjs';

let generation=0;
const mounted=new WeakMap();
const ENVIRONMENTS=[['mixed','Mixed'],['latest','Latest Set'],['powered-cube','Powered Cube']];
const PERIODS=[['all','All available'],['90d','Last 90 days'],['365d','Last year']];
const score=v=>v===null||v===undefined?'Not enough to average':Number(v).toFixed(1);
const number=v=>Number(v||0).toLocaleString('en-US');

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
function observationsMarkup(data) {
  if(!data.observations?.length)return '<p class="my-pack-empty">Not enough comparable decisions yet. Written observations require at least 40 decisions per side and a 10-point gap.</p>';
  return '<ul class="my-insights-observations">'+data.observations.map(row=>'<li>'+esc(row.text)+'</li>').join('')+'</ul>';
}

function insightsContent(data) {
  if(data.unlocked!==true)return '<section class="my-pack-card" aria-live="polite"><div class="my-card-heading"><h2>Unlock your Drafting Insights</h2></div>'+
    '<p>Play a few more runs in '+esc(data.environment_label)+'. You have <strong>'+number(data.eligible_decisions)+
    ' of '+data.unlock_at+'</strong> eligible, first-time draft decisions in this period.</p>'+
    '<a class="button primary" href="/?game=draft-run&daily=1">Play today’s Daily</a></section>';
  return '<div class="my-insights-grid">'+
    '<section class="my-pack-card my-insights-wide"><div class="my-card-heading"><h2>Your patterns</h2><span>Rules-based observations</span></div>'+observationsMarkup(data)+'</section>'+
    '<section class="my-pack-card"><div class="my-card-heading"><h2>Pick-by-pick strengths</h2><span>Actual source picks</span></div>'+
      '<p class="my-insights-note">Average awarded score by real P1P pick number, not the eight-game-decision order. Each displayed average needs at least five picks.</p>'+
      barRows(data.pick_depth)+'</section>'+
    '<section class="my-pack-card"><div class="my-card-heading"><h2>Difficulty context</h2></div>'+
      '<p class="my-insights-note">Puzzle difficulty groups can contain different decisions. There is no difficulty-adjusted skill grade.</p>'+
      barRows(data.difficulty.map(row=>({...row,label:row.band==='unknown'?'Unknown':row.band[0].toUpperCase()+row.band.slice(1)})))+
      (data.unknown_difficulty?'<p class="my-insights-note">'+number(data.unknown_difficulty)+' decisions have no verified historical difficulty band.</p>':'')+
      '</section>'+
    '<section class="my-pack-card my-insights-wide"><div class="my-card-heading"><h2>Progress over time</h2><span>Most recent vs earlier picks</span></div>'+
      progressMarkup(data)+'<h3 class="my-insights-subheading">Pacific calendar months</h3>'+monthMarkup(data.months)+'</section>'+
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
