// Expanded view of the existing Daily habits report. No new cohort arithmetic.
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const fmt=value=>value==null||!Number.isFinite(Number(value))?'Unavailable':Number(value).toLocaleString();
const rate=(row,label,numerator,denominator,immature)=>{
  const val=row[label]==null?'Unavailable':Number(row[label]).toFixed(1)+'%';
  return esc(val)+'<small>'+fmt(row[numerator])+' of '+fmt(row[denominator])+' eligible · '+fmt(row[immature])+' still waiting</small>';
};
export function habitsDetailsMarkup(metrics){
  const cohorts=Array.isArray(metrics?.cohorts)?metrics.cohorts:[];
  const days=Array.isArray(metrics?.daily_health)?metrics.daily_health:[];
  const rows=cohorts.map(row=>'<tr><th>'+esc(row.source||'direct')+' / '+esc(row.campaign||'(none)')+'</th>'+
    '<td>'+fmt(row.cohort_people)+'</td>'+
    '<td>'+rate(row,'next_day_rate','next_day_returned','next_day_mature','next_day_immature')+'</td>'+
    '<td>'+rate(row,'seven_day_rate','seven_day_returned','seven_day_mature','seven_day_immature')+'</td>'+
    '<td>'+rate(row,'three_in_seven_rate','three_in_seven_reached','three_in_seven_mature','three_in_seven_immature')+'</td>'+
    '<td>'+esc(row.ever_three_in_seven_rate==null?'Unavailable':Number(row.ever_three_in_seven_rate).toFixed(1)+'%')+
       '<small>'+fmt(row.ever_three_in_seven_people)+' of '+fmt(row.cohort_people)+' ever reached 3-in-7</small></td></tr>').join('');
  const history=days.map(row=>'<tr><th>'+esc(row.day)+'</th><td>'+fmt(row.people)+'</td></tr>').join('');
  return '<h3>First-Daily cohorts by campaign</h3>'+
    '<p class="subpage-help">We only count players who have had enough time to return. “Ever 3-in-7” means playing on three different days during any seven-day stretch, even if it happened later.</p>'+
    '<div class="scroll"><table><thead><tr><th>First source / campaign</th><th>First Daily players</th><th>Next day</th><th>Within 7 days</th><th>3 days in first week</th><th>Ever 3-in-7</th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="6">No first-Daily cohorts during this period.</td></tr>')+'</tbody></table></div>'+
    '<h3>Rolling seven-day activity</h3>'+
    '<p class="subpage-help">For each date: players who completed Dailies on at least three different days in the seven days ending on that date. This includes returning players whose first Daily was earlier.</p>'+
    '<div class="scroll"><table><thead><tr><th>Pacific date</th><th>Players with 3+ Daily days in the last 7</th></tr></thead><tbody>'+
    (history||'<tr><td colspan="2">No rolling-week data during this period.</td></tr>')+'</tbody></table></div>';
}
