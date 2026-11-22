// Show familiar short metrics first; retain the complete original analytics in details.
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const fmt=value=>value==null||!Number.isFinite(Number(value))?'Unavailable':Number(value).toLocaleString();
const pct=value=>value==null||!Number.isFinite(Number(value))?'Unavailable':Number(value).toFixed(1)+'%';
const formats={debate:'Debate Short',featured_v1:'Earlier featured Short',daily_generic:'Generic 10-second Short',other:'Other'};
export function youtubeReportMarkup(data){
  if(!data?.configured)return '<p class="muted">YouTube Analytics is not connected.</p>';
  if(data.error)return '<p class="error" role="alert">'+esc(data.error)+'</p>';
  const videos=Array.isArray(data.videos)?data.videos:[];
  if(!videos.length)return '<p class="muted">No Shorts in the last 60 days.</p>';
  const title=video=>esc(video.title||String(video.published_at||'').slice(0,10));
  const quick=videos.slice(0,15).map(v=>'<tr><th>'+title(v)+'</th><td>'+fmt(v.views)+'</td><td>'+fmt(v.engaged_views)+'</td><td>'+pct(v.average_view_pct)+'</td><td>'+fmt(v.likes)+'</td></tr>').join('');
  const points=Array.isArray(data.retention_points)?data.retention_points:[];
  const detailed=videos.map(v=>'<tr><th>'+esc(String(v.published_at||'').slice(0,10))+'<small>'+title(v)+'</small></th>'+
    '<td>'+esc(formats[v.format]||v.format||'Other')+'</td><td>'+fmt(v.views)+'</td>'+
    '<td>'+fmt(v.engaged_views)+'</td><td>'+esc(v.average_view_seconds==null?'Unavailable':fmt(v.average_view_seconds)+'s')+'</td>'+
    '<td>'+pct(v.average_view_pct)+'</td>'+points.map(p=>'<td>'+esc(v.retention?pct(v.retention[p]):'N/A')+'</td>').join('')+
    '<td>'+fmt(v.likes)+'</td><td>'+fmt(v.shares)+'</td><td>'+fmt(v.subscribers_gained)+'</td></tr>').join('');
  const updated=data.generated_at&&Number.isFinite(Date.parse(data.generated_at))?
    ' Updated '+esc(new Date(data.generated_at).toLocaleString())+'.':'';
  return '<div class="scroll"><table><thead><tr><th>Short</th><th>Views</th><th>Engaged views</th><th>Average watched</th><th>Likes</th></tr></thead><tbody>'+quick+'</tbody></table></div>'+
    '<p class="subpage-help">Latest '+Math.min(15,videos.length)+' Shorts. Open the full report for watch time, when viewers leave, and new subscribers.</p>'+
    '<details class="admin-method" id="youtube-full-report"><summary>All Shorts details: watch time and subscribers ('+videos.length+' Shorts)</summary>'+
    '<div class="scroll"><table><thead><tr><th>Published / Short</th><th>Format</th><th>Views</th><th>Engaged views</th><th>Average watch time</th><th>Average watched</th>'+
    points.map(p=>'<th>Still watching at '+esc(p)+'</th>').join('')+
    '<th>Likes</th><th>Shares</th><th>Subscribers gained</th></tr></thead><tbody>'+detailed+'</tbody></table></div>'+
    '<p class="subpage-help">The watch-time checkpoints apply to 20-second debate Shorts; other formats show N/A. Engaged views may be unavailable if YouTube does not return them.'+updated+'</p></details>';
}
