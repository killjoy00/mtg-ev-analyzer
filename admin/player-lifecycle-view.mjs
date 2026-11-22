// Read-only lifecycle cards. A play day is a distinct Pacific Daily date,
// not the number of Dailies finished on that date.
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const fmt=v=>Number(v).toLocaleString();
const pct=(n,d)=>d>0?(100*n/d).toFixed(1)+'%':'Not enough data';
const card=(title,value,description)=>'<div class="card"><span>'+esc(title)+'</span><strong>'+esc(value)+'</strong><small>'+esc(description)+'</small></div>';

export function playerLifecycleMarkup(data){
 const all=data?.all_time,cohort=data?.cohort;
 const requiredAll=['registered_accounts','registered_without_daily','daily_people','one_play_day','returned_later'];
 const requiredCohort=['first_daily_people','seven_day_eligible','seven_day_one_day_only','seven_day_returned',
  'thirty_day_eligible','thirty_day_one_day_only','thirty_day_returned'];
 if(!all||!cohort||[...requiredAll.map(k=>all[k]),...requiredCohort.map(k=>cohort[k])].some(v=>v==null||!Number.isFinite(Number(v))))
  return '<p>Player lifecycle figures are unavailable.</p>';
 const row=(window,eligible,one,returned)=>{
  const rate=pct(one,eligible);
  return '<tr><th>'+window+' after first Daily</th><td>'+fmt(eligible)+'</td>'+
   '<td>'+fmt(one)+'<small>'+rate+' one-day-only</small></td><td>'+fmt(returned)+'</td></tr>';
 };
 return '<div class="cards">'+
   card('Registered, no completed Daily',fmt(all.registered_without_daily),
    'Out of '+fmt(all.registered_accounts)+' registered accounts, excluding test and admin accounts')+
   card('Played on one day only',fmt(all.one_play_day),
    'Out of '+fmt(all.daily_people)+' people who completed a Daily, including guests')+
   card('Returned another day',fmt(all.returned_later),
    'Completed a Daily on at least two different Pacific dates')+
   '</div>'+
   '<p class="subpage-help">Three Dailies completed on Monday still count as one day. Guest play that later links to an account counts as the same person.</p>'+
   '<h3>One-day-only players in this first-Daily cohort</h3>'+
   '<p class="subpage-help">'+fmt(cohort.first_daily_people)+' people completed their first Daily in the selected dates. Only cohorts old enough for a full follow-up window are included below.</p>'+
   '<div class="scroll"><table><thead><tr><th>Window</th><th>Eligible people</th><th>Did not return in window</th><th>Returned</th></tr></thead><tbody>'+
   row('7 days',cohort.seven_day_eligible,cohort.seven_day_one_day_only,cohort.seven_day_returned)+
   row('30 days',cohort.thirty_day_eligible,cohort.thirty_day_one_day_only,cohort.thirty_day_returned)+
   '</tbody></table></div>'+
   '<p class="subpage-help">All-time play-day counts can include later returns. The 7- and 30-day rows measure returns within each window, not eventual returns at any time.</p>';
}
