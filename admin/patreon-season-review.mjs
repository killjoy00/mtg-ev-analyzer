// Owner-only preview of the exact frozen aggregate evidence. No names.
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const img=c=>{
 try{const u=new URL(c.image_url);if(u.protocol!=='https:'||u.hostname!=='cards.scryfall.io'||u.username||u.password||u.port||!/^\/(?:normal|large|png|small|border_crop|art_crop)\/front\//.test(u.pathname))return esc(c.name);return '<figure style="display:inline-block;width:105px;vertical-align:top;margin:6px"><img width="100" loading="lazy" alt="'+esc(c.name)+'" src="'+esc(u.href)+'"><figcaption>'+esc(c.name)+'</figcaption></figure>';}catch{return esc(c.name);}
};
const stat=(name,s)=>'<tr><th scope="row">'+esc(name)+'</th><td>'+esc(s.decisions)+'</td><td>'+esc(s.responses)+'</td><td>'+esc(s.trophyPct)+'%</td><td>'+esc(s.modelPct)+'%</td><td>'+esc(s.modelTrophyPct)+'%</td></tr>';
export function seasonGuideReviewMarkup(d){
 const a=d?.article;
 if(a?.kind!=='midseason-guide'||!a.decisions?.insight||!a.outcomes)throw Error('guide-review-invalid');
 const v=a.decisions,o=a.outcomes,i=v.insight;
 return '<article class="subpage-section"><p><strong>'+esc(d.title)+'</strong></p><p>'+esc(a.start)+' to '+esc(a.end)+' · '+esc(v.coverage.decisions)+' decisions over '+esc(v.coverage.days)+' days</p>'+
 '<h4>'+esc(i.title)+'</h4><p>'+esc(i.higher.colors)+' '+esc(i.higher.pct)+'% vs '+esc(i.lower.colors)+' '+esc(i.lower.pct)+'% · '+esc(i.gap)+' percentage points. Baseline: '+esc(o.baseline.pct)+'%.</p>'+
 '<h4>What these decks need</h4>'+[i.higherPlan,i.lowerPlan].map(p=>'<p><strong>'+esc(p.colors)+' · '+esc(p.name)+'</strong> — '+esc(p.plan)+' '+esc(p.detail)+'</p>').join('')+
 '<h4>Two related packs</h4>'+v.examples.map(e=>'<section><h5>P1P'+esc(e.pick)+' · '+esc(e.day)+'</h5><p>'+esc(e.comparison.priorShared)+' prior '+esc(e.comparison.shared)+' picks. '+esc(e.comparison.higher)+' vs '+esc(e.comparison.lower)+'.</p><p>Trophy: '+esc(e.candidates.find(c=>c.id===e.trophyId)?.name)+' · '+esc(e.trophyVotes)+' / '+esc(e.total)+' responses. Model: '+esc(e.candidates.find(c=>c.id===e.modelId)?.name)+' · '+esc(e.modelVotes)+' / '+esc(e.total)+' responses.</p><p>Earlier picks:</p>'+e.prior.map(img).join('')+'<p>Pack:</p>'+e.candidates.map(img).join('')+'</section>').join('')+
 '<h4>What to do in your next draft</h4>'+i.takeaways.map(t=>'<p>'+esc(t)+'</p>').join('')+
 '<h4>Observed game outcomes</h4><p>17Lands Premier Draft · all users · '+esc(o.colorCount)+' main colors · no splashes · '+(o.period==='DATE_RANGE'?esc(o.startDate)+' to '+esc(o.endDate):'all-time')+' · retrieved '+esc(o.retrievedOn)+'</p><table><thead><tr><th>Colors</th><th>Win rate</th><th>Wins</th><th>Games</th></tr></thead><tbody>'+o.rows.map(r=>'<tr><th>'+esc(r.colors)+'</th><td>'+esc(r.pct)+'%</td><td>'+esc(r.wins)+'</td><td>'+esc(r.games)+'</td></tr>').join('')+'<tr><th>Baseline</th><td>'+esc(o.baseline.pct)+'%</td><td>'+esc(o.baseline.wins)+'</td><td>'+esc(o.baseline.games)+'</td></tr></tbody></table><p>Color results do not establish causation. Avoid forcing colors.</p><h4>Exact caption</h4><pre style="white-space:pre-wrap">'+esc(d.body)+'</pre></article>';
}
