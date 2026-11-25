// Render privately in memory using the approved Pack One weekly brand/layout.
// No publication side effects and no CLI.
import {midseasonGuideContent} from '../admin/patreon-season-review.mjs';
import {FORMATS} from './pack-one-weekly-data.mjs';
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
export function midseasonGuideMarkup(a,brand){return frame(a,brand,'Midseason Set Guide',midseasonGuideContent(a));}
export function seasonEditorialHtml(a,brand){
 return weeklyDocument(a.kind==='season-results'?seasonResultsMarkup(a,brand):midseasonGuideMarkup(a,brand),brand);
}
export function captureSeasonEditorial(a,options={}){
 return captureWeeklyRecap(a,{...options,renderHtml:seasonEditorialHtml});
}
