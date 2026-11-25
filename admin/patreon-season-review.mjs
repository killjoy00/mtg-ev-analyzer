// Owner review and private mobile capture share this exact editorial markup.
 // No database/Node dependencies or private data in browser code.
import {sortPackByRarity} from '../replay-data.mjs';
const colors={W:'White',U:'Blue',B:'Black',R:'Red',G:'Green'};
const colorLabel=c=>[...'WUBRG'].filter(x=>c.includes(x)).map(x=>colors[x]).join('–');
const imageUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='cards.scryfall.io'&&!u.port&&!u.username&&!u.password&&/^\/(normal|large|png)\/front\//.test(u.pathname)?u.href:null;}catch{return null;}};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rate=v=>{if(!Number.isFinite(v)||v<0||v>100)throw Error('season-invalid-rate');return v.toFixed(1)+'%';};
const count=v=>{if(!Number.isSafeInteger(v)||v<0)throw Error('season-invalid-count');return v.toLocaleString('en-US');};
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
export function midseasonGuideContent(a){
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
 return thesis+compare+packs+
  '<h2>What to do in your next draft</h2><section class="weekly-perfect">'+i.takeaways.map(x=>'<div>'+esc(x)+'</div>').join('')+'</section>'+
  '<h2>Observed Draft Results</h2><p>17Lands Premier Draft · all users · '+count(o.colorCount)+' main colors · no splashes. '+(o.period==='DATE_RANGE'?'Games '+esc(o.startDate)+' to '+esc(o.endDate)+'. ':'All-time snapshot. ')+'Retrieved '+esc(o.retrievedOn)+'.</p>'+
  '<section class="weekly-perfect">'+results+'<div><strong>Same-sample baseline: '+rate(o.baseline.pct)+'</strong> · '+count(o.baseline.games)+' games</div></section>'+
  '<p class="weekly-note">'+count(d.coverage.decisions)+' eligible Latest Set decisions across '+count(d.coverage.days)+' days screened for related examples. The Pack One sample is selected, not random. Player response shares, trophy choices, model preferences and 17Lands game outcomes are separate measures. Color results are not card-level win rates or proof of causation.</p>';
}

export function seasonGuideReviewMarkup(d){
 const a=d?.article;
 if(a?.kind!=='midseason-guide')throw Error('guide-review-invalid');
 return '<article class="subpage-section weekly-article"><h3>'+esc(d.title)+'</h3><p>'+esc(a.start)+' to '+esc(a.end)+'</p>'+midseasonGuideContent(a)+'<h4>Exact caption</h4><pre style="white-space:pre-wrap">'+esc(d.body)+'</pre></article>';
}
