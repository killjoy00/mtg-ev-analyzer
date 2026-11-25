// Render privately in memory using the approved Pack One weekly brand/layout.
// No publication side effects and no CLI.
import {colorLabel} from './pack-one-guide-insight.mjs';
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
const names=rows=>rows.map(r=>esc(r.name)).join(', ');
function raceLine(r){
 if(!r)return '';
 const winner=r.winners.map(esc).join(' and ');
 if(r.winners.length>1)return '<p><strong>'+winner+'</strong> share first place on season rating.</p>';
 const margin=r.margin===null?'':r.margin<.1?' The margin was less than 0.1 rating points.':' The winning margin was '+r.margin.toFixed(1)+' rating points.';
 return '<p><strong>'+winner+'</strong> finished first with a '+Number(r.average).toFixed(1)+' average over '+count(r.days)+' Dailies.'+margin+'</p>';
}
export function seasonResultsMarkup(a,brand){
 if(a.kind!=='season-results'||!Array.isArray(a.seasonBoards)||!Array.isArray(a.perfectAwards))throw Error('season-invalid-article');
 const w=a.wrap,races=a.races||[],all=a.allRounders||[];
 const summary=w?'<h2>The season in numbers</h2><div class="weekly-summary">'+[[w.summary.players,'Players'],[w.summary.completed,'Completed Dailies'],[w.summary.perfect,'Perfect scores']].map(([value,label])=>'<div><strong>'+count(value)+'</strong><small>'+label+'</small></div>').join('')+'</div><section class="weekly-perfect">'+w.formats.map(f=>'<div><strong>'+esc(labels[f.environment])+'</strong><br>'+count(f.players)+' players · '+count(f.completed)+' Dailies · '+count(f.perfect)+' perfect scores'+(f.average===null?'':' · '+f.average.toFixed(1)+' average')+'</div>').join('')+'</section><p class="weekly-note">Counts cover eligible ranked first attempts; players are counted once across all formats.</p>':'';
 const boards=FORMATS.map(environment=>{
  const board=a.seasonBoards.find(b=>b.environment===environment);
  if(!board)throw Error('season-missing-board');
  return '<section class="season-race">'+raceLine(races.find(r=>r.environment===environment))+leaderboardMarkup(board,{kind:'season',seasonName:a.seasonName,highlightWinners:true})+'</section>';
 }).join('');
 const perfect=FORMATS.map(environment=>{
  const rows=a.perfectAwards.filter(p=>p.environment===environment);
  return rows.length?'<div><strong>'+esc(labels[environment])+'</strong><p>'+rows.map(r=>esc(r.name)+' · '+count(r.days)).join('<br>')+'</p></div>':'';
 }).join('');
 const attend=w?.attendance||[],every=attend.filter(r=>r.everyDaily);
 const most=attend.length?'<h3>Most Dailies Completed</h3><section class="weekly-perfect"><div><strong>'+names(attend)+'</strong><p>'+count(attend[0].completed)+' completed Dailies across all three formats.</p></div>'+(every.length?'<div><strong>The every-Daily club</strong><p>'+names(every)+' completed all '+count(w.scheduled)+' eligible scheduled Dailies.</p></div>':'')+'</section>':'';
 const versatile=all.length?'<h3>Top Five in All Three</h3><section class="weekly-perfect">'+all.map(r=>'<div><strong>'+esc(r.name)+'</strong><p>'+r.ranks.map(x=>esc(labels[x.environment])+' #'+count(x.rank)).join(' · ')+'</p></div>').join('')+'</section>':'';
 const hardest=w?.toughest?.length?'<h2>Toughest Dailies</h2><section class="weekly-perfect">'+w.toughest.map(r=>'<div><strong>'+esc(labels[r.environment])+' · '+esc(r.day)+'</strong><p>'+r.average.toFixed(1)+' average score · '+count(r.completed)+' completed Dailies</p></div>').join('')+'</section><p class="weekly-note">Lowest average among days with at least 25 eligible completions; earliest date breaks an exact tie.</p>':'';
 return frame(a,brand,'Season Results & Awards','<p>That’s a wrap, '+esc(a.seasonName)+'. Thanks for playing!</p>'+summary+'<h2>Championship races & final standings</h2>'+boards+
  '<p class="weekly-note">Ranked by season rating. All ties through fifth place are included.</p>'+
  (perfect||most||versatile?'<h2>Season Awards</h2>':'')+(perfect?'<h3>Most Perfect Dailies</h3><section class="weekly-perfect" id="perfect-dailies">'+perfect+'</section><p class="weekly-note">Days with a score of 100. All tied leaders are included.</p>':'')+most+versatile+hardest);
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
 return '<section class="weekly-pack draft-run-page"><h3>P1P'+count(e.pick)+' · '+esc(e.day)+'</h3><p>Trophy choice: '+esc(e.candidates.find(c=>c.id===e.trophyId).name)+' ('+rate(Math.round(1000*e.trophyVotes/e.total)/10)+' of '+count(e.total)+' responses). Model preference: '+esc(e.candidates.find(c=>c.id===e.modelId).name)+' ('+rate(Math.round(1000*e.modelVotes/e.total)/10)+' of responses).</p>'+earlier+'<h4>Pack</h4><div class="run-cards">'+cards+'</div></section>';
}
function planBlock(row,plan){
 return '<div><h3>'+esc(colorLabel(row.colors))+' · '+rate(row.pct)+'</h3><p><strong>'+esc(plan.name)+'</strong> — '+esc(plan.plan)+' '+esc(plan.detail)+'</p><p class="weekly-note">'+count(row.games)+' games</p></div>';
}
export function midseasonGuideMarkup(a,brand){
 if(a.kind!=='midseason-guide'||!a.decisions?.insight||!a.outcomes)throw Error('guide-invalid-article');
 const d=a.decisions,o=a.outcomes,i=d.insight;
 if(i.theme!=='shared-color-contrast'||d.examples.length!==2)throw Error('guide-invalid-insight');
 const results=o.rows.map(r=>'<div><strong>'+esc(colorLabel(r.colors))+'</strong> · '+rate(r.pct)+' · '+count(r.games)+' games</div>').join('');
 const thesis='<h2>'+esc(i.title)+'</h2><p>'+esc(colorLabel(i.higher.colors))+' won '+rate(i.higher.pct)+' of games in the sample, compared with '+rate(i.lower.pct)+' for '+esc(colorLabel(i.lower.colors))+'. Both use '+esc(i.shared.toLowerCase())+'; the gap is '+Number(i.gap).toFixed(1)+' percentage points. The '+count(o.colorCount)+'-color baseline was '+rate(o.baseline.pct)+'. Your early '+esc(i.shared.toLowerCase())+' picks do not tell you which deck you will end up in.</p>';
 const compare='<h2>What these decks need</h2><section class="weekly-perfect">'+planBlock(i.higher,i.higherPlan)+planBlock(i.lower,i.lowerPlan)+'</section>';
 const packs='<h2>Two draft decisions worth revisiting</h2><p>Both trophy drafts had at least two earlier cards in the shared color(s), then offered contrasting choices for the '+esc(i.partner)+' color. The trophy drafter and model preferred different cards. These packs illustrate the decision, not what won the games.</p>'+d.examples.map(e=>{
  if(!e.comparison)throw Error('guide-invalid-context');
  return '<p><strong>'+count(e.comparison.priorShared)+' prior '+esc(e.comparison.shared.toLowerCase())+' picks.</strong> '+esc(e.comparison.higher)+' ('+(e.comparison.higherRole==='trophy'?'trophy choice':'model preference')+') versus '+esc(e.comparison.lower)+' ('+(e.comparison.lowerRole==='trophy'?'trophy choice':'model preference')+').</p>'+exampleMarkup(e);
 }).join('');
 return frame(a,brand,'Midseason Set Guide',thesis+compare+packs+
  '<h2>What to do in your next draft</h2><section class="weekly-perfect">'+i.takeaways.map(x=>'<div>'+esc(x)+'</div>').join('')+'</section>'+
  '<h2>Observed Draft Results</h2><p>17Lands Premier Draft · all users · '+count(o.colorCount)+' main colors · no splashes. '+(o.period==='DATE_RANGE'?'Games '+esc(o.startDate)+' to '+esc(o.endDate)+'. ':'All-time snapshot. ')+'Retrieved '+esc(o.retrievedOn)+'.</p>'+
  '<section class="weekly-perfect">'+results+'<div><strong>Same-sample baseline: '+rate(o.baseline.pct)+'</strong> · '+count(o.baseline.games)+' games</div></section>'+
  '<p class="weekly-note">'+count(d.coverage.decisions)+' eligible Latest Set decisions across '+count(d.coverage.days)+' days screened for related examples. The Pack One sample is selected, not random. Player response shares, trophy choices, model preferences and 17Lands game outcomes are separate measures. Color results are not card-level win rates or proof of causation.</p>');
}
export function seasonEditorialHtml(a,brand){
 return weeklyDocument(a.kind==='season-results'?seasonResultsMarkup(a,brand):midseasonGuideMarkup(a,brand),brand);
}
export function captureSeasonEditorial(a,options={}){
 return captureWeeklyRecap(a,{...options,renderHtml:seasonEditorialHtml});
}
