// Compare existing campaign activity with existing first-Daily cohorts.
// No independent retention math or extra tracking: the Habits endpoint owns the
// eligible and returned counts and its identity / QA exclusion rules.
export const MIN_RETURN_SAMPLE=20;
const count=value=>Math.max(0,Math.trunc(Number(value)||0));
const key=row=>String(row?.source||'direct')+'\u0000'+String(row?.campaign||'(none)');

export function compareCampaigns(performance,habitCohorts=null){
  const available=Array.isArray(habitCohorts);
  const byCampaign=new Map((available?habitCohorts:[]).map(row=>[key(row),row]));
  return (Array.isArray(performance)?performance:[]).map(row=>{
    const cohort=byCampaign.get(key(row));
    const firstDaily=available?count(cohort?.cohort_people):null;
    const eligible=available?count(cohort?.seven_day_mature):null;
    const returned=available?Math.min(eligible,count(cohort?.seven_day_returned)):null;
    return {...row,firstDaily,eligible,returned,returnRate:eligible>0?100*returned/eligible:null};
  });
}

export function sevenDayReturn(row){
  if(row?.eligible==null)return {value:'Unavailable',note:'Return report unavailable'};
  if(row.eligible===0)return {value:'Not ready',note:row.firstDaily?'No full week yet':'No first-time players'};
  return {value:row.returnRate.toFixed(1)+'%',
    note:row.returned+' of '+row.eligible+' came back'+(row.eligible<MIN_RETURN_SAMPLE?' · Small sample':'')};
}

export function sortCampaigns(rows,mode='first'){
  const result=[...rows],byCount=(a,b)=>count(b.daily_completions)-count(a.daily_completions),
    byFirst=(a,b)=>(b.firstDaily??-1)-(a.firstDaily??-1);
  result.sort((a,b)=>{
    if(mode==='returns'){
      const aReady=a.eligible>=MIN_RETURN_SAMPLE,bReady=b.eligible>=MIN_RETURN_SAMPLE;
      if(aReady!==bReady)return aReady?-1:1;
      if(aReady&&bReady&&b.returnRate!==a.returnRate)return b.returnRate-a.returnRate;
    }
    return (mode==='completions'?byCount(a,b)||byFirst(a,b):byFirst(a,b)||byCount(a,b))||
      String(a.source||'').localeCompare(String(b.source||''))||
      String(a.campaign||'').localeCompare(String(b.campaign||''));
  });
  return result;
}
