// Registered-account totals only; the existing Habits panel covers guests.
const num=value=>Number(value).toLocaleString();
const pct=(n,d)=>d?((100*n/d).toFixed(1)+'%'):'Not enough data';

export function playerLifecycleMarkup(data){
 const c=data?.counts;
 const keys=['registered_accounts','never_daily','one_play_day','returned_another_day',
  'signed_up_after_play','never_after_signup',...['7','14','30'].flatMap(d=>['eligible_','no_return_','returned_'].map(prefix=>prefix+d))];
 if(!c||keys.some(k=>!Number.isFinite(Number(c[k]))))return '<p>Account report unavailable.</p>';
 const card=(label,value,detail)=>'<div class="card"><span>'+label+'</span><strong>'+num(value)+'</strong><small>'+detail+'</small></div>';
 const row=days=>{
  const eligible=c['eligible_'+days],noReturn=c['no_return_'+days],returned=c['returned_'+days];
  return '<tr><th>'+days+' days</th><td>'+num(eligible)+'</td><td>'+
   (eligible?num(noReturn)+' ('+pct(noReturn,eligible)+')':'Not enough data')+
   '</td><td>'+num(returned)+'</td></tr>';
 };
 return '<p class="subpage-help">All registered accounts, including play linked from an earlier guest session. '+num(c.registered_accounts)+' eligible accounts; test, admin and deleting accounts excluded.</p>'+
  '<div class="cards">'+
   card('Signed up, never played',c.never_daily,'No completed Daily on this account')+
   card('Signed up after playing, never came back',c.never_after_signup,
    'Of '+num(c.signed_up_after_play)+' accounts that had played by their signup day')+
   card('Played on just one day',c.one_play_day,
    'Across all account play; '+num(c.returned_another_day)+' returned on another day')+
   '</div>'+
   '<details class="admin-method"><summary>Returns after signup: 7, 14 and 30 days</summary>'+
   '<p>For accounts that had already completed a Daily by their signup day. A return is a completed Daily on a later Pacific date. Recent signups count only when the whole window has passed.</p>'+
   '<div class="scroll"><table><thead><tr><th>Window</th><th>Eligible accounts</th><th>No return</th><th>Returned</th></tr></thead><tbody>'+
   row('7')+row('14')+row('30')+'</tbody></table></div>'+
   '</details>'+
   '<p class="subpage-help">Finishing all three Dailies on one date is still one play day. This account report is all-time; the first-Daily filter above controls the separate cohort report.</p>';
}
