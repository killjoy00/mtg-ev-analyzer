// Private publication presentation only. The content/receipts are unchanged.
import {midseasonGuideContent,seasonEditorialStyles} from '../admin/patreon-season-review.mjs';
import {FORMATS} from './pack-one-weekly-data.mjs';
import {captureWeeklyRecap,STORE_LINKS} from './pack-one-weekly-render.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={mixed:'Draft Run','powered-cube':'Powered Cube',latest:'Latest Set'};
const count=v=>{if(!Number.isSafeInteger(v)||v<0)throw Error('season-invalid-count');return v.toLocaleString('en-US');};
const n=v=>{if(v===null||!Number.isFinite(Number(v)))throw Error('season-invalid-score');return Number(v).toFixed(1);};
const date=v=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}).format(new Date(v+'T12:00:00Z'));
const names=rows=>rows.map(r=>esc(r.name)).join(', ');
const columns=widths=>'<colgroup>'+widths.map(w=>'<col style="width:'+w+'%">').join('')+'</colgroup>';
const table=(headers,rows,{widths=[],className=''}={})=>'<table class="edition-table '+className+'">'+(widths.length?columns(widths):'')+'<thead><tr>'+headers.map((h,i)=>'<th scope="col"'+(className==='edition-standing'&&i===1?' class="edition-name"':'')+'>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table>';
const frame=(a,brand,series,title,subtitle,content)=>'<main class="weekly-article season-editorial"><header class="weekly-header"><img src="'+esc(brand.logo)+'" alt="Pack One"><span class="edition-wordmark">Pack One<small>Daily draft challenge</small></span><span class="edition-tag">'+(a.kind==='season-results'?'Season finale':'Set guide')+'</span></header><p class="edition-eyebrow">'+esc(series)+(a.kind==='midseason-guide'?' · '+esc(a.seasonName):'')+'</p><h1>'+esc(title)+'</h1><p class="edition-subtitle">'+esc(subtitle)+'</p><p class="weekly-date">'+esc(date(a.start))+' – '+esc(date(a.end))+'</p>'+content+
 '<footer class="weekly-footer" id="weekly-footer"><a class="weekly-web" href="'+STORE_LINKS.web+'">Play Pack One at packone.pro</a><p class="weekly-note">A new daily draft challenge. Every day.</p><div class="weekly-badges"><a class="ios" href="'+STORE_LINKS.ios+'"><img src="'+esc(brand.ios)+'" alt="Download on the App Store"></a><a class="android" href="'+STORE_LINKS.android+'"><img src="'+esc(brand.android)+'" alt="Get it on Google Play"></a></div></footer></main>';
function raceLine(r){
 if(!r)return '';
 const winner=r.winners.map(esc).join(' and ');
 if(r.winners.length>1)return '<p class="season-race-note"><strong>'+winner+'</strong> share first place on season rating.</p>';
 const margin=r.margin===null?'':r.margin<.1?' The margin was less than 0.1 rating points.':' The winning margin was '+n(r.margin)+' rating points.';
 return '<p class="season-race-note"><strong>'+winner+'</strong> finished first with a '+n(r.average)+' average over '+count(r.days)+' Dailies.'+margin+'</p>';
}
function standing(board,race){
 const rows=board.rows.filter(r=>r.rank>=1&&r.rank<=5);
 return '<section class="run-board" id="season-'+esc(board.environment)+'"><h3>'+esc(labels[board.environment])+'</h3>'+raceLine(race)+(rows.length?table(['Rank','Player','Days','Avg.','Rating'],rows.map(r=>'<tr'+(r.rank===1?' class="weekly-winner"':'')+'><td>'+count(r.rank)+'</td><td class="edition-name">'+esc(r.name)+'</td><td>'+count(r.days)+'</td><td>'+n(r.average_score)+'</td><td>'+n(r.score)+'</td></tr>').join(''),{widths:[11,43,14,15,17],className:'edition-standing'}):'<p class="weekly-note">No eligible standings.</p>')+'</section>';
}
const awardRow=(label,detail,value)=>'<div class="edition-row"><div><small>'+esc(label)+'</small><strong>'+esc(detail)+'</strong></div><b>'+esc(value)+'</b></div>';
export function seasonResultsMarkup(a,brand){
 if(a.kind!=='season-results'||!Array.isArray(a.seasonBoards)||!Array.isArray(a.perfectAwards))throw Error('season-invalid-article');
 const w=a.wrap,races=a.races||[],all=a.allRounders||[];
 const summary=w?'<h2>'+esc(a.seasonName)+' in numbers</h2><div class="weekly-summary">'+[[w.summary.players,'Unique eligible players'],[w.summary.completed,'Completed Dailies'],[w.summary.perfect,'Perfect scores']].map(([value,label])=>'<div><strong>'+count(value)+'</strong><small>'+label+'</small></div>').join('')+'</div>'+
  (w.summary.completed>0?'<p class="weekly-note">'+n(w.summary.perfect/w.summary.completed*100)+'% of eligible completed Dailies earned a score of 100.</p>':'')+
  table(['Format','Players','Dailies','Perfect','Avg.'],w.formats.map(f=>'<tr><td>'+esc(labels[f.environment])+'</td><td>'+count(f.players)+'</td><td>'+count(f.completed)+'</td><td>'+count(f.perfect)+'</td><td>'+(f.average===null?'—':n(f.average))+'</td></tr>').join(''),{widths:[34,17,18,16,15]})+
  '<p class="weekly-note">Counts cover eligible ranked first attempts; players are counted once across all formats.</p>':'';
 const boards=FORMATS.map(environment=>{
  const board=a.seasonBoards.find(b=>b.environment===environment);
  if(!board)throw Error('season-missing-board');
  return standing(board,races.find(r=>r.environment===environment));
 }).join('');
 const perfect=FORMATS.map(environment=>{
  const rows=a.perfectAwards.filter(p=>p.environment===environment);
  return rows.length?awardRow(labels[environment],rows.map(r=>r.name).join(', '),count(rows[0].days)+' perfect'):'';
 }).join('');
 const attend=w?.attendance||[],every=attend.filter(r=>r.everyDaily);
 const most=attend.length?'<h3>Most Dailies Completed</h3><div class="edition-rows">'+awardRow('All three formats',attend.map(r=>r.name).join(', '),count(attend[0].completed)+' Dailies')+'</div>'+(every.length?'<section class="edition-recognition"><h3>The every-Daily club</h3><p>'+names(every)+' completed all '+count(w.scheduled)+' eligible scheduled Dailies.</p></section>':''):'';
 const versatile=all.length?'<h3>Top Five in All Three</h3>'+table(['Player','Draft Run','Cube','Latest Set'],all.map(r=>'<tr><td>'+esc(r.name)+'</td>'+FORMATS.map(environment=>'<td>#'+count(r.ranks.find(x=>x.environment===environment).rank)+'</td>').join('')+'</tr>').join(''),{widths:[43,19,15,23]}):'';
 const hardest=w?.toughest?.length?'<h2>Toughest Dailies</h2>'+table(['Format','Date','Avg.','Players'],w.toughest.map(r=>'<tr><td>'+esc(labels[r.environment])+'</td><td>'+esc(new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(r.day+'T12:00:00Z')))+'</td><td>'+n(r.average)+'</td><td>'+count(r.completed)+'</td></tr>').join(''),{widths:[38,25,18,19]})+'<p class="weekly-note">Lowest average among days with at least 25 eligible completions; earliest date breaks an exact tie.</p>':'';
 return frame(a,brand,'Season Results & Awards',"That's a wrap, "+a.seasonName+'.','Final standings, season champions and the players who kept showing up.',summary+'<h2>Season champions & final standings</h2>'+boards+
  '<p class="weekly-note">Ranked by season rating. All ties through fifth place are included.</p>'+
  (perfect||most||versatile?'<h2>Season Awards</h2>':'')+(perfect?'<h3>Most Perfect Dailies</h3><section class="edition-rows" id="perfect-dailies">'+perfect+'</section><p class="weekly-note">Days with a score of 100. All tied leaders are included.</p>':'')+most+versatile+hardest+'<h2>See you in the next season.</h2><p>Thanks to everyone who played!</p>');
}
export function midseasonGuideMarkup(a,brand){
 if(!a.decisions?.insight)throw Error('guide-invalid-article');
 return frame(a,brand,'Midseason Set Guide',a.decisions.insight.title,'Where the format is working, what each deck needs, and when to change direction.',midseasonGuideContent(a));
}
export function seasonEditorialHtml(a,brand){
 // Bundled brand fonts/assets remain exactly those of the existing weekly
 // publisher. Use edition-only overrides rather than changing weekly/Lab.
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+brand.css+'\nhtml,body{margin:0!important;padding:0!important;background:#f7f8fa!important;color:#101820!important}'+seasonEditorialStyles+'</style></head><body>'+(a.kind==='season-results'?seasonResultsMarkup(a,brand):midseasonGuideMarkup(a,brand))+'</body></html>';
}
export function captureSeasonEditorial(a,options={}){
 return captureWeeklyRecap(a,{...options,renderHtml:seasonEditorialHtml});
}
