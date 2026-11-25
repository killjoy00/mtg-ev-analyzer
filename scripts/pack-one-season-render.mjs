// Render privately in memory using the approved Pack One weekly brand/layout.
// No publication side effects and no CLI.
import {FORMATS} from './pack-one-weekly-data.mjs';
import {imageUrl} from './featured-pick.mjs';
import {sortPackByRarity} from '../replay-data.mjs';
import {leaderboardMarkup,weeklyDocument,captureWeeklyRecap,STORE_LINKS} from './pack-one-weekly-render.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={mixed:'Draft Run','powered-cube':'Powered Cube',latest:'Latest Set'};
const rate=v=>{if(!Number.isFinite(v)||v<0||v>100)throw Error('season-invalid-rate');return v.toFixed(1)+'%';};
const count=v=>{if(!Number.isSafeInteger(v)||v<0)throw Error('season-invalid-count');return v.toLocaleString('en-US');};
const frame=(a,brand,title,content)=>'<main class="weekly-article"><header class="weekly-header"><img src="'+esc(brand.logo)+'" alt="Pack One"><span>Pack One</span></header><h1>'+esc(title)+'</h1><h2>'+esc(a.seasonName)+'</h2><p class="weekly-date">'+esc(a.start)+' to '+esc(a.end)+'</p>'+content+
 '<footer class="weekly-footer" id="weekly-footer"><a class="weekly-web" href="'+STORE_LINKS.web+'">Play Pack One · packone.pro</a><div class="weekly-badges"><a class="ios" href="'+STORE_LINKS.ios+'"><img src="'+esc(brand.ios)+'" alt="Download on the App Store"></a><a class="android" href="'+STORE_LINKS.android+'"><img src="'+esc(brand.android)+'" alt="Get it on Google Play"></a></div></footer></main>';
export function seasonResultsMarkup(a,brand){
 if(a.kind!=='season-results'||!Array.isArray(a.seasonBoards)||!Array.isArray(a.perfectAwards))throw Error('season-invalid-article');
 const boards=FORMATS.map(environment=>{
  const board=a.seasonBoards.find(b=>b.environment===environment);
  if(!board)throw Error('season-missing-board');
  return leaderboardMarkup(board,{kind:'season',seasonName:a.seasonName,highlightWinners:true});
 }).join('');
 const awards=FORMATS.map(environment=>{
  const rows=a.perfectAwards.filter(p=>p.environment===environment);
  return rows.length?'<div><strong>'+esc(labels[environment])+'</strong><p>'+rows.map(r=>esc(r.name)+' · '+count(r.days)).join('<br>')+'</p></div>':'';
 }).join('');
 return frame(a,brand,'Season Results & Awards','<h2>Season Champions & Final Standings</h2>'+boards+
  '<p class="weekly-note">All eligible Dailies; ranked by season rating. All ties through fifth place are included. First place is highlighted.</p>'+
  (awards?'<h2>Most Perfect Dailies</h2><section class="weekly-perfect" id="perfect-dailies">'+awards+'</section><p class="weekly-note">Days with a score of 100. All leaders tied for the highest count are shown.</p>':''));
}
const image=c=>{const src=imageUrl(c.image_url);if(!src)throw Error('season-invalid-art');return '<img src="'+esc(src)+'" alt="'+esc(c.name)+'">';};
function exampleMarkup(e){
 if(!e.candidates.some(c=>c.id===e.trophyId)||!e.candidates.some(c=>c.id===e.modelId)||e.prior.length!==e.pick-1)throw Error('guide-invalid-example');
 const earlier=e.prior.length?'<h4>Earlier picks</h4><div class="run-pool-cards">'+e.prior.map(c=>'<figure>'+image(c)+'<span>'+esc(c.name)+'</span></figure>').join('')+'</div>':'<p>First pick of the draft.</p>';
 const cards=sortPackByRarity(e.candidates).map(c=>{
  const trophy=c.id===e.trophyId,model=c.id===e.modelId;
  return '<article class="run-card'+(trophy?' trophy-pick':'')+'"><div class="run-card-select">'+image(c)+'</div><span class="run-card-name">'+esc(c.name)+'</span>'+
   (trophy||model?'<span class="run-card-outcome">'+(trophy?'Trophy pick':'')+(trophy&&model?' · ':'')+(model?'Model preference':'')+'</span>':'')+'</article>';
 }).join('');
 return '<section class="weekly-pack draft-run-page"><h3>P1P'+count(e.pick)+' · '+esc(e.day)+'</h3><p>Trophy choice: '+rate(Math.round(1000*e.trophyVotes/e.total)/10)+' of responses. Model preference: '+rate(Math.round(1000*e.modelVotes/e.total)/10)+'.</p>'+earlier+'<h4>Pack</h4><div class="run-cards">'+cards+'</div></section>';
}
function stats(title,s){
 return '<section class="weekly-perfect"><h3>'+esc(title)+'</h3><div><strong>'+rate(s.trophyPct)+'</strong> matched trophy choice</div><div><strong>'+rate(s.modelPct)+'</strong> matched model preference</div><div><strong>'+rate(s.modelTrophyPct)+'</strong> of decisions had the same model and trophy choice</div><p class="weekly-note">'+count(s.decisions)+' decisions · '+count(s.responses)+' first-answer responses</p></section>';
}
export function midseasonGuideMarkup(a,brand){
 if(a.kind!=='midseason-guide'||!a.decisions||!a.outcomes)throw Error('guide-invalid-article');
 const d=a.decisions,o=a.outcomes;
 const results=o.rows.map(r=>'<div><strong>'+esc(r.colors)+'</strong> · '+rate(r.pct)+' · '+count(r.games)+' games</div>').join('');
 return frame(a,brand,'Midseason Set Guide','<p>'+count(d.coverage.decisions)+' eligible Latest Set decisions across '+count(d.coverage.days)+' days. The sample is selected for Pack One, not a random sample of all drafts.</p>'+
  '<h2>Early Picks vs. Later Picks</h2>'+stats('P1P1–P1P3',d.early)+stats('P1P4 onward',d.later)+
  '<p class="weekly-note">Player response shares and model/trophy decision agreement use different denominators. Neither measures the probability that a card wins games.</p>'+
  '<h2>Two Packs to Revisit</h2>'+d.examples.map(exampleMarkup).join('')+
  '<h2>Observed Draft Results</h2><p>17Lands Premier Draft · all users · '+count(o.colorCount)+' main colors · no splashes. All-time snapshot retrieved '+esc(o.retrievedOn)+'.</p>'+
  '<section class="weekly-perfect">'+results+'<div><strong>Same-sample baseline: '+rate(o.baseline.pct)+'</strong> · '+count(o.baseline.games)+' games</div></section>'+
  '<p>Color results are not archetype ratings or evidence that a particular pick caused a win. Compare with the same-sample baseline; avoid forcing colors.</p>');
}
export function seasonEditorialHtml(a,brand){
 return weeklyDocument(a.kind==='season-results'?seasonResultsMarkup(a,brand):midseasonGuideMarkup(a,brand),brand);
}
export function captureSeasonEditorial(a,options={}){
 return captureWeeklyRecap(a,{...options,renderHtml:seasonEditorialHtml});
}
