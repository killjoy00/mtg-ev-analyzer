// Read-only historical Daily result-share funnel; fetched only when opened.
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const count=value=>value==null||!Number.isFinite(Number(value))?'Unavailable':Number(value).toLocaleString();
const percent=value=>value==null||!Number.isFinite(Number(value))?'Unavailable':Number(value).toFixed(1)+'%';
export function shareFunnelMarkup(data){
 const f=data?.share_funnel;
 if(!f)return '<p>Sharing report is unavailable.</p>';
 const items=[
  ['Players who completed a Daily',count(f.finishers)],
  ['Players who shared a result',count(f.sharers)],
  ['Players who shared / finishers',percent(f.share_pct)],
  ['Tracked visits from result shares',count(f.arrivals)],
  ['Unique visitors from shares',count(f.visitors)],
  ['New Dailies started from shares',count(f.starts)],
  ['Those Dailies completed',count(f.completions)],
  ['Dated share-link visits',count(f.dated_arrivals)],
  ['Share visits → Daily starts',percent(f.start_pct)],
  ['Attributed starts → completions',percent(f.completion_pct)],
  ['Image shares',count(f.image_shares)]
 ];
 return '<div class="cards">'+items.map(([label,val])=>'<div class="card"><span>'+esc(label)+'</span><strong>'+esc(val)+'</strong></div>').join('')+'</div>'+
   '<p class="subpage-help">Only sharing and link visits Pack One recorded on the website are included. Shares from the iOS and Android apps may be missing. The percentages are approximate, not proven conversion rates.</p>';
}
