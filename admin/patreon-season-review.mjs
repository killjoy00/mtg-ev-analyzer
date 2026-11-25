// Owner-only preview of the exact frozen aggregate evidence. No names.
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const img=c=>{
 try{const u=new URL(c.image_url);if(u.protocol!=='https:'||u.hostname!=='cards.scryfall.io'||u.username||u.password||u.port||!/^\/(?:normal|large|png|small|border_crop|art_crop)\/front\//.test(u.pathname))return esc(c.name);return '<figure style="display:inline-block;width:105px;vertical-align:top;margin:6px"><img width="100" loading="lazy" alt="'+esc(c.name)+'" src="'+esc(u.href)+'"><figcaption>'+esc(c.name)+'</figcaption></figure>';}catch{return esc(c.name);}
};
const stat=(name,s)=>'<tr><th scope="row">'+esc(name)+'</th><td>'+esc(s.decisions)+'</td><td>'+esc(s.responses)+'</td><td>'+esc(s.trophyPct)+'%</td><td>'+esc(s.modelPct)+'%</td><td>'+esc(s.modelTrophyPct)+'%</td></tr>';
export function seasonGuideReviewMarkup(d){
 const a=d?.article;
 if(a?.kind!=='midseason-guide'||!a.decisions||!a.outcomes)throw Error('guide-review-invalid');
 const v=a.decisions,o=a.outcomes;
 return '<article class="subpage-section"><p><strong>'+esc(d.title)+'</strong></p><p>'+esc(a.start)+' to '+esc(a.end)+' · '+esc(v.coverage.decisions)+' decisions over '+esc(v.coverage.days)+' days</p>'+
 '<h4>Early vs. later picks</h4><div style="overflow:auto"><table><thead><tr><th>Stage</th><th>Decisions</th><th>Responses</th><th>Trophy match</th><th>Model match</th><th>Model / trophy agree</th></tr></thead><tbody>'+stat('P1P1–3',v.early)+stat('P1P4+',v.later)+'</tbody></table></div>'+
 '<p>These are player response shares and per-decision agreement, not win rates.</p><h4>Two packs to revisit</h4>'+v.examples.map(e=>'<section><h5>P1P'+esc(e.pick)+' · '+esc(e.day)+'</h5><p>Trophy: '+esc(e.candidates.find(c=>c.id===e.trophyId)?.name)+' · '+esc(e.trophyVotes)+' / '+esc(e.total)+' responses. Model: '+esc(e.candidates.find(c=>c.id===e.modelId)?.name)+' · '+esc(e.modelVotes)+' / '+esc(e.total)+' responses.</p><p>Earlier picks:</p>'+e.prior.map(img).join('')+'<p>Pack:</p>'+e.candidates.map(img).join('')+'</section>').join('')+
 '<h4>Observed game outcomes</h4><p>17Lands Premier Draft · all users · '+esc(o.colorCount)+' main colors · no splashes · retrieved '+esc(o.retrievedOn)+'</p><table><thead><tr><th>Colors</th><th>Win rate</th><th>Wins</th><th>Games</th></tr></thead><tbody>'+o.rows.map(r=>'<tr><th>'+esc(r.colors)+'</th><td>'+esc(r.pct)+'%</td><td>'+esc(r.wins)+'</td><td>'+esc(r.games)+'</td></tr>').join('')+'<tr><th>Baseline</th><td>'+esc(o.baseline.pct)+'%</td><td>'+esc(o.baseline.wins)+'</td><td>'+esc(o.baseline.games)+'</td></tr></tbody></table><p>Color results do not establish causation. Avoid forcing colors.</p><h4>Exact caption</h4><pre style="white-space:pre-wrap">'+esc(d.body)+'</pre></article>';
}
